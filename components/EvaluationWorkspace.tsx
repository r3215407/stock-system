"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import styles from "@/app/evaluate/evaluate.module.css";
import {
  formatMoney,
  getScorePositionRule,
  getStopDistanceRiskAdjustment,
  minimumStrengthScore,
  minimumTechnicalScore,
  modelVersion,
  type EvaluationStatus,
  type MarketDataSnapshot,
  type ScoreModule,
} from "@/lib/evaluation";
import { calculatePositionPlan } from "@/lib/positions";

type Answers = {
  event: "none" | "exists" | "uncertain" | "";
  emotion: "calm" | "chasing" | "uncertain" | "";
};

const initialAnswers: Answers = { event: "", emotion: "" };
const initialAccountEquity = 100000;

const cancellationConditions = [
  "高开超过2%",
  "实际入场后止损距离超过12%",
  "止损距离为10%至12%但总分不足80分",
  "出现新的事件风险",
  "组合风险额度不足",
  "无法正常成交",
];

const modelNotes = [
  "总分≥70，技术分≥65/90，重新转强≥21/35",
  "回调幅度按3%–6%、2%–3% / 6%–8%、8%–10%分档",
  "MA20距离3%以内满分，3%–5%部分得分",
  "回调收盘低于MA60不超过2%仍可部分得分，不重复硬否决",
  "止损距离超过12%不执行；10%–12%要求总分≥80",
  "尚未突破60日高点时要求至少2R空间",
];

function Mark({ status }: { status: EvaluationStatus }) {
  const className = status === "pass"
    ? `${styles.statusMark} ${styles.statusPass}`
    : status === "fail"
      ? `${styles.statusMark} ${styles.statusFail}`
      : `${styles.statusMark} ${styles.statusPending}`;

  return (
    <span aria-hidden="true" className={className}>
      <svg fill="none" viewBox="0 0 12 12">
        {status === "pass" ? <path d="m2 6 2.3 2.3L10 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /> : null}
        {status === "fail" ? <path d="m3 3 6 6m0-6L3 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /> : null}
        {status === "pending" ? <path d="M6 3.1v3.2m0 2.1v.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /> : null}
      </svg>
    </span>
  );
}

function Question({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string; consequence: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className={styles.question}>
      <legend>{legend}</legend>
      <div className={styles.optionList}>
        {options.map((option) => (
          <label className={styles.optionLabel} key={option.value}>
            <input checked={value === option.value} name={name} onChange={() => onChange(option.value)} type="radio" value={option.value} />
            <span>
              <span className={styles.optionName}>{option.label}</span>
              <span className={styles.optionConsequence}>{option.consequence}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({ label, value, unit, disabled, onChange }: {
  label: string;
  value: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.numberField}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.numberControl}>
        <input className={styles.textInput} disabled={disabled} min="0" onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="number" value={value} />
        <span className={styles.unit}>{unit}</span>
      </span>
    </label>
  );
}

export default function EvaluationWorkspace({ snapshot }: { snapshot: MarketDataSnapshot }) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [accountEquity, setAccountEquity] = useState(initialAccountEquity);
  const [currentOpenRisk, setCurrentOpenRisk] = useState(0);
  const [currentStockValue, setCurrentStockValue] = useState(0);
  const [currentIndustryValue, setCurrentIndustryValue] = useState(0);
  const [threeConsecutiveStops, setThreeConsecutiveStops] = useState(false);

  const result = useMemo(() => {
    const modules: ScoreModule[] = snapshot.automaticModules;
    const earned = modules.reduce((sum, module) => sum + module.earned, 0);
    const determined = modules.reduce((sum, module) => sum + module.determined, 0);
    const pending = 100 - determined;
    const technicalScore = modules.filter((module) => ["trend", "pullback", "strength"].includes(module.id)).reduce((sum, module) => sum + module.earned, 0);
    const strengthScore = modules.find((module) => module.id === "strength")?.earned ?? 0;
    const technicalGatePassed = technicalScore >= minimumTechnicalScore;
    const strengthGatePassed = strengthScore >= minimumStrengthScore;
    const triggerGatePassed = snapshot.entryTriggerPassed;
    const eventFail = answers.event === "exists";
    const emotionFail = answers.emotion === "chasing";
    const triggerFilterFailed = snapshot.automaticFilters.some((filter) => filter.id === "HF-05" && filter.status === "fail");
    const automaticFail = snapshot.automaticFilters.some((filter) => filter.status === "fail" && filter.id !== "HF-05");
    const automaticPending = snapshot.automaticFilters.some((filter) => filter.status === "pending");
    const userPending = !answers.event || answers.event === "uncertain" || !answers.emotion || answers.emotion === "uncertain";
    const hardStatus: EvaluationStatus = eventFail || emotionFail || automaticFail ? "fail" : userPending || automaticPending || triggerFilterFailed ? "pending" : "pass";
    const positionRule = getScorePositionRule(earned);
    const stopRiskAdjustment = getStopDistanceRiskAdjustment(snapshot.stopDistanceRate, earned);
    const signalGatePassed = technicalGatePassed && strengthGatePassed && triggerGatePassed;
    const criticalBreakout = snapshot.pressureStatus === "critical" && earned >= 70 && technicalGatePassed && strengthScore >= 27;
    const candidateAvailable = !eventFail && !emotionFail && !automaticFail && !userPending && Boolean(positionRule) && signalGatePassed && stopRiskAdjustment.executable && !criticalBreakout;
    const perShareRisk = snapshot.plannedEntryPrice - snapshot.initialStopPrice;
    const finalRiskRate = positionRule ? positionRule.riskBudgetRate * stopRiskAdjustment.factor * (threeConsecutiveStops ? 0.5 : 1) : 0;
    const availablePortfolioRisk = Math.max(0, accountEquity * 0.02 - currentOpenRisk);
    const sharedPlan = calculatePositionPlan({
      accountEquity,
      currentOpenRisk,
      threeConsecutiveStops,
      candidates: [{
        symbol: snapshot.symbol,
        name: snapshot.name,
        industry: "未分类",
        rank: 1,
        score: candidateAvailable ? earned : 0,
        entryPrice: snapshot.plannedEntryPrice,
        initialStopPrice: snapshot.initialStopPrice,
        existingStockValue: currentStockValue,
        existingIndustryValue: currentIndustryValue,
      }],
    });
    const plannedItem = sharedPlan.items[0];
    const shares = plannedItem.shares;
    const allocationRate = plannedItem.allocationRate;
    const plannedLoss = plannedItem.plannedLoss;
    const allowedRisk = plannedLoss;
    const capacityPassed = shares >= 100;
    const outputsAvailable = candidateAvailable && capacityPassed;
    const conclusion = eventFail || emotionFail
      ? "硬性失败"
      : automaticFail
        ? snapshot.pressureStatus === "insufficient" ? "压力空间不足" : "硬性失败"
        : userPending
          ? "待补充"
          : earned < 70
            ? "不交易"
            : !technicalGatePassed
              ? "候选观察"
              : criticalBreakout
                ? "临界突破观察"
                : !strengthGatePassed || !triggerGatePassed || triggerFilterFailed
                  ? "等待转强"
                  : !stopRiskAdjustment.executable
                    ? "止损档位不执行"
                    : !capacityPassed
                      ? "风险额度不足"
                      : automaticPending
                        ? "候选"
                        : earned < 80 ? "允许试仓" : earned < 90 ? "标准交易" : "高匹配";

    return { modules, earned, determined, pending, hardStatus, conclusion, stopRiskAdjustment, finalRiskRate, allocationRate, stopPrice: snapshot.initialStopPrice, outputsAvailable, technicalScore, strengthScore, technicalGatePassed, strengthGatePassed, triggerGatePassed, allowedRisk, availablePortfolioRisk, shares, plannedLoss, perShareRisk, criticalBreakout };
  }, [answers, accountEquity, currentIndustryValue, currentOpenRisk, currentStockValue, snapshot, threeConsecutiveStops]);

  function updateAnswer<Key extends keyof Answers>(key: Key, value: Answers[Key]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  const stampLabel = result.hardStatus === "pass" ? "允许签发 / VALID" : result.hardStatus === "fail" ? "已作废 / VOID" : "待确认 / PENDING";
  const stampClass = result.hardStatus === "pass" ? `${styles.stamp} ${styles.stampPass}` : styles.stamp;

  return (
    <div className={styles.workspace}>
      <div className={styles.ticketDesk}>
        <section className={`${styles.coupon} ${styles.checksCoupon}`} aria-labelledby="hard-filters-title">
          <h2 className={styles.couponHeading} id="hard-filters-title">自动检查与确认</h2>
          <div className={styles.filterList}>
            {snapshot.automaticFilters.map((filter) => (
              <div className={styles.filterRow} key={filter.id}>
                <Mark status={filter.status} />
                <div className={styles.filterCopy}>
                  <p className={styles.filterLabel}>{filter.label} · {filter.status === "pass" ? "通过" : filter.status === "fail" ? "失败" : "待数据"}</p>
                  <p className={styles.filterDetail}>{filter.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.questions}>
            <Question legend="未来5个交易日是否有财报、解禁或重大事件？" name="event" onChange={(value) => updateAnswer("event", value as Answers["event"])} options={[
              { value: "none", label: "没有", consequence: "继续候选评估" },
              { value: "exists", label: "存在风险事件", consequence: "本次票据作废" },
              { value: "uncertain", label: "不确定", consequence: "保留待确认状态" },
            ]} value={answers.event} />
            <Question legend="当前交易动机最接近哪一种？" name="emotion" onChange={(value) => updateAnswer("emotion", value as Answers["emotion"])} options={[
              { value: "calm", label: "按计划执行", consequence: "继续候选评估" },
              { value: "chasing", label: "担心错过或急于回本", consequence: "本次票据作废" },
              { value: "uncertain", label: "不确定", consequence: "保留待确认状态" },
            ]} value={answers.emotion} />
          </div>
        </section>

        <section className={`${styles.coupon} ${styles.verdictCoupon} ${styles.perforatedLeft}`} aria-labelledby="stock-summary-title">
          <div className={styles.stockHeader}>
            <span className={styles.brandWord}>Glacier Signal</span>
            <p className={styles.dataDate}>数据日 {snapshot.dataDate}<br />{snapshot.adjustment} · {snapshot.records}日</p>
          </div>
          <h2 className={styles.stockName} id="stock-summary-title">{snapshot.name}<span className={styles.stockCode}>{snapshot.symbol}</span></h2>
          <div className={styles.verdictBand} aria-live="polite">
            <div><span className={styles.verdictLabel}>当前签发结论</span><strong className={styles.verdictText}>{result.conclusion}</strong></div>
            <span className={stampClass}>{stampLabel}</span>
          </div>
          <div className={styles.scoreRow}>
            <div><span className={styles.scoreLabel}>候选评分</span><div className={styles.scoreValue}>{result.earned}<small>/ {result.determined}</small></div></div>
            <p className={styles.dataDate}>待判定 {result.pending} 分<br />评分不是上涨概率</p>
          </div>
          <dl className={styles.priceGrid}>
            <div><dt>开盘</dt><dd>¥{formatMoney(snapshot.open)}</dd></div>
            <div><dt>收盘</dt><dd>¥{formatMoney(snapshot.close)}</dd></div>
            <div><dt>完整度</dt><dd>{snapshot.completeness}%</dd></div>
          </dl>
        </section>

        <aside className={`${styles.coupon} ${styles.receiptCoupon} ${styles.perforatedLeft}`} aria-label="风险与仓位回执">
          <div className={styles.receiptHeader}>
            <h2 className={styles.receiptHeading}>风险回执</h2>
            <p className={styles.receiptStatus}>{result.hardStatus === "pass" ? "硬性条件已确认" : result.hardStatus === "fail" ? "票据已作废，不生成执行仓位" : "完成左侧确认后生成执行仓位"}</p>
          </div>
          <div className={styles.stopBlock}><span className={styles.stopLabel}>结构止损</span><p className={styles.stopValue}>{result.stopPrice === null ? "—" : `¥${formatMoney(result.stopPrice)}`}</p></div>
          <div className={styles.inputs}>
            <NumberField label="账户净值" onChange={setAccountEquity} unit="元" value={accountEquity} />
            <NumberField label="当前未平仓初始风险" onChange={setCurrentOpenRisk} unit="元" value={currentOpenRisk} />
            <NumberField label="当前该股持仓市值" onChange={setCurrentStockValue} unit="元" value={currentStockValue} />
            <NumberField label="当前该行业持仓市值" onChange={setCurrentIndustryValue} unit="元" value={currentIndustryValue} />
            <label className={styles.checkboxLabel}><input checked={threeConsecutiveStops} onChange={(event) => setThreeConsecutiveStops(event.target.checked)} type="checkbox" />最近连续3笔完整止损（单笔风险减半）</label>
            <p className={styles.privacyNote}>账户数据仅参与当前浏览器内即时计算，不上传或保存。</p>
          </div>
          <dl className={styles.receiptMetrics}>
            <div><dt>计划买入股数</dt><dd>{result.outputsAvailable ? `${result.shares}股` : "—"}</dd></div>
            <div><dt>计划最大亏损</dt><dd>{result.outputsAvailable ? `¥${formatMoney(result.plannedLoss)}` : "—"}</dd></div>
            <div><dt>仓位占账户</dt><dd>{result.outputsAvailable ? `${(result.allocationRate * 100).toFixed(2)}%` : "—"}</dd></div>
            <div><dt>最终风险比例</dt><dd>{(result.finalRiskRate * 100).toFixed(3)}%</dd></div>
          </dl>
          <Link className={styles.actionLink} href={`/evaluate/backtest?symbol=${encodeURIComponent(snapshot.symbol.split(".")[0])}&endDate=${encodeURIComponent(snapshot.dataDate)}`}>查看近两年回测</Link>
          <p className={styles.receiptNote}>模型 {modelVersion} · 止损距离 {(snapshot.stopDistanceRate * 100).toFixed(2)}% · {result.stopRiskAdjustment.label}</p>
        </aside>
      </div>

      <section className={styles.scoreSection} id="score-details" aria-labelledby="score-details-title">
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="score-details-title">评分明细联票</h2>
          <p>技术指标占90分，市场环境由中证全指自动计算10分；展开每联查看数据与判定来源。</p>
        </header>
        <div className={styles.gateGrid}>
          <div className={styles.gateCell}><span>技术面门槛</span><strong>{result.technicalScore} / 90 · 至少 {minimumTechnicalScore} · {result.technicalGatePassed ? "通过" : "未通过"}</strong></div>
          <div className={styles.gateCell}><span>重新转强门槛</span><strong>{result.strengthScore} / 35 · 至少 {minimumStrengthScore} · {result.strengthGatePassed ? "通过" : "未通过"}</strong></div>
          <div className={styles.gateCell}><span>关键触发器</span><strong>{result.triggerGatePassed ? "已触发" : "尚未触发"}</strong></div>
        </div>
        <div className={styles.moduleList}>
          {result.modules.map((module) => (
            <details className={styles.moduleCoupon} key={module.id}>
              <summary className={styles.detailsSummary}>
                <div><h3 className={styles.moduleName}>{module.label}</h3><p className={styles.moduleCounts}>通过 {module.passed} · 部分 {module.partial} · 不通过 {module.failed} · 未知 {module.pending} · {module.source}</p></div>
                <p className={styles.moduleReason}>{module.reason}</p>
                <span className={styles.moduleScore}>{module.earned} / {module.total}</span>
                <span aria-hidden="true" className={styles.expandMark} />
              </summary>
              <div className={styles.moduleDetails}>
                {module.details?.length ? <div className={styles.detailTags}>{module.details.map((detail) => (
                  <span className={`${styles.detailTag} ${detail.status === "pass" ? styles.detailPass : detail.status === "fail" ? styles.detailFail : detail.status === "partial" ? styles.detailPartial : ""}`} key={detail.label}>
                    {detail.label} <strong>{detail.value}</strong>{detail.points !== undefined && detail.maximumPoints !== undefined ? ` ${detail.points}/${detail.maximumPoints}分` : null}
                  </span>
                ))}</div> : <p>{module.reason}</p>}
                <p>数据日期：{snapshot.dataDate}<br />已判定 {module.determined} / {module.total} 分</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className={styles.footTickets}>
        <details className={styles.footTicket}><summary className={styles.detailsSummary}><span className={styles.moduleName}>次日取消条件</span><span aria-hidden="true" className={styles.expandMark} /></summary><ul className={styles.footList}>{cancellationConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></details>
        <details className={styles.footTicket}><summary className={styles.detailsSummary}><span className={styles.moduleName}>模型0.4参数依据</span><span aria-hidden="true" className={styles.expandMark} /></summary><ul className={styles.footList}>{modelNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>
      </div>

      <p className={styles.disclaimer}>
        计划入场 ¥{formatMoney(snapshot.plannedEntryPrice)} · 每股风险 ¥{formatMoney(result.perShareRisk)} · 风险预算 ¥{formatMoney(result.allowedRisk)} · 可用组合风险 ¥{formatMoney(result.availablePortfolioRisk)} · 基准 {snapshot.benchmark}<br />
        评分表示与模型的匹配程度，不代表上涨概率或投资建议。
      </p>
    </div>
  );
}
