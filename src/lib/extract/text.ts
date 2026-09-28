// Plain-text / Markdown extraction.

export function titleFromFilename(filename: string): string {
  const base = filename.split("/").pop() || filename;
  return base.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

export function extractFromText(
  buffer: Buffer,
  filename: string,
): { title: string; text: string } {
  let text = buffer
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  // Strip fenced code blocks markers but keep content; strip images, keep alt text.
  text = text
    .replace(/```[a-zA-Z0-9_-]*\n/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  let title = titleFromFilename(filename);
  const heading = /^#{1,3}\s+(.+)$/m.exec(text);
  if (heading) title = heading[1].trim().slice(0, 200);
  else {
    const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean);
    if (firstLine && firstLine.length <= 120) title = firstLine;
  }
  return { title, text };
}
