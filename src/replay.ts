import type { ReplayConfig } from "./types";

export interface ReplayChunk {
  replay_id: string;
  seq: number;
  enc: "json";
  data: string;
  end: boolean;
}

export interface ReplayRecorderLike {
  readonly replayId: string;
  start(): void;
  drain(): ReplayChunk[];
  stop(options?: { recordEnd?: boolean }): ReplayChunk[];
}

export interface ReplayRecorderModule {
  createReplayRecorder(replayId: string, config: ReplayConfig): ReplayRecorderLike;
}
