/**
 * Joiners request admission metadata, then download website/market/minio files
 * (or receive inline files when no remote source is available).
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
import { getCurrentUserId } from './currentUser';
import { getRemoteDownloadUrl, UploadHttpError } from './uploadToMinio';
import {
  type RoomDownloadSource,
  validateCustomRemote,
} from './customRooms';

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
 * 走 MinIO 下载用户上传 / 编辑器创建的自定义包。
 *
 * 流程：
 *   1) POST /api/upload/get 拿到一次性 GET presigned URL。这里用 *房主* 的
 *      userId（remote.hostUserId）—— zip 是房主上传的，joiner 自己没有这个
 *      key 的所有权。准入在 host 的 handlePackageRequest 已完成，lobby-mock
 *      不再重做（只验 key 前缀与 hostUserId 一致）。
 *   2) 浏览器 fetch 这个 URL 拉 zip 字节。
 *   3) unzipRoomPackage 解包出 files。
 *   4) createPackage 重算 hash 校验与 host 声明一致（与 marketSource 分支
 *      共用 validateDownloadedRoomPackage）。
 *
 * 失败语义：
 *   - joiner 自己未登录：报错要求登录（与"上传要登录"对称，避免在未登录状态
 *     静默走奇怪的回退路径）。
 *   - UploadHttpError(404 NOT_FOUND)：对象过期/被房主删除。错误消息复用
 *     "Reinstall the game and create a new room"，与 market 404 路径保持一致。
 *   - UploadHttpError(403 FORBIDDEN_KEY)：服务端认为 hostUserId 与 key 不匹配，
 *     多半是房主改了登录账号或模板被另一个用户覆盖。提示房主重新建房。
 *   - 其它：直接抛给上层（joiner UI 走"游戏文件不可用"提示）。
 */
async function loadCustomPackageFromRemote(
  remote: { uploadBackend: '/api/upload/get'; hostUserId: string; key: string },
  manifest: unknown,
  roomId: string,
  packageHash: string,
): Promise<RoomPackage> {
  const joinerUserId = getCurrentUserId();
  if (joinerUserId === 'anon') {
    throw new Error('Login is required to download this custom room package.');
  }
  let presigned;
  try {
    presigned = await getRemoteDownloadUrl({ userId: remote.hostUserId, key: remote.key });
  } catch (error) {
    if (error instanceof UploadHttpError && error.status === 404) {
      throw new Error('Downloaded package is missing. Reinstall the game and create a new room.');
    }
    if (error instanceof UploadHttpError && error.status === 403) {
      throw new Error('Room host changed account or the package was overwritten. Ask the host to recreate the room.');
    }
    throw error;
  }

  const response = await fetch(presigned.url);
  if (!response.ok) {
    throw new Error(`Failed to download room zip: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const files = await unzipRoomPackage(new Uint8Array(buffer));
  const pkg = await createPackage({ manifest, files });
  if (pkg.manifest.id !== roomId || pkg.packageHash !== packageHash) {
    throw new Error('Downloaded package differs from the host package. Reinstall the game and create a new room.');
  }
  return pkg;
}
