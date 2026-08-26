import { runEtfRotation } from "@/lib/etf-rotation-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "FORBIDDEN", message: "只允许从当前站点手动运行。" }, { status: 403 });
  }
  try {
    const result = await runEtfRotation();
    return Response.json(result, {
      status: result.status === "FAILED" ? 500 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("ETF rotation manual run failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "MANUAL_RUN_FAILED", message: "手动运行失败，请稍后重试。" }, { status: 500 });
  }
}
