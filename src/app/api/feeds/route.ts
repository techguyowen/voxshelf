import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  deleteFeed,
  importFeedItem,
  listFeedItems,
  listFeeds,
  markFeedItemRead,
  refreshFeed,
  subscribeFeed,
} from "@/lib/feeds";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/feeds?feedId=&unread=1
 * Returns { feeds, items }
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  try {
    const sp = req.nextUrl.searchParams;
    const feedId = sp.get("feedId") || undefined;
    const unread = sp.get("unread") === "1" || sp.get("unread") === "true";
    const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;

    const feeds = listFeeds();
    const items = listFeedItems({
      feedId,
      unreadOnly: unread,
      limit,
    });

    return NextResponse.json({ feeds, items });
  } catch (err) {
    return toApiError(err);
  }
}

/**
 * POST /api/feeds
 * Handles actions: subscribe, refresh, import, delete, mark-read
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      action?: string;
      url?: string;
      feedId?: string;
      itemId?: string;
      isRead?: boolean;
    };

    const action = body?.action;

    switch (action) {
      case "subscribe": {
        if (!body.url || typeof body.url !== "string") {
          return apiError("A feed URL is required to subscribe.", 400);
        }
        const result = await subscribeFeed(body.url);
        return NextResponse.json(result, { status: 201 });
      }

      case "refresh": {
        if (!body.feedId || typeof body.feedId !== "string") {
          return apiError("feedId is required to refresh.", 400);
        }
        const result = await refreshFeed(body.feedId);
        return NextResponse.json(result);
      }

      case "import": {
        if (!body.itemId || typeof body.itemId !== "string") {
          return apiError("itemId is required to import.", 400);
        }
        const doc = await importFeedItem(body.itemId);
        return NextResponse.json(doc, { status: 201 });
      }

      case "delete": {
        if (!body.feedId || typeof body.feedId !== "string") {
          return apiError("feedId is required to delete.", 400);
        }
        deleteFeed(body.feedId);
        return NextResponse.json({ ok: true });
      }

      case "mark-read": {
        if (!body.itemId || typeof body.itemId !== "string") {
          return apiError("itemId is required to mark read.", 400);
        }
        markFeedItemRead(body.itemId, body.isRead !== false);
        return NextResponse.json({ ok: true });
      }

      default:
        return apiError(`Unsupported feed action: '${action}'.`, 400);
    }
  } catch (err) {
    return toApiError(err);
  }
}
