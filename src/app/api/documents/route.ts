import { NextRequest, NextResponse } from "next/server";
import {
  createDocument,
  listAllTags,
  listDocuments,
  type ListOptions,
} from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents?q=&tag=&sort=&archived=1 — library listing + tag list. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const sort = sp.get("sort");
    const opts: ListOptions = {
      q: sp.get("q") || undefined,
      tag: sp.get("tag") || undefined,
      sort:
        sort === "created" || sort === "title" || sort === "progress"
          ? sort
          : "updated",
      includeArchived: sp.get("archived") === "1",
    };
    return NextResponse.json({
      documents: listDocuments(opts),
      tags: listAllTags(),
    });
  } catch (err) {
    return toApiError(err);
  }
}

/** POST /api/documents — create a document from extracted/pasted text. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      text?: string;
      sourceType?: string;
      sourceUrl?: string | null;
      author?: string | null;
      voice?: string;
      stylePrompt?: string | null;
      speed?: number;
      tags?: string[];
    };
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return apiError("text is required.", 400);
    }
    const doc = createDocument({
      title: body.title,
      text: body.text,
      sourceType: (body.sourceType as never) || "paste",
      sourceUrl: body.sourceUrl,
      author: body.author,
      voice: body.voice,
      stylePrompt: body.stylePrompt,
      speed: body.speed,
      tags: body.tags,
    });
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return toApiError(err);
  }
}
