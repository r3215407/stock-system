import "server-only";

import { randomUUID } from "node:crypto";

import { database, withDatabaseRetry } from "@/lib/postgres-db";
import {
  PositionPlanConflictError,
  PositionSignalConflictError,
  type NewPositionPlanItem,
  type PositionPlanItemRecord,
  type PositionPlanRecord,
  type PositionTradeRecord,
} from "@/lib/position-plan";

const PLAN_KEY = "default-simulation" as const;
type SchemaGlobal = typeof globalThis & { glacierPositionPlanSchema?: Promise<void> };
const schemaGlobal = globalThis as SchemaGlobal;

type PlanRow = Omit<PositionPlanRecord, "items">;
class RevisionMismatchError extends Error {}
class SameSignalError extends Error {}

export async function ensurePositionPlanSchema() {
  if (!schemaGlobal.glacierPositionPlanSchema) {
    schemaGlobal.glacierPositionPlanSchema = (async () => {
      const sql = database();
      await sql`
        CREATE TABLE IF NOT EXISTS position_plans (
          id uuid PRIMARY KEY,
          plan_key text NOT NULL UNIQUE,
          account_equity numeric(20,4) NOT NULL DEFAULT 100000,
          current_open_risk numeric(20,4) NOT NULL DEFAULT 0,
          three_consecutive_stops boolean NOT NULL DEFAULT false,
          revision bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS position_plan_items (
          id uuid PRIMARY KEY,
          plan_id uuid NOT NULL REFERENCES position_plans(id) ON DELETE CASCADE,
          symbol text NOT NULL,
          name text NOT NULL,
          industry text NOT NULL DEFAULT '未分类',
          priority integer NOT NULL,
          position_state text NOT NULL DEFAULT 'planned' CHECK (position_state IN ('planned','held')),
          strategy_id text NOT NULL,
          strategy_version text NOT NULL,
          parameter_version text NOT NULL,
          score integer NOT NULL,
          technical_score integer NOT NULL,
          strength_score integer NOT NULL,
          signal_date date NOT NULL,
          planned_entry_price numeric(16,4) NOT NULL,
          initial_stop_price numeric(16,4) NOT NULL,
          existing_stock_value numeric(20,4) NOT NULL DEFAULT 0,
          existing_industry_value numeric(20,4) NOT NULL DEFAULT 0,
          average_cost numeric(16,4) NULL,
          actual_shares integer NULL,
          purchase_date date NULL,
          source text NOT NULL,
          confirmation_state text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (plan_id, symbol)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS position_plan_items_order ON position_plan_items (plan_id, priority, updated_at)`;
      await sql`
        CREATE TABLE IF NOT EXISTS position_trade_history (
          id uuid PRIMARY KEY,
          plan_id uuid NOT NULL REFERENCES position_plans(id) ON DELETE CASCADE,
          source_item_id uuid NULL,
          symbol text NOT NULL,
          name text NOT NULL,
          industry text NOT NULL,
          strategy_id text NOT NULL,
          strategy_version text NOT NULL,
          parameter_version text NOT NULL,
          score integer NOT NULL,
          technical_score integer NOT NULL,
          strength_score integer NOT NULL,
          signal_date date NOT NULL,
          purchase_date date NOT NULL,
          exit_date date NOT NULL,
          average_cost numeric(16,4) NOT NULL,
          exit_price numeric(16,4) NOT NULL,
          actual_shares integer NOT NULL,
          initial_stop_price numeric(16,4) NOT NULL,
          gross_profit numeric(20,4) NOT NULL,
          net_profit numeric(20,4) NOT NULL,
          return_rate numeric(20,10) NOT NULL,
          r_multiple numeric(20,10) NOT NULL,
          holding_days integer NOT NULL,
          benchmark_entry_close numeric(16,4) NULL,
          benchmark_exit_close numeric(16,4) NULL,
          benchmark_return numeric(20,10) NULL,
          excess_return numeric(20,10) NULL,
          exit_reason text NOT NULL,
          review_note text NOT NULL DEFAULT '',
          source text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS position_trade_history_order ON position_trade_history (plan_id, exit_date DESC, created_at DESC)`;
      await sql`
        INSERT INTO position_plans (id, plan_key) VALUES (${randomUUID()}::uuid, ${PLAN_KEY})
        ON CONFLICT (plan_key) DO NOTHING
      `;
    })().catch((error) => {
      schemaGlobal.glacierPositionPlanSchema = undefined;
      throw error;
    });
  }
  return schemaGlobal.glacierPositionPlanSchema;
}

function numericPlan(row: PlanRow): PlanRow {
  return { ...row, accountEquity: Number(row.accountEquity), currentOpenRisk: Number(row.currentOpenRisk), revision: Number(row.revision) };
}

function numericItem(row: PositionPlanItemRecord): PositionPlanItemRecord {
  return {
    ...row,
    priority: Number(row.priority),
    score: Number(row.score),
    technicalScore: Number(row.technicalScore),
    strengthScore: Number(row.strengthScore),
    plannedEntryPrice: Number(row.plannedEntryPrice),
    initialStopPrice: Number(row.initialStopPrice),
    existingStockValue: Number(row.existingStockValue),
    existingIndustryValue: Number(row.existingIndustryValue),
    averageCost: row.averageCost === null ? null : Number(row.averageCost),
    actualShares: row.actualShares === null ? null : Number(row.actualShares),
  };
}

function numericTrade(row: PositionTradeRecord): PositionTradeRecord {
  return {
    ...row,
    score: Number(row.score),
    technicalScore: Number(row.technicalScore),
    strengthScore: Number(row.strengthScore),
    averageCost: Number(row.averageCost),
    exitPrice: Number(row.exitPrice),
    actualShares: Number(row.actualShares),
    initialStopPrice: Number(row.initialStopPrice),
    grossProfit: Number(row.grossProfit),
    netProfit: Number(row.netProfit),
    returnRate: Number(row.returnRate),
    rMultiple: Number(row.rMultiple),
    holdingDays: Number(row.holdingDays),
    benchmarkEntryClose: row.benchmarkEntryClose === null ? null : Number(row.benchmarkEntryClose),
    benchmarkExitClose: row.benchmarkExitClose === null ? null : Number(row.benchmarkExitClose),
    benchmarkReturn: row.benchmarkReturn === null ? null : Number(row.benchmarkReturn),
    excessReturn: row.excessReturn === null ? null : Number(row.excessReturn),
  };
}

export async function getPositionPlan(): Promise<PositionPlanRecord> {
  return withDatabaseRetry(async () => {
    await ensurePositionPlanSchema();
    const sql = database();
    const [plan] = await sql<PlanRow[]>`
      SELECT plan_key AS "planKey", account_equity AS "accountEquity", current_open_risk AS "currentOpenRisk",
        three_consecutive_stops AS "threeConsecutiveStops", revision, updated_at::text AS "updatedAt"
      FROM position_plans WHERE plan_key = ${PLAN_KEY}
    `;
    if (!plan) {
      schemaGlobal.glacierPositionPlanSchema = undefined;
      await ensurePositionPlanSchema();
      return getPositionPlan();
    }
    const items = await sql<PositionPlanItemRecord[]>`
      SELECT item.id::text, item.symbol, item.name, item.industry, item.priority,
        item.position_state AS "positionState", item.strategy_id AS "strategyId",
        item.strategy_version AS "strategyVersion", item.parameter_version AS "parameterVersion",
        item.score, item.technical_score AS "technicalScore", item.strength_score AS "strengthScore",
        item.signal_date::text AS "signalDate", item.planned_entry_price AS "plannedEntryPrice",
        item.initial_stop_price AS "initialStopPrice", item.existing_stock_value AS "existingStockValue",
        item.existing_industry_value AS "existingIndustryValue", item.average_cost AS "averageCost",
        item.actual_shares AS "actualShares", item.purchase_date::text AS "purchaseDate",
        item.source, item.confirmation_state AS "confirmationState", item.updated_at::text AS "updatedAt"
      FROM position_plan_items item
      JOIN position_plans plan ON plan.id = item.plan_id
      WHERE plan.plan_key = ${PLAN_KEY} ORDER BY item.priority, item.updated_at
    `;
    const history = await sql<PositionTradeRecord[]>`
      SELECT trade.id::text, trade.symbol, trade.name, trade.industry,
        trade.strategy_id AS "strategyId", trade.strategy_version AS "strategyVersion",
        trade.parameter_version AS "parameterVersion", trade.score,
        trade.technical_score AS "technicalScore", trade.strength_score AS "strengthScore",
        trade.signal_date::text AS "signalDate", trade.purchase_date::text AS "purchaseDate",
        trade.exit_date::text AS "exitDate", trade.average_cost AS "averageCost",
        trade.exit_price AS "exitPrice", trade.actual_shares AS "actualShares",
        trade.initial_stop_price AS "initialStopPrice", trade.gross_profit AS "grossProfit",
        trade.net_profit AS "netProfit", trade.return_rate AS "returnRate",
        trade.r_multiple AS "rMultiple", trade.holding_days AS "holdingDays",
        trade.benchmark_entry_close AS "benchmarkEntryClose",
        trade.benchmark_exit_close AS "benchmarkExitClose", trade.benchmark_return AS "benchmarkReturn",
        trade.excess_return AS "excessReturn", trade.exit_reason AS "exitReason",
        trade.review_note AS "reviewNote", trade.source, trade.created_at::text AS "createdAt"
      FROM position_trade_history trade
      JOIN position_plans plan ON plan.id = trade.plan_id
      WHERE plan.plan_key = ${PLAN_KEY} ORDER BY trade.exit_date DESC, trade.created_at DESC
    `;
    return { ...numericPlan(plan), planKey: PLAN_KEY, items: items.map(numericItem), history: history.map(numericTrade) };
  });
}

async function assertRevisionResult(updated: boolean) {
  if (!updated) throw new PositionPlanConflictError(await getPositionPlan());
  return getPositionPlan();
}

export async function updatePositionPlan(input: { revision: number; accountEquity?: number; currentOpenRisk?: number; threeConsecutiveStops?: boolean }) {
  await ensurePositionPlanSchema();
  const sql = database();
  const rows = await sql`
    UPDATE position_plans SET
      account_equity = COALESCE(${input.accountEquity ?? null}::numeric, account_equity),
      current_open_risk = COALESCE(${input.currentOpenRisk ?? null}::numeric, current_open_risk),
      three_consecutive_stops = COALESCE(${input.threeConsecutiveStops ?? null}::boolean, three_consecutive_stops),
      revision = revision + 1, updated_at = now()
    WHERE plan_key = ${PLAN_KEY} AND revision = ${input.revision}
    RETURNING id
  `;
  return assertRevisionResult(rows.length > 0);
}

export async function addPositionPlanItem(input: { revision: number; item: NewPositionPlanItem; replaceSignal?: boolean }) {
  await ensurePositionPlanSchema();
  const sql = database();
  try {
    await sql.begin(async (tx) => {
      const [plan] = await tx<{ id: string }[]>`
        UPDATE position_plans SET revision = revision + 1, updated_at = now()
        WHERE plan_key = ${PLAN_KEY} AND revision = ${input.revision} RETURNING id::text
      `;
      if (!plan) throw new RevisionMismatchError();
      const [current] = await tx<PositionPlanItemRecord[]>`
      SELECT id::text, symbol, name, industry, priority, position_state AS "positionState",
        strategy_id AS "strategyId", strategy_version AS "strategyVersion", parameter_version AS "parameterVersion",
        score, technical_score AS "technicalScore", strength_score AS "strengthScore", signal_date::text AS "signalDate",
        planned_entry_price AS "plannedEntryPrice", initial_stop_price AS "initialStopPrice",
        existing_stock_value AS "existingStockValue", existing_industry_value AS "existingIndustryValue",
        average_cost AS "averageCost", actual_shares AS "actualShares", purchase_date::text AS "purchaseDate",
        source, confirmation_state AS "confirmationState", updated_at::text AS "updatedAt"
      FROM position_plan_items WHERE plan_id = ${plan.id}::uuid AND symbol = ${input.item.symbol}
      `;
      if (current) {
        const sameSignal = current.strategyId === input.item.strategyId && current.strategyVersion === input.item.strategyVersion && current.signalDate === input.item.signalDate;
        if (!sameSignal && !input.replaceSignal) throw new PositionSignalConflictError(numericItem(current));
        if (sameSignal) throw new SameSignalError();
        await tx`
        UPDATE position_plan_items SET name=${input.item.name}, industry=${input.item.industry},
          strategy_id=${input.item.strategyId}, strategy_version=${input.item.strategyVersion}, parameter_version=${input.item.parameterVersion},
          score=${input.item.score}, technical_score=${input.item.technicalScore}, strength_score=${input.item.strengthScore},
          signal_date=${input.item.signalDate}::date, planned_entry_price=${input.item.plannedEntryPrice},
          initial_stop_price=${input.item.initialStopPrice}, source=${input.item.source},
          confirmation_state=${input.item.confirmationState}, updated_at=now()
        WHERE id=${current.id}::uuid
        `;
        return;
      }
      const [order] = await tx<{ priority: number }[]>`SELECT COALESCE(max(priority), 0) + 1 AS priority FROM position_plan_items WHERE plan_id=${plan.id}::uuid`;
      await tx`
      INSERT INTO position_plan_items (
        id, plan_id, symbol, name, industry, priority, strategy_id, strategy_version, parameter_version,
        score, technical_score, strength_score, signal_date, planned_entry_price, initial_stop_price,
        existing_stock_value, existing_industry_value, source, confirmation_state
      ) VALUES (
        ${randomUUID()}::uuid, ${plan.id}::uuid, ${input.item.symbol}, ${input.item.name}, ${input.item.industry}, ${order.priority},
        ${input.item.strategyId}, ${input.item.strategyVersion}, ${input.item.parameterVersion}, ${input.item.score},
        ${input.item.technicalScore}, ${input.item.strengthScore}, ${input.item.signalDate}::date,
        ${input.item.plannedEntryPrice}, ${input.item.initialStopPrice}, ${input.item.existingStockValue},
        ${input.item.existingIndustryValue}, ${input.item.source}, ${input.item.confirmationState}
      )
      `;
    });
  } catch (error) {
    if (error instanceof RevisionMismatchError) throw new PositionPlanConflictError(await getPositionPlan());
    if (error instanceof SameSignalError) return getPositionPlan();
    throw error;
  }
  return getPositionPlan();
}

export async function updatePositionPlanItem(id: string, input: { revision: number; changes: Record<string, unknown> }) {
  await ensurePositionPlanSchema();
  const allowed = {
    name: "name", industry: "industry", priority: "priority", positionState: "position_state",
    plannedEntryPrice: "planned_entry_price", initialStopPrice: "initial_stop_price",
    existingStockValue: "existing_stock_value", existingIndustryValue: "existing_industry_value",
    averageCost: "average_cost", actualShares: "actual_shares", purchaseDate: "purchase_date",
  } as const;
  const entries = Object.entries(input.changes).filter(([key]) => key in allowed);
  if (!entries.length) return getPositionPlan();
  const sql = database();
  const result = await sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`
      UPDATE position_plans SET revision=revision+1, updated_at=now()
      WHERE plan_key=${PLAN_KEY} AND revision=${input.revision} RETURNING id::text
    `;
    if (!plan) return false;
    for (const [key, value] of entries) {
      const column = allowed[key as keyof typeof allowed];
      await tx`UPDATE position_plan_items SET ${tx(column)} = ${value as string | number | boolean | null}, updated_at=now() WHERE id=${id}::uuid AND plan_id=${plan.id}::uuid`;
    }
    return true;
  });
  return assertRevisionResult(result);
}

export async function deletePositionPlanItem(id: string, revision: number) {
  await ensurePositionPlanSchema();
  const sql = database();
  const result = await sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`UPDATE position_plans SET revision=revision+1, updated_at=now() WHERE plan_key=${PLAN_KEY} AND revision=${revision} RETURNING id::text`;
    if (!plan) return false;
    await tx`DELETE FROM position_plan_items WHERE id=${id}::uuid AND plan_id=${plan.id}::uuid`;
    return true;
  });
  return assertRevisionResult(result);
}

export async function closePositionPlanItem(id: string, input: {
  revision: number;
  exitDate: string;
  exitPrice: number;
  holdingDays: number;
  benchmarkEntryClose: number | null;
  benchmarkExitClose: number | null;
  benchmarkReturn: number | null;
  exitReason: string;
  reviewNote: string;
}) {
  await ensurePositionPlanSchema();
  const sql = database();
  const result = await sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`
      UPDATE position_plans SET revision=revision+1, updated_at=now()
      WHERE plan_key=${PLAN_KEY} AND revision=${input.revision} RETURNING id::text
    `;
    if (!plan) return false;
    const [item] = await tx<PositionPlanItemRecord[]>`
      SELECT id::text, symbol, name, industry, priority, position_state AS "positionState",
        strategy_id AS "strategyId", strategy_version AS "strategyVersion", parameter_version AS "parameterVersion",
        score, technical_score AS "technicalScore", strength_score AS "strengthScore", signal_date::text AS "signalDate",
        planned_entry_price AS "plannedEntryPrice", initial_stop_price AS "initialStopPrice",
        existing_stock_value AS "existingStockValue", existing_industry_value AS "existingIndustryValue",
        average_cost AS "averageCost", actual_shares AS "actualShares", purchase_date::text AS "purchaseDate",
        source, confirmation_state AS "confirmationState", updated_at::text AS "updatedAt"
      FROM position_plan_items WHERE id=${id}::uuid AND plan_id=${plan.id}::uuid FOR UPDATE
    `;
    if (!item || item.positionState !== "held" || item.averageCost === null || item.actualShares === null || item.purchaseDate === null) {
      throw new Error("仅已持有且成交信息完整的仓位可以卖出归档");
    }
    const averageCost = Number(item.averageCost);
    const actualShares = Number(item.actualShares);
    const initialStopPrice = Number(item.initialStopPrice);
    const grossBuy = averageCost * actualShares;
    const grossSell = input.exitPrice * actualShares;
    const buyCommission = Math.max(5, grossBuy * 0.0003);
    const sellCommission = Math.max(5, grossSell * 0.0003);
    const stampTax = grossSell * 0.0005;
    const grossProfit = grossSell - grossBuy;
    const netProfit = grossProfit - buyCommission - sellCommission - stampTax;
    const returnRate = grossBuy > 0 ? netProfit / (grossBuy + buyCommission) : 0;
    const plannedRisk = Math.max(0, (averageCost - initialStopPrice) * actualShares);
    const rMultiple = plannedRisk > 0 ? netProfit / plannedRisk : 0;
    const excessReturn = input.benchmarkReturn === null ? null : returnRate - input.benchmarkReturn;
    await tx`
      INSERT INTO position_trade_history (
        id, plan_id, source_item_id, symbol, name, industry, strategy_id, strategy_version, parameter_version,
        score, technical_score, strength_score, signal_date, purchase_date, exit_date, average_cost, exit_price,
        actual_shares, initial_stop_price, gross_profit, net_profit, return_rate, r_multiple, holding_days,
        benchmark_entry_close, benchmark_exit_close, benchmark_return, excess_return, exit_reason, review_note, source
      ) VALUES (
        ${randomUUID()}::uuid, ${plan.id}::uuid, ${id}::uuid, ${item.symbol}, ${item.name}, ${item.industry},
        ${item.strategyId}, ${item.strategyVersion}, ${item.parameterVersion}, ${Number(item.score)},
        ${Number(item.technicalScore)}, ${Number(item.strengthScore)}, ${item.signalDate}::date,
        ${item.purchaseDate}::date, ${input.exitDate}::date, ${averageCost}, ${input.exitPrice}, ${actualShares},
        ${initialStopPrice}, ${grossProfit}, ${netProfit}, ${returnRate}, ${rMultiple}, ${input.holdingDays},
        ${input.benchmarkEntryClose}, ${input.benchmarkExitClose}, ${input.benchmarkReturn}, ${excessReturn},
        ${input.exitReason}, ${input.reviewNote}, ${item.source}
      )
    `;
    await tx`DELETE FROM position_plan_items WHERE id=${id}::uuid AND plan_id=${plan.id}::uuid`;
    return true;
  });
  return assertRevisionResult(result);
}

export async function deletePositionTrade(id: string, revision: number) {
  await ensurePositionPlanSchema();
  const sql = database();
  const result = await sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`
      UPDATE position_plans SET revision=revision+1, updated_at=now()
      WHERE plan_key=${PLAN_KEY} AND revision=${revision} RETURNING id::text
    `;
    if (!plan) return false;
    await tx`DELETE FROM position_trade_history WHERE id=${id}::uuid AND plan_id=${plan.id}::uuid`;
    return true;
  });
  return assertRevisionResult(result);
}

export async function clearPositionPlan(revision: number) {
  await ensurePositionPlanSchema();
  const sql = database();
  const result = await sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string }[]>`
      UPDATE position_plans SET account_equity=100000, current_open_risk=0, three_consecutive_stops=false,
        revision=revision+1, updated_at=now() WHERE plan_key=${PLAN_KEY} AND revision=${revision} RETURNING id::text
    `;
    if (!plan) return false;
    await tx`DELETE FROM position_plan_items WHERE plan_id=${plan.id}::uuid`;
    await tx`DELETE FROM position_trade_history WHERE plan_id=${plan.id}::uuid`;
    return true;
  });
  return assertRevisionResult(result);
}
