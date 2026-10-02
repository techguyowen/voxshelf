import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";
import {
  downloadDocsFromPeer,
  fetchRemoteLibrary,
  getSelection,
  setSelection,
} from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/download — { docIds?, folderIds? } pulls explicit docs
 * (and whole folders) from the peer into this device and extends the
 * selective pick. Works in either mode.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { docIds?: unknown; folderIds?: unknown };
    const cleanIds = (v: unknown): string[] =>
      Array.isArray(v)
        ? [...new Set(v)].filter(
            (id): id is string => typeof id === "string" && !!id && id.length <= 128,
          )
        : [];
    const docIds = cleanIds(body.docIds).slice(0, 200);
    const folderIds = cleanIds(body.folderIds).slice(0, 200);
    if (docIds.length === 0 && folderIds.length === 0) {
      return apiError("Nothing to download.", 400);
    }
    const ids = [...docIds];
    if (folderIds.length > 0) {
      const lib = await fetchRemoteLibrary();
      const inFolders = new Set(folderIds);
      for (const d of lib.documents) {
        if (d.folderId && inFolders.has(d.folderId) && !ids.includes(d.id)) {
          ids.push(d.id);
        }
      }
      const sel = getSelection();
      const known = new Set(sel.folders);
      for (const fid of folderIds) {
        if (!known.has(fid)) {
          known.add(fid);
          sel.folders.push(fid);
        }
      }
      setSelection(sel);
    }
    const result = await downloadDocsFromPeer(ids.slice(0, 200));
    return NextResponse.json({ ...result, foldersAdded: folderIds });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Request failed.", 502);
  }
}
