import { runEtfRotation } from "@/lib/etf-rotation-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await runEtfRotation();
    return Response.json(result, { status: result.status === "FAILED" ? 500 : 200 });
  } catch (error) {
    console.error("ETF rotation cron entry failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "CRON_ENTRY_FAILED" }, { status: 500 });
  }
}
