import { randomUUID } from "crypto";
import { JSDOM } from "jsdom";
import { dbAll, dbGet, dbRun, dbTransaction } from "./db";
import { createDocument, getDocumentDetail } from "./documents";
import { extractFromUrl } from "./extract";
import { isBlockedHost } from "./extract/url";
import type { DocumentSummary, Feed, FeedItem } from "./types";

export interface ParsedFeedItem {
  guid: string | null;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: ParsedFeedItem[];
}

interface FeedRow {
  id: string;
  title: string;
  url: string;
  site_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  unread_count?: number;
}

interface FeedItemRow {
  id: string;
  feed_id: string;
  guid: string | null;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  published_at: string | null;
  is_read: number;
  doc_id: string | null;
  created_at: string;
  feed_title?: string;
}

function parseDateToIso(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

function cleanSummary(raw?: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 500 ? text.slice(0, 500) + "…" : text;
}

function getTagText(parent: Element, tagName: string): string | null {
  const el = parent.getElementsByTagName(tagName)[0] as Element | undefined;
  return el?.textContent?.trim() || null;
}

function getElements(parent: Element | Document, tagName: string): Element[] {
  return Array.from(parent.getElementsByTagName(tagName)) as Element[];
}

function toFeed(row: FeedRow): Feed {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    siteUrl: row.site_url,
    description: row.description,
    unreadCount: row.unread_count !== undefined ? Number(row.unread_count) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFeedItem(row: FeedItemRow): FeedItem {
  return {
    id: row.id,
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    guid: row.guid,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary,
    publishedAt: row.published_at,
    isRead: row.is_read === 1,
    docId: row.doc_id,
    createdAt: row.created_at,
  };
}

/**
 * Parses both RSS 2.0 (<rss><channel>...<item>) and Atom 1.0 (<feed>...<entry>) feeds.
 * Extracts feed metadata and up to 30 items.
 */
export function parseFeedXml(xml: string): ParsedFeed {
  const dom = new JSDOM(xml.trim(), { contentType: "text/xml" });
  const doc = dom.window.document as unknown as Document;

  const channel = doc.getElementsByTagName("channel")[0] as Element | undefined;
  const feedEl = doc.getElementsByTagName("feed")[0] as Element | undefined;

  if (channel) {
    // RSS 2.0 / RSS 1.0
    const feedTitle = getTagText(channel, "title") || "Untitled Feed";

    // Site link: in RSS <link> can contain text, or sometimes an atom:link attribute href
    let siteUrl: string | null = null;
    const linkEls = getElements(channel, "link");
    for (const linkEl of linkEls) {
      const text = linkEl.textContent?.trim();
      const href = linkEl.getAttribute("href");
      if (text && /^https?:\/\//i.test(text)) {
        siteUrl = text;
        break;
      } else if (href && /^https?:\/\//i.test(href)) {
        siteUrl = href;
        break;
      }
    }

    const feedDesc = getTagText(channel, "description");
    const rawItems = getElements(doc, "item").slice(0, 30);
    const items: ParsedFeedItem[] = [];

    for (const item of rawItems) {
      const title = getTagText(item, "title") || "Untitled";

      let link = "";
      const itemLinks = getElements(item, "link");
      for (const linkEl of itemLinks) {
        const text = linkEl.textContent?.trim();
        const href = linkEl.getAttribute("href");
        if (text && /^https?:\/\//i.test(text)) {
          link = text;
          break;
        } else if (href && /^https?:\/\//i.test(href)) {
          link = href;
          break;
        }
      }

      const guid =
        getTagText(item, "guid") ||
        getTagText(item, "id") ||
        link ||
        null;

      const url = link || (guid && /^https?:\/\//i.test(guid) ? guid : "");
      if (!url) continue;

      const author =
        getTagText(item, "dc:creator") ||
        getTagText(item, "creator") ||
        getTagText(item, "author") ||
        getTagText(item, "itunes:author") ||
        null;

      const rawDate =
        getTagText(item, "pubDate") ||
        getTagText(item, "dc:date") ||
        getTagText(item, "published") ||
        getTagText(item, "updated") ||
        null;

      const rawSummary =
        getTagText(item, "description") ||
        getTagText(item, "content:encoded") ||
        getTagText(item, "encoded") ||
        getTagText(item, "summary") ||
        null;

      items.push({
        guid,
        title,
        url,
        author,
        summary: cleanSummary(rawSummary),
        publishedAt: parseDateToIso(rawDate),
      });
    }

    return {
      title: feedTitle,
      siteUrl,
      description: feedDesc,
      items,
    };
  }

  if (feedEl) {
    // Atom 1.0
    const feedTitle = getTagText(feedEl, "title") || "Untitled Feed";

    let siteUrl: string | null = null;
    const linkEls = getElements(feedEl, "link");
    const altLink =
      linkEls.find((l) => l.getAttribute("rel") === "alternate") ||
      linkEls.find((l) => !l.getAttribute("rel")) ||
      linkEls[0];
    if (altLink) {
      const rawSite =
        altLink.getAttribute("href") || altLink.textContent?.trim() || null;
      siteUrl =
        rawSite && /^https?:\/\//i.test(rawSite) ? rawSite : null;
    }

    const feedDesc =
      getTagText(feedEl, "subtitle") ||
      getTagText(feedEl, "tagline") ||
      null;

    const rawEntries = getElements(feedEl, "entry").slice(0, 30);
    const items: ParsedFeedItem[] = [];

    for (const entry of rawEntries) {
      const title = getTagText(entry, "title") || "Untitled";

      const entryLinks = getElements(entry, "link");
      const entryLink =
        entryLinks.find((l) => l.getAttribute("rel") === "alternate") ||
        entryLinks.find((l) => !l.getAttribute("rel")) ||
        entryLinks[0];

      // Only http(s) URLs are ever stored; javascript:/data: links and
      // non-URL ids (e.g. tag: URIs) must never become clickable hrefs.
      const rawLink =
        entryLink?.getAttribute("href") || entryLink?.textContent?.trim() || "";
      let url = /^https?:\/\//i.test(rawLink) ? rawLink : "";

      const guid =
        getTagText(entry, "id") ||
        url ||
        null;

      if (!url && guid && /^https?:\/\//i.test(guid)) {
        url = guid;
      }
      if (!url) continue;

      const authorEl = entry.getElementsByTagName("author")[0] as Element | undefined;
      const author = authorEl
        ? getTagText(authorEl, "name") || authorEl.textContent?.trim() || null
        : null;

      const rawDate =
        getTagText(entry, "published") ||
        getTagText(entry, "updated") ||
        null;

      const rawSummary =
        getTagText(entry, "summary") ||
        getTagText(entry, "content") ||
        null;

      items.push({
        guid,
        title,
        url,
        author,
        summary: cleanSummary(rawSummary),
        publishedAt: parseDateToIso(rawDate),
      });
    }

    return {
      title: feedTitle,
      siteUrl,
      description: feedDesc,
      items,
    };
  }

  throw new Error("Invalid feed format: could not find RSS channel or Atom feed.");
}

const FEED_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VoxShelf/1.0",
  Accept:
    "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
};

const FEED_FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;

/**
 * SSRF-guarded feed download: rejects non-http(s) URLs and blocked hosts,
 * enforces a 10s timeout, rejects oversized Content-Length headers, and
 * caps the actually-read body at 5MB.
 */
async function fetchFeedXml(url: string, verb: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid feed URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) feed URLs are supported.");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("Feed URL host is not allowed.");
  }

  const res = await fetch(url, {
    headers: FEED_FETCH_HEADERS,
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
  });

  if (res.url) {
    try {
      const finalUrl = new URL(res.url);
      if (isBlockedHost(finalUrl.hostname)) {
        throw new Error("Feed redirected to a disallowed host.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("disallowed")) throw e;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Failed to ${verb} feed: HTTP ${res.status} ${res.statusText}`,
    );
  }

  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > MAX_FEED_BYTES) {
    throw new Error("Feed is too large (max 5 MB).");
  }

  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error("Feed is too large (max 5 MB).");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Fetches feed XML via fetch, parses it, inserts/updates feeds row,
 * inserts feed_items (ignoring duplicates), and returns the Feed with items.
 */
export async function subscribeFeed(feedUrl: string): Promise<{ feed: Feed; items: FeedItem[] }> {
  const trimmedUrl = feedUrl.trim();
  new URL(trimmedUrl); // throws if invalid URL

  const xml = await fetchFeedXml(trimmedUrl, "fetch");
  const parsed = parseFeedXml(xml);

  const existingFeed = dbGet<{ id: string }>("SELECT id FROM feeds WHERE url = ?", trimmedUrl);
  const now = new Date().toISOString();
  let feedId: string;

  if (existingFeed) {
    feedId = existingFeed.id;
    dbRun(
      "UPDATE feeds SET title = ?, site_url = ?, description = ?, updated_at = ? WHERE id = ?",
      parsed.title,
      parsed.siteUrl,
      parsed.description,
      now,
      feedId,
    );
  } else {
    feedId = randomUUID();
    dbRun(
      "INSERT INTO feeds (id, title, url, site_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      feedId,
      parsed.title,
      trimmedUrl,
      parsed.siteUrl,
      parsed.description,
      now,
      now,
    );
  }

  dbTransaction(() => {
    for (const item of parsed.items) {
      const guidOrUrl = item.guid || item.url;
      const existing = dbGet<{ id: string }>(
        "SELECT id FROM feed_items WHERE feed_id = ? AND (guid = ? OR url = ?)",
        feedId,
        guidOrUrl,
        item.url,
      );
      if (!existing) {
        const itemId = randomUUID();
        dbRun(
          `INSERT INTO feed_items (id, feed_id, guid, title, url, author, summary, published_at, is_read, doc_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
          itemId,
          feedId,
          guidOrUrl,
          item.title,
          item.url,
          item.author,
          item.summary,
          item.publishedAt || now,
          now,
        );
      }
    }
  });

  const feedRow = dbGet<FeedRow>(
    `SELECT f.*,
      (SELECT COUNT(*) FROM feed_items fi WHERE fi.feed_id = f.id AND fi.is_read = 0) AS unread_count
     FROM feeds f WHERE f.id = ?`,
    feedId,
  );

  const items = listFeedItems({ feedId, limit: 30 });

  return {
    feed: toFeed(feedRow!),
    items,
  };
}

/**
 * Fetches feed URL, updates feed details, and inserts any new items.
 */
export async function refreshFeed(feedId: string): Promise<{ ok: boolean; added: number }> {
  const feed = dbGet<FeedRow>("SELECT * FROM feeds WHERE id = ?", feedId);
  if (!feed) {
    throw new Error("Feed not found");
  }

  const xml = await fetchFeedXml(feed.url, "refresh");
  const parsed = parseFeedXml(xml);
  const now = new Date().toISOString();

  dbRun(
    "UPDATE feeds SET title = ?, site_url = ?, description = ?, updated_at = ? WHERE id = ?",
    parsed.title,
    parsed.siteUrl,
    parsed.description,
    now,
    feedId,
  );

  let added = 0;
  dbTransaction(() => {
    for (const item of parsed.items) {
      const guidOrUrl = item.guid || item.url;
      const existing = dbGet<{ id: string }>(
        "SELECT id FROM feed_items WHERE feed_id = ? AND (guid = ? OR url = ?)",
        feedId,
        guidOrUrl,
        item.url,
      );
      if (!existing) {
        const itemId = randomUUID();
        dbRun(
          `INSERT INTO feed_items (id, feed_id, guid, title, url, author, summary, published_at, is_read, doc_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
          itemId,
          feedId,
          guidOrUrl,
          item.title,
          item.url,
          item.author,
          item.summary,
          item.publishedAt || now,
          now,
        );
        added++;
      }
    }
  });

  return { ok: true, added };
}

/**
 * Returns all feeds with calculated unread count.
 */
export function listFeeds(): Feed[] {
  const rows = dbAll<FeedRow>(`
    SELECT f.*,
      (SELECT COUNT(*) FROM feed_items fi WHERE fi.feed_id = f.id AND fi.is_read = 0) AS unread_count
    FROM feeds f
    ORDER BY f.title COLLATE NOCASE ASC
  `);
  return rows.map(toFeed);
}

/**
 * Returns feed items with feed title.
 */
export function listFeedItems(opts: {
  feedId?: string;
  unreadOnly?: boolean;
  limit?: number;
}): FeedItem[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.feedId) {
    conditions.push("fi.feed_id = ?");
    params.push(opts.feedId);
  }

  if (opts.unreadOnly) {
    conditions.push("fi.is_read = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  params.push(limit);

  const rows = dbAll<FeedItemRow>(
    `SELECT fi.*, f.title AS feed_title
     FROM feed_items fi
     JOIN feeds f ON f.id = fi.feed_id
     ${where}
     ORDER BY fi.published_at DESC, fi.created_at DESC
     LIMIT ?`,
    ...params,
  );

  return rows.map(toFeedItem);
}

/**
 * Fetches full article content via extractFromUrl(item.url),
 * creates a document in documents via createDocument,
 * marks feed_items.is_read = 1 and feed_items.doc_id = doc.id,
 * and returns the created document.
 */
export async function importFeedItem(itemId: string): Promise<DocumentSummary> {
  const item = dbGet<FeedItemRow>("SELECT * FROM feed_items WHERE id = ?", itemId);
  if (!item) {
    throw new Error("Feed item not found");
  }

  // If already imported, return existing document
  if (item.doc_id) {
    const existingDoc = dbGet<{ id: string }>("SELECT id FROM documents WHERE id = ?", item.doc_id);
    if (existingDoc) {
      const doc = getDocumentDetail(item.doc_id);
      if (doc) return doc;
    }
  }

  let text = "";
  let title = item.title;
  let author = item.author;

  try {
    const extracted = await extractFromUrl(item.url);
    text = extracted.text;
    if (extracted.title) title = extracted.title;
    if (extracted.author) author = extracted.author;
  } catch (err) {
    // If extraction fails (e.g. JS-only or paywalled), fallback to item summary if sufficient
    if (item.summary && item.summary.trim().length >= 80) {
      text = item.summary.trim();
    } else {
      throw err;
    }
  }

  const doc = createDocument({
    title,
    author,
    text,
    sourceType: "url-article",
    sourceUrl: item.url,
    tags: ["rss"],
  });

  dbRun("UPDATE feed_items SET is_read = 1, doc_id = ? WHERE id = ?", doc.id, itemId);

  return doc;
}

/**
 * Marks a feed item as read or unread.
 */
export function markFeedItemRead(itemId: string, isRead = true): void {
  dbRun("UPDATE feed_items SET is_read = ? WHERE id = ?", isRead ? 1 : 0, itemId);
}

/**
 * Deletes feed and its items (cascades).
 */
export function deleteFeed(feedId: string): void {
  dbRun("DELETE FROM feed_items WHERE feed_id = ?", feedId);
  dbRun("DELETE FROM feeds WHERE id = ?", feedId);
}
