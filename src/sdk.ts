import { HeatmapAggregator } from "./heatmap";
import { getSensitiveKeys, maskRecord, maskString, maskUrl, truncate } from "./privacy";
import { PixelTransport } from "./pixel-transport";
import type { ReplayChunk, ReplayRecorderLike } from "./replay";
import type { CustomAnalyticsSDK, DeviceContext, EventDomain, EventType, FlushOptions, PageContext, SDKConfig, SDKDeps, SDKEvent } from "./types";

const SDK_VERSION = "0.1.0";

export class AnalyticsSDK implements CustomAnalyticsSDK {
  private config?: SDKConfig;
  private consent = true;
  private distinctId = "";
  private sessionId = "";
  private userId: string | undefined;
  private queue: SDKEvent[] = [];
  private properties: Record<string, unknown> = {};
  private transport?: PixelTransport;
  private replay?: ReplayRecorderLike;
  private heatmap?: HeatmapAggregator;
  private pageStart = 0;
  private lastPageUrl = "";
  private cleanupFns: Array<() => void> = [];
  private replayStartSent = false;
  private replayLoadToken = 0;

  constructor(private readonly deps: SDKDeps = {}) {}

  init(config: SDKConfig): void {
    if (this.config) {
      this.teardown(false);
    }

    this.config = config;
    this.consent = config.consent ?? true;
    this.distinctId = this.loadOrCreateId("__custom_sdk_distinct_id__", "visitor");
    this.sessionId = this.loadOrCreateId("__custom_sdk_session_id__", "session");
    this.transport = new PixelTransport(config.endpoint, config.transport);
    this.pageStart = this.now();
    this.lastPageUrl = window.location.href;

    if (!this.consent) return;

    this.setupLifecycle();
    this.setupClick(config);
    this.setupForm(config);
    this.setupErrorMonitoring(config);
    this.setupApiMonitoring(config);
    this.setupReplay(config);
    this.setupHeatmap(config);
    this.emit("$pageview", "operation", "behavior", { navigation_type: "init" });
  }

  track(event: string, properties: Record<string, unknown> = {}): void {
    this.emit(event, "operation", "custom", properties);
  }

  conversion(conversionId: string, properties: Record<string, unknown> = {}): void {
    this.emit("$conversion", "operation", "conversion", {
      conversion_id: conversionId,
      ...properties
    });
  }

  register(properties: Record<string, unknown>): void {
    this.properties = { ...this.properties, ...properties };
  }

  unregister(key: string): void {
    delete this.properties[key];
  }

  login(userId: string): void {
    this.userId = userId;
  }

  logout(): void {
    this.userId = undefined;
  }

  setConsent(consent: boolean): void {
    this.consent = consent;
    if (!consent) {
      this.queue = [];
    }
  }

  async flush(options: FlushOptions = {}): Promise<void> {
    if (!this.consent || !this.transport) return;
    if (options.includeReplay !== false) this.flushReplay();
    if (options.includeHeatmap !== false) this.flushHeatmap();

    const events = [...this.queue];
    this.queue = [];
    for (const event of events) {
      const result = this.transport.createUrl(event);
      if (result.tooLong) {
        if (event.event !== "$sdk_diagnostic") {
          await this.emitDiagnostic("url_length_exceeded");
        }
        continue;
      }
      const ok = await this.transport.send(result.url);
      if (!ok) {
        this.queue.push(event);
      }
    }
  }

  destroy(): void {
    this.teardown(true);
    this.config = undefined;
  }

  private teardown(emitLeave: boolean): void {
    if (emitLeave && this.config && this.consent) {
      this.emitPageLeave("destroy");
    }
    this.replay?.stop({ recordEnd: emitLeave });
    this.heatmap?.stop();
    this.transport?.dispose();
    this.cleanupFns.forEach((cleanup) => cleanup());
    this.cleanupFns = [];
    this.replay = undefined;
    this.heatmap = undefined;
    this.transport = undefined;
    this.replayStartSent = false;
    this.replayLoadToken += 1;
    if (!emitLeave) {
      this.queue = [];
    }
  }

  private emit(event: string, domain: EventDomain, type: EventType, properties: Record<string, unknown> = {}): void {
    if (!this.config || !this.consent) return;
    const sensitiveKeys = getSensitiveKeys(this.config.privacy?.sensitiveKeys);
    const sdkEvent: SDKEvent = {
      event_id: this.randomId("evt"),
      event,
      domain,
      type,
      time: this.now(),
      app_id: this.config.appId,
      sdk_version: this.config.sdkVersion || SDK_VERSION,
      distinct_id: this.distinctId,
      session_id: this.sessionId,
      user_id: this.userId,
      page: this.getPageContext(sensitiveKeys),
      device: this.getDeviceContext(),
      properties: maskRecord(this.properties, sensitiveKeys) as Record<string, unknown>,
      event_properties: maskRecord(properties, sensitiveKeys) as Record<string, unknown>
    };

    const finalEvent = this.runBeforeSend(sdkEvent);
    if (finalEvent === false) return;
    this.queue.push(finalEvent);
    const maxQueueSize = this.config.maxQueueSize ?? 500;
    if (this.queue.length > maxQueueSize) {
      this.queue.shift();
      void this.emitDiagnostic("queue_dropped", { dropped_count: 1 });
    }
  }

  private runBeforeSend(event: SDKEvent): SDKEvent | false {
    if (!this.config?.beforeSend) return event;
    try {
      return this.config.beforeSend(event);
    } catch {
      return event;
    }
  }

  private async emitDiagnostic(code: string, extra: Record<string, unknown> = {}) {
    this.emit("$sdk_diagnostic", "developer", "diagnostic", {
      code,
      level: "warning",
      ...extra
    });
    const diagnostic = this.queue.pop();
    if (diagnostic && this.transport) {
      const result = this.transport.createUrl(diagnostic, true);
      await this.transport.send(result.url);
    }
  }

  private setupReplay(config: SDKConfig) {
    if (!config.replay?.enabled || !this.sample(config.replay.sampleRate ?? 0.01)) return;
    const token = ++this.replayLoadToken;
    const replayId = this.randomId("replay");
    const replayConfig = config.replay;
    const loadReplayRecorder = this.deps.loadReplayRecorder ?? defaultLoadReplayRecorder;
    void loadReplayRecorder().then((module) => {
      if (!this.config || token !== this.replayLoadToken || !this.consent) return;
      this.replay = module.createReplayRecorder(replayId, replayConfig);
      this.replay.start();
    }).catch(() => {
      void this.emitDiagnostic("replay_load_failed");
    });
  }

  private setupHeatmap(config: SDKConfig) {
    if (!config.heatmap?.enabled || !this.sample(config.heatmap.sampleRate ?? 0.1)) return;
    this.heatmap = new HeatmapAggregator(this.randomId("hm"), config.heatmap);
    this.heatmap.start();
  }

  private setupLifecycle() {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = ((...args: Parameters<History["pushState"]>) => {
      const result = originalPushState(...args);
      this.handleRouteChange("pushState");
      return result;
    }) as History["pushState"];

    history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      const result = originalReplaceState(...args);
      this.handleRouteChange("replaceState");
      return result;
    }) as History["replaceState"];

    const popstate = () => this.handleRouteChange("popstate");
    const pagehide = () => {
      this.emitPageLeave("pagehide");
      void this.flush();
    };
    window.addEventListener("popstate", popstate);
    window.addEventListener("pagehide", pagehide);

    this.cleanupFns.push(
      () => {
        history.pushState = originalPushState as History["pushState"];
        history.replaceState = originalReplaceState as History["replaceState"];
      },
      () => window.removeEventListener("popstate", popstate),
      () => window.removeEventListener("pagehide", pagehide)
    );
  }

  private setupClick(config: SDKConfig) {
    if (!this.isPluginEnabled(config, "click", false)) return;
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest(INTERACTIVE_SELECTOR)
        : null;
      if (!target) return;

      const element = target as HTMLElement;
      const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
      const text = element instanceof HTMLInputElement
        ? ""
        : truncate(maskString((element.textContent || "").trim(), sensitiveKeys), 120);

      this.emit("$click", "operation", "behavior", {
        track_id: element.getAttribute("data-track-id") || undefined,
        track_name: element.getAttribute("data-track-name") || undefined,
        area: element.getAttribute("data-track-area") || undefined,
        tag: element.tagName.toLowerCase(),
        element_id: element.id || undefined,
        element_class: classNameOf(element),
        role: element.getAttribute("role") || undefined,
        href: hrefOf(element, sensitiveKeys),
        target: element.getAttribute("target") || undefined,
        input_type: inputTypeOf(element),
        field_name: fieldNameOf(element),
        text,
        selector: describeTrackTarget(element),
        section_id: sectionContext(element, sensitiveKeys).id,
        section_class: sectionContext(element, sensitiveKeys).className,
        section_heading: sectionContext(element, sensitiveKeys).heading,
        x: event.clientX,
        y: event.clientY,
        page_x: event.pageX,
        page_y: event.pageY,
        screen_x: event.screenX,
        screen_y: event.screenY,
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
        viewport_width: window.innerWidth || document.documentElement.clientWidth || 0,
        viewport_height: window.innerHeight || document.documentElement.clientHeight || 0,
        button: event.button,
        alt_key: event.altKey,
        ctrl_key: event.ctrlKey,
        meta_key: event.metaKey,
        shift_key: event.shiftKey
      });
    };
    document.addEventListener("click", click, true);
    this.cleanupFns.push(() => document.removeEventListener("click", click, true));
  }

  private setupForm(config: SDKConfig) {
    if (!this.isPluginEnabled(config, "form", false)) return;
    const submit = (event: SubmitEvent | Event) => {
      const form = event.target instanceof HTMLFormElement
        ? event.target
        : event.target instanceof Element
          ? event.target.closest("form")
          : null;
      if (!(form instanceof HTMLFormElement)) return;

      const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
      const fields = Array.from(form.elements).filter(isSubmittableField);
      const submitter = "submitter" in event && event.submitter instanceof HTMLElement
        ? event.submitter
        : undefined;

      this.emit("$form_submit", "operation", "behavior", {
        form_id: form.id || undefined,
        form_name: form.getAttribute("name") || undefined,
        action: maskUrl(form.getAttribute("action") || window.location.href, sensitiveKeys),
        method: (form.getAttribute("method") || "GET").toUpperCase(),
        field_count: fields.length,
        field_types: fields.map(fieldTypeOf),
        field_names: fields.map((field) => truncate(maskString(field.getAttribute("name") || "", sensitiveKeys), 80)).filter(Boolean),
        submitter_tag: submitter?.tagName.toLowerCase(),
        submitter_text: submitter ? truncate(maskString(submitter.textContent?.trim() || "", sensitiveKeys), 120) : undefined,
        selector: describeTrackTarget(form),
        section_id: sectionContext(form, sensitiveKeys).id,
        section_class: sectionContext(form, sensitiveKeys).className,
        section_heading: sectionContext(form, sensitiveKeys).heading
      });
    };
    document.addEventListener("submit", submit, true);
    this.cleanupFns.push(() => document.removeEventListener("submit", submit, true));
  }

  private setupErrorMonitoring(config: SDKConfig) {
    if (!this.isPluginEnabled(config, "error", true)) return;
    const onError = (event: ErrorEvent | Event) => {
      const target = event.target;
      if (target instanceof Element && target !== window) {
        this.emitResourceError(target);
        return;
      }
      const errorEvent = event as ErrorEvent;
      const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
      const message = maskString(errorEvent.message || "Unknown error", sensitiveKeys);
      const stack = errorEvent.error instanceof Error
        ? truncate(maskString(errorEvent.error.stack || "", sensitiveKeys), 1000)
        : "";
      const filename = maskUrl(errorEvent.filename || "", sensitiveKeys);
      this.emit("$js_error", "developer", "error", {
        error_id: this.errorId("$js_error", errorEvent.name || "Error", message, filename, errorEvent.lineno, errorEvent.colno),
        message,
        stack,
        error_type: errorEvent.error instanceof Error ? errorEvent.error.name : "Error",
        filename,
        lineno: errorEvent.lineno || 0,
        colno: errorEvent.colno || 0,
        source: "onerror",
        handled: false
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
      const reason = event.reason;
      const reasonType = reason instanceof Error ? reason.name : typeof reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      this.emit("$promise_error", "developer", "error", {
        error_id: this.errorId("$promise_error", reasonType, message),
        message: maskString(message, sensitiveKeys),
        stack: reason instanceof Error ? truncate(maskString(reason.stack || "", sensitiveKeys), 1000) : "",
        reason_type: reasonType,
        source: "unhandledrejection",
        handled: false
      });
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    this.cleanupFns.push(
      () => window.removeEventListener("error", onError, true),
      () => window.removeEventListener("unhandledrejection", onRejection)
    );
  }

  private setupApiMonitoring(config: SDKConfig) {
    if (!this.isPluginEnabled(config, "api", false) || !window.fetch) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getFetchUrl(input);
      const method = getFetchMethod(input, init);
      const start = this.now();
      try {
        const response = await originalFetch(input, init);
        this.emitApiEvent(url, method, response.status, this.now() - start, response.ok, "fetch");
        return response;
      } catch (error) {
        this.emitApiEvent(url, method, 0, this.now() - start, false, "fetch", error);
        throw error;
      }
    }) as typeof window.fetch;
    this.cleanupFns.push(() => {
      window.fetch = originalFetch as typeof window.fetch;
    });
  }

  private handleRouteChange(navigationType: string) {
    const nextUrl = window.location.href;
    if (nextUrl === this.lastPageUrl) return;
    this.emitPageLeave("route");
    this.lastPageUrl = nextUrl;
    this.pageStart = this.now();
    this.emit("$pageview", "operation", "behavior", { navigation_type: navigationType });
  }

  private emitPageLeave(leaveType: string) {
    const duration = Math.max(0, this.now() - this.pageStart);
    this.emit("$pageleave", "operation", "behavior", {
      duration,
      leave_type: leaveType
    });
  }

  private emitResourceError(target: Element) {
    const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
    const tag = target.tagName.toLowerCase();
    const rawUrl = target.getAttribute("src") || target.getAttribute("href") || "";
    if (this.isCollectEndpoint(rawUrl)) return;
    this.emit("$resource_error", "developer", "error", {
      tag,
      url: maskUrl(rawUrl, sensitiveKeys),
      resource_type: resourceType(tag),
      source: "resource"
    });
  }

  private emitApiEvent(
    rawUrl: string,
    method: string,
    status: number,
    duration: number,
    success: boolean,
    requestType: string,
    error?: unknown
  ) {
    if (this.isCollectEndpoint(rawUrl)) return;
    const sensitiveKeys = getSensitiveKeys(this.config?.privacy?.sensitiveKeys);
    const url = maskUrl(rawUrl, sensitiveKeys);
    this.emit("$api", "developer", "api", {
      url,
      path: safePathname(rawUrl),
      method,
      status,
      duration,
      success,
      request_type: requestType,
      error_type: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? maskString(error.message, sensitiveKeys) : undefined
    });
  }

  private isCollectEndpoint(rawUrl: string) {
    if (!this.config || !rawUrl) return false;
    const endpoint = this.config.transport?.pixelEndpoint || this.config.endpoint;
    try {
      const url = new URL(rawUrl, window.location.href);
      const collectUrl = new URL(endpoint, window.location.href);
      return url.pathname === collectUrl.pathname || url.pathname.endsWith("/aly.gif");
    } catch {
      return rawUrl.includes("aly.gif");
    }
  }

  private isPluginEnabled(config: SDKConfig, name: string, defaultValue: boolean) {
    if (config.plugins && name in config.plugins) return config.plugins[name] !== false;
    const modules = config.modules as Record<string, Record<string, boolean> | undefined> | undefined;
    const moduleValue = modules?.operation?.[name] ?? modules?.developer?.[name];
    if (moduleValue !== undefined) return moduleValue !== false;
    return defaultValue;
  }

  private errorId(...parts: Array<string | number | undefined>) {
    let hash = 0;
    const input = parts.filter((part) => part !== undefined).join("|");
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `err_${Math.abs(hash).toString(36)}`;
  }

  private flushReplay() {
    if (!this.replay) return;
    const chunks = this.replay.drain();
    if (chunks.length && !this.replayStartSent) {
      this.emit("$replay_start", "operation", "replay", { replay_id: this.replay.replayId });
      this.replayStartSent = true;
    }
    for (const chunk of chunks) {
      this.emitReplayChunk(chunk);
    }
  }

  private flushHeatmap() {
    if (!this.heatmap) return;
    for (const snapshot of this.heatmap.drain()) {
      this.emit("$heatmap_click", "operation", "heatmap", snapshot);
    }
  }

  private emitReplayChunk(chunk: ReplayChunk) {
    this.emit("$replay_chunk", "operation", "replay", chunk);
  }

  private getPageContext(sensitiveKeys: string[]): PageContext {
    const url = new URL(window.location.href);
    return {
      url: maskUrl(url.href, sensitiveKeys),
      path: url.pathname,
      title: truncate(document.title, 160),
      referrer: maskUrl(document.referrer || "", sensitiveKeys),
      host: url.host,
      hostname: url.hostname,
      protocol: url.protocol,
      search: maskString(url.search, sensitiveKeys),
      hash: truncate(url.hash, 120)
    };
  }

  private getDeviceContext(): DeviceContext {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; type?: string };
      msDoNotTrack?: string;
    };
    return {
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      screen_width: screen.width || 0,
      screen_height: screen.height || 0,
      viewport_width: window.innerWidth || document.documentElement.clientWidth || 0,
      viewport_height: window.innerHeight || document.documentElement.clientHeight || 0,
      pixel_ratio: window.devicePixelRatio || 1,
      color_depth: screen.colorDepth || 0,
      online: navigator.onLine,
      platform: navigator.platform,
      do_not_track: navigator.doNotTrack || nav.msDoNotTrack || "",
      connection_type: nav.connection?.effectiveType || nav.connection?.type || ""
    };
  }

  private loadOrCreateId(key: string, prefix: string) {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = this.randomId(prefix);
    localStorage.setItem(key, value);
    return value;
  }

  private sample(rate: number) {
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private randomId(prefix: string) {
    if (this.deps.randomId) return this.deps.randomId(prefix);
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function describeTrackTarget(element: HTMLElement) {
  const trackId = element.getAttribute("data-track-id");
  if (trackId) return `[data-track-id="${trackId}"]`;
  if (element.id) return `${element.tagName.toLowerCase()}#${element.id}`;
  return element.tagName.toLowerCase();
}

function getFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function safePathname(rawUrl: string) {
  try {
    return new URL(rawUrl, window.location.href).pathname;
  } catch {
    return "";
  }
}

function resourceType(tag: string) {
  switch (tag) {
    case "script":
      return "script";
    case "link":
      return "stylesheet";
    case "img":
      return "image";
    default:
      return tag;
  }
}

async function defaultLoadReplayRecorder() {
  return import("./rrweb-replay");
}

const INTERACTIVE_SELECTOR = [
  "[data-track-id]",
  "[data-track-name]",
  "[data-track-area]",
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[data-toggle]"
].join(",");

function classNameOf(element: HTMLElement) {
  return truncate(typeof element.className === "string" ? element.className.trim() : "", 160) || undefined;
}

function hrefOf(element: HTMLElement, sensitiveKeys: string[]) {
  if (!(element instanceof HTMLAnchorElement)) return undefined;
  return maskUrl(element.href || element.getAttribute("href") || "", sensitiveKeys);
}

function inputTypeOf(element: HTMLElement) {
  if (element instanceof HTMLInputElement) return element.type || "text";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  return undefined;
}

function fieldNameOf(element: HTMLElement) {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return truncate(element.getAttribute("name") || "", 80) || undefined;
  }
  return undefined;
}

function sectionContext(element: Element, sensitiveKeys: string[]) {
  const section = element.closest("section, article, main, header, footer, nav, [data-section], .section, .banner-bottom-section, .our-pet-services-section");
  if (!(section instanceof HTMLElement)) {
    return { id: undefined, className: undefined, heading: undefined };
  }
  const heading = section.querySelector("h1,h2,h3,h4,h5,h6");
  return {
    id: section.id || section.getAttribute("data-section") || undefined,
    className: classNameOf(section),
    heading: heading ? truncate(maskString(heading.textContent?.trim() || "", sensitiveKeys), 160) : undefined
  };
}

function isSubmittableField(element: Element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["button", "submit", "reset", "hidden", "image"].includes(element.type);
}

function fieldTypeOf(element: Element) {
  if (element instanceof HTMLInputElement) return element.type || "text";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return element.multiple ? "select-multiple" : "select";
  return element.tagName.toLowerCase();
}
