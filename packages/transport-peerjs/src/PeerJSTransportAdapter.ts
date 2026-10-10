/**
 * PeerJSTransportAdapter (GOAL.md §7.3) —— 用 PeerJS / WebRTC 承载 RoomMessage。
 *
 * 适合 MVP：减少服务端负担（仅用公共 PeerServer 做信令）。host 的 peer id 即邀请码。
 * PeerJS 细节（DataConnection 等）不暴露给创作者，只实现统一 Transport 接口。
 */
import Peer, { type DataConnection } from 'peerjs';
import type {
  ClientTransportSession,
  CreateHostOptions,
  HostTransportSession,
  JoinRoomOptions,
  PeerId,
  TransportAdapter,
  TransportMessage,
  TransportPeer,
} from '@parti/core';

export interface PeerJSAdapterOptions {
  /** 透传给 PeerJS Peer 的配置（如自建 PeerServer host/port）。 */
  peerOptions?: Record<string, unknown>;
  onJoinStage?: (stage: 'signaling' | 'dataChannel') => void;
}

const SIGNAL_TIMEOUT_MS = 20_000;
const DATA_CHANNEL_TIMEOUT_MS = 30_000;

function connectionError(
  stage: 'SIGNAL' | 'DATA',
  reason: string,
  conn?: DataConnection,
): Error {
  const pc = conn?.peerConnection;
  const states = pc
    ? ` ICE=${pc.iceConnectionState}; gathering=${pc.iceGatheringState}; connection=${pc.connectionState}; signaling=${pc.signalingState}.`
    : '';
  return new Error(`[PEER_${stage}_${reason}]${states}`);
}

function waitForOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onError);
      peer.off('close', onClose);
      peer.off('disconnected', onDisconnected);
    };
    const onOpen = (id: string) => { cleanup(); resolve(id); };
    const onError = (err: Error & { type?: string }) => {
      cleanup();
      reject(Object.assign(connectionError('SIGNAL', 'ERROR'), { type: err.type, cause: err }));
    };
    const onClose = () => { cleanup(); reject(connectionError('SIGNAL', 'CLOSED')); };
    const onDisconnected = () => { cleanup(); reject(connectionError('SIGNAL', 'DISCONNECTED')); };
    const timer = setTimeout(() => {
      cleanup();
      reject(connectionError('SIGNAL', 'TIMEOUT'));
    }, SIGNAL_TIMEOUT_MS);
    peer.on('open', onOpen);
    peer.on('error', onError);
    peer.on('close', onClose);
    peer.on('disconnected', onDisconnected);
  });
}

function waitForDataChannel(peer: Peer, conn: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      conn.off('open', onOpen);
      conn.off('error', onError);
      conn.off('close', onClose);
      conn.off('iceStateChanged', onIceState);
      peer.off('error', onError);
      peer.off('close', onClose);
      peer.off('disconnected', onDisconnected);
    };
    const fail = (reason: string, cause?: Error) => {
      const error = connectionError('DATA', reason, conn);
      cleanup();
      reject(Object.assign(error, { cause }));
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (err: Error & { type?: string }) => {
      fail(err.type === 'peer-unavailable' ? 'HOST_UNAVAILABLE' : 'ERROR', err);
    };
    const onClose = () => fail('CLOSED');
    const onDisconnected = () => fail('SIGNAL_DISCONNECTED');
    const onIceState = (state: RTCIceConnectionState) => {
      if (state === 'failed') fail('ICE_FAILED');
      else if (state === 'closed') fail('CLOSED');
    };
    const timer = setTimeout(() => fail('TIMEOUT'), DATA_CHANNEL_TIMEOUT_MS);
    conn.on('open', onOpen);
    conn.on('error', onError);
    conn.on('close', onClose);
    conn.on('iceStateChanged', onIceState);
    peer.on('error', onError);
    peer.on('close', onClose);
    peer.on('disconnected', onDisconnected);
    if (conn.open) onOpen();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 用稳定 hostId 创建 host peer，处理「刷新瞬间旧 peer 未释放」导致的
 * unavailable-id：退避重试若干次；仍失败则回退到随机 id（邀请链接随之更新）。
 * 这是房主刷新后复用邀请码的关键 (GOAL §17 Phase 4)。
 */
async function openHostPeer(
  requestedId: string | undefined,
  peerOptions: Record<string, unknown> | undefined,
  retries = 3,
): Promise<Peer> {
  let id = requestedId;
  for (let attempt = 0; ; attempt += 1) {
    const peer = id ? new Peer(id, peerOptions) : new Peer(peerOptions ?? {});
    try {
      await waitForOpen(peer);
      return peer;
    } catch (err) {
      peer.destroy();
      const type = (err as { type?: string } | undefined)?.type;
      if (id && type === 'unavailable-id') {
        if (attempt < retries) {
          await delay(300 * 2 ** attempt);
          continue;
        }
        // 重试耗尽：放弃稳定 id，回退随机 id。
        id = undefined;
        continue;
      }
      throw err;
    }
  }
}

export class PeerJSTransportAdapter implements TransportAdapter {
  readonly name = 'peerjs';
  private readonly opts: PeerJSAdapterOptions;

  constructor(opts: PeerJSAdapterOptions = {}) {
    this.opts = opts;
  }

  async createHost(options: CreateHostOptions): Promise<HostTransportSession> {
    const peer = await openHostPeer(options.hostId, this.opts.peerOptions);
    const selfId = peer.id;

    const conns = new Map<PeerId, DataConnection>();
    let connectionHandler: ((peer: TransportPeer) => void) | undefined;
    let messageHandler:
      | ((peerId: PeerId, message: TransportMessage) => void)
      | undefined;
    let disconnectHandler:
      | ((peerId: PeerId, reason?: string) => void)
      | undefined;

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.set(conn.peer, conn);
        connectionHandler?.({ id: conn.peer });
      });
      conn.on('data', (data) => {
        messageHandler?.(conn.peer, toTransportMessage(data));
      });
      conn.on('close', () => {
        conns.delete(conn.peer);
        disconnectHandler?.(conn.peer, 'closed');
      });
      conn.on('error', () => {
        conns.delete(conn.peer);
        disconnectHandler?.(conn.peer, 'error');
      });
    });

    return {
      selfId,
      connectionInfo: selfId,
      send: (peerId, message) => conns.get(peerId)?.send(message.data),
      broadcast: (message, opts) => {
        const except = opts?.except ?? [];
        for (const [peerId, conn] of conns) {
          if (except.includes(peerId)) continue;
          conn.send(message.data);
        }
      },
      onConnection: (handler) => {
        connectionHandler = handler;
      },
      onMessage: (handler) => {
        messageHandler = handler;
      },
      onDisconnect: (handler) => {
        disconnectHandler = handler;
      },
      close: () => {
        for (const conn of conns.values()) conn.close();
        conns.clear();
        peer.destroy();
      },
    };
  }

  async joinRoom(options: JoinRoomOptions): Promise<ClientTransportSession> {
    const peer = options.selfId
      ? new Peer(options.selfId, this.opts.peerOptions)
      : new Peer(this.opts.peerOptions ?? {});
    let selfId: string;
    let conn: DataConnection;
    try {
      this.opts.onJoinStage?.('signaling');
      selfId = await waitForOpen(peer);
      this.opts.onJoinStage?.('dataChannel');
      conn = peer.connect(options.hostConnectionInfo, { reliable: true });
      await waitForDataChannel(peer, conn);
    } catch (error) {
      peer.destroy();
      throw error;
    }

    let messageHandler: ((message: TransportMessage) => void) | undefined;
    let disconnectHandler: ((reason?: string) => void) | undefined;

    conn.on('data', (data) => messageHandler?.(toTransportMessage(data)));
    conn.on('close', () => disconnectHandler?.('closed'));
    conn.on('error', () => disconnectHandler?.('error'));

    return {
      selfId,
      hostId: options.hostConnectionInfo,
      send: (message) => conn.send(message.data),
      onMessage: (handler) => {
        messageHandler = handler;
      },
      onDisconnect: (handler) => {
        disconnectHandler = handler;
      },
      close: () => {
        conn.close();
        peer.destroy();
      },
    };
  }
}

function toTransportMessage(data: unknown): TransportMessage {
  // PeerJS 已完成（反）序列化，data 即原始 RoomMessage 对象。
  return { data: data as object, meta: { reliable: true, ordered: true } };
}
