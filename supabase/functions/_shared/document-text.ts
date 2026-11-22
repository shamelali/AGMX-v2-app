// The original file stays in the organisation's bucket. Only extracted text is indexed.
import { getDocumentProxy, extractText } from "npm:unpdf@2.2.1"
import { unzipSync } from "npm:fflate@0.8.2"
import { SaxesParser } from "npm:saxes@6.0.0"

export type Passage = { text: string; page: number | null }
export const maxFileBytes = 8 * 1024 * 1024
const maxCharacters = 50_000
const utf8 = new TextDecoder("utf-8", { fatal: true })

function documentXml(bytes: Uint8Array): string {
  const path = "word/document.xml"
  const xml = unzipSync(bytes, { filter: file => file.name === path && file.originalSize <= maxFileBytes })[path]
  if (!xml) throw Error("This Word document cannot be read")
  const paragraphs: string[] = []
  const parser = new SaxesParser({ xmlns: true })
  let inText = false
  const wordNamespaces = [
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
  ]
  parser.on("opentag", tag => {
    if (!wordNamespaces.includes(tag.uri)) return
    if (tag.local === "t") inText = true
    if (tag.local === "tab") paragraphs.push("\t")
    if (tag.local === "br") paragraphs.push("\n")
  })
  parser.on("text", value => { if (inText) paragraphs.push(value) })
  parser.on("closetag", tag => {
    if (!wordNamespaces.includes(tag.uri)) return
    if (tag.local === "t") inText = false
    if (tag.local === "p") paragraphs.push("\n")
  })
  parser.write(utf8.decode(xml)).close()
  return paragraphs.join("")
}

export async function readPassages(file: Blob, name: string): Promise<Passage[]> {
  if (file.size > maxFileBytes) throw Error("Split documents larger than 8 MiB before indexing")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = name.toLowerCase().split(".").pop()
  let pages: Passage[]
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(bytes, { useSystemFonts: false })
    try {
      if (pdf.numPages > 80) throw Error("Split PDFs longer than 80 pages before indexing")
      const { text } = await extractText(pdf, { mergePages: false })
      pages = text.map((value, index) => ({ text: value, page: index + 1 }))
    } finally { await pdf.loadingTask.destroy() }
  } else if (ext === "docx") {
    pages = [{ text: documentXml(bytes), page: null }]
  } else if (ext === "txt" || ext === "md") {
    const value = utf8.decode(bytes)
    if (value.includes("\0")) throw Error("Choose a UTF-8 text file")
    pages = [{ text: value, page: null }]
  } else {
    throw Error("Choose a PDF with selectable text, DOCX, TXT or Markdown file")
  }
  if (pages.reduce((n, p) => n + p.text.length, 0) > maxCharacters) throw Error("Split documents longer than 50,000 characters before indexing")
  if (!pages.some(p => p.text.trim())) throw Error("No selectable text found. Apply OCR to scanned pages before indexing")
  return pages
}

export function splitPassages(pages: Passage[]) {
  const pieces: Passage[] = []
  for (const page of pages) {
    const value = page.text.trim()
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 1000, value.length)
      if (end < value.length) {
        const boundary = value.lastIndexOf(" ", end)
        if (boundary > start + 700) end = boundary
      }
      const text = value.slice(start, end).trim()
      if (text) pieces.push({ text, page: page.page })
      if (end === value.length) break
      start = end - 200
    }
  }
  return pieces
}
