/** 从 ZIP 文件或 GitHub 地址导入房间模版。 */
import {
  GitHubSourceClient,
  RoomSourceError,
  buildRoomPackageInput,
  collectRoomPackageFiles,
  resolveGitHubImport,
  resolveRoomPackageFiles,
  unzipRoomPackage as unzipSourcePackage,
  type RoomSourceErrorCode,
} from '@parti/room-source';
import type { RoomPackageInput } from '@parti/room-packager';
import { prepareCustomPackageRecord, saveImportedTemplate } from './templates';
import { getCurrentUserId } from './currentUser';
import {
  uploadBlobToBackend,
  UploadHttpError,
  UploadRequiresLoginError,
  UploadUnavailableError,
} from './uploadToMinio';
import { getDb } from './db';

export { RoomSourceError as ImportRoomError };
export type ImportRoomErrorCode = RoomSourceErrorCode;

/** 由已定位到包根目录的一组文件构造并校验 RoomPackageInput。 */
export async function buildPackageInputFromFiles(
  files: Record<string, Uint8Array>,
): Promise<RoomPackageInput> {
  return buildRoomPackageInput(files);
}

/**
 * 解包并定位 ZIP 中第一个完整房间包，返回以该包目录为根的文件映射。
 * 多层包裹目录、无效浅层 manifest 与不完整入口均使用共享候选规则处理。
 */
export async function unzipRoomPackage(
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<Record<string, Uint8Array>> {
  const archiveFiles = await unzipSourcePackage(data);
  const paths = Object.keys(archiveFiles);
  const { candidate } = await resolveRoomPackageFiles(paths, async (path) => archiveFiles[path]);
  return collectRoomPackageFiles(paths, candidate, async (path) => archiveFiles[path]);
}

/** 从 ZIP 导入并返回保存后的模版 id。
 *
 * 流程：
 *   1) 浏览器先解压并校验 ZIP（保持现有"导入即校验"语义）。
 *   2) 准备 CustomPackageRecord，确定最终 templateId（与 IndexedDB 主键一致）。
 *   3) 把原始 zip 通过 HTTPS 发给后端，由后端写入 MinIO，key 形如
 *      game/<userId>/<templateId>.zip。
 *   4) 把 record（含 remoteKey）put 到 customPackages store。
 *
 * 若后端未配置上传通道（开发环境无 MinIO），退化为只写本地 IndexedDB。
 */
export async function importRoomFromZip(file: File): Promise<string> {
  const files = await unzipRoomPackage(file);
  const input = await buildRoomPackageInput(files);
  // 同一 manifest.id 重复上传：始终覆盖现有 customRecord（"用户改了代码但没删游戏"
  // 场景的语义：老条目被新版本顶替，MinIO 同一 key 整体替换，不会留孤儿）。
  const record = await prepareCustomPackageRecord(
    input,
    { type: 'zip', ref: file.name },
    { forcePreferredId: true },
  );

  let remoteKey: string | undefined;
  try {
    const userId = getCurrentUserId();
    if (userId === 'anon') throw new UploadRequiresLoginError();
    const uploaded = await uploadBlobToBackend({
      userId,
      templateId: record.id,
      fileName: file.name,
      blob: file,
      contentType: 'application/zip',
    });
    remoteKey = uploaded.key;
  } catch (error) {
    if (error instanceof UploadUnavailableError) {
      // 通道未配置：开发环境或离线时静默回落到纯本地。
      remoteKey = undefined;
    } else if (error instanceof UploadRequiresLoginError) {
      // 未登录：直接把异常往上抛，由 UI 拦截提示登录。
      throw error;
    } else if (error instanceof UploadHttpError) {
      // 上传通道返回错误：保守回落到本地，避免阻塞用户导入。
      console.warn('[importRoom] MinIO 上传失败，仅保存到本地', { code: error.code, message: error.message });
      remoteKey = undefined;
    } else {
      throw error;
    }
  }

  const db = await getDb();
  await db.put('customPackages', { ...record, ...(remoteKey ? { remoteKey } : {}) });
  return record.id;
}

/**
 * 从 GitHub 仓库、tree 或 blob 地址导入。仓库文件由共享 GitHub source resolver
 * 定位和下载；若只能找到 release ZIP，会抛出带 releaseUrl 的人工降级错误。
 */
export async function importRoomFromGitHub(url: string): Promise<string> {
  const resolved = await resolveGitHubImport(url, new GitHubSourceClient());
  return saveImportedTemplate(resolved.input, { type: 'github', ref: url });
}

/** 类型守卫，供 UI 展示 release ZIP 人工下载入口。 */
export function releaseFallbackFromError(reason: unknown): string | undefined {
  return reason instanceof RoomSourceError && reason.code === 'RELEASE_MANUAL_REQUIRED'
    ? reason.releaseUrl
    : undefined;
}
