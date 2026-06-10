# V2 会话行为采集链路

本文记录 V2 已落地的采集与推送升级：初始化画像、会话生命周期、行为路径聚合、Worker 处理和后台反向解析。

## 1. 目标

V2 从“单事件采集”升级为“用户会话行为链路重建”：

- 初始化阶段生成用户基础画像。
- 生命周期阶段记录在线周期、心跳和页面可见性。
- 行为阶段将点击、滚动停止、鼠标停留聚合为行为路径 JSON。
- Worker 负责行为路径聚合，主线程仍然使用 `new Image().src` 推送 `GET /aly.gif?...`。
- 后台从 `/__hits` 反向解析画像、会话、时间线、行为路径、热力图和录屏分片。

## 2. 事件分层

| 类型 | 事件 | 说明 |
| --- | --- | --- |
| 初始类型 | `$session_start` | 访问时间、来源、落地页、设备类型、会话 ID、访客 ID、用户 ID。 |
| 页面类型 | `$pageview`、`$pageleave` | 页面进入、SPA 路由变化和离开时长。 |
| 生命周期 | `$heartbeat`、`$visibility_change` | 在线心跳、页面隐藏/恢复、活跃时长。 |
| 行为路径 | `$behavior_path` | 聚合点击、滚动停止、鼠标停留为 JSON。 |
| 运营事件 | `$click`、`$form_submit`、`$conversion` | 继续保留细粒度运营事件。 |
| 开发者事件 | `$api`、`$js_error`、`$promise_error`、`$resource_error` | 继续保留开发者排障事件。 |
| 体验事件 | `$heatmap_click`、`$heatmap_scroll`、`$heatmap_exposure`、`$replay_chunk` | 点击热区、滚动深度、曝光元素和 rrweb 录屏分片。 |

## 3. 推送约束

所有上传仍然只允许像素级上报：

```text
GET /aly.gif?ti=...&evt=...&sid=...&vid=...&data=...
```

约束：

- 不使用 POST。
- 不使用 `sendBeacon`。
- 不使用业务 API 风格接口。
- Worker 不直接发网络请求，只把聚合结果回传主线程。
- 主线程统一通过 `PixelTransport` 和 `Image` 对象发送。

## 4. Worker 行为路径

`src/behavior-path.ts` 提供主线程 fallback 和 Worker 管理。`src/analytics-worker.ts` 只负责：

- 接收行为事件。
- 缓冲和限制最大事件数。
- flush 时生成 `$behavior_path` 分片。
- 回传主线程。

浏览器不支持 Worker 或 Worker 创建失败时，会自动回退到主线程聚合。

## 5. 服务端补全

mock server 的 `/aly.gif` 在写入命中时补充：

- `received_at`：服务端接收时间。
- `ip`：来源 IP，优先读取 `x-forwarded-for`。
- `user_agent`：请求头 UA。
- `referer`：请求头 referer。

IP 不由前端主动采集，避免不稳定和不必要的前端权限问题。

## 6. 后台展示

后台新增：

- 用户画像：访客、会话、来源、设备、IP、页面。
- 行为路径：按时间顺序展示点击、滚动停止、鼠标停留。
- 热力图：拆分展示点击热区、滚动深度和曝光元素。
- 录屏分片：展示 replay ID、序号、页面和 rrweb 事件数量摘要。

后台仍每 3 秒读取 `/__hits`，不注入 SDK，避免后台访问污染采集数据。

## 7. 验证结果

当前验证命令：

```bash
npm run verify
```

覆盖：

- `28` 个 SDK 单元测试。
- Vite 构建，包含独立 `analytics-worker-*.js` 和 `rrweb-replay-*.js` chunk。
- 富模板 smoke test 收到 `14` 条 `aly.gif` 命中，并覆盖三类热力图事件。
- 后台 parser 能解析 `$session_start`、`$behavior_path`、热力图拆分事件和录屏分片。
