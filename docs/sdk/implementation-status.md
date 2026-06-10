# SDK V2 实现状态审计

审计日期：2026-06-10

本文对照 `docs/sdk/feature-checklist.md`、当前源码和测试结果，记录 V2 已实现、部分实现和未实现的能力。结论：当前项目已经形成“像素上报 SDK + 会话画像 + 行为路径 Worker 聚合 + 富模板测试站点 + 数据后台解析”的可验证闭环，但生产级可靠性能力仍需继续补齐。

## 1. 当前可运行闭环

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| SDK 核心 API | 已实现 | `init`、`track`、`conversion`、`register`、`unregister`、`login`、`logout`、`setConsent`、`flush`、`destroy`。 |
| Pixel GET 上报 | 已实现 | 所有发送都通过 `new Image().src` 触发 `GET /aly.gif?...`。 |
| 会话画像 | 已实现 | 初始化发送 `$session_start`，包含访问时间、来源、落地页、设备类型、访客和会话标识。 |
| 行为路径 | 已实现 | 点击、滚动停止、鼠标停留可聚合为 `$behavior_path` JSON。 |
| Worker 聚合 | 已实现 | `analytics-worker-*.js` 独立 chunk，Worker 不直接发请求，回退主线程聚合。 |
| 富模板测试站点 | 已实现 | `examples/` 静态站点由 mock server 服务，并自动注入 `sdk-demo.js`。 |
| 数据后台 | 已实现 | `/admin` 读取 `/__hits`，反向解析运营时间线、会话、用户画像、行为路径、热力图和录屏分片。 |
| 自动验证 | 已实现 | `npm run verify` 覆盖单测、构建和富模板 smoke test。 |

## 2. 已实现能力

| 分类 | 功能 | 证据 |
| --- | --- | --- |
| 身份 | `distinct_id`、`session_id`、`user_id` | `src/sdk.ts` 生成本地 ID，支持 `login/logout`。 |
| 初始画像 | `$session_start` | 访问时间、来源、落地页、设备类型、在线起点。 |
| 页面 | `$pageview`、`$pageleave`、SPA `pushState/replaceState/popstate` | `src/sdk.ts` 生命周期监听；单测覆盖路由变化。 |
| 行为 | `$click` | 支持声明式元素和常见交互元素，含元素、区域、坐标和页面上下文。 |
| 行为路径 | `$behavior_path` | `BehaviorPathPipeline` 聚合点击、滚动停止、鼠标停留，输出 JSON 分片。 |
| 生命周期 | `$heartbeat`、`$visibility_change` | 支持配置式在线心跳和页面隐藏/恢复事件。 |
| 表单 | `$form_submit` | 只采表单元数据和字段类型，不采字段值。 |
| 转化 | `$conversion` | `sdk.conversion` 生成运营侧转化事件。 |
| API | `$api` fetch 元数据 | 可选开启，采 URL、method、status、duration、success，不采请求体/响应体。 |
| 异常 | `$js_error`、`$promise_error`、`$resource_error` | 默认监听同步异常、Promise 异常和资源错误。 |
| 录屏 | rrweb 懒加载录屏分片 | `replay.enabled=true` 时动态加载 `rrweb-replay-*.js`，通过 `aly.gif` 上传分片。 |
| 热力图 | 点击/滚动本地聚合 | `HeatmapAggregator` 聚合分桶后上传 `$heatmap_click`。 |
| 隐私 | URL/query/字符串/对象脱敏 | `privacy.ts` 覆盖 token、password、secret、phone、email 等。 |
| consent | 授权开关 | `consent=false` 不采集、不上报；单测覆盖。 |
| URL 限长 | 超长丢弃并诊断 | 超过 `pixelMaxUrlLength` 时丢弃事件并发 `$sdk_diagnostic`。 |
| 服务端补全 | IP、UA、referer、received_at | mock server 在 `/aly.gif` 接收端补齐，IP 不由前端采集。 |
| 后台解析 | 运营侧反向还原 | `/admin` 按 session 还原访问、点击、行为路径、表单、转化、API、录屏和热力图。 |

## 3. 部分实现能力

| 功能 | 当前状态 | 缺口 |
| --- | --- | --- |
| 插件体系 | 通过 `plugins` 配置开关实现内置模块开关。 | 尚未实现 `sdk.use(plugin)` 外部插件协议。 |
| 队列 flush | 支持内存队列、手动 flush、配置式 `flushInterval` 和并发 flush 保护。 | 尚未实现 `batchSize` 阈值触发、离线缓存和退避重试。 |
| 录屏 | 已接入 rrweb recorder，懒加载独立 chunk。 | 尚未实现服务端重组、后台播放、压缩编码和完整 rrweb player 回放。 |
| 热力图 | 支持点击/滚动分桶聚合。 | 当前统一发 `$heatmap_click`，未拆分 `$heatmap_scroll`、`$heatmap_exposure`。 |
| 异常诊断 | 有基础错误和 `$sdk_diagnostic`。 | 诊断限频、错误风暴保护和 source map 解析未实现。 |
| API 监控 | 支持 `fetch`。 | `XMLHttpRequest` 监控未实现，trace ID 白名单未实现。 |
| 页面离开上报 | `pagehide` 和 `visibilitychange hidden` 时尝试 flush。 | 不保证离场时所有图片请求完成；没有离线缓存兜底。 |
| 后台管理 | 支持本地命中解析、画像、行为路径和可视化。 | 没有登录、权限、数据库、筛选持久化和多项目管理。 |

## 4. 未实现能力

| 分类 | 未完成项 |
| --- | --- |
| 曝光采集 | `$exposure`、声明式曝光、曝光停留时长。 |
| 性能监控 | FCP、LCP、CLS、INP、TTFB、路由级性能和评分。 |
| XHR 监控 | `XMLHttpRequest` patch、状态和耗时采集。 |
| 离线可靠性 | IndexedDB/localStorage 离线缓存、网络恢复补发、退避重试。 |
| 批次协议 | `batch_id`、`batchSize` 阈值触发、服务端幂等、服务端去重。 |
| 多标签同步 | session 跨标签同步。 |
| npm 发布 | 包名、README、变更日志、发布流程。 |
| UMD 构建 | 为满足 rrweb 懒加载，当前只保留 ESM 构建；UMD 单文件未保留。 |
| 真实浏览器自动化 | 当前 smoke test 使用 Node/JSDOM 和 mock recorder；尚未用 Playwright/真实浏览器验证 rrweb runtime。 |

## 5. 当前测试覆盖

| 命令 | 覆盖 |
| --- | --- |
| `npm test` | 20 个单元测试，覆盖像素上报、初始化画像、生命周期、行为路径、隐私脱敏、点击、表单、路由、API、错误、录屏懒加载、重复初始化和超长诊断。 |
| `npm run test:demo` | 构建 SDK，启动富模板 mock server，验证页面、SDK bundle、Worker chunk、rrweb lazy chunk、后台路由、像素命中和后台解析。 |
| `npm run verify` | 串联单测和富模板 smoke test。 |

## 6. 下一步建议

1. 优先补全失败重试、离线缓存和网络恢复补发，保证采集可靠性。
2. 补 `batchSize` 阈值触发和服务端批次幂等去重。
3. 拆分热力图事件类型，补 `$heatmap_scroll` 和 `$heatmap_exposure`。
4. 增加真实浏览器测试，用 Playwright 验证 Worker、rrweb 懒加载和浏览器网络面板行为。
5. 实现性能监控和 XHR 监控，完善开发者侧闭环。
6. 为 `/admin` 增加筛选、导出、清空命中、录屏播放和热力图页面叠加能力。
