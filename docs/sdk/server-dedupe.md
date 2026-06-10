# 服务端幂等去重方案

本文记录像素上报的服务端幂等去重实现，目标是避免重试、离线补发或浏览器重复加载导致重复入库。

## 1. 去重字段

SDK 在每条像素请求中增加两个参数：

| 参数 | 含义 | 示例 |
| --- | --- | --- |
| `baid` | 本次 flush 批次 ID。 | `batch_xxx` |
| `dk` | 去重键。 | `demo-web:$pageview:evt_xxx` |

`dk` 由 `app_id + event + event_id` 组成。重试同一个事件时 `dk` 保持不变，不同事件即使测试环境复用同一个 `event_id` 也不会互相误杀。

## 2. 服务端策略

mock server 的 `/aly.gif` 逻辑：

1. 解析 `dk`。
2. 如果没有 `dk`，使用兼容 fallback：`ti + evt + eid`。
3. 如果去重键已存在，返回 1x1 GIF，但不写入 `hits`。
4. 将重复丢弃记录写入 `duplicate_drops`。
5. `/__stats` 返回唯一键数和重复丢弃数。

## 3. 查询接口

```text
GET /__hits
```

返回已去重后的命中列表。

```text
GET /__stats
```

返回服务端统计：

```json
{
  "total": 12,
  "unique_keys": 12,
  "duplicates": 1,
  "duplicate_drops": [
    {
      "dedupe_key": "dedupe-demo:evt_same",
      "event": "manual",
      "batch_id": "batch_same",
      "received_at": 1717939200000
    }
  ]
}
```

## 4. 后台展示

后台会同时读取 `/__hits` 和 `/__stats`：

- `/__hits` 用于解析事件、会话、画像和行为路径。
- `/__stats` 用于展示“服务端去重”指标。

## 5. 当前限制

- V1 mock server 的去重状态保存在内存里，服务重启后清空。
- 生产服务需要将 `dk` 写入唯一索引或幂等表。
- 如果客户端没有 `dk` 且没有 `eid`，服务端无法可靠去重。
