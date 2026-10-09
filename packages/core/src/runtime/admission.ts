import type { PeerId } from '../transport/types';

export type AdmissionPhase = 'package' | 'join';

export interface AdmissionRequest {
  roomId: string;
  phase: AdmissionPhase;
  peerId: PeerId;
  clientId?: string;
  credential?: string;
}

export type AdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'CREDENTIAL_REQUIRED' | 'INVALID_CREDENTIAL';
      message: string;
    };

/** Runtime 不理解 credential 的含义；具体密码/票据策略由宿主层实现。 */
export interface RoomAdmissionController {
  authorize(request: AdmissionRequest): AdmissionDecision;
}

export interface RoomAdmissionStatus {
  /** 当前 connected / ready 的玩家数，包含房主。 */
  activePlayers: number;
  /** 包含宽限期离线玩家的占位数，用于容量判断。 */
  reservedPlayers: number;
  maxPlayers: number | null;
  /**
   * 容量与游戏逻辑都允许新玩家加入。注意：局中（bidding/playing）时为 false，
   * 但同一局中的稳定身份仍可凭 clientId 在 `handleHello` 中走 reconnect 路径，
   * 不受此字段约束。
   */
  joinable: boolean;
  /**
   * 纯游戏逻辑侧是否允许新玩家加入（与席位无关）。
   * - false：局中（bidding/playing），拒绝新玩家，但同局内的稳定身份可重连。
   * - true：局前/局后，允许新玩家加入（仍受 reservedPlayers < maxPlayers 约束）。
   */
  gameJoinable: boolean;
}
