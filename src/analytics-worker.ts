import { BehaviorPathAggregator } from "./behavior-path";
import type { BehaviorPathContext, BehaviorPathEvent } from "./behavior-path";

let aggregator: BehaviorPathAggregator | undefined;

self.onmessage = (event: MessageEvent) => {
  const message = event.data || {};
  switch (message.type) {
    case "init":
      aggregator = new BehaviorPathAggregator({
        behaviorId: message.behaviorId,
        maxEvents: message.maxEvents,
        maxChunkLength: message.maxChunkLength
      });
      break;
    case "event":
      aggregator?.record(message.event as BehaviorPathEvent);
      break;
    case "flush":
      self.postMessage({
        type: "flushed",
        id: message.id,
        chunks: aggregator?.drain(message.context as BehaviorPathContext, message.end) || []
      });
      break;
    default:
      break;
  }
};
