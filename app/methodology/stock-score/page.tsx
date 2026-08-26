import Link from "next/link";

import { stockStrategyV04 as rule } from "@/lib/stock-strategy-v04";
import styles from "./stock-score.module.css";

export const metadata = { title: "评分规则 · Glacier Signal", description: "趋势回调转强股票 0.4 的评分、准入与仓位规则。" };

const trendRows = [
  ["收盘价高于 MA20", rule.scores.trend.itemPoints, "收盘 > MA20"],
  ["MA5 高于 MA10", rule.scores.trend.itemPoints, "MA5 > MA10"],
  ["MA10 高于 MA20", rule.scores.trend.itemPoints, "MA10 > MA20"],
  ["MA20 五日斜率", rule.scores.trend.itemPoints, `当日 MA20 / 5 日前 MA20 - 1 >= ${rule.scores.trend.ma20SlopeMinimum * 100}%`],
  ["20 日收益", rule.scores.trend.itemPoints, `大于 0 且不超过 ${rule.scores.trend.return20Maximum * 100}%`],
] as const;

const strengthRows = [
  ["阳线", rule.scores.strength.positiveCandle, "收盘 > 开盘"],
  ["高于前收盘", rule.scores.strength.abovePreviousClose, "当日收盘 > 前一日收盘"],
  ["重新站上 MA5", rule.scores.strength.regainMa5, "收盘高于 MA5，且此前 3 日至少 1 日不高于 MA5"],
  ["突破前三日最高收盘", rule.scores.strength.breakThreeDayHigh, "当日收盘高于此前 3 日最高收盘"],
  ["MACD 柱改善", rule.scores.strength.macdImproves, "柱连续两次上升，或前一日为负且当日转正"],
] as const;

const hardFilters = [
  ["HF-02", "收盘价高于 MA60", "必须严格高于"],
  ["HF-03", "MA20 高于 MA60", "必须严格高于"],
  ["HF-04", "MA20 最近 5 日向上", "当日 MA20 必须高于 5 日前"],
  ["HF-05", "重新转强触发", "重新站上 MA5 或突破前三日最高收盘"],
  ["HF-06", "结构止损距离有效", `每股风险大于 0，距离不超过 ${rule.gates.maximumStopDistance * 100}%`],
  ["HF-07", "压力空间有效", `已突破 60 日最高收盘，或压力空间至少 ${rule.gates.minimumRewardRisk}R`],
  ["HF-08", "T+1 高开", `不超过 ${rule.gates.maximumT1Gap * 100}%；无次日数据时待确认`],
] as const;

function RuleRows({ rows }: { rows: readonly (readonly [string, number | string, string])[] }) {
  return <div className={styles.ruleList}>{rows.map(([label, points, detail]) => <div className={styles.ruleRow} key={label}><strong>{label}</strong><b>{points}{typeof points === "number" ? " 分" : ""}</b><span>{detail}</span></div>)}</div>;
}

export default function StockScoreMethodologyPage() {
  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.masthead}>
        <div className={styles.heroMain}><Link className={styles.backLink} href="/">← 返回今日选股</Link><p className={styles.eyebrow}>方法与签发依据 / METHODOLOGY</p><h1>评分如何签发，<br /><em>交易如何准入</em></h1><p>{rule.identity.displayName} 的完整规则档案。评分衡量标的与模型的匹配程度，不是上涨概率；高分不能越过硬性条件。</p></div>
        <aside className={styles.identityStub}><div className={styles.strategyIdentity}><div><span>当前生效策略</span><strong>{rule.identity.displayName}</strong></div><b>V{rule.identity.strategyVersion}</b></div><dl><div><dt>参数版本</dt><dd>{rule.identity.parameterVersion}</dd></div><div><dt>适用范围</dt><dd>沪深普通股票</dd></div><div><dt>数据基准</dt><dd>{rule.data.benchmark}</dd></div><div><dt>最后核对</dt><dd>{rule.identity.reviewedAt}</dd></div></dl><span className={styles.stamp}>规则已核对 / VALID</span></aside>
      </header>

      <section className={styles.flow} aria-label="评分到仓位流程"><div><span>01</span><strong>总分</strong><p>技术 90 分 + 市场 10 分</p></div><div><span>02</span><strong>准入门槛</strong><p>分数、触发器、硬性过滤、人工确认</p></div><div><span>03</span><strong>仓位预算</strong><p>按风险档位和组合上限向下取整</p></div></section>

      <section className={styles.section}><header><p>01 / SCORE</p><h2>总分结构</h2></header><div className={styles.scoreFormula}><strong>个股趋势 {rule.scores.trend.total}</strong><span>+</span><strong>回调质量 {rule.scores.pullback.total}</strong><span>+</span><strong>重新转强 {rule.scores.strength.total}</strong><span>+</span><strong>市场环境 {rule.scores.market.total}</strong><span>= 100</span></div><p className={styles.note}>市场环境数据不可用时，只判定技术面的 90 分，另有 10 分显示“待判定”，不会按 0 分伪装成完整结果。</p></section>

      <div className={styles.twoColumn}>
        <section className={styles.section}><header><p>趋势质量</p><h2>{rule.scores.trend.total} 分</h2></header><RuleRows rows={trendRows} /></section>
        <section className={styles.section}><header><p>重新转强</p><h2>{rule.scores.strength.total} 分</h2></header><RuleRows rows={strengthRows} /><p className={styles.note}>触发器并非任意一项：必须“重新站上 MA5”或“突破前三日最高收盘”至少一项成立。</p></section>
      </div>

      <section className={styles.section}><header><p>回调质量 · 最近 {rule.scores.pullback.window} 个交易日</p><h2>{rule.scores.pullback.total} 分</h2></header><RuleRows rows={[
        ["最长回落或横盘", 6, "连续至少 2 日：收益不大于 0，或绝对涨跌不超过 0.5%"],
        ["回调幅度", "7 / 5 / 3 / 0", "[3%, 6%) 得 7；[2%, 3%) 或 [6%, 8%) 得 5；[8%, 10%) 得 3；其余 0"],
        ["低点距 MA20", "6 / 3 / 0", "不超过 3% 得 6；大于 3% 且不超过 5% 得 3"],
        ["回调与 MA60", "6 / 3 / 0", "所有收盘不低于 MA60 得 6；最低比例不低于 98% 得 3"],
      ]} /><p className={styles.note}>边界按开闭区间执行：恰好 6% 得 5 分，恰好 10% 得 0 分，距 MA20 恰好 3% 得 6 分。回调低点使用最低收盘，结构止损使用最低价。</p></section>

      <section className={styles.section}><header><p>市场环境 · {rule.data.benchmark}</p><h2>{rule.scores.market.total} 分</h2></header><RuleRows rows={[["基准收盘高于 MA20", rule.scores.market.aboveMa20, "收盘 > MA20"],["基准 MA20 向上", rule.scores.market.risingMa20, "当日 MA20 > 5 日前 MA20"],["基准 5 日收益为正", rule.scores.market.positiveReturn5, "5 日收益 > 0"]]} /></section>

      <section className={`${styles.section} ${styles.darkSection}`}><header><p>02 / ADMISSION</p><h2>硬性过滤与人工确认</h2></header><RuleRows rows={hardFilters} /><div className={styles.formula}>初始止损 = 最近 10 日最低价 - 0.3 x ATR(14)<br />每股初始风险 R = 入场价 - 初始止损价<br />止损距离 = R / 入场价</div><p className={styles.note}>价格低于 10 元按 0.001 元向下取整，否则按 0.01 元向下取整。未来 5 个交易日存在事件风险，或交易动机为“担心错过或急于回本”，均作废；不确定时保持待确认。</p></section>

      <section className={`${styles.section} ${styles.riskSection}`}><header><p>03 / POSITION</p><h2>准入结论与仓位预算</h2></header><RuleRows rows={rule.position.scoreBands.map((band) => [`${band.minScore} 分起`, `${band.riskBudgetRate * 100}%`, `${band.label} · 基础单笔风险占账户净值`])} /><p className={styles.note}>总分还须至少 {rule.gates.minimumScore}，技术分至少 {rule.gates.minimumTechnicalScore}/90，转强分至少 {rule.gates.minimumStrengthScore}/35。止损距离 (0, 8%] 乘 1；(8%, 10%] 乘 0.5；(10%, 12%] 乘 0.25 且总分至少 80。连续 3 笔完整止损再乘 0.5。</p><div className={styles.limits}><span>组合风险 {rule.position.portfolioRiskCap * 100}%</span><span>单股市值 {rule.position.stockValueCap * 100}%</span><span>行业市值 {rule.position.industryValueCap * 100}%</span><span>风险缓冲 {rule.position.riskBufferRate * 100}%</span><span>{rule.position.lotSize} 股整手</span></div></section>

      <section className={styles.examples}><header><p>边界示例</p><h2>同一个分数，不代表同一种结果</h2></header><div><article><span>92 / 100</span><h3>高分但硬性失败</h3><p>MA20 不高于 MA60。总分不能抵消 HF-03，结论仍为不执行。</p></article><article><span>70 / 100</span><h3>允许试仓但 0 股</h3><p>标的资格成立，但风险预算向下取整后不足 100 股，可加入方案并由仓位页解释容量。</p></article><article><span>90 / 90</span><h3>市场数据缺失</h3><p>技术分已全部判定，市场环境 10 分待判定，不显示为 90 / 100。</p></article></div></section>

      <footer className={styles.footer}><div><strong>数据口径</strong><p>日线 · {rule.data.adjustment} · {rule.data.completeDayCutoff} 前不使用当日未完成日线 · 基准 {rule.data.benchmark} · 至少 {rule.data.minimumTradingDays} 个有效交易日</p></div><p>止盈/退出策略仅作规则提示，不自动下单。<Link href="/evaluate">返回个股评分</Link></p></footer>
    </div>
  </main>;
}
