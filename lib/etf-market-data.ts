import "server-only";

import { cleanBars, fetchMarketBars } from "@/lib/market-data";
import {
  ETF_POOL,
  rankMomentumInputs,
  RotationDataError,
  shanghaiBusinessClock,
  type MomentumRanking,
} from "@/lib/etf-rotation";

type EastmoneyListResponse = {
  rc: number;
  data?: {
    diff?: EastmoneyListQuote[];
  };
};

type EastmoneyListQuote = {
  f2?: number | string;
  f12?: string;
  f14?: string;
  f124?: number | string;
};

type EastmoneyQuoteResponse = {
  rc: number;
  data?: null | {
    f43?: number | string;
    f57?: string;
    f58?: string;
    f59?: number | string;
    f86?: number | string;
  };
};

export type RotationMarketResult = {
  rankings: MomentumRanking[];
  marketDataAt: string;
  provider: string;
};

function normalizedSymbol(symbol: string) {
  return `${symbol}.${symbol.startsWith("5") ? "SH" : "SZ"}`;
}

function snapshotSecurityId(symbol: string) {
  return `${symbol.startsWith("5") ? "1" : "0"}.${symbol}`;
}

function quoteNumber(value: number | string | undefined, divisor = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number / divisor : 0;
}

function isUsableQuote(quote: EastmoneyListQuote | undefined) {
  return quoteNumber(quote?.f2) > 0 && quoteNumber(quote?.f124) > 0;
}

async function fetchWithRetry(url: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0 (compatible; GlacierSignal/1.0)",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (response.status < 500) throw new RotationDataError(`行情接口返回 ${response.status}。`, "INVALID_PRICE");
        throw new Error(`行情接口返回 ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof RotationDataError || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError instanceof RotationDataError
    ? lastError
    : new RotationDataError("ETF 实时行情暂时不可用。", "INCOMPLETE_POOL");
}

async function fetchSingleRealtimeQuote(symbol: string): Promise<EastmoneyListQuote> {
  const params = new URLSearchParams({
    secid: snapshotSecurityId(symbol),
    fields: "f43,f57,f58,f59,f86",
    _: String(Date.now()),
  });
  const response = await fetchWithRetry(`https://push2.eastmoney.com/api/qt/stock/get?${params}`);
  const payload = await response.json() as EastmoneyQuoteResponse;
  const data = payload.data;
  const decimals = Number(data?.f59);
  const divisor = 10 ** (Number.isInteger(decimals) && decimals >= 0 ? decimals : 2);
  const price = quoteNumber(data?.f43, divisor);
  const quoteSeconds = quoteNumber(data?.f86);
  if (payload.rc !== 0 || !data || price <= 0 || quoteSeconds <= 0) {
    throw new RotationDataError(`${symbol} 实时行情返回内容不完整。`, "INCOMPLETE_POOL");
  }
  return {
    f2: price,
    f12: data.f57 ?? symbol,
    f14: data.f58 ?? data.f57 ?? symbol,
    f124: quoteSeconds,
  };
}

async function fetchRealtimeQuotes() {
  const params = new URLSearchParams({
    secids: ETF_POOL.map(snapshotSecurityId).join(","),
    fields: "f2,f12,f14,f124",
    fltt: "2",
    invt: "2",
  });
  const quotes = new Map<string, EastmoneyListQuote>();
  try {
    const response = await fetchWithRetry(`https://push2.eastmoney.com/api/qt/ulist.np/get?${params}`);
    const payload = await response.json() as EastmoneyListResponse;
    if (payload.rc !== 0 || !payload.data?.diff) {
      throw new RotationDataError("ETF 实时行情返回内容不完整。", "INCOMPLETE_POOL");
    }
    for (const item of payload.data.diff) {
      if (item.f12) quotes.set(item.f12, item);
    }
  } catch (error) {
    console.warn("ETF rotation batch quote failed", error instanceof Error ? error.message : "unknown error");
  }

  const symbolsNeedingFallback = ETF_POOL.filter((symbol) => !isUsableQuote(quotes.get(symbol)));
  await Promise.all(symbolsNeedingFallback.map(async (symbol) => {
    try {
      quotes.set(symbol, await fetchSingleRealtimeQuote(symbol));
    } catch (error) {
      console.warn(`ETF rotation single quote failed for ${symbol}`, error instanceof Error ? error.message : "unknown error");
    }
  }));

  const unavailableSymbols = ETF_POOL.filter((symbol) => !isUsableQuote(quotes.get(symbol)));
  if (unavailableSymbols.length > 0) {
    throw new RotationDataError(`固定 ETF 池未能取得完整实时快照，缺少 ${unavailableSymbols.join(", ")}。`, "INCOMPLETE_POOL");
  }
  return quotes;
}

export async function fetchRotationMarketData(
  businessDate: string,
  options: { strictTradingSnapshot?: boolean } = {},
): Promise<RotationMarketResult> {
  const quotes = await fetchRealtimeQuotes();
  const inputs = await Promise.all(ETF_POOL.map(async (symbol) => {
    const quote = quotes.get(symbol);
    const currentPrice = Number(quote?.f2);
    const quoteSeconds = Number(quote?.f124);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(quoteSeconds) || quoteSeconds <= 0) {
      throw new RotationDataError(`${symbol} 最新价或行情时间无效。`, "INVALID_PRICE");
    }
    const marketDataAt = new Date(quoteSeconds * 1000).toISOString();
    const quoteClock = shanghaiBusinessClock(new Date(marketDataAt));
    if (options.strictTradingSnapshot && quoteClock.date !== businessDate) {
      throw new RotationDataError(`${symbol} 行情日期为 ${quoteClock.date}，不属于业务日期 ${businessDate}。`, "STALE_QUOTE");
    }

    const history = await fetchMarketBars(normalizedSymbol(symbol), 80);
    const completedBars = cleanBars(history.bars)
      .filter((bar) => bar.date < businessDate)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (completedBars.length < 24) {
      throw new RotationDataError(`${symbol} 仅取得 ${completedBars.length} 个已完成交易日。`, "INSUFFICIENT_HISTORY");
    }
    return {
      symbol,
      name: quote?.f14?.trim() || history.name || null,
      currentPrice,
      marketDataAt,
      completedCloses: completedBars.slice(-24).map((bar) => bar.close),
    };
  }));

  const rankings = rankMomentumInputs(inputs);
  const marketDataAt = rankings.reduce((latest, item) => item.marketDataAt > latest ? item.marketDataAt : latest, "");
  return { rankings, marketDataAt, provider: "东方财富实时快照 / 腾讯证券与东方财富前复权日线" };
}
