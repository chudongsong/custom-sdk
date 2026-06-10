import { truncate } from "./privacy";
import type { BehaviorConfig } from "./types";

export type BehaviorPathEventType = "click" | "scroll_stop" | "hover_stay" | "form_submit";

export interface BehaviorPathEvent {
  type: BehaviorPathEventType;
  time: number;
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
  page_x?: number;
  page_y?: number;
  scroll_x?: number;
  scroll_y?: number;
  stay?: number;
  href?: string;
  tag?: string;
}

export interface BehaviorPathContext {
  sessionId: string;
  page: string;
  title: string;
}

export interface BehaviorPathChunk {
  behavior_id: string;
  kind: "behavior_path";
  seq: number;
  enc: "json";
  data: string;
  event_count: number;
  start: number;
  end: number;
}

interface WorkerRequest {
  id: number;
  resolve: (chunks: BehaviorPathChunk[]) => void;
}

interface BehaviorPathAggregatorOptions {
  behaviorId: string;
  maxEvents?: number;
  maxChunkLength?: number;
}

export class BehaviorPathAggregator {
  private readonly behaviorId: string;
  private readonly maxEvents: number;
  private readonly maxChunkLength: number;
  private seq = 0;
  private start = 0;
  private events: Array<Record<string, unknown>> = [];

  constructor(options: BehaviorPathAggregatorOptions) {
    this.behaviorId = options.behaviorId;
    this.maxEvents = options.maxEvents ?? 50;
    this.maxChunkLength = options.maxChunkLength ?? 1200;
  }

  record(event: BehaviorPathEvent): void {
    if (!this.start) this.start = event.time;
    const { time, ...rest } = event;
    this.events.push({
      t: Math.max(0, time - this.start),
      ...rest
    });
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  drain(context: BehaviorPathContext, end: number): BehaviorPathChunk[] {
    if (!this.events.length) return [];
    const start = this.start || end;
    const events = this.events.splice(0, this.events.length);
    this.start = 0;
    const payload = {
      session_id: context.sessionId,
      page: context.page,
      title: context.title,
      start,
      end,
      events
    };
    return [{
      behavior_id: this.behaviorId,
      kind: "behavior_path",
      seq: ++this.seq,
      enc: "json",
      data: this.stringifyPayload(payload),
      event_count: events.length,
      start,
      end
    }];
  }

  private stringifyPayload(payload: {
    session_id: string;
    page: string;
    title: string;
    start: number;
    end: number;
    events: Array<Record<string, unknown>>;
  }) {
    const full = JSON.stringify(payload);
    if (full.length <= this.maxChunkLength) return full;

    const compact = {
      ...payload,
      events: payload.events.map((event) => {
        const { href, text, ...rest } = event;
        return {
          ...rest,
          ...(typeof text === "string" && text ? { text: truncate(text, 48) } : {})
        };
      })
    };
    const compactJson = JSON.stringify(compact);
    if (compactJson.length <= this.maxChunkLength) return compactJson;

    const minimal = {
      ...payload,
      title: truncate(payload.title, 40),
      events: payload.events.map((event) => ({
        t: event.t,
        type: event.type,
        selector: typeof event.selector === "string" ? truncate(event.selector, 80) : undefined,
        x: event.x,
        y: event.y,
        scroll_y: event.scroll_y,
        stay: event.stay
      }))
    };
    return truncate(JSON.stringify(minimal), this.maxChunkLength);
  }
}

export class BehaviorPathPipeline {
  private readonly fallback: BehaviorPathAggregator;
  private worker?: Worker;
  private requestId = 0;
  private requests = new Map<number, WorkerRequest>();

  constructor(
    private readonly behaviorId: string,
    private readonly config: BehaviorConfig = {}
  ) {
    this.fallback = new BehaviorPathAggregator({
      behaviorId,
      maxEvents: config.maxEvents,
      maxChunkLength: config.maxChunkLength
    });

    if (config.worker !== false && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(new URL("./analytics-worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
        this.worker.postMessage({
          type: "init",
          behaviorId,
          maxEvents: config.maxEvents,
          maxChunkLength: config.maxChunkLength
        });
      } catch {
        this.worker = undefined;
      }
    }
  }

  record(event: BehaviorPathEvent): void {
    if (this.worker) {
      this.worker.postMessage({ type: "event", event });
      return;
    }
    this.fallback.record(event);
  }

  drain(context: BehaviorPathContext, end: number): Promise<BehaviorPathChunk[]> {
    if (!this.worker) return Promise.resolve(this.fallback.drain(context, end));
    const id = ++this.requestId;
    return new Promise((resolve) => {
      this.requests.set(id, { id, resolve });
      this.worker?.postMessage({ type: "flush", id, context, end });
      window.setTimeout(() => {
        const request = this.requests.get(id);
        if (!request) return;
        this.requests.delete(id);
        request.resolve([]);
      }, 500);
    });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.requests.forEach((request) => request.resolve([]));
    this.requests.clear();
  }

  private handleWorkerMessage(message: { type?: string; id?: number; chunks?: BehaviorPathChunk[] }) {
    if (message.type !== "flushed" || typeof message.id !== "number") return;
    const request = this.requests.get(message.id);
    if (!request) return;
    this.requests.delete(message.id);
    request.resolve(message.chunks || []);
  }
}
