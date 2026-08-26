export const ETF_STRATEGY_KEY = "etf_momentum_v1";
export const ETF_STRATEGY_VERSION = "ETF 动量 1.0";
export const ETF_START_DATE = "2026-06-08";
export const ETF_START_VALUE = "100000.000000";
export const ETF_POOL = Object.freeze([
  "518880",
  "513100",
  "513350",
  "159915",
  "510180",
  "159612",
  "513030",
  "159928",
  "513520",
]);

export type RotationRunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED_NON_TRADING_DAY";
export type RotationAction = "BUY" | "SELL_BUY" | "HOLD";

export type MomentumInput = {
  symbol: string;
  name: string | null;
  currentPrice: number;
  marketDataAt: string;
  completedCloses: number[];
};

export type MomentumRanking = MomentumInput & {
  rank: number;
  momentum: number;
  rSquared: number;
  score: number;
};

export class RotationDataError extends Error {
  readonly code:
    | "INCOMPLETE_POOL"
    | "INVALID_PRICE"
    | "STALE_QUOTE"
    | "INSUFFICIENT_HISTORY"
    | "INVALID_HISTORY"
    | "INVALID_REGRESSION";

  constructor(
    message: string,
    code: RotationDataError["code"],
  ) {
    super(message);
    this.name = "RotationDataError";
    this.code = code;
  }
}

function assertFinitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RotationDataError(`${label}不是有限正数。`, "INVALID_PRICE");
  }
}

export function calculateMomentum(prices: readonly number[]) {
  if (prices.length !== 25) {
    throw new RotationDataError(`动量计算需要 25 个价格点，当前为 ${prices.length} 个。`, "INSUFFICIENT_HISTORY");
  }
  prices.forEach((price, index) => assertFinitePositive(price, `第 ${index + 1} 个价格`));

  const y = prices.map(Math.log);
  const meanX = 12;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  let numerator = 0;
  let denominator = 0;
  let totalVariance = 0;
  for (let index = 0; index < y.length; index += 1) {
    const dx = index - meanX;
    numerator += dx * (y[index] - meanY);
    denominator += dx * dx;
    totalVariance += (y[index] - meanY) ** 2;
  }
  if (denominator <= 0 || totalVariance <= 0) {
    throw new RotationDataError("价格序列缺少可用于回归的波动。", "INVALID_REGRESSION");
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  let squaredError = 0;
  for (let index = 0; index < y.length; index += 1) {
    squaredError += (y[index] - (intercept + slope * index)) ** 2;
  }
  const rSquared = 1 - squaredError / totalVariance;
  const momentum = Math.exp(slope * 250) - 1;
  const score = momentum * rSquared;
  if (![slope, rSquared, momentum, score].every(Number.isFinite)) {
    throw new RotationDataError("动量回归产生了非法数值。", "INVALID_REGRESSION");
  }
  return { slope, rSquared, momentum, score };
}

export function rankMomentumInputs(inputs: readonly MomentumInput[]): MomentumRanking[] {
  if (inputs.length !== ETF_POOL.length || ETF_POOL.some((symbol) => !inputs.some((item) => item.symbol === symbol))) {
    throw new RotationDataError("ETF 池行情不完整，必须同时取得固定 9 只 ETF。", "INCOMPLETE_POOL");
  }
  const ranked = inputs.map((input, poolIndex) => {
    assertFinitePositive(input.currentPrice, `${input.symbol} 最新价`);
    if (input.completedCloses.length < 24) {
      throw new RotationDataError(`${input.symbol} 只有 ${input.completedCloses.length} 个已完成交易日。`, "INSUFFICIENT_HISTORY");
    }
    const closes = input.completedCloses.slice(-24);
    closes.forEach((price) => assertFinitePositive(price, `${input.symbol} 历史收盘价`));
    return {
      ...input,
      completedCloses: closes,
      ...calculateMomentum([...closes, input.currentPrice]),
      poolIndex,
    };
  });

  ranked.sort((left, right) => right.score - left.score || left.poolIndex - right.poolIndex);
  return ranked.map(({ poolIndex: _poolIndex, slope: _slope, ...item }, index) => ({ ...item, rank: index + 1 }));
}

export function shanghaiBusinessClock(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    weekday: get("weekday"),
  };
}

// 交易所 2026 年已公布休市安排中的工作日。周末由下方逻辑统一排除。
const SSE_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-02",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23",
  "2026-04-06",
  "2026-05-01", "2026-05-04", "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
]);

export function isChinaTradingDay(date: string) {
  const noonShanghai = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(noonShanghai.getTime())) return false;
  const weekday = noonShanghai.getUTCDay();
  return weekday >= 1 && weekday <= 5 && !SSE_HOLIDAYS_2026.has(date);
}

export type SnapshotMetricInput = {
  snapshotDate: string;
  totalValue: number;
  cumulativeReturn: number;
  annualizedReturn: number;
};

export function calculateSharpeRatio(snapshots: readonly SnapshotMetricInput[]) {
  if (snapshots.length < 3) return null;
  const ordered = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  const dailyReturns: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].totalValue <= 0 || !Number.isFinite(ordered[index].totalValue)) return null;
    dailyReturns.push(ordered[index].totalValue / ordered[index - 1].totalValue - 1);
  }
  if (dailyReturns.length < 2) return null;
  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1);
  const deviation = Math.sqrt(variance);
  return deviation > 0 ? mean / deviation * Math.sqrt(250) : null;
}

export function calculateAnnualizedReturn(totalValue: number, snapshotDate: string) {
  const start = new Date(`${ETF_START_DATE}T00:00:00+08:00`).getTime();
  const end = new Date(`${snapshotDate}T00:00:00+08:00`).getTime();
  const days = Math.round((end - start) / 86_400_000);
  if (days <= 0) return 0;
  const cumulativeReturn = totalValue / Number(ETF_START_VALUE) - 1;
  return (1 + cumulativeReturn) ** (365 / days) - 1;
}
