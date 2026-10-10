// 端到端：同 manifest.id 重复上传，验证"始终覆盖"语义。
//
// 走真实后端：lobby-mock → 拿 presigned URL → PUT → 验证 MinIO 中对象
// 字节内容被整体替换。
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const BACKEND = 'http://127.0.0.1:5158';
const userId = 'user_overwrite-test';
const manifestId = 'overwrite-demo';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime() {
  const n = new Date();
  return { date: ((n.getFullYear() - 1980) << 9) | ((n.getMonth() + 1) << 5) | n.getDate(), time: (n.getHours() << 11) | (n.getMinutes() << 5) | Math.floor(n.getSeconds() / 2) };
}
function buildZip(files) {
  const { date, time } = dosDateTime();
  const enc = new TextEncoder();
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const h = new Uint8Array(30 + nb.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, 0, true);
    v.setUint16(10, time, true); v.setUint16(12, date, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
    v.setUint16(26, nb.length, true); v.setUint16(28, 0, true);
    h.set(nb, 30);
    locals.push(h, data);
    const c = new Uint8Array(46 + nb.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint16(42, offset, true);
    c.set(nb, 46);
    centrals.push(c);
    offset += h.length + data.length;
  }
  const cStart = offset; const cSize = centrals.reduce((s, x) => s + x.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true); ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, cSize, true); ev.setUint32(16, cStart, true);
  const total = offset + cSize + eocd.length;
  const out = new Uint8Array(total); let p = 0;
  for (const x of locals) { out.set(x, p); p += x.length; }
  for (const x of centrals) { out.set(x, p); p += x.length; }
  out.set(eocd, p); return out;
}

async function uploadOnce(label, marker) {
  const manifest = { id: manifestId, name: manifestId, entry: { ui: 'index.html', worker: 'room.worker.js' } };
  const files = {
    'parti.room.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    'index.html': new TextEncoder().encode(`<html><body>${marker}</body></html>`),
    'room.worker.js': new TextEncoder().encode(`// ${marker}`),
  };
  const zip = buildZip(files);
  const pres = await (await fetch(`${BACKEND}/api/upload/presign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, templateId: manifestId, fileName: 'x.zip', contentType: 'application/zip' }),
  })).json();
  const put = await fetch(pres.url, { method: 'PUT', body: zip, headers: { 'Content-Type': 'application/zip' } });
  console.log(`[${label}] PUT status=${put.status} key=${pres.key} zipBytes=${zip.length}`);
  return { pres, zip };
}

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9000', region: 'us-east-1',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
  forcePathStyle: true,
});

async function readFromMinio(key, label) {
  const got = await s3.send(new GetObjectCommand({ Bucket: 'game', Key: key }));
  const chunks = [];
  for await (const c of got.Body) chunks.push(c);
  const body = Buffer.concat(chunks);
  console.log(`[${label}] GET ${key} bytes=${body.length} sha256=${createHash('sha256').update(body).digest('hex')}`);
  return body;
}

// 清理（如果上次跑过）
try { await s3.send(new HeadObjectCommand({ Bucket: 'game', Key: `game/${userId}/${manifestId}.zip` })); } catch {}
async function del(k) { try { await fetch(`${BACKEND}/api/upload/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, key: k }) }); } catch {} }
await del(`game/${userId}/${manifestId}.zip`);

// 第一次上传
const r1 = await uploadOnce('1st', 'VERSION-A');
const body1 = await readFromMinio(r1.pres.key, 'after-1st');

// 第二次上传（同一 manifestId）—— key 应当一致，内容应当被替换
const r2 = await uploadOnce('2nd', 'VERSION-B');
if (r1.pres.key !== r2.pres.key) {
  console.log(`❌ key 不一致: ${r1.pres.key} vs ${r2.pres.key}`);
  process.exit(1);
}
const body2 = await readFromMinio(r2.pres.key, 'after-2nd');

if (body1.equals(body2)) {
  console.log('❌ 字节内容一样，肯定没覆盖');
  process.exit(1);
}
console.log('✓ 字节内容 sha256 变化，确认覆盖成功（key 一致、内容被替换）');

// 清理
await del(`game/${userId}/${manifestId}.zip`);
console.log('cleaned up');
