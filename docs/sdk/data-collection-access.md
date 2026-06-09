# 数据采集访问说明

本文定义 SDK 采集数据的接入方式、像素上报接口、query 参数格式、服务端响应约定、调试方式和数据访问边界。

## 1. 接入方式

### 1.1 npm 接入

```ts
import { createSDK } from "@custom/analytics-sdk";
import { PagePlugin, ErrorPlugin, PerformancePlugin } from "@custom/analytics-sdk/plugins";

const sdk = createSDK();

sdk.use(PagePlugin);
sdk.use(ErrorPlugin);
sdk.use(PerformancePlugin);

sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif"
});
```

### 1.2 script 接入

```html
<script src="https://cdn.example.com/custom-sdk.umd.js"></script>
<script>
  window.CustomSDK.init({
    appId: "demo-web",
    endpoint: "https://analytics.example.com/aly.gif"
  });
</script>
```

## 2. 初始化配置

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif",
  debug: false,
  batchSize: 10,
  flushInterval: 5000,
  maxQueueSize: 500,
  sampleRate: 1,
  transport: {
    pixelEndpoint: "https://analytics.example.com/aly.gif",
    pixelMaxUrlLength: 1800,
    cacheBust: true
  },
  plugins: {
    page: true,
    error: true,
    performance: true,
    click: false,
    exposure: false,
    replay: false,
    heatmap: false,
    api: false
  },
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
  },
  replay: {
    enabled: false,
    sampleRate: 0.01,
    maxDuration: 600000,
    maskAllText: true,
    maskInput: true,
    captureMouseMove: false,
    chunkMaxLength: 1200
  },
  heatmap: {
    enabled: false,
    sampleRate: 0.1,
    click: true,
    scroll: true,
    move: false,
    exposure: true,
    gridX: 64,
    gridY: 64,
    flushInterval: 10000,
    chunkMaxLength: 1200
  },
  privacy: {
    maskInput: true,
    maskText: true,
    maskUrlQuery: true,
    sensitiveKeys: ["token", "password", "secret", "authorization"]
  }
});
```

## 3. 上报接口

### 3.1 Pixel GET 上报

所有采集事件只能使用像素 GET 上报。

```text
GET /aly.gif?ti=demo-web&ver=1.0.0&evt=pageLoad&dm=operation&sid=session_xxx&vid=visitor_xxx&p=https%3A%2F%2Fexample.com%2Fproducts&r=https%3A%2F%2Fexample.com%2Fhome&sw=1440&sh=900&vw=1280&vh=720&lg=zh-CN&rn=175454
```

浏览器请求形态：

```text
Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8
Sec-Fetch-Dest: image
Sec-Fetch-Mode: no-cors
```

服务端响应：

```text
HTTP/1.1 200 OK
Content-Type: image/gif
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
```

说明：

- 前端通过 `new Image().src` 触发请求。
- 服务端返回 1x1 透明 GIF。
- 前端不读取响应内容。
- DevTools 中仍可见请求，但表现为图片资源，不是业务 API 请求。
- URL 超长时截断、摘要化或丢弃，不切换为其他上传方式。

### 3.2 Pixel 参数

| 参数 | 说明 |
| --- | --- |
| `ti` | 应用 ID。 |
| `ver` | SDK 版本。 |
| `evt` | 事件名或事件短码。 |
| `et` | 事件类型。 |
| `dm` | 采集域，`operation` 或 `developer`。 |
| `sid` | 会话 ID。 |
| `vid` | 匿名访客 ID。 |
| `uid` | 登录用户 ID，未登录不传。 |
| `p` | 当前页面 URL，必须脱敏。 |
| `r` | 来源 URL，必须脱敏。 |
| `tl` | 页面标题，需截断。 |
| `lg` | 浏览器语言。 |
| `sw` | 屏幕宽度。 |
| `sh` | 屏幕高度。 |
| `vw` | 视口宽度。 |
| `vh` | 视口高度。 |
| `rn` | 随机数，防缓存。 |
| `ts` | 事件时间戳。 |
| `rid` | 录屏 ID，录屏事件使用。 |
| `seq` | 分片序号，录屏和热力图分片使用。 |
| `hid` | 热力图 ID，热力图事件使用。 |
| `enc` | 编码方式，例如 `json`、`lz`、`dict`。 |
| `data` | 压缩后的录屏分片或热力图聚合数据。 |

### 3.3 事件字段编码

事件进入上传层后被压缩为 query 参数：

| 事件字段 | query 参数 | 示例 |
| --- | --- | --- |
| `app_id` | `ti` | `demo-web` |
| `sdk_version` | `ver` | `1.0.0` |
| `event` | `evt` | `pageLoad` |
| `type` | `et` | `behavior` |
| `domain` | `dm` | `operation` |
| `session_id` | `sid` | `session_xxx` |
| `distinct_id` | `vid` | `visitor_xxx` |
| `user_id` | `uid` | `user_10001` |
| `page.url` | `p` | 当前页面 URL |
| `page.referrer` | `r` | 来源 URL |
| `page.title` | `tl` | 页面标题 |
| `event_properties` | `ep` | 压缩后的事件属性 |
| `properties` | `cp` | 压缩后的公共属性 |

`ep` 和 `cp` 必须先脱敏，再 JSON 序列化，最后进行 URL 安全编码。字段过长时优先删除低优先级字段。

### 3.4 状态约定

像素请求不依赖响应体，SDK 只做弱确认：

| 状态 | SDK 行为 |
| --- | --- |
| `load` | 视为图片资源加载成功。 |
| `error` | 进入重试。 |
| `timeout` | 进入重试。 |
| 重试失败 | 写入离线缓存。 |
| URL 超长 | 截断、摘要化或丢弃。 |

## 4. 事件访问方式

### 4.1 自定义事件

```ts
sdk.track("product_view", {
  productId: "sku_10001",
  price: 199
});
```

预期事件：

```json
{
  "event": "product_view",
  "type": "custom",
  "event_properties": {
    "productId": "sku_10001",
    "price": 199
  }
}
```

### 4.2 公共属性

```ts
sdk.register({
  channel: "web",
  tenant: "demo"
});
```

后续事件都会带上：

```json
{
  "properties": {
    "channel": "web",
    "tenant": "demo"
  }
}
```

### 4.3 用户身份

```ts
sdk.login("user_10001");
sdk.track("checkout_submit");
sdk.logout();
```

预期：

- `checkout_submit` 包含 `user_id: "user_10001"`。
- `logout` 后的新事件不包含 `user_id`。
- `distinct_id` 不变化。

### 4.4 运营侧转化

```ts
sdk.conversion("order_paid", {
  orderId: "order_10001",
  amount: 199,
  currency: "CNY"
});
```

预期事件：

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

### 4.5 开发者侧公共属性

```ts
sdk.register({
  release: "web@1.3.0",
  build_id: "20260609.1",
  env: "production",
  git_sha: "a1b2c3d"
});
```

开发者侧事件会带上版本和构建信息，用于按版本定位异常、接口错误和性能退化。

## 5. 预置事件名

| 事件名 | domain | 类型 | 来源 | 说明 |
| --- | --- | --- | --- | --- |
| `$pageview` | operation | behavior | PagePlugin | 页面访问。 |
| `$pageleave` | operation | behavior | PagePlugin | 页面离开。 |
| `$click` | operation | behavior | ClickPlugin | 用户点击。 |
| `$exposure` | operation | behavior | ExposurePlugin | 元素曝光。 |
| `$conversion` | operation | conversion | ConversionPlugin | 运营转化。 |
| `$replay_start` | operation | replay | ReplayPlugin | 录屏开始。 |
| `$replay_chunk` | operation | replay | ReplayPlugin | 录屏分片。 |
| `$replay_end` | operation | replay | ReplayPlugin | 录屏结束。 |
| `$heatmap_click` | operation | heatmap | HeatmapPlugin | 点击热力图。 |
| `$heatmap_scroll` | operation | heatmap | HeatmapPlugin | 滚动热力图。 |
| `$heatmap_exposure` | operation | heatmap | HeatmapPlugin | 曝光热力图。 |
| `$js_error` | developer | error | ErrorPlugin | JS 运行时错误。 |
| `$promise_error` | developer | error | ErrorPlugin | 未处理 Promise 错误。 |
| `$resource_error` | developer | error | ErrorPlugin | 资源加载错误。 |
| `$api` | developer | api | ApiPlugin | API 请求结果。 |
| `$performance` | developer | performance | PerformancePlugin | 页面性能。 |
| `$web_vitals` | developer | performance | PerformancePlugin | Web Vitals。 |
| `$sdk_diagnostic` | developer | diagnostic | DiagnosticPlugin | SDK 自诊断。 |

## 6. 数据字段访问边界

### 6.1 SDK 允许访问

- `location.href` 脱敏后的 URL。
- `document.title`。
- `document.referrer`。
- `navigator.userAgent`。
- `navigator.language`。
- 屏幕和视口尺寸。
- 声明式点击标识，例如 `data-track-id`。
- 声明式曝光标识，例如 `data-exposure-id`。
- API 请求 URL、method、status、duration。

### 6.2 SDK 默认禁止访问或发送

- Cookie 内容。
- 输入框真实值。
- 请求体。
- 响应体。
- 认证请求头。
- 未脱敏 URL query。
- 敏感 DOM 文本。

## 7. 调试方式

开启 debug：

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif",
  debug: true
});
```

debug 输出建议包含：

- SDK 初始化状态。
- 插件启停状态。
- 事件入队数量。
- flush 触发原因。
- 请求成功或失败。
- 字段截断、摘要化或丢弃原因。

debug 输出禁止包含：

- Token。
- Cookie。
- 输入值。
- 请求体。
- 响应体。

## 8. 后端落库建议

V1 后端至少需要支持：

- 批量接收。
- 根据 `batch_id` 和 `event_id` 去重。
- 校验 `app_id`。
- 记录接收时间。
- 拒绝超长 query 或非法参数。
- 对非法事件返回明确错误。

推荐核心表字段：

```text
event_id
batch_id
app_id
event
domain
type
time
received_at
distinct_id
session_id
user_id
page_url
page_path
properties_json
event_properties_json
sdk_version
```

## 9. 运营侧数据访问样例

页面 PV：

```sql
select page_path, count(*) as pv
from events
where domain = 'operation'
  and event = '$pageview'
group by page_path
order by pv desc;
```

渠道转化：

```sql
select
  properties_json->>'channel' as channel,
  count(*) as conversions,
  sum((event_properties_json->>'amount')::numeric) as amount
from events
where domain = 'operation'
  and event = '$conversion'
group by channel
order by conversions desc;
```

入口点击率：

```sql
with exposures as (
  select event_properties_json->>'exposure_id' as target_id, count(*) as exposure_count
  from events
  where domain = 'operation'
    and event = '$exposure'
  group by target_id
),
clicks as (
  select event_properties_json->>'track_id' as target_id, count(*) as click_count
  from events
  where domain = 'operation'
    and event = '$click'
  group by target_id
)
select
  exposures.target_id,
  exposure_count,
  coalesce(click_count, 0) as click_count,
  coalesce(click_count, 0)::float / nullif(exposure_count, 0) as ctr
from exposures
left join clicks on exposures.target_id = clicks.target_id;
```

录屏会话数：

```sql
select page_path, count(distinct event_properties_json->>'replay_id') as replays
from events
where domain = 'operation'
  and event = '$replay_start'
group by page_path
order by replays desc;
```

热力图聚合：

```sql
select
  page_path,
  event,
  count(*) as chunks
from events
where domain = 'operation'
  and event in ('$heatmap_click', '$heatmap_scroll', '$heatmap_exposure')
group by page_path, event
order by chunks desc;
```

## 10. 开发者侧数据访问样例

错误数量：

```sql
select event_properties_json->>'error_type' as error_type, count(*) as total
from events
where domain = 'developer'
  and type = 'error'
group by error_type
order by total desc;
```

接口错误率：

```sql
select
  event_properties_json->>'url' as url,
  count(*) as total,
  sum(case when event_properties_json->>'success' = 'false' then 1 else 0 end) as failed
from events
where domain = 'developer'
  and event = '$api'
group by url;
```

性能问题页面：

```sql
select
  page_path,
  event_properties_json->>'name' as metric,
  percentile_cont(0.75) within group (order by (event_properties_json->>'value')::numeric) as p75
from events
where domain = 'developer'
  and event = '$web_vitals'
group by page_path, metric
order by p75 desc;
```

SDK 诊断：

```sql
select
  event_properties_json->>'code' as code,
  event_properties_json->>'level' as level,
  count(*) as total
from events
where domain = 'developer'
  and event = '$sdk_diagnostic'
group by code, level
order by total desc;
```

## 11. 接入验收

- SDK 初始化无报错。
- mock server 能收到 `$pageview`。
- `track` 自定义事件包含公共属性。
- 登录后事件包含 `user_id`。
- 关闭 consent 后不再产生新事件。
- query 中敏感字段已脱敏。
- 输入框值不会进入 payload。
- 运营侧事件包含 `domain: "operation"`。
- 开发者侧事件包含 `domain: "developer"`。
- `$conversion` 可以按渠道和活动聚合。
- 录屏分片可按 `replay_id + seq` 重组。
- 热力图数据可按页面和事件类型聚合。
- `$sdk_diagnostic` 可以记录重试、降级、丢弃或缓存状态。
