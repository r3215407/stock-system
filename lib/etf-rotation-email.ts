import "server-only";

import nodemailer from "nodemailer";

import type { LedgerExecution } from "@/lib/etf-rotation-db";
import type { MomentumRanking } from "@/lib/etf-rotation";

type Notification =
  | { kind: "success"; businessDate: string; runId: string; ledger: LedgerExecution; rankings: readonly MomentumRanking[]; marketDataAt: string }
  | { kind: "failed"; businessDate: string; runId: string; errorCode: string; errorMessage: string }
  | { kind: "skipped"; businessDate: string; runId: string; latestSuccessAt?: string | null };

function configured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD &&
    process.env.EMAIL_FROM && process.env.EMAIL_TO,
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function successMail(notification: Extract<Notification, { kind: "success" }>) {
  const { ledger, rankings, businessDate, marketDataAt } = notification;
  const action = ledger.action === "SELL_BUY" ? "SELL→BUY" : ledger.action;
  const subject = ledger.action === "SELL_BUY"
    ? `[ETF 动量轮动][SELL→BUY] ${businessDate} ${ledger.previousSymbol} → ${ledger.targetSymbol}`
    : `[ETF 动量轮动][${action}] ${businessDate} 目标 ${ledger.targetSymbol}`;
  const rankingRows = rankings.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.name ?? item.symbol)} ${item.symbol}</td><td>${item.currentPrice.toFixed(4)}</td><td>${item.score.toFixed(6)}</td></tr>`).join("");
  return {
    subject,
    text: [
      `运行日期：${businessDate}（北京时间）`, `行情时间：${marketDataAt}`, `策略版本：ETF 动量 1.0`,
      `本次动作：${action}`, `目标 ETF：${ledger.targetSymbol}`, `模拟成交价：¥${ledger.price}`,
      `等效份额：${ledger.quantity}`, `总资产：¥${ledger.totalValue}`, `可用资金：¥${ledger.cash}`,
      `累计收益：${percent(ledger.cumulativeReturn)}`, `年化收益：${percent(ledger.annualizedReturn)}`,
      "", "本次排名：", ...rankings.map((item) => `${item.rank}. ${item.name ?? item.symbol} ${item.symbol} / ${item.score.toFixed(6)}`),
      "", "模拟组合，不构成投资建议。",
    ].join("\n"),
    html: `<h2>ETF 动量轮动 · ${action}</h2><p>运行日期：${businessDate}（北京时间）<br>行情时间：${marketDataAt}<br>策略版本：ETF 动量 1.0</p><p><strong>目标 ETF：${ledger.targetSymbol}</strong><br>模拟成交价：¥${ledger.price}<br>等效份额：${ledger.quantity}</p><p>总资产：¥${ledger.totalValue}<br>可用资金：¥${ledger.cash}<br>累计收益：${percent(ledger.cumulativeReturn)}<br>年化收益：${percent(ledger.annualizedReturn)}</p><table cellpadding="7" cellspacing="0" border="1"><thead><tr><th>排名</th><th>ETF</th><th>价格</th><th>得分</th></tr></thead><tbody>${rankingRows}</tbody></table><p><small>模拟组合，不构成投资建议。</small></p>`,
  };
}

function mailContent(notification: Notification) {
  if (notification.kind === "success") return successMail(notification);
  if (notification.kind === "skipped") {
    const subject = `[ETF 动量轮动][休市跳过] ${notification.businessDate}`;
    const text = `今天不是中国内地证券市场交易日，组合未发生变化。\n最近成功运行：${notification.latestSuccessAt ?? "暂无"}\n任务 ID：${notification.runId}\n\n模拟组合，不构成投资建议。`;
    return { subject, text, html: `<h2>ETF 动量轮动 · 休市跳过</h2><p>今天不是中国内地证券市场交易日，组合未发生变化。</p><p>最近成功运行：${escapeHtml(notification.latestSuccessAt ?? "暂无")}<br>任务 ID：${notification.runId}</p><p><small>模拟组合，不构成投资建议。</small></p>` };
  }
  const subject = `[ETF 动量轮动][运行失败] ${notification.businessDate}`;
  const text = `运行阶段：策略执行\n错误代码：${notification.errorCode}\n错误摘要：${notification.errorMessage}\n持仓未改变。\n任务 ID：${notification.runId}\n\n模拟组合，不构成投资建议。`;
  return { subject, text, html: `<h2>ETF 动量轮动 · 运行失败</h2><p>错误代码：${escapeHtml(notification.errorCode)}<br>错误摘要：${escapeHtml(notification.errorMessage)}</p><p><strong>持仓未改变。</strong><br>任务 ID：${notification.runId}</p><p><small>模拟组合，不构成投资建议。</small></p>` };
}

export async function sendRotationNotification(notification: Notification) {
  if (!configured()) return { status: "NOT_REQUIRED" as const, reason: "邮件环境变量未配置完整。" };
  const port = Number(process.env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const content = mailContent(notification);
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    ...content,
  });
  return { status: "SENT" as const };
}
