import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const FETCH_TIMEOUT_MS = 25_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VocalFlow/1.0";

/** Returns the Google Docs document ID when the URL is a docs.google.com link. */
export function googleDocsId(url: string): string | null {
  const m = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m?.[1] ?? null;
}

async function fetchText(url: string): Promise<{ body: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (HTTP ${res.status}).`);
  }
  return { body: await res.text(), finalUrl: res.url || url };
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
    const res = await fetch(exportUrl, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Google Docs export failed (HTTP ${res.status}). Make sure link sharing is set to "Anyone with the link".`,
      );
    }
    const text = (await res.text()).trim();
    if (!text) throw new Error("The Google Doc appears to be empty.");
    return {
      title: "Google Doc",
      author: null,
      text,
      sourceType: "url-gdocs",
      sourceUrl: url.toString(),
    };
  }

  const { body, finalUrl } = await fetchText(url.toString());
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
