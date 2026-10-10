import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

const PATH = '/api/relay';
const MAX_BYTES = 32 * 1024 * 1024;
type Room = { roomId: string; host: WebSocket; peers: Map<string, WebSocket> };

/** Star topology: only the host can address players; players can only address the host. */
export function attachRelay(server: Server): () => void {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const send = (ws: WebSocket, frame: object) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(frame);
    if (ws.bufferedAmount + Buffer.byteLength(text) > MAX_BYTES * 2) {
      ws.terminate();
      return;
    }
    ws.send(text);
  };
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== PATH) return;
    const origin = req.headers.origin;
    // No wildcard browser access: default to the request's own host.
    let originAllowed = false;
    try {
      originAllowed = Boolean(origin && (allowedOrigins.length
        ? allowedOrigins.includes(origin)
        : new URL(origin).host === req.headers.host));
    } catch { /* Invalid origins are rejected. */ }
    if (!originAllowed || wss.clients.size >= 2048) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    let room: Room | undefined;
    let hostId = '';
    let selfId = '';
    let isHost = false;
    let count = 0;
    let bytes = 0;
    let windowStart = Date.now();
    const timer = setTimeout(() => ws.close(1008, 'Registration timeout'), 10_000);
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      try {
        if (Date.now() - windowStart > 1000) { count = 0; bytes = 0; windowStart = Date.now(); }
        bytes += Buffer.byteLength(raw.toString());
        if (binary || ++count > 1000 || bytes > MAX_BYTES * 2) throw new Error('Relay limit exceeded');
        let frame;
        try { frame = JSON.parse(raw.toString()); }
        catch { throw new Error('Invalid relay JSON'); }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Invalid relay frame');
        if (!room) {
          if (typeof frame.roomId !== 'string' || !frame.roomId || frame.roomId.length > 128) throw new Error('Invalid room');
          isHost = frame.type === 'host';
          if (isHost) {
            // Public host IDs are derived from an unshared secret, so invitees cannot reclaim a host.
            if (typeof frame.secret !== 'string' || !/^[a-f0-9]{64}$/.test(frame.secret)) throw new Error('Invalid host secret');
            hostId = createHash('sha256').update(frame.secret).digest('hex');
            const previous = rooms.get(hostId);
            if (previous && previous.roomId !== frame.roomId) throw new Error('Invalid host room');
            if (previous) {
              for (const peer of previous.peers.values()) peer.close(1012, 'Host reconnecting');
              previous.host.close(1012, 'Host replaced');
            }
            selfId = hostId;
            room = { roomId: frame.roomId, host: ws, peers: new Map() };
            rooms.set(hostId, room);
          } else {
            if (frame.type !== 'join' || typeof frame.hostId !== 'string') throw new Error('Invalid registration');
            hostId = frame.hostId;
            const target = rooms.get(hostId);
            if (!target || target.roomId !== frame.roomId || target.host.readyState !== WebSocket.OPEN) throw new Error('Host unavailable');
            if (target.peers.size >= 64) throw new Error('Relay room full');
            selfId = randomUUID();
            room = target;
            room.peers.set(selfId, ws);
            send(room.host, { type: 'join', peerId: selfId });
          }
          clearTimeout(timer);
          send(ws, { type: 'ready', selfId, hostId });
          return;
        }
        if (frame.type !== 'message' || !frame.message || typeof frame.message !== 'object') throw new Error('Invalid message');
        if (isHost) {
          if (rooms.get(hostId) !== room) throw new Error('Host replaced');
          const peer = room.peers.get(frame.target);
          if (peer) send(peer, { type: 'message', sender: selfId, message: frame.message });
        } else {
          send(room.host, { type: 'message', sender: selfId, message: frame.message });
        }
      } catch (error) {
        ws.close(1008, error instanceof Error ? error.message.slice(0, 100) : 'Invalid relay frame');
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      alive.delete(ws);
      if (!room) return;
      if (isHost) {
        if (rooms.get(hostId) !== room) return;
        rooms.delete(hostId);
        for (const peer of room.peers.values()) peer.close(1012, 'Host disconnected');
      } else {
        room.peers.delete(selfId);
        send(room.host, { type: 'leave', peerId: selfId });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.delete(ws)) ws.terminate();
      else ws.ping();
    }
  }, 15_000);
  heartbeat.unref();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
  server.once('close', close);
  return close;
}
