import "server-only";

import {
  getMa20DistanceScore,
  getMa60RelationshipScore,
  getPullbackAmplitudeScore,
  type AutomaticFilter,
  type MarketDataSnapshot,
  type ScoreModule,
} from "@/lib/evaluation";

type DailyBar = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
};

type EastmoneyResponse = {
  rc: number;
  data: null | {
    code: string;
    market: number;
    name: string;
    klines: string[];
  };
};

type TencentResponse = {
  code: number;
  data?: Record<string, {
    qfqday?: string[][];
    day?: string[][];
    qt?: Record<string, string[]>;
  }>;
};

export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INSUFFICIENT_DATA" | "INVALID_DATA" | "UPSTREAM_ERROR",
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

function eastmoneySecurityId(normalizedSymbol: string) {
  const [code, suffix] = normalizedSymbol.split(".");
  return `${suffix === "SH" ? "1" : "0"}.${code}`;
}

function tencentSecurityId(normalizedSymbol: string) {
  const [code, suffix] = normalizedSymbol.split(".");
  return `${suffix.toLowerCase()}${code}`;
}

function parseBar(row: string): DailyBar {
  const [date, open, close, high, low, volume, amount] = row.split(",");
  return {
    date,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
  };
}

function parseTencentBar(row: string[]): DailyBar {
  const [date, open, close, high, low, volume] = row;
  return {
    date,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: 0,
  };
}

function marketName(symbol: string) {
  if (symbol.endsWith(".SH")) return "上海证券交易所";
  if (symbol.endsWith(".BJ")) return "北京证券交易所";
  return "深圳证券交易所";
}

function instrumentType(name: string): MarketDataSnapshot["instrumentType"] {
  return /ETF|LOF|基金/i.test(name) ? "交易所交易基金" : "A股";
}

function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function smaSeries(bars: DailyBar[], period: number) {
  const values: Array<number | null> = Array(bars.length).fill(null);
  let sum = 0;
  for (let index = 0; index < bars.length; index += 1) {
    sum += bars[index].close;
    if (index >= period) sum -= bars[index - period].close;
    if (index >= period - 1) values[index] = sum / period;
  }
  return values;
}

function emaSeries(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  const output: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    output[index] = index === 0 ? values[index] : values[index] * multiplier + output[index - 1] * (1 - multiplier);
  }
  return output;
}

function macdHistogram(bars: DailyBar[]) {
  const closes = bars.map((bar) => bar.close);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif = closes.map((_, index) => ema12[index] - ema26[index]);
  const dea = emaSeries(dif, 9);
  return dif.map((value, index) => value - dea[index]);
}

function atr14(bars: DailyBar[]) {
  const ranges = bars.slice(-14).map((bar, index, recentBars) => {
    const absoluteIndex = bars.length - recentBars.length + index;
    const previousClose = absoluteIndex > 0 ? bars[absoluteIndex - 1].close : bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function scoreConditions(conditions: Array<{ passed: boolean; points: number }>) {
  const passed = conditions.filter((condition) => condition.passed).length;
  return {
    earned: conditions.reduce((sum, condition) => sum + (condition.passed ? condition.points : 0), 0),
    passed,
    failed: conditions.length - passed,
  };
}

function buildAutomaticEvaluation(bars: DailyBar[]) {
  const lastIndex = bars.length - 1;
  const current = bars[lastIndex];
  const previous = bars[lastIndex - 1];
  const ma5 = smaSeries(bars, 5);
  const ma10 = smaSeries(bars, 10);
  const ma20 = smaSeries(bars, 20);
  const ma60 = smaSeries(bars, 60);
  const currentMa5 = ma5[lastIndex] as number;
  const currentMa10 = ma10[lastIndex] as number;
  const currentMa20 = ma20[lastIndex] as number;
  const currentMa60 = ma60[lastIndex] as number;
  const ma20FiveDaysAgo = ma20[lastIndex - 5] as number;
  const ma20Slope = currentMa20 / ma20FiveDaysAgo - 1;
  const return20 = current.close / bars[lastIndex - 20].close - 1;

  const trendConditions = [
    { passed: current.close > currentMa20, points: 6 },
    { passed: currentMa5 > currentMa10, points: 6 },
    { passed: currentMa10 > currentMa20, points: 6 },
    { passed: ma20Slope >= 0.01, points: 6 },
    { passed: return20 > 0 && return20 <= 0.2, points: 6 },
  ];
  const trendScore = scoreConditions(trendConditions);

  const pullbackStart = Math.max(1, lastIndex - 9);
  let weakRun = 0;
  let longestWeakRun = 0;
  for (let index = pullbackStart; index <= lastIndex; index += 1) {
    const dailyReturn = bars[index].close / bars[index - 1].close - 1;
    weakRun = dailyReturn <= 0 || Math.abs(dailyReturn) <= 0.005 ? weakRun + 1 : 0;
    longestWeakRun = Math.max(longestWeakRun, weakRun);
  }
  const pullbackBars = bars.slice(lastIndex - 9, lastIndex + 1);
  const priorHigh = Math.max(...bars.slice(lastIndex - 9, lastIndex).map((bar) => bar.close));
  const pullbackLow = Math.min(...pullbackBars.map((bar) => bar.close));
  const pullbackLowestPrice = Math.min(...pullbackBars.map((bar) => bar.low));
  const pullbackAmplitude = 1 - pullbackLow / priorHigh;
  const lowOffset = pullbackBars.findIndex((bar) => bar.close === pullbackLow);
  const lowIndex = lastIndex - 9 + lowOffset;
  const lowMa20 = ma20[lowIndex] as number;
  const lowDistanceToMa20 = Math.abs(pullbackLow / lowMa20 - 1);
  const minimumCloseToMa60 = Math.min(...pullbackBars.map((bar, offset) => {
    const value = ma60[lastIndex - 9 + offset];
    return value === null ? Number.NEGATIVE_INFINITY : bar.close / value;
  }));
  const pullbackPoints = [
    longestWeakRun >= 2 ? 6 : 0,
    getPullbackAmplitudeScore(pullbackAmplitude),
    getMa20DistanceScore(lowDistanceToMa20),
    getMa60RelationshipScore(minimumCloseToMa60),
  ];
  const pullbackMaximums = [6, 7, 6, 6];
  const pullbackScore = {
    earned: pullbackPoints.reduce((sum, points) => sum + points, 0),
    passed: pullbackPoints.filter((points, index) => points === pullbackMaximums[index]).length,
    failed: pullbackPoints.filter((points) => points === 0).length,
    partial: pullbackPoints.filter((points, index) => points > 0 && points < pullbackMaximums[index]).length,
  };

  const priorThreeHigh = Math.max(...bars.slice(lastIndex - 3, lastIndex).map((bar) => bar.close));
  const crossedMa5 = current.close > currentMa5 && [1, 2, 3].some((offset) => {
    const comparisonMa = ma5[lastIndex - offset];
    return comparisonMa !== null && bars[lastIndex - offset].close <= comparisonMa;
  });
  const histogram = macdHistogram(bars);
  const macdImproved =
    (histogram[lastIndex] > histogram[lastIndex - 1] && histogram[lastIndex - 1] > histogram[lastIndex - 2]) ||
    (histogram[lastIndex - 1] < 0 && histogram[lastIndex] > 0);
  const brokeThreeDayHigh = current.close > priorThreeHigh;
  const strengthConditions = [
    { passed: current.close > current.open, points: 5 },
    { passed: current.close > previous.close, points: 5 },
    { passed: crossedMa5, points: 8 },
    { passed: brokeThreeDayHigh, points: 9 },
    { passed: macdImproved, points: 8 },
  ];
  const strengthScore = scoreConditions(strengthConditions);

  const automaticFilters: AutomaticFilter[] = [
    {
      id: "HF-02",
      label: "收盘价高于MA60",
      detail: `收盘 ¥${current.close.toFixed(2)} / MA60 ¥${currentMa60.toFixed(2)}`,
      status: current.close > currentMa60 ? "pass" : "fail",
    },
    {
      id: "HF-03",
      label: "MA20高于MA60",
      detail: `MA20 ¥${currentMa20.toFixed(2)} / MA60 ¥${currentMa60.toFixed(2)}`,
      status: currentMa20 > currentMa60 ? "pass" : "fail",
    },
    {
      id: "HF-04",
      label: "MA20最近5日向上",
      detail: `五日变化 ${percent(ma20Slope)}`,
      status: currentMa20 > ma20FiveDaysAgo ? "pass" : "fail",
    },
    {
      id: "HF-05",
      label: "重新转强触发",
      detail: crossedMa5 || brokeThreeDayHigh ? "已重新站上MA5或突破前三日最高收盘" : "等待重新站上MA5或突破前三日最高收盘",
      status: crossedMa5 || brokeThreeDayHigh ? "pass" : "fail",
    },
  ];

  const automaticModules: ScoreModule[] = [
    {
      id: "trend",
      label: "个股趋势质量",
      ...trendScore,
      determined: 30,
      total: 30,
      pending: 0,
      reason: `C/MA20差值 ${percent(current.close / currentMa20 - 1)}；MA20五日斜率 ${percent(ma20Slope)}；20日收益 ${percent(return20)}。`,
      details: [
        { label: "C/MA20差值", value: percent(current.close / currentMa20 - 1), status: trendConditions[0].passed ? "pass" : "fail" },
        { label: "MA5 / MA10", value: `¥${currentMa5.toFixed(2)} / ¥${currentMa10.toFixed(2)}`, status: trendConditions[1].passed ? "pass" : "fail" },
        { label: "MA10 / MA20", value: `¥${currentMa10.toFixed(2)} / ¥${currentMa20.toFixed(2)}`, status: trendConditions[2].passed ? "pass" : "fail" },
        { label: "MA20五日斜率", value: percent(ma20Slope), status: trendConditions[3].passed ? "pass" : "fail" },
        { label: "20日收益", value: percent(return20), status: trendConditions[4].passed ? "pass" : "fail" },
      ],
      source: "自动",
    },
    {
      id: "pullback",
      label: "回调质量",
      ...pullbackScore,
      determined: 25,
      total: 25,
      pending: 0,
      reason: `最长回落或横盘 ${longestWeakRun} 日；回调幅度 ${percent(pullbackAmplitude)}；低点距MA20 ${percent(lowDistanceToMa20)}。`,
      details: [
        { label: "最长回落或横盘", value: `${longestWeakRun}日`, status: pullbackPoints[0] === 6 ? "pass" : "fail", points: pullbackPoints[0], maximumPoints: 6 },
        { label: "回调幅度", value: percent(pullbackAmplitude), status: pullbackPoints[1] === 7 ? "pass" : pullbackPoints[1] > 0 ? "partial" : "fail", points: pullbackPoints[1], maximumPoints: 7 },
        { label: "低点距MA20", value: percent(lowDistanceToMa20), status: pullbackPoints[2] === 6 ? "pass" : pullbackPoints[2] > 0 ? "partial" : "fail", points: pullbackPoints[2], maximumPoints: 6 },
        { label: "回调与MA60关系", value: `最深收盘为MA60的 ${(minimumCloseToMa60 * 100).toFixed(2)}%`, status: pullbackPoints[3] === 6 ? "pass" : pullbackPoints[3] > 0 ? "partial" : "fail", points: pullbackPoints[3], maximumPoints: 6 },
      ],
      source: "自动",
    },
    {
      id: "strength",
      label: "重新转强信号",
      ...strengthScore,
      determined: 35,
      total: 35,
      pending: 0,
      reason: `日内涨幅 ${percent(current.close / current.open - 1)}；前三日最高收盘 ¥${priorThreeHigh.toFixed(2)}；MACD(12,26,9)柱 ${histogram[lastIndex].toFixed(4)}。`,
      details: [
        { label: "日内涨幅", value: percent(current.close / current.open - 1), status: strengthConditions[0].passed ? "pass" : "fail" },
        { label: "较前收盘", value: percent(current.close / previous.close - 1), status: strengthConditions[1].passed ? "pass" : "fail" },
        { label: "重新站上MA5", value: `收盘 ¥${current.close.toFixed(2)} / MA5 ¥${currentMa5.toFixed(2)}`, status: strengthConditions[2].passed ? "pass" : "fail" },
        { label: "突破前三日高", value: `收盘 ¥${current.close.toFixed(2)} / 阈值 ¥${priorThreeHigh.toFixed(2)}`, status: strengthConditions[3].passed ? "pass" : "fail" },
        { label: "MACD柱改善", value: histogram[lastIndex].toFixed(4), status: strengthConditions[4].passed ? "pass" : "fail" },
      ],
      source: "自动",
    },
  ];

  return {
    automaticFilters,
    automaticModules,
    crossedMa5,
    brokeThreeDayHigh,
    pullbackLow,
    pullbackLowestPrice,
    atr: atr14(bars),
  };
}

function buildMarketEnvironmentModule(bars: DailyBar[]): ScoreModule {
  const lastIndex = bars.length - 1;
  const ma20 = smaSeries(bars, 20);
  const currentMa20 = ma20[lastIndex];
  const ma20FiveDaysAgo = ma20[lastIndex - 5];
  if (bars.length < 26 || currentMa20 === null || ma20FiveDaysAgo === null) {
    return {
      id: "environment",
      label: "市场环境",
      earned: 0,
      determined: 0,
      total: 10,
      passed: 0,
      failed: 0,
      pending: 3,
      reason: "中证全指数据不足，市场环境暂未计分。",
      source: "自动",
    };
  }

  const current = bars[lastIndex];
  const return5 = current.close / bars[lastIndex - 5].close - 1;
  const conditions = [
    { passed: current.close > currentMa20, points: 4 },
    { passed: currentMa20 > ma20FiveDaysAgo, points: 4 },
    { passed: return5 > 0, points: 2 },
  ];
  const score = scoreConditions(conditions);
  return {
    id: "environment",
    label: "市场环境",
    ...score,
    determined: 10,
    total: 10,
    pending: 0,
    reason: `中证全指收盘/MA20 ${current.close.toFixed(2)} / ${currentMa20.toFixed(2)}；MA20五日变化 ${percent(currentMa20 / ma20FiveDaysAgo - 1)}；5日收益 ${percent(return5)}。`,
    details: [
      { label: "中证全指收盘 / MA20", value: `${current.close.toFixed(2)} / ${currentMa20.toFixed(2)}`, status: conditions[0].passed ? "pass" : "fail" },
      { label: "MA20五日变化", value: percent(currentMa20 / ma20FiveDaysAgo - 1), status: conditions[1].passed ? "pass" : "fail" },
      { label: "5日收益", value: percent(return5), status: conditions[2].passed ? "pass" : "fail" },
    ],
    source: "自动",
  };
}

async function fetchEastmoneyBars(normalizedSymbol: string) {
  const params = new URLSearchParams({
    secid: eastmoneySecurityId(normalizedSymbol),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: "101",
    fqt: "1",
    end: "20500101",
    lmt: "320",
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 (compatible; GlacierSignal/0.2)",
    },
    signal: AbortSignal.timeout(10000),
  }).catch((error: unknown) => {
    throw new MarketDataError(error instanceof Error ? error.message : "行情接口连接失败。", "UPSTREAM_ERROR");
  });

  if (!response.ok) {
    throw new MarketDataError(`行情接口返回 ${response.status}。`, "UPSTREAM_ERROR");
  }
  const payload = (await response.json()) as EastmoneyResponse;
  if (payload.rc !== 0 || !payload.data?.klines?.length) {
    throw new MarketDataError("无法识别该A股代码，或行情接口没有返回数据。", "NOT_FOUND");
  }
  const bars = payload.data.klines.map(parseBar);
  return { name: payload.data.name, bars, provider: "东方财富公开行情" };
}

async function fetchTencentBars(normalizedSymbol: string) {
  const securityId = tencentSecurityId(normalizedSymbol);
  const params = new URLSearchParams({ param: `${securityId},day,,,320,qfq` });
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://gu.qq.com/",
      "User-Agent": "Mozilla/5.0 (compatible; GlacierSignal/0.2)",
    },
    signal: AbortSignal.timeout(10000),
  }).catch((error: unknown) => {
    throw new MarketDataError(error instanceof Error ? error.message : "行情接口连接失败。", "UPSTREAM_ERROR");
  });

  if (!response.ok) {
    throw new MarketDataError(`行情接口返回 ${response.status}。`, "UPSTREAM_ERROR");
  }
  const payload = (await response.json()) as TencentResponse;
  const data = payload.data?.[securityId];
  const rows = data?.qfqday ?? data?.day;
  const name = data?.qt?.[securityId]?.[1];
  if (payload.code !== 0 || !rows?.length || !name) {
    throw new MarketDataError("无法识别该A股代码，或行情接口没有返回数据。", "NOT_FOUND");
  }
  return { name, bars: rows.map(parseTencentBar), provider: "腾讯证券公开行情" };
}

async function fetchMarketBars(normalizedSymbol: string) {
  try {
    return await fetchTencentBars(normalizedSymbol);
  } catch (tencentError) {
    try {
      return await fetchEastmoneyBars(normalizedSymbol);
    } catch (eastmoneyError) {
      if (tencentError instanceof MarketDataError && tencentError.code === "NOT_FOUND") throw tencentError;
      if (eastmoneyError instanceof MarketDataError) throw eastmoneyError;
      throw new MarketDataError("行情数据源暂时不可用。", "UPSTREAM_ERROR");
    }
  }
}

function cleanBars(rawBars: DailyBar[]) {
  const seenDates = new Set<string>();
  return rawBars.filter((bar) => {
    const valid =
      Boolean(bar.date) &&
      bar.open > 0 &&
      bar.close > 0 &&
      bar.high > 0 &&
      bar.low > 0 &&
      !seenDates.has(bar.date);
    seenDates.add(bar.date);
    return valid;
  });
}

export async function getMarketDataSnapshot(normalizedSymbol: string, signalDate?: string): Promise<MarketDataSnapshot> {
  const { name, bars: rawBars, provider } = await fetchMarketBars(normalizedSymbol);
  const bars = cleanBars(rawBars);
  if (bars.length < 250) {
    throw new MarketDataError(`仅取得 ${bars.length} 个有效交易日，少于模型0.4要求的250日。`, "INSUFFICIENT_DATA");
  }

  let signalIndex: number;
  if (signalDate) {
    signalIndex = bars.findIndex((bar) => bar.date === signalDate);
    if (signalIndex < 249) {
      throw new MarketDataError("指定信号日不存在，或此前不足250个有效交易日。", "INSUFFICIENT_DATA");
    }
  } else {
    signalIndex = bars.length - 1;
    const clock = shanghaiClock();
    if (bars[signalIndex].date === clock.date && clock.minutes < 15 * 60 + 5) signalIndex -= 1;
  }
  if (signalIndex < 249) {
    throw new MarketDataError("最新完整交易日前不足250个有效交易日。", "INSUFFICIENT_DATA");
  }

  const analysisBars = bars.slice(Math.max(0, signalIndex - 249), signalIndex + 1);
  const signalBar = bars[signalIndex];
  const nextBar = bars[signalIndex + 1] ?? null;
  const automatic = buildAutomaticEvaluation(analysisBars);
  const gapRate = nextBar ? nextBar.open / signalBar.close - 1 : null;
  const t1Open = nextBar && gapRate !== null
    ? {
        date: nextBar.date,
        open: nextBar.open,
        gapRate,
        status: gapRate <= 0.02 ? "pass" as const : "fail" as const,
      }
    : null;
  const plannedEntryPrice = nextBar?.open ?? signalBar.close;
  const priceFactor = plannedEntryPrice < 10 ? 1000 : 100;
  const initialStopPrice = Math.floor((automatic.pullbackLowestPrice - 0.3 * automatic.atr) * priceFactor) / priceFactor;
  const perShareRisk = plannedEntryPrice - initialStopPrice;
  const stopDistanceRate = perShareRisk / plannedEntryPrice;
  const resistanceBars = analysisBars.slice(Math.max(0, analysisBars.length - 61), -1);
  const resistancePrice = Math.max(...resistanceBars.map((bar) => bar.close));
  const rewardRiskRatio = perShareRisk > 0 ? (resistancePrice - plannedEntryPrice) / perShareRisk : Number.NEGATIVE_INFINITY;
  const brokeSixtyDayClosingHigh = signalBar.close > resistancePrice;
  const resistanceFilterPassed = brokeSixtyDayClosingHigh || rewardRiskRatio >= 2;
  const pressureDistanceRate = Math.max(0, (resistancePrice - signalBar.close) / resistancePrice);
  const strengthScore = automatic.automaticModules.find((module) => module.id === "strength")?.earned ?? 0;
  const criticalBreakout = !brokeSixtyDayClosingHigh && pressureDistanceRate <= 0.01 && strengthScore >= 27;
  const pressureStatus: MarketDataSnapshot["pressureStatus"] = brokeSixtyDayClosingHigh
    ? "breakout"
    : resistanceFilterPassed
      ? "sufficient"
      : criticalBreakout
        ? "critical"
        : "insufficient";

  automatic.automaticFilters.push(
    {
      id: "HF-06",
      label: "结构止损距离有效",
      detail: `入场 ¥${plannedEntryPrice.toFixed(2)} / 止损 ¥${initialStopPrice.toFixed(2)} / 距离 ${percent(stopDistanceRate)}`,
      status: perShareRisk > 0 && stopDistanceRate <= 0.12 ? "pass" : "fail",
    },
    {
      id: "HF-07",
      label: "压力空间或60日突破有效",
      detail: brokeSixtyDayClosingHigh
        ? `信号日收盘 ¥${signalBar.close.toFixed(2)} 已突破此前60日最高收盘 ¥${resistancePrice.toFixed(2)}，按上方无明确技术阻力处理`
        : `此前60日最高收盘 ¥${resistancePrice.toFixed(2)} / 可用空间 ${Number.isFinite(rewardRiskRatio) ? rewardRiskRatio.toFixed(2) : "—"}R（要求不少于2R）`,
      status: resistanceFilterPassed ? "pass" : criticalBreakout ? "pending" : "fail",
    },
    {
      id: "HF-08",
      label: "T+1高开不超过2%",
      detail: nextBar && gapRate !== null ? `${nextBar.date} 高开 ${percent(gapRate)}` : "等待下一交易日开盘确认",
      status: t1Open ? t1Open.status : "pending",
    },
  );

  let marketModule: ScoreModule;
  try {
    const benchmark = await fetchMarketBars("000985.SH");
    const benchmarkBars = cleanBars(benchmark.bars).filter((bar) => bar.date <= signalBar.date);
    marketModule = buildMarketEnvironmentModule(benchmarkBars);
  } catch {
    marketModule = buildMarketEnvironmentModule([]);
  }

  return {
    symbol: normalizedSymbol,
    name,
    instrumentType: instrumentType(name),
    market: marketName(normalizedSymbol),
    dataDate: signalBar.date,
    open: signalBar.open,
    close: signalBar.close,
    records: analysisBars.length,
    adjustment: "前复权",
    stage: nextBar ? "T+1执行确认" : "T日收盘后候选评估",
    completeness: marketModule.determined === 10 ? 100 : 90,
    fetchedAt: new Date().toISOString(),
    provider,
    benchmark: "中证全指（000985.SH）",
    plannedEntryPrice,
    initialStopPrice,
    resistancePrice,
    stopAlgorithm: `最近10日最低价 ¥${automatic.pullbackLowestPrice.toFixed(plannedEntryPrice < 10 ? 3 : 2)} − 0.3 × ATR14（${automatic.atr.toFixed(plannedEntryPrice < 10 ? 3 : 2)}）`,
    stopDistanceRate,
    pressureStatus,
    pressureDistanceRate,
    rewardRiskRatio: Number.isFinite(rewardRiskRatio) ? rewardRiskRatio : null,
    entryTriggerPassed: automatic.crossedMa5 || automatic.brokeThreeDayHigh,
    automaticFilters: automatic.automaticFilters,
    automaticModules: [...automatic.automaticModules, marketModule],
    t1Open,
  };
}
