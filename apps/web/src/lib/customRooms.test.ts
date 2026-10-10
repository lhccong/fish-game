import { describe, expect, it } from 'vitest';
import { validateCustomRemote } from './customRemote';

describe('validateCustomRemote', () => {
  it('accepts a well-formed MinIO key whose userId segment matches hostUserId', () => {
    const value = {
      uploadBackend: '/api/upload/get',
      hostUserId: 'user_123',
      key: 'game/user_123/custom_abc.zip',
    };
    expect(validateCustomRemote(value)).toEqual(value);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'string', value: 'game/user_123/custom_abc.zip' },
    { name: 'array', value: [] },
    { name: 'missing uploadBackend', value: { hostUserId: 'u', key: 'game/u/t.zip' } },
    { name: 'unknown uploadBackend', value: { uploadBackend: '/api/upload/raw', hostUserId: 'u', key: 'game/u/t.zip' } },
    { name: 'missing hostUserId', value: { uploadBackend: '/api/upload/get', key: 'game/u/t.zip' } },
    { name: 'anonymous hostUserId', value: { uploadBackend: '/api/upload/get', hostUserId: 'anon', key: 'game/anon/t.zip' } },
    { name: 'illegal hostUserId char', value: { uploadBackend: '/api/upload/get', hostUserId: 'user/with/slash', key: 'game/u/t.zip' } },
    { name: 'overlong hostUserId', value: { uploadBackend: '/api/upload/get', hostUserId: 'a'.repeat(200), key: 'game/a/t.zip' } },
    { name: 'non-string key', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: 123 } },
    { name: 'empty key', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: '' } },
    { name: 'overlong key', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: `game/u/${'a'.repeat(600)}.zip` } },
    // 必须有 game/<userId>/<templateId>.zip 形式 —— 防止 joiner 侧盲目转发
    // host 给的任何字符串，让 lobby-mock 在签 URL 前先做一次 key 校验。
    { name: 'wrong prefix', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: 'templates/u/t.zip' } },
    { name: 'missing zip suffix', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: 'game/u/t' } },
    { name: 'path traversal', value: { uploadBackend: '/api/upload/get', hostUserId: 'u', key: 'game/u/../oops.zip' } },
    // key 第一段路径必须等于 hostUserId —— 防 host 把别的用户的 remoteKey
    // 误传出来，让 joiner 端先一步拦下。
    { name: 'key userId segment does not match hostUserId', value: { uploadBackend: '/api/upload/get', hostUserId: 'alice', key: 'game/bob/t.zip' } },
  ])('rejects $name', ({ value }) => {
    expect(() => validateCustomRemote(value)).toThrow();
  });
});
