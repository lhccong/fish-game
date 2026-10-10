import { createPackage, normalizePackagePath, type RoomPackage } from '@parti/room-packager';
import { GitHubSourceClient } from '@parti/room-source';

export interface MarketPackageSource {
  owner: string;
  repo: string;
  commit: string;
  packageDir: string;
}

export function validateMarketPackageSource(value: unknown): MarketPackageSource {
  if (!value || typeof value !== 'object') throw new Error('Invalid market package source');
  const source = value as Partial<MarketPackageSource>;
  const validName = (name: unknown): name is string =>
    typeof name === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(name);
  if (!validName(source.owner) || !validName(source.repo) ||
      typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit) ||
      typeof source.packageDir !== 'string' || source.packageDir.length > 1024) {
    throw new Error('Invalid market package source');
  }
  if (source.packageDir !== '.') normalizePackagePath(source.packageDir);
  return { owner: source.owner, repo: source.repo, commit: source.commit, packageDir: source.packageDir };
}

export async function loadMarketPackage(value: unknown): Promise<RoomPackage> {
  const source = validateMarketPackageSource(value);
  const resolved = await new GitHubSourceClient().resolveRepository({
    owner: source.owner,
    repo: source.repo,
    ref: source.commit,
    scope: source.packageDir,
    explicitRef: true,
  });
  if (resolved.candidate.packageDir !== source.packageDir) {
    throw new Error('Market package directory mismatch');
  }
  return createPackage(resolved.input);
}

export async function validateDownloadedRoomPackage(
  source: RoomPackage,
  manifest: unknown,
  roomId: string,
  packageHash: string,
): Promise<RoomPackage> {
  // Installed templates and room snapshots replace the manifest ID, but keep the source files.
  const pkg = await createPackage({ manifest, files: source.files });
  if (pkg.manifest.id !== roomId || pkg.packageHash !== packageHash) {
    throw new Error('Downloaded package differs from the host package. Reinstall the game and create a new room.');
  }
  return pkg;
}
