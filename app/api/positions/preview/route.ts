import { calculatePositionPlan, type PositionPlanInput } from "@/lib/positions";

export async function POST(request: Request) {
  let body: PositionPlanInput;
  try { body = await request.json() as PositionPlanInput; }
  catch { return Response.json({ error: { code: "INVALID_BODY", message: "请求内容必须是有效 JSON。" } }, { status: 400 }); }
  if (!Number.isFinite(body.accountEquity) || body.accountEquity <= 0 || !Array.isArray(body.candidates)) {
    return Response.json({ error: { code: "INVALID_INPUT", message: "账户净值必须大于0，且候选列表格式有效。" } }, { status: 400 });
  }
  return Response.json({ data: calculatePositionPlan(body) }, { headers: { "Cache-Control": "no-store" } });
}
