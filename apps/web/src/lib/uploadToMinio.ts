/**
 * 把用户上传的 zip 走"浏览器 → HTTPS 后端 → MinIO"通道。
 *
 * 职责：
 *   1) 浏览器通过 HTTPS POST /api/upload 把 zip 发给后端。
 *   2) 后端使用内部 MinIO 配置写入对象。
 *   3) 失败时调 POST /api/upload/delete 清理已上传的孤立文件。
 *
 * 不做的事：
 *   - 不解压、不校验 zip（那是 importRoom 那一层负责）。
 *   - 不写 IndexedDB（templates 层负责）。
 *
 * 还提供：filesToZip —— 把 record.files 打成 zip 字节，供空白创建时上传。
 */
import { lobbyServiceUrl } from './lobbyApi';

export interface UploadedObject {
  key: string;
  bucket: string;
  /**
   * joiner 端使用的公开直链（来自 lobby-mock 的 MINIO_PUBLIC_BASE）。
   * 如果服务端没配 publicBase，joiner 端就需要走 fallback（例如 P2P inline
   * base64）。访问控制全部交给 MinIO bucket 策略 + P2P 准入。
   */
  publicUrl?: string;
}

export interface UploadOptions {
  userId: string;
  templateId: string;
  fileName: string;
  blob: Blob;
  contentType?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export class UploadHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'UploadHttpError';
  }
}

export class UploadUnavailableError extends Error {
  constructor() {
    super('上传通道未配置（VITE_UPLOAD_BACKEND_URL / lobby service）');
    this.name = 'UploadUnavailableError';
  }
}

export class UploadRequiresLoginError extends Error {
  constructor() {
    super('未登录无法上传，请先登录摸鱼岛账号');
    this.name = 'UploadRequiresLoginError';
  }
}

function backendBase(): string {
  const url = lobbyServiceUrl();
  if (!url) throw new UploadUnavailableError();
  return url;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${backendBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  let data: { error?: { code?: string; message?: string } } | undefined;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    /* 非 JSON 错误响应 */
  }
  if (!res.ok) {
    throw new UploadHttpError(
      data?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      data?.error?.code,
    );
  }
  return data as T;
}

export async function deleteRemoteKey(
  params: { userId: string; key: string },
  signal?: AbortSignal,
): Promise<void> {
  await postJson<{ ok: true }>('/api/upload/delete', params, signal);
}

export interface DownloadUrl {
  url: string;
  key: string;
  bucket: string;
  expiresIn: number;
}

/**
 * 给 joiner 申请一次性的 GET presigned URL —— 直拉 MinIO 拿到 zip 字节。
 *
 * 与上传接口一致的鉴权/错误模型：userId='anon' 一律 401，通道
 * 未配置抛 UploadUnavailableError 让上层选择回退到本地 base64。key 服务端
 * 会强制 `game/<userId>/` 前缀，浏览器无需重复校验。
 */
export async function getRemoteDownloadUrl(
  params: { userId: string; key: string },
  signal?: AbortSignal,
): Promise<DownloadUrl> {
  return postJson<DownloadUrl>('/api/upload/get', params, signal);
}

export function uploadBlobToBackend(
  params: {
    userId: string;
    templateId: string;
    fileName: string;
    blob: Blob;
    contentType?: string;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<UploadedObject> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${backendBase()}/api/upload`, true);
    xhr.setRequestHeader('Content-Type', params.contentType ?? 'application/zip');
    xhr.setRequestHeader('X-Upload-User-Id', params.userId);
    xhr.setRequestHeader('X-Upload-Template-Id', params.templateId);
    if (params.signal) {
      params.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) params.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = async () => {
      let data: UploadedObject & { error?: { code?: string; message?: string } } | undefined;
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {
        // 非 JSON 错误响应
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadHttpError(
          data?.error?.message ?? `HTTP ${xhr.status}`,
          xhr.status,
          data?.error?.code,
        ));
        return;
      }
      if (!data?.key || !data.bucket) {
        reject(new UploadHttpError('上传接口返回数据无效', xhr.status));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => reject(new UploadHttpError('网络错误，上传失败', 0));
    xhr.onabort = () => reject(new UploadHttpError('上传已取消', 0));
    xhr.send(params.blob);
  });
}

/**
 * 一站式：后端上传 → 失败时回滚删除。
 * 上传成功时返回对象信息，供调用方写 IndexedDB。
 */
export async function uploadZipToMinio(options: UploadOptions): Promise<UploadedObject> {
  try {
    return await uploadBlobToBackend({
      userId: options.userId,
      templateId: options.templateId,
      fileName: options.fileName,
      blob: options.blob,
      contentType: options.contentType ?? 'application/zip',
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (error) {
    // 失败时尽力清掉孤儿文件，但失败不抛给上层（用户已经看到上传失败）。
    try {
      const key = `game/${options.userId}/${options.templateId}.zip`;
      await deleteRemoteKey({ userId: options.userId, key });
    } catch {
      /* 清理失败忽略 */
    }
    throw error;
  }
}

// === 极简 store-only zip 打包器 =====================================
//
// 仅实现 zip 的 STORED（无压缩）模式，用于把空白模板的 files 打成一个 zip 上传。
// 不做目录、加密、压缩。任何 record.files 路径都会被当 entry name 写入。
//
// ZIP 规范参考 PKWARE APPNOTE.TXT，足够被 unzip / 系统资源管理器打开。
//
//   local file header: 30 + name + extra(0) + data
//   central dir entry: 46 + name + extra(0) + comment(0)
//   end of central dir: 22
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crc ^ bytes[i]!;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

function dosDateTime(now: Date): { date: number; time: number } {
  const year = Math.max(now.getFullYear(), 1980);
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = Math.floor(now.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

/** 把 files 打成 zip 的 Uint8Array。manifest 名字固定 parti.room.json。 */
export function filesToZip(files: Record<string, Uint8Array>): Uint8Array {
  const { date, time } = dosDateTime(new Date());
  const entries = Object.entries(files).filter(([, bytes]) => bytes instanceof Uint8Array);
  if (entries.length === 0) throw new Error('filesToZip: files 为空');

  const localChunks: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = textEncoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);          // signature
    view.setUint16(4, 20, true);                  // version needed
    view.setUint16(6, 0, true);                   // flags
    view.setUint16(8, 0, true);                   // method = stored
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);               // compressed size
    view.setUint32(22, size, true);               // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);                  // extra length
    header.set(nameBytes, 30);
    localChunks.push(header, data);

    // Central directory entry
    const central = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true);         // signature
    cview.setUint16(4, 20, true);                 // version made by
    cview.setUint16(6, 20, true);                 // version needed
    cview.setUint16(8, 0, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, time, true);
    cview.setUint16(14, date, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, size, true);
    cview.setUint32(24, size, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);                 // extra
    cview.setUint16(32, 0, true);                 // comment
    cview.setUint16(34, 0, true);                 // disk
    cview.setUint16(36, 0, true);                 // internal attrs
    cview.setUint32(38, 0, true);                 // external attrs
    cview.setUint32(42, offset, true);            // local header offset
    central.set(nameBytes, 46);
    centralEntries.push(central);

    offset += header.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralEntries.reduce((sum, e) => sum + e.length, 0);

  // EOCD
  const eocd = new Uint8Array(22);
  const eview = new DataView(eocd.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8, entries.length, true);
  eview.setUint16(10, entries.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, centralStart, true);
  eview.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const entry of centralEntries) {
    out.set(entry, pos);
    pos += entry.length;
  }
  out.set(eocd, pos);
  return out;
}
