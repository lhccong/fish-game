/**
 * 房间包走 MinIO 下载的元信息。
 *
 * 与 `marketPackage.ts` 里 `validateMarketSource` 风格一致：消息穿越
 * transport/WebSocket 时是 untrusted JSON，读取端必须用白名单校验。
 *
 * 设计要点：
 *   - `publicUrl` 是 lobby-mock 在 /api/upload/presign 阶段根据 MINIO_PUBLIC_BASE
 *     拼出来的直链（形如 `http://<host>:<port>/<bucket>/game/<userId>/<tpl>.zip`）。
 *     joiner 拿到后直接 fetch MinIO 拉 zip —— 不依赖签名过期、长期可用。
 *     访问控制交给 MinIO bucket 策略 + P2P 准入（host 端 handlePackageRequest
 *     决定把 URL 给谁）。HTTP 直链在 dev 环境通常需要 MINIO_PUBLIC_BASE 指向
 *     host LAN IP 而非 127.0.0.1。
 */
export interface CustomRemoteDownload {
  publicUrl: string;
}

export function validateCustomRemote(value: unknown): CustomRemoteDownload {
  if (!value || typeof value !== 'object') throw new Error('Invalid custom remote source');
  const source = value as Partial<CustomRemoteDownload>;
  if (typeof source.publicUrl !== 'string' || !source.publicUrl) {
    throw new Error('Invalid custom remote source: publicUrl must be a non-empty string');
  }
  // 必须是 http(s) URL（不允许 javascript: / data: / 自定义协议）。
  let parsed: URL;
  try {
    parsed = new URL(source.publicUrl);
  } catch {
    throw new Error('Invalid custom remote source: publicUrl is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid custom remote source: publicUrl must be http(s)');
  }
  return { publicUrl: source.publicUrl };
}
