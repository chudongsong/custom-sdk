import { vi } from "vitest";

class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = "";

  set src(value: string) {
    TestImage.requests.push(value);
    queueMicrotask(() => this.onload?.());
  }
}

namespace TestImage {
  export const requests: string[] = [];
}

Object.defineProperty(globalThis, "Image", {
  value: TestImage,
  configurable: true
});

Object.defineProperty(navigator, "onLine", {
  value: true,
  configurable: true
});

beforeEach(() => {
  TestImage.requests.length = 0;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
});

export function getPixelRequests() {
  return [...TestImage.requests];
}
