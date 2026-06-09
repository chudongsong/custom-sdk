import { record } from "@rrweb/record";
import type { eventWithTime } from "@rrweb/types";
import { truncate } from "./privacy";
import type { ReplayChunk, ReplayRecorderLike } from "./replay";
import type { ReplayConfig } from "./types";

interface BufferedReplayEvent {
  type: "rrweb";
  event: eventWithTime;
}

export function createReplayRecorder(replayId: string, config: ReplayConfig): ReplayRecorderLike {
  return new RrwebReplayRecorder(replayId, config);
}

class RrwebReplayRecorder implements ReplayRecorderLike {
  readonly replayId: string;
  private readonly config: Required<Pick<ReplayConfig, "chunkMaxLength" | "maskAllText" | "maskInput">>;
  private stopRecord: (() => void) | undefined;
  private removeActivationListeners: Array<() => void> = [];
  private seq = 0;
  private pending: BufferedReplayEvent[] = [];
  private activated = false;

  constructor(replayId: string, config: ReplayConfig) {
    this.replayId = replayId;
    this.config = {
      chunkMaxLength: config.chunkMaxLength ?? 1200,
      maskAllText: config.maskAllText ?? true,
      maskInput: config.maskInput ?? true
    };
  }

  start(): void {
    if (this.stopRecord) return;
    this.installActivationListeners();
    this.stopRecord = record({
      emit: (event) => {
        this.pending.push({ type: "rrweb", event });
      },
      maskAllInputs: this.config.maskInput,
      maskInputOptions: {
        password: true,
        text: this.config.maskInput,
        email: this.config.maskInput,
        tel: this.config.maskInput,
        number: this.config.maskInput,
        search: this.config.maskInput,
        url: this.config.maskInput,
        textarea: this.config.maskInput,
        select: this.config.maskInput
      },
      maskTextSelector: this.config.maskAllText ? "*" : undefined,
      blockSelector: "[data-rrweb-block], [data-sdk-block], .rr-block",
      ignoreClass: "rr-ignore",
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      sampling: {
        mousemove: false,
        mouseInteraction: true,
        scroll: 250,
        input: "last"
      }
    });
  }

  drain(): ReplayChunk[] {
    if (!this.activated || !this.pending.length) return [];
    const events = this.pending.splice(0, this.pending.length);
    return [this.toChunk(events, false)];
  }

  stop({ recordEnd = true } = {}): ReplayChunk[] {
    this.stopRecord?.();
    this.stopRecord = undefined;
    this.removeActivationListeners.forEach((remove) => remove());
    this.removeActivationListeners = [];
    if (recordEnd && this.activated) {
      this.pending.push({
        type: "rrweb",
        event: {
          type: 5,
          timestamp: Date.now(),
          data: {
            tag: "sdk-replay-end"
          }
        } as eventWithTime
      });
    }
    return this.drain();
  }

  private installActivationListeners() {
    const activate = () => {
      this.activated = true;
    };
    document.addEventListener("click", activate, true);
    document.addEventListener("input", activate, true);
    document.addEventListener("keydown", activate, true);
    window.addEventListener("scroll", activate, true);
    this.removeActivationListeners = [
      () => document.removeEventListener("click", activate, true),
      () => document.removeEventListener("input", activate, true),
      () => document.removeEventListener("keydown", activate, true),
      () => window.removeEventListener("scroll", activate, true)
    ];
  }

  private toChunk(events: BufferedReplayEvent[], end: boolean): ReplayChunk {
    return {
      replay_id: this.replayId,
      seq: ++this.seq,
      enc: "json",
      data: truncate(JSON.stringify({ source: "rrweb", events }), this.config.chunkMaxLength),
      end
    };
  }
}
