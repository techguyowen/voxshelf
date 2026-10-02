import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const FETCH_TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VoxShelf/1.0";

/** Hosts the URL importer must never fetch (SSRF guard). */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "metadata.google.internal" || host === "metadata.goog") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (v4.slice(1).some((o) => Number(o) > 255)) return true;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (host.includes(":")) {
    // IPv6 literal: allow only global unicast (2000::/3).
    return !(host.startsWith("2") || host.startsWith("3"));
  }
  return false;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error("Page is too large (max 10 MB).");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Fetch with manual redirect following so every hop is re-validated.
 * (DNS rebinding between check and fetch is out of scope for a
 * single-user LAN app, but literals and redirects are fully blocked.)
 */
async function fetchTextGuarded(url: string): Promise<{ body: string; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error("That doesn't look like a valid URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported.");
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new Error("URL host is not allowed.");
    }
    const res = await fetch(current, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch URL (HTTP ${res.status}).`);
    }
    return { body: await readCapped(res), finalUrl: current };
  }
  throw new Error("Too many redirects.");
}

/** Returns the Google Docs document ID when the URL is a docs.google.com link. */
export function googleDocsId(url: string): string | null {
  const m = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m?.[1] ?? null;
}

export interface UrlExtractResult {
  title: string;
  author: string | null;
  text: string;
  sourceType: "url-article" | "url-gdocs";
  sourceUrl: string;
}

export async function extractFromUrl(rawUrl: string): Promise<UrlExtractResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }

  const docsId = googleDocsId(url.toString());
  if (docsId) {
    const exportUrl = `https://docs.google.com/document/d/${docsId}/export?format=txt`;
    let text: string;
    try {
      text = (await fetchTextGuarded(exportUrl)).body.trim();
    } catch (err) {
      if (err instanceof Error && /HTTP \d+/.test(err.message)) {
        throw new Error(
          `${err.message} Make sure link sharing is set to "Anyone with the link".`,
        );
      }
      throw err;
    }
    if (!text) throw new Error("The Google Doc appears to be empty.");
    return {
      title: "Google Doc",
      author: null,
      text,
      sourceType: "url-gdocs",
      sourceUrl: url.toString(),
    };
  }

  const { body, finalUrl } = await fetchTextGuarded(url.toString());
  const dom = new JSDOM(body, { url: finalUrl });
  try {
    const reader = new Readability(dom.window.document as object, {
      keepClasses: false,
    });
    const article = reader.parse();
    const text = (article?.textContent || "").replace(/[ \t]+\n/g, "\n").trim();
    if (!article || !text || text.length < 100) {
      throw new Error(
        "Could not extract article content from this page. It may be paywalled, a PDF, or JavaScript-rendered.",
      );
    }
    return {
      title: article.title?.trim() || new URL(finalUrl).hostname,
      author: article.byline?.trim() || null,
      text,
      sourceType: "url-article",
      sourceUrl: finalUrl,
    };
  } finally {
    dom.window.close?.();
  }
}
