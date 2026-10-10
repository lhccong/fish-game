# 服务器同步与网站下载

所有在线房间固定使用“服务器同步 / WebSocket”。顶部仅显示同步状态，全局设置页
隐藏整个同步方式区域及高级配置入口。浏览器中保存的旧偏好不影响创建房间。

内置与市场下载房间统一使用服务器同步，不再受浏览器保存的 PeerJS 偏好影响。
新 Relay 连接信息带 `relay:` 标记，避免大厅遗漏同步方式时误走 WebRTC；
取包、正式加入和重连均读取相同标记。在线邀请未指定 adapter 时默认 Relay，
非 Relay 邀请（包括旧 PeerJS 链接）不再受支持，需由房主重新创建房间并分享新邀请。
不能把已运行房间原地切换为 Relay。本地离线预览不受影响。

## 职责

- 网站通过同源 `/api/relay` WebSocket 转发玩家操作、房主状态和事件。
- 房主浏览器仍运行 Room Worker，负责准入、人数限制及权威游戏逻辑，必须保持在线。
- 服务器不运行游戏、不保存游戏快照、不支持房主迁移。
- 仅房主可以向指定玩家发送消息；玩家只能向房主发送，不能向其他玩家广播。
- 房主使用只保存在 sessionStorage 的随机秘密注册；邀请链接只包含其 SHA-256
  摘要，不包含秘密。房主和玩家断线后尝试重连，刷新仍可使用同一邀请。

## 包下载

加入者先经服务器连接房主完成现有 `sys:package-request` 准入检查。内置游戏的
`sys:package-data` 在 Web 平台层改为 `{ manifest, packageHash, builtinSourceId }`：
加入者从本网站 `/rooms/` 下载对应文件，使用房主房间 manifest 重算哈希，必须一致。
因此游戏文件不再经过房主上传，但获取描述信息仍要求房主在线。

网站发布新包后，旧房间若与网站文件不一致会明确报错，房主需重新创建房间。
不会加载不匹配的代码，不做跨版本迁移。`/rooms/` 文件须重新验证缓存，
不能配置一年 immutable 缓存。

自建、导入的游戏保留 `{ manifest, files }` 下载及正式加入时的哈希校验；
选择服务器同步时，这些包经服务器转发，不需要 WebRTC。

从市场安装、未经编辑的游戏发送 `{ manifest, packageHash, marketSource }`，
其中 `marketSource` 包含 `owner`、`repo`、固定的 `commit` 和 `packageDir`。
玩家从该提交的市场仓库 CDN 下载包，再使用房主 manifest 校验哈希，不拉房主文件。
市场房间固定使用 Relay，邀请、大厅展示和加入使用同一配置；不受旧的 PeerJS 偏好影响。
下载失败不回退到房主发包。未记录固定来源的旧市场安装需重新安装后建房。
用户自行上传、编辑、ZIP 导入的游戏在 `sys:package-data` 中改为
`{ manifest, packageHash, customRemote }`，其中 `customRemote` 描述
`{ uploadBackend, hostUserId, key }`：加入者先经准入拿到元信息，
再经 lobby-mock 的 `POST /api/upload/get`（body 用 `userId` + `key`，
其中 `userId` 取自 `customRemote.hostUserId`）
拿一次性 GET presigned URL 从 MinIO 拉 zip，重算哈希后走 `sys:hello`，
与市场/内置游戏走相同的下载模式。`hostUserId` 是房主而非加入者的登录
id —— zip 在 MinIO 上以 `game/<房主 userId>/...` 命名，加入者侧拉取时
必须用房主身份；准入仍在 host 端的 `handlePackageRequest` 阶段完成，
lobby-mock 只校验 key 前缀与 `userId` 一致，不重做房间准入。下载失败
不回退到房主发包；未带 `remoteKey` 的旧自定义安装需重新上传后再建房。
不与房间快照一起保存任何租约或签名，服务端在签 URL 前再做一次
`game/<userId>/` 前缀校验防止越权。

## 部署

`npm run dev` / `npm run dev:web` 的 Vite 服务、`npm run preview` 及
`npm run start` 均挂载 `/api/relay`。纯静态托管不支持此模式。
生产启动请使用 `npm run start`（包含 tsx loader），不是裸 `node scripts/start.mjs`。

设置 `ALLOWED_ORIGINS=https://你的域名`。未配置时只接受 Origin host 与请求 Host
一致的浏览器连接。反向代理必须传递 WebSocket Upgrade；使用 Nginx / 1Panel 时，
在网站反向代理开启 WebSocket，等效配置：

```nginx
location /api/relay {
    proxy_pass http://127.0.0.1:5157;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
}
```

容器部署时上游端口使用映射端口，例如 `3215`。服务端每 15 秒做存活检查。
大厅与网站同一部署时无需为 relay 配第三方服务，`VITE_LOBBY_SERVICE_URL` 仍只配置大厅。
大厅条目必须保留 `connectionInfo` 和 `transportConfig`，否则从大厅加入会选错协议。

当前为单实例内存转发，所有房间请求应到同一进程。每实例最多 2048 个连接、
每房间最多 64 个远端连接、单条消息最多 32 MiB，发送缓冲上限 64 MiB；
超限会断开连接。自定义大包可能触发限制。
这是匿名访问服务，Origin 校验不等于用户身份认证；公网部署还应在网关限制连接和流量，
并监测内存、带宽。转发服务器可读取协议消息，不能视为端到端加密。

## 人工验证

用两个不同网络的设备选择服务器同步创建和加入房间，检查：
内置包来自网站 HTTP 请求、操作和状态双向同步、密码和满员拒绝、
房主刷新与短时断网恢复、房主关闭、从大厅及邀请链接加入、自定义包下载。
代理环境和真实游戏体验须由玩家验证。
