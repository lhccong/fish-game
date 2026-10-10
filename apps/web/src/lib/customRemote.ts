/**
 * 房间包走 MinIO 下载的元信息。
 *
 * 与 `marketPackage.ts` 里 `validateMarketPackageSource` 风格一致：消息穿越
 * transport/WebSocket 时是 untrusted JSON，读取端必须用白名单校验。
 *
 * 设计要点：
 *   - `uploadBackend` 当前固定 lobby-mock 的 `/api/upload/get`，但留成枚举式字段
 *     是为了未来如果引入直连 MinIO 的端点可以无痛扩展。
 *   - `key` 是 MinIO 对象 key。前缀和 `..` 段由 lobby-mock 在签 URL 前再校验
 *     一次（key 必须以 `game/<hostUserId>/` 开头），浏览器侧只做格式校验以免发出去
 *     浪费一次 RTT。
 *   - `hostUserId` 是房主在摸鱼岛登录后的稳定 userId —— *不是* joiner 自己的。
 *     joiner 通过 host 准入后，host 把 (hostUserId, key) 一起私聊给 joiner，
 *     joiner 据此申请一次性 GET presigned URL。鉴权模型在 lobby-mock 端：key
 *     必须以 `game/<hostUserId>/` 开头，这等于隐含要求"声明的 hostUserId 必须是
 *     这个 key 真正的拥有者"。但**hostUserId 字符串本身需要 joiner 信任 host**，
 *     所以准入仍然在 host 的 `handlePackageRequest` 阶段做（lobby-mock 不重做）。
 */
export interface CustomRemoteDownload {
  uploadBackend: '/api/upload/get';
  hostUserId: string;
  key: string;
}

const UPLOAD_BACKEND_VALUES = new Set<string>(['/api/upload/get']);
// 字符集与 lobby-mock `validateMinioUserId` 的正则保持一致 —— 服务端
// 也是同一白名单，前端做白名单校验就足够，不需要再发出去试错。
const USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateCustomRemote(value: unknown): CustomRemoteDownload {
  if (!value || typeof value !== 'object') throw new Error('Invalid custom remote source');
  const source = value as Partial<CustomRemoteDownload>;
  if (typeof source.uploadBackend !== 'string' || !UPLOAD_BACKEND_VALUES.has(source.uploadBackend)) {
    throw new Error('Invalid custom remote source: unsupported uploadBackend');
  }
  if (typeof source.hostUserId !== 'string' || !source.hostUserId || source.hostUserId.length > 128) {
    throw new Error('Invalid custom remote source: hostUserId must be 1-128 chars');
  }
  if (source.hostUserId === 'anon') {
    throw new Error('Invalid custom remote source: hostUserId must not be anonymous');
  }
  if (!USER_ID_PATTERN.test(source.hostUserId)) {
    throw new Error('Invalid custom remote source: hostUserId has illegal characters');
  }
  if (typeof source.key !== 'string' || !source.key || source.key.length > 512) {
    throw new Error('Invalid custom remote source: key must be 1-512 chars');
  }
  if (!/^game\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.zip$/.test(source.key)) {
    throw new Error('Invalid custom remote source: key must look like game/<userId>/<templateId>.zip');
  }
  // 自检：key 的 userId 段必须等于 hostUserId。防止 host 把别的用户的
  // remoteKey 误传出来，让 joiner 端先一步拦下。
  const keyUserSegment = source.key.split('/')[1];
  if (keyUserSegment !== source.hostUserId) {
    throw new Error('Invalid custom remote source: key userId segment does not match hostUserId');
  }
  return {
    uploadBackend: '/api/upload/get',
    hostUserId: source.hostUserId,
    key: source.key,
  };
}
