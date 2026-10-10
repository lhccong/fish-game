import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAN_ID, BUILTIN_PEERJS_ID, BUILTIN_RELAY_ID, deleteCustomTransportProfile,
  getLanDiscoveryConfig, getSelectedTransportProfile, getTransportProfiles, peerOptionsFromServerUrl,
  saveCustomTransportProfile, selectTransportProfile, validateTransportConfig,
  resolveHostTransport, resolveJoinTransport,
} from './transportConfig';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('transport profiles', () => {
  it('forces relay for all new rooms and rejects non-relay invitations', () => {
    expect(resolveHostTransport(true, { adapter: 'peerjs' })).toEqual({ adapter: 'relay' });
    expect(resolveHostTransport(false, { adapter: 'peerjs' })).toEqual({ adapter: 'relay' });
    expect(resolveHostTransport(false, { adapter: 'lan' })).toEqual({ adapter: 'relay' });
    expect(resolveJoinTransport('relay:host', { adapter: 'peerjs' })).toEqual({ adapter: 'relay' });
    expect(resolveJoinTransport('host')).toEqual({ adapter: 'relay' });
    expect(() => resolveJoinTransport('host', { adapter: 'peerjs' })).toThrow('Only WebSocket');
    expect(() => resolveJoinTransport('host', { adapter: 'lan' })).toThrow('Only WebSocket');
  });
  it('only offers server relay', () => {
    const storage = new MemoryStorage();
    expect(getTransportProfiles(storage).map((profile) => profile.id)).toEqual([BUILTIN_RELAY_ID]);
    expect(() => selectTransportProfile(BUILTIN_PEERJS_ID, storage)).toThrow();
    expect(() => selectTransportProfile(BUILTIN_LAN_ID, storage)).toThrow();
    expect(getSelectedTransportProfile(storage).id).toBe(BUILTIN_RELAY_ID);
  });

  it('does not expose or select stored custom profiles', () => {
    const storage = new MemoryStorage();
    const created = saveCustomTransportProfile({
      name: ' My Peer ', config: { adapter: 'peerjs', serverUrl: 'https://peer.example.com/peerjs/' },
    }, undefined, storage);
    expect(created.name).toBe('My Peer');
    expect(getSelectedTransportProfile(storage).id).toBe(BUILTIN_RELAY_ID);
    saveCustomTransportProfile({
      name: 'My Supabase', config: { adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'anon-key' },
    }, created.id, storage);
    expect(() => selectTransportProfile(created.id, storage)).toThrow();
    expect(getTransportProfiles(storage).map((profile) => profile.id)).toEqual([BUILTIN_RELAY_ID]);
    deleteCustomTransportProfile(created.id, storage);
    expect(getSelectedTransportProfile(storage).id).toBe(BUILTIN_RELAY_ID);
  });

  it.each([
    ['legacy common preference', 'parti:transport-preference', 'common'],
    ['removed built-in Supabase profile', 'parti:transport-profile:selected:v1', 'builtin:supabase'],
    ['PeerJS preference', 'parti:transport-profile:selected:v1', BUILTIN_PEERJS_ID],
    ['LAN preference', 'parti:transport-profile:selected:v1', BUILTIN_LAN_ID],
  ])('falls back to server relay for %s', (_label, key, value) => {
    const storage = new MemoryStorage();
    storage.setItem(key, value);
    expect(getSelectedTransportProfile(storage).id).toBe(BUILTIN_RELAY_ID);
    expect(storage.getItem('parti:transport-profile:selected:v1')).toBe(BUILTIN_RELAY_ID);
  });

  it('parses stored service URLs and rejects unsafe services', () => {
    expect(peerOptionsFromServerUrl('https://peer.example.com:9443/peerjs/')).toEqual({
      host: 'peer.example.com', port: 9443, path: '/peerjs', secure: true,
    });
    expect(() => validateTransportConfig({ adapter: 'peerjs', serverUrl: 'http://evil.test' })).toThrow();
    expect(() => validateTransportConfig({
      adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'sb_secret_nope',
    })).toThrow();
    expect(() => validateTransportConfig({
      adapter: 'common', provider: 'supabase', url: 'https://project.supabase.co', publishableKey: 'service_role_nope',
    })).toThrow();
    expect(validateTransportConfig({ adapter: 'lan', serverUrl: 'wss://signal.example.com/v1/ws' })).toEqual({
      adapter: 'lan', serverUrl: 'wss://signal.example.com/v1/ws',
    });
    expect(() => validateTransportConfig({ adapter: 'lan', serverUrl: 'ws://signal.example.com/v1/ws' })).toThrow();
  });

  it('keeps the most recently selected LAN profile for lobby discovery', () => {
    const storage = new MemoryStorage();
    expect(getLanDiscoveryConfig(storage)).toEqual({ adapter: 'lan' });
    const custom = saveCustomTransportProfile({
      name: 'Office LAN', config: { adapter: 'lan', serverUrl: 'wss://office.example.com/v1/ws' },
    }, undefined, storage);
    selectTransportProfile(BUILTIN_RELAY_ID, storage);
    expect(getLanDiscoveryConfig(storage)).toEqual(custom.config);
    deleteCustomTransportProfile(custom.id, storage);
    expect(getLanDiscoveryConfig(storage)).toEqual({ adapter: 'lan' });
  });
});
