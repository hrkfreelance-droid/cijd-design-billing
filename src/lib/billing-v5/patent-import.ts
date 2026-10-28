/**
 * Read only candidate fields from a Cambodia Patent Tax certificate.
 * This function never creates a customer or assumes a translated address.
 */
export interface PatentCandidate {
  enterpriseName: string;
  tin: string;
  patentYear: string;
  ownerName: string;
  companyNameKm: string;
  addressKm: string;
}

const firstMatch = (text: string, re: RegExp) => (text.match(re)?.[1] ?? "").trim();
const normalizeName = (name: string) => name.replace(/\s+/g, " ").trim();
export const normalizedTin = (tin: string) => tin.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseCambodianPatent(rawText: string): PatentCandidate {
  const lines = rawText
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const compact = lines.join(" ").replace(/\s+/g, " ");
  // PDF.js preserves line breaks in many certificates, while font ligatures
  // can split "Identification" into "Identi fi cation". Prefer line boundaries
  // to avoid swallowing the next field into the company's legal name.
  const nameLine = lines.find((line) => /^Enterprise['’]s\s+name\s*[:：]/i.test(line)) ?? "";
  const englishName =
    firstMatch(nameLine, /^Enterprise['’]s\s+name\s*[:：]\s*(.+?)(?=\s+Tax\s+Identi\s*fi\s*cation\s+Number\b|$)/i) ||
    firstMatch(compact, /Enterprise['’]s\s+name\s*[:：]\s*(.+?)(?=\s+Tax\s+Identi\s*fi\s*cation\s+Number\b|\s+Registered\s+at\b|$)/i) ||
    firstMatch(compact, /Enterprise\s+name\s*[:：]\s*(.+?)(?=\s+Tax\s+Identi\s*fi\s*cation\s+Number\b|$)/i);
  const tin = (compact.match(/\bK\d{3}\s*[-–]\s*\d{9}\b/i)?.[0] ?? "").replace(/\s/g, "").replace("–", "-").toUpperCase();
  const owner = firstMatch(compact, /Owner['’]s\s+name\s*[:：]\s*(.+?)(?=\s+Nationality\s*[:：]|\s+Phnom\s+Penh\b|$)/i);
  const year = firstMatch(compact, /PATENT\s+TAX\s+(20\d{2})\b/i);

  // Khmer text can be split between glyphs by PDF text extraction.
  // Only take the value when the original line has an unambiguous label.
  const kmNameLine = lines.find((line) => /ឈ្មោ\s*ះសហគ្រាស\s*[:：]/u.test(line)) ?? "";
  const kmAddressLine = lines.find((line) => /អាសយដ្ឋា\s*នសហគ្រាស\s*[:：]/u.test(line)) ?? "";
  const kmName = firstMatch(kmNameLine, /ឈ្មោ\s*ះសហគ្រាស\s*[:：]\s*(.+)/u);
  const kmAddress = firstMatch(kmAddressLine, /អាសយដ្ឋា\s*នសហគ្រាស\s*[:：]\s*(.+)/u);
  return {
    enterpriseName: normalizeName(englishName),
    tin,
    patentYear: year,
    ownerName: normalizeName(owner),
    companyNameKm: kmName,
    addressKm: kmAddress,
  };
}
