import { setTimeout as sleep } from "node:timers/promises";

export type FetchRetryOptions = {
  retries: number;
  baseDelayMs: number;
};

const parseRetryAfterMs = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return seconds * 1000;
};

const shouldRetryStatus = (status: number): boolean => status === 429 || status >= 500;

export const fetchJsonWithRetry = async <T>(
  url: string,
  options: FetchRetryOptions,
): Promise<T | null> => {
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      return (await response.json()) as T;
    }

    if (!shouldRetryStatus(response.status) || attempt === options.retries) {
      return null;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const backoffMs = retryAfterMs ?? options.baseDelayMs * 2 ** attempt;
    await sleep(backoffMs);
  }

  return null;
};
