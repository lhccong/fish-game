/** 玩家模型与玩家管理 (GOAL.md §4, §15) */
import type { WelcomePlayer } from './protocol/messages';
import type { PlayerRole, PlayerStatus } from './protocol/messages';
import type { PeerId } from './transport/types';

export type { PlayerRole, PlayerStatus };

export interface Player {
  id: string;
  /** 底层 transport peer id（host 自身的本地玩家可与 selfId 一致）。 */
  peerId: PeerId;
  /** 稳定客户端身份 id（跨刷新/掉线），用于重连时复用 playerId。 */
  clientId?: string;
  name: string;
  role: PlayerRole;
  status: PlayerStatus;
  /**
   * 玩家离线时是否处于"游戏中宽限期"。
   * - true：处于 bidding/playing 阶段掉线，保留 30s 宽限以等待重连，期间占用席位。
   * - false：局前/局后掉线，不保留席位，新人立即可加入。
   *
   * 仅在 `status === 'offline'` 时有效；重连后会被清回 false。
   */
  midRoundOffline: boolean;
  avatar?: string;
  joinedAt: number;
}

/** 维护房间内玩家列表。Host 持有权威列表。 */
export class PlayerManager {
  private readonly players = new Map<string, Player>();
  private readonly byPeer = new Map<PeerId, string>();
  private readonly byClient = new Map<string, string>();

  add(player: Player): Player {
    // 调用方可以不显式传 midRoundOffline；这里默认 false。
    const normalized: Player = { ...player, midRoundOffline: player.midRoundOffline ?? false };
    this.players.set(normalized.id, normalized);
    this.byPeer.set(normalized.peerId, normalized.id);
    if (normalized.clientId) this.byClient.set(normalized.clientId, normalized.id);
    return normalized;
  }
  remove(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
      this.byPeer.delete(player.peerId);
      if (player.clientId) this.byClient.delete(player.clientId);
    }
    return player;
  }

  get(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getByPeer(peerId: PeerId): Player | undefined {
    const id = this.byPeer.get(peerId);
    return id ? this.players.get(id) : undefined;
  }

  getByClient(clientId: string): Player | undefined {
    const id = this.byClient.get(clientId);
    return id ? this.players.get(id) : undefined;
  }

  /** 重连时把玩家重新绑定到新的 transport peer（旧 peer 映射被替换）。 */
  rebindPeer(playerId: string, newPeerId: PeerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.byPeer.delete(player.peerId);
    player.peerId = newPeerId;
    this.byPeer.set(newPeerId, playerId);
    // 重连回来后不再是"局中离线"，清回 false。
    player.midRoundOffline = false;
  }

  setStatus(playerId: string, status: PlayerStatus): void {
    const player = this.players.get(playerId);
    if (player) player.status = status;
  }

  /**
   * 标记玩家是否处于"游戏中宽限期"。仅在 `status === 'offline'` 时调用，
   * 用于区分"局中保留席位 30s"与"局前立即释放席位"。
   */
  setMidRoundOffline(playerId: string, midRoundOffline: boolean): void {
    const player = this.players.get(playerId);
    if (player) player.midRoundOffline = midRoundOffline;
  }

  list(): Player[] {
    return [...this.players.values()];
  }

  count(): number {
    return this.players.size;
  }

  host(): Player | undefined {
    return this.list().find((p) => p.role === 'host');
  }

  /** 转为 welcome 消息所需的精简结构。 */
  toWelcomeList(): WelcomePlayer[] {
    return this.list().map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      status: p.status,
    }));
  }
}
