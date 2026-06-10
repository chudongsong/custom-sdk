import { parseHits } from "/admin/admin-parser.js";

const state = {
  report: parseHits([]),
  selectedSession: "",
  selectedEventId: "",
  domain: "all"
};

const nodes = {
  metrics: document.querySelector("#metrics"),
  sessions: document.querySelector("#sessions"),
  sessionCount: document.querySelector("#sessionCount"),
  timeline: document.querySelector("#timeline"),
  detail: document.querySelector("#detail"),
  selectedEvent: document.querySelector("#selectedEvent"),
  profiles: document.querySelector("#profiles"),
  profileCount: document.querySelector("#profileCount"),
  behaviorPaths: document.querySelector("#behaviorPaths"),
  behaviorPathCount: document.querySelector("#behaviorPathCount"),
  heatmap: document.querySelector("#heatmap"),
  heatmapTotal: document.querySelector("#heatmapTotal"),
  replayList: document.querySelector("#replayList"),
  replayCount: document.querySelector("#replayCount"),
  refreshBtn: document.querySelector("#refreshBtn"),
  domainFilter: document.querySelector("#domainFilter"),
  empty: document.querySelector("#emptyState")
};

nodes.refreshBtn.addEventListener("click", load);
nodes.domainFilter.addEventListener("change", () => {
  state.domain = nodes.domainFilter.value;
  render();
});

await load();
window.setInterval(load, 3000);

async function load() {
  const [hitsResponse, statsResponse] = await Promise.all([
    fetch("/__hits", { cache: "no-store" }),
    fetch("/__stats", { cache: "no-store" }).catch(() => undefined)
  ]);
  const hits = await hitsResponse.json();
  const stats = statsResponse?.ok ? await statsResponse.json() : {};
  state.report = parseHits(hits, stats);
  render();
}

function render() {
  renderMetrics();
  renderSessions();
  renderTimeline();
  renderProfiles();
  renderBehaviorPaths();
  renderHeatmap();
  renderReplay();
}

function renderMetrics() {
  const metrics = state.report.metrics;
  const items = [
    ["事件总数", metrics.total],
    ["会话", metrics.sessions],
    ["访客", metrics.visitors],
    ["页面访问", metrics.pageviews],
    ["点击", metrics.clicks],
    ["表单", metrics.forms],
    ["转化", metrics.conversions],
    ["行为路径", metrics.behaviorPaths],
    ["离线补发", metrics.offlineReplayed],
    ["服务端去重", metrics.serverDuplicates],
    ["异常", metrics.errors]
  ];

  nodes.metrics.innerHTML = items.map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderSessions() {
  const sessions = state.report.sessions;
  nodes.sessionCount.textContent = String(sessions.length);

  if (!sessions.length) {
    nodes.sessions.replaceChildren(emptyNode());
    return;
  }

  nodes.sessions.innerHTML = sessions.map((session) => `
    <button class="session-item ${state.selectedSession === session.id ? "active" : ""}" data-session="${escapeAttr(session.id)}" type="button">
      <strong>${shortId(session.id)}</strong>
      <span>${session.eventCount} 个事件 · ${session.pages.length} 个页面 · ${formatDuration(session.duration)}</span>
      <span>${escapeHtml(session.lastAction || "暂无动作")}</span>
    </button>
  `).join("");

  nodes.sessions.querySelectorAll("[data-session]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSession = button.dataset.session === state.selectedSession ? "" : button.dataset.session;
      renderTimeline();
      renderSessions();
    });
  });
}

function renderTimeline() {
  let items = state.report.timeline;
  if (state.selectedSession) {
    items = items.filter((item) => item.sessionId === state.selectedSession);
  }
  if (state.domain !== "all") {
    items = items.filter((item) => item.domain === state.domain);
  }

  if (!items.length) {
    nodes.timeline.replaceChildren(emptyNode());
    return;
  }

  nodes.timeline.innerHTML = items.map((item) => `
    <button class="timeline-item" data-event="${escapeAttr(item.id)}" data-domain="${escapeAttr(item.domain)}" type="button">
      <span>${escapeHtml(item.time)}</span>
      <span class="pill">${item.domain === "developer" ? "开发者" : "运营"}</span>
      <div>
        <strong>${escapeHtml(item.action)}</strong>
        <span>${escapeHtml(item.page)} · ${escapeHtml(item.event)}</span>
      </div>
    </button>
  `).join("");

  nodes.timeline.querySelectorAll("[data-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((candidate) => candidate.id === button.dataset.event);
      if (!item) return;
      state.selectedEventId = item.id;
      nodes.selectedEvent.textContent = item.event;
      nodes.detail.textContent = JSON.stringify(item.detail, null, 2);
    });
  });

  if (!state.selectedEventId && items[0]) {
    nodes.selectedEvent.textContent = items[0].event;
    nodes.detail.textContent = JSON.stringify(items[0].detail, null, 2);
  }
}

function renderProfiles() {
  const profiles = state.report.profiles;
  nodes.profileCount.textContent = String(profiles.length);

  if (!profiles.length) {
    nodes.profiles.replaceChildren(emptyNode());
    return;
  }

  nodes.profiles.innerHTML = profiles.map((profile) => `
    <div class="profile-item">
      <strong>${escapeHtml(shortId(profile.visitorId))}</strong>
      <span>会话 ${escapeHtml(shortId(profile.sessionId))} · ${escapeHtml(profile.deviceType || "-")} · ${escapeHtml(profile.device.language || "-")}</span>
      <span>来源 ${escapeHtml(profile.source || "direct")} · IP ${escapeHtml(profile.ip || "-")}</span>
      <span>${escapeHtml(profile.page.path || profile.page.url || "-")}</span>
    </div>
  `).join("");
}

function renderBehaviorPaths() {
  const paths = state.report.behaviorPaths;
  nodes.behaviorPathCount.textContent = String(paths.length);

  if (!paths.length) {
    nodes.behaviorPaths.replaceChildren(emptyNode());
    return;
  }

  nodes.behaviorPaths.innerHTML = paths.map((path) => `
    <div class="behavior-item">
      <strong>${escapeHtml(path.page || "-")} · ${path.eventCount} 个动作</strong>
      <span>会话 ${escapeHtml(shortId(path.sessionId))} · ${formatDuration(path.end - path.start)}</span>
      <ol class="behavior-events">
        ${path.events.slice(0, 5).map((event) => `
          <li>${escapeHtml(describeBehaviorEvent(event))}</li>
        `).join("")}
      </ol>
    </div>
  `).join("");
}

function renderHeatmap() {
  const heatmap = state.report.heatmap;
  nodes.heatmapTotal.textContent = `${heatmap.total} 次`;
  const pointMap = new Map(heatmap.points.map((point) => [`${point.x}:${point.y}`, point.count]));

  const cells = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const count = pointMap.get(`${x}:${y}`) || 0;
      const alpha = heatmap.max ? Math.max(0.12, count / heatmap.max) : 0;
      cells.push(`<div class="heat-cell" title="${x},${y}: ${count}" style="background:${count ? `rgba(15,118,110,${alpha})` : "#edf2f7"}"></div>`);
    }
  }
  nodes.heatmap.innerHTML = cells.join("");
}

function renderReplay() {
  const replay = state.report.replay;
  nodes.replayCount.textContent = String(replay.length);

  if (!replay.length) {
    nodes.replayList.replaceChildren(emptyNode());
    return;
  }

  nodes.replayList.innerHTML = replay.map((chunk) => `
    <div class="replay-item">
      <strong>${escapeHtml(shortId(chunk.replayId))} #${chunk.seq || "-"}</strong>
      <span>${escapeHtml(chunk.page.path || chunk.page.url || "-")} · ${chunk.size} 字符 · ${escapeHtml(chunk.preview)}</span>
    </div>
  `).join("");
}

function emptyNode() {
  return nodes.empty.content.firstElementChild.cloneNode(true);
}

function shortId(value = "") {
  if (!value) return "-";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  if (ms < 1000) return `${ms} 毫秒`;
  return `${Math.round(ms / 1000)} 秒`;
}

function describeBehaviorEvent(event) {
  switch (event.type) {
    case "click":
      return `点击 ${event.selector || event.text || "元素"}`;
    case "scroll_stop":
      return `滚动停留 y=${event.scroll_y ?? event.y ?? 0}`;
    case "hover_stay":
      return `鼠标停留 ${event.selector || event.text || "元素"} ${formatDuration(Number(event.stay || 0))}`;
    case "form_submit":
      return `提交表单 ${event.selector || ""}`;
    default:
      return event.type || "未知动作";
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
