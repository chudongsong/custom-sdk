import { AnalyticsSDK } from "./sdk";
import type { SDKDeps } from "./types";

export type {
  CustomAnalyticsSDK,
  DeviceContext,
  EventDomain,
  EventType,
  HeatmapConfig,
  PageContext,
  ReplayConfig,
  SDKConfig,
  SDKEvent,
  TransportConfig
} from "./types";

export function createSDK(deps?: SDKDeps) {
  return new AnalyticsSDK(deps);
}

export default createSDK;
