/** File bytes -> plain text. PDF, DOCX, and plain text. */
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export async function parseResumeFile(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string> {
  const name = filename.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }

  if (mime.includes("word") || name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  if (mime.startsWith("text/") || name.endsWith(".txt")) {
    return buffer.toString("utf8").trim();
  }

  throw new Error(`Unsupported file type: ${mime || filename}`);
}
