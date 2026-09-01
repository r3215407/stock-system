import "client-only";

import type { DailyBar } from "@/lib/market-data";

type TencentResponse = {
  code: number;
  data?: Record<string, {
    qfqday?: string[][];
    day?: string[][];
  }>;
};

export class BrowserMarketDataError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM_ERROR",
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "BrowserMarketDataError";
  }
}

const MIN_REQUEST_INTERVAL_MS = 900;
let nextRequestAt = 0;
let requestGate = Promise.resolve();

function tencentSecurityId(symbol: string) {
  const [code, suffix] = symbol.split(".");
  return `${suffix.toLowerCase()}${code}`;
}

function parseTencentBar(row: string[]): DailyBar {
  const [date, open, close, high, low, volume] = row;
  const openValue = Number(open);
  const closeValue = Number(close);
  const highValue = Number(high);
  const lowValue = Number(low);
  const volumeValue = Number(volume);
  return {
    date,
    open: openValue,
    close: closeValue,
    high: highValue,
    low: lowValue,
    volume: volumeValue,
    amount: volumeValue * 100 * ((openValue + closeValue + highValue + lowValue) / 4),
  };
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(done, delay);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("请求已取消", "AbortError"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function waitForRequestSlot(signal: AbortSignal) {
  let release = () => {};
  const previous = requestGate;
  requestGate = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay > 0) await wait(delay, signal);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  } finally {
    release();
  }
}

async function fetchOnce(symbol: string, limit: number, parentSignal: AbortSignal) {
  await waitForRequestSlot(parentSignal);
  const securityId = tencentSecurityId(symbol);
  const params = new URLSearchParams({ param: `${securityId},day,,,${limit},qfq` });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new DOMException("行情请求超时", "TimeoutError")), 10_000);
  const abortFromParent = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  try {
    const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });
    if (!response.ok) {
      const throttled = response.status === 429 || response.status === 501 || response.status === 503;
      throw new BrowserMarketDataError(
        throttled ? `腾讯行情请求过密或暂不可用（HTTP ${response.status}）` : `腾讯行情返回 HTTP ${response.status}`,
        throttled ? "RATE_LIMITED" : "UPSTREAM_ERROR",
        response.status,
      );
    }
    const payload = await response.json() as TencentResponse;
    const rows = payload.data?.[securityId]?.qfqday ?? payload.data?.[securityId]?.day;
    if (payload.code !== 0 || !rows?.length) {
      throw new BrowserMarketDataError("腾讯行情未返回该股票的日线数据", "NOT_FOUND");
    }
    return rows.map(parseTencentBar);
  } catch (error) {
    if (parentSignal.aborted) throw parentSignal.reason ?? error;
    if (controller.signal.aborted) throw new BrowserMarketDataError("腾讯行情请求超过10秒", "TIMEOUT");
    if (error instanceof BrowserMarketDataError) throw error;
    throw new BrowserMarketDataError(
      error instanceof Error && error.message ? `浏览器无法读取腾讯行情：${error.message}` : "浏览器无法读取腾讯行情",
      "UPSTREAM_ERROR",
    );
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

export async function fetchBrowserMarketBars(symbol: string, signal: AbortSignal, limit = 320) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchOnce(symbol, limit, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt === 0) {
        const retryDelay = error instanceof BrowserMarketDataError && error.code === "RATE_LIMITED" ? 5_000 : 2_000;
        await wait(retryDelay + Math.floor(Math.random() * 800), signal);
      }
    }
  }
  throw lastError;
}
