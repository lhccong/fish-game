import { describe, expect, it } from 'vitest';
import { createPackage, encodeText } from '@parti/room-packager';
import { validateDownloadedRoomPackage, validateMarketPackageSource } from './marketPackage';

const source = { owner: 'alice', repo: 'game-a', commit: 'a'.repeat(40), packageDir: 'dist/game' };
const manifest = {
  partiVersion: '0.1.0',
  protocolVersion: 1,
  id: 'market-game',
  name: 'Market game',
  version: '1.0.0',
  packageMode: 'blob',
  entry: { ui: 'index.html', worker: 'room.worker.js' },
};
const files = { 'index.html': encodeText('<html></html>'), 'room.worker.js': encodeText('export default {};') };

describe('market package source validation', () => {
  it('accepts a fixed commit and a root or nested package directory', () => {
    expect(validateMarketPackageSource(source)).toEqual(source);
    expect(validateMarketPackageSource({ ...source, packageDir: '.' }).packageDir).toBe('.');
  });

  it.each([
    { commit: 'main' },
    { commit: 'v1.0.0' },
    { commit: 'abc1234' },
    { owner: '../alice' },
    { repo: 'game@main' },
    { owner: 'https://example.com' },
    { packageDir: '../dist' },
    { packageDir: '/dist' },
    { packageDir: 'dist%2Fgame' },
    { packageDir: 'dist?other' },
  ])('rejects mutable or unsafe source fields: %j', patch => {
    expect(() => validateMarketPackageSource({ ...source, ...patch })).toThrow();
  });
});

describe('downloaded room package validation', () => {
  it('uses the room manifest ID when checking unchanged market files', async () => {
    const market = await createPackage({ manifest, files });
    const room = await createPackage({ manifest: { ...manifest, id: 'room-123' }, files });
    const joined = await validateDownloadedRoomPackage(market, room.manifest, 'room-123', room.packageHash);
    expect(joined.packageHash).toBe(room.packageHash);
    expect(joined.manifest.id).toBe('room-123');
  });

  it('rejects changed files even when version labels are the same', async () => {
    const room = await createPackage({ manifest, files });
    const changed = await createPackage({ manifest, files: { ...files, 'room.worker.js': encodeText('changed') } });
    await expect(validateDownloadedRoomPackage(changed, room.manifest, room.manifest.id, room.packageHash)).rejects.toThrow();
  });

  it('rejects a different room ID or hash', async () => {
    const room = await createPackage({ manifest, files });
    await expect(validateDownloadedRoomPackage(room, room.manifest, 'wrong-room', room.packageHash)).rejects.toThrow();
    await expect(validateDownloadedRoomPackage(room, room.manifest, room.manifest.id, '0'.repeat(64))).rejects.toThrow();
  });
});
