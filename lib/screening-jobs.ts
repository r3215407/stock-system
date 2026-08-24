import "server-only";

import { randomUUID } from "node:crypto";

import { getScorePositionRule, getStopDistanceRiskAdjustment } from "@/lib/evaluation";
import { buildAutomaticEvaluation, buildMarketEnvironmentModule, cleanBars, fetchMarketBars, shanghaiClock } from "@/lib/market-data";
import { isRedisConfigured, redisDelete, redisGet, redisSet } from "@/lib/redis-store";
import { rankScreeningResults, type ScreeningCandidate, type ScreeningJob } from "@/lib/screening";
import type { StrategyDefinition } from "@/lib/strategies";

const CACHE_TTL_SECONDS = 3 * 24 * 60 * 60;
const JOB_TTL_MS = CACHE_TTL_SECONDS * 1000;
const UNIVERSE_API_HOSTS = ["push2.eastmoney.com", "82.push2.eastmoney.com"] as const;
const UNIVERSE_FETCH_ATTEMPTS = 2;
type InternalJob = ScreeningJob & { cancelled?: boolean };
const jobGlobal = globalThis as typeof globalThis & { glacierScreeningJobs?: Map<string, InternalJob> };
const jobs = jobGlobal.glacierScreeningJobs ??= new Map<string, InternalJob>();
const persistQueues = new Map<string, Promise<void>>();

type UniverseSecurity = { symbol: string; code: string; name: string; market: "上海" | "深圳"; latestAmount: number; industry: string };
type EastmoneyUniverse = { data?: { total?: number; diff?: Array<{ f12?: string; f13?: number; f14?: string; f6?: number; f100?: string }> } };
type SinaUniverseItem = { symbol?: string; code?: string; name?: string; amount?: number | string };

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) if (new Date(job.expiresAt).getTime() <= now) jobs.delete(id);
}

function jobKey(jobId: string) {
  return `glacier:screening:job:${jobId}`;
}

function resultKey(strategy: StrategyDefinition, requestedDate: string | null) {
  return [
    "glacier:screening:result",
    strategy.strategyId,
    strategy.strategyVersion,
    strategy.parameterVersion,
    requestedDate ?? "latest",
  ].join(":");
}

function serializeJob(job: InternalJob) {
  const { cancelled: _cancelled, ...snapshot } = job;
  return JSON.stringify(snapshot);
}

function persistJob(job: InternalJob) {
  if (!isRedisConfigured()) return Promise.resolve();
  const previous = persistQueues.get(job.jobId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => redisSet(jobKey(job.jobId), serializeJob(job), CACHE_TTL_SECONDS));
  persistQueues.set(job.jobId, next);
  return next.finally(() => {
    if (persistQueues.get(job.jobId) === next) persistQueues.delete(job.jobId);
  });
}

function parseJob(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as ScreeningJob; }
  catch { return null; }
}

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

async function runJob(job: InternalJob, strategy: StrategyDefinition) {
  const startedAt = Date.now();
  const exclusions = new Map<string, number>();
  try {
    job.stage = "获取证券池";
    await persistJob(job);
    const [universe, benchmark] = await Promise.all([
      fetchUniverse(),
      fetchMarketBars("000985.SH", 320).catch((error: unknown) => {
        throw new Error(`中证全指基准行情获取失败：${errorMessage(error)}`);
      }),
    ]);
    job.universeTotal = universe.length;
    job.stage = "基础过滤";
    const base = universe.filter((item) => {
      if (/^(?:ST|\*ST|退)/i.test(item.name)) { exclusions.set("ST / 退市风险", (exclusions.get("ST / 退市风险") ?? 0) + 1); return false; }
      if (item.latestAmount <= 0) { exclusions.set("停牌或无成交", (exclusions.get("停牌或无成交") ?? 0) + 1); return false; }
      return true;
    });
    job.afterBasicFilter = base.length;
    await persistJob(job);
    const benchmarkBars = cleanBars(benchmark.bars);
    const benchmarkIndex = latestCompleteIndex(benchmarkBars, job.requestedDate);
    if (benchmarkIndex < 25) throw new Error("中证全指数据不足");
    const environmentScore = buildMarketEnvironmentModule(benchmarkBars.slice(0, benchmarkIndex + 1)).earned;
    job.stage = "读取日线";
    const results: ScreeningCandidate[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(12, base.length) }, async () => {
      while (cursor < base.length && !job.cancelled) {
        const security = base[cursor++];
        try {
          const result = await evaluateSecurity(security, strategy, job.requestedDate, environmentScore);
          results.push(result);
          if (result.bucket === "excluded") exclusions.set(result.firstReason, (exclusions.get(result.firstReason) ?? 0) + 1);
          job.scored += 1;
          job.dataDate = job.dataDate ?? result.signalDate;
        } catch (error) {
          if (error instanceof Error && error.message.includes("历史日线不足250日")) {
            exclusions.set("上市不足250个交易日", (exclusions.get("上市不足250个交易日") ?? 0) + 1);
          } else {
            job.failedCount += 1;
          }
        } finally {
          job.processed += 1;
          job.elapsedMs = Date.now() - startedAt;
          if (job.processed % 50 === 0) await persistJob(job);
        }
      }
    });
    await Promise.all(workers);
    if (job.cancelled) { job.status = "cancelled"; job.stage = "已取消"; return; }
    job.stage = "评分排名";
    const topResults = rankScreeningResults(results, strategy.outputConfig.topN);
    job.incomplete = job.universeTotal === 0 || job.failedCount / Math.max(1, job.afterBasicFilter) > 0.05;
    job.candidates = topResults;
    job.watch = rankScreeningResults(results.filter((item) => item.bucket === "watch"), 100);
    job.exclusions = [...exclusions].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    job.status = "completed";
    job.stage = "完成";
    job.generatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed"; job.stage = "失败"; job.error = error instanceof Error ? error.message : "扫描失败";
  } finally {
    job.elapsedMs = Date.now() - startedAt;
    if (job.status === "completed") {
      job.expiresAt = new Date(Date.now() + JOB_TTL_MS).toISOString();
    }
    await persistJob(job);
    if (job.status === "completed" && isRedisConfigured()) {
      await redisSet(resultKey(strategy, job.requestedDate), serializeJob(job), CACHE_TTL_SECONDS);
    }
  }
}

export async function prepareScreeningJob(strategy: StrategyDefinition, requestedDate: string | null) {
  cleanupJobs();
  if (process.env.VERCEL && !isRedisConfigured()) {
    throw new Error("Vercel 环境未配置 Redis。请连接 Storage，或设置 REDIS_URL / KV_REST_API_URL 与 KV_REST_API_TOKEN。");
  }
  if (isRedisConfigured()) {
    const key = resultKey(strategy, requestedDate);
    const cached = parseJob(await redisGet(key));
    if (cached?.status === "completed") {
      const job: InternalJob = { ...cached, cacheHit: true };
      jobs.set(job.jobId, job);
      await persistJob(job);
      return { job, execute: null };
    }
    if (cached) await redisDelete(key);
  }
  const now = Date.now();
  const job: InternalJob = {
    jobId: randomUUID(), status: "running", stage: "加载策略", strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion, parameterVersion: strategy.parameterVersion, requestedDate,
    dataDate: null, createdAt: new Date(now).toISOString(), generatedAt: null,
    expiresAt: new Date(now + JOB_TTL_MS).toISOString(), processed: 0, universeTotal: 0,
    afterBasicFilter: 0, scored: 0, failedCount: 0, elapsedMs: 0, provider: "新浪财经/东方财富证券池 + 腾讯证券/东方财富日线",
    adjustment: "前复权", incomplete: false, error: null, candidates: [], watch: [], exclusions: [], cacheHit: false,
  };
  jobs.set(job.jobId, job);
  await persistJob(job);
  return { job, execute: () => runJob(job, strategy) };
}

export async function getScreeningJob(jobId: string) {
  cleanupJobs();
  const local = jobs.get(jobId);
  if (local) return local;
  if (!isRedisConfigured()) return undefined;
  const stored = parseJob(await redisGet(jobKey(jobId)));
  if (!stored) return undefined;
  const job: InternalJob = { ...stored };
  jobs.set(jobId, job);
  return job;
}

export async function cancelScreeningJob(jobId: string) {
  const job = await getScreeningJob(jobId);
  if (job?.status === "running") {
    job.cancelled = true;
    job.status = "cancelled";
    job.stage = "已取消";
    await persistJob(job);
  }
  return job;
}
