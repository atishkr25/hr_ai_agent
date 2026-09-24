import { v4 as uuidv4 } from "uuid";
import type { PolicyChunk, UserRole } from "@/lib/chat/types";
import type { ExtractedPage } from "./extract";

const DEFAULT_VISIBILITY: UserRole[] = ["employee", "manager", "hr_admin"];

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHeading(value: string): boolean {
  const text = value.trim();
  if (text.length < 3 || text.length > 80) {
    return false;
  }

  // Numbered headings ("2.4 Dependents Coverage") must read like a title, so a
  // wrapped sentence that happens to start with a number ("60 days after...")
  // is not mistaken for one.
  const numbered = /^\d+(?:\.\d+)*[.)]?\s+[A-Z][^.;!?]*$/.test(text) && text.split(/\s+/).length <= 10;
  const allCaps = /^[A-Z][A-Z\s\d&/(),-]{4,}$/.test(text);
  const labelled = /^[A-Z][^.!?]{2,60}:$/.test(text);
  return numbered || allCaps || labelled;
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkExtractedPages(
  pages: ExtractedPage[],
  filename: string,
  documentId = uuidv4(),
  options?: { policyKey?: string; version?: string; visibility?: UserRole[] },
): PolicyChunk[] {
  const chunks: PolicyChunk[] = [];
  const targetCharacters = 1800;
  const overlapCharacters = 250;
  let currentText = "";
  let currentSection = "General";
  let currentStartPage = 1;
  let currentEndPage = 1;
  let chunkIndex = 0;
  const title = titleFromFilename(filename);
  const policyKey = options?.policyKey?.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const visibility = options?.visibility?.length ? options.visibility : DEFAULT_VISIBILITY;
  const version = options?.version?.trim() || new Date().toISOString().slice(0, 10);

  const flush = () => {
    const content = cleanText(currentText);
    // Only skip fragments too short to carry meaning; short policy sections
    // (a single rule under its own heading) must still be kept.
    if (content.length < 20) {
      return;
    }

    chunks.push({
      id: `${documentId}-${chunkIndex}`,
      documentId,
      chunkIndex,
      policyKey,
      version,
      isActive: true,
      title,
      section: currentSection,
      page: currentStartPage === currentEndPage
        ? String(currentStartPage)
        : `${currentStartPage}-${currentEndPage}`,
      content,
      source: filename,
      visibility: [...visibility],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    chunkIndex += 1;
  };

  const appendParagraph = (paragraph: string, pageNumber: number) => {
    if (!paragraph) {
      return;
    }

    if (!currentText) {
      currentStartPage = pageNumber;
    }
    currentEndPage = pageNumber;
    currentText += `${currentText ? "\n\n" : ""}${paragraph}`;

    if (currentText.length >= targetCharacters) {
      flush();
      // Carry a short overlap into the next chunk, starting at a word boundary.
      const tail = currentText.slice(-overlapCharacters);
      currentText = tail.slice(tail.indexOf(" ") + 1);
      currentStartPage = pageNumber;
    }
  };

  for (const page of pages) {
    const pageText = cleanText(page.text);
    if (!pageText) {
      continue;
    }

    // Lines within a paragraph are joined with spaces; blank lines and
    // heading lines end the current paragraph.
    let paragraphLines: string[] = [];
    const endParagraph = () => {
      appendParagraph(paragraphLines.join(" ").trim(), page.page);
      paragraphLines = [];
    };

    for (const rawLine of pageText.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        endParagraph();
        continue;
      }

      if (looksLikeHeading(line)) {
        endParagraph();
        flush();
        currentText = "";
        currentSection = line.replace(/:$/, "");
        currentStartPage = page.page;
        currentEndPage = page.page;
        continue;
      }

      paragraphLines.push(line);
    }
    endParagraph();
  }

  flush();
  return chunks;
}
