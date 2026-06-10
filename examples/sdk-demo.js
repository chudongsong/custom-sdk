import { createSDK } from "/dist/custom-analytics-sdk.es.js";

window.__customAnalyticsDemoCleanup?.();

const sdk = createSDK();

sdk.register({
  channel: "rich-example",
  campaign_id: "pet-care-demo",
  release: "examples-rich@1.0.0",
  env: "local",
  template: "mypet-static"
});

sdk.init({
  appId: "rich-example-web",
  endpoint: "/aly.gif",
  debug: true,
  batchSize: 10,
  transport: {
    pixelEndpoint: "/aly.gif",
    pixelMaxUrlLength: 1800,
    cacheBust: true,
    retryCount: 2,
    retryBaseDelay: 300,
    offlineMaxEvents: 1000
  },
  plugins: {
    click: true,
    form: true,
    api: true,
    error: true
  },
  flushInterval: 5000,
  lifecycle: {
    heartbeat: true,
    heartbeatInterval: 15000,
    visibility: true,
    flushOnHidden: true
  },
  behavior: {
    enabled: true,
    worker: true,
    click: true,
    scrollStop: true,
    hoverStay: true,
    scrollStopDelay: 300,
    hoverThreshold: 800,
    maxEvents: 80,
    maxChunkLength: 1200,
    flushInterval: 5000
  },
  replay: {
    enabled: true,
    sampleRate: 1,
    maskAllText: true,
    maskInput: true,
    chunkMaxLength: 1200
  },
  heatmap: {
    enabled: true,
    sampleRate: 1,
    click: true,
    scroll: true,
    move: false,
    exposure: false,
    gridX: 32,
    gridY: 32,
    flushInterval: 3000,
    chunkMaxLength: 1200
  },
  privacy: {
    maskInput: true,
    maskText: true,
    maskUrlQuery: true,
    sensitiveKeys: ["token", "secret", "password", "email", "phone", "authorization"]
  }
});

let flushTimer = 0;

function scheduleFlush(delay = 600) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    void sdk.flush();
  }, delay);
}

const clickFlush = () => scheduleFlush(600);
const submitFlush = () => scheduleFlush(0);
const pagehideFlush = () => {
  void sdk.flush();
};

document.addEventListener("click", clickFlush, true);
document.addEventListener("submit", submitFlush, true);
window.addEventListener("pagehide", pagehideFlush);
void sdk.flush({
  includeReplay: false,
  includeHeatmap: false
});

window.__customAnalyticsSDK = sdk;
window.__customAnalyticsDemoCleanup = () => {
  window.clearTimeout(flushTimer);
  document.removeEventListener("click", clickFlush, true);
  document.removeEventListener("submit", submitFlush, true);
  window.removeEventListener("pagehide", pagehideFlush);
  sdk.destroy();
};
window.__customAnalyticsTrigger = async () => {
  await window.fetch("/api/success?token=secret", { method: "POST" });
  sdk.track("rich_example_manual_trigger", {
    page_kind: document.body.className || "template",
    link_count: document.querySelectorAll("a").length,
    form_count: document.querySelectorAll("form").length,
    image_count: document.querySelectorAll("img").length
  });
  sdk.conversion("rich_example_conversion", {
    amount: 199,
    currency: "CNY",
    source: "manual_trigger"
  });
  await sdk.flush();
};
