import JSZip from "jszip";

function htmlToText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<\/?(h1|h2|h3|h4|h5|p|div|li|tr|br|hr|section|article)[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function extractFromEpub(
  buffer: Buffer,
): Promise<{ title: string; author: string | null; text: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("Invalid EPUB: META-INF/container.xml missing.");
  const containerXml = await containerFile.async("string");
  const opfPath = /rootfile[^>]*full-path="([^"]+)"/i.exec(containerXml)?.[1];
  if (!opfPath) throw new Error("Invalid EPUB: OPF package path not found.");
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("Invalid EPUB: OPF package missing.");
  const opf = await opfFile.async("string");

  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const title =
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() || "Untitled EPUB";
  const author =
    /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() || null;

  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item[^>]*>/gi)) {
    const tag = m[0];
    const id = /id="([^"]+)"/i.exec(tag)?.[1];
    const href = /href="([^"]+)"/i.exec(tag)?.[1];
    const media = /media-type="([^"]+)"/i.exec(tag)?.[1] ?? "";
    if (id && href && /x?html/i.test(media)) manifest.set(id, href);
  }
  const spine: string[] = [];
  for (const m of opf.matchAll(/<itemref[^>]*idref="([^"]+)"[^>]*>/gi)) {
    const href = manifest.get(m[1]);
    if (href) spine.push(href);
  }
  if (spine.length === 0) {
    // Fallback: every xhtml file in the archive, sorted.
    const all = [...manifest.values()].sort();
    spine.push(...all);
  }

  const chapters: string[] = [];
  for (const href of spine) {
    const file = zip.file(decodeURIComponent(base + href));
    if (!file) continue;
    const html = await file.async("string");
    const text = htmlToText(html);
    if (text) chapters.push(text);
  }
  const text = chapters.join("\n\n").trim();
  if (!text) throw new Error("No readable chapters found in this EPUB.");
  return { title, author, text };
}
