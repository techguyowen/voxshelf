// Minimal ambient declarations for untyped CJS dependencies.

declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }
  function pdf(
    buffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdf;
}

declare module "mammoth" {
  export interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(input: {
    buffer?: Buffer;
    path?: string;
  }): Promise<MammothResult>;
  export function convertToHtml(
    input: { buffer?: Buffer; path?: string },
    options?: Record<string, unknown>,
  ): Promise<MammothResult>;
}

declare module "@mozilla/readability" {
  export interface ReadabilityArticle {
    title: string;
    content: string;
    textContent: string;
    length: number;
    excerpt: string;
    byline?: string;
    dir?: string;
    siteName?: string;
    lang?: string;
  }
  export class Readability {
    constructor(doc: object, options?: Record<string, unknown>);
    parse(): ReadabilityArticle | null;
  }
}

declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: Record<string, unknown>);
    window: {
      document: object;
      close?: () => void;
    };
    serialize(): string;
  }
}
