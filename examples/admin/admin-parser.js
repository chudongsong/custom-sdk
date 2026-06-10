const EVENT_LABELS = {
  "$pageview": "访问页面",
  "$pageleave": "离开页面",
  "$click": "点击元素",
  "$form_submit": "提交表单",
  "$conversion": "完成转化",
  "$session_start": "会话开始",
  "$heartbeat": "在线心跳",
  "$visibility_change": "页面可见性",
  "$behavior_path": "行为路径",
  "$api": "接口请求",
  "$js_error": "JS 异常",
  "$promise_error": "Promise 异常",
  "$resource_error": "资源异常",
  "$sdk_diagnostic": "SDK 诊断",
  "$replay_start": "录屏开始",
  "$replay_chunk": "录屏分片",
  "$heatmap_click": "热力图聚合"
};

export function parseHits(hits = []) {
  const events = hits.map(parseHit).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
  const operationEvents = events.filter((event) => event.domain === "operation");
  const developerEvents = events.filter((event) => event.domain === "developer");
  const sessions = groupSessions(events);

  return {
    metrics: {
      total: events.length,
      operation: operationEvents.length,
      developer: developerEvents.length,
      sessions: sessions.length,
      visitors: new Set(events.map((event) => event.visitorId).filter(Boolean)).size,
      pageviews: count(events, "$pageview"),
      clicks: count(events, "$click"),
      forms: count(events, "$form_submit"),
      conversions: count(events, "$conversion"),
      sessionStarts: count(events, "$session_start"),
      heartbeats: count(events, "$heartbeat"),
      visibilityChanges: count(events, "$visibility_change"),
      behaviorPaths: count(events, "$behavior_path"),
      offlineReplayed: events.filter((event) => event.eventProperties.delivery_status === "offline_replayed").length,
      api: count(events, "$api"),
      errors: events.filter((event) => event.type === "error").length,
      replayChunks: count(events, "$replay_chunk"),
      heatmapEvents: events.filter((event) => event.event.startsWith("$heatmap")).length
    },
    sessions,
    profiles: buildProfiles(events),
    timeline: events.map(toTimelineItem),
    heatmap: buildHeatmap(events),
    behaviorPaths: buildBehaviorPaths(events),
    replay: events
      .filter((event) => event.event === "$replay_chunk")
      .map((event) => ({
        replayId: event.replayId,
        seq: event.seq,
        page: event.page,
        size: String(event.query.data || "").length,
        preview: summarizeReplay(event)
      })),
    rawEvents: events
  };
}

export function parseHit(hit) {
  if (!hit || !hit.query) return null;
  const query = hit.query;
  const event = query.evt || "unknown";
  const eventProperties = safeJson(query.ep);
  const commonProperties = safeJson(query.cp);
  const data = safeJson(query.data);
  const timestamp = Number(query.ts || Date.now());

  return {
    event,
    label: EVENT_LABELS[event] || event,
    type: query.et || "",
    domain: query.dm || "operation",
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    appId: query.ti || "",
    sdkVersion: query.ver || "",
    sessionId: query.sid || "",
    visitorId: query.vid || "",
    userId: query.uid || "",
    eventId: query.eid || "",
    receivedAt: hit.received_at || 0,
    ip: hit.ip || "",
    userAgent: hit.user_agent || "",
    referer: hit.referer || "",
    page: {
      url: query.p || "",
      path: query.pp || safePath(query.p),
      title: query.tl || "",
      referrer: query.r || "",
      host: query.ph || ""
    },
    device: {
      screen: `${query.sw || "-"} x ${query.sh || "-"}`,
      viewport: `${query.vw || "-"} x ${query.vh || "-"}`,
      language: query.lg || "",
      timezone: query.tz || "",
      dpr: query.dpr || "",
      online: query.onl === "1"
    },
    replayId: query.rid || eventProperties.replay_id || "",
    heatmapId: query.hid || eventProperties.heatmap_id || "",
    seq: Number(query.seq || eventProperties.seq || 0),
    grid: query.grid || eventProperties.grid || "",
    data,
    eventProperties,
    commonProperties,
    query,
    raw: hit.raw || ""
  };
}

function groupSessions(events) {
  const map = new Map();
  for (const event of events) {
    const key = event.sessionId || event.visitorId || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        visitorId: event.visitorId,
        userId: event.userId,
        start: event.timestamp,
        end: event.timestamp,
        eventCount: 0,
        pages: new Set(),
        conversions: 0,
        errors: 0,
        lastAction: ""
      });
    }
    const session = map.get(key);
    session.start = Math.min(session.start, event.timestamp);
    session.end = Math.max(session.end, event.timestamp);
    session.eventCount += 1;
    if (event.page.path) session.pages.add(event.page.path);
    if (event.event === "$conversion") session.conversions += 1;
    if (event.type === "error") session.errors += 1;
    session.lastAction = toTimelineItem(event).action;
  }

  return Array.from(map.values())
    .map((session) => ({
      ...session,
      duration: Math.max(0, session.end - session.start),
      pages: Array.from(session.pages)
    }))
    .sort((a, b) => b.end - a.end);
}

function toTimelineItem(event) {
  const props = event.eventProperties;
  return {
    id: event.eventId || `${event.event}-${event.timestamp}`,
    event: event.event,
    domain: event.domain,
    type: event.type,
    time: formatTime(event.timestamp),
    timestamp: event.timestamp,
    page: event.page.path || event.page.url || "-",
    title: event.page.title || "-",
    action: describeAction(event, props),
    sessionId: event.sessionId,
    visitorId: event.visitorId,
    detail: event
  };
}

function describeAction(event, props) {
  switch (event.event) {
    case "$pageview":
      return `访问 ${event.page.title || event.page.path || event.page.url || "页面"}`;
    case "$pageleave":
      return `离开页面，停留 ${formatDuration(Number(props.duration || 0))}`;
    case "$click":
      return `点击 ${props.track_name || props.text || props.selector || props.tag || "元素"}${props.section_heading ? `，位于 ${props.section_heading}` : ""}`;
    case "$form_submit":
      return `提交表单 ${props.form_name || props.form_id || props.selector || ""}，字段 ${props.field_count || 0} 个`;
    case "$conversion":
      return `完成转化 ${props.conversion_id || ""}${props.amount ? `，金额 ${props.amount}` : ""}`;
    case "$session_start":
      return `会话开始，来源 ${props.source || "direct"}，设备 ${props.device_type || "-"}`;
    case "$heartbeat":
      return `在线心跳，活跃 ${formatDuration(Number(props.active_time || 0))}`;
    case "$visibility_change":
      return `页面${props.visibility_state === "hidden" ? "隐藏" : "恢复"}，停留 ${formatDuration(Number(props.duration || 0))}`;
    case "$behavior_path": {
      const data = typeof event.data === "object" ? event.data : safeJson(event.query.data);
      return `行为路径，${Array.isArray(data.events) ? data.events.length : 0} 个动作`;
    }
    case "$api":
      return `请求接口 ${props.method || "GET"} ${props.path || props.url || ""}，状态 ${props.status ?? "-"}`;
    case "$js_error":
    case "$promise_error":
    case "$resource_error":
      return `${EVENT_LABELS[event.event]}：${props.message || props.url || props.error_type || "未知错误"}`;
    case "$replay_chunk":
      return `录屏分片 ${event.replayId || ""} #${event.seq || "-"}`;
    case "$heatmap_click":
      return `热力图聚合 ${event.grid || props.grid || ""}`;
    default:
      return EVENT_LABELS[event.event] || event.event;
  }
}

function buildProfiles(events) {
  return events
    .filter((event) => event.event === "$session_start")
    .map((event) => ({
      visitorId: event.visitorId,
      sessionId: event.sessionId,
      userId: event.userId,
      ip: event.ip,
      source: event.eventProperties.source || "direct",
      visitTime: event.eventProperties.visit_time || event.timestamp,
      deviceType: event.eventProperties.device_type || "",
      onlineStartedAt: event.eventProperties.online_started_at || event.timestamp,
      page: event.page,
      device: event.device,
      receivedAt: event.receivedAt
    }));
}

function buildBehaviorPaths(events) {
  return events
    .filter((event) => event.event === "$behavior_path")
    .map((event) => {
      const data = typeof event.data === "object" ? event.data : safeJson(event.query.data);
      return {
        id: event.eventId,
        sessionId: event.sessionId,
        visitorId: event.visitorId,
        page: data.page || event.page.path || event.page.url,
        start: Number(data.start || event.query.start || event.timestamp),
        end: Number(data.end || event.query.end || event.timestamp),
        eventCount: Array.isArray(data.events) ? data.events.length : Number(event.query.event_count || 0),
        events: Array.isArray(data.events) ? data.events : [],
        raw: event
      };
    });
}

function buildHeatmap(events) {
  const points = [];
  for (const event of events) {
    if (event.event !== "$heatmap_click") continue;
    const data = typeof event.data === "object" ? event.data : safeJson(event.query.data);
    for (const point of data.points || []) {
      if (Array.isArray(point) && point.length >= 3) {
        points.push({ x: Number(point[0]), y: Number(point[1]), count: Number(point[2]) });
      }
    }
  }
  return {
    total: points.reduce((sum, point) => sum + point.count, 0),
    max: Math.max(0, ...points.map((point) => point.count)),
    points
  };
}

function summarizeReplay(event) {
  const data = typeof event.data === "object" ? event.data : safeJson(event.query.data);
  if (Array.isArray(data.events)) return `${data.events.length} 条 rrweb 事件`;
  return "未解析分片";
}

function count(events, name) {
  return events.filter((event) => event.event === name).length;
}

function safeJson(value) {
  if (!value || typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function safePath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  if (ms < 1000) return `${ms} 毫秒`;
  return `${Math.round(ms / 1000)} 秒`;
}
