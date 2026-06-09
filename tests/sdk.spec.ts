import { describe, expect, it, vi } from "vitest";
import { createSDK } from "../src";
import { getPixelRequests } from "./setup";

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

    const [url] = getPixelRequests();
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

  it("only sends pageview on initial flush even when replay and heatmap are enabled", async () => {
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
    expect(events).toEqual(["$pageview"]);
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
});
