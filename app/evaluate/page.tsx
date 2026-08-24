import Link from "next/link";

import EvaluationSearch from "@/components/EvaluationSearch";
import EvaluationWorkspace from "@/components/EvaluationWorkspace";
import { modelVersion, normalizeSymbol, type MarketDataSnapshot } from "@/lib/evaluation";
import { getMarketDataSnapshot, MarketDataError } from "@/lib/market-data";
import styles from "./evaluate.module.css";

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
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.utilityBar}>
          <div className={styles.utilityMain}>
            <Link className={styles.backLink} href="/">← 返回今日选股</Link>
            <h1 className={styles.title}>
              趋势回调<span className={styles.titleAccent}>转强评估票</span>
            </h1>
            <p className={styles.description}>
              股票 {modelVersion}（当前）依次核验硬性过滤、技术评分与账户风险；任何阻断条件都会保留在票面，不被总分覆盖。
            </p>
          </div>
          <p className={styles.utilityMeta}>
            <strong>完整日线签发</strong>
            默认使用最新完整交易日。盘中未完成日线不会计入本次候选评估。
          </p>
        </header>

        <EvaluationSearch defaultValue={symbol.raw} error={error} compact variant="ticket" />

        {!hasQuery ? (
          <section className={styles.emptyTicket} aria-labelledby="empty-title">
            <h2 id="empty-title">
              输入一只A股或场内基金，开始固定顺序的入场检查。
            </h2>
            <p>
              票面将依次签发标的摘要、硬性过滤、用户确认、评分明细与账户风险回执。
            </p>
          </section>
        ) : null}

        {symbol.valid && dataError ? (
          <section className={styles.errorTicket} aria-labelledby="data-unavailable-title">
              <h2 id="data-unavailable-title">
                无法完成 {symbol.normalized} 的真实行情评估。
              </h2>
              <p>
                {dataError} 本次票据没有使用演示数据或缓存结果替代真实请求。
              </p>
              <Link className={styles.actionLink} href={`/evaluate?symbol=${encodeURIComponent(symbol.normalized)}${signalDate ? `&signalDate=${encodeURIComponent(signalDate)}` : ""}`}>
                重新读取行情
              </Link>
          </section>
        ) : null}

        {snapshot ? <EvaluationWorkspace snapshot={snapshot} /> : null}
      </div>
    </main>
  );
}
