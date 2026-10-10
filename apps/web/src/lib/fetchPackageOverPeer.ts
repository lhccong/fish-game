/**
 * Joiners request admission metadata, then download website/market files or receive a custom package.
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
import { createTransportAdapter, resolveJoinTransport, type TransportConfig } from './transportConfig';
import { findRoom, loadPackageSource } from './rooms';
import { loadMarketPackage, validateDownloadedRoomPackage } from './marketPackage';
import type { RoomDownloadSource } from './customRooms';

const PACKAGE_FETCH_TIMEOUT_MS = 60_000;
type WebsitePackageData = Omit<PackageDataPayload, 'files'> & RoomDownloadSource & { packageHash: string };
type PackageResponse = PackageDataPayload | WebsitePackageData;

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
