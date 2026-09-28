import pdf from "pdf-parse";

export async function extractFromPdf(
  buffer: Buffer,
): Promise<{ text: string; pages: number }> {
  const data = await pdf(buffer);
  const text = (data.text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) {
    throw new Error(
      "No extractable text found in this PDF. It may be a scanned document — try the Scan/OCR import instead.",
    );
  }
  return { text, pages: data.numpages || 0 };
}
