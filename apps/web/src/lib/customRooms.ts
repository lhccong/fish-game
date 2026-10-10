/** 已开启房间的不可变 Package 快照。 */
import { createPackage, type RoomPackage, type RoomPackageInput } from '@parti/room-packager';
import { getDb, type PackageSourceInfo, type RoomSnapshotRecord } from './db';
import { createDraftId } from './ids';
import { findRoom, loadPackageSource } from './rooms';
import { prepareCustomPackageRecord, resolveImportedCover } from './templates';
import { validateMarketPackageSource, type MarketPackageSource } from './marketPackage';
import { getCurrentUserId } from './currentUser';
import {
  filesToZip,
  putBlobToUrl,
  requestPresignedPut,
  UploadHttpError,
  UploadRequiresLoginError,
  UploadUnavailableError,
} from './uploadToMinio';
import { type CustomRemoteDownload, validateCustomRemote } from './customRemote';

export type { CustomRemoteDownload };
export { validateCustomRemote };

export interface CustomRoomEntry {
  id: string;
  name: string;
  description: string;
  target: 'local' | 'peer';
  createdAt: number;
}

type CreateRoomSnapshotOptions =
  | { sourceId: string; target: 'local' | 'peer' }
  | {
      input: RoomPackageInput;
      target: 'local' | 'peer';
      source: { type: 'editor'; basedOn?: string };
    };

export interface CreatedRoomSnapshot {
  roomId: string;
  customPackageId?: string;
}

export async function createRoomSnapshot(
  options: CreateRoomSnapshotOptions,
): Promise<CreatedRoomSnapshot> {
  let sourcePackage: RoomPackage;
  let source: PackageSourceInfo;
  let customRecord;
  let marketPackage: MarketPackageSource | undefined;

  if ('sourceId' in options) {
    sourcePackage = await loadPackageSource(options.sourceId);
    source = findRoom(options.sourceId)
      ? { type: 'builtin', id: options.sourceId }
      : { type: 'custom', id: options.sourceId };
    if (source.type === 'custom') {
      const template = await (await getDb()).get('customPackages', source.id);
      if (template?.source.type === 'market') {
        if (!template.source.download) throw new Error('Please reinstall this market game before creating a room.');
        marketPackage = validateMarketPackageSource(template.source.download);
      }
    }
  } else {
    // 空白/编辑器创建：先在本地确定 customRecord.id，再走"打包 zip → presigned
    // PUT → 直传 MinIO"通道。失败回落到纯本地（通道未配置时静默）。
    // 同 manifest.id 再次保存：始终覆盖（与 importRoomFromZip 行为一致）。
    const baseRecord = await prepareCustomPackageRecord(
      options.input,
      options.source,
      { forcePreferredId: true },
    );
    let remoteKey: string | undefined;
    let remotePublicUrl: string | undefined;
    try {
      const userId = getCurrentUserId();
      if (userId === 'anon') throw new UploadRequiresLoginError();
      const zipBytes = filesToZip(baseRecord.files);
      const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
      const presigned = await requestPresignedPut({
        userId,
        templateId: baseRecord.id,
        fileName: `${baseRecord.id}.zip`,
        contentType: 'application/zip',
      });
      await putBlobToUrl(presigned.url, new Blob([zipBuffer], { type: 'application/zip' }));
      remoteKey = presigned.key;
      // publicUrl 是 lobby-mock 在 presign 阶段根据 MINIO_PUBLIC_BASE 拼出来的
      // 直链。joiner 拿这个直链 fetch MinIO 拿 zip —— 不依赖签名过期、可
      // 长期使用，访问控制由 MinIO bucket 策略 + P2P 准入完成。publicUrl
      // 可选：dev 环境如果 MINIO_PUBLIC_BASE 没配（默认指向 127.0.0.1，
      // 其它机器不可达），joiner 端会走 fallback。
      remotePublicUrl = presigned.publicUrl;
    } catch (error) {
      if (error instanceof UploadUnavailableError) {
        remoteKey = undefined;
      } else if (error instanceof UploadRequiresLoginError) {
        // 未登录：把异常往上抛，由 UI 拦截提示登录。
        throw error;
      } else if (error instanceof UploadHttpError) {
        console.warn('[customRooms] MinIO 上传失败，仅保存到本地', { code: error.code, message: error.message });
        remoteKey = undefined;
      } else {
        throw error;
      }
    }
    customRecord = remoteKey
      ? { ...baseRecord, remoteKey, remotePublicUrl }
      : baseRecord;
    sourcePackage = await createPackage({ manifest: customRecord.manifest, files: customRecord.files });
    source = { type: 'custom', id: customRecord.id };
  }

  const db = await getDb();
  const prefix = sourcePackage.manifest.id.split('-')[0] || 'room';
  let roomId = createDraftId(prefix);
  while (await db.get('roomSnapshots', roomId)) roomId = createDraftId(prefix);
  const snapshotPackage = await createPackage({
    manifest: { ...sourcePackage.manifest, id: roomId },
    files: sourcePackage.files,
  });
  const snapshot: RoomSnapshotRecord = {
    id: roomId,
    manifest: snapshotPackage.manifest,
    files: snapshotPackage.files,
    packageHash: snapshotPackage.packageHash,
    source,
    ...(marketPackage ? { marketPackage } : {}),
    target: options.target,
    createdAt: Date.now(),
  };

  const tx = db.transaction(['customPackages', 'roomSnapshots', 'usage'], 'readwrite');
  if (customRecord) await tx.objectStore('customPackages').put(customRecord);
  await tx.objectStore('roomSnapshots').put(snapshot);
  const usage = await tx.objectStore('usage').get(source.id);
  await tx.objectStore('usage').put({ id: source.id, count: (usage?.count ?? 0) + 1 });
  await tx.done;
  return { roomId, ...(customRecord ? { customPackageId: customRecord.id } : {}) };
}

export async function loadRoomSnapshot(roomId: string): Promise<RoomPackage> {
  const record = await (await getDb()).get('roomSnapshots', roomId);
  if (!record) throw new RoomSnapshotNotFoundError(roomId);
  return { manifest: record.manifest, files: record.files, packageHash: record.packageHash };
}

export type RoomDownloadSource =
  | { builtinSourceId: string }
  | { marketSource: MarketPackageSource }
  | { customRemote: CustomRemoteDownload };

export async function loadRoomDownloadSource(roomId: string): Promise<RoomDownloadSource | undefined> {
  const record = await (await getDb()).get('roomSnapshots', roomId);
  if (record?.source.type === 'builtin') return { builtinSourceId: record.source.id };
  if (record?.marketPackage) return { marketSource: validateMarketPackageSource(record.marketPackage) };
  // 用户上传 / 编辑器创建：customPackages store 里存了 remotePublicUrl（lobby-mock
  // 在 presign 阶段根据 MINIO_PUBLIC_BASE 拼出来的直链）。host 端 createPeerHost
  // 时把 URL 广播给 joiner，joiner 直接 fetch MinIO 拿 zip —— 不依赖签名过期，
  // 长期可用；访问控制交给 MinIO bucket 策略 + P2P 准入（host 端
  // handlePackageRequest 决定把 URL 给谁）。
  if (record?.source.type === 'custom') {
    const custom = await (await getDb()).get('customPackages', record.source.id);
    if (custom?.remotePublicUrl) {
      return {
        customRemote: { publicUrl: custom.remotePublicUrl },
      };
    }
  }
  return undefined;
}

export async function loadRoomCover(roomId: string): Promise<string | undefined> {
  const record = await (await getDb()).get('roomSnapshots', roomId);
  if (!record) return undefined;
  if (record.source.type === 'builtin') {
    const cover = findRoom(record.source.id)?.cover;
    if (cover) return new URL(cover, window.location.href).href;
  }
  const cover = resolveImportedCover(record.manifest.cover, record.files);
  if (!cover) return undefined;
  if (!cover.startsWith('data:')) return new URL(cover, window.location.href).href;
  // Keep embedded artwork below the lobby metadata limit.
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(undefined), 5000);
    image.onerror = () => { clearTimeout(timer); resolve(undefined); };
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 100;
        const context = canvas.getContext('2d');
        if (!context) { resolve(undefined); return; }
        const scale = Math.min(160 / image.width, 100 / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 160, 100);
        context.drawImage(image, (160 - width) / 2, (100 - height) / 2, width, height);
        for (const quality of [0.75, 0.5, 0.3]) {
          const thumbnail = canvas.toDataURL('image/jpeg', quality);
          if (thumbnail.length <= 6000) { resolve(thumbnail); return; }
        }
        resolve(undefined);
      } catch { resolve(undefined); }
    };
    image.src = cover;
  });
}

export async function listCustomRooms(): Promise<CustomRoomEntry[]> {
  const all = await (await getDb()).getAll('roomSnapshots');
  return all.map((room) => ({
    id: room.id,
    name: room.manifest.name,
    description: room.manifest.description ?? '',
    target: room.target,
    createdAt: room.createdAt,
  }));
}

export async function deleteRoomSnapshot(roomId: string): Promise<void> {
  await (await getDb()).delete('roomSnapshots', roomId);
}

export const deleteCustomRoom = deleteRoomSnapshot;

export class RoomSnapshotNotFoundError extends Error {
  constructor(readonly roomId: string) {
    super(roomId);
    this.name = 'RoomSnapshotNotFoundError';
  }
}
