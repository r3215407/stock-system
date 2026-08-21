import Link from "next/link";

import EvaluationSearch from "@/components/EvaluationSearch";
import EvaluationWorkspace from "@/components/EvaluationWorkspace";
import BrandLogo from "@/components/BrandLogo";
import { modelVersion, normalizeSymbol, type MarketDataSnapshot } from "@/lib/evaluation";
import { getMarketDataSnapshot, MarketDataError } from "@/lib/market-data";

type EvaluatePageProps = {
  searchParams: Promise<{ symbol?: string | string[]; signalDate?: string | string[] }>;
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "趋势回调转强评分 · Glacier Signal",
  description: "执行趋势、回调、转强、硬性过滤与评分仓位评估。",
};

export default async function EvaluatePage({ searchParams }: EvaluatePageProps) {
  const query = await searchParams;
  const symbol = normalizeSymbol(query.symbol);
  const rawSignalDate = Array.isArray(query.signalDate) ? query.signalDate[0] : query.signalDate;
  const signalDate = rawSignalDate?.trim() || undefined;
  const signalDateValid = !signalDate || /^\d{4}-\d{2}-\d{2}$/.test(signalDate);
  const hasQuery = Boolean(symbol.raw);
  const error = hasQuery && !symbol.valid ? "请输入六位A股或场内基金代码，例如 600519、159915。" : undefined;
  let snapshot: MarketDataSnapshot | null = null;
  let dataError: string | null = null;

  if (symbol.valid && signalDateValid) {
    try {
      snapshot = await getMarketDataSnapshot(symbol.normalized, signalDate);
    } catch (caught) {
      dataError = caught instanceof MarketDataError ? caught.message : "行情数据读取失败，请稍后重试。";
    }
  } else if (symbol.valid && !signalDateValid) {
    dataError = "信号日期格式应为 YYYY-MM-DD。";
  }

  return (
    <main className="min-h-screen text-[#102C3A]">
      <header className="fixed inset-x-4 top-4 z-50 mx-auto h-14 max-w-[720px] rounded-full border border-[#102C3A]/15 bg-[#F7F8F6]/80 shadow-[0_8px_30px_-12px_rgba(20,30,80,0.18)] backdrop-blur-xl">
        <div className="mx-auto flex h-full w-full items-center justify-between px-4 sm:px-5">
          <BrandLogo />
          <nav aria-label="评分页导航" className="flex items-center gap-2 text-[13px] font-medium text-[#476775]">
            <span className="hidden px-3 sm:inline">模型 {modelVersion}</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-36 sm:px-5 lg:px-8 lg:pt-40">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-[720px]">
            <p className="inline-flex rounded-full border border-[#102C3A]/15 bg-white/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#718C98]">Evaluation workspace</p>
            <h1 className="mt-6 text-[38px] font-[600] leading-[1.02] tracking-[-0.045em] min-[360px]:text-[40px] sm:text-[54px] lg:text-[60px]">
              趋势回调<em className="block text-[#5661D9] sm:inline">转强评分</em>
            </h1>
            <p className="mt-4 max-w-[520px] text-sm leading-6 text-[#476775]">
              技术指标占90分，市场环境自动计算10分；风险与执行作为硬性过滤，不能被高分覆盖。
            </p>
          </div>
          <p className="max-w-[280px] text-[12px] leading-[18px] text-[#718C98] lg:text-right">
            数据默认使用最新完整交易日。盘中不会把未完成日线计入候选评估。
          </p>
        </div>

        <div className="mt-12 rounded-[20px] border border-[#102C3A]/15 bg-white/70 p-4 sm:p-6">
          <EvaluationSearch defaultValue={symbol.raw} error={error} compact />
        </div>

        {!hasQuery ? (
          <section className="py-24" aria-labelledby="empty-title">
            <p className="font-mono text-[11px] text-[#718C98]">01 / START</p>
            <h2 className="mt-4 max-w-[560px] text-[24px] font-semibold leading-8 tracking-[-0.015em]" id="empty-title">
              输入一只A股或场内基金，开始固定顺序的入场检查。
            </h2>
            <p className="mt-4 max-w-[520px] text-sm leading-6 text-[#476775]">
              页面将依次展开股票摘要、硬性过滤、用户确认、评分明细和账户净值输入。
            </p>
          </section>
        ) : null}

        {symbol.valid && dataError ? (
          <section className="py-20" aria-labelledby="data-unavailable-title">
            <div className="max-w-[720px] border-l-2 border-[#B44D5C] pl-5">
              <p className="text-[12px] font-medium text-[#B44D5C]">行情读取未完成</p>
              <h2 className="mt-2 text-[24px] font-semibold leading-8" id="data-unavailable-title">
                无法完成 {symbol.normalized} 的真实行情评估。
              </h2>
              <p className="mt-4 text-sm leading-6 text-[#476775]">
                {dataError} 页面没有使用演示数据或缓存结果替代本次请求。
              </p>
              <Link className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#1E5A70] underline decoration-[#A7C8D7] underline-offset-4" href={`/evaluate?symbol=${encodeURIComponent(symbol.normalized)}${signalDate ? `&signalDate=${encodeURIComponent(signalDate)}` : ""}`}>
                重新读取行情
              </Link>
            </div>
          </section>
        ) : null}

        {snapshot ? <EvaluationWorkspace snapshot={snapshot} /> : null}

      </div>
    </main>
  );
}
