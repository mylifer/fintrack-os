import { unzipSync, strFromU8 } from 'fflate'

/* ── Minimal .xlsx okuyucu ────────────────────────────────────────────────────
   Banka dökümleri çoğunlukla Excel olarak iner. .xlsx bir ZIP içindeki XML
   dosyalarıdır; burada yalnızca İLK sayfanın hücre DEĞERLERİ okunur (biçim,
   formül, birleşik hücre yok) ve CSV ayrıştırıcısıyla aynı string[][] ızgarası
   döner — sütun eşleştirme ve doğrulama iki biçimde de aynı yoldan geçer.

   Tarih hücreleri Excel'de seri sayı olarak durur (46290 = 2026-09-25);
   çevirisi parseDate'te yapılır (bkz. csv.ts). Eski ikili .xls (BIFF) okunmaz:
   o biçim için ağır bir kütüphane gerekir — kullanıcıdan .xlsx ya da CSV
   olarak kaydetmesi istenir.

   XML regex ile okunur (DOMParser yok): Excel'in ürettiği sheet/sharedStrings
   XML'i düzenlidir ve bu modül hem tarayıcıda hem Node'da (testler) çalışmalı. */

/** Dosyanın ZIP (xlsx) olup olmadığı — ilk baytlar "PK\x03\x04". */
export function isZip(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
  return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/** Eski ikili Excel (.xls, OLE2) imzası: D0 CF 11 E0. */
export function isLegacyXls(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
  return b.length === 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** <si>…</si> ya da <is>…</is> içindeki tüm <t> parçalarını birleştirir
 *  (zengin metin birden çok <r><t> taşıyabilir). */
function textRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1]
  return decodeXml(out)
}

/** "BC12" → 54 (0 tabanlı sütun indeksi). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : ''
  const rid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  if (rid) {
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map(m => m[1])
      .find(attrs => attrs.includes(`Id="${rid}"`))
    const target = rel?.match(/Target="([^"]+)"/)?.[1]
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
      if (files[path]) return path
    }
  }
  const fallback = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0]
  if (!fallback) throw new Error('Excel dosyasında sayfa bulunamadı.')
  return fallback
}

/** İlk sayfanın hücrelerini satır satır string ızgarası olarak döndürür. Boş
 *  hücreler '' olur; tamamen boş satırlar atlanır. */
export function readXlsxRows(bytes: ArrayBuffer): string[][] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(bytes))
  } catch {
    throw new Error('Excel dosyası açılamadı (bozuk ya da şifreli olabilir).')
  }

  const shared: string[] = []
  const ss = files['xl/sharedStrings.xml']
  if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]))

  const sheet = strFromU8(files[firstSheetPath(files)])
  const rows: string[][] = []
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const inner = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1]
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const idx = ref ? columnIndex(ref) : row.length
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = raw !== undefined ? shared[Number(raw)] ?? '' : ''
      else if (type === 'inlineStr') value = textRuns(inner)
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      else value = raw !== undefined ? decodeXml(raw) : ''
      while (row.length < idx) row.push('')
      row[idx] = value.trim()
    }
    if (row.some(v => v !== '')) rows.push(row)
  }
  if (rows.length === 0) throw new Error('Excel sayfası boş.')
  return rows
}
