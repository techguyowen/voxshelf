import { NextRequest, NextResponse } from "next/server";
import { cleanupText } from "@/lib/gemini";
import { apiError, toApiError } from "@/lib/http";
import { countWords, splitSentences } from "@/lib/text";
import type { ExtractResult, SourceType } from "@/lib/types";
import { extractFromDocx } from "@/lib/extract/docx";
import { extractFromEpub } from "@/lib/extract/epub";
import { runOcr, type OcrMode } from "@/lib/extract/ocr";
import { extractFromPdf } from "@/lib/extract/pdf";
import { extractFromText, titleFromFilename } from "@/lib/extract/text";
import { extractFromUrl } from "@/lib/extract/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return (m?.[1] || "").toLowerCase();
}

/**
 * POST /api/extract — multipart form with either `file` or `url`.
 * Optional fields: cleanup ("1"), ocrMode ("auto"|"local"|"ai"), key.
 * Returns extracted { title, author, text, ... } without saving.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const key = asString(form.get("key")) || undefined;
    const cleanup = form.get("cleanup") === "1" || form.get("cleanup") === "true";
    const ocrMode = (asString(form.get("ocrMode")) || "auto") as OcrMode;

    const url = asString(form.get("url"));
    const file = form.get("file");

    let title = "";
    let author: string | null = null;
    let text = "";
    let sourceType: SourceType = "paste";
    let sourceUrl: string | null = null;
    let pages: number | undefined;

    if (file instanceof File) {
      if (file.size === 0) return apiError("The uploaded file is empty.", 400);
      if (file.size > MAX_FILE_BYTES) {
        return apiError("File is too large (max 50 MB).", 400);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = extOf(file.name);
      const mime = file.type || "";

      if (ext === "pdf" || mime === "application/pdf") {
        const out = await extractFromPdf(buffer);
        text = out.text;
        pages = out.pages;
        title = titleFromFilename(file.name);
        sourceType = "file-pdf";
      } else if (ext === "docx") {
        text = await extractFromDocx(buffer);
        title = titleFromFilename(file.name);
        sourceType = "file-docx";
      } else if (ext === "doc") {
        return apiError(
          "Legacy .doc files are not supported. Open it in Word/Docs and save as .docx first.",
          400,
        );
      } else if (ext === "epub") {
        const out = await extractFromEpub(buffer);
        title = out.title;
        author = out.author;
        text = out.text;
        sourceType = "file-epub";
      } else if (ext === "md" || ext === "markdown" || ext === "txt" || ext === "text") {
        const out = extractFromText(buffer, file.name);
        title = out.title;
        text = out.text;
        sourceType = ext === "txt" || ext === "text" ? "file-txt" : "file-md";
      } else if (IMAGE_EXTS.has(ext) || mime.startsWith("image/")) {
        const out = await runOcr(buffer, mime || "image/png", ocrMode, key);
        text = out.text;
        title = titleFromFilename(file.name);
        sourceType = "file-image";
      } else {
        // Last resort: try plain text.
        try {
          const out = extractFromText(buffer, file.name);
          if (!out.text) throw new Error("empty");
          title = out.title;
          text = out.text;
          sourceType = "file-txt";
        } catch {
          return apiError(
            `Unsupported file type ".${ext || "?"}". Supported: PDF, EPUB, DOCX, TXT, MD, images.`,
            400,
          );
        }
      }
    } else if (url) {
      const out = await extractFromUrl(url);
      title = out.title;
      author = out.author;
      text = out.text;
      sourceType = out.sourceType;
      sourceUrl = out.sourceUrl;
    } else {
      return apiError("Provide a `file` or a `url`.", 400);
    }

    text = text.trim();
    if (!text) return apiError("No readable text found.", 400);

    if (cleanup) {
      text = await cleanupText(text, key);
    }

    const result: ExtractResult = {
      title: title || "Untitled",
      author,
      text,
      wordCount: countWords(text),
      sentenceCount: splitSentences(text).length,
      sourceType,
      sourceUrl,
      ...(pages !== undefined ? { pages } : {}),
    };
    return NextResponse.json(result);
  } catch (err) {
    return toApiError(err);
  }
}

function asString(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}
