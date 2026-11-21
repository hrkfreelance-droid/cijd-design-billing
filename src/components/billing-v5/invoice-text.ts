/** Read the existing, rendered invoice rather than maintaining a second template.
 * Table cells remain tab-separated, so pasting into a spreadsheet keeps columns.
 * Empty ruled rows are omitted. Labels, dates and bank details are the document's.
 */
export function invoiceDocumentText(root: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "TR") {
      const cells = Array.from(node.children).map((cell) => read(cell).trim().replace(/\n+/g, " · "));
      // The document prints a dash in both amount cells on each empty ruled row.
      if (!cells[0] && !cells[1]) return "";
      return `${cells.join("\t")}\n`;
    }
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes).map(read).join("");
    if (node.matches("p, header, section, footer, article, .company-title > *, .invoice-title > *, .invoice-signatures span, .invoice-contract-references h3, .invoice-contract-summary h2, .cancelled-watermark, .draft-watermark")) return `${text.trim()}\n`;
    if (node.matches(".accounting")) return text.replace(/\s+/g, "");
    if (node.matches(".invoice-contract-references small")) return `\n${text.trim()}\n`;
    if (node.matches(".line-project, dt, dd, .bank-accounts b, .invoice-signatures b")) return `${text.trim()}\n`;
    if (node.matches("th small")) return ` / ${text}`;
    return text;
  };
  return read(root).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
