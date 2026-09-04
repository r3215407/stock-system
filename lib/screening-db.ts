import "server-only";

import { randomUUID } from "node:crypto";

import { database, withDatabaseRetry } from "@/lib/postgres-db";
import type { ScreeningCandidate, ScreeningFailure, ScreeningJob, ScreeningSecurity, ScreeningStage, ScreeningStatus } from "@/lib/screening";

type SchemaGlobal = typeof globalThis & { glacierScreeningSchema?: Promise<void> };
const schemaGlobal = globalThis as SchemaGlobal;

type JobRow = {
  jobId: string;
  status: ScreeningStatus;
  stage: ScreeningStage;
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  requestedDate: string | null;
  dataDate: string | null;
  createdAt: string;
  generatedAt: string | null;
  expiresAt: string;
  processed: number;
  universeTotal: number;
  afterBasicFilter: number;
  scored: number;
  failedCount: number;
  pauseFailureCount: number;
  elapsedMs: number;
  provider: string;
  adjustment: "前复权";
  incomplete: boolean;
  error: string | null;
  candidates: ScreeningCandidate[];
  candidateTop10: ScreeningCandidate[];
  exclusions: Array<{ reason: string; count: number }>;
  failures: ScreeningFailure[];
  failureDetailsTotal: number;
};

export type ScreeningBatchSecurity = ScreeningSecurity;

export type ScreeningBatchFailure = ScreeningBatchSecurity & Pick<ScreeningFailure, "errorCode" | "errorMessage">;

export type ClaimedScreeningBatch = {
  batchId: string;
  leaseToken: string;
  jobId: string;
  payload: ScreeningBatchSecurity[];
  totalCount: number;
  previousResults: ScreeningCandidate[];
  previousExclusions: Record<string, number>;
  previousDataDate: string | null;
  attempts: number;
  strategyId: string;
  strategyVersion: string;
  requestedDate: string | null;
  environmentScore: number;
  pauseFailureCount: number;
};

export type ClaimedScreeningInitialization = {
  jobId: string;
  attempts: number;
  strategyId: string;
  strategyVersion: string;
  requestedDate: string | null;
};

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[数据库连接已隐藏]").slice(0, 500);
}

export async function ensureScreeningSchema() {
  if (!schemaGlobal.glacierScreeningSchema) {
    schemaGlobal.glacierScreeningSchema = (async () => {
      const sql = database();
      const [schema] = await sql<{ ready: boolean }[]>`
        SELECT to_regclass('public.screening_jobs') IS NOT NULL
          AND to_regclass('public.screening_batches') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'screening_jobs'
              AND column_name = 'initialization_status'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'screening_batches'
              AND column_name = 'failed_payload'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'screening_jobs'
              AND column_name = 'failure_details_version'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'screening_batches'
              AND column_name = 'lease_token'
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'screening_jobs'
              AND column_name = 'rate_limit_501_count'
          ) AS ready
      `;
      if (schema.ready) return;
      await sql`
        CREATE TABLE IF NOT EXISTS screening_jobs (
          id uuid PRIMARY KEY,
          idempotency_key text NOT NULL UNIQUE,
          status text NOT NULL CHECK (status IN ('running','paused','completed','failed','cancelled')),
          stage text NOT NULL,
          strategy_id text NOT NULL,
          strategy_version text NOT NULL,
          parameter_version text NOT NULL,
          requested_date date NULL,
          business_date date NOT NULL,
          data_date date NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          generated_at timestamptz NULL,
          expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 days'),
          processed integer NOT NULL DEFAULT 0,
          universe_total integer NOT NULL DEFAULT 0,
          after_basic_filter integer NOT NULL DEFAULT 0,
          scored integer NOT NULL DEFAULT 0,
          failed_count integer NOT NULL DEFAULT 0,
          rate_limit_501_count integer NOT NULL DEFAULT 0,
          elapsed_ms bigint NOT NULL DEFAULT 0,
          provider text NOT NULL,
          adjustment text NOT NULL DEFAULT '前复权',
          environment_score integer NULL,
          initialization_status text NOT NULL DEFAULT 'pending',
          initialization_attempts integer NOT NULL DEFAULT 0,
          initialization_lease_until timestamptz NULL,
          incomplete boolean NOT NULL DEFAULT false,
          error text NULL,
          initial_exclusions jsonb NOT NULL DEFAULT '{}'::jsonb,
          candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
          watch jsonb NOT NULL DEFAULT '[]'::jsonb,
          exclusions jsonb NOT NULL DEFAULT '[]'::jsonb
        )
      `;
      await sql`ALTER TABLE screening_jobs ADD COLUMN IF NOT EXISTS initialization_status text NOT NULL DEFAULT 'pending'`;
      await sql`ALTER TABLE screening_jobs ADD COLUMN IF NOT EXISTS initialization_attempts integer NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE screening_jobs ADD COLUMN IF NOT EXISTS initialization_lease_until timestamptz NULL`;
      await sql`ALTER TABLE screening_jobs ADD COLUMN IF NOT EXISTS failure_details_version integer NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE screening_jobs ADD COLUMN IF NOT EXISTS rate_limit_501_count integer NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE screening_jobs DROP CONSTRAINT IF EXISTS screening_jobs_status_check`;
      await sql`ALTER TABLE screening_jobs ADD CONSTRAINT screening_jobs_status_check CHECK (status IN ('running','paused','completed','failed','cancelled'))`;
      await sql`
        UPDATE screening_jobs SET initialization_status = 'completed', initialization_lease_until = NULL
        WHERE environment_score IS NOT NULL AND initialization_status <> 'completed'
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS screening_batches (
          id uuid PRIMARY KEY,
          job_id uuid NOT NULL REFERENCES screening_jobs(id) ON DELETE CASCADE,
          batch_index integer NOT NULL,
          status text NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
          payload jsonb NOT NULL,
          failed_payload jsonb NOT NULL DEFAULT '[]'::jsonb,
          results jsonb NOT NULL DEFAULT '[]'::jsonb,
          exclusions jsonb NOT NULL DEFAULT '{}'::jsonb,
          processed integer NOT NULL DEFAULT 0,
          scored integer NOT NULL DEFAULT 0,
          failed_count integer NOT NULL DEFAULT 0,
          data_date date NULL,
          attempts integer NOT NULL DEFAULT 0,
          lease_until timestamptz NULL,
          lease_token uuid NULL,
          error text NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          started_at timestamptz NULL,
          finished_at timestamptz NULL,
          UNIQUE (job_id, batch_index)
        )
      `;
      await sql`ALTER TABLE screening_batches ADD COLUMN IF NOT EXISTS failed_payload jsonb NOT NULL DEFAULT '[]'::jsonb`;
      await sql`ALTER TABLE screening_batches ADD COLUMN IF NOT EXISTS lease_token uuid NULL`;
      await sql`
        UPDATE screening_batches b
        SET failed_payload = COALESCE((
          SELECT jsonb_agg(source.item || jsonb_build_object(
            'errorCode', 'LEGACY_UNCLASSIFIED',
            'errorMessage', '旧记录未保存具体错误；再次点击后将重新读取行情并分类。'
          ))
          FROM jsonb_array_elements(b.payload) AS source(item)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(b.results) AS result(item)
            WHERE result.item->>'symbol' = source.item->>'symbol'
          )
        ), '[]'::jsonb)
        WHERE b.status = 'completed' AND b.failed_count > 0
          AND jsonb_array_length(b.failed_payload) = 0
      `;
      await sql`
        UPDATE screening_batches b
        SET exclusions = jsonb_set(
          b.exclusions,
          '{上市不足250个交易日}',
          to_jsonb(GREATEST(
            0,
            COALESCE((b.exclusions->>'上市不足250个交易日')::integer, 0)
              - GREATEST(0, jsonb_array_length(b.failed_payload) - b.failed_count)
          )),
          true
        )
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(b.failed_payload) AS failed(item)
          WHERE failed.item->>'errorCode' = 'LEGACY_UNCLASSIFIED'
        )
      `;
      await sql`UPDATE screening_jobs SET failure_details_version = 1 WHERE failure_details_version = 0`;
      await sql`CREATE INDEX IF NOT EXISTS screening_jobs_recent ON screening_jobs (strategy_id, strategy_version, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS screening_batches_claim ON screening_batches (status, lease_until, created_at)`;
    })().catch((error) => {
      schemaGlobal.glacierScreeningSchema = undefined;
      throw error;
    });
  }
  return schemaGlobal.glacierScreeningSchema;
}

function selectJob(sql: ReturnType<typeof database>, condition: ReturnType<typeof sql>) {
  return sql<JobRow[]>`
    SELECT id AS "jobId", status, stage, strategy_id AS "strategyId", strategy_version AS "strategyVersion",
      parameter_version AS "parameterVersion", requested_date::text AS "requestedDate", data_date::text AS "dataDate",
      created_at::text AS "createdAt", generated_at::text AS "generatedAt", expires_at::text AS "expiresAt",
      processed, universe_total AS "universeTotal", after_basic_filter AS "afterBasicFilter", scored,
      failed_count AS "failedCount", rate_limit_501_count AS "pauseFailureCount",
      elapsed_ms::integer AS "elapsedMs", provider, adjustment, incomplete, error,
      candidates, watch AS "candidateTop10", exclusions,
      COALESCE((
        SELECT jsonb_agg(details.item)
        FROM (
          SELECT jsonb_build_object(
            'symbol', failed.item->>'symbol', 'code', failed.item->>'code', 'name', failed.item->>'name',
            'market', failed.item->>'market',
            'errorCode', COALESCE(failed.item->>'errorCode', 'LEGACY_UNCLASSIFIED'),
            'errorMessage', COALESCE(
              failed.item->>'errorMessage',
              '旧版本未保存错误摘要；再次点击后将重新读取行情并分类。'
            )
          ) AS item
          FROM screening_batches AS batch
          CROSS JOIN LATERAL jsonb_array_elements(batch.failed_payload) AS failed(item)
          WHERE batch.job_id = screening_jobs.id AND failed.item->>'errorCode' <> 'PAUSED_UNPROCESSED'
          ORDER BY batch.batch_index, failed.item->>'symbol'
          LIMIT 200
        ) AS details
      ), '[]'::jsonb) AS failures,
      COALESCE((
        SELECT count(*)::integer
        FROM screening_batches AS batch
        CROSS JOIN LATERAL jsonb_array_elements(batch.failed_payload) AS counted(item)
        WHERE batch.job_id = screening_jobs.id AND counted.item->>'errorCode' <> 'PAUSED_UNPROCESSED'
      ), 0) AS "failureDetailsTotal"
    FROM screening_jobs WHERE ${condition}
  `;
}

function toJob(row: JobRow, cacheHit = false): ScreeningJob {
  return { ...row, cacheHit };
}

export async function findReusableScreeningJob(
  strategyId: string,
  strategyVersion: string,
  parameterVersion: string,
  requestedDate: string | null,
  businessDate: string,
) {
  await ensureScreeningSchema();
  const sql = database();
  const [row] = await selectJob(sql, sql`
    strategy_id = ${strategyId} AND strategy_version = ${strategyVersion} AND parameter_version = ${parameterVersion}
    AND requested_date IS NOT DISTINCT FROM ${requestedDate}::date
    AND (${requestedDate}::date IS NOT NULL OR business_date = ${businessDate}::date)
    AND status = 'completed' AND expires_at > now()
    ORDER BY generated_at DESC LIMIT 1
  `);
  return row ? toJob(row, true) : null;
}

export async function findActiveScreeningJob(
  strategyId: string,
  strategyVersion: string,
  parameterVersion: string,
  requestedDate: string | null,
  businessDate: string,
) {
  await ensureScreeningSchema();
  const sql = database();
  const [row] = await selectJob(sql, sql`
    strategy_id = ${strategyId} AND strategy_version = ${strategyVersion} AND parameter_version = ${parameterVersion}
    AND requested_date IS NOT DISTINCT FROM ${requestedDate}::date
    AND (${requestedDate}::date IS NOT NULL OR business_date = ${businessDate}::date)
    AND status IN ('running', 'paused') AND expires_at > now()
    ORDER BY created_at ASC LIMIT 1
  `);
  return row ? toJob(row) : null;
}

export async function findLatestScreeningJob(
  strategyId: string,
  strategyVersion: string,
  parameterVersion: string,
) {
  await ensureScreeningSchema();
  const sql = database();
  const [row] = await selectJob(sql, sql`
    strategy_id = ${strategyId} AND strategy_version = ${strategyVersion} AND parameter_version = ${parameterVersion}
    AND status IN ('running', 'paused', 'completed') AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1
  `);
  return row ? toJob(row, row.status === "completed") : null;
}

export async function createScreeningJobRow(input: {
  idempotencyKey: string;
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  requestedDate: string | null;
  businessDate: string;
  provider: string;
}) {
  await ensureScreeningSchema();
  const sql = database();
  const jobId = randomUUID();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO screening_jobs (
      id, idempotency_key, status, stage, strategy_id, strategy_version, parameter_version,
      requested_date, business_date, provider, expires_at
    ) VALUES (
      ${jobId}, ${input.idempotencyKey}, 'running', '获取证券池', ${input.strategyId}, ${input.strategyVersion},
      ${input.parameterVersion}, ${input.requestedDate}::date, ${input.businessDate}::date, ${input.provider},
      now() + interval '3 days'
    ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
  `;
  const id = inserted[0]?.id;
  if (id) return { created: true as const, jobId: id };
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM screening_jobs WHERE idempotency_key = ${input.idempotencyKey}`;
  return { created: false as const, jobId: existing.id };
}

export async function getScreeningJobRow(jobId: string) {
  return withDatabaseRetry(async () => {
    await ensureScreeningSchema();
    const sql = database();
    const [row] = await selectJob(sql, sql`id = ${jobId}`);
    return row ? toJob(row) : null;
  });
}

export async function restartCancelledScreeningJob(jobId: string) {
  await ensureScreeningSchema();
  const sql = database();
  const restarted = await sql.begin(async (tx) => {
    const rows = await tx<{ initializationStatus: "pending" | "running" | "completed" }[]>`
      UPDATE screening_jobs SET status = 'running',
        stage = CASE WHEN initialization_status = 'completed' THEN '读取日线' ELSE '获取证券池' END,
        initialization_status = CASE WHEN initialization_status = 'completed' THEN 'completed' ELSE 'pending' END,
        initialization_attempts = CASE WHEN initialization_status = 'completed' THEN initialization_attempts ELSE 0 END,
        initialization_lease_until = NULL,
        generated_at = NULL, error = NULL, expires_at = now() + interval '3 days'
      WHERE id = ${jobId} AND status = 'cancelled'
      RETURNING initialization_status AS "initializationStatus"
    `;
    if (!rows.length) return false;
    await tx`
      UPDATE screening_batches SET status = 'pending', attempts = 0,
        lease_until = NULL, lease_token = NULL, finished_at = NULL, error = NULL
      WHERE job_id = ${jobId} AND status = 'cancelled'
    `;
    return true;
  });
  return restarted ? getScreeningJobRow(jobId) : null;
}

export async function initializeScreeningBatches(input: {
  jobId: string;
  universeTotal: number;
  securities: ScreeningBatchSecurity[];
  environmentScore: number;
  initialExclusions: Record<string, number>;
  batchSize: number;
}) {
  const sql = database();
  const chunks: ScreeningBatchSecurity[][] = [];
  for (let index = 0; index < input.securities.length; index += input.batchSize) {
    chunks.push(input.securities.slice(index, index + input.batchSize));
  }
  await sql.begin(async (tx) => {
    if (chunks.length > 0) {
      const batchIds = chunks.map(() => randomUUID());
      const batchIndexes = chunks.map((_, index) => index);
      const payloads = chunks.map((chunk) => JSON.stringify(chunk));
      await tx`
        INSERT INTO screening_batches (id, job_id, batch_index, status, payload)
        SELECT item.id::uuid, ${input.jobId}::uuid, item.batch_index, 'pending', item.payload::jsonb
        FROM unnest(
          ${batchIds}::text[], ${batchIndexes}::integer[], ${payloads}::text[]
        ) AS item(id, batch_index, payload)
        ON CONFLICT (job_id, batch_index) DO NOTHING
      `;
    }
    await tx`
      UPDATE screening_jobs SET stage = '读取日线', universe_total = ${input.universeTotal},
        after_basic_filter = ${input.securities.length}, environment_score = ${input.environmentScore},
        initial_exclusions = ${tx.json(input.initialExclusions)}, error = NULL,
        initialization_status = 'completed', initialization_lease_until = NULL
      WHERE id = ${input.jobId} AND status = 'running' AND initialization_status = 'running'
    `;
  });
}

export async function claimScreeningInitialization(jobId?: string): Promise<ClaimedScreeningInitialization | null> {
  await ensureScreeningSchema();
  const sql = database();
  const requestedJobId = jobId ?? null;
  return sql.begin(async (tx) => {
    await tx`
      UPDATE screening_jobs SET initialization_status = 'pending', initialization_lease_until = NULL,
        error = '证券池初始化租约过期，已重新排队'
      WHERE status = 'running' AND initialization_status = 'running'
        AND initialization_lease_until < now() AND initialization_attempts < 3
    `;
    await tx`
      UPDATE screening_jobs SET status = 'failed', stage = '失败', initialization_status = 'failed',
        initialization_lease_until = NULL, error = '证券池连续三次初始化超时',
        elapsed_ms = floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint
      WHERE status = 'running' AND initialization_status = 'running'
        AND initialization_lease_until < now() AND initialization_attempts >= 3
    `;
    const [job] = await tx<ClaimedScreeningInitialization[]>`
      SELECT id AS "jobId", initialization_attempts AS attempts, strategy_id AS "strategyId",
        strategy_version AS "strategyVersion", requested_date::text AS "requestedDate"
      FROM screening_jobs
      WHERE status = 'running' AND initialization_status = 'pending' AND environment_score IS NULL
        AND expires_at > now()
        AND (${requestedJobId}::uuid IS NULL OR id = ${requestedJobId}::uuid)
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!job) return null;
    await tx`
      UPDATE screening_jobs SET initialization_status = 'running',
        initialization_attempts = initialization_attempts + 1,
        initialization_lease_until = now() + interval '4 minutes', stage = '获取证券池', error = NULL
      WHERE id = ${job.jobId}
    `;
    return { ...job, attempts: job.attempts + 1 };
  });
}

export async function releaseScreeningInitialization(job: ClaimedScreeningInitialization, error: unknown) {
  const sql = database();
  const terminal = job.attempts >= 3;
  await sql`
    UPDATE screening_jobs SET initialization_status = ${terminal ? "failed" : "pending"},
      status = CASE WHEN ${terminal} THEN 'failed' ELSE status END,
      stage = CASE WHEN ${terminal} THEN '失败' ELSE '获取证券池' END,
      initialization_lease_until = NULL, error = ${publicError(error)},
      elapsed_ms = floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint
    WHERE id = ${job.jobId} AND status = 'running' AND initialization_status = 'running'
  `;
}

export async function failScreeningJob(jobId: string, error: unknown) {
  const sql = database();
  await sql`
    UPDATE screening_jobs SET status = 'failed', stage = '失败', error = ${publicError(error)},
      elapsed_ms = GREATEST(elapsed_ms, floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint)
    WHERE id = ${jobId} AND status = 'running'
  `;
}

export async function pauseScreeningJobAfterFailures(jobId: string) {
  await ensureScreeningSchema();
  const sql = database();
  const paused = await sql.begin(async (tx) => {
    const pausedJobs = await tx`
      UPDATE screening_jobs SET status = 'paused', stage = '已暂停',
        initialization_status = CASE WHEN initialization_status = 'running' THEN 'pending' ELSE initialization_status END,
        initialization_attempts = CASE WHEN initialization_status = 'running' THEN 0 ELSE initialization_attempts END,
        initialization_lease_until = NULL,
        error = '扫描连续处理失败 3 次，已暂停并保留当前结果。点击继续后再恢复扫描。',
        elapsed_ms = GREATEST(elapsed_ms, floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint),
        expires_at = now() + interval '3 days'
      WHERE id = ${jobId} AND status = 'running'
      RETURNING id
    `;
    if (!pausedJobs.length) return pausedJobs;
    await tx`
      UPDATE screening_batches SET status = 'pending', attempts = 0,
        lease_until = NULL, lease_token = NULL, finished_at = NULL,
        error = '页面连续三次处理失败，等待手动继续'
      WHERE job_id = ${jobId} AND status = 'running'
    `;
    return pausedJobs;
  });
  if (!paused.length) return null;
  return getScreeningJobRow(jobId);
}

export async function claimScreeningBatch(jobId?: string): Promise<ClaimedScreeningBatch | null> {
  await ensureScreeningSchema();
  const sql = database();
  const requestedJobId = jobId ?? null;
  return sql.begin(async (tx) => {
    await tx`
      UPDATE screening_batches SET status = 'pending', lease_until = NULL, lease_token = NULL,
        error = '上次执行租约过期，已重新排队'
      WHERE status = 'running' AND lease_until < now() AND attempts < 3
    `;
    await tx`
      UPDATE screening_batches SET status = 'failed', lease_until = NULL, lease_token = NULL,
        finished_at = now(), error = '分片连续三次执行超时'
      WHERE status = 'running' AND lease_until < now() AND attempts >= 3
    `;
    const [batch] = await tx<ClaimedScreeningBatch[]>`
      SELECT b.id AS "batchId", b.job_id AS "jobId",
        CASE WHEN jsonb_array_length(b.failed_payload) > 0 THEN b.failed_payload ELSE b.payload END AS payload,
        jsonb_array_length(b.payload)::integer AS "totalCount", b.results AS "previousResults",
        b.exclusions AS "previousExclusions", b.data_date::text AS "previousDataDate", b.attempts,
        j.strategy_id AS "strategyId", j.strategy_version AS "strategyVersion",
        j.requested_date::text AS "requestedDate", j.environment_score AS "environmentScore",
        j.rate_limit_501_count AS "pauseFailureCount"
      FROM screening_batches b
      JOIN screening_jobs j ON j.id = b.job_id
      WHERE b.status = 'pending' AND j.status = 'running' AND j.environment_score IS NOT NULL
        AND (${requestedJobId}::uuid IS NULL OR b.job_id = ${requestedJobId}::uuid)
      ORDER BY j.created_at ASC, b.batch_index ASC
      LIMIT 1 FOR UPDATE OF b SKIP LOCKED
    `;
    if (!batch) return null;
    const leaseToken = randomUUID();
    await tx`
      UPDATE screening_batches SET status = 'running', attempts = attempts + 1,
        lease_until = now() + interval '5 minutes', lease_token = ${leaseToken}::uuid,
        started_at = COALESCE(started_at, now()), error = NULL
      WHERE id = ${batch.batchId}
    `;
    await tx`UPDATE screening_jobs SET stage = '读取日线' WHERE id = ${batch.jobId} AND status = 'running'`;
    return { ...batch, leaseToken, attempts: batch.attempts + 1 };
  });
}

export async function getClaimedScreeningBatch(jobId: string, batchId: string, leaseToken: string) {
  await ensureScreeningSchema();
  const sql = database();
  const [batch] = await sql<ClaimedScreeningBatch[]>`
    SELECT b.id AS "batchId", b.job_id AS "jobId", b.lease_token::text AS "leaseToken",
      CASE WHEN jsonb_array_length(b.failed_payload) > 0 THEN b.failed_payload ELSE b.payload END AS payload,
      jsonb_array_length(b.payload)::integer AS "totalCount", b.results AS "previousResults",
      b.exclusions AS "previousExclusions", b.data_date::text AS "previousDataDate", b.attempts,
      j.strategy_id AS "strategyId", j.strategy_version AS "strategyVersion",
      j.requested_date::text AS "requestedDate", j.environment_score AS "environmentScore",
      j.rate_limit_501_count AS "pauseFailureCount"
    FROM screening_batches b
    JOIN screening_jobs j ON j.id = b.job_id
    WHERE b.id = ${batchId}::uuid AND b.job_id = ${jobId}::uuid
      AND b.status = 'running' AND b.lease_token = ${leaseToken}::uuid AND j.status = 'running'
  `;
  return batch ?? null;
}

export async function completeScreeningBatch(input: {
  batchId: string;
  jobId: string;
  leaseToken: string;
  results: ScreeningCandidate[];
  exclusions: Record<string, number>;
  processed: number;
  scored: number;
  failedCount: number;
  failedSecurities: ScreeningBatchFailure[];
  dataDate: string | null;
  pauseFailureDelta?: number;
}) {
  const sql = database();
  await sql.begin(async (tx) => {
    const completed = await tx<{ id: string }[]>`
      UPDATE screening_batches SET status = 'completed', results = ${tx.json(input.results)},
        exclusions = ${tx.json(input.exclusions)}, processed = ${input.processed}, scored = ${input.scored},
        failed_count = ${input.failedCount}, failed_payload = ${tx.json(input.failedSecurities)}, data_date = ${input.dataDate}::date,
        lease_until = NULL, lease_token = NULL, finished_at = now(), error = NULL
      WHERE id = ${input.batchId} AND job_id = ${input.jobId} AND status = 'running'
        AND lease_token = ${input.leaseToken}::uuid
      RETURNING id
    `;
    if (!completed[0]) throw new Error("扫描分片租约已经失效，请重新领取后继续。");
    await tx`
      UPDATE screening_jobs j SET
        processed = totals.processed, scored = totals.scored, failed_count = totals.failed_count,
        rate_limit_501_count = j.rate_limit_501_count + ${input.pauseFailureDelta ?? 0},
        data_date = COALESCE(j.data_date, totals.data_date),
        elapsed_ms = floor(extract(epoch FROM (now() - j.created_at)) * 1000)::bigint
      FROM (
        SELECT job_id, COALESCE(sum(processed), 0)::integer AS processed,
          COALESCE(sum(scored), 0)::integer AS scored, COALESCE(sum(failed_count), 0)::integer AS failed_count,
          max(data_date) AS data_date
        FROM screening_batches WHERE job_id = ${input.jobId} GROUP BY job_id
      ) totals
      WHERE j.id = totals.job_id AND j.status = 'running'
    `;
  });
}

export async function pauseScreeningBatch(input: {
  batchId: string;
  jobId: string;
  leaseToken: string;
  results: ScreeningCandidate[];
  exclusions: Record<string, number>;
  retrySecurities: ScreeningBatchFailure[];
  processed: number;
  failedCount: number;
  dataDate: string | null;
  pauseFailureDelta: number;
  candidates: ScreeningCandidate[];
  candidateTop10: ScreeningCandidate[];
  aggregatedExclusions: Array<{ reason: string; count: number }>;
}) {
  const sql = database();
  await sql.begin(async (tx) => {
    const [pausedBatch] = await tx<{ id: string }[]>`
      UPDATE screening_batches SET status = 'pending', results = ${tx.json(input.results)},
        exclusions = ${tx.json(input.exclusions)}, processed = ${input.processed}, scored = ${input.results.length},
        failed_count = ${input.failedCount}, failed_payload = ${tx.json(input.retrySecurities)},
        data_date = ${input.dataDate}::date, attempts = 0, lease_until = NULL, lease_token = NULL,
        finished_at = NULL, error = '累计 3 次行情读取失败，等待手动继续'
      WHERE id = ${input.batchId} AND job_id = ${input.jobId} AND status = 'running'
        AND lease_token = ${input.leaseToken}::uuid
      RETURNING id
    `;
    if (!pausedBatch) throw new Error("扫描分片租约已经失效，请重新领取后继续。");
    await tx`
      UPDATE screening_jobs j SET status = 'paused', stage = '已暂停',
        candidates = ${tx.json(input.candidates)}, watch = ${tx.json(input.candidateTop10)},
        exclusions = ${tx.json(input.aggregatedExclusions)},
        rate_limit_501_count = j.rate_limit_501_count + ${input.pauseFailureDelta},
        processed = totals.processed, scored = totals.scored, failed_count = totals.failed_count,
        data_date = COALESCE(j.data_date, totals.data_date),
        error = '行情读取累计失败 3 次，扫描已暂停。点击继续后将优先重试失败股票。',
        elapsed_ms = floor(extract(epoch FROM (now() - j.created_at)) * 1000)::bigint,
        expires_at = now() + interval '3 days'
      FROM (
        SELECT job_id, COALESCE(sum(processed), 0)::integer AS processed,
          COALESCE(sum(scored), 0)::integer AS scored, COALESCE(sum(failed_count), 0)::integer AS failed_count,
          max(data_date) AS data_date
        FROM screening_batches WHERE job_id = ${input.jobId} GROUP BY job_id
      ) totals
      WHERE j.id = totals.job_id AND j.id = ${input.jobId} AND j.status = 'running'
    `;
  });
}

export async function resumePausedScreeningJob(jobId: string) {
  await ensureScreeningSchema();
  const sql = database();
  const rows = await sql`
    UPDATE screening_jobs SET status = 'running', stage = '读取日线', rate_limit_501_count = 0,
      error = NULL, expires_at = now() + interval '3 days'
    WHERE id = ${jobId} AND status = 'paused' RETURNING id
  `;
  if (!rows.length) {
    const current = await getScreeningJobRow(jobId);
    return current?.status === "running" ? current : null;
  }
  return getScreeningJobRow(jobId);
}

export async function retryFailedScreeningJob(jobId: string) {
  await ensureScreeningSchema();
  const sql = database();
  const retryCount = await sql.begin(async (tx) => {
    const batches = await tx<{ id: string }[]>`
      UPDATE screening_batches
      SET status = 'pending', attempts = 0, lease_until = NULL, lease_token = NULL, finished_at = NULL, error = NULL,
        processed = jsonb_array_length(results), scored = jsonb_array_length(results),
        failed_count = jsonb_array_length(failed_payload)
      WHERE job_id = ${jobId} AND status = 'completed' AND jsonb_array_length(failed_payload) > 0
      RETURNING id
    `;
    if (batches.length === 0) return 0;
    await tx`
      UPDATE screening_jobs j
      SET status = 'running', stage = '读取日线', generated_at = NULL,
        processed = totals.processed, scored = totals.scored, failed_count = totals.failed_count,
        rate_limit_501_count = 0,
        candidates = '[]'::jsonb, watch = '[]'::jsonb, exclusions = '[]'::jsonb,
        incomplete = false, error = NULL, expires_at = now() + interval '3 days'
      FROM (
        SELECT job_id, COALESCE(sum(processed), 0)::integer AS processed,
          COALESCE(sum(scored), 0)::integer AS scored,
          COALESCE(sum(failed_count), 0)::integer AS failed_count
        FROM screening_batches WHERE job_id = ${jobId} GROUP BY job_id
      ) totals
      WHERE j.id = totals.job_id AND j.id = ${jobId} AND j.status = 'completed'
    `;
    return batches.length;
  });
  if (retryCount === 0) return null;
  return getScreeningJobRow(jobId);
}

export async function releaseScreeningBatch(batch: ClaimedScreeningBatch, error: unknown) {
  const sql = database();
  const terminal = batch.attempts >= 3;
  await sql`
    UPDATE screening_batches SET status = ${terminal ? "failed" : "pending"}, lease_until = NULL, lease_token = NULL,
      finished_at = CASE WHEN ${terminal} THEN now() ELSE finished_at END, error = ${publicError(error)}
    WHERE id = ${batch.batchId} AND status = 'running' AND lease_token = ${batch.leaseToken}::uuid
  `;
}

export async function loadScreeningAggregation(jobId: string) {
  const sql = database();
  const batches = await sql<{
    batchId: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    results: ScreeningCandidate[];
    exclusions: Record<string, number>;
  }[]>`SELECT id::text AS "batchId", status, results, exclusions FROM screening_batches WHERE job_id = ${jobId} ORDER BY batch_index`;
  const [job] = await sql<{ initialExclusions: Record<string, number>; afterBasicFilter: number; failedCount: number }[]>`
    SELECT initial_exclusions AS "initialExclusions", after_basic_filter AS "afterBasicFilter", failed_count AS "failedCount"
    FROM screening_jobs WHERE id = ${jobId}
  `;
  return { batches, job };
}

export async function findFinalizableScreeningJobs(jobId?: string) {
  const sql = database();
  const requestedJobId = jobId ?? null;
  return sql<{ jobId: string; strategyId: string; strategyVersion: string }[]>`
    SELECT j.id AS "jobId", j.strategy_id AS "strategyId", j.strategy_version AS "strategyVersion"
    FROM screening_jobs j
    WHERE j.status = 'running' AND j.environment_score IS NOT NULL
      AND (${requestedJobId}::uuid IS NULL OR j.id = ${requestedJobId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM screening_batches b
        WHERE b.job_id = j.id AND b.status IN ('pending', 'running')
      )
    ORDER BY j.created_at ASC
  `;
}

export async function completeScreeningJob(input: {
  jobId: string;
  candidates: ScreeningCandidate[];
  candidateTop10: ScreeningCandidate[];
  exclusions: Array<{ reason: string; count: number }>;
  incomplete: boolean;
}) {
  const sql = database();
  await sql`
    UPDATE screening_jobs SET status = 'completed', stage = '完成', generated_at = now(),
      expires_at = now() + interval '3 days', candidates = ${sql.json(input.candidates)}, watch = ${sql.json(input.candidateTop10)},
      exclusions = ${sql.json(input.exclusions)}, incomplete = ${input.incomplete}, error = NULL,
      elapsed_ms = floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint
    WHERE id = ${input.jobId} AND status = 'running'
  `;
}

export async function cancelScreeningJobRow(jobId: string) {
  const sql = database();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE screening_jobs SET status = 'cancelled', stage = '已取消',
        elapsed_ms = floor(extract(epoch FROM (now() - created_at)) * 1000)::bigint
      WHERE id = ${jobId} AND status IN ('running', 'paused')
    `;
    await tx`UPDATE screening_batches SET status = 'cancelled', lease_until = NULL, lease_token = NULL
      WHERE job_id = ${jobId} AND status IN ('pending', 'running')`;
  });
  return getScreeningJobRow(jobId);
}

export async function deleteExpiredScreeningJobs() {
  const sql = database();
  await sql`DELETE FROM screening_jobs WHERE expires_at < now()`;
}
