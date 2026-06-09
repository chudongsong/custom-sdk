const DEFAULT_SENSITIVE_KEYS = [
  "token",
  "password",
  "secret",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "phone",
  "email",
  "idcard"
];

export function getSensitiveKeys(extra: string[] = []) {
  return Array.from(new Set([...DEFAULT_SENSITIVE_KEYS, ...extra].map((key) => key.toLowerCase())));
}

export function maskUrl(rawUrl: string, sensitiveKeys = getSensitiveKeys()) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    for (const [key] of url.searchParams) {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        url.searchParams.set(key, "[masked]");
      }
    }
    return url.href.replaceAll("%5Bmasked%5D", "[masked]");
  } catch {
    return maskString(rawUrl, sensitiveKeys);
  }
}

export function maskString(value: string, sensitiveKeys = getSensitiveKeys()) {
  let result = value;
  for (const key of sensitiveKeys) {
    const re = new RegExp(`(${escapeRegExp(key)})(\\s*[=:]\\s*)[^\\s&]+`, "gi");
    result = result.replace(re, "$1$2[masked]");
  }
  result = result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[masked]");
  result = result.replace(/\b1[3-9]\d{9}\b/g, "[masked]");
  return result;
}

export function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return value.slice(0, Math.max(0, limit - 12)) + "...[truncated]";
}

export function maskRecord(value: unknown, sensitiveKeys = getSensitiveKeys()): unknown {
  if (typeof value === "string") return truncate(maskString(value, sensitiveKeys), 500);
  if (Array.isArray(value)) return value.map((item) => maskRecord(item, sensitiveKeys));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lower.includes(sensitive))) {
      output[key] = "[masked]";
      continue;
    }
    output[key] = maskRecord(item, sensitiveKeys);
  }
  return output;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
