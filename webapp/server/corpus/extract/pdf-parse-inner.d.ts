// Inner-module ambient declaration — `@types/pdf-parse` only covers the
// package root but we import the inner file to skip pdf-parse's debug init.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(buf: Buffer | Uint8Array, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
