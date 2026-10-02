import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { explainSelection } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/ai/explain — { selection, context?, key? } */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as {
      selection?: string;
      context?: string;
      key?: string;
    };
    const selection = body.selection?.trim() || "";
    if (!selection) return apiError("selection is required.", 400);
    if (selection.length > 2000) {
      return apiError("Selection is too long (max 2000 characters).", 400);
    }
    const explanation = await explainSelection(
      selection,
      body.context?.trim() || "",
      body.key,
    );
    return NextResponse.json({ explanation });
  } catch (err) {
    return toApiError(err);
  }
}
