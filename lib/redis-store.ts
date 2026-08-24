import { createClient, type RedisClientType } from "redis";

type RedisGlobal = typeof globalThis & {
  glacierRedisClientPromise?: Promise<RedisClientType>;
};

const redisGlobal = globalThis as RedisGlobal;

function redisUrl() {
  return process.env.REDIS_URL ?? process.env.KV_URL ?? null;
}

function restConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function isRedisConfigured() {
  return Boolean(redisUrl() || restConfig());
}

async function getRedisClient() {
  const url = redisUrl();
  if (!url) return null;
  if (!redisGlobal.glacierRedisClientPromise) {
    const client = createClient({ url });
    client.on("error", (error) => console.error("Redis connection error", error));
    redisGlobal.glacierRedisClientPromise = client.connect()
      .then(() => client as RedisClientType)
      .catch((error) => {
        redisGlobal.glacierRedisClientPromise = undefined;
        throw error;
      });
  }
  return redisGlobal.glacierRedisClientPromise;
}

async function restCommand<T>(command: Array<string | number>) {
  const config = restConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Redis REST 接口返回 ${response.status}`);
  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error(`Redis REST：${payload.error}`);
  return payload.result ?? null;
}

export async function redisGet(key: string) {
  const client = await getRedisClient();
  if (client) return client.get(key);
  return restCommand<string>(["GET", key]);
}

export async function redisSet(key: string, value: string, ttlSeconds: number) {
  const client = await getRedisClient();
  if (client) {
    await client.set(key, value, { EX: ttlSeconds });
    return;
  }
  await restCommand(["SET", key, value, "EX", ttlSeconds]);
}

export async function redisDelete(key: string) {
  const client = await getRedisClient();
  if (client) {
    await client.del(key);
    return;
  }
  await restCommand(["DEL", key]);
}

