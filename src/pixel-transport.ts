import type { SDKEvent, TransportConfig } from "./types";

export interface PixelPayloadResult {
  url: string;
  tooLong: boolean;
}

export class PixelTransport {
  private readonly endpoint: string;
  private readonly maxUrlLength: number;
  private readonly cacheBust: boolean;
  private activeImages = new Set<HTMLImageElement>();

  constructor(endpoint: string, config: TransportConfig = {}) {
    this.endpoint = config.pixelEndpoint || endpoint;
    this.maxUrlLength = config.pixelMaxUrlLength ?? 1800;
    this.cacheBust = config.cacheBust ?? true;
  }

  createUrl(event: SDKEvent, ignoreLength = false): PixelPayloadResult {
    const params = new URLSearchParams();
    params.set("ti", event.app_id);
    params.set("ver", event.sdk_version);
    params.set("evt", event.event);
    params.set("et", event.type);
    params.set("dm", event.domain);
    params.set("sid", event.session_id);
    params.set("vid", event.distinct_id);
    params.set("eid", event.event_id);
    params.set("ts", String(event.time));
    if (event.user_id) params.set("uid", event.user_id);
    params.set("p", event.page.url);
    params.set("r", event.page.referrer);
    params.set("tl", event.page.title);
    if (event.page.host) params.set("ph", event.page.host);
    if (event.page.path) params.set("pp", event.page.path);
    if (event.page.search) params.set("pq", event.page.search);
    if (event.page.hash) params.set("ha", event.page.hash);
    params.set("sw", String(event.device.screen_width));
    params.set("sh", String(event.device.screen_height));
    params.set("vw", String(event.device.viewport_width));
    params.set("vh", String(event.device.viewport_height));
    params.set("lg", event.device.language);
    if (event.device.timezone) params.set("tz", event.device.timezone);
    if (event.device.pixel_ratio !== undefined) params.set("dpr", String(event.device.pixel_ratio));
    if (event.device.color_depth !== undefined) params.set("cd", String(event.device.color_depth));
    if (event.device.online !== undefined) params.set("onl", event.device.online ? "1" : "0");
    if (event.device.platform) params.set("pf", event.device.platform);
    if (event.device.connection_type) params.set("nt", event.device.connection_type);

    this.addEventProperties(params, event);

    if (Object.keys(event.properties).length) {
      params.set("cp", JSON.stringify(event.properties));
    }
    if (this.cacheBust) {
      params.set("rn", String(Math.floor(Math.random() * 1000000)));
    }

    const url = `${this.endpoint}?${params.toString()}`;
    return {
      url,
      tooLong: !ignoreLength && url.length > this.maxUrlLength
    };
  }

  send(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      this.activeImages.add(img);
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeImages.delete(img);
        resolve(ok);
      };
      const timer = window.setTimeout(() => done(false), 3000);
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.referrerPolicy = "strict-origin-when-cross-origin";
      img.src = url;
    });
  }

  dispose() {
    this.activeImages.clear();
  }

  private addEventProperties(params: URLSearchParams, event: SDKEvent) {
    const props = event.event_properties;
    for (const key of ["replay_id", "heatmap_id", "seq", "enc", "data", "grid", "kind"] as const) {
      const value = props[key];
      if (value !== undefined && value !== null) {
        const paramName = key === "replay_id" ? "rid" : key === "heatmap_id" ? "hid" : key;
        params.set(paramName, String(value));
      }
    }

    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (["replay_id", "heatmap_id", "seq", "enc", "data", "grid", "kind"].includes(key)) continue;
      rest[key] = value;
    }
    if (Object.keys(rest).length) {
      params.set("ep", JSON.stringify(rest));
    }
  }
}
