# 房间准入与重连

## 0. 准入只看容量

准入条件只有一个：`reservedPlayers < maxPlayers`。

- 未满 → 任何人都能加入
- 满员 → 新人禁止加入，大堂列表按钮显示"房间已满" disabled

Room 不需要广播任何准入事件，HostRuntime 自动按容量计算。

## 1. 离开的两种方式

| 维度 | 触发方式 | worker 何时收到 `onLeave` | 适用场景 |
| --- | --- | --- | --- |
| **主动离开** | 玩家调用 `parti.leave()` | **立即**（不走 grace timer） | 点"退出"按钮 |
| **被动掉线** | 网络断开 / 刷新 / 标签页关闭 | 宽限期（默认 30s）到期后 | 意外断开 |

两种方式都触发 `onLeave`，HostRuntime 在 `onLeave` 调用前已经把玩家从 `players` 移除。
Room 端无法控制"何时真正离开"——主动 vs 被动、何时 grace 到期都是 HostRuntime
决定的，Room 只能在 `onLeave` 里清理自己的业务状态（见 §3）。

> 主动 vs 被动不需要任何 API 协调——它们走的是不同的事件源，HostRuntime
> 会自动区分：主动走 `leave`，被动走 `scheduleGrace` 倒计时。

## 2. HostRuntime 自动管理 grace timer

```
玩家断线 → 状态设为 offline，启动 30s 宽限期
  ├─ 宽限期内带同 clientId 重连 → 复用原 playerId，触发 onReconnect
  └─ 宽限期到期仍未回 → 触发 onLeave，正式移除
```

Room **不需要**自己处理 `onDisconnect` 或 30s 逻辑，HostRuntime 全套兜底。

## 3. Room 端：清理业务状态

`onLeave` 钩子**仅用于清理 Room 内部的业务状态**（座位、玩家数据、UI 元素），
**不能**用来控制"何时真正离开"——主动 vs 被动、何时 grace 到期是 HostRuntime
决定的事，Room 无权干预。

```js
// snake：玩家离开就删掉他的蛇
onLeave(ctx, player) {
  delete ctx.state.snakes[player.id];
}

// 斗地主：游戏中退 = 清理座位（不主动 kick——HostRuntime 已 remove）
onLeave(ctx, player) {
  delete ctx.state.seats[player.id];
  ctx.broadcast('player:left', { id: player.id });
}
```

Room 完全掌控自己 state 的清理逻辑；HostRuntime 负责调度"何时调用 onLeave"。

## 4. 写新游戏时的决策清单

1. **房间是否依赖"重连时复用 playerId + 业务状态"？**
   - 是（牌局、回合制）→ 默认 30s grace 让玩家能重连回同一座位/手牌
   - 否（休闲 IO、无状态小游戏）→ 不需关心，走默认 30s grace 即可
     （主动退出走 `sys:leave` 立即清，参见下条；被动断线仍会保留 30s 让你
     写 `onLeave` 时知道是"被踢"还是"自然断线"）

2. **`onLeave` 里要清什么？**
   - 玩家私有数据（手牌、蛇身、积分、准备状态）
   - 涉及该玩家的定时器、引用
   - 广播必要的 `player:left` 给其他玩家

3. **房间想主动请玩家离开？（违规、超时占座、规则判定）**
   调 `ctx.leave(playerId)`——**与 `graceMs` 无关**，立即走 `onLeave` + 广播
   `player:left` + 移除，等价于玩家点退出。**这是房间主动踢人的唯一入口**。
   与 `ctx.kick(id, reason)`（只发通知、不真踢）区别见 worker-api.md。

详细 API 见 [worker-api.md：玩家主动离开 vs 被动掉线](./worker-api.md#玩家主动离开-vs-被动掉线)；HostRuntime 端行为见 [host-runtime.md](./host-runtime.md)。
