# 前端数据采集 SDK 技术验证计划

本文定义 V1 开发前和开发过程中的技术验证项，目标是提前确认浏览器行为、兼容性、可靠性和隐私边界。

## 1. 验证原则

- 先验证高风险能力，再实现正式模块。
- 每个验证项都要有输入、步骤、预期结果和通过标准。
- 验证结果需要沉淀为自动化测试或开发约束。
- 涉及隐私和 monkey patch 的能力必须以失败优先的方式验证。

## 2. 验证环境

目标浏览器：

- Chrome 最新版。
- Edge 最新版。
- Firefox 最新版。
- Safari 14+。
- iOS Safari 14+。

建议本地验证页面：

```text
examples/basic/
  index.html
  app.ts
  mock-server.ts
```

建议 mock 接口：

```text
GET /aly.gif
GET /api/success
GET /api/fail
GET /api/slow
GET /api/abort
```

## 3. 验证矩阵

| 编号 | 验证项 | 风险 | 通过标准 |
| --- | --- | --- | --- |
| TV-01 | `crypto.randomUUID` 兼容和降级 | 低 | 不支持时仍能生成唯一 ID。 |
| TV-02 | `localStorage` 可用性 | 中 | 禁用或异常时 SDK 不崩溃。 |
| TV-03 | SPA 路由 patch | 中 | push、replace、back 都触发一次页面事件。 |
| TV-04 | 页面离开上报 | 中 | `pagehide` 前尽量通过 `aly.gif` 像素请求发送。 |
| TV-05 | Pixel URL 长度限制 | 中 | 大字段截断、摘要化或丢弃，不阻塞页面。 |
| TV-06 | IndexedDB 离线缓存 | 中 | 离线写入，在线后补发并清理缓存。 |
| TV-07 | Click 文本脱敏 | 高 | 敏感元素和输入值不进入队列。 |
| TV-08 | Exposure 计时准确性 | 中 | 可见不足 1 秒不上报，超过 1 秒上报一次。 |
| TV-09 | `fetch` patch 行为保持 | 高 | 返回值、异常、abort 与原生一致。 |
| TV-10 | XHR patch 行为保持 | 高 | 事件、状态、回调顺序与原生一致。 |
| TV-11 | API 监控递归排除 | 高 | `/aly.gif` 不被记录为 API 事件。 |
| TV-12 | Web Vitals 采集 | 中 | 支持指标产生事件，不支持时静默跳过。 |
| TV-13 | 异常递归保护 | 高 | SDK 内部错误不触发无限上报。 |
| TV-14 | 队列上限 | 中 | 超限后按策略丢弃，不造成内存持续增长。 |
| TV-15 | 隐私最终过滤 | 高 | `beforeSend` 可修改或丢弃任意事件。 |
| TV-16 | 运营侧采集域 | 中 | 行为、曝光、点击、转化事件包含 `domain: "operation"`。 |
| TV-17 | 开发者侧采集域 | 中 | 异常、API、性能、诊断事件包含 `domain: "developer"`。 |
| TV-18 | 运营转化事件 | 中 | `sdk.conversion` 生成 `$conversion` 且可按渠道聚合。 |
| TV-19 | SDK 自诊断限频 | 高 | 队列丢弃、重试、降级不会产生无限诊断事件。 |
| TV-20 | Pixel GET 上报 | 中 | 小体积运营事件以图片 GET 请求发送。 |
| TV-21 | Pixel URL 超长处理 | 中 | URL 超长时截断、摘要化或丢弃。 |
| TV-22 | 录屏默认关闭 | 高 | 默认配置不会产生任何录屏事件。 |
| TV-23 | 录屏脱敏与分片 | 高 | 开启后生成分片，输入值和敏感文本不进入分片。 |
| TV-24 | 热力图本地聚合 | 中 | 点击和滚动先本地聚合，再通过 `aly.gif` 上传。 |

## 4. 关键验证详情

### TV-03：SPA 路由 patch

输入：

```ts
history.pushState({}, "", "/a");
history.replaceState({}, "", "/b");
history.back();
```

预期：

- `/a` 触发一次 `$pageview`。
- `/b` 触发一次 `$pageview`。
- 浏览器后退触发一次 `$pageview`。
- 同一 URL 重复触发需要去重。
- `destroy` 后 `history.pushState` 恢复原函数。

### TV-04：页面离开上报

步骤：

1. 初始化 SDK。
2. 连续触发 3 条事件但不达到批量阈值。
3. 触发 `pagehide`。
4. 观察 mock server 收到的请求。

预期：

- SDK 尝试触发 `GET /aly.gif?...`。
- 请求包含剩余事件压缩后的关键参数。
- 页面离开流程不被阻塞。

### TV-06：IndexedDB 离线缓存

步骤：

1. 初始化 SDK。
2. 模拟 `navigator.onLine === false` 或 mock server 断开。
3. 触发 5 条事件。
4. 恢复网络。

预期：

- 事件写入 IndexedDB。
- 网络恢复后自动补发。
- 成功后本地缓存被删除。
- 缓存中的事件已经脱敏。

### TV-07：Click 文本脱敏

测试元素：

```html
<button data-track-id="safe-button">立即购买</button>
<input value="secret-value" />
<button>token: abc123</button>
```

预期：

- 第一个按钮可上报 `text: "立即购买"`。
- 输入框不上报真实 `value`。
- 第三个按钮上报 `text: "[masked]"`。

### TV-09：fetch patch 行为保持

验证场景：

- 成功响应。
- 500 响应。
- 网络错误。
- `AbortController` 取消。
- `Request` 对象作为入参。

预期：

- 业务拿到的 `Response` 与原生一致。
- `fetch` 抛出的异常类型与原生一致。
- SDK 只新增 API 事件，不改变请求结果。
- 请求体不会被读取和消费。

### TV-10：XHR patch 行为保持

验证场景：

- `onreadystatechange`。
- `load`。
- `error`。
- `abort`。
- `timeout`。
- 同步 XHR。

预期：

- 回调顺序不被 SDK 改变。
- `status` 和 `duration` 可正常记录。
- SDK 不读取请求体和响应体。

### TV-13：异常递归保护

步骤：

1. 在 `beforeSend` 中故意抛错。
2. 在插件处理逻辑中故意抛错。
3. 触发普通 JS Error。

预期：

- SDK 内部错误只进入 debug 日志。
- 普通 JS Error 仍可正常上报。
- 不出现连续重复错误事件。

### TV-16：运营侧采集域

步骤：

1. 初始化 SDK 并开启页面采集。
2. 通过 `register` 注入 `channel` 和 `campaign_id`。
3. 触发 `$pageview`、`$click`、`$exposure`。

预期：

- 三类事件都包含 `domain: "operation"`。
- 事件保留渠道和活动公共属性。
- 点击和曝光事件不包含输入值、Cookie 或未脱敏 URL。

### TV-17：开发者侧采集域

步骤：

1. 触发 JS Error。
2. 触发 API 500。
3. 触发 Web Vitals 指标。

预期：

- 异常、API 和性能事件都包含 `domain: "developer"`。
- 异常事件包含错误类型和脱敏堆栈。
- API 事件不包含请求体和响应体。
- 性能事件包含 `rating`。

### TV-18：运营转化事件

输入：

```ts
sdk.conversion("order_paid", {
  orderId: "order_10001",
  amount: 199,
  currency: "CNY"
});
```

预期：

- 生成 `$conversion`。
- 事件包含 `domain: "operation"`。
- 事件包含 `conversion_id: "order_paid"`。
- 金额字段可用于运营统计。
- 不包含支付凭证、银行卡、证件号。

### TV-19：SDK 自诊断限频

步骤：

1. 设置较小 `maxQueueSize`。
2. 快速触发超过队列上限的事件。
3. 模拟上报接口持续 500。

预期：

- SDK 生成 `$sdk_diagnostic` 或 debug 日志。
- 诊断事件包含 `domain: "developer"`。
- 同类诊断事件在短时间内被限频。
- 诊断事件不包含原始事件 payload。

### TV-20：Pixel GET 上报

步骤：

1. 配置 `pixelEndpoint = "/aly.gif"`。
3. 触发 `$pageview` 或 `$click`。
4. 观察浏览器网络面板或 mock server 请求。

预期：

- 请求为 `GET /aly.gif?...`。
- 请求由 `new Image().src` 触发。
- 请求包含 `rn` 防缓存参数。
- 请求参数包含 `evt`、`dm`、`sid`、`vid`。
- 请求表现为图片资源，`Sec-Fetch-Dest` 通常为 `image`。
- 服务端返回 1x1 透明 GIF。
- 关闭 consent 后不再触发该请求。

### TV-21：Pixel URL 超长处理

步骤：

1. 设置 `pixelMaxUrlLength = 300`。
2. 触发带长标题或长 selector 的点击事件。
3. 观察发送方式。

预期：

- SDK 先删除低优先级字段或截断字段。
- 仍超过限制时丢弃当前事件。
- 丢弃过程生成 `$sdk_diagnostic` 或 debug 日志。
- 敏感字段不会因为降级而绕过脱敏。

### TV-22：录屏默认关闭

步骤：

1. 使用默认配置初始化 SDK。
2. 执行点击、滚动、输入、路由切换。
3. 观察事件队列和 mock server。

预期：

- 不产生 `$replay_start`。
- 不产生 `$replay_chunk`。
- 不产生 `$replay_end`。
- 不产生录屏相关 `aly.gif` 请求。

### TV-23：录屏脱敏与分片

步骤：

1. 显式开启 `replay.enabled = true`。
2. 设置 `maskAllText = true` 和 `maskInput = true`。
3. 页面包含输入框、手机号、邮箱、支付区域。
4. 执行点击、输入、滚动和路由切换。

预期：

- 生成 `$replay_start`、`$replay_chunk`、`$replay_end`。
- 所有分片通过 `GET /aly.gif?...` 上传。
- 分片包含 `rid` 和 `seq`。
- 输入框真实值不进入分片。
- 被 `blockSelectors` 命中的节点不进入分片。
- 单个 URL 超长时截断、摘要化或丢弃。

### TV-24：热力图本地聚合

步骤：

1. 显式开启 `heatmap.enabled = true`。
2. 触发多次点击和滚动。
3. 等待 `heatmap.flushInterval`。

预期：

- 生成 `$heatmap_click` 和 `$heatmap_scroll`。
- 事件数据是聚合后的稀疏矩阵，不是逐点原始轨迹。
- 上传请求为 `GET /aly.gif?...`。
- 鼠标移动默认不采集。
- 输入值和敏感文本不进入热力图数据。

## 5. 性能验证

### 5.1 体积

目标：

- Core + Page + Error + Transport gzip 小于 20KB。
- 所有插件全量 gzip 体积有单独记录。

建议命令：

```bash
npm run build
npm run size
```

### 5.2 运行开销

指标：

- 初始化耗时。
- 单次 `track` 入队耗时。
- 点击处理耗时。
- 1000 条事件入队内存增长。
- 批量序列化耗时。

目标：

- 常规 `track` 不做同步网络请求。
- 高频点击不会导致明显主线程阻塞。
- 队列上限生效，内存不会无限增长。

## 6. 隐私验证

必须验证以下输入不会以明文出现在最终 payload 中：

- `?token=abc`
- `?password=abc`
- `Authorization`
- Cookie 内容。
- `<input value="abc">`
- 请求体 JSON。
- 响应体 JSON。
- 异常堆栈中的手机号或邮箱。

运营侧额外验证：

- 点击文本命中敏感词时被替换为 `[masked]`。
- 曝光事件不采集元素内部完整文本。
- 转化事件不采集支付凭证。
- 录屏默认遮罩文本和输入值。
- 热力图只上传聚合分桶，不上传逐点高频轨迹。

开发者侧额外验证：

- API 事件不采集请求体和响应体。
- SDK 自诊断事件不包含原始失败 payload。
- 异常堆栈经过截断和正则脱敏。

Pixel 上报额外验证：

- query 参数中不出现 Token、Cookie、输入值、请求体、响应体。
- 当前页面 URL 和 referrer 先脱敏再编码。
- 页面标题和文本字段经过截断。

## 7. 验证产物

每个高风险项完成后需要产出：

- 验证脚本或测试页面。
- 测试步骤。
- 实际结果。
- 是否进入自动化测试。
- 仍然保留的风险。

## 8. 出口标准

- P0 验证项全部通过。
- P1 高风险验证项通过或明确默认关闭。
- 隐私验证全部通过。
- 失败项有明确降级策略。
- 技术验证结论同步回主方案和功能清单。
