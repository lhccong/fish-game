/** Room Package 两阶段存储。内置模板不进入此数据库。 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RoomManifest } from '@parti/room-packager';
import type { MarketPackageSource } from './marketPackage';

export type PackageSourceInfo =
  | { type: 'zip'; ref?: string }
  | { type: 'github'; ref?: string }
  | { type: 'market'; ref?: string; download?: MarketPackageSource }
  | { type: 'editor'; basedOn?: string }
  | { type: 'builtin'; id: string }
  | { type: 'custom'; id: string };

export interface CustomPackageRecord {
  id: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
  source: Exclude<PackageSourceInfo, { type: 'builtin' } | { type: 'custom' }>;
  createdAt: number;
  /** 浏览器上传到 MinIO 的对象 key；删除本地模板时同步删除。 */
  remoteKey?: string;
  /**
   * lobby-mock 在 presign 阶段根据 MINIO_PUBLIC_BASE 拼出来的直链，joiner 拿
   * 这个 fetch MinIO 拿 zip。不带签名、长期有效；访问控制交给 MinIO bucket
   * 策略 + P2P 准入。
   */
  remotePublicUrl?: string;
}

export interface RoomSnapshotRecord {
  id: string;
  manifest: RoomManifest;
  files: Record<string, Uint8Array>;
  packageHash: string;
  source: PackageSourceInfo;
  marketPackage?: MarketPackageSource;
  target: 'local' | 'peer';
  createdAt: number;
}

export interface UsageRecord {
  id: string;
  count: number;
}

interface RoomPackageDB extends DBSchema {
  customPackages: { key: string; value: CustomPackageRecord };
  roomSnapshots: { key: string; value: RoomSnapshotRecord };
  usage: { key: string; value: UsageRecord };
}

export const ROOM_PACKAGE_DB_NAME = 'parti-room-packages-v1';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<RoomPackageDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<RoomPackageDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RoomPackageDB>(ROOM_PACKAGE_DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('customPackages', { keyPath: 'id' });
        db.createObjectStore('roomSnapshots', { keyPath: 'id' });
        db.createObjectStore('usage', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}
