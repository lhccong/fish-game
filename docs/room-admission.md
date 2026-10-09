# 房间准入与重连策略

> **TL;DR**：worker 默认 `gameJoinable = true`（任何时候新人都能补）。在状态机
> 关键节点广播 `ctx.broadcast('game:joinable-changed', <bool>)` 显式锁/开。
> Runtime **自动**按 `gameJoinable` 决定断线重连窗口——`true` 时一断就清，
> `false` 时 30s 让稳定身份重连。

## 0. 三个维度

写房间的准入逻辑前，先想清楚三件事——它们是**正交的**：

| 维度 | 含义 | 谁控制 | 何时改变 |
| --- | --- | --- | --- |
| **席位容量** | 房间有 N 个座位 | `meta.maxPlayers` | 不可变 |
| **游戏是否允许新加入** | 当前阶段是否对外招新 | worker 广播 `game:joinable-changed` | worker 在状态变化时改 |
| **断线是否给重连宽限** | 某玩家掉线，是否保留 30s 让他凭 `clientId` 重连 | Runtime 自动按 `gameJoinable` 决定 | 自动 |

`apps/web` 的大堂列表条目**只能感知**头两个维度；第三个维度**不展示**——它只
影响"已加入后掉线"的行为。

## 1. 三种典型策略

### 1.1 常开制（默认）

> "**房间在就一直在招人**"——贪吃蛇、画猜、谁是卧底。

- **worker 完全不调** `game:joinable-changed`——直接走默认 `true`。
- 任何时候新人都能补，座位满则大堂列表自动 disabled "房间已满"。
- 某玩家掉线 → **一断就清**——座位立即空出来，新人可补。
- **worker 代码零额外负担**。

```js
// snake 的 worker 完全不写准入逻辑：
onJoin(ctx, player) {
  ctx.state.snakes[player.id] = { /* ... */ };
},
onLeave(ctx, player) {
  delete ctx.state.snakes[player.id]; // 立即清
},
```

### 1.2 锁门制（回合制短局）

> "**局中关门**"——斗地主、UNO、短局棋牌。

- 进入局中 → 广播 `game:joinable-changed: false`
- 回到局前/结算 → 广播 `game:joinable-changed: true`
- 某玩家掉线（局中）→ 保留 30s 让其凭 `clientId` 重连；过 30s 仍未回则清理。
- **必须在状态机每个阶段显式广播**，否则要么局中有人能进（漏 lock）、要么局后
  新人卡在门外（漏 unlock）。

```js
function setGameJoinable(joinable) {
  ctx.broadcast('game:joinable-changed', joinable);
}

onJoin(ctx, player) {
  // ... 入座
  if (Object.keys(ctx.state.players).length === 3) {
    ctx.state.phase = 'ready';
  }
},

// 关键阶段 1：进入局中 → 锁门
function startRound(ctx) {
  setGameJoinable(false);
  // ... 发牌
},

// 关键阶段 2：结算/重开局 → 开门
function endRound(ctx) {
  // ... 算分
  setGameJoinable(true);
},

// 关键阶段 3：中途有人退到非满员 → 也要开门
onLeave(ctx, player) {
  // ... 清座位
  if (Object.keys(ctx.state.players).length < 3) {
    setGameJoinable(true);
  }
},
```

**漏点提醒**：
- 如果 `onLeave` 路径里没显式 `setGameJoinable(true)`，**`gameJoinable` 会
  残留在 false**（斗地主历史 bug：3 人退出后大堂列表仍误显"游戏中"）。
- 任何"回到非满员"的路径（玩家主动退出、流局、掉线清座位）都该 `unlock`。

### 1.3 半锁制（长局卡牌）

> "**长局保留，结算补人**"——三人麻将、长局扑克。

- 长局进行中 → 锁门
- 每局结算期 → 开门（让补人进来准备下一局）
- 局中掉线 → 30s 宽限（同锁门制）

实现上同锁门制，区别只在"开门时机"和"是否要补满才开下一局"。代码结构一样。

## 2. Runtime 自动决定的断线重连语义

worker **不需要**在 `onLeave` 里写"等 30s 再清"——这是 Runtime 干的。

```
onDisconnect(peerId):
  player = players.get(peerId)
  if (gameJoinable === false):
    setMidRoundOffline(player.id, true)  // 局中掉线：保留 30s
    scheduleGrace(player.id, 30s)         // 30s 后未回则清理
  else:
    setMidRoundOffline(player.id, false) // 局前/局后掉线：立即清
    runLeave(player)
```

- **`gameJoinable === true`（常开制）**：掉线立即清——和"Snake 删掉 state.snakes[id]"
  等价，但 Runtime 自动负责。
- **`gameJoinable === false`（锁门制/半锁制）**：掉线保留 30s，期间该玩家可以凭
  `clientId` 走 reconnect 路径重连回原 `playerId`。30s 到期仍未回则清理并广播
  `player:left`。

**所以游戏是否支持 30s 断线重连，**是 `gameJoinable` 当前值决定的**——**不是
worker 显式调某个 API**。常开制游戏自动没有重连窗口，锁门制游戏自动有。

## 3. 大堂列表按钮（`apps/web` 侧）

`apps/web` 的大堂列表条目根据 `getAdmissionStatus` 决定按钮：

| `joinable` | `selfRejoinable` | 按钮 | 文案 | 说明 |
| --- | --- | --- | --- | --- |
| true | (无关) | enabled | 加入房间 | 任何人都能加 |
| false | false | disabled | 房间已满 | 真·满员 |
| false | **true** | **enabled** | **加入游戏** | 你 30s 内是局中掉线者，可重连 |

`selfRejoinable` 是 lobby server 给**特定 viewer** 加的字段：viewer 的 `clientId`
是否仍属于这个房间（host 上报时把 `players` 列表里所有 `clientId` 提交到 lobby
server，server 据此匹配）。所以**只有你是 30s 内局中掉线者**才会看到"加入游戏"。

- 房间状态（"游戏中"）显示在卡片标题旁作为**标签**，**不放在按钮上**。
- 满员按钮被禁用仅当"不是你的房间"——你的房间永远能点回。

## 4. 写新游戏时的决策清单

写新游戏的 worker 前，问自己两个问题：

1. **我的游戏在什么阶段不允许新玩家加入？**
   - 任何时候都能加 → 走常开制（**不写任何准入代码**）
   - 局中不能加 → 走锁门制，**在状态机每个阶段显式 `game:joinable-changed`**
2. **局中玩家掉线了，我希不希望他 30s 内能回来？**
   - 希望 → 走锁门制（自动获得 30s 重连）
   - 不希望 → 走常开制（自动一断就清）

两个问题**通常同向**——"局中不能加"的游戏一般也希望"局中能回来"。

详细 API 见 [worker-api.md：房间状态与准入控制](./worker-api.md#房间状态与准入控制gamejoinable-changed)；
HostRuntime 端行为见 [host-runtime.md](./host-runtime.md)。
