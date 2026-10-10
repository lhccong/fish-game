// 验证 userId 校验：anon 应被拒，真实 id 应通过。
const BACKEND = 'http://127.0.0.1:5158';

async function presign(userId) {
  const r = await fetch(`${BACKEND}/api/upload/presign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, templateId: 'custom_demo', fileName: 'x.zip' }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const a = await presign('anon');
console.log('[anon ] status=', a.status, 'body=', JSON.stringify(a.body));

const b = await presign('12345');  // 摸鱼岛 id 示例（数字字符串）
console.log('[12345] status=', b.status, 'body=', JSON.stringify({ url: b.body.url, key: b.body.key }));

const c = await presign('user_xxx');  // 老 LocalUser 风格字符串
console.log('[u_xxx] status=', c.status, 'body=', JSON.stringify({ url: c.body.url, key: c.body.key }));

const d = await presign('admin@fish');  // 含 @，应被拒
console.log('[bad  ] status=', d.status, 'body=', JSON.stringify(d.body));

// 验证 delete 也走相同检查
async function del(userId, key) {
  const r = await fetch(`${BACKEND}/api/upload/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, key }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const e = await del('anon', `game/12345/custom_demo.zip`);
console.log('[del anon] status=', e.status, 'body=', JSON.stringify(e.body));

// 检查
let failed = 0;
if (a.status !== 401 || a.body.error?.code !== 'UNAUTHENTICATED') { console.log('❌ anon 应 401 UNAUTHENTICATED'); failed++; }
else console.log('✓ anon 被拒');
if (b.status !== 200) { console.log('❌ 12345 应 200'); failed++; } else console.log('✓ 12345 通过');
if (c.status !== 200) { console.log('❌ user_xxx 应 200'); failed++; } else console.log('✓ user_xxx 通过');
if (d.status !== 422) { console.log('❌ admin@fish 应 422'); failed++; } else console.log('✓ 非法字符被拒');
if (e.status !== 401) { console.log('❌ delete anon 应 401'); failed++; } else console.log('✓ delete anon 被拒');

process.exit(failed === 0 ? 0 : 1);
