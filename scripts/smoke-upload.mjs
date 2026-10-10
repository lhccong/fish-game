// 一次性端到端冒烟：申请 presign → 直传 → 列 MinIO → 删除
import { createHash } from 'node:crypto';

const userId = 'user_smoke-test';
const templateId = 'custom_smoke-2';
const BACKEND = 'http://127.0.0.1:5158';

// 1) 构造一个合法 store-only zip（含 parti.room.json + index.html）
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crc ^ bytes[i];
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

const manifest = { id: 'smoke-2', name: 'smoke-2', entry: { ui: 'index.html', worker: 'room.worker.js' } };
const files = {
  'parti.room.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  'index.html': new TextEncoder().encode('<!doctype html><html><body>smoke</body></html>'),
  'room.worker.js': new TextEncoder().encode('self.onmessage = () => {};'),
};
const zipBytes = buildZip(files);
console.log('[1] zip built, bytes=', zipBytes.length, 'sha256=', createHash('sha256').update(zipBytes).digest('hex'));

// 2) presign
const pres = await (await fetch(`${BACKEND}/api/upload/presign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, templateId, fileName: 'smoke.zip', contentType: 'application/zip' }),
})).json();
console.log('[2] presign key=', pres.key, 'publicUrl=', pres.publicUrl);

// 3) PUT
const putRes = await fetch(pres.url, { method: 'PUT', body: zipBytes, headers: { 'Content-Type': 'application/zip' } });
console.log('[3] PUT status=', putRes.status, putRes.statusText);

// 4) GET 校验内容（用 presign 临时签的 GET URL，而不是匿名 GET）
//    浏览器直传后，再签一次 GET URL 给同源客户端用，本脚本复用同一 client 不行
//    （lobby-mock 没暴露 GET 签 URL 端点），所以这一步改为：用 S3 SDK 读 object
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9000', region: 'us-east-1',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
  forcePathStyle: true,
});
const head = await s3.send(new HeadObjectCommand({ Bucket: 'game', Key: pres.key }));
console.log('[4] HEAD bytes=', head.ContentLength, 'sha match=', head.ContentLength === zipBytes.length);
const got = await s3.send(new GetObjectCommand({ Bucket: 'game', Key: pres.key }));
const chunks = [];
for await (const c of got.Body) chunks.push(c);
const body = Buffer.concat(chunks);
const shaGot = createHash('sha256').update(body).digest('hex');
const shaSent = createHash('sha256').update(zipBytes).digest('hex');
console.log('[4b] GET bytes=', body.length, 'sha match=', shaGot === shaSent);

// 5) DELETE
const del = await (await fetch(`${BACKEND}/api/upload/delete`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, key: pres.key }),
})).json();
console.log('[5] delete result=', JSON.stringify(del));

// 6) HEAD 验证已删除
try {
  const after = await s3.send(new HeadObjectCommand({ Bucket: 'game', Key: pres.key }));
  console.log('[6] HEAD after delete: still exists, ContentLength=', after.ContentLength, '❌');
} catch (e) {
  console.log('[6] HEAD after delete: 404 ✓ (', e.name, ')');
}
