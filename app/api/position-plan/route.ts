import { getPositionPlan, updatePositionPlan } from "@/lib/position-plan-db";
import { PositionPlanConflictError } from "@/lib/position-plan";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof PositionPlanConflictError) return Response.json({ code: "REVISION_CONFLICT", message: error.message, latest: error.latest }, { status: 409 });
  const message = error instanceof Error ? error.message : "模拟盘读取失败";
  return Response.json({ code: "POSITION_PLAN_ERROR", message }, { status: 500 });
}

export async function GET() {
  try {
    return Response.json(await getPositionPlan(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 0) return Response.json({ message: "revision 无效" }, { status: 400 });
    const accountEquity = body.accountEquity === undefined ? undefined : Number(body.accountEquity);
    const currentOpenRisk = body.currentOpenRisk === undefined ? undefined : Number(body.currentOpenRisk);
    if (accountEquity !== undefined && (!Number.isFinite(accountEquity) || accountEquity <= 0)) return Response.json({ message: "账户净值必须大于 0" }, { status: 400 });
    if (currentOpenRisk !== undefined && (!Number.isFinite(currentOpenRisk) || currentOpenRisk < 0)) return Response.json({ message: "当前风险不能小于 0" }, { status: 400 });
    return Response.json(await updatePositionPlan({ revision, accountEquity, currentOpenRisk, threeConsecutiveStops: typeof body.threeConsecutiveStops === "boolean" ? body.threeConsecutiveStops : undefined }));
  } catch (error) {
    return errorResponse(error);
  }
}
