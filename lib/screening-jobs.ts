import "server-only";

import { randomUUID } from "node:crypto";

import { getStopDistanceRiskAdjustment } from "@/lib/evaluation";
import { isChinaTradingDay } from "@/lib/etf-rotation";
import { buildAutomaticEvaluation, buildMarketEnvironmentModule, cleanBars, fetchMarketBars, shanghaiClock } from "@/lib/market-data";
import {
  cancelScreeningJobRow,
  claimScreeningInitialization,
  claimScreeningBatch,
  completeScreeningBatch,
  completeScreeningJob,
  createScreeningJobRow,
  deleteExpiredScreeningJobs,
  failScreeningJob,
  findActiveScreeningJob,
  findFinalizableScreeningJobs,
  getClaimedScreeningBatch,
  findReusableScreeningJob,
  getScreeningJobRow,
  initializeScreeningBatches,
  loadScreeningAggregation,
  pauseScreeningBatch,
  pauseScreeningJobAfterFailures,
  releaseScreeningInitialization,
  releaseScreeningBatch,
  resumePausedScreeningJob,
  retryFailedScreeningJob,
  type ClaimedScreeningInitialization,
  type ScreeningBatchFailure,
  type ScreeningBatchSecurity,
} from "@/lib/screening-db";
import {
  SCREENING_FAILURE_PAUSE_THRESHOLD,
  describeScreeningFailure,
  isChiNextCode,
  rankCandidateResults,
  rankScreeningResults,
  sanitizeScreeningFailure,
  type BrowserScreeningWork,
  type ScreeningCandidate,
} from "@/lib/screening";
import { getStrategy, type StrategyDefinition } from "@/lib/strategies";

const UNIVERSE_API_HOSTS = ["push2.eastmoney.com", "82.push2.eastmoney.com"] as const;
const UNIVERSE_FETCH_ATTEMPTS = 2;
const BATCH_SIZE = 32;
const DEFAULT_SECURITY_WORKERS = 3;
const configuredSecurityWorkers = Number(process.env.SCREENING_SECURITY_WORKERS ?? DEFAULT_SECURITY_WORKERS);
const SECURITY_WORKERS = Number.isFinite(configuredSecurityWorkers)
  ? Math.min(6, Math.max(1, Math.floor(configuredSecurityWorkers)))
  : DEFAULT_SECURITY_WORKERS;
const PROVIDER = "新浪财经/东方财富证券池 + 腾讯证券日线（浏览器直连/服务端兼容）";

type UniverseSecurity = ScreeningBatchSecurity;
type EastmoneyUniverse = { data?: { total?: number; diff?: Array<{ f12?: string; f13?: number; f14?: string; f6?: number; f100?: string }> } };
type SinaUniverseItem = { symbol?: string; code?: string; name?: string; amount?: number | string };

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "未知网络错误";
}

function retryDelay(attempt: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
}

async function fetchSinaUniverse(): Promise<UniverseSecurity[]> {
  const baseUrl = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php";
  const headers = { Accept: "application/json,text/plain,*/*", Referer: "https://vip.stock.finance.sina.com.cn/", "User-Agent": "GlacierSignal/1.0" };

  async function fetchJson<T>(url: string, label: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < UNIVERSE_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as T;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < UNIVERSE_FETCH_ATTEMPTS) await retryDelay(attempt);
      }
    }
    throw new Error(`${label}：${errorMessage(lastError)}`);
  }

  const totalValue = await fetchJson<string | number>(`${baseUrl}/Market_Center.getHQNodeStockCount?node=hs_a`, "新浪证券数量获取失败");
  const total = Number(totalValue);
  if (!Number.isFinite(total) || total <= 0) throw new Error("新浪证券数量响应无效");
  const pageCount = Math.ceil(total / 100);
  const pages: SinaUniverseItem[][] = Array.from({ length: pageCount });
  let nextPage = 1;
  await Promise.all(Array.from({ length: Math.min(6, pageCount) }, async () => {
    while (nextPage <= pageCount) {
      const page = nextPage++;
      const params = new URLSearchParams({ page: String(page), num: "100", sort: "symbol", asc: "1", node: "hs_a", symbol: "" });
      pages[page - 1] = await fetchJson<SinaUniverseItem[]>(`${baseUrl}/Market_Center.getHQNodeData?${params}`, `新浪证券池第 ${page} 页获取失败`);
    }
  }));
  return pages.flat().flatMap((item) => {
    const symbol = item.symbol?.trim().toLowerCase();
    const code = item.code?.trim();
    const name = item.name?.trim();
    if (!symbol || !code || !name || !/^(?:sh|sz)/.test(symbol) || !/^[036]\d{5}$/.test(code)) return [];
    const market = symbol.startsWith("sh") ? "上海" as const : "深圳" as const;
    return [{ symbol: `${code}.${market === "上海" ? "SH" : "SZ"}`, code, name, market, latestAmount: Number(item.amount) || 0, industry: "未分类" }];
  });
}

async function fetchEastmoneyUniverse(): Promise<UniverseSecurity[]> {
  async function fetchPage(page: number) {
    const params = new URLSearchParams({
      pn: String(page), pz: "100", po: "1", np: "1", fltt: "2", invt: "2",
      fid: "f12", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", fields: "f12,f13,f14,f6,f100",
    });
    let lastError: unknown;
    for (const host of UNIVERSE_API_HOSTS) {
      for (let attempt = 0; attempt < UNIVERSE_FETCH_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(`https://${host}/api/qt/clist/get?${params}`, {
            cache: "no-store",
            headers: { Accept: "application/json", Referer: "https://quote.eastmoney.com/", "User-Agent": "GlacierSignal/1.0" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json() as EastmoneyUniverse;
          if (!payload.data || !Array.isArray(payload.data.diff)) throw new Error("响应缺少证券列表");
          return payload;
        } catch (error) {
          lastError = error;
          if (attempt + 1 < UNIVERSE_FETCH_ATTEMPTS) await retryDelay(attempt);
        }
      }
    }
    throw new Error(`证券池第 ${page} 页获取失败（主数据源及备用地址均不可用）：${errorMessage(lastError)}`);
  }
  const first = await fetchPage(1);
  const pageCount = Math.ceil((first.data?.total ?? 0) / 100);
  const payloads: EastmoneyUniverse[] = [first];
  let nextPage = 2;
  await Promise.all(Array.from({ length: Math.min(8, Math.max(0, pageCount - 1)) }, async () => {
    while (nextPage <= pageCount) payloads.push(await fetchPage(nextPage++));
  }));
  return payloads.flatMap((payload) => payload.data?.diff ?? []).flatMap((item) => {
    const code = item.f12?.trim();
    const name = item.f14?.trim();
    if (!code || !name || !/^[036]\d{5}$/.test(code)) return [];
    const market = item.f13 === 1 ? "上海" as const : "深圳" as const;
    return [{ symbol: `${code}.${market === "上海" ? "SH" : "SZ"}`, code, name, market, latestAmount: Number(item.f6) || 0, industry: item.f100?.trim() || "未分类" }];
  });
}

async function fetchUniverse(): Promise<UniverseSecurity[]> {
  try {
    return await fetchSinaUniverse();
  } catch (sinaError) {
    try {
      return await fetchEastmoneyUniverse();
    } catch (eastmoneyError) {
      throw new Error(`全市场证券池获取失败；新浪财经：${errorMessage(sinaError)}；东方财富备用源：${errorMessage(eastmoneyError)}`);
    }
  }
}

function latestCompleteIndex(bars: ReturnType<typeof cleanBars>, requestedDate: string | null) {
  if (requestedDate) return bars.findIndex((bar) => bar.date === requestedDate);
  let index = bars.length - 1;
  const clock = shanghaiClock();
  if (bars[index]?.date === clock.date && clock.minutes < 15 * 60 + 5) index -= 1;
  return index;
}

async function evaluateSecurity(security: UniverseSecurity, strategy: StrategyDefinition, requestedDate: string | null, environmentScore: number) {
  const fetched = await fetchMarketBars(security.symbol, 320);
  const bars = cleanBars(fetched.bars);
  const index = latestCompleteIndex(bars, requestedDate);
  if (index < 249) throw new Error("历史日线不足250日");
  const analysis = bars.slice(index - 249, index + 1);
  const signal = analysis.at(-1)!;
  const automatic = buildAutomaticEvaluation(analysis);
  const technicalScore = automatic.automaticModules.reduce((sum, module) => sum + module.earned, 0);
  const strengthScore = automatic.automaticModules.find((module) => module.id === "strength")?.earned ?? 0;
  const score = technicalScore + environmentScore;
  const averageAmount20 = analysis.slice(-20).reduce((sum, bar) => sum + bar.amount, 0) / 20;
  const initialStopPrice = Math.floor((automatic.pullbackLowestPrice - 0.3 * automatic.atr) * 100) / 100;
  const entryPrice = signal.close;
  const stopDistanceRate = (entryPrice - initialStopPrice) / entryPrice;
  const stopRule = getStopDistanceRiskAdjustment(stopDistanceRate, score);
  const resistancePrice = Math.max(...analysis.slice(-61, -1).map((bar) => bar.close));
  const riskPerShare = entryPrice - initialStopPrice;
  const breakout = signal.close > resistancePrice;
  const pressurePassed = breakout || (riskPerShare > 0 && (resistancePrice - entryPrice) / riskPerShare >= 2);
  const trendGate = automatic.automaticFilters.filter((filter) => filter.id !== "HF-05").every((filter) => filter.status === "pass");
  const trigger = automatic.crossedMa5 || automatic.brokeThreeDayHigh;
  const liquid = averageAmount20 >= strategy.universeConfig.minimumAverageAmount20;

  let bucket: ScreeningCandidate["bucket"] = "candidate";
  let conclusion = "候选";
  let firstReason = "全部硬性条件和评分门槛通过";
  if (!liquid) { bucket = "excluded"; conclusion = "已排除"; firstReason = "20日平均成交额不足5000万元"; }
  else if (!trendGate) { bucket = "excluded"; conclusion = "已排除"; firstReason = automatic.automaticFilters.find((item) => item.status === "fail")?.label ?? "趋势硬性过滤"; }
  else if (!stopRule.executable) { bucket = "excluded"; conclusion = "已排除"; firstReason = "止损距离不可执行"; }
  else if (!pressurePassed) { bucket = "excluded"; conclusion = "已排除"; firstReason = "压力空间不足2R"; }
  else if (score < strategy.signalConfig.minimumScore || technicalScore < strategy.signalConfig.minimumTechnicalScore) {
    bucket = "excluded"; conclusion = "已排除"; firstReason = score < 70 ? "总分不足70" : "技术分不足65";
  } else if (strengthScore < strategy.signalConfig.minimumStrengthScore || !trigger) {
    bucket = "watch"; conclusion = "等待转强"; firstReason = strengthScore < 21 ? "转强分不足21" : "未触发重新转强";
  }

  return {
    rank: null, symbol: security.symbol, code: security.code, name: security.name, market: security.market,
    industry: security.industry, bucket, conclusion, score, technicalScore, strengthScore, stopDistanceRate,
    riskFactor: stopRule.factor, riskLabel: stopRule.label,
    pressureStatus: breakout ? "breakout" as const : pressurePassed ? "sufficient" as const : "insufficient" as const,
    averageAmount20, signalDate: signal.date, entryPrice, initialStopPrice, firstReason,
    rankingReason: `总分 ${score} · 转强 ${strengthScore} · 止损 ${(stopDistanceRate * 100).toFixed(2)}%`,
  } satisfies ScreeningCandidate;
}

async function finalizeScreeningJob(jobId: string, strategy: StrategyDefinition) {
  const aggregation = await loadScreeningAggregation(jobId);
  if (!aggregation.job || aggregation.batches.some((batch) => batch.status === "pending" || batch.status === "running")) return false;
  const results = aggregation.batches.flatMap((batch) => batch.status === "completed" ? batch.results : []);
  const exclusionCounts = new Map(Object.entries(aggregation.job.initialExclusions));
  for (const batch of aggregation.batches) {
    for (const [reason, count] of Object.entries(batch.exclusions)) {
      exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + count);
    }
  }
  const failedBatchCount = aggregation.batches.filter((batch) => batch.status === "failed").length;
  const exclusions = [...exclusionCounts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  await completeScreeningJob({
    jobId,
    candidates: rankScreeningResults(results, strategy.outputConfig.topN),
    candidateTop10: rankCandidateResults(results, strategy.outputConfig.topN),
    exclusions,
    incomplete: failedBatchCount > 0 || aggregation.job.afterBasicFilter === 0
      || aggregation.job.failedCount / Math.max(1, aggregation.job.afterBasicFilter) > 0.05,
  });
  return true;
}

export async function prepareScreeningJob(
  strategy: StrategyDefinition,
  requestedDate: string | null,
  options: { idempotencyKey?: string; reuseCompleted?: boolean } = {},
) {
  const clock = shanghaiClock();
  const scanDate = requestedDate ?? clock.date;
  if (!isChinaTradingDay(scanDate)) throw new Error(`${scanDate} 不是中国 A 股交易日，未创建全市场扫描任务。`);
  await deleteExpiredScreeningJobs();
  const active = await findActiveScreeningJob(
    strategy.strategyId,
    strategy.strategyVersion,
    strategy.parameterVersion,
    requestedDate,
    clock.date,
  );
  if (active) return { job: active, created: false as const };
  if (options.reuseCompleted !== false) {
    const cached = await findReusableScreeningJob(
      strategy.strategyId,
      strategy.strategyVersion,
      strategy.parameterVersion,
      requestedDate,
      clock.date,
    );
    if (cached?.failedCount) {
      const retrying = await retryFailedScreeningJob(cached.jobId);
      if (retrying) return { job: retrying, created: false as const, retrying: true as const };
    }
    if (cached) return { job: cached, created: false as const };
  }
  const created = await createScreeningJobRow({
    idempotencyKey: options.idempotencyKey ?? `manual:${randomUUID()}`,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    parameterVersion: strategy.parameterVersion,
    requestedDate,
    businessDate: clock.date,
    provider: PROVIDER,
  });
  if (!created.created) return { job: await getScreeningJobRow(created.jobId), created: false as const };
  return { job: await getScreeningJobRow(created.jobId), created: true as const };
}

async function initializeClaimedScreeningJob(initialization: ClaimedScreeningInitialization) {
  const strategy = getStrategy(initialization.strategyId, initialization.strategyVersion);
  if (!strategy || strategy.status === "disabled") {
    const error = new Error("初始化任务对应的策略不存在或已停用。");
    await releaseScreeningInitialization(initialization, error);
    await failScreeningJob(initialization.jobId, error);
    return { processed: false as const, reason: "STRATEGY_NOT_FOUND" as const, jobId: initialization.jobId };
  }
  try {
    const exclusions = new Map<string, number>();
    const [universe, benchmark] = await Promise.all([
      fetchUniverse(),
      fetchMarketBars("000985.SH", 320).catch((error: unknown) => {
        throw new Error(`中证全指基准行情获取失败：${errorMessage(error)}`);
      }),
    ]);
    const base = universe.filter((item) => {
      if (isChiNextCode(item.code)) { exclusions.set("创业板（暂不扫描）", (exclusions.get("创业板（暂不扫描）") ?? 0) + 1); return false; }
      if (/^(?:ST|\*ST|退)/i.test(item.name)) { exclusions.set("ST / 退市风险", (exclusions.get("ST / 退市风险") ?? 0) + 1); return false; }
      if (item.latestAmount <= 0) { exclusions.set("停牌或无成交", (exclusions.get("停牌或无成交") ?? 0) + 1); return false; }
      return true;
    });
    const benchmarkBars = cleanBars(benchmark.bars);
    const benchmarkIndex = latestCompleteIndex(benchmarkBars, initialization.requestedDate);
    if (benchmarkIndex < 25) throw new Error("中证全指数据不足");
    const environmentScore = buildMarketEnvironmentModule(benchmarkBars.slice(0, benchmarkIndex + 1)).earned;
    await initializeScreeningBatches({
      jobId: initialization.jobId, universeTotal: universe.length, securities: base, environmentScore,
      initialExclusions: Object.fromEntries(exclusions), batchSize: BATCH_SIZE,
    });
    if (base.length === 0) await finalizeScreeningJob(initialization.jobId, strategy);
    return { processed: true as const, kind: "INITIALIZATION" as const, jobId: initialization.jobId, batchesCreated: Math.ceil(base.length / BATCH_SIZE) };
  } catch (error) {
    await releaseScreeningInitialization(initialization, error);
    throw error;
  }
}

export async function processNextScreeningWork(jobId?: string) {
  const initialization = await claimScreeningInitialization(jobId);
  if (initialization) return initializeClaimedScreeningJob(initialization);
  return processNextScreeningBatch(jobId);
}

export async function processNextScreeningBatch(jobId?: string) {
  const batch = await claimScreeningBatch(jobId);
  if (!batch) {
    const ready = await findFinalizableScreeningJobs(jobId);
    for (const job of ready) {
      const strategy = getStrategy(job.strategyId, job.strategyVersion);
      if (strategy) await finalizeScreeningJob(job.jobId, strategy);
      else await failScreeningJob(job.jobId, new Error("扫描任务对应的策略不存在。"));
    }
    return { processed: false as const, reason: "NO_PENDING_BATCH" as const, finalized: ready.length };
  }
  const strategy = getStrategy(batch.strategyId, batch.strategyVersion);
  if (!strategy || strategy.status === "disabled") {
    const error = new Error("扫描分片对应的策略不存在或已停用。");
    await releaseScreeningBatch(batch, error);
    await failScreeningJob(batch.jobId, error);
    return { processed: false as const, reason: "STRATEGY_NOT_FOUND" as const, jobId: batch.jobId };
  }
  try {
    const results: ScreeningCandidate[] = [...batch.previousResults];
    const exclusions = new Map(Object.entries(batch.previousExclusions));
    const failedSecurities: ScreeningBatchFailure[] = [];
    let cursor = 0;
    let dataDate: string | null = batch.previousDataDate;
    const workers = Array.from({ length: Math.min(SECURITY_WORKERS, batch.payload.length) }, async () => {
      while (cursor < batch.payload.length) {
        const security = batch.payload[cursor++];
        try {
          const result = await evaluateSecurity(security, strategy, batch.requestedDate, batch.environmentScore);
          results.push(result);
          dataDate ??= result.signalDate;
          if (result.bucket === "excluded") exclusions.set(result.firstReason, (exclusions.get(result.firstReason) ?? 0) + 1);
        } catch (error) {
          if (error instanceof Error && error.message.includes("历史日线不足250日")) {
            exclusions.set("上市不足250个交易日", (exclusions.get("上市不足250个交易日") ?? 0) + 1);
          } else {
            failedSecurities.push({ ...security, ...describeScreeningFailure(error) });
          }
        }
      }
    });
    await Promise.all(workers);
    await completeScreeningBatch({
      batchId: batch.batchId, jobId: batch.jobId, leaseToken: batch.leaseToken,
      results, exclusions: Object.fromEntries(exclusions),
      processed: batch.totalCount, scored: results.length, failedCount: failedSecurities.length,
      failedSecurities, dataDate,
    });
    const completed = await finalizeScreeningJob(batch.jobId, strategy);
    return { processed: true as const, jobId: batch.jobId, batchId: batch.batchId, completed };
  } catch (error) {
    await releaseScreeningBatch(batch, error);
    await finalizeScreeningJob(batch.jobId, strategy);
    throw error;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSubmittedCandidate(value: unknown): value is ScreeningCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ScreeningCandidate>;
  return typeof item.symbol === "string"
    && typeof item.code === "string"
    && typeof item.name === "string"
    && (item.market === "上海" || item.market === "深圳")
    && typeof item.industry === "string"
    && (item.bucket === "candidate" || item.bucket === "watch" || item.bucket === "excluded")
    && typeof item.conclusion === "string"
    && isFiniteNumber(item.score)
    && isFiniteNumber(item.technicalScore)
    && isFiniteNumber(item.strengthScore)
    && isFiniteNumber(item.stopDistanceRate)
    && isFiniteNumber(item.riskFactor)
    && typeof item.riskLabel === "string"
    && (item.pressureStatus === "breakout" || item.pressureStatus === "sufficient" || item.pressureStatus === "insufficient")
    && isFiniteNumber(item.averageAmount20)
    && typeof item.signalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.signalDate)
    && isFiniteNumber(item.entryPrice)
    && isFiniteNumber(item.initialStopPrice)
    && typeof item.firstReason === "string"
    && typeof item.rankingReason === "string";
}

async function finalizeReadyScreeningJob(jobId: string) {
  const ready = await findFinalizableScreeningJobs(jobId);
  for (const job of ready) {
    const strategy = getStrategy(job.strategyId, job.strategyVersion);
    if (strategy) await finalizeScreeningJob(job.jobId, strategy);
    else await failScreeningJob(job.jobId, new Error("扫描任务对应的策略不存在。"));
  }
}

export async function claimBrowserScreeningWork(jobId: string): Promise<BrowserScreeningWork> {
  const initialization = await claimScreeningInitialization(jobId);
  if (initialization) {
    await initializeClaimedScreeningJob(initialization);
    return { kind: "INITIALIZATION" };
  }
  const batch = await claimScreeningBatch(jobId);
  if (!batch) {
    await finalizeReadyScreeningJob(jobId);
    return { kind: "IDLE" };
  }
  return {
    kind: "BATCH",
    batchId: batch.batchId,
    leaseToken: batch.leaseToken,
    securities: batch.payload,
    strategyId: batch.strategyId,
    strategyVersion: batch.strategyVersion,
    requestedDate: batch.requestedDate,
    environmentScore: batch.environmentScore,
  };
}

export async function submitBrowserScreeningWork(input: {
  jobId: string;
  batchId: string;
  leaseToken: string;
  results: unknown[];
  failures: Array<{ symbol?: unknown; errorCode?: unknown; errorMessage?: unknown }>;
  shortHistorySymbols: unknown[];
  paused?: boolean;
  unprocessedSymbols?: unknown[];
  dataDate: string | null;
}) {
  const batch = await getClaimedScreeningBatch(input.jobId, input.batchId, input.leaseToken);
  if (!batch) throw new Error("扫描分片不存在或租约已失效，请重新领取。");
  const strategy = getStrategy(batch.strategyId, batch.strategyVersion);
  if (!strategy || strategy.status === "disabled") throw new Error("扫描分片对应的策略不存在或已停用。");

  const securities = new Map(batch.payload.map((security) => [security.symbol, security]));
  const covered = new Set<string>();
  function claimSymbol(symbol: unknown) {
    if (typeof symbol !== "string" || !securities.has(symbol)) throw new Error("扫描结果包含不属于当前分片的股票。");
    if (covered.has(symbol)) throw new Error(`扫描结果重复提交股票 ${symbol}。`);
    covered.add(symbol);
    return securities.get(symbol)!;
  }

  const submittedResults = input.results.map((value) => {
    if (!validSubmittedCandidate(value)) throw new Error("浏览器提交了无效的评分结果。");
    const security = claimSymbol(value.symbol);
    return {
      ...value,
      rank: null,
      symbol: security.symbol,
      code: security.code,
      name: security.name,
      market: security.market,
      industry: security.industry,
    } satisfies ScreeningCandidate;
  });
  const failures = input.failures.map((failure) => {
    const security = claimSymbol(failure.symbol);
    return { ...security, ...sanitizeScreeningFailure(failure.errorCode, failure.errorMessage) };
  });
  const shortHistorySymbols = input.shortHistorySymbols.map((symbol) => claimSymbol(symbol).symbol);
  const unprocessed = input.paused ? (input.unprocessedSymbols ?? []).map((symbol) => claimSymbol(symbol)) : [];
  if (covered.size !== batch.payload.length) throw new Error("浏览器提交的分片结果不完整，请重新处理该分片。");
  if (input.dataDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dataDate)) throw new Error("扫描数据日期无效。");

  const results = [...batch.previousResults, ...submittedResults];
  const exclusions = new Map(Object.entries(batch.previousExclusions));
  for (const result of submittedResults) {
    if (result.bucket === "excluded") exclusions.set(result.firstReason, (exclusions.get(result.firstReason) ?? 0) + 1);
  }
  if (shortHistorySymbols.length) {
    exclusions.set("上市不足250个交易日", (exclusions.get("上市不足250个交易日") ?? 0) + shortHistorySymbols.length);
  }

  const pauseFailureDelta = failures.length;
  if (input.paused) {
    if (batch.pauseFailureCount + pauseFailureDelta < SCREENING_FAILURE_PAUSE_THRESHOLD
      || unprocessed.length === 0 && failures.length < 1) throw new Error("暂停提交尚未达到行情失败阈值或缺少待重试标的。");
    const retrySecurities: ScreeningBatchFailure[] = [
      ...failures,
      ...unprocessed.map((security) => ({ ...security, errorCode: "PAUSED_UNPROCESSED", errorMessage: "达到行情失败暂停阈值前尚未查询。" })),
    ];
    const aggregation = await loadScreeningAggregation(batch.jobId);
    const aggregateResults = aggregation.batches.flatMap((item) => item.batchId === batch.batchId ? results : item.results);
    const aggregateExclusions = new Map(aggregation.job ? Object.entries(aggregation.job.initialExclusions) : []);
    for (const item of aggregation.batches) {
      const source = item.batchId === batch.batchId ? Object.fromEntries(exclusions) : item.exclusions;
      for (const [reason, count] of Object.entries(source)) aggregateExclusions.set(reason, (aggregateExclusions.get(reason) ?? 0) + count);
    }
    await pauseScreeningBatch({
      batchId: batch.batchId,
      jobId: batch.jobId,
      leaseToken: batch.leaseToken,
      results,
      exclusions: Object.fromEntries(exclusions),
      retrySecurities,
      processed: Math.max(0, batch.totalCount - unprocessed.length),
      failedCount: failures.length,
      dataDate: batch.previousDataDate ?? input.dataDate,
      pauseFailureDelta,
      candidates: rankScreeningResults(aggregateResults, strategy.outputConfig.topN),
      candidateTop10: rankCandidateResults(aggregateResults, strategy.outputConfig.topN),
      aggregatedExclusions: [...aggregateExclusions].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    });
    return { processed: true as const, paused: true as const, batchId: batch.batchId };
  }

  await completeScreeningBatch({
    batchId: batch.batchId,
    jobId: batch.jobId,
    leaseToken: batch.leaseToken,
    results,
    exclusions: Object.fromEntries(exclusions),
    processed: batch.totalCount,
    scored: results.length,
    failedCount: failures.length,
    failedSecurities: failures,
    dataDate: batch.previousDataDate ?? input.dataDate,
    pauseFailureDelta,
  });
  await finalizeReadyScreeningJob(batch.jobId);
  return { processed: true as const, batchId: batch.batchId };
}

export async function getScreeningJob(jobId: string) {
  return (await getScreeningJobRow(jobId)) ?? undefined;
}

export async function cancelScreeningJob(jobId: string) {
  return (await cancelScreeningJobRow(jobId)) ?? undefined;
}

export async function resumeScreeningJob(jobId: string) {
  return (await resumePausedScreeningJob(jobId)) ?? undefined;
}

export async function pauseScreeningJobForWorkerFailures(jobId: string) {
  return (await pauseScreeningJobAfterFailures(jobId)) ?? undefined;
}
