import { deletePositionTrade } from "@/lib/position-plan-db";
import { PositionPlanConflictError } from "@/lib/position-plan";

function validId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    if (!validId(id) || !Number.isInteger(revision) || revision < 0) return Response.json({ message: "历史记录删除参数无效" }, { status: 400 });
    return Response.json(await deletePositionTrade(id, revision));
  } catch (error) {
    if (error instanceof PositionPlanConflictError) return Response.json({ code: "REVISION_CONFLICT", message: error.message, latest: error.latest }, { status: 409 });
    return Response.json({ code: "POSITION_HISTORY_ERROR", message: error instanceof Error ? error.message : "历史记录删除失败" }, { status: 500 });
  }
}
