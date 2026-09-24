import mammoth from "mammoth";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

export type ExtractedPage = {
  page: number;
  text: string;
  ocr: boolean;
};

export type ExtractedDocument = {
  pages: ExtractedPage[];
  ocrUsed: boolean;
};

type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
};

function ensurePromiseWithResolvers(): void {
  const promiseConstructor = Promise as unknown as PromiseConstructorWithResolvers;
  if (promiseConstructor.withResolvers) {
    return;
  }

  promiseConstructor.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });

    return { promise, resolve, reject };
  };
}

async function loadPdf(buffer: Buffer) {
  // pdfjs-dist v6 uses Promise.withResolvers, which is missing in some
  // Node runtimes used to run the Next.js development server.
  ensurePromiseWithResolvers();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
  }).promise;
}

async function extractPdfTextPages(buffer: Buffer): Promise<ExtractedPage[]> {
  const pdf = await loadPdf(buffer);
  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    // pdf.js emits explicit whitespace items and flags line ends, so joining
    // without separators keeps words intact and preserves line structure,
    // which the chunker uses to detect section headings.
    const text = content.items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();

    pages.push({ page: pageNumber, text, ocr: false });
  }

  return pages;
}

async function ocrPdfPages(buffer: Buffer, pageNumbers: number[]): Promise<Map<number, string>> {
  const pdf = await loadPdf(buffer);
  const worker = await createWorker("eng");
  const results = new Map<number, string>();

  try {
    for (const pageNumber of pageNumbers) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({
        canvas: null,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const recognized = await worker.recognize(canvas.toBuffer("image/png"));
      results.set(pageNumber, recognized.data.text.replace(/[ \t]+/g, " ").trim());
    }
  } finally {
    await worker.terminate();
  }

  return results;
}

export async function extractPdfDocument(buffer: Buffer): Promise<ExtractedDocument> {
  const pages = await extractPdfTextPages(buffer);
  const totalText = pages.map((page) => page.text).join(" ").trim();
  const sparsePages = pages.filter((page) => page.text.length < 40).map((page) => page.page);
  const pagesToOcr = totalText.length < 100
    ? pages.map((page) => page.page)
    : sparsePages;

  if (!pagesToOcr.length) {
    return { pages, ocrUsed: false };
  }

  try {
    const recognized = await ocrPdfPages(buffer, pagesToOcr);
    for (const page of pages) {
      const text = recognized.get(page.page);
      if (text) {
        page.text = text;
        page.ocr = true;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[ingest] OCR failed; retaining available PDF text:", errorMsg);
  }

  return {
    pages,
    ocrUsed: pages.some((page) => page.ocr),
  };
}

export async function extractDocxDocument(buffer: Buffer): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    pages: [{ page: 1, text: result.value.trim(), ocr: false }],
    ocrUsed: false,
  };
}
