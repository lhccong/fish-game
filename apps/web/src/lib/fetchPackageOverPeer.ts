/**
 * Joiners request admission metadata, then download the room package from a
 * source the host points them at:
 *   - builtinSourceId  → loadPackageSource(id)  (fetch public/rooms/...)
 *   - marketSource      → loadMarketPackage(src) (fetch GitHub)
 *   - customRemote      → fetch joinGetUrl       (fetch MinIO via long-lived
 *                          presigned GET URL stored in IndexedDB by the host)
 *   - inline base64     → fallback when host broadcasts the files directly
 */
import {
  PARTI_VERSION,
  SeqCounter,
  createMessage,
  type ClientTransportSession,
  type PackageDataPayload,
  type PackageRequestPayload,
  type RoomErrorPayload,
  type RoomMessage,
} from '@parti/core';
import { createPackage, decodeFilesBase64, type RoomPackage } from '@parti/room-packager';
import { unzipRoomPackage } from '@parti/room-source';
import { createTransportAdapter, resolveJoinTransport, type TransportConfig } from './transportConfig';
import { findRoom, loadPackageSource } from './rooms';
import { loadMarketPackage, validateDownloadedRoomPackage } from './marketPackage';
import { validateCustomRemote } from './customRemote';

const PACKAGE_FETCH_TIMEOUT_MS = 60_000;
type DownloadSource =
  | { builtinSourceId: string; packageHash: string }
  | { marketSource: unknown; packageHash: string }
  | { customRemote: unknown; packageHash: string };
type DownloadPackageData = Omit<PackageDataPayload, 'files'> & DownloadSource;
type PackageResponse = PackageDataPayload | DownloadPackageData;

export type FetchPackageErrorCode = 'timeout' | 'disconnected';
export type PackageJoinStage = 'connecting' | 'relay' | 'signaling' | 'dataChannel' | 'downloading' | 'validating';

export class FetchPackageError extends Error {
  readonly code: FetchPackageErrorCode;

  constructor(code: FetchPackageErrorCode) {
    super(code);
    this.name = 'FetchPackageError';
    this.code = code;
  }
}

export async function fetchPackageOverPeer(
  roomId: string,
  hostPeerId: string,
  options: {
    clientId?: string;
    credential?: string;
    transportConfig?: TransportConfig;
    onStage?: (stage: PackageJoinStage) => void;
  } = {},
): Promise<RoomPackage> {
  options.onStage?.('connecting');
  const config = resolveJoinTransport(hostPeerId, options.transportConfig);
  if (config.adapter === 'relay') options.onStage?.('relay');
  const adapter = await createTransportAdapter(config, options.onStage);
  const transport = await adapter.joinRoom({
    roomId,
    hostConnectionInfo: hostPeerId,
  });

  try {
    options.onStage?.('downloading');
    const data = await requestPackageData(transport, roomId, options);
    if ('builtinSourceId' in data) {
    } else if ('marketSource' in data) {
    }
    if ('builtinSourceId' in data || 'marketSource' in data) {
      if ('builtinSourceId' in data && (typeof data.builtinSourceId !== 'string' || !findRoom(data.builtinSourceId))) {
        throw new Error('Built-in package is not available on this website');
      }
      // The transfer connection is no longer needed while fetching public package files.
      transport.close();
      const source = 'marketSource' in data
        ? await loadMarketPackage(data.marketSource)
        : await loadPackageSource(data.builtinSourceId);
      options.onStage?.('validating');
      return await validateDownloadedRoomPackage(source, data.manifest, roomId, data.packageHash);
    }
    if ('customRemote' in data) {
      const remote = validateCustomRemote(data.customRemote);
      // The transfer connection is no longer needed while fetching the zip over HTTP.
      transport.close();
      options.onStage?.('validating');
      return await loadCustomPackageFromRemote(remote, data.manifest, roomId, data.packageHash);
    }
    options.onStage?.('validating');
    const pkg = await createPackage({ manifest: data.manifest, files: decodeFilesBase64(data.files) });
    if (pkg.manifest.id !== roomId) throw new Error('Room package ID mismatch');
    return pkg;
  } finally {
    transport.close();
  }
}

function requestPackageData(
  transport: ClientTransportSession,
  roomId: string,
  options: { clientId?: string; credential?: string },
): Promise<PackageResponse> {
  return new Promise<PackageResponse>((resolve, reject) => {
    const seq = new SeqCounter();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new FetchPackageError('timeout'));
    }, PACKAGE_FETCH_TIMEOUT_MS);

    transport.onMessage((tm) => {
      const message = tm.data as RoomMessage;
      if (settled) return;
      if (message.type === 'sys:package-data') {
        settled = true;
        clearTimeout(timer);
        resolve(message.payload as PackageResponse);
      } else if (message.type === 'sys:error') {
        settled = true;
        clearTimeout(timer);
        const error = message.payload as RoomErrorPayload;
        reject(Object.assign(new Error(error.message), { code: error.code }));
      }
    });

    transport.onDisconnect(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new FetchPackageError('disconnected'));
    });

    const payload: PackageRequestPayload = {
      partiVersion: PARTI_VERSION,
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.credential !== undefined ? { credential: options.credential } : {}),
    };
    const request: RoomMessage = createMessage({
      roomId,
      from: transport.selfId,
      to: transport.hostId,
      seq: seq.next(),
      channel: 'sys',
      type: 'sys:package-request',
      payload,
    });
    transport.send({ data: request, meta: { reliable: true, ordered: true } });
  });
}

/**
 * 走 lobby-mock 在 presign 阶段返回的 publicUrl（MINIO_PUBLIC_BASE 拼出来的
 * 直链，http(s)://<host>:<port>/<bucket>/<key>）直接 fetch MinIO 拿 zip 字节。
 * 不依赖签名过期、长期可用；访问控制交给 MinIO bucket 策略 + P2P 准入
 * （host 端 handlePackageRequest 决定把 URL 给谁）。
 *
 * 失败语义：
 *   - HTTP 4xx/5xx：把"Downloaded package is unavailable"抛给上层，引导
 *     提示房主"检查 MINIO_PUBLIC_BASE 是否对 joiner 网络可达 / bucket 策略"。
 *   - 其它：直接抛给上层。
 */
async function loadCustomPackageFromRemote(
  remote: { publicUrl: string },
  manifest: unknown,
  roomId: string,
  packageHash: string,
): Promise<RoomPackage> {
  const response = await fetch(remote.publicUrl);
  if (!response.ok) {
    throw new Error(`Downloaded package is unavailable (HTTP ${response.status}). Check MINIO_PUBLIC_BASE is reachable and bucket policy allows this key.`);
  }
  const buffer = await response.arrayBuffer();
  const files = await unzipRoomPackage(new Uint8Array(buffer));
  const pkg = await createPackage({ manifest, files });
  if (pkg.manifest.id !== roomId || pkg.packageHash !== packageHash) {
    throw new Error('Downloaded package differs from the host package. Reinstall the game and create a new room.');
  }
  return pkg;
}
