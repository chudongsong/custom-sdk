import { describe, expect, it, vi } from "vitest";
import { createSDK } from "../src";
import { failNextPixelRequests, getPixelRequests } from "./setup";
import { parseHits } from "../examples/admin/admin-parser";

describe("custom analytics sdk", () => {
  it("sends pageview through aly.gif pixel request with masked url", async () => {
    history.replaceState({}, "", "/products?token=secret&name=book");
    document.title = "Products";

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "https://analytics.example.com/aly.gif"
    });

    await sdk.flush();

    const url = getPixelRequests().find((request) => decodeURIComponent(request).includes("evt=$pageview"));
    expect(url).toBeTruthy();
    expect(url).toContain("https://analytics.example.com/aly.gif?");
    expect(url).toContain("evt=%24pageview");
    expect(url).toContain("dm=operation");
    expect(decodeURIComponent(url)).toContain("token=[masked]");
    expect(decodeURIComponent(url)).not.toContain("token=secret");
  });

  it("does not send events while consent is disabled", async () => {
    const sdk = createSDK();

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      consent: false
    });
    sdk.track("product_view", { productId: "sku_1" });

    await sdk.flush();

    expect(getPixelRequests()).toHaveLength(0);
  });

  it("does not load the rrweb replay module when replay is disabled", async () => {
    let loaded = false;
    const sdk = createSDK({
      loadReplayRecorder: async () => {
        loaded = true;
        return {
          createReplayRecorder: () => ({
            replayId: "replay_fake",
            start: () => undefined,
            drain: () => [],
            stop: () => []
          })
        };
      }
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif"
    });
    await Promise.resolve();
    await sdk.flush();

    expect(loaded).toBe(false);
  });

  it("loads the rrweb replay module lazily only when replay is enabled", async () => {
    let loaded = false;
    let started = false;
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`,
      loadReplayRecorder: async () => {
        loaded = true;
        return {
          createReplayRecorder: () => ({
            replayId: "replay_lazy",
            start: () => {
              started = true;
            },
            drain: () => [{
              replay_id: "replay_lazy",
              seq: 1,
              enc: "json" as const,
              data: "{\"events\":[{\"type\":\"rrweb\"}]}",
              end: false
            }],
            stop: () => []
          })
        };
      }
    });

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

    await Promise.resolve();
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(loaded).toBe(true);
    expect(started).toBe(true);
    expect(joined).toContain("evt=$replay_start");
    expect(joined).toContain("evt=$replay_chunk");
    expect(joined).toContain("rid=replay_lazy");
    expect(joined).toContain("rrweb");
  });

  it("masks input values in replay chunks and uploads via aly.gif", async () => {
    document.body.innerHTML = `<input id="password" value="secret-value" /><button data-track-id="buy">Buy</button>`;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`,
      loadReplayRecorder: async () => ({
        createReplayRecorder: () => ({
          replayId: "replay_fixed",
          start: () => undefined,
          drain: () => [{
            replay_id: "replay_fixed",
            seq: 1,
            enc: "json" as const,
            data: "{\"events\":[{\"type\":\"rrweb\",\"value\":\"[masked]\"}]}",
            end: false
          }],
          stop: () => []
        })
      })
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      consent: true,
      replay: {
        enabled: true,
        sampleRate: 1,
        maskAllText: true,
        maskInput: true,
        chunkMaxLength: 1200
      }
    });

    await Promise.resolve();
    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$replay_chunk");
    expect(joined).toContain("rid=replay_fixed");
    expect(joined).not.toContain("secret-value");
    expect(joined).toContain("[masked]");
  });

  it("sends only session start and pageview on initial flush even when replay and heatmap are enabled", async () => {
    document.body.innerHTML = `<input id="password" value="secret-value" /><button data-track-id="buy">Buy</button>`;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
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
        exposure: false
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sdk.flush();

    const events = getPixelRequests()
      .map((url) => new URL(url, "http://localhost:3000").searchParams.get("evt"));
    expect(events).toEqual(["$session_start", "$pageview"]);
  });

  it("emits session start with source, visit time, device type, and explicit user id", async () => {
    Object.defineProperty(document, "referrer", {
      value: "https://google.example/search?q=custom-sdk&token=secret",
      configurable: true
    });
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.login("user_1001");
    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif"
    });

    await sdk.flush();

    const sessionStart = getPixelRequests()
      .map((url) => decodeURIComponent(url).replaceAll("+", " "))
      .find((url) => url.includes("evt=$session_start"));
    expect(sessionStart).toBeTruthy();
    expect(sessionStart).toContain("uid=user_1001");
    expect(sessionStart).toContain("sid=session_fixed");
    expect(sessionStart).toContain("vid=visitor_fixed");
    expect(sessionStart).toContain("\"visit_time\":1717939200000");
    expect(sessionStart).toContain("\"source\":\"https://google.example/search?q=custom-sdk&token=[masked]\"");
    expect(sessionStart).toContain("\"device_type\":\"desktop\"");
    expect(sessionStart).not.toContain("token=secret");
  });

  it("tracks heartbeat and visibility changes for the session lifecycle", async () => {
    vi.useFakeTimers();
    let now = 1717939200000;
    const sdk = createSDK({
      now: () => now,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      lifecycle: {
        heartbeat: true,
        heartbeatInterval: 1000,
        visibility: true
      }
    });

    now += 1000;
    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$heartbeat");
    expect(joined).toContain("\"active_time\":1000");
    expect(joined).toContain("evt=$visibility_change");
    expect(joined).toContain("\"visibility_state\":\"hidden\"");
    expect(joined).toContain("\"duration\":1000");
  });

  it("aggregates click, scroll stop, and hover stay into behavior path json before pixel upload", async () => {
    vi.useFakeTimers();
    let now = 1717939200000;
    document.body.innerHTML = `
      <main>
        <a id="buy" data-track-id="buy-now" href="/checkout?token=secret">Buy secret@example.com</a>
      </main>
    `;

    const sdk = createSDK({
      now: () => now,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        click: true
      },
      behavior: {
        enabled: true,
        worker: false,
        scrollStop: true,
        hoverStay: true,
        click: true,
        scrollStopDelay: 200,
        hoverThreshold: 500,
        maxEvents: 20,
        maxChunkLength: 1200
      }
    });

    window.dispatchEvent(new Event("scroll"));
    now += 200;
    vi.advanceTimersByTime(200);

    const link = document.querySelector("a");
    link?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 10, clientY: 20 }));
    now += 600;
    vi.advanceTimersByTime(600);
    link?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientX: 10, clientY: 20 }));
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 30, clientY: 40 }));

    await sdk.flush();

    const behaviorUrl = getPixelRequests()
      .map((url) => decodeURIComponent(url).replaceAll("+", " "))
      .find((url) => url.includes("evt=$behavior_path"));
    expect(behaviorUrl).toBeTruthy();
    expect(behaviorUrl).toContain("kind=behavior_path");
    expect(behaviorUrl).toContain("\"type\":\"scroll_stop\"");
    expect(behaviorUrl).toContain("\"type\":\"hover_stay\"");
    expect(behaviorUrl).toContain("\"type\":\"click\"");
    expect(behaviorUrl).toContain("\"selector\":\"[data-track-id=\\\"buy-now\\\"]\"");
    expect(behaviorUrl).not.toContain("secret@example.com");
    expect(behaviorUrl).not.toContain("token=secret");
  });

  it("aggregates heatmap clicks before pixel upload", async () => {
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      heatmap: {
        enabled: true,
        sampleRate: 1,
        click: true,
        scroll: false,
        move: false,
        exposure: false,
        gridX: 10,
        gridY: 10,
        flushInterval: 10000,
        chunkMaxLength: 1200
      }
    });

    document.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: Math.floor(window.innerWidth / 2),
      clientY: Math.floor(window.innerHeight / 2)
    }));

    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$heatmap_click");
    expect(joined).toContain("hid=hm_fixed");
    expect(joined).toContain("grid=10x10");
    expect(joined).toContain("points");
  });

  it("emits separate heatmap scroll and exposure snapshots", async () => {
    document.body.innerHTML = `
      <main style="height: 2400px">
        <section data-track-id="hero-section" style="height: 400px">Hero</section>
      </main>
    `;
    const target = document.querySelector("[data-track-id='hero-section']");
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => ({ top: 10, left: 0, right: 200, bottom: 210, width: 200, height: 200 }),
      configurable: true
    });

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      heatmap: {
        enabled: true,
        sampleRate: 1,
        click: false,
        scroll: true,
        move: false,
        exposure: true,
        gridX: 8,
        gridY: 8,
        chunkMaxLength: 1200
      }
    });

    window.dispatchEvent(new Event("scroll"));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$heatmap_scroll");
    expect(joined).toContain("kind=scroll");
    expect(joined).toContain("\"depth_points\"");
    expect(joined).toContain("evt=$heatmap_exposure");
    expect(joined).toContain("kind=exposure");
    expect(joined).toContain("hero-section");
    expect(joined).not.toContain("evt=$heatmap_click");
  });

  it("collects declarative operation clicks when click plugin is enabled", async () => {
    document.body.innerHTML = `
      <button data-track-id="checkout-submit" data-track-name="提交订单" data-track-area="checkout">
        提交订单
      </button>
    `;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        click: true
      }
    });

    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: 12,
      clientY: 34
    }));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$click");
    expect(joined).toContain("dm=operation");
    expect(joined).toContain("checkout-submit");
    expect(joined).toContain("checkout");
  });

  it("collects rich operation click metadata for common interactive elements", async () => {
    document.body.innerHTML = `
      <section id="hero" class="home hero-block">
        <h2>Featured Pet Service</h2>
        <a class="tran3s banner-button-left" href="/shop.html?token=secret">Shop Now</a>
      </section>
    `;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        click: true
      }
    });

    document.querySelector("a")?.addEventListener("click", (event) => event.preventDefault());
    document.querySelector("a")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 80,
      screenX: 140,
      screenY: 180,
      button: 0,
      metaKey: true
    }));
    await sdk.flush();

    const joined = getPixelRequests().map((url) => decodeURIComponent(url).replaceAll("+", " ")).join("\n");
    expect(joined).toContain("evt=$click");
    expect(joined).toContain("\"href\":\"http://localhost:3000/shop.html?token=[masked]\"");
    expect(joined).toContain("\"element_class\":\"tran3s banner-button-left\"");
    expect(joined).toContain("\"section_id\":\"hero\"");
    expect(joined).toContain("\"section_heading\":\"Featured Pet Service\"");
    expect(joined).toContain("\"page_x\":40");
    expect(joined).toContain("\"screen_x\":140");
    expect(joined).toContain("\"meta_key\":true");
    expect(joined).not.toContain("token=secret");
  });

  it("collects form submit metadata without field values", async () => {
    document.body.innerHTML = `
      <form id="subscribe" name="newsletter" action="/subscribe?token=secret" method="post">
        <input type="email" name="email" value="customer@example.com" />
        <input type="text" name="phone" value="13800138000" />
        <button>Subscribe</button>
      </form>
    `;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        form: true
      }
    });

    document.querySelector("form")?.dispatchEvent(new Event("submit", {
      bubbles: true,
      cancelable: true
    }));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$form_submit");
    expect(joined).toContain("\"form_id\":\"subscribe\"");
    expect(joined).toContain("\"form_name\":\"newsletter\"");
    expect(joined).toContain("\"method\":\"POST\"");
    expect(joined).toContain("\"field_count\":2");
    expect(joined).toContain("\"field_types\":[\"email\",\"text\"]");
    expect(joined).toContain("/subscribe?token=[masked]");
    expect(joined).not.toContain("customer@example.com");
    expect(joined).not.toContain("13800138000");
    expect(joined).not.toContain("token=secret");
  });

  it("does not duplicate click listeners when init is called more than once", async () => {
    document.body.innerHTML = `<button data-track-id="buy">Buy</button>`;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    const config = {
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        click: true
      }
    };

    sdk.init(config);
    sdk.init(config);

    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: 10,
      clientY: 20
    }));
    await sdk.flush();

    const clickEvents = getPixelRequests()
      .map(decodeURIComponent)
      .filter((url) => url.includes("evt=$click"));
    expect(clickEvents).toHaveLength(1);
  });

  it("coalesces high-frequency replay scroll events before a click flush", async () => {
    document.body.innerHTML = `<button data-track-id="buy">Buy</button>`;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

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

    await sdk.flush();
    const before = getPixelRequests().length;

    for (let i = 0; i < 8; i += 1) {
      window.dispatchEvent(new Event("scroll"));
    }
    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: 10,
      clientY: 20
    }));
    await sdk.flush();

    const replayChunks = getPixelRequests()
      .slice(before)
      .map(decodeURIComponent)
      .filter((url) => url.includes("evt=$replay_chunk"));
    expect(replayChunks.length).toBeLessThanOrEqual(2);
  });

  it("tracks SPA route changes as masked operation pageviews", async () => {
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif"
    });

    history.pushState({}, "", "/checkout?token=secret");
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("navigation_type\":\"pushState");
    expect(joined).toContain("/checkout?token=[masked]");
    expect(joined).not.toContain("token=secret");
  });

  it("collects masked developer js errors by default", async () => {
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif"
    });

    window.dispatchEvent(new ErrorEvent("error", {
      message: "token=secret",
      filename: "https://example.com/app.js?token=secret",
      lineno: 10,
      colno: 20
    }));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$js_error");
    expect(joined).toContain("dm=developer");
    expect(joined).toContain("token=[masked]");
    expect(joined).not.toContain("token=secret");
  });

  it("collects masked developer fetch metadata when api plugin is enabled", async () => {
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async () => new Response("ok", { status: 201 })) as unknown as typeof fetch;

    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      plugins: {
        api: true
      }
    });

    await window.fetch("https://api.example.com/users?token=secret", { method: "POST" });
    await sdk.flush();
    window.fetch = originalFetch;

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$api");
    expect(joined).toContain("dm=developer");
    expect(joined).toContain("status\":201");
    expect(joined).toContain("method\":\"POST");
    expect(joined).toContain("token=[masked]");
    expect(joined).not.toContain("token=secret");
  });

  it("drops oversized pixel payloads and emits sdk diagnostic", async () => {
    const sdk = createSDK({
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      transport: {
        pixelEndpoint: "/aly.gif",
        pixelMaxUrlLength: 120,
        cacheBust: false
      }
    });

    sdk.track("huge_event", { text: "x".repeat(1000) });
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).not.toContain("huge_event");
    expect(joined).toContain("evt=$sdk_diagnostic");
    expect(joined).toContain("url_length_exceeded");
  });

  it("automatically flushes when batchSize is reached", async () => {
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      batchSize: 3,
      transport: {
        cacheBust: false
      }
    });

    sdk.track("batch_triggered", { source: "batch-test" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=$session_start");
    expect(joined).toContain("evt=$pageview");
    expect(joined).toContain("evt=batch_triggered");
  });

  it("retries failed pixel uploads before keeping events queued", async () => {
    failNextPixelRequests(1);
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      transport: {
        cacheBust: false,
        retryCount: 1,
        retryBaseDelay: 0
      }
    });

    await sdk.flush();

    const requests = getPixelRequests().map(decodeURIComponent);
    const sessionAttempts = requests.filter((url) => url.includes("evt=$session_start"));
    expect(sessionAttempts).toHaveLength(2);
    expect(requests.join("\n")).toContain("evt=$pageview");
  });

  it("attaches stable batch id and dedupe key to pixel uploads", async () => {
    failNextPixelRequests(1);
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      transport: {
        cacheBust: false,
        retryCount: 1,
        retryBaseDelay: 0
      }
    });

    await sdk.flush();

    const urls = getPixelRequests().map((request) => new URL(request, "http://localhost"));
    const sessionAttempts = urls.filter((url) => url.searchParams.get("evt") === "$session_start");
    expect(sessionAttempts).toHaveLength(2);
    expect(sessionAttempts[0].searchParams.get("baid")).toBe("batch_fixed");
    expect(sessionAttempts[1].searchParams.get("baid")).toBe("batch_fixed");
    expect(sessionAttempts[0].searchParams.get("dk")).toBe("demo-web:$session_start:evt_fixed");
    expect(sessionAttempts[1].searchParams.get("dk")).toBe("demo-web:$session_start:evt_fixed");
    expect(urls.some((url) => url.searchParams.get("evt") === "$pageview" && url.searchParams.get("baid") === "batch_fixed")).toBe(true);
  });

  it("persists offline events and replays them after the browser reconnects", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true
    });
    const sdk = createSDK({
      now: () => 1717939200000,
      randomId: (prefix) => `${prefix}_fixed`
    });

    sdk.init({
      appId: "demo-web",
      endpoint: "/aly.gif",
      transport: {
        cacheBust: false
      }
    });
    sdk.track("offline_action", { source: "offline-test" });
    await sdk.flush();

    expect(getPixelRequests()).toHaveLength(0);
    expect(localStorage.getItem("__custom_sdk_offline_events__")).toContain("offline_action");

    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true
    });
    window.dispatchEvent(new Event("online"));
    await sdk.flush();

    const joined = getPixelRequests().map(decodeURIComponent).join("\n");
    expect(joined).toContain("evt=offline_action");
    expect(localStorage.getItem("__custom_sdk_offline_events__")).toBeNull();
  });

  it("parses session profile and behavior path events for the admin report", () => {
    const hits = [
      {
        path: "/aly.gif",
        raw: "http://localhost:4173/aly.gif?evt=$session_start",
        received_at: 1717939200100,
        ip: "127.0.0.1",
        query: {
          ti: "demo-web",
          ver: "0.1.0",
          evt: "$session_start",
          et: "behavior",
          dm: "operation",
          sid: "session_fixed",
          vid: "visitor_fixed",
          eid: "evt_session",
          ts: "1717939200000",
          p: "http://localhost:4173/index.html",
          pp: "/index.html",
          tl: "Home",
          sw: "1440",
          sh: "900",
          vw: "1280",
          vh: "720",
          lg: "zh-CN",
          ep: JSON.stringify({
            visit_time: 1717939200000,
            source: "direct",
            device_type: "desktop"
          })
        }
      },
      {
        path: "/aly.gif",
        raw: "http://localhost:4173/aly.gif?evt=$behavior_path",
        received_at: 1717939202000,
        ip: "127.0.0.1",
        query: {
          ti: "demo-web",
          ver: "0.1.0",
          evt: "$behavior_path",
          et: "behavior",
          dm: "operation",
          sid: "session_fixed",
          vid: "visitor_fixed",
          eid: "evt_behavior",
          ts: "1717939202000",
          p: "http://localhost:4173/index.html",
          pp: "/index.html",
          tl: "Home",
          kind: "behavior_path",
          seq: "1",
          enc: "json",
          data: JSON.stringify({
            session_id: "session_fixed",
            page: "/index.html",
            start: 1717939200000,
            end: 1717939202000,
            events: [
              { t: 200, type: "scroll_stop", y: 320 },
              { t: 800, type: "click", selector: "a#buy" }
            ]
          })
        }
      }
    ];

    const report = parseHits(hits);

    expect(report.metrics.sessionStarts).toBe(1);
    expect(report.metrics.behaviorPaths).toBe(1);
    expect(report.profiles[0]).toMatchObject({
      visitorId: "visitor_fixed",
      sessionId: "session_fixed",
      ip: "127.0.0.1",
      deviceType: "desktop"
    });
    expect(report.behaviorPaths[0].events).toHaveLength(2);
    expect(report.timeline.some((item) => item.action.includes("行为路径"))).toBe(true);
  });

  it("counts offline replayed events for the admin report", () => {
    const report = parseHits([{
      path: "/aly.gif",
      raw: "http://localhost:4173/aly.gif?evt=offline_action",
      received_at: 1717939203000,
      ip: "127.0.0.1",
      query: {
        ti: "demo-web",
        ver: "0.1.0",
        evt: "offline_action",
        et: "custom",
        dm: "operation",
        sid: "session_fixed",
        vid: "visitor_fixed",
        eid: "evt_replayed",
        ts: "1717939203000",
        p: "http://localhost:4173/index.html",
        pp: "/index.html",
        tl: "Home",
        ep: JSON.stringify({
          delivery_status: "offline_replayed"
        })
      }
    }]);

    expect(report.metrics.offlineReplayed).toBe(1);
  });

  it("counts server dropped duplicates for the admin report", () => {
    const report = parseHits([], {
      duplicates: 2,
      unique_keys: 4
    });

    expect(report.metrics.serverDuplicates).toBe(2);
    expect(report.metrics.uniqueDedupeKeys).toBe(4);
  });

  it("parses split heatmap event types for the admin report", () => {
    const hits = [
      {
        path: "/aly.gif",
        raw: "http://localhost:4173/aly.gif?evt=$heatmap_click",
        query: {
          ti: "demo-web",
          evt: "$heatmap_click",
          et: "heatmap",
          dm: "operation",
          sid: "session_fixed",
          vid: "visitor_fixed",
          eid: "evt_click",
          ts: "1717939200000",
          p: "http://localhost:4173/index.html",
          pp: "/index.html",
          tl: "Home",
          grid: "8x8",
          data: JSON.stringify({ points: [[1, 1, 2]] })
        }
      },
      {
        path: "/aly.gif",
        raw: "http://localhost:4173/aly.gif?evt=$heatmap_scroll",
        query: {
          ti: "demo-web",
          evt: "$heatmap_scroll",
          et: "heatmap",
          dm: "operation",
          sid: "session_fixed",
          vid: "visitor_fixed",
          eid: "evt_scroll",
          ts: "1717939200100",
          p: "http://localhost:4173/index.html",
          pp: "/index.html",
          tl: "Home",
          grid: "8x8",
          data: JSON.stringify({ depth_points: [[0, 4, 1]] })
        }
      },
      {
        path: "/aly.gif",
        raw: "http://localhost:4173/aly.gif?evt=$heatmap_exposure",
        query: {
          ti: "demo-web",
          evt: "$heatmap_exposure",
          et: "heatmap",
          dm: "operation",
          sid: "session_fixed",
          vid: "visitor_fixed",
          eid: "evt_exposure",
          ts: "1717939200200",
          p: "http://localhost:4173/index.html",
          pp: "/index.html",
          tl: "Home",
          grid: "8x8",
          data: JSON.stringify({ exposures: [{ selector: "[data-track-id=\"hero-section\"]", count: 1 }] })
        }
      }
    ];

    const report = parseHits(hits);

    expect(report.metrics.heatmapClicks).toBe(1);
    expect(report.metrics.heatmapScrolls).toBe(1);
    expect(report.metrics.heatmapExposures).toBe(1);
    expect(report.heatmap.scrollTotal).toBe(1);
    expect(report.heatmap.exposureTotal).toBe(1);
  });
});
