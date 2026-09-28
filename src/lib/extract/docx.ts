import { extractRawText } from "mammoth";

export async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await extractRawText({ buffer });
  const text = (result.value || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No readable text found in this DOCX file.");
  return text;
}
