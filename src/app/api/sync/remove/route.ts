import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { deleteDocumentLocal, deleteFolderLocal } from "@/lib/documents";
import { apiError, toApiError } from "@/lib/http";
import { getSelection, localDocsInFolders, setSelection } from "@/lib/syncWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/remove — { docIds?, folderIds? } deletes from THIS device
 * only (no tombstones: the peer keeps everything) and shrinks the pick.
 * Folders with no remaining local docs are removed locally too.
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
    const docIds = cleanIds(body.docIds);
    const folderIds = cleanIds(body.folderIds);
    if (docIds.length === 0 && folderIds.length === 0) {
      return apiError("Nothing to remove.", 400);
    }
    const ids = new Set([...docIds, ...localDocsInFolders(folderIds)]);
    const removed: string[] = [];
    for (const id of ids) {
      if (deleteDocumentLocal(id)) removed.push(id);
    }
    const removedFolders: string[] = [];
    for (const fid of folderIds) {
      const remaining =
        dbGet<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE folder_id = ?", fid)?.n ?? 0;
      if (remaining === 0 && deleteFolderLocal(fid)) removedFolders.push(fid);
    }
    const sel = getSelection();
    const gone = new Set(ids);
    setSelection({
      docs: sel.docs.filter((id) => !gone.has(id)),
      folders: sel.folders.filter((id) => !folderIds.includes(id)),
    });
    return NextResponse.json({ removed, removedFolders });
  } catch (err) {
    return toApiError(err);
  }
}
