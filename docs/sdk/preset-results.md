# 数据采集预设结果

本文定义 SDK V1 在常见场景下应产生的事件、关键字段和预期结果，用于开发验收、QA 测试和接入方自查。

## 1. 结果约定

所有预设结果只展示关键字段，实际事件还应包含：

- `event_id`
- `domain`
- `time`
- `app_id`
- `sdk_version`
- `distinct_id`
- `session_id`
- `page`
- `device`
- `properties`
- `event_properties`

敏感值统一展示为 `[masked]`。

## 2. 初始化后页面访问

### 输入

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif"
});
```

当前页面：

```text
https://example.com/products?token=abc
```

### 预设结果

```json
{
  "event": "$pageview",
  "domain": "operation",
  "type": "behavior",
  "page": {
    "url": "https://example.com/products?token=[masked]",
    "path": "/products",
    "title": "Products"
  },
  "event_properties": {
    "navigation_type": "init"
  }
}
```

## 3. SPA 路由变化

### 输入

```ts
history.pushState({}, "", "/orders");
```

### 预设结果

```json
{
  "event": "$pageview",
  "domain": "operation",
  "type": "behavior",
  "page": {
    "path": "/orders"
  },
  "event_properties": {
    "navigation_type": "pushState"
  }
}
```

## 4. 页面离开

### 输入

用户在页面停留 35 秒后关闭页面。

### 预设结果

```json
{
  "event": "$pageleave",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "duration": 35000
  }
}
```

发送方式为 `GET /aly.gif?...` 像素请求，页面离开时不等待响应。

## 5. 自定义事件

### 输入

```ts
sdk.register({ channel: "web" });

sdk.track("product_view", {
  productId: "sku_10001",
  price: 199
});
```

### 预设结果

```json
{
  "event": "product_view",
  "domain": "operation",
  "type": "custom",
  "properties": {
    "channel": "web"
  },
  "event_properties": {
    "productId": "sku_10001",
    "price": 199
  }
}
```

## 6. 用户登录后事件

### 输入

```ts
sdk.login("user_10001");
sdk.track("checkout_submit");
```

### 预设结果

```json
{
  "event": "checkout_submit",
  "domain": "operation",
  "type": "custom",
  "user_id": "user_10001"
}
```

## 7. 点击采集

### 输入

```html
<button data-track-id="buy-button">立即购买</button>
```

用户点击按钮。

### 预设结果

```json
{
  "event": "$click",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "tag": "button",
    "text": "立即购买",
    "selector": "[data-track-id=\"buy-button\"]"
  }
}
```

## 8. 点击敏感文本

### 输入

```html
<button>token: abc123</button>
```

用户点击按钮。

### 预设结果

```json
{
  "event": "$click",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "tag": "button",
    "text": "[masked]"
  }
}
```

## 9. 输入框点击

### 输入

```html
<input value="my-password" />
```

用户点击输入框。

### 预设结果

```json
{
  "event": "$click",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "tag": "input",
    "text": ""
  }
}
```

真实输入值不得进入 payload，`value` 字段不应出现在事件中。

## 10. 曝光采集

### 输入

```html
<div data-exposure-id="home-banner">Banner</div>
```

元素进入视口 50% 以上并持续 1 秒。

### 预设结果

```json
{
  "event": "$exposure",
  "domain": "operation",
  "type": "behavior",
  "event_properties": {
    "exposure_id": "home-banner",
    "ratio": 0.5,
    "duration": 1000,
    "once": true
  }
}
```

## 11. 运营转化

### 输入

```ts
sdk.conversion("order_paid", {
  orderId: "order_10001",
  amount: 199,
  currency: "CNY"
});
```

### 预设结果

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

## 12. JS Error

### 输入

```ts
throw new TypeError("Cannot read properties of undefined");
```

### 预设结果

```json
{
  "event": "$js_error",
  "domain": "developer",
  "type": "error",
  "event_properties": {
    "message": "Cannot read properties of undefined",
    "error_type": "TypeError",
    "filename": "https://example.com/app.js",
    "lineno": 10,
    "colno": 20
  }
}
```

## 13. Promise Error

### 输入

```ts
Promise.reject(new Error("request failed"));
```

### 预设结果

```json
{
  "event": "$promise_error",
  "domain": "developer",
  "type": "error",
  "event_properties": {
    "message": "request failed",
    "error_type": "Error"
  }
}
```

## 14. Resource Error

### 输入

```html
<script src="/missing.js"></script>
```

### 预设结果

```json
{
  "event": "$resource_error",
  "domain": "developer",
  "type": "error",
  "event_properties": {
    "tag": "script",
    "url": "https://example.com/missing.js"
  }
}
```

## 15. fetch 成功

### 输入

```ts
await fetch("/api/users");
```

### 预设结果

```json
{
  "event": "$api",
  "domain": "developer",
  "type": "api",
  "event_properties": {
    "url": "https://example.com/api/users",
    "method": "GET",
    "status": 200,
    "success": true,
    "duration": 120
  }
}
```

## 16. fetch 失败

### 输入

```ts
await fetch("/api/users?access_token=abc");
```

服务端返回 500。

### 预设结果

```json
{
  "event": "$api",
  "domain": "developer",
  "type": "api",
  "event_properties": {
    "url": "https://example.com/api/users?access_token=[masked]",
    "method": "GET",
    "status": 500,
    "success": false
  }
}
```

## 17. Web Vitals

### 输入

浏览器产生 LCP 指标。

### 预设结果

```json
{
  "event": "$web_vitals",
  "domain": "developer",
  "type": "performance",
  "event_properties": {
    "name": "LCP",
    "value": 2300,
    "rating": "needs-improvement"
  }
}
```

## 18. SDK 自诊断

### 输入

队列达到上限后丢弃 3 条旧事件。

### 预设结果

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

## 19. 录屏分片

### 输入

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif",
  replay: {
    enabled: true,
    sampleRate: 1,
    maskAllText: true,
    maskInput: true,
    chunkMaxLength: 1200
  }
});
```

用户发生点击和滚动。

### 预设结果

```json
{
  "event": "$replay_chunk",
  "domain": "operation",
  "type": "replay",
  "event_properties": {
    "replay_id": "replay_xxx",
    "seq": 1,
    "enc": "lz",
    "end": false
  }
}
```

像素请求：

```text
GET /aly.gif?evt=$replay_chunk&dm=operation&rid=replay_xxx&seq=1&enc=lz&data=...
```

输入框真实值和页面敏感文本不得出现在 `data` 中。

## 20. 热力图聚合

### 输入

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif",
  heatmap: {
    enabled: true,
    sampleRate: 1,
    click: true,
    scroll: true,
    move: false,
    exposure: true,
    gridX: 64,
    gridY: 64
  }
});
```

用户点击页面多个区域、滚动页面，并让标记元素进入视口。

### 预设结果

```json
{
  "event": "$heatmap_click",
  "domain": "operation",
  "type": "heatmap",
  "event_properties": {
    "heatmap_id": "hm_xxx",
    "kind": "click",
    "grid": "64x64"
  }
}
```

像素请求，同一次 flush 可能同时生成：

```text
GET /aly.gif?evt=$heatmap_click&dm=operation&hid=hm_xxx&grid=64x64&enc=json&data=...
GET /aly.gif?evt=$heatmap_scroll&dm=operation&hid=hm_xxx&grid=64x64&enc=json&data=...
GET /aly.gif?evt=$heatmap_exposure&dm=operation&hid=hm_xxx&grid=64x64&enc=json&data=...
```

点击 `data.points` 和滚动 `data.depth_points` 是聚合后的稀疏矩阵，曝光 `data.exposures` 是可见元素聚合结果，不上传逐点原始轨迹。

## 21. 离线缓存

### 输入

1. 网络断开。
2. 用户触发 3 条事件。
3. 网络恢复。

### 预设结果

```json
{
  "offline_saved": 3,
  "replayed": 3,
  "cache_cleared": true
}
```

## 22. 队列 flush

### 输入

连续触发 10 条事件。

### 预设结果

```json
{
  "pixel_requests": 10,
  "endpoint": "/aly.gif",
  "method": "GET"
}
```

实际应拆成多条 `aly.gif?...` 像素请求。

## 23. Pixel GET 上报

### 输入

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif",
  transport: {
    pixelEndpoint: "/aly.gif"
  }
});
```

触发 `$pageview`。

### 预设结果

```text
GET /aly.gif?ti=demo-web&evt=pageLoad&dm=operation&sid=session_xxx&vid=visitor_xxx&p=https%3A%2F%2Fexample.com%2Fproducts&rn=175454
```

请求特征：

```text
Sec-Fetch-Dest: image
Sec-Fetch-Mode: no-cors
```

服务端返回 1x1 透明 GIF，前端不读取响应内容。

## 24. Pixel URL 超长处理

### 输入

点击事件包含很长的标题、文本或 selector，导致 URL 超过 `pixelMaxUrlLength`。

### 预设结果

```json
{
  "pixel_dropped": true,
  "reason": "url_length_exceeded",
  "diagnostic": "$sdk_diagnostic"
}
```

丢弃前仍必须经过脱敏和字段截断，不允许降级到其他上传方式。

## 25. consent 关闭

### 输入

```ts
sdk.setConsent(false);
sdk.track("product_view");
```

### 预设结果

```json
{
  "queued": 0,
  "sent": 0
}
```

## 26. beforeSend 丢弃事件

### 输入

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "/aly.gif",
  beforeSend(event) {
    if (event.event === "$click") return false;
    return event;
  }
});
```

用户点击按钮。

### 预设结果

```json
{
  "event": "$click",
  "dropped": true,
  "reason": "beforeSend"
}
```

该事件不得进入最终上报 payload。

## 27. 上报验收总览

| 场景 | 预期事件 | 必须验证 |
| --- | --- | --- |
| 初始化 | `$pageview` | URL query 脱敏。 |
| Pixel 上报 | `$pageview` | 表现为 `GET /aly.gif?...` 图片请求。 |
| 路由变化 | `$pageview` | 不重复上报。 |
| 页面离开 | `$pageleave` | 使用 `aly.gif` 像素请求提前触发。 |
| 自定义事件 | 业务事件名 | 公共属性合并。 |
| 登录用户 | 任意事件 | 包含 `user_id`。 |
| 点击 | `$click` | 输入值不采集。 |
| 曝光 | `$exposure` | 持续 1 秒才上报。 |
| 转化 | `$conversion` | 包含 `domain: operation` 和 `conversion_id`。 |
| 录屏 | `$replay_chunk` | 分片通过 `aly.gif` 上传且敏感值遮罩。 |
| 热力图 | `$heatmap_click`、`$heatmap_scroll`、`$heatmap_exposure` | 本地聚合为稀疏矩阵和曝光摘要后上传。 |
| JS 错误 | `$js_error` | stack 截断和脱敏。 |
| Promise 错误 | `$promise_error` | reason 标准化。 |
| API 请求 | `$api` | 不采请求体和响应体。 |
| 性能指标 | `$web_vitals` | 不支持时静默跳过。 |
| SDK 诊断 | `$sdk_diagnostic` | 包含 `domain: developer` 且限频。 |
| Pixel 超长 | 发送策略 | URL 超长时截断、摘要化或丢弃。 |
| 离线 | 补发原事件 | 本地缓存清理。 |
