import { vi } from "vitest";

class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = "";

  set src(value: string) {
    TestImage.requests.push(value);
    queueMicrotask(() => {
      if (TestImage.failuresRemaining > 0) {
        TestImage.failuresRemaining -= 1;
        this.onerror?.();
        return;
      }
      this.onload?.();
    });
  }
}

namespace TestImage {
  export const requests: string[] = [];
  export let failuresRemaining = 0;
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
  TestImage.failuresRemaining = 0;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
});

export function getPixelRequests() {
  return [...TestImage.requests];
}

export function failNextPixelRequests(count: number) {
  TestImage.failuresRemaining = count;
}
