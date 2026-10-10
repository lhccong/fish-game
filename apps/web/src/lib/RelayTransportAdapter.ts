import type {
  ClientTransportSession, CreateHostOptions, HostTransportSession, JoinRoomOptions,
  TransportAdapter, TransportMessage,
} from '@parti/core';
import { createUuid } from './ids';

type Frame = {
  type: 'ready' | 'join' | 'leave' | 'message';
  selfId: string;
  hostId: string;
  peerId: string;
  sender: string;
  message: TransportMessage;
};
const MAX_BUFFER = 64 * 1024 * 1024;

function connect(registration: object): Promise<{ socket: WebSocket; ready: Frame }> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/relay', location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    const timer = setTimeout(() => fail('Relay connection timed out'), 15_000);
    const fail = (reason: string) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(reason));
    };
    socket.onopen = () => socket.send(JSON.stringify(registration));
    socket.onerror = () => fail('Relay connection failed');
    socket.onclose = event => fail(event.reason || 'Relay disconnected');
    socket.onmessage = event => {
      try {
        const ready = JSON.parse(event.data) as Frame;
        if (ready.type !== 'ready') return;
        clearTimeout(timer);
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        resolve({ socket, ready });
      } catch { fail('Invalid relay response'); }
    };
  });
}

function send(socket: WebSocket, frame: object): void {
  const text = JSON.stringify(frame);
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount + new TextEncoder().encode(text).length > MAX_BUFFER) {
    socket.close(1008, 'Relay send buffer full');
    return;
  }
  socket.send(text);
}

export class RelayTransportAdapter implements TransportAdapter {
  readonly name = 'relay';

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const key = `parti:relay-host:${options.roomId}`;
    let secret = sessionStorage.getItem(key);
    if (!secret) {
      secret = `${createUuid()}${createUuid()}`.replaceAll('-', '');
      sessionStorage.setItem(key, secret);
    }
    const registration = { type: 'host', roomId: options.roomId, secret };
    const initial = await connect(registration);
    let socket = initial.socket;
    const ready = initial.ready;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const peers = new Set<string>();
    let onConnection: (peer: { id: string }) => void = () => {};
    let onMessage: (id: string, message: TransportMessage) => void = () => {};
    let onDisconnect: (id: string, reason?: string) => void = () => {};
    const reconnect = () => {
      if (disposed) return;
      retry = setTimeout(async () => {
        try {
          const next = await connect(registration);
          if (disposed) { next.socket.close(); return; }
          socket = next.socket;
          attempt = 0;
          bind();
        } catch { reconnect(); }
      }, Math.min(500 * 2 ** Math.min(attempt++, 5), 10_000));
    };
    const bind = () => {
      socket.onmessage = event => {
        const frame = JSON.parse(event.data) as Frame;
        if (frame.type === 'join') { peers.add(frame.peerId); onConnection({ id: frame.peerId }); }
        if (frame.type === 'leave') { peers.delete(frame.peerId); onDisconnect(frame.peerId, 'closed'); }
        if (frame.type === 'message') onMessage(frame.sender, frame.message);
      };
      socket.onclose = event => {
        for (const id of peers) onDisconnect(id, event.reason || 'Relay disconnected');
        peers.clear();
        // A replaced host must not compete with the new tab for the same registration.
        if (event.reason !== 'Host replaced') reconnect();
      };
      socket.onerror = () => socket.close();
    };
    bind();
    return {
      selfId: ready.selfId,
      connectionInfo: ready.hostId,
      send: (target, message) => send(socket, { type: 'message', target, message }),
      broadcast: (message, config) => {
        for (const target of peers) {
          if (!config?.except?.includes(target)) send(socket, { type: 'message', target, message });
        }
      },
      onConnection: handler => {
        onConnection = handler;
        for (const id of peers) handler({ id });
      },
      onMessage: handler => { onMessage = handler; },
      onDisconnect: handler => { onDisconnect = handler; },
      close: () => {
        disposed = true;
        clearTimeout(retry);
        socket.close();
      },
    };
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const { socket, ready } = await connect({ type: 'join', roomId: options.roomId, hostId: options.hostConnectionInfo });
    let onMessage: (message: TransportMessage) => void = () => {};
    let onDisconnect: (reason?: string) => void = () => {};
    socket.onmessage = event => {
      const frame = JSON.parse(event.data) as Frame;
      if (frame.type === 'message' && frame.sender === ready.hostId) onMessage(frame.message);
    };
    socket.onclose = event => onDisconnect(event.reason || 'Relay disconnected');
    socket.onerror = () => socket.close();
    return {
      selfId: ready.selfId,
      hostId: ready.hostId,
      send: message => send(socket, { type: 'message', message }),
      onMessage: handler => { onMessage = handler; },
      onDisconnect: handler => { onDisconnect = handler; },
      close: () => socket.close(),
    };
  }
}
