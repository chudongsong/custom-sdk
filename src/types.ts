export type EventDomain = "operation" | "developer" | "shared";
export type EventType =
  | "behavior"
  | "conversion"
  | "replay"
  | "heatmap"
  | "error"
  | "performance"
  | "api"
  | "diagnostic"
  | "custom";

export interface PageContext {
  url: string;
  path: string;
  title: string;
  referrer: string;
  host?: string;
  hostname?: string;
  protocol?: string;
  search?: string;
  hash?: string;
}

export interface DeviceContext {
  user_agent: string;
  language: string;
  timezone: string;
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;
  pixel_ratio?: number;
  color_depth?: number;
  online?: boolean;
  platform?: string;
  do_not_track?: string;
  connection_type?: string;
}

export interface SDKEvent {
  event_id: string;
  event: string;
  domain: EventDomain;
  type: EventType;
  time: number;
  app_id: string;
  sdk_version: string;
  distinct_id: string;
  session_id: string;
  user_id?: string;
  page: PageContext;
  device: DeviceContext;
  properties: Record<string, unknown>;
  event_properties: Record<string, unknown>;
}

export interface TransportConfig {
  pixelEndpoint?: string;
  pixelMaxUrlLength?: number;
  cacheBust?: boolean;
}

export interface ReplayConfig {
  enabled?: boolean;
  sampleRate?: number;
  maxDuration?: number;
  maxEvents?: number;
  maskAllText?: boolean;
  maskInput?: boolean;
  captureMouseMove?: boolean;
  mutationThrottle?: number;
  chunkMaxLength?: number;
  maskSelectors?: string[];
  blockSelectors?: string[];
}

export interface HeatmapConfig {
  enabled?: boolean;
  sampleRate?: number;
  click?: boolean;
  scroll?: boolean;
  move?: boolean;
  exposure?: boolean;
  gridX?: number;
  gridY?: number;
  scrollBuckets?: number;
  flushInterval?: number;
  chunkMaxLength?: number;
}

export interface FlushOptions {
  includeReplay?: boolean;
  includeHeatmap?: boolean;
}

export interface SDKConfig {
  appId: string;
  endpoint: string;
  debug?: boolean;
  consent?: boolean;
  batchSize?: number;
  flushInterval?: number;
  maxQueueSize?: number;
  sampleRate?: number;
  sdkVersion?: string;
  transport?: TransportConfig;
  plugins?: Record<string, boolean>;
  modules?: Record<string, unknown>;
  replay?: ReplayConfig;
  heatmap?: HeatmapConfig;
  privacy?: {
    maskInput?: boolean;
    maskText?: boolean;
    maskUrlQuery?: boolean;
    sensitiveKeys?: string[];
  };
  beforeSend?: (event: SDKEvent) => SDKEvent | false;
}

export interface SDKDeps {
  now?: () => number;
  randomId?: (prefix: string) => string;
  loadReplayRecorder?: () => Promise<import("./replay").ReplayRecorderModule>;
}

export interface CustomAnalyticsSDK {
  init(config: SDKConfig): void;
  track(event: string, properties?: Record<string, unknown>): void;
  conversion(conversionId: string, properties?: Record<string, unknown>): void;
  register(properties: Record<string, unknown>): void;
  unregister(key: string): void;
  login(userId: string): void;
  logout(): void;
  setConsent(consent: boolean): void;
  flush(options?: FlushOptions): Promise<void>;
  destroy(): void;
}
