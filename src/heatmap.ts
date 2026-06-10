import type { HeatmapConfig } from "./types";

export interface HeatmapSnapshot {
  heatmap_id: string;
  kind: "click" | "scroll" | "exposure";
  grid: string;
  data: string;
}

export class HeatmapAggregator {
  readonly heatmapId: string;
  private readonly gridX: number;
  private readonly gridY: number;
  private readonly clickEnabled: boolean;
  private readonly scrollEnabled: boolean;
  private readonly exposureEnabled: boolean;
  private clickBuckets = new Map<string, number>();
  private scrollBuckets = new Map<string, number>();
  private exposureBuckets = new Map<string, { selector: string; text: string; count: number }>();
  private removeListeners: Array<() => void> = [];

  constructor(heatmapId: string, config: HeatmapConfig) {
    this.heatmapId = heatmapId;
    this.gridX = config.gridX ?? 64;
    this.gridY = config.gridY ?? 64;
    this.clickEnabled = config.click ?? true;
    this.scrollEnabled = config.scroll ?? true;
    this.exposureEnabled = config.exposure ?? false;
  }

  start() {
    if (this.clickEnabled) {
      const click = (event: MouseEvent) => this.addClick(event.clientX, event.clientY);
      document.addEventListener("click", click, true);
      this.removeListeners.push(() => document.removeEventListener("click", click, true));
    }
    if (this.scrollEnabled) {
      const scroll = () => this.addScroll();
      window.addEventListener("scroll", scroll, true);
      this.removeListeners.push(() => window.removeEventListener("scroll", scroll, true));
    }
    if (this.exposureEnabled) {
      const collect = () => this.addExposure();
      collect();
      window.addEventListener("scroll", collect, true);
      window.addEventListener("resize", collect, true);
      this.removeListeners.push(
        () => window.removeEventListener("scroll", collect, true),
        () => window.removeEventListener("resize", collect, true)
      );
    }
  }

  drain(): HeatmapSnapshot[] {
    const snapshots: HeatmapSnapshot[] = [];
    if (this.clickBuckets.size) {
      snapshots.push(this.toPointSnapshot("click", this.clickBuckets, "points"));
      this.clickBuckets.clear();
    }
    if (this.scrollBuckets.size) {
      snapshots.push(this.toPointSnapshot("scroll", this.scrollBuckets, "depth_points"));
      this.scrollBuckets.clear();
    }
    if (this.exposureBuckets.size) {
      snapshots.push({
        heatmap_id: this.heatmapId,
        kind: "exposure",
        grid: `${this.gridX}x${this.gridY}`,
        data: JSON.stringify({
          exposures: Array.from(this.exposureBuckets.values())
        })
      });
      this.exposureBuckets.clear();
    }
    return snapshots;
  }

  stop() {
    this.removeListeners.forEach((remove) => remove());
    this.removeListeners = [];
    return this.drain();
  }

  private addClick(clientX: number, clientY: number) {
    const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const x = Math.min(this.gridX - 1, Math.max(0, Math.floor((clientX / width) * this.gridX)));
    const y = Math.min(this.gridY - 1, Math.max(0, Math.floor((clientY / height) * this.gridY)));
    const key = `${x}:${y}`;
    this.clickBuckets.set(key, (this.clickBuckets.get(key) || 0) + 1);
  }

  private addScroll() {
    const height = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / height));
    const y = Math.min(this.gridY - 1, Math.floor(ratio * this.gridY));
    const key = `0:${y}`;
    this.scrollBuckets.set(key, (this.scrollBuckets.get(key) || 0) + 1);
  }

  private addExposure() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const candidates = Array.from(document.querySelectorAll("[data-track-id], [data-track-name], section, article, main"));
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const visible = rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
      if (!visible) continue;
      const selector = describeExposureTarget(candidate);
      const text = (candidate.getAttribute("data-track-name") || candidate.textContent || "").trim().slice(0, 80);
      const existing = this.exposureBuckets.get(selector);
      this.exposureBuckets.set(selector, {
        selector,
        text,
        count: (existing?.count || 0) + 1
      });
    }
  }

  private toPointSnapshot(kind: "click" | "scroll", buckets: Map<string, number>, keyName: "points" | "depth_points"): HeatmapSnapshot {
    const points = Array.from(buckets.entries()).map(([key, count]) => {
      const [x, y] = key.split(":").map(Number);
      return [x, y, count];
    });
    return {
      heatmap_id: this.heatmapId,
      kind,
      grid: `${this.gridX}x${this.gridY}`,
      data: JSON.stringify({ [keyName]: points })
    };
  }
}

function describeExposureTarget(element: HTMLElement) {
  const trackId = element.getAttribute("data-track-id");
  if (trackId) return `[data-track-id="${trackId}"]`;
  const trackName = element.getAttribute("data-track-name");
  if (trackName) return `[data-track-name="${trackName}"]`;
  if (element.id) return `${element.tagName.toLowerCase()}#${element.id}`;
  return element.tagName.toLowerCase();
}
