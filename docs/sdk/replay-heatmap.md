# 录屏与热力图采集设计

本文定义 V1 中的录屏回放和热力图能力。两者属于体验分析增强层，默认关闭，必须显式开启、采样、脱敏，并受 consent 控制。上传仍只允许使用 `GET /aly.gif?...` 像素请求。

## 1. 定位

| 模块 | 面向对象 | 目标 | 默认状态 |
| --- | --- | --- | --- |
| `ReplayPlugin` | 产品、运营、开发者 | 回放用户关键会话，辅助理解转化阻塞、异常现场和体验问题。 | 关闭 |
| `HeatmapPlugin` | 产品、运营、增长 | 统计点击、滚动、移动和曝光热区，辅助优化页面布局和转化入口。 | 关闭 |

V1 只做轻量版：

- 不录制真实视频。
- 不录制输入框真实值。
- 不采集 Cookie、Token、请求体、响应体。
- 不采集 Canvas 像素、视频帧、音频、摄像头、麦克风。
- 不采集跨域 iframe 内容。
- 提供本地数据后台用于解析 `/__hits`，但生产级权限、存储和回放播放器仍需单独建设。

## 2. 录屏回放

### 2.1 采集目标

录屏用于回答：

- 用户进入页面后按什么路径操作。
- 用户在哪个步骤停留、回退、重复点击。
- 异常发生前用户做了什么。
- 页面布局、弹窗、提示和按钮状态是否影响转化。

### 2.2 事件

| 事件 | 类型 | domain | 说明 |
| --- | --- | --- | --- |
| `$replay_start` | replay | operation | 录屏会话开始。 |
| `$replay_chunk` | replay | operation | 录屏分片数据。 |
| `$replay_end` | replay | operation | 录屏会话结束。 |

### 2.3 采集内容

| 类型 | V1 是否采集 | 说明 |
| --- | --- | --- |
| DOM 初始快照 | 是 | 只保留结构、标签、必要属性和脱敏文本。 |
| DOM 增量变化 | 是 | 节流采集，避免高频 mutation。 |
| 鼠标点击 | 是 | 坐标、目标元素标识、时间戳。 |
| 鼠标移动 | 默认否 | 开启后降采样。 |
| 滚动 | 是 | 页面或容器滚动位置。 |
| 输入事件 | 是 | 只记录发生过输入，不记录输入值。 |
| 路由变化 | 是 | 记录 SPA 路由变化。 |
| 视口变化 | 是 | 记录 viewport 和屏幕尺寸变化。 |
| Canvas、视频、音频 | 否 | V1 不支持。 |
| 跨域 iframe | 否 | 只记录 iframe 元素存在。 |

### 2.4 隐私规则

默认策略：

- `maskAllText: true`，页面文本默认替换为 `[masked]`。
- `maskInput: true`，输入框值永远不采集。
- `maskSelectors` 命中的节点替换为占位节点。
- `blockSelectors` 命中的节点完全不采集子树。
- URL query 先脱敏再写入录屏事件。
- class、id、selector 需要长度限制和敏感词过滤。

推荐配置：

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif",
  plugins: {
    replay: false
  },
  replay: {
    enabled: false,
    sampleRate: 0.01,
    maxDuration: 600000,
    maxEvents: 3000,
    maskAllText: true,
    maskInput: true,
    captureMouseMove: false,
    mutationThrottle: 500,
    chunkMaxLength: 1200,
    maskSelectors: [".user-name", ".phone", ".email"],
    blockSelectors: [".payment-form", ".password-panel"]
  }
});
```

### 2.5 数据分片

由于上传只能使用 `aly.gif`，录屏数据必须分片：

```text
GET /aly.gif?evt=$replay_chunk&dm=operation&rid=replay_xxx&seq=1&enc=json&data=...
```

参数：

| 参数 | 说明 |
| --- | --- |
| `rid` | 录屏 ID。 |
| `seq` | 分片序号，从 1 开始。 |
| `sid` | 会话 ID。 |
| `vid` | 访客 ID。 |
| `enc` | 编码方式，例如 `json`、`lz`、`dict`。 |
| `data` | 脱敏、压缩、URL 安全编码后的分片内容。 |
| `end` | 是否最后一个分片，`1` 表示结束。 |

规则：

- 单个 `aly.gif` URL 默认不超过 1800 字符。
- `data` 建议不超过 1200 字符。
- 分片失败后进入重试。
- 重试失败写入离线缓存。
- 缓存超过上限后丢弃最旧分片。
- 服务端按 `rid + seq` 重组。

### 2.6 录屏关联

录屏 ID 需要写入同一会话内的异常和转化事件：

```json
{
  "event": "$js_error",
  "domain": "developer",
  "event_properties": {
    "error_id": "err_xxx",
    "replay_id": "replay_xxx"
  }
}
```

这样开发者可以通过异常事件定位用户现场，运营侧也可以抽样查看转化失败会话。

## 3. 热力图

### 3.1 采集目标

热力图用于回答：

- 用户主要点击哪些区域。
- 页面哪些区域被看到。
- 用户滚动深度如何。
- 哪些入口曝光多但点击少。
- 首屏、模块、按钮和列表卡片的注意力分布。

### 3.2 事件

| 事件 | 类型 | domain | 说明 |
| --- | --- | --- | --- |
| `$heatmap_click` | heatmap | operation | 点击热力图聚合。 |
| `$heatmap_scroll` | heatmap | operation | 滚动深度聚合。 |
| `$heatmap_move` | heatmap | operation | 鼠标移动热力图预留事件，当前默认不实现。 |
| `$heatmap_exposure` | heatmap | operation | 曝光热区聚合。 |

### 3.3 聚合策略

V1 不逐点上传高频轨迹，而是在本地聚合：

- 点击热力图：按视口归一化坐标分桶。
- 滚动热力图：按页面高度百分比分桶。
- 移动热力图：默认关闭，开启后采样和节流。
- 曝光热力图：按 `data-track-id`、`data-track-name` 或可见语义容器聚合。

推荐分桶：

```ts
{
  gridX: 64,
  gridY: 64,
  scrollBuckets: 100,
  flushInterval: 10000
}
```

### 3.4 上传格式

点击热力图示例：

```text
GET /aly.gif?evt=$heatmap_click&dm=operation&hid=hm_xxx&p=%2Fhome&vw=1280&vh=720&grid=64x64&data=...
```

`data` 内容为本地聚合后的稀疏矩阵，经过脱敏、压缩和 URL 安全编码。

示例解码后结构：

```json
{
  "points": [
    [12, 18, 4],
    [20, 30, 9]
  ]
}
```

数组含义：

- 第一位：x 分桶。
- 第二位：y 分桶。
- 第三位：计数。

滚动热力图示例：

```text
GET /aly.gif?evt=$heatmap_scroll&dm=operation&hid=hm_xxx&p=%2Fhome&grid=64x64&data=...
```

解码后结构：

```json
{
  "depth_points": [
    [0, 12, 3],
    [0, 44, 1]
  ]
}
```

曝光热力图示例：

```text
GET /aly.gif?evt=$heatmap_exposure&dm=operation&hid=hm_xxx&p=%2Fhome&grid=64x64&data=...
```

解码后结构：

```json
{
  "exposures": [
    {
      "selector": "[data-track-id=\"hero-section\"]",
      "text": "Hero",
      "count": 2
    }
  ]
}
```

### 3.5 配置

```ts
sdk.init({
  appId: "demo-web",
  endpoint: "https://analytics.example.com/aly.gif",
  plugins: {
    heatmap: false
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
    scrollBuckets: 100,
    flushInterval: 10000,
    chunkMaxLength: 1200
  }
});
```

## 4. 性能控制

- 录屏默认采样率不超过 1%。
- 热力图默认采样率不超过 10%。
- 鼠标移动默认关闭。
- DOM mutation 必须节流。
- 分片上传必须排队，避免瞬间创建大量图片请求。
- 页面隐藏时只 flush 已聚合数据，不做重计算。
- 长时间会话需要设置最大录制时长。

## 5. 验收标准

- 未开启 consent 时不采集录屏和热力图。
- 默认配置下录屏和热力图均关闭。
- 开启录屏后生成 `$replay_start`、`$replay_chunk`、`$replay_end`。
- 开启热力图后按配置生成 `$heatmap_click`、`$heatmap_scroll` 和 `$heatmap_exposure`。
- 所有上传都使用 `GET /aly.gif?...`。
- 输入框真实值、Cookie、Token、请求体、响应体不得进入分片。
- URL 超长时截断、摘要化或丢弃，不切换上传方式。
- 录屏分片可通过 `rid + seq` 重组。
