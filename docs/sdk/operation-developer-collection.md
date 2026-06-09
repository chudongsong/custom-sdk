# 运营侧与开发者侧数据采集设计

本文强化 SDK V1 的两大采集模块：运营侧数据采集和开发者侧数据采集。两者共用统一事件模型、身份体系、隐私规则和传输链路，但在事件目标、字段粒度、默认开关、分析口径和风险控制上分开治理。

## 1. 模块定位

| 模块 | 面向对象 | 核心问题 | 典型事件 |
| --- | --- | --- | --- |
| 运营侧采集 | 运营、产品、增长、内容团队 | 用户从哪里来、看了什么、点了什么、是否转化、哪些内容有效。 | `$pageview`、`$pageleave`、`$click`、`$exposure`、`$conversion`、`$replay_chunk`、`$heatmap_click`、业务自定义事件。 |
| 开发者侧采集 | 前端、后端、测试、SRE | 页面是否稳定、接口是否可用、性能是否达标、错误如何定位。 | `$js_error`、`$promise_error`、`$resource_error`、`$api`、`$web_vitals`、`$sdk_diagnostic`。 |

## 2. 统一采集域

所有事件增加 `domain` 字段，用于区分数据用途：

```ts
type EventDomain = "operation" | "developer" | "shared";

interface SDKEvent {
  event: string;
  domain: EventDomain;
  type: "behavior" | "conversion" | "error" | "performance" | "api" | "diagnostic" | "custom";
  event_properties: Record<string, unknown>;
}
```

字段规则：

- `operation`：用于用户行为、内容效果、活动转化和产品漏斗分析。
- `developer`：用于异常、性能、接口、资源和 SDK 自诊断。
- `shared`：身份、页面、设备、网络、公共属性等两侧共用上下文。

## 3. 运营侧采集

### 3.1 采集目标

运营侧需要回答：

- 用户从哪个渠道进入。
- 用户访问了哪些页面。
- 页面停留了多久。
- 哪些按钮、入口、Banner、模块被点击。
- 哪些内容被曝光，曝光后是否点击。
- 活动、商品、表单、注册、下单等关键路径是否转化。
- 用户真实操作路径如何回放。
- 页面点击、滚动和曝光热区如何分布。
- 不同渠道、版本、租户、人群之间的行为差异。

### 3.2 默认事件

| 事件 | 类型 | 默认状态 | 触发条件 | 核心字段 |
| --- | --- | --- | --- | --- |
| `$pageview` | behavior | 开启 | 初始化和路由变化。 | `url`、`path`、`title`、`referrer`、`navigation_type`。 |
| `$pageleave` | behavior | 开启 | 页面隐藏、离开或路由切换前。 | `duration`、`path`、`leave_type`。 |
| `$click` | behavior | 关闭 | 用户点击声明或可识别元素。 | `track_id`、`text`、`selector`、`x`、`y`。 |
| `$exposure` | behavior | 关闭 | 元素可见超过阈值和时长。 | `exposure_id`、`ratio`、`duration`、`position`。 |
| `$conversion` | conversion | 手动 | 业务调用转化 API。 | `conversion_id`、`conversion_type`、`amount`、`currency`。 |
| `$replay_chunk` | replay | 关闭 | 录屏分片 flush。 | `replay_id`、`seq`、`enc`、`data`。 |
| `$heatmap_click` | heatmap | 关闭 | 点击热力图聚合 flush。 | `heatmap_id`、`grid`、`data`。 |
| `$heatmap_scroll` | heatmap | 关闭 | 滚动热力图聚合 flush。 | `heatmap_id`、`scrollBuckets`、`data`。 |
| 业务自定义事件 | custom | 手动 | 业务调用 `track`。 | 业务自定义字段。 |

### 3.3 运营公共属性

推荐通过 `sdk.register` 注入：

```ts
sdk.register({
  channel: "ad",
  campaign_id: "summer_2026",
  tenant: "demo",
  app_version: "1.3.0",
  experiment_id: "exp_home_hero_a"
});
```

字段说明：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `channel` | 访问渠道。 | `organic`、`ad`、`email`。 |
| `campaign_id` | 活动 ID。 | `summer_2026`。 |
| `tenant` | 租户或业务线。 | `demo`。 |
| `app_version` | 前端应用版本。 | `1.3.0`。 |
| `experiment_id` | 实验或 AB 分组。 | `exp_home_hero_a`。 |

### 3.4 点击采集强化

运营侧点击采集优先使用声明式标记：

```html
<button
  data-track-id="checkout-submit"
  data-track-name="提交订单"
  data-track-area="checkout"
>
  提交订单
</button>
```

预期字段：

```json
{
  "event": "$click",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "track_id": "checkout-submit",
    "track_name": "提交订单",
    "area": "checkout",
    "tag": "button"
  }
}
```

规则：

- `data-track-id` 优先级高于自动 selector。
- `data-track-name` 可以用于分析展示，但需要脱敏和长度限制。
- 未声明的普通元素可按配置采集，但默认只采标签和位置，不采文本。
- 输入类元素不采集真实值。

### 3.5 曝光采集强化

运营侧曝光建议只采集明确声明的元素：

```html
<section
  data-exposure-id="home-banner-01"
  data-exposure-name="首页首屏 Banner"
  data-exposure-area="home"
>
  ...
</section>
```

预期字段：

```json
{
  "event": "$exposure",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "exposure_id": "home-banner-01",
    "exposure_name": "首页首屏 Banner",
    "area": "home",
    "ratio": 0.5,
    "duration": 1000
  }
}
```

规则：

- 默认同一元素同一页面只上报一次。
- 支持配置 `once: false`，用于列表重复曝光分析。
- 列表场景必须传入业务稳定 ID，避免只用索引。
- 曝光事件不采集元素内部完整文本。

### 3.6 转化采集

新增转化 API：

```ts
sdk.conversion("order_paid", {
  orderId: "order_10001",
  amount: 199,
  currency: "CNY"
});
```

预期字段：

```json
{
  "event": "$conversion",
  "domain": "operation",
  "type": "conversion",
  "event_properties": {
    "conversion_id": "order_paid",
    "orderId": "order_10001",
    "amount": 199,
    "currency": "CNY"
  }
}
```

约束：

- 金额字段只用于统计，不作为财务对账依据。
- 订单号、手机号、邮箱等字段需要接入方确认是否允许采集。
- SDK 不采集支付凭证、银行卡、证件号。

### 3.7 运营分析口径

| 指标 | 计算方式 |
| --- | --- |
| PV | `$pageview` 数量。 |
| UV | `distinct_id` 去重数。 |
| 登录用户数 | `user_id` 去重数。 |
| 页面平均停留时长 | `$pageleave.event_properties.duration` 平均值。 |
| 点击率 | `$click` 数量 / `$exposure` 数量。 |
| 转化率 | `$conversion` 数量 / 指定漏斗起点事件数量。 |
| 活动转化 | 按 `campaign_id` 聚合 `$conversion`。 |

### 3.8 运营侧传输策略

运营侧事件统一使用 Pixel GET 上报：

- `$pageview`
- `$click`
- `$exposure`
- `$conversion`
- `$replay_start`
- `$replay_chunk`
- `$replay_end`
- `$heatmap_click`
- `$heatmap_scroll`
- `$heatmap_exposure`

当 URL 超过长度阈值、字段较大或页面即将离开时，SDK 只允许继续使用 `aly.gif` 像素请求。字段需要先经过脱敏、截断和 consent 判断；截断后仍超长则丢弃当前事件并记录诊断。

录屏和热力图补充规则见 [录屏与热力图采集设计](/Users/chudong/Documents/custom-sdk/docs/sdk/replay-heatmap.md)。

## 4. 开发者侧采集

### 4.1 采集目标

开发者侧需要回答：

- 页面有没有 JS 异常。
- Promise 异常是否被遗漏处理。
- 静态资源是否加载失败。
- 接口是否失败、变慢或被取消。
- Web Vitals 是否达到体验标准。
- SDK 自身是否降级、丢弃、重试或缓存。
- 哪些页面、版本、浏览器、网络环境问题最多。
- 异常发生时是否有关联的 `replay_id` 可用于回放现场。

### 4.2 默认事件

| 事件 | 类型 | 默认状态 | 触发条件 | 核心字段 |
| --- | --- | --- | --- | --- |
| `$js_error` | error | 开启 | `window.onerror` 捕获运行时异常。 | `message`、`stack`、`filename`、`lineno`、`colno`。 |
| `$promise_error` | error | 开启 | 未处理 Promise rejection。 | `message`、`stack`、`reason_type`。 |
| `$resource_error` | error | 开启 | 脚本、样式、图片等资源加载失败。 | `tag`、`url`、`resource_type`。 |
| `$api` | api | 关闭 | `fetch` 或 XHR 完成、失败、取消或超时。 | `url`、`method`、`status`、`duration`、`success`。 |
| `$web_vitals` | performance | 开启 | Web Vitals 指标产生或页面隐藏。 | `name`、`value`、`rating`。 |
| `$sdk_diagnostic` | diagnostic | 开启 | SDK 发生降级、丢弃、重试、缓存等内部状态。 | `code`、`level`、`message`。 |

### 4.3 开发公共属性

推荐注入：

```ts
sdk.register({
  release: "web@1.3.0",
  build_id: "20260609.1",
  env: "production",
  git_sha: "a1b2c3d"
});
```

字段说明：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `release` | 前端发布版本。 | `web@1.3.0`。 |
| `build_id` | 构建 ID。 | `20260609.1`。 |
| `env` | 环境。 | `production`。 |
| `git_sha` | Git 提交短 ID。 | `a1b2c3d`。 |

### 4.4 异常采集强化

异常事件需要额外补充：

| 字段 | 说明 |
| --- | --- |
| `error_id` | SDK 生成的错误指纹 ID。 |
| `message` | 脱敏后的错误信息。 |
| `stack` | 脱敏并截断后的堆栈。 |
| `error_type` | 错误类型，例如 `TypeError`。 |
| `source` | `onerror`、`unhandledrejection` 或 `resource`。 |
| `severity` | `fatal`、`error`、`warning`。 |
| `handled` | 是否已被业务处理。 |

错误指纹建议由以下字段生成：

```text
event + error_type + normalized_message + filename + lineno + colno
```

### 4.5 API 采集强化

API 监控字段：

```json
{
  "event": "$api",
  "domain": "developer",
  "type": "api",
  "event_properties": {
    "url": "https://api.example.com/users",
    "path": "/users",
    "method": "GET",
    "status": 200,
    "duration": 120,
    "success": true,
    "request_type": "fetch",
    "trace_id": "trace_10001"
  }
}
```

规则：

- 默认只采集 URL 元数据，不采集请求体和响应体。
- URL query 必须脱敏。
- 支持 `traceparent`、`x-request-id` 等安全请求 ID 白名单。
- 上报 endpoint 必须排除。
- `AbortController` 取消需要记录 `aborted: true`。
- 超时需要记录 `timeout: true`。

### 4.6 性能采集强化

性能事件增加页面体验分级：

| 指标 | good | needs-improvement | poor |
| --- | --- | --- | --- |
| LCP | `<= 2500ms` | `<= 4000ms` | `> 4000ms` |
| INP | `<= 200ms` | `<= 500ms` | `> 500ms` |
| CLS | `<= 0.1` | `<= 0.25` | `> 0.25` |
| FCP | `<= 1800ms` | `<= 3000ms` | `> 3000ms` |
| TTFB | `<= 800ms` | `<= 1800ms` | `> 1800ms` |

预期字段：

```json
{
  "event": "$web_vitals",
  "domain": "developer",
  "type": "performance",
  "event_properties": {
    "name": "LCP",
    "value": 2300,
    "rating": "good",
    "navigation_type": "navigate"
  }
}
```

### 4.7 SDK 自诊断

SDK 自诊断事件用于开发和接入排障：

| code | level | 说明 |
| --- | --- | --- |
| `transport_retry` | warning | 上报失败并进入重试。 |
| `offline_saved` | info | 事件写入离线缓存。 |
| `queue_dropped` | warning | 队列超限丢弃事件。 |
| `storage_unavailable` | warning | IndexedDB 不可用并降级。 |
| `plugin_failed` | error | 插件初始化或运行失败。 |
| `privacy_dropped` | info | 事件被 `beforeSend` 或 consent 丢弃。 |

预期字段：

```json
{
  "event": "$sdk_diagnostic",
  "domain": "developer",
  "type": "diagnostic",
  "event_properties": {
    "code": "queue_dropped",
    "level": "warning",
    "dropped_count": 3
  }
}
```

约束：

- 自诊断事件必须限频，避免故障时产生风暴。
- 自诊断事件不得包含原始敏感 payload。
- 当传输不可用时，自诊断事件可以只进入 debug 日志，不强制上报。

### 4.8 开发者侧传输策略

开发者侧事件通常字段更长，但上传出口仍只能使用 Pixel GET：

- 异常事件可能包含 `stack`。
- API 事件可能包含耗时、状态和 trace 信息。
- Web Vitals 事件需要按页面隐藏时机 flush。

开发者侧事件默认不通过 Pixel URL 传输长堆栈、请求体、响应体或敏感调试字段。长堆栈应转换为 `error_id`、摘要、错误类型和有限长度 message；`$sdk_diagnostic` 必须限频。

当录屏开启且采样命中时，异常事件可以携带 `replay_id`，但不得携带录屏分片原文。

## 5. 双模块配置

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif",
  modules: {
    operation: {
      enabled: true,
      page: true,
      click: false,
      exposure: false,
      conversion: true,
      replay: false,
      heatmap: false
    },
    developer: {
      enabled: true,
      error: true,
      api: false,
      performance: true,
      diagnostic: true
    }
  }
});
```

推荐默认：

- 运营侧：页面访问开启，点击和曝光默认关闭，转化手动调用。
- 开发者侧：异常、性能、自诊断开启，API 监控默认关闭。

## 6. 数据隔离与权限

| 数据 | 运营侧可见 | 开发者侧可见 | 说明 |
| --- | --- | --- | --- |
| 页面路径 | 是 | 是 | 两侧共用。 |
| 渠道和活动 | 是 | 可选 | 开发侧通常只用于定位版本问题。 |
| 点击和曝光 | 是 | 否 | 默认不进入开发问题分析。 |
| JS 错误 | 聚合趋势 | 是 | 运营侧可看影响趋势，不看完整堆栈。 |
| API 失败 | 聚合趋势 | 是 | 运营侧看影响转化，开发侧看 URL、状态和耗时。 |
| 性能指标 | 聚合体验分 | 是 | 开发侧可看细分浏览器、版本、页面。 |
| SDK 诊断 | 否 | 是 | 仅用于接入排障。 |

## 7. 端到端验收

运营侧验收：

- 首页访问产生 `$pageview`，包含渠道、活动、页面路径。
- 声明式按钮点击产生 `$click`，不包含输入值。
- 声明式 Banner 曝光产生 `$exposure`。
- 手动转化产生 `$conversion`。
- 能按渠道、页面、入口和活动计算 PV、UV、点击率和转化率。

开发者侧验收：

- JS Error 和 Promise Error 能稳定上报。
- 资源加载失败能区分资源类型和 URL。
- API 失败、超时、取消能生成 `$api`。
- Web Vitals 能生成评分。
- 队列丢弃、离线缓存、重试能生成 `$sdk_diagnostic` 或 debug 日志。
- 所有开发者侧事件不包含请求体、响应体、Cookie 和输入值。
