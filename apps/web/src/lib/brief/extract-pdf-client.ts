/** Per-page text for a PDF, read in the browser: only the text crosses the wire, so the server action's body limit stops depending on the file's size. */
export async function extractPdfPagesInBrowser(file: File): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const buffer = await file.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
