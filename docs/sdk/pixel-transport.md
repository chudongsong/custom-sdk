# 像素上报传输方案

本文定义 SDK 的唯一上传模式：像素级上报。SDK 通过图片资源请求发送采集数据，上传端点统一使用 `aly.gif` 后缀。

## 1. 定位

像素上报适合：

- 页面访问。
- 页面离开前的小体积事件。
- 点击、曝光、转化等运营侧轻量事件。
- 录屏分片。
- 热力图聚合分片。
- SDK 自诊断中的低频状态。
- 不需要读取服务端响应内容的场景。

像素上报的限制：

- 不适合传输大字段。
- 不适合依赖复杂响应语义。
- 无法可靠确认服务端处理结果。
- 长堆栈、长 URL、长 selector 必须截断、摘要化或丢弃。

## 2. 请求形态

浏览器侧通过 `Image` 对象触发请求：

```ts
const img = new Image();
img.referrerPolicy = "strict-origin-when-cross-origin";
img.src = "https://analytics.example.com/aly.gif?ti=demo&evt=pageLoad&rn=175454";
```

浏览器网络面板通常表现为：

```text
GET /aly.gif?ti=demo&evt=pageLoad&rn=175454 HTTP/1.1
Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8
Sec-Fetch-Dest: image
Sec-Fetch-Mode: no-cors
```

说明：

- 这不是不可见请求，浏览器 DevTools 仍然可以看到。
- 它不是业务 API 风格的 JSON 请求，而是图片资源加载请求。
- 前端无法读取响应内容，也不依赖响应体。
- 是否发送 Cookie 取决于请求域名、浏览器策略和 Cookie 属性；SDK 方案不依赖 Cookie。

## 3. 服务端响应

服务端推荐返回 1x1 透明 GIF：

```http
HTTP/1.1 200 OK
Content-Type: image/gif
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Content-Length: 43
```

响应体为透明 GIF 字节。

也可以返回 `204 No Content`，但部分浏览器会触发图片加载失败回调，不利于统计上报成功率。V1 推荐返回 1x1 透明 GIF。

## 4. 端点设计

固定端点：

```text
GET /aly.gif
```

示例：

```text
GET /aly.gif?ti=demo-web&ver=1.0.0&evt=pageLoad&sid=session_xxx&vid=visitor_xxx&p=https%3A%2F%2Fexample.com%2Fproducts&r=https%3A%2F%2Fexample.com%2Fhome&sw=1440&sh=900&vw=1280&vh=720&lg=zh-CN&tz=Asia%2FShanghai&rn=175454
```

推荐参数：

| 参数 | 含义 | 示例 |
| --- | --- | --- |
| `ti` | 应用 ID。 | `demo-web` |
| `ver` | SDK 版本。 | `1.0.0` |
| `evt` | 事件名或短事件码。 | `pageLoad` |
| `et` | 事件类型。 | `behavior` |
| `dm` | 采集域。 | `operation` |
| `sid` | 会话 ID。 | `session_xxx` |
| `vid` | 匿名访客 ID。 | `visitor_xxx` |
| `uid` | 登录用户 ID，未登录不传。 | `user_10001` |
| `p` | 当前页面 URL，必须脱敏。 | `https%3A%2F%2Fexample.com%2Fproducts` |
| `r` | 来源 URL，必须脱敏。 | `https%3A%2F%2Fexample.com%2Fhome` |
| `tl` | 页面标题，需截断。 | `Products` |
| `lg` | 浏览器语言。 | `zh-CN` |
| `tz` | 时区。 | `Asia%2FShanghai` |
| `sw` | 屏幕宽度。 | `1440` |
| `sh` | 屏幕高度。 | `900` |
| `vw` | 视口宽度。 | `1280` |
| `vh` | 视口高度。 | `720` |
| `rn` | 随机数，防缓存。 | `175454` |
| `ts` | 事件时间戳。 | `1717939200000` |
| `rid` | 录屏 ID，仅录屏事件使用。 | `replay_xxx` |
| `seq` | 分片序号，仅分片事件使用。 | `1` |
| `hid` | 热力图 ID，仅热力图事件使用。 | `hm_xxx` |
| `enc` | 编码方式。 | `lz` |
| `data` | 压缩后的分片或聚合数据。 | `encoded` |

## 5. 参数编码

规则：

- 所有参数使用 `encodeURIComponent`。
- 参数名使用短 key，降低 URL 长度。
- 空值不传。
- 敏感字段先脱敏再编码。
- 字符串字段需要截断。
- URL 总长度默认不超过 1800 字符。

超过长度限制时：

1. 删除低优先级字段，例如标题、referrer、selector。
2. 对长字段做截断或摘要化。
3. 仍然超限时丢弃当前事件并生成 `$sdk_diagnostic` 或 debug 日志。

## 6. 传输模式

SDK 只支持 `pixel` 上传模式。

所有事件都进入队列，再由传输层拆成一条或多条 `aly.gif?...` 图片请求。大字段事件需要在入队前或出队编码前完成截断、摘要化和脱敏。

录屏分片示例：

```text
GET /aly.gif?evt=replayChunk&dm=operation&rid=replay_xxx&seq=1&enc=lz&data=...
```

热力图分片示例：

```text
GET /aly.gif?evt=heatmapClick&dm=operation&hid=hm_xxx&grid=64x64&enc=lz&data=...
```

分片规则：

- 单个请求 URL 默认不超过 1800 字符。
- `data` 建议不超过 1200 字符。
- 分片必须带 `rid + seq` 或 `hid + seq`。
- 服务端按分片序号重组或聚合。
- 分片缺失时服务端标记为不完整，不做错误补全。

## 7. SDK 配置

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif",
  transport: {
    pixelEndpoint: "https://analytics.example.com/aly.gif",
    pixelMaxUrlLength: 1800,
    cacheBust: true,
    retryCount: 2,
    retryBaseDelay: 300,
    offlineMaxEvents: 1000
  }
});
```

可靠推送相关字段：

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `batchSize` | 队列达到阈值后自动触发 `flush()`。 | 未启用 |
| `flushInterval` | 定时触发 `flush()`。 | 未启用 |
| `retryCount` | 单条像素请求失败后的重试次数。 | `0` |
| `retryBaseDelay` | 重试基础延迟，按指数退避增长。 | `300` |
| `offlineMaxEvents` | 离线缓存最大事件数。 | `1000` |

## 8. 浏览器实现建议

```ts
function sendPixel(endpoint: string, params: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const query = new URLSearchParams(params);
    query.set("rn", String(Math.floor(Math.random() * 1000000)));

    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, 3000);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(true);
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(false);
    };

    img.referrerPolicy = "strict-origin-when-cross-origin";
    img.src = `${endpoint}?${query.toString()}`;
  });
}
```

注意：

- `Image` 对象需要在函数作用域内保持引用，直到 `load/error/timeout` 完成。
- 不读取响应内容。
- 失败后可进入重试或离线缓存。
- 离场场景不应等待 Promise 完成。

## 9. 隐私与合规约束

像素上报必须遵守统一隐私规则：

- 未授权时不采集、不上报。
- 不采集 Cookie 内容。
- 不采集输入框真实值。
- 不采集请求体和响应体。
- URL query 敏感参数必须脱敏。
- 标题、文本、selector 必须截断。
- 不通过像素 URL 传输长堆栈、请求体、响应体或敏感调试信息。

## 10. 验收标准

- 事件可通过 `GET /aly.gif?...` 上报。
- 网络面板中请求类型表现为图片资源。
- 请求包含 `rn` 防缓存参数。
- 服务端返回 1x1 透明 GIF。
- URL 长度超过阈值时能截断、摘要化或丢弃。
- 像素上报不读取响应体、不阻塞页面交互。
- 关闭 consent 后不再触发像素请求。
- 敏感字段不会出现在 query 参数中。
