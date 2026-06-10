import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { startMockServer } from "./server.mjs";

const { server, hits, url } = await startMockServer({ port: 0 });

try {
  const pageResponse = await fetch(`${url}/index.html?token=secret`);
  assert.equal(pageResponse.status, 200, "rich examples index should be served");
  const html = await pageResponse.text();
  assert.match(html, /ChinaZ/, "rich examples template should be used");
  assert.match(html, /\/sdk-demo\.js/, "SDK loader should be injected into HTML pages");

  const loader = await fetch(`${url}/sdk-demo.js`);
  assert.equal(loader.status, 200, "sdk-demo.js should be served");
  assert.match(await loader.text(), /createSDK/, "sdk-demo.js should initialize SDK");

  const sdkBundle = await fetch(`${url}/dist/custom-analytics-sdk.es.js`);
  assert.equal(sdkBundle.status, 200, "SDK ESM bundle should be served");
  const distFiles = await readdir(new URL("../../dist", import.meta.url));
  assert(distFiles.some((file) => /^rrweb-replay-.*\.js$/.test(file)), "rrweb replay should be emitted as a separate lazy chunk");

  const adminPage = await fetch(`${url}/admin`);
  assert.equal(adminPage.status, 200, "admin dashboard should be served");
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /SDK 数据后台/, "admin dashboard should render a data console");
  assert.doesNotMatch(adminHtml, /sdk-demo\.js/, "admin dashboard should not inject SDK collector into itself");

  const adminScript = await fetch(`${url}/admin/admin.js`);
  assert.equal(adminScript.status, 200, "admin dashboard script should be served");

  const duplicateUrl = `${url}/aly.gif?ti=dedupe-demo&evt=manual&eid=evt_same&sid=session_same&vid=visitor_same&dk=dedupe-demo%3Aevt_same&baid=batch_same`;
  await fetch(duplicateUrl);
  await fetch(duplicateUrl);
  const statsAfterDuplicate = await (await fetch(`${url}/__stats`)).json();
  assert.equal(hits.filter((hit) => hit.query.dk === "dedupe-demo:evt_same").length, 1, "server should store only one duplicate-key hit");
  assert.equal(statsAfterDuplicate.duplicates, 1, "server should count duplicate dropped hits");

  const dom = new JSDOM(html, {
    url: `${url}/index.html?token=secret`,
    pretendToBeVisual: true
  });

  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    history: dom.window.history,
    location: dom.window.location,
    screen: dom.window.screen,
    MouseEvent: dom.window.MouseEvent,
    Event: dom.window.Event,
    SubmitEvent: dom.window.SubmitEvent,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    crypto: dom.window.crypto
  };

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true
    });
  }
  window.fetch = fetch.bind(globalThis);

  class NetworkImage {
    onload = null;
    onerror = null;
    referrerPolicy = "";
    set src(value) {
      fetch(new URL(value, url)).then(() => this.onload?.()).catch(() => this.onerror?.());
    }
  }

  globalThis.Image = NetworkImage;

  const { createSDK } = await import("../../dist/custom-analytics-sdk.es.js");
  const sdk = createSDK({
    randomId: (prefix) => `${prefix}_smoke`,
    loadReplayRecorder: async () => ({
      createReplayRecorder: () => ({
        replayId: "replay_smoke",
        start: () => undefined,
        drain: () => [{
          replay_id: "replay_smoke",
          seq: 1,
          enc: "json",
          data: "{\"source\":\"rrweb\",\"events\":[{\"type\":\"smoke\"}]}",
          end: false
        }],
        stop: () => []
      })
    })
  });

  sdk.register({
    channel: "rich-example",
    campaign_id: "pet-care-demo",
    release: "examples-rich@1.0.0",
    env: "test"
  });

  sdk.init({
    appId: "rich-example-web",
    endpoint: `${url}/aly.gif`,
    transport: {
      pixelEndpoint: `${url}/aly.gif`,
      pixelMaxUrlLength: 1800,
      cacheBust: false
    },
    plugins: {
      click: true,
      form: true,
      api: true
    },
    behavior: {
      enabled: true,
      worker: false,
      click: true,
      scrollStop: true,
      hoverStay: true,
      maxEvents: 20,
      maxChunkLength: 1200
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
      gridX: 16,
      gridY: 16,
      chunkMaxLength: 1200
    }
  });

  const link = document.querySelector(".banner-button-left") || document.querySelector("a[href]");
  assert(link, "rich template should contain clickable links");
  link.addEventListener("click", (event) => event.preventDefault());
  link.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 80,
    screenX: 300,
    screenY: 240
  }));

  const form = document.querySelector("form");
  assert(form, "rich template should contain forms");
  const firstInput = form.querySelector("input");
  if (firstInput) firstInput.value = "13800138000";
  form.dispatchEvent(new Event("submit", {
    bubbles: true,
    cancelable: true
  }));

  await window.fetch(`${url}/api/success?token=secret`, { method: "POST" });
  sdk.track("rich_example_manual_trigger", {
    link_count: document.querySelectorAll("a").length,
    form_count: document.querySelectorAll("form").length,
    image_count: document.querySelectorAll("img").length
  });
  sdk.conversion("rich_example_conversion", { amount: 199, currency: "CNY" });
  await sdk.flush();

  const events = hits.map((hit) => hit.query.evt);
  assert(events.includes("$session_start"), "session start pixel was not received");
  assert(events.includes("$pageview"), "pageview pixel was not received");
  assert(events.includes("$click"), "click pixel was not received");
  assert(events.includes("$behavior_path"), "behavior path pixel was not received");
  assert(events.includes("$form_submit"), "form submit pixel was not received");
  assert(events.includes("$api"), "api pixel was not received");
  assert(events.includes("$conversion"), "conversion pixel was not received");
  assert(events.includes("$replay_chunk"), "replay chunk pixel was not received");
  assert(events.includes("$heatmap_click"), "heatmap pixel was not received");
  assert(hits.every((hit) => hit.query.dk), "all SDK pixels should include a dedupe key");
  assert(hits.every((hit) => hit.query.baid), "all SDK pixels should include a batch id");
  assert(hits.some((hit) => hit.ip), "server should enrich hits with client ip");
  assert(hits.some((hit) => hit.received_at), "server should enrich hits with receive time");

  const rawHits = hits.map((hit) => decodeURIComponent(hit.raw).replaceAll("+", " ")).join("\n");
  assert(rawHits.includes("link_count"), "manual trigger should include rich page counts");
  assert(rawHits.includes("section_heading"), "click payload should include section context");
  assert(rawHits.includes("field_count"), "form payload should include field metadata");
  assert(!rawHits.includes("token=secret"), "sensitive token leaked");
  assert(!rawHits.includes("13800138000"), "input value leaked");

  const { parseHits } = await import("../admin/admin-parser.js");
  const report = parseHits(hits);
  const finalStats = await (await fetch(`${url}/__stats`)).json();
  assert.equal(finalStats.duplicates, 1, "server stats should preserve duplicate count");
  assert.equal(report.metrics.sessionStarts, 1, "admin parser should count session starts");
  assert.equal(report.metrics.pageviews, 1, "admin parser should count pageviews");
  assert(report.metrics.clicks >= 1, "admin parser should count clicks");
  assert(report.metrics.behaviorPaths >= 1, "admin parser should count behavior paths");
  assert(report.metrics.forms >= 1, "admin parser should count form submits");
  assert(report.metrics.conversions >= 1, "admin parser should count conversions");
  assert(report.timeline.some((item) => item.action.includes("点击")), "admin parser should produce operation click actions");
  assert(report.timeline.some((item) => item.action.includes("行为路径")), "admin parser should produce behavior path actions");
  assert(report.timeline.some((item) => item.action.includes("提交表单")), "admin parser should produce operation form actions");
  assert(report.sessions.length >= 1, "admin parser should group events into sessions");
  assert(report.profiles.length >= 1, "admin parser should produce visitor profiles");
  assert(report.behaviorPaths.length >= 1, "admin parser should produce behavior paths");

  console.log(`Rich examples smoke test passed with ${hits.length} aly.gif hits`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
