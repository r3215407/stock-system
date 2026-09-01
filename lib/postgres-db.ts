import "server-only";

import postgres from "postgres";

type DatabaseGlobal = typeof globalThis & {
  glacierPostgres?: ReturnType<typeof postgres>;
};

const databaseGlobal = globalThis as DatabaseGlobal;

function isTransientConnectionError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return ["CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "EPIPE", "EMAXCONNSESSION", "53300"].includes(code)
    || /CONNECTION_(?:CLOSED|DESTROYED)|ECONNRESET|broken pipe|max clients reached/i.test(message);
}

export function database() {
  // PgBouncer transaction mode supports explicit transactions when prepared statements are disabled.
  const url = process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error("缺少 POSTGRES_URL，PostgreSQL 持久化不可用。");
  if (!databaseGlobal.glacierPostgres) {
    databaseGlobal.glacierPostgres = postgres(url, {
      max: 2,
      prepare: false,
      idle_timeout: 10,
      connect_timeout: 10,
      max_lifetime: 300,
      keep_alive: 30,
    });
  }
  return databaseGlobal.glacierPostgres;
}

export async function withDatabaseRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error;
    // Postgres.js 会把关闭的 socket 移出池；下一条查询会懒创建新连接。
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    return operation();
  }
}
