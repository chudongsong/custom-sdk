import type { HeatmapConfig } from "./types";

export interface HeatmapSnapshot {
  heatmap_id: string;
  kind: "click" | "scroll";
  grid: string;
  data: string;
}

export class HeatmapAggregator {
  readonly heatmapId: string;
  private readonly gridX: number;
  private readonly gridY: number;
  private readonly clickEnabled: boolean;
  private readonly scrollEnabled: boolean;
  private buckets = new Map<string, number>();
  private removeListeners: Array<() => void> = [];

  constructor(heatmapId: string, config: HeatmapConfig) {
    this.heatmapId = heatmapId;
    this.gridX = config.gridX ?? 64;
    this.gridY = config.gridY ?? 64;
    this.clickEnabled = config.click ?? true;
    this.scrollEnabled = config.scroll ?? true;
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
  }

  drain(): HeatmapSnapshot[] {
    if (!this.buckets.size) return [];
    const points = Array.from(this.buckets.entries()).map(([key, count]) => {
      const [x, y] = key.split(":").map(Number);
      return [x, y, count];
    });
    this.buckets.clear();
    return [{
      heatmap_id: this.heatmapId,
      kind: "click",
      grid: `${this.gridX}x${this.gridY}`,
      data: JSON.stringify({ points })
    }];
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
    this.buckets.set(key, (this.buckets.get(key) || 0) + 1);
  }

  private addScroll() {
    const height = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / height));
    const y = Math.min(this.gridY - 1, Math.floor(ratio * this.gridY));
    const key = `0:${y}`;
    this.buckets.set(key, (this.buckets.get(key) || 0) + 1);
  }
}
