import "server-only";

import { randomUUID } from "node:crypto";

import {
  calculateAnnualizedReturn,
  calculateSharpeRatio,
  ETF_START_DATE,
  ETF_START_VALUE,
  ETF_STRATEGY_KEY,
  shanghaiBusinessClock,
  type MomentumRanking,
  type RotationAction,
} from "@/lib/etf-rotation";
import { database } from "@/lib/postgres-db";

type DatabaseGlobal = typeof globalThis & {
  glacierRotationSchema?: Promise<void>;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export async function ensureRotationSchema() {
  if (!databaseGlobal.glacierRotationSchema) {
    databaseGlobal.glacierRotationSchema = (async () => {
      const sql = database();
      await sql`
        CREATE TABLE IF NOT EXISTS strategy_portfolios (
          id uuid PRIMARY KEY,
          strategy_key text NOT NULL UNIQUE,
          start_date date NOT NULL,
          start_value numeric(20,6) NOT NULL,
          cash numeric(20,6) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS strategy_runs (
          id uuid PRIMARY KEY,
          strategy_key text NOT NULL,
          business_date date NOT NULL,
          idempotency_key text NOT NULL UNIQUE,
          status text NOT NULL CHECK (status IN ('RUNNING','SUCCESS','FAILED','SKIPPED_NON_TRADING_DAY')),
          action text NULL CHECK (action IS NULL OR action IN ('BUY','SELL_BUY','HOLD')),
          target_symbol varchar(6) NULL,
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz NULL,
          market_data_at timestamptz NULL,
          error_code text NULL,
          error_message text NULL,
          email_status text NOT NULL DEFAULT 'PENDING' CHECK (email_status IN ('PENDING','SENT','FAILED','NOT_REQUIRED')),
          email_sent_at timestamptz NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS strategy_positions (
          id uuid PRIMARY KEY,
          portfolio_id uuid NOT NULL REFERENCES strategy_portfolios(id) ON DELETE CASCADE,
          symbol varchar(6) NOT NULL,
          quantity numeric(24,10) NOT NULL,
          entry_price numeric(20,6) NOT NULL,
          entry_amount numeric(20,6) NOT NULL,
          entry_at timestamptz NOT NULL,
          last_price numeric(20,6) NOT NULL,
          last_valued_at timestamptz NOT NULL,
          UNIQUE (portfolio_id, symbol)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS strategy_trades (
          id uuid PRIMARY KEY,
          portfolio_id uuid NOT NULL REFERENCES strategy_portfolios(id) ON DELETE CASCADE,
          run_id uuid NOT NULL REFERENCES strategy_runs(id) ON DELETE RESTRICT,
          side text NOT NULL CHECK (side IN ('BUY','SELL')),
          symbol varchar(6) NOT NULL,
          executed_at timestamptz NOT NULL,
          price numeric(20,6) NOT NULL,
          quantity numeric(24,10) NOT NULL,
          amount numeric(20,6) NOT NULL,
          realized_pnl numeric(20,6) NULL,
          cash_after numeric(20,6) NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS portfolio_daily_snapshots (
          id uuid PRIMARY KEY,
          portfolio_id uuid NOT NULL REFERENCES strategy_portfolios(id) ON DELETE CASCADE,
          snapshot_date date NOT NULL,
          total_value numeric(20,6) NOT NULL,
          cash numeric(20,6) NOT NULL,
          position_value numeric(20,6) NOT NULL,
          cumulative_return numeric(18,10) NOT NULL,
          annualized_return numeric(18,10) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (portfolio_id, snapshot_date)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS strategy_runs_lookup ON strategy_runs (strategy_key, business_date DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS strategy_trades_recent ON strategy_trades (portfolio_id, executed_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS portfolio_snapshots_ordered ON portfolio_daily_snapshots (portfolio_id, snapshot_date ASC)`;
    })().catch((error) => {
      databaseGlobal.glacierRotationSchema = undefined;
      throw error;
    });
  }
  return databaseGlobal.glacierRotationSchema;
}

export async function initializeRotationPortfolio() {
  await ensureRotationSchema();
  const sql = database();
  return sql.begin(async (tx) => {
    const portfolioId = randomUUID();
    await tx`
      INSERT INTO strategy_portfolios (id, strategy_key, start_date, start_value, cash)
      VALUES (${portfolioId}, ${ETF_STRATEGY_KEY}, ${ETF_START_DATE}::date, ${ETF_START_VALUE}::numeric, ${ETF_START_VALUE}::numeric)
      ON CONFLICT (strategy_key) DO NOTHING
    `;
    const [portfolio] = await tx<{
      id: string;
      startDate: string;
      startValue: string;
      cash: string;
    }[]>`
      SELECT id, start_date::text AS "startDate", start_value::text AS "startValue", cash::text AS cash
      FROM strategy_portfolios WHERE strategy_key = ${ETF_STRATEGY_KEY} FOR UPDATE
    `;
    await tx`
      INSERT INTO portfolio_daily_snapshots (
        id, portfolio_id, snapshot_date, total_value, cash, position_value, cumulative_return, annualized_return
      ) VALUES (
        ${randomUUID()}, ${portfolio.id}, ${ETF_START_DATE}::date, ${ETF_START_VALUE}::numeric,
        ${ETF_START_VALUE}::numeric, 0, 0, 0
      ) ON CONFLICT (portfolio_id, snapshot_date) DO NOTHING
    `;
    return portfolio;
  });
}

export async function createRotationRun(businessDate: string) {
  await ensureRotationSchema();
  const sql = database();
  const runId = randomUUID();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO strategy_runs (id, strategy_key, business_date, idempotency_key, status, email_status)
    VALUES (${runId}, ${ETF_STRATEGY_KEY}, ${businessDate}::date, ${`${ETF_STRATEGY_KEY}:${businessDate}`}, 'RUNNING', 'PENDING')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  if (rows[0]) return { created: true as const, runId: rows[0].id };
  const [existing] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM strategy_runs WHERE idempotency_key = ${`${ETF_STRATEGY_KEY}:${businessDate}`}
  `;
  return { created: false as const, runId: existing.id, status: existing.status };
}

export async function completeSkippedRun(runId: string) {
  const sql = database();
  await sql`
    UPDATE strategy_runs SET status = 'SKIPPED_NON_TRADING_DAY', finished_at = now(), email_status = 'PENDING'
    WHERE id = ${runId} AND status = 'RUNNING'
  `;
}

function publicErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[数据库连接已隐藏]").slice(0, 360);
}

export async function failRotationRun(runId: string, errorCode: string, error: unknown) {
  const sql = database();
  await sql`
    UPDATE strategy_runs
    SET status = 'FAILED', finished_at = now(), error_code = ${errorCode}, error_message = ${publicErrorMessage(error)}, email_status = 'PENDING'
    WHERE id = ${runId} AND status = 'RUNNING'
  `;
}

export async function updateRunEmailStatus(runId: string, status: "SENT" | "FAILED" | "NOT_REQUIRED") {
  const sql = database();
  await sql`
    UPDATE strategy_runs
    SET email_status = ${status}, email_sent_at = CASE WHEN ${status} = 'SENT' THEN now() ELSE email_sent_at END
    WHERE id = ${runId}
  `;
}

export type LedgerExecution = {
  action: RotationAction;
  targetSymbol: string;
  previousSymbol: string | null;
  totalValue: string;
  cash: string;
  positionValue: string;
  quantity: string;
  price: string;
  cumulativeReturn: number;
  annualizedReturn: number;
};

export async function executeRotationLedger(
  runId: string,
  businessDate: string,
  marketDataAt: string,
  rankings: readonly MomentumRanking[],
): Promise<LedgerExecution> {
  const portfolio = await initializeRotationPortfolio();
  const target = rankings[0];
  if (!target) throw new Error("动量排名为空，不能更新账本。");
  const priceBySymbol = new Map(rankings.map((item) => [item.symbol, item.currentPrice.toFixed(6)]));
  const targetPrice = target.currentPrice.toFixed(6);
  const sql = database();

  return sql.begin(async (tx) => {
    const [lockedPortfolio] = await tx<{ id: string; cash: string }[]>`
      SELECT id, cash::text AS cash FROM strategy_portfolios WHERE id = ${portfolio.id} FOR UPDATE
    `;
    const [position] = await tx<{
      id: string;
      symbol: string;
      quantity: string;
      entryPrice: string;
      entryAmount: string;
    }[]>`
      SELECT id, symbol, quantity::text AS quantity, entry_price::text AS "entryPrice", entry_amount::text AS "entryAmount"
      FROM strategy_positions WHERE portfolio_id = ${lockedPortfolio.id} FOR UPDATE
    `;

    const previousSymbol = position?.symbol ?? null;
    let action: RotationAction;
    let cash = lockedPortfolio.cash;

    if (position && position.symbol !== target.symbol) {
      const sellPrice = priceBySymbol.get(position.symbol);
      if (!sellPrice) throw new Error(`当前持仓 ${position.symbol} 不在完整行情快照中。`);
      const [sale] = await tx<{ amount: string; realizedPnl: string }[]>`
        SELECT
          (${position.quantity}::numeric * ${sellPrice}::numeric)::numeric(20,6)::text AS amount,
          ((${position.quantity}::numeric * ${sellPrice}::numeric) - ${position.entryAmount}::numeric)::numeric(20,6)::text AS "realizedPnl"
      `;
      cash = sale.amount;
      await tx`
        INSERT INTO strategy_trades (
          id, portfolio_id, run_id, side, symbol, executed_at, price, quantity, amount, realized_pnl, cash_after
        ) VALUES (
          ${randomUUID()}, ${lockedPortfolio.id}, ${runId}, 'SELL', ${position.symbol}, ${marketDataAt}::timestamptz,
          ${sellPrice}::numeric, ${position.quantity}::numeric, ${sale.amount}::numeric, ${sale.realizedPnl}::numeric, ${cash}::numeric
        )
      `;
      await tx`DELETE FROM strategy_positions WHERE id = ${position.id}`;
      action = "SELL_BUY";
    } else if (position) {
      action = "HOLD";
    } else {
      action = "BUY";
    }

    if (action === "HOLD" && position) {
      await tx`
        UPDATE strategy_positions
        SET last_price = ${targetPrice}::numeric, last_valued_at = ${marketDataAt}::timestamptz
        WHERE id = ${position.id}
      `;
    } else {
      const [purchase] = await tx<{ quantity: string }[]>`
        SELECT (${cash}::numeric / ${targetPrice}::numeric)::numeric(24,10)::text AS quantity
      `;
      await tx`
        INSERT INTO strategy_trades (
          id, portfolio_id, run_id, side, symbol, executed_at, price, quantity, amount, realized_pnl, cash_after
        ) VALUES (
          ${randomUUID()}, ${lockedPortfolio.id}, ${runId}, 'BUY', ${target.symbol}, ${marketDataAt}::timestamptz,
          ${targetPrice}::numeric, ${purchase.quantity}::numeric, ${cash}::numeric, NULL, 0
        )
      `;
      await tx`
        INSERT INTO strategy_positions (
          id, portfolio_id, symbol, quantity, entry_price, entry_amount, entry_at, last_price, last_valued_at
        ) VALUES (
          ${randomUUID()}, ${lockedPortfolio.id}, ${target.symbol}, ${purchase.quantity}::numeric,
          ${targetPrice}::numeric, ${cash}::numeric, ${marketDataAt}::timestamptz, ${targetPrice}::numeric, ${marketDataAt}::timestamptz
        )
      `;
      cash = "0";
    }

    await tx`UPDATE strategy_portfolios SET cash = ${cash}::numeric, updated_at = now() WHERE id = ${lockedPortfolio.id}`;
    const [valuation] = await tx<{ totalValue: string; cash: string; positionValue: string; quantity: string }[]>`
      SELECT
        (p.cash + COALESCE(pos.quantity * pos.last_price, 0))::numeric(20,6)::text AS "totalValue",
        p.cash::numeric(20,6)::text AS cash,
        COALESCE(pos.quantity * pos.last_price, 0)::numeric(20,6)::text AS "positionValue",
        COALESCE(pos.quantity, 0)::numeric(24,10)::text AS quantity
      FROM strategy_portfolios p
      LEFT JOIN strategy_positions pos ON pos.portfolio_id = p.id
      WHERE p.id = ${lockedPortfolio.id}
    `;
    const totalValueNumber = Number(valuation.totalValue);
    const cumulativeReturn = totalValueNumber / Number(ETF_START_VALUE) - 1;
    const annualizedReturn = calculateAnnualizedReturn(totalValueNumber, businessDate);
    await tx`
      INSERT INTO portfolio_daily_snapshots (
        id, portfolio_id, snapshot_date, total_value, cash, position_value, cumulative_return, annualized_return
      ) VALUES (
        ${randomUUID()}, ${lockedPortfolio.id}, ${businessDate}::date, ${valuation.totalValue}::numeric,
        ${valuation.cash}::numeric, ${valuation.positionValue}::numeric, ${cumulativeReturn}, ${annualizedReturn}
      )
      ON CONFLICT (portfolio_id, snapshot_date) DO NOTHING
    `;
    await tx`
      UPDATE strategy_runs
      SET status = 'SUCCESS', action = ${action}, target_symbol = ${target.symbol}, finished_at = now(),
          market_data_at = ${marketDataAt}::timestamptz, error_code = NULL, error_message = NULL
      WHERE id = ${runId} AND status = 'RUNNING'
    `;
    return {
      action,
      targetSymbol: target.symbol,
      previousSymbol,
      totalValue: valuation.totalValue,
      cash: valuation.cash,
      positionValue: valuation.positionValue,
      quantity: valuation.quantity,
      price: targetPrice,
      cumulativeReturn,
      annualizedReturn,
    };
  });
}

export type RotationOverview = Awaited<ReturnType<typeof getRotationOverview>>;

export async function getRotationOverview() {
  const portfolio = await initializeRotationPortfolio();
  const sql = database();
  const today = shanghaiBusinessClock().date;
  const [latestRun] = await sql<{
    id: string;
    businessDate: string;
    status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED_NON_TRADING_DAY";
    action: RotationAction | null;
    targetSymbol: string | null;
    startedAt: string;
    finishedAt: string | null;
    marketDataAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    emailStatus: string;
  }[]>`
    SELECT id, business_date::text AS "businessDate", status, action, target_symbol AS "targetSymbol",
      started_at::text AS "startedAt", finished_at::text AS "finishedAt", market_data_at::text AS "marketDataAt",
      error_code AS "errorCode", error_message AS "errorMessage", email_status AS "emailStatus"
    FROM strategy_runs WHERE strategy_key = ${ETF_STRATEGY_KEY}
    ORDER BY business_date DESC, started_at DESC LIMIT 1
  `;
  const [latestSuccess] = await sql<{ finishedAt: string; marketDataAt: string; targetSymbol: string }[]>`
    SELECT finished_at::text AS "finishedAt", market_data_at::text AS "marketDataAt", target_symbol AS "targetSymbol"
    FROM strategy_runs WHERE strategy_key = ${ETF_STRATEGY_KEY} AND status = 'SUCCESS'
    ORDER BY business_date DESC LIMIT 1
  `;
  const [position] = await sql<{
    symbol: string;
    quantity: string;
    entryPrice: string;
    entryAmount: string;
    entryAt: string;
    lastPrice: string;
    lastValuedAt: string;
    marketValue: string;
    unrealizedPnl: string;
  }[]>`
    SELECT symbol, quantity::text AS quantity, entry_price::text AS "entryPrice", entry_amount::text AS "entryAmount",
      entry_at::text AS "entryAt", last_price::text AS "lastPrice", last_valued_at::text AS "lastValuedAt",
      (quantity * last_price)::numeric(20,6)::text AS "marketValue",
      ((quantity * last_price) - entry_amount)::numeric(20,6)::text AS "unrealizedPnl"
    FROM strategy_positions WHERE portfolio_id = ${portfolio.id} LIMIT 1
  `;
  const snapshots = await sql<{
    snapshotDate: string;
    totalValue: string;
    cash: string;
    positionValue: string;
    cumulativeReturn: string;
    annualizedReturn: string;
  }[]>`
    SELECT snapshot_date::text AS "snapshotDate", total_value::text AS "totalValue", cash::text AS cash,
      position_value::text AS "positionValue", cumulative_return::text AS "cumulativeReturn",
      annualized_return::text AS "annualizedReturn"
    FROM portfolio_daily_snapshots WHERE portfolio_id = ${portfolio.id} ORDER BY snapshot_date ASC
  `;
  const trades = await sql<{
    id: string;
    runId: string;
    side: "BUY" | "SELL";
    symbol: string;
    executedAt: string;
    price: string;
    quantity: string;
    amount: string;
    realizedPnl: string | null;
    cashAfter: string;
  }[]>`
    SELECT id, run_id AS "runId", side, symbol, executed_at::text AS "executedAt", price::text AS price,
      quantity::text AS quantity, amount::text AS amount, realized_pnl::text AS "realizedPnl", cash_after::text AS "cashAfter"
    FROM strategy_trades WHERE portfolio_id = ${portfolio.id} ORDER BY executed_at DESC, side DESC LIMIT 10
  `;
  const latestSnapshot = snapshots.at(-1)!;
  const totalValue = Number(latestSnapshot.totalValue);
  const cash = Number(latestSnapshot.cash);
  const positionValue = Number(latestSnapshot.positionValue);
  const sharpeRatio = calculateSharpeRatio(snapshots.map((item) => ({
    snapshotDate: item.snapshotDate,
    totalValue: Number(item.totalValue),
    cumulativeReturn: Number(item.cumulativeReturn),
    annualizedReturn: Number(item.annualizedReturn),
  })));
  return {
    asOf: new Date().toISOString(),
    timezone: "Asia/Shanghai" as const,
    today,
    runState: latestRun?.businessDate === today ? latestRun.status : "NOT_RUN_TODAY" as const,
    latestRun: latestRun ?? null,
    latestSuccess: latestSuccess ?? null,
    portfolio: {
      startDate: portfolio.startDate,
      startValue: portfolio.startValue,
      totalValue: latestSnapshot.totalValue,
      cash: latestSnapshot.cash,
      positionValue: latestSnapshot.positionValue,
      positionRate: totalValue > 0 ? positionValue / totalValue : null,
      cashRate: totalValue > 0 ? cash / totalValue : null,
      cumulativeReturn: latestSnapshot.cumulativeReturn,
      annualizedReturn: latestSnapshot.annualizedReturn,
      sharpeRatio,
    },
    position: position ? {
      ...position,
      unrealizedReturn: Number(position.entryAmount) > 0 ? Number(position.unrealizedPnl) / Number(position.entryAmount) : null,
      positionRate: totalValue > 0 ? Number(position.marketValue) / totalValue : null,
    } : null,
    snapshots,
    trades,
  };
}
