/** 准备态自定义 Package 存储。内置模板只由 rooms.ts 从静态目录加载。 */
import {
  createPackage,
  encodeFilesBase64,
  mimeTypeForPath,
  type RoomPackageInput,
} from '@parti/room-packager';
import { rooms as registry } from 'virtual:room-registry';
import { getDb, type CustomPackageRecord } from './db';
import { createDraftId } from './ids';
import { isImportedTemplateSource } from './templateSources';
import { getCurrentUserId } from './currentUser';
import { deleteRemoteKey, UploadHttpError, UploadUnavailableError } from './uploadToMinio';

const BUILTIN_IDS = new Set(registry.map(({ dir, manifest }) => manifest.id ?? dir));

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  descriptionFallback?: 'importedTemplate';
  source: CustomPackageRecord['source'];
  tags: string[];
  imported: boolean;
  cover?: string;
}

function isExternalCover(cover: string): boolean {
  return /^(https?:)?\/\//.test(cover) || cover.startsWith('/');
}

/** 将持久化包内的相对封面转为无需生命周期管理的 data URL。 */
export function resolveImportedCover(
  cover: string | undefined,
  files: Record<string, Uint8Array>,
): string | undefined {
  if (!cover) return undefined;
  if (isExternalCover(cover)) return cover;
  const path = cover.replace(/^(\.\/)+/, '');
  const bytes = files[path];
  if (!bytes) return undefined;
  const mime = mimeTypeForPath(path);
  if (!mime.startsWith('image/')) return undefined;
  const encoded = encodeFilesBase64({ [path]: bytes })[path];
  return `data:${mime};base64,${encoded}`;
}

export async function listImportedTemplates(): Promise<TemplateMeta[]> {
  const all = await (await getDb()).getAll('customPackages');
  return all.map((item) => ({
    id: item.id,
    name: item.manifest.name ?? item.id,
    description: item.manifest.description ?? '',
    ...(item.manifest.description ? {} : { descriptionFallback: 'importedTemplate' as const }),
    source: item.source,
    tags: item.manifest.tags ?? [],
    imported: isImportedTemplateSource(item.source),
    cover: resolveImportedCover(item.manifest.cover, item.files),
  }));
}

export async function getTemplatePackage(id: string): Promise<RoomPackageInput | undefined> {
  const record = await (await getDb()).get('customPackages', id);
  return record ? { manifest: record.manifest, files: record.files } : undefined;
}

async function uniqueId(preferred: string, forcePreferred: boolean): Promise<string> {
  const db = await getDb();
  // builtin id 永不让步（避免和内置模板撞名）。
  if (preferred && !BUILTIN_IDS.has(preferred)) {
    // forcePreferred=true：允许覆盖 customPackages 中已存在的同 id 条目
    // （用于"用户改了代码再次上传"和"空白模板被重新保存"场景）。
    if (forcePreferred || !(await db.get('customPackages', preferred))) {
      return preferred;
    }
  }
  let id = createDraftId(preferred || 'package');
  while (BUILTIN_IDS.has(id) || await db.get('customPackages', id)) id = createDraftId(preferred || 'package');
  return id;
}

export async function prepareCustomPackageRecord(
  input: RoomPackageInput,
  source: CustomPackageRecord['source'],
  options: { remoteKey?: string; forcePreferredId?: boolean } = {},
): Promise<CustomPackageRecord> {
  const pkg = await createPackage(input);
  const id = await uniqueId(pkg.manifest.id, options.forcePreferredId === true);
  const normalized = await createPackage({ manifest: { ...pkg.manifest, id }, files: pkg.files });
  return {
    id,
    manifest: normalized.manifest,
    files: normalized.files,
    source,
    createdAt: Date.now(),
    ...(options.remoteKey ? { remoteKey: options.remoteKey } : {}),
  };
}

export async function saveCustomPackage(
  input: RoomPackageInput,
  source: CustomPackageRecord['source'],
  options: { remoteKey?: string } = {},
): Promise<string> {
  const record = await prepareCustomPackageRecord(input, source, options);
  await (await getDb()).put('customPackages', record);
  return record.id;
}

export const saveImportedTemplate = saveCustomPackage;

export async function deleteImportedTemplate(id: string): Promise<void> {
  const record = await (await getDb()).get('customPackages', id);
  await (await getDb()).delete('customPackages', id);
  if (record?.remoteKey) {
    try {
      // 用当前登录用户去清 MinIO；未登录时跳过（IndexedDB 反正已经删了）。
      const userId = getCurrentUserId();
      if (userId !== 'anon') {
        await deleteRemoteKey({ userId, key: record.remoteKey });
      }
    } catch (error) {
      if (error instanceof UploadHttpError) {
        // 删除失败仅记日志（IndexedDB 已删成功，不会留下"假阳性"条目）
        console.warn('[templates] 远程模板删除失败', { id, key: record.remoteKey, error: error.message });
      } else if (!(error instanceof UploadUnavailableError)) {
        // 通道未配置时不刷日志（开发环境无 MinIO 是正常的）
        console.warn('[templates] 远程模板删除异常', error);
      }
    }
  }
}

export async function getUsageCounts(): Promise<Record<string, number>> {
  const all = await (await getDb()).getAll('usage');
  return Object.fromEntries(all.map((item) => [item.id, item.count]));
}
