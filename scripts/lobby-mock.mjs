/**
 * 本地 mock 大厅服务 —— 纯 Node 实现，无任何外部依赖。
 *
 * 实现 docs/lobby-service.md 描述的最小子集，让本机 npm run dev 能跑通"公开到大厅"流程：
 *   - GET  /v1/health
 *   - GET  /v1/rooms
 *   - POST /v1/rooms
 *   - PATCH /v1/rooms/:listingId
 *   - DELETE /v1/rooms/:listingId
 *   - POST /api/upload           (后端接收 zip 并写入 MinIO)
 *   - POST /api/upload/presign   (兼容旧客户端的 presigned PUT URL)
 *   - POST /api/upload/delete    (用户删除本地模板时同步删 MinIO 文件)
 *
 * 租约 60 秒过期。
 *
 * 两种运行模式：
 *   1) 开发（默认，NODE_ENV != production）—— 内存 Map，ALLOWED_ORIGINS 全开（仅适合本机）。
 *   2) 生产（NODE_ENV=production）—— 进程内 Map + 写入 STORAGE_FILE（默认 ./data/lobby.json），
 *      ALLOWED_ORIGINS 通过同名环境变量以逗号分隔声明（不设置时仍全开，部署前请务必设置）。
 *
 * 用法：
 *   node scripts/lobby-mock.mjs                                  # 默认 http://127.0.0.1:5158
 *   PORT=6000 node scripts/lobby-mock.mjs                        # 自定义端口
 *   NODE_ENV=production PORT=5158 ALLOWED_ORIGINS=https://a.com,https://b.com \
 *     STORAGE_FILE=/var/lib/fish-game/lobby.json node scripts/lobby-mock.mjs
 *
 * MinIO 上传通道（可选，优先级：环境变量 > apps/web/config.local.json 的 minio 段）：
 *   MINIO_ENDPOINT=http://127.0.0.1:9000
 *   MINIO_REGION=us-east-1
 *   MINIO_ACCESS_KEY=minioadmin
 *   MINIO_SECRET_KEY=minioadmin123
 *   MINIO_BUCKET=game
 *   MINIO_PUBLIC_BASE=http://127.0.0.1:9000          # 可选，生成可下载的 publicUrl
 *   MINIO_PRESIGN_TTL_SECONDS=600                     # 可选，默认 600
 *   MINIO_FORCE_PATH_STYLE=true                       # 可选，MinIO 必须 true
 * 任何一项未配置 → /api/upload/* 路由返回 503，避免悄悄回落到本机文件系统。
 */
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number.parseInt(process.env.PORT ?? '5158', 10) || 5158;
const HOST = process.env.HOST ?? (IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1');
const LEASE_TTL_MS = 60_000;
const MAX_BODY_BYTES = 12 * 1024;
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.MAX_UPLOAD_BYTES ?? String(100 * 1024 * 1024), 10)
  || 100 * 1024 * 1024;
const STORAGE_FILE = process.env.STORAGE_FILE ?? (IS_PRODUCTION ? './data/lobby.json' : '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// === MinIO 上传通道配置 ===========================================
// 优先级：环境变量 MINIO_* > apps/web/config.local.json 的 minio 段。
// 任一项缺失就关闭 /api/upload/* 路由（不静默回落），强制要求部署方明确配置。
function loadMinioConfigFromFile() {
  // 候选路径：先 npm run dev 启动的 cwd，再 __dirname（脚本自身），再 apps/web/config.local.json。
  // 缺文件时静默返回空对象（dev 默认就是 MinIO enabled 的话，这是预期行为）。
  const cwd = process.cwd();
  // ESM 下没有 __dirname，用 import.meta.url 还原脚本所在目录。
  const scriptDir = new URL('.', import.meta.url);
  const scriptDirPath = scriptDir.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const candidates = [
    join(cwd, 'apps', 'web', 'config.local.json'),
    join(cwd, 'config.local.json'),
    join(scriptDirPath, '..', 'apps', 'web', 'config.local.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && parsed.minio) || {};
    } catch (error) {
      console.warn(
        `[lobby-mock] 无法解析 ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }
  return {};
}

const MINIO_FILE_CONFIG = loadMinioConfigFromFile();
const fileMinio = MINIO_FILE_CONFIG || {};

const pickMinioString = (envName, fileValue) => {
  const fromEnv = process.env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim();
  return typeof fileValue === 'string' ? fileValue : '';
};

const pickMinioNumber = (envName, fileValue, fallback) => {
  const fromEnv = process.env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const n = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(n)) return n;
  }
  if (typeof fileValue === 'number' && Number.isFinite(fileValue)) return fileValue;
  return fallback;
};

const pickMinioBoolean = (envName, fileValue, fallback) => {
  const fromEnv = process.env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim().toLowerCase() !== 'false';
  }
  if (typeof fileValue === 'boolean') return fileValue;
  return fallback;
};

const MINIO_CONFIG = {
  endpoint: pickMinioString('MINIO_ENDPOINT', fileMinio.endpoint),
  region: pickMinioString('MINIO_REGION', fileMinio.region) || 'us-east-1',
  accessKey: pickMinioString('MINIO_ACCESS_KEY', fileMinio.accessKey),
  secretKey: pickMinioString('MINIO_SECRET_KEY', fileMinio.secretKey),
  bucket: pickMinioString('MINIO_BUCKET', fileMinio.bucket) || 'game',
  publicBase: pickMinioString('MINIO_PUBLIC_BASE', fileMinio.publicBase).replace(/\/$/, ''),
  presignTtlSeconds: pickMinioNumber(
    'MINIO_PRESIGN_TTL_SECONDS',
    fileMinio.presignTtlSeconds,
    600,
  ),
  forcePathStyle: pickMinioBoolean(
    'MINIO_FORCE_PATH_STYLE',
    fileMinio.forcePathStyle,
    true,
  ),
};
const MINIO_ENABLED = Boolean(MINIO_CONFIG.endpoint && MINIO_CONFIG.accessKey && MINIO_CONFIG.secretKey);
const s3Client = MINIO_ENABLED
  ? new S3Client({
      endpoint: MINIO_CONFIG.endpoint,
      region: MINIO_CONFIG.region,
      credentials: { accessKeyId: MINIO_CONFIG.accessKey, secretAccessKey: MINIO_CONFIG.secretKey },
      forcePathStyle: MINIO_CONFIG.forcePathStyle,
    })
  : null;
if (MINIO_ENABLED) {
  console.log(`[lobby-mock] MinIO enabled: endpoint=${MINIO_CONFIG.endpoint} bucket=${MINIO_CONFIG.bucket}`);
} else {
  console.log('[lobby-mock] MinIO disabled (set MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY to enable /api/upload/*)');
}


function now() {
  return Date.now();
}

function isExpired(entry) {
  return entry.expiresAt <= now();
}

function randomToken() {
  return randomBytes(24).toString('hex');
}

// === 持久化包装 =====================================================
// 生产模式下，每次写后异步落盘到 STORAGE_FILE；崩溃丢失 ≤ 1 条记录，
// 反正还有 60s 租约过期，足够实用。开发模式（STORAGE_FILE 为空）走纯内存。
function loadListings() {
  if (!STORAGE_FILE) return new Map();
  if (!existsSync(STORAGE_FILE)) return new Map();
  try {
    const raw = readFileSync(STORAGE_FILE, 'utf8').trim();
    if (raw.length === 0) return new Map();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return new Map(Object.entries(parsed));
    }
    console.warn('[lobby-mock] STORAGE_FILE 内容非对象，忽略');
    return new Map();
  } catch (error) {
    console.error('[lobby-mock] 读取 STORAGE_FILE 失败：', error.message);
    return new Map();
  }
}
/** @type {Map<string, { token: string, entry: object, publicationHash?: string }>} */
const listings = loadListings();
let writeTimer = null;
function persistAsync() {
  if (!STORAGE_FILE) return;
  // 去抖：连续写合并到一次磁盘写。
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(STORAGE_FILE), { recursive: true });
      const obj = Object.fromEntries(listings);
      writeFileSync(STORAGE_FILE, JSON.stringify(obj));
    } catch (error) {
      console.error('[lobby-mock] 持久化失败：', error.message);
    }
  }, 200);
  writeTimer.unref?.();
}
function persistSync() {
  if (!STORAGE_FILE) return;
  clearTimeout(writeTimer);
  try {
    mkdirSync(dirname(STORAGE_FILE), { recursive: true });
    const obj = Object.fromEntries(listings);
    writeFileSync(STORAGE_FILE, JSON.stringify(obj));
  } catch (error) {
    console.error('[lobby-mock] 同步持久化失败：', error.message);
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  // 开发（无白名单）放行；生产（已设置白名单）只放白名单内。
  // 浏览器对无 Origin 的同源请求也会不带 Origin 头，需要放行。
  const allowOrigin =
    !origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin ?? '*' : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function rejectIfOriginNotAllowed(req, res) {
  // 生产 + 已配置白名单 + 跨域且 Origin 不在白名单 → 直接 403，避免 CORS 之外被滥用。
  if (!IS_PRODUCTION || ALLOWED_ORIGINS.length === 0) return false;
  const origin = req.headers.origin;
  if (!origin) return false; // 同源
  if (ALLOWED_ORIGINS.includes(origin)) return false;
  sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origin 未被 ALLOWED_ORIGINS 允许');
  return true;
}

function sendJson(res, status, body) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(res.req),
  };
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413, code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400, code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function readBinaryBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(Object.assign(new Error(`Upload body exceeds ${maxBytes} bytes`), {
          status: 413,
          code: 'UPLOAD_TOO_LARGE',
        }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', fail);
  });
}

const REQUIRED_FIELDS = [
  'roomId',
  'hostPeerId',
  'title',
  'packageName',
  'playerCount',
  'maxPlayers',
  'joinable',
  'credentialRequired',
];

// === MinIO 上传 userId / templateId 校验 ============================
// userId = 摸鱼岛登录用户的稳定 id（FishUser.id，来自 OAuth2 userinfo）；
// 客户端"未登录"会传 'anon'，直接拒绝。
// templateId 形如 custom_<uuid> 等。
// 不允许路径分隔符、..、控制字符。
const ANON_USER_ID = 'anon';
function validateMinioUserId(userId) {
  if (typeof userId !== 'string' || !userId) return 'userId 必须是非空字符串';
  if (userId === ANON_USER_ID) return '未登录用户不允许上传';
  if (userId.length > 128) return 'userId 长度不能超过 128';
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) return 'userId 只能包含字母数字下划线和短横线';
  return null;
}
function validateMinioTemplateId(templateId) {
  if (typeof templateId !== 'string' || !templateId) return 'templateId 必须是非空字符串';
  if (templateId.length > 128) return 'templateId 长度不能超过 128';
  if (!/^[A-Za-z0-9_-]+$/.test(templateId)) return 'templateId 只能包含字母数字下划线和短横线';
  return null;
}

// playerClientIds 是可选字段，host 上报时附带，用于 lobby server 给 viewer
// 算 selfRejoinable（让局中掉线的人能在 30s 内看到"加入游戏"按钮）。
const OPTIONAL_FIELDS = ['gameJoinable', 'playerClientIds'];

const FORBIDDEN_KEYS = ['password', 'credential', 'token', 'authorization', 'secret'];

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return '请求体必须是 JSON 对象';
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in input)) return `缺少字段 ${field}`;
  }
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.includes(key)) return `禁止字段 ${key}`;
  }
  if (typeof input.roomId !== 'string' || input.roomId.length === 0 || input.roomId.length > 128) {
    return 'roomId 必须是 1-128 字符';
  }
  if (typeof input.hostPeerId !== 'string' || input.hostPeerId.length === 0 || input.hostPeerId.length > 256) {
    return 'hostPeerId 必须是 1-256 字符';
  }
  if (typeof input.title !== 'string') return 'title 必须是字符串';
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0 || trimmedTitle.length > 80) return 'title 必须是 1-80 字符';
  if (typeof input.packageName !== 'string' || input.packageName.length === 0 || input.packageName.length > 120) {
    return 'packageName 必须是 1-120 字符';
  }
  if (!Number.isInteger(input.playerCount) || input.playerCount < 0) {
    return 'playerCount 必须是非负整数';
  }
  if (input.maxPlayers !== null && (!Number.isInteger(input.maxPlayers) || input.maxPlayers <= 0)) {
    return 'maxPlayers 必须是正整数或 null';
  }
  if (typeof input.joinable !== 'boolean') return 'joinable 必须是布尔';
  if (typeof input.credentialRequired !== 'boolean') return 'credentialRequired 必须是布尔';
  if (input.connectionInfo !== undefined &&
      (typeof input.connectionInfo !== 'string' || !input.connectionInfo || input.connectionInfo.length > 512)) {
    return 'Invalid connectionInfo';
  }
  if (input.transportConfig !== undefined) {
    const config = input.transportConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        !['relay', 'peerjs', 'lan', 'common'].includes(config.adapter) ||
        JSON.stringify(config).length > 4096) return 'Invalid transportConfig';
    if (config.adapter === 'relay' && Object.keys(config).some(key => key !== 'adapter')) return 'Invalid relay configuration';
  }
  if (input.gameJoinable !== undefined && typeof input.gameJoinable !== 'boolean') {
    return 'gameJoinable 必须是布尔（可选）';
  }
  if (input.playerClientIds !== undefined) {
    if (!Array.isArray(input.playerClientIds)) return 'playerClientIds 必须是字符串数组（可选）';
    if (input.playerClientIds.length > 32) return 'playerClientIds 数量不能超过 32';
    for (const id of input.playerClientIds) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
        return 'playerClientIds 元素必须是非空字符串且不超过 128 字符';
      }
    }
  }
  if (input.metadata !== undefined) {
    if (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata)) {
      return 'metadata 必须是对象';
    }
    if (JSON.stringify(input.metadata).length > 8 * 1024) {
      return 'metadata 不能超过 8 KiB';
    }
  }
  return null;
}

function makeEntry(input, listingId, createdAt) {
  return {
    listingId,
    roomId: input.roomId,
    hostPeerId: input.hostPeerId,
    ...(input.connectionInfo ? { connectionInfo: input.connectionInfo } : {}),
    ...(input.transportConfig ? { transportConfig: input.transportConfig } : {}),
    title: input.title.trim(),
    packageName: input.packageName,
    playerCount: input.playerCount,
    maxPlayers: input.maxPlayers,
    joinable: input.joinable,
    gameJoinable: input.gameJoinable ?? true,
    playerClientIds: Array.isArray(input.playerClientIds) ? input.playerClientIds : [],
    credentialRequired: input.credentialRequired,
    metadata: input.metadata,
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + LEASE_TTL_MS,
  };
}

function cleanExpired() {
  const cutoff = now();
  let removed = 0;
  for (const [listingId, record] of listings) {
    if (record.entry.expiresAt <= cutoff) {
      listings.delete(listingId);
      removed += 1;
    }
  }
  if (removed > 0) persistAsync();
}

const server = createHttpServer(async (req, res) => {
  res.req = req;
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // OPTIONS 预检 + 所有非 /v1/health 都走 Origin 白名单（生产）。
    if (req.method === 'OPTIONS') {
      if (rejectIfOriginNotAllowed(req, res)) return;
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (url.pathname !== '/v1/health' && rejectIfOriginNotAllowed(req, res)) return;

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(res, 200, { ok: true, version: 1 });
      return;
    }

    // === /api/upload ================================================
    // 浏览器通过 HTTPS 把 zip 发到当前服务，服务端再用内部 MinIO endpoint 写入对象。
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!MINIO_ENABLED) {
        return sendError(res, 503, 'UPLOAD_DISABLED', '服务端未配置 MinIO');
      }
      const userId = req.headers['x-upload-user-id'];
      const templateId = req.headers['x-upload-template-id'];
      const contentType = req.headers['content-type'];
      const userErr = validateMinioUserId(userId);
      if (userErr) {
        const isAnon = userId === ANON_USER_ID;
        return sendError(res, isAnon ? 401 : 422, isAnon ? 'UNAUTHENTICATED' : 'INVALID_INPUT', userErr);
      }
      const tplErr = validateMinioTemplateId(templateId);
      if (tplErr) return sendError(res, 422, 'INVALID_INPUT', tplErr);
      if (contentType && contentType.length > 128) {
        return sendError(res, 422, 'INVALID_INPUT', 'Content-Type 不能超过 128 字符');
      }

      const body = await readBinaryBody(req);
      if (body.length === 0) return sendError(res, 422, 'INVALID_INPUT', '上传文件不能为空');
      const key = `game/${userId}/${templateId}.zip`;
      await s3Client.send(new PutObjectCommand({
        Bucket: MINIO_CONFIG.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType || 'application/zip',
      }));
      const publicUrl = MINIO_CONFIG.publicBase
        ? `${MINIO_CONFIG.publicBase}/${key}`
        : undefined;
      sendJson(res, 200, {
        key,
        bucket: MINIO_CONFIG.bucket,
        ...(publicUrl ? { publicUrl } : {}),
      });
      return;
    }

    // === /api/upload/presign ============================================
    // body: { userId, templateId, fileName, contentType? }
    // 限制：key 路径形如 game/<userId>/<templateId>.zip，绝不允许 .. 越级。
    if (req.method === 'POST' && url.pathname === '/api/upload/presign') {
      if (!MINIO_ENABLED) {
        return sendError(res, 503, 'UPLOAD_DISABLED', '服务端未配置 MinIO');
      }
      const body = await readJsonBody(req);
      const { userId, templateId, fileName, contentType } = body || {};
      const userErr = validateMinioUserId(userId);
      if (userErr) {
        const isAnon = userId === ANON_USER_ID;
        return sendError(res, isAnon ? 401 : 422, isAnon ? 'UNAUTHENTICATED' : 'INVALID_INPUT', userErr);
      }
      const tplErr = validateMinioTemplateId(templateId);
      if (tplErr) return sendError(res, 422, 'INVALID_INPUT', tplErr);
      if (fileName !== undefined && (typeof fileName !== 'string' || fileName.length > 256)) {
        return sendError(res, 422, 'INVALID_INPUT', 'fileName 必须是 ≤256 字符串');
      }
      if (contentType !== undefined && (typeof contentType !== 'string' || contentType.length > 128)) {
        return sendError(res, 422, 'INVALID_INPUT', 'contentType 必须是 ≤128 字符串');
      }
      const key = `game/${userId}/${templateId}.zip`;
      const command = new PutObjectCommand({
        Bucket: MINIO_CONFIG.bucket,
        Key: key,
        ContentType: contentType || 'application/zip',
        // MinIO 默认不做 server-side encryption。AWS SDK v3 的 PutObject 在
        // 启用 flexible checksum 后会自动计算 x-amz-checksum-crc32 并加到请求头；
        // 而 presigner 签名时只覆盖已签的 headers，加密的 SSE-AES256 才会触发
        // 那个 header。生产部署若想加密，应在桶策略层启用，而非本参数。
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      const url = await getSignedUrl(s3Client, command, { expiresIn: MINIO_CONFIG.presignTtlSeconds });
      const publicUrl = MINIO_CONFIG.publicBase
        ? `${MINIO_CONFIG.publicBase}/${key}`
        : undefined;
      // publicUrl（如果有配 MINIO_PUBLIC_BASE）就是 joiner 端 fetch 的直链 —
      // 不带签名，长期有效，访问控制交给 MinIO bucket 策略（joiner 必须能
      // 网络可达 MinIO，dev 环境通常需要 MINIO_PUBLIC_BASE 指向 host LAN IP
      // 而非 127.0.0.1）。这把"准入"全部放回 P2P 通道（host 端
      // handlePackageRequest 决定把 URL 给谁），同时避免签名 URL 过期后
      // joiner 拿不到 zip 的故障模式。
      sendJson(res, 200, {
        url,
        key,
        bucket: MINIO_CONFIG.bucket,
        expiresIn: MINIO_CONFIG.presignTtlSeconds,
        ...(publicUrl ? { publicUrl } : {}),
      });
      return;
    }

    // === /api/upload/delete =============================================
    // body: { userId, key } —— 防止用户 A 删用户 B 的文件，key 必须以 game/<userId>/ 开头。
    if (req.method === 'POST' && url.pathname === '/api/upload/delete') {
      if (!MINIO_ENABLED) {
        return sendError(res, 503, 'UPLOAD_DISABLED', '服务端未配置 MinIO');
      }
      const body = await readJsonBody(req);
      const { userId, key } = body || {};
      const userErr = validateMinioUserId(userId);
      if (userErr) {
        const isAnon = userId === ANON_USER_ID;
        return sendError(res, isAnon ? 401 : 422, isAnon ? 'UNAUTHENTICATED' : 'INVALID_INPUT', userErr);
      }
      if (typeof key !== 'string' || !key) {
        return sendError(res, 422, 'INVALID_INPUT', 'key 必须是非空字符串');
      }
      if (key.length > 512) return sendError(res, 422, 'INVALID_INPUT', 'key 长度不能超过 512');
      if (!key.startsWith(`game/${userId}/`)) {
        return sendError(res, 403, 'FORBIDDEN_KEY', 'key 必须以 game/<userId>/ 开头');
      }
      if (key.includes('..') || key.split('/').some((p) => p === '')) {
        return sendError(res, 422, 'INVALID_INPUT', 'key 包含非法路径段');
      }
      await s3Client.send(new DeleteObjectCommand({ Bucket: MINIO_CONFIG.bucket, Key: key }));
      sendJson(res, 200, { ok: true, key });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/rooms') {
      cleanExpired();
      // 可选查询参数 viewerClientId：调用方告知"我"的稳定 clientId，
      // 服务端据此在每个条目上补充 selfRejoinable（用于 lobby 列表的"加入游戏"按钮）。
      const viewerClientId = url.searchParams.get('viewerClientId') ?? null;
      const rooms = [];
      for (const { entry } of listings.values()) {
        if (isExpired(entry)) continue;
        const enriched = {
          ...entry,
          // 调用方没认领 clientId 时永远不点亮"加入游戏"按钮。
          selfRejoinable: viewerClientId
            ? Array.isArray(entry.playerClientIds)
              && entry.playerClientIds.includes(viewerClientId)
            : false,
        };
        rooms.push(enriched);
      }
      sendJson(res, 200, { rooms });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/rooms') {
      const body = await readJsonBody(req);
      const error = validateInput(body);
      if (error) return sendError(res, 422, 'INVALID_INPUT', error);
      if (body.publicationKey !== undefined &&
          (typeof body.publicationKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.publicationKey))) {
        return sendError(res, 422, 'INVALID_INPUT', 'publicationKey 格式不正确');
      }
      cleanExpired();
      // The random publication key is private; room IDs alone must not grant lease access.
      const publicationHash = body.publicationKey
        ? createHash('sha256').update(body.publicationKey).digest('hex')
        : undefined;
      if (publicationHash) {
        for (const [id, record] of listings) {
          if (record.publicationHash !== publicationHash) continue;
          if (record.entry.roomId !== body.roomId) {
            return sendError(res, 409, 'PUBLICATION_CONFLICT', '发布标识已用于其他房间');
          }
          const updatedAt = now();
          record.entry = {
            ...makeEntry(body, id, record.entry.createdAt),
            updatedAt,
            expiresAt: updatedAt + LEASE_TTL_MS,
          };
          persistAsync();
          sendJson(res, 200, { listingId: id, leaseToken: record.token, expiresAt: record.entry.expiresAt });
          return;
        }
      }
      const listingId = `listing_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const createdAt = now();
      const entry = makeEntry(body, listingId, createdAt);
      listings.set(listingId, { token: randomToken(), entry, ...(publicationHash ? { publicationHash } : {}) });
      persistAsync();
      sendJson(res, 201, {
        listingId,
        leaseToken: listings.get(listingId).token,
        expiresAt: entry.expiresAt,
      });
      return;
    }

    const patchMatch = url.pathname.match(/^\/v1\/rooms\/([^/]+)$/);
    if (patchMatch) {
      const listingId = patchMatch[1];
      cleanExpired();
      const record = listings.get(listingId);
      if (!record) return sendError(res, 404, 'NOT_FOUND', '条目不存在或已过期');

      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token || token !== record.token) {
        return sendError(res, 401, 'UNAUTHORIZED', '租约令牌缺失或不正确');
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        const error = validateInput(body);
        if (error) return sendError(res, 422, 'INVALID_INPUT', error);
        const updatedAt = now();
        record.entry = {
          ...makeEntry(body, listingId, record.entry.createdAt),
          createdAt: record.entry.createdAt,
          updatedAt,
          expiresAt: updatedAt + LEASE_TTL_MS,
        };
        persistAsync();
        sendJson(res, 200, {
          listingId,
          leaseToken: record.token,
          expiresAt: record.entry.expiresAt,
        });
        return;
      }

      if (req.method === 'DELETE') {
        listings.delete(listingId);
        persistAsync();
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }
    }

    sendError(res, 404, 'NOT_FOUND', `未知路径 ${req.method} ${url.pathname}`);
  } catch (error) {
    const status = error?.status ?? 500;
    const code = error?.code ?? 'INTERNAL';
    sendError(res, status, code, error?.message ?? 'Internal error');
  }
});

// Node 22+ 自带 globalThis.crypto，Node 18 也支持；这里不显式判断。

server.listen(PORT, HOST, () => {
  const banner = IS_PRODUCTION ? '[lobby-mock][prod]' : '[lobby-mock][dev]';
  console.log(`${banner} listening on http://${HOST}:${PORT}`);
  if (STORAGE_FILE) console.log(`${banner} persistence: ${STORAGE_FILE}`);
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`${banner} CORS allow-list: ${ALLOWED_ORIGINS.join(', ')}`);
  } else {
    console.log(`${banner} CORS: ANY origin (开发模式或未设置 ALLOWED_ORIGINS，生产部署请务必设置)`);
  }
  console.log(`${banner} try: curl http://${HOST}:${PORT}/v1/health`);
});

function shutdown(signal) {
  console.log(`[lobby-mock] received ${signal}, flushing and exiting…`);
  persistSync();
  server.close(() => process.exit(0));
  // 兜底 2s 强退。
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
