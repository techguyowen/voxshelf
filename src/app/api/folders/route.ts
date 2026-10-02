import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createFolder, listFolders } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/folders */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ folders: listFolders() });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/folders — { name, color? } */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { name?: string; color?: string };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return apiError("name is required.", 400);
    }
    const folder = createFolder(body.name, body.color);
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}
