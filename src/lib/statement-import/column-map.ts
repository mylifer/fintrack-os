import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Tanınmayan ekstre: elle sütun eşleme ────────────────────────────────────
   Biçimi tanınmayan PDF ya da CSV/XLSX dökümü önce bir TABLOYA çevrilir
   (pdfToTable / gridToTable), kullanıcı hangi sütunun Tarih / Açıklama / Tutar
   (ya da Borç–Alacak) olduğunu seçer (guessMapping önerir) ve buildMappedStatement
   sonucu banka ayrıştırıcılarıyla AYNI ParsedStatement'a çevirir: önizleme,
   sınıflandırma, mükerrer kontrolü, taslak ve kayıt hattı değişmeden çalışır.

   Bu modül SAFtır (DOM, localStorage yok); eşleme hafızası mapping-memory.ts'te.

   İşaret kuralı (statement.ts ile aynı): StatementLine.amount + = kart borcu /
   hesaptan çıkan para, − = ödeme, iade / hesaba giren para. */

export interface StatementTable {
  source: 'pdf' | 'sheet'
  /** Sütun başlıkları; başlık satırı bulunamazsa "Sütun N" */
  headers: string[]
  /** Başlık satırı dosyada gerçekten var mıydı (imza bunu kullanır) */
  hasHeader: boolean
  /** Veri satırları; her biri headers.length uzunluğunda */
  rows: string[][]
  /** Başlık yoksa imzaya katılan ek metin (PDF'in ilk satırları) */
  hint?: string
}

export type DateFormat = 'dmy' | 'mdy' | 'ymd' | 'text'
export type DecimalSep = 'comma' | 'dot'
/** Tek tutar sütununda harcamanın işareti */
export type SignMode = 'expense-positive' | 'expense-negative'

export interface ColumnMapping {
  date: number
  description: number
  /** single: tek işaretli tutar sütunu · split: ayrı Borç (çıkan) / Alacak (giren) */
  amountMode: 'single' | 'split'
  amount: number
  debit: number
  credit: number
  /** Bakiye sütunu (yalnız vadesiz hesap; −1 = yok) */
  balance: number
  dateFormat: DateFormat
  decimal: DecimalSep
  sign: SignMode
  statementType: 'credit_card' | 'checking'
}

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: 'gg.aa.yyyy (14.11.2026, 14/11/26)',
  mdy: 'aa/gg/yyyy (11/14/2026)',
  ymd: 'yyyy-aa-gg (2026-11-14)',
  text: 'Ay adıyla (14 Kasım 2026)',
}

export const NONE = -1

// ── Tarih ───────────────────────────────────────────────────────────────────

const MONTH_PREFIX: Record<string, number> = {
  oca: 1, sub: 2, mar: 3, nis: 4, may: 5, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
  jan: 1, feb: 2, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2099) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** Seçilen biçimde tarih → ISO; okunamazsa null. Excel seri günü (xlsx hücresi
 *  "46290") her biçimde kabul edilir; sondaki saat ("14:32") yok sayılır. */
export function parseMappedDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  if (/^\d{5}([.,]\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s.replace(',', '.')))
    if (serial < 25569 || serial > 73050) return null
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
    return calendarIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  if (fmt === 'text') {
    const m = s.match(/^(\d{1,2})[\s./-]*([\p{L}]+)\.?[\s./-]*(\d{4}|\d{2})(?:\s|$|[T,])/u)
    if (!m) return null
    const month = MONTH_PREFIX[foldText(m[2]).slice(0, 3)]
    return month ? calendarIso(fullYear(m[3]), month, Number(m[1])) : null
  }
  const part = s.split(/[T\s]/)[0]
  if (fmt === 'ymd') {
    const m = part.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
    return m ? calendarIso(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  const m = part.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  return fmt === 'dmy' ? calendarIso(fullYear(m[3]), b, a) : calendarIso(fullYear(m[3]), a, b)
}

// ── Tutar ───────────────────────────────────────────────────────────────────

/** Seçilen ondalık ayraçla tutar. "1.234,56", "1,234.56", "-45,90", "45,90-",
 *  "(45,90)", "1.234,56 TL", "₺12,50", "250,00+" (+ = alacak işareti değil,
 *  yalnız işaret). Binlik gruplaması ayraçla uyuşmazsa (virgüllü kipte
 *  "1234.56") null döner — kullanıcı yanlış ayracı hemen görür.
 *  Boş hücre null, "0,00" 0 döner. */
export function parseMappedAmount(raw: string, decimal: DecimalSep): number | null {
  let s = raw.trim().replace(/[\s ]/g, '').replace(/(TRY|TL|USD|EUR|GBP)/gi, '').replace(/[₺$€£]/g, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  if (/[-+]$/.test(s)) { if (s.endsWith('-')) negative = !negative; s = s.slice(0, -1) }
  if (/^[-+]/.test(s)) { if (s.startsWith('-')) negative = !negative; s = s.slice(1) }
  const dec = decimal === 'comma' ? ',' : '.'
  const thou = decimal === 'comma' ? '.' : ','
  const esc = (c: string) => `\\${c}`
  const plain = new RegExp(`^\\d+(${esc(dec)}\\d+)?$`)
  const grouped = new RegExp(`^\\d{1,3}(${esc(thou)}\\d{3})+(${esc(dec)}\\d+)?$`)
  s = s.replace(/'/g, '')
  if (!plain.test(s) && !grouped.test(s)) return null
  const n = Number(s.split(thou).join('').replace(dec, '.'))
  if (!Number.isFinite(n)) return null
  const v = toMajor(toMinor(n))
  return negative && v !== 0 ? -v : v
}

// ── Tablo: CSV/XLSX ızgarası ────────────────────────────────────────────────

const looksDate = (s: string) => (['dmy', 'ymd', 'text'] as const).some(f => parseMappedDate(s, f) !== null)
const looksAmount = (s: string) => /\d/.test(s) && (parseMappedAmount(s, 'comma') !== null || parseMappedAmount(s, 'dot') !== null)
const looksData = (s: string) => looksDate(s) || looksAmount(s)

function pad(rows: string[][], width: number): string[][] {
  return rows.map(r => Array.from({ length: width }, (_, i) => (r[i] ?? '').trim()))
}

function uniqueHeaders(raw: string[]): string[] {
  const used = new Map<string, number>()
  return raw.map((h, i) => {
    const base = h.trim() || `Sütun ${i + 1}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** Ham satırlardan (CSV / XLSX) tablo. Başlık: ilk 25 satırda, tarih ve tutar
 *  başlığı taşıyan ilk satır; yoksa veri satırından hemen önceki, hücrelerinin
 *  çoğu veri olmayan satır. Hiçbiri yoksa sütunlar "Sütun N" adını alır. */
export function gridToTable(records: string[][]): StatementTable {
  const recs = records.filter(r => r.some(c => c.trim() !== ''))
  if (!recs.length) throw new Error('Dosyada okunacak satır yok.')
  let h = -1
  for (let i = 0; i < Math.min(recs.length, 25); i++) {
    const roles = new Set(recs[i].map(headerRole))
    if (roles.has('date') && (roles.has('amount') || roles.has('debit') || roles.has('credit'))) { h = i; break }
  }
  if (h < 0) {
    const firstData = recs.findIndex(r => r.some(looksDate) && r.some(c => !looksDate(c) && looksAmount(c)))
    if (firstData > 0) {
      const prev = recs[firstData - 1]
      const filled = prev.filter(c => c.trim())
      if (filled.length >= 2 && filled.every(c => !looksData(c))) h = firstData - 1
    }
  }
  const body = h >= 0 ? recs.slice(h + 1) : recs
  const width = Math.max(...(h >= 0 ? [recs[h]] : []).concat(body).map(r => r.length))
  const headers = h >= 0
    ? uniqueHeaders(Array.from({ length: width }, (_, i) => recs[h][i] ?? ''))
    : Array.from({ length: width }, (_, i) => `Sütun ${i + 1}`)
  return { source: 'sheet', headers, hasHeader: h >= 0, rows: pad(body, width) }
}

// ── Tablo: PDF ──────────────────────────────────────────────────────────────

/** Satırdaki parçalardan biri (ya da ardışık ikisi-üçü: "14 Kasım 2026") tarih mi */
function lineHasDate(l: PdfLine): boolean {
  const it = l.items.map(i => i.str.trim())
  for (let i = 0; i < it.length; i++) {
    if (looksDate(it[i])) return true
    if (i + 2 < it.length && looksDate(`${it[i]} ${it[i + 1]} ${it[i + 2]}`)) return true
  }
  return looksDate(l.text.split(' ').slice(0, 3).join(' '))
}
const lineHasAmount = (l: PdfLine) => l.items.some(i => /[.,]\d{2}\b/.test(i.str) && looksAmount(i.str.trim()))

interface Col { x: number; right: number }

/** Sütun aralıkları: işlem satırlarındaki parçaların [x, right] aralıklarının
 *  birleşimi. Sola yaslı metin aynı x'te, sağa yaslı tutarlar aynı sağ kenarda
 *  üst üste biner; aralarında boşluk kalan bloklar ayrı sütundur. */
function columnsOf(lines: PdfLine[]): Col[] {
  const spans = lines.flatMap(l => l.items.map(i => ({ x: i.x, right: Math.max(i.right, i.x + 1) }))).sort((a, b) => a.x - b.x)
  const cols: Col[] = []
  for (const s of spans) {
    const last = cols[cols.length - 1]
    if (last && s.x <= last.right + 2) last.right = Math.max(last.right, s.right)
    else cols.push({ ...s })
  }
  return cols
}

function cellsOf(l: PdfLine, cols: Col[]): string[] | null {
  const cells: string[][] = cols.map(() => [])
  for (const it of l.items) {
    let best = -1
    let bestOverlap = 0
    cols.forEach((c, i) => {
      const o = Math.min(c.right, it.right) - Math.max(c.x, it.x)
      if (o > bestOverlap) { bestOverlap = o; best = i }
    })
    if (best < 0) {
      // Aralık dışı (başlık metni sütundan geniş olabilir): merkezi en yakın sütun, 20 pt içinde
      const mid = (it.x + it.right) / 2
      let d = Infinity
      cols.forEach((c, i) => {
        const dd = Math.abs((c.x + c.right) / 2 - mid)
        if (dd < d) { d = dd; best = i }
      })
      if (d > 20 + (cols[best].right - cols[best].x) / 2) return null
    }
    cells[best].push(it.str.trim())
  }
  return cells.map(c => c.join(' ').replace(/\s+/g, ' ').trim())
}

/** Konumlu PDF metninden tablo. İşlem satırı = tarih + tutar taşıyan satır;
 *  ilk ve son işlem satırı arasındaki, sütunlara oturan satırlar (çok satırlı
 *  açıklamanın devamı dahil) alınır. Her sayfada tekrar eden başlık atlanır.
 *  En az iki işlem satırı yoksa null. */
export function pdfToTable(pages: PdfPage[]): StatementTable | null {
  const all = pages.flatMap(p => p.lines)
  const isTx = all.map(l => lineHasDate(l) && lineHasAmount(l))
  const first = isTx.indexOf(true)
  const last = isTx.lastIndexOf(true)
  if (first < 0 || isTx.filter(Boolean).length < 2) return null
  const cols = columnsOf(all.filter((_, i) => isTx[i]))
  if (cols.length < 2) return null

  // Başlık: ilk işlem satırının üstündeki (en çok 6 satır) veri taşımayan, en az 2 sütuna oturan satır
  let header: string[] | null = null
  let headerText = ''
  for (let i = first - 1; i >= Math.max(0, first - 6); i--) {
    const cells = cellsOf(all[i], cols)
    if (cells && cells.filter(Boolean).length >= 2 && all[i].items.every(it => !looksData(it.str.trim()))) {
      header = cells
      headerText = all[i].text
      break
    }
  }
  const rows: string[][] = []
  for (let i = first; i <= last; i++) {
    if (headerText && all[i].text === headerText) continue
    const cells = cellsOf(all[i], cols)
    if (cells && cells.some(Boolean)) rows.push(cells)
  }
  const hint = all.slice(0, 3).map(l => l.text).join(' ')
  return {
    source: 'pdf',
    headers: header ? uniqueHeaders(header) : cols.map((_, i) => `Sütun ${i + 1}`),
    hasHeader: !!header,
    rows,
    hint: header ? undefined : hint,
  }
}

// ── İmza (eşleme hafızası anahtarı) ─────────────────────────────────────────

/** Aynı bankanın sonraki ekstresinde de aynı kalan imza: başlıklar (rakamlar
 *  atılmış, Türkçe harfler katlanmış) ve sütun sayısı. Başlık yoksa PDF'in ilk
 *  satırları (banka adı) kullanılır. */
export function tableSignature(t: StatementTable): string {
  const norm = (s: string) => foldText(s).replace(/[\d.,:/\\-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const body = t.hasHeader ? t.headers.map(norm).join('|') : `#${norm(t.hint ?? '').slice(0, 80)}`
  return `${t.source}:${t.headers.length}:${body}`
}

// ── Otomatik tahmin ─────────────────────────────────────────────────────────

type Role = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance'

const HEADER_ROLES: [RegExp, Role][] = [
  [/^(islem )?tarih|^date|^tarih|islem zamani|^tarih saat/, 'date'],
  [/bakiye|balance/, 'balance'],
  [/^borc|cikan|giden|harcama|^debit|withdraw/, 'debit'],
  [/^alacak|giren|gelen|yatan|^credit|deposit/, 'credit'],
  [/tutar|miktar|amount|^tl$/, 'amount'],
  [/aciklama|description|islem detay|detay|^islem$|islemler|^islem adi|merchant|isyeri|karsi taraf/, 'description'],
]

function headerRole(h: string): Role | undefined {
  const k = foldText(h.replace(/\(.*?\)/g, ' ').replace(/[:*.]/g, ' ')).replace(/\s+/g, ' ').trim()
  if (!k || /valor/.test(k)) return undefined
  return HEADER_ROLES.find(([re]) => re.test(k))?.[1]
}

const ratio = (vals: string[], ok: (s: string) => boolean) => {
  const filled = vals.filter(v => v.trim())
  return filled.length ? filled.filter(ok).length / filled.length : 0
}

/** Tarih sütununun değerlerine en çok uyan biçim (eşitlikte gg.aa.yyyy). */
export function guessDateFormat(values: string[]): DateFormat {
  let best: DateFormat = 'dmy'
  let bestN = -1
  for (const f of ['dmy', 'mdy', 'ymd', 'text'] as const) {
    const n = values.filter(v => parseMappedDate(v, f) !== null).length
    if (n > bestN) { best = f; bestN = n }
  }
  return best
}

/** Tutarların çoğunun okunduğu ondalık ayracı (eşitlikte virgül). */
export function guessDecimal(values: string[]): DecimalSep {
  const n = (d: DecimalSep) => values.filter(v => v.trim() && parseMappedAmount(v, d) !== null).length
  return n('dot') > n('comma') ? 'dot' : 'comma'
}

/** Sütun rollerini başlıktan, başlık yetmezse içerikten tahmin eder. */
export function guessMapping(t: StatementTable): ColumnMapping {
  const n = t.headers.length
  const col = (i: number) => t.rows.map(r => r[i] ?? '')
  const filledShare = (i: number) => (t.rows.length ? col(i).filter(v => v.trim()).length / t.rows.length : 0)
  const dateScore = Array.from({ length: n }, (_, i) => ratio(col(i), looksDate) * filledShare(i))
  const amountScore = Array.from({ length: n }, (_, i) => ratio(col(i), s => !looksDate(s) && looksAmount(s)))
  const roles = t.hasHeader ? t.headers.map(headerRole) : []
  const byRole = (r: Role) => roles.findIndex(x => x === r)

  let date = byRole('date')
  if (date < 0 || dateScore[date] < 0.3) {
    date = dateScore.reduce((b, s, i) => (s > dateScore[b] ? i : b), 0)
  }
  const isAmountCol = (i: number) => i !== date && amountScore[i] >= 0.6
  let balance = byRole('balance')
  let debit = byRole('debit')
  let credit = byRole('credit')
  let amount = byRole('amount')
  if (debit >= 0 && !isAmountCol(debit)) debit = NONE
  if (credit >= 0 && !isAmountCol(credit)) credit = NONE
  if (amount >= 0 && !isAmountCol(amount)) amount = NONE
  const amountCols = Array.from({ length: n }, (_, i) => i).filter(i => isAmountCol(i) && i !== balance)
  let amountMode: ColumnMapping['amountMode'] = 'single'
  if (debit >= 0 && credit >= 0) amountMode = 'split'
  else if (amount < 0) {
    // İki tutar sütunu satır satır birbirini dışlıyorsa Borç/Alacak çiftidir
    if (amountCols.length >= 2) {
      const [a, b] = amountCols.slice(0, 2)
      const both = t.rows.filter(r => (r[a] ?? '').trim() || (r[b] ?? '').trim())
      const exclusive = both.filter(r => !(r[a] ?? '').trim() !== !(r[b] ?? '').trim()).length
      if (both.length && exclusive / both.length >= 0.8) { amountMode = 'split'; debit = a; credit = b }
      else if (balance < 0 && amountCols.length >= 2 && !t.hasHeader) balance = amountCols[amountCols.length - 1]
    }
    if (amountMode === 'single') {
      const cands = amountCols.filter(i => i !== balance)
      amount = cands.sort((x, y) => filledShare(y) - filledShare(x) || y - x)[0] ?? NONE
    }
  }
  const used = new Set([date, amount, debit, credit, balance].filter(i => i >= 0))
  let description = byRole('description')
  if (description < 0 || used.has(description)) {
    const avgLen = (i: number) => { const v = col(i).filter(x => x.trim()); return v.length ? v.reduce((s, x) => s + x.length, 0) / v.length : 0 }
    const texts = Array.from({ length: n }, (_, i) => i).filter(i => !used.has(i) && amountScore[i] < 0.5 && dateScore[i] < 0.3)
    description = texts.sort((x, y) => avgLen(y) - avgLen(x))[0] ?? NONE
  }

  const dateFormat = guessDateFormat(col(date))
  const amountValues = amountMode === 'split' ? [...col(debit), ...col(credit)] : amount >= 0 ? col(amount) : []
  const decimal = guessDecimal(amountValues)
  let sign: SignMode = 'expense-positive'
  if (amountMode === 'single' && amount >= 0) {
    const vals = col(amount).map(v => parseMappedAmount(v, decimal)).filter((v): v is number => v !== null && v !== 0)
    if (vals.filter(v => v < 0).length > vals.length / 2) sign = 'expense-negative'
  }
  return {
    date, description, amountMode, amount: amountMode === 'single' ? amount : NONE,
    debit: amountMode === 'split' ? debit : NONE, credit: amountMode === 'split' ? credit : NONE,
    balance, dateFormat, decimal, sign,
    statementType: amountMode === 'split' || balance >= 0 ? 'checking' : 'credit_card',
  }
}

/** Eşleme eksikse kullanıcıya gösterilecek hata; tamamsa null. */
export function mappingProblem(m: ColumnMapping, columns: number): string | null {
  const ok = (i: number) => i >= 0 && i < columns
  if (!ok(m.date)) return 'Tarih sütununu seçin.'
  if (!ok(m.description)) return 'Açıklama sütununu seçin.'
  if (m.amountMode === 'single' ? !ok(m.amount) : !ok(m.debit) || !ok(m.credit)) {
    return m.amountMode === 'single' ? 'Tutar sütununu seçin.' : 'Borç ve Alacak sütunlarını seçin.'
  }
  const picked = [m.date, m.description, ...(m.amountMode === 'single' ? [m.amount] : [m.debit, m.credit])]
  if (new Set(picked).size !== picked.length) return 'Aynı sütun iki alana seçilmiş.'
  return null
}

// ── Eşlemeyi uygulama ───────────────────────────────────────────────────────

export interface MappedRow {
  /** Tablodaki satır sırası (0 tabanlı) */
  row: number
  date: string
  description: string
  /** Ekstre kuralı: + borç / hesaptan çıkan, − ödeme-iade / hesaba giren */
  amount: number
  balance: number | null
}

export interface MappingResult {
  rows: MappedRow[]
  /** Tarih ya da tutarı okunamadığı için atlanan, boş olmayan satırlar */
  skipped: { row: number; reason: string }[]
}

/** Eşlemeyi tabloya uygular. Tarihi ve tutarı okunan satır işlemdir; yalnız
 *  açıklama sütunu dolu satır (PDF'te iki satıra bölünmüş açıklama) bir önceki
 *  işlemin açıklamasına eklenir; tutarı sıfır satırlar atlanır. */
export function applyMapping(t: StatementTable, m: ColumnMapping): MappingResult {
  const rows: MappedRow[] = []
  const skipped: MappingResult['skipped'] = []
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  let prevWasTx = false
  t.rows.forEach((r, i) => {
    const date = parseMappedDate(cell(r, m.date), m.dateFormat)
    const desc = cell(r, m.description).replace(/\s+/g, ' ')
    let amount: number | null
    if (m.amountMode === 'single') {
      const v = parseMappedAmount(cell(r, m.amount), m.decimal)
      amount = v === null ? null : m.sign === 'expense-positive' ? v : -v
    } else {
      const d = parseMappedAmount(cell(r, m.debit), m.decimal)
      const c = parseMappedAmount(cell(r, m.credit), m.decimal)
      // Alacak sütunu eksi işaretli de yazılabilir ("-500,00"): yön sütundan gelir
      amount = d === null && c === null ? null : toMajor(toMinor(Math.abs(d ?? 0)) - toMinor(Math.abs(c ?? 0)))
    }
    const others = r.filter((_, j) => j !== m.description).some(v => v.trim())
    if (date === null && amount === null && desc && !others && t.source === 'pdf' && prevWasTx) {
      const last = rows[rows.length - 1]
      last.description = `${last.description} ${desc}`.trim()
      return
    }
    prevWasTx = false
    if (!r.some(v => v.trim())) return
    if (date === null) { skipped.push({ row: i, reason: 'tarih okunamadı' }); return }
    if (amount === null) { skipped.push({ row: i, reason: 'tutar okunamadı' }); return }
    if (amount === 0) { skipped.push({ row: i, reason: 'tutar sıfır' }); return }
    const balance = m.balance >= 0 ? parseMappedAmount(cell(r, m.balance), m.decimal) : null
    rows.push({ row: i, date, description: desc || '(açıklamasız)', amount, balance })
    prevWasTx = true
  })
  return { rows, skipped }
}

const FEE_RE = /\b(faiz|kkdf|bsmv|ucret|ucreti|komisyon|aidat|gecikme)\b/
const PAYMENT_RE = /\b(odeme|odemeniz|payment|tahsilat)\b/

function kindOf(amount: number, description: string, type: ColumnMapping['statementType']): LineKind {
  if (type === 'checking') return amount > 0 ? 'debit' : 'credit'
  const f = foldText(description)
  if (amount > 0) return FEE_RE.test(f) ? 'fee' : 'purchase'
  return PAYMENT_RE.test(f) ? 'payment' : 'refund'
}

const prevDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export interface MappedStatementInfo {
  /** Eşleme hafızası anahtarı (tableSignature) */
  signature: string
  /** Vadesiz dökümde bakiye sütunu okundu mu (yoksa bakiye kıyası gösterilmez) */
  hasBalance: boolean
}

/** Eşlenmiş tabloyu banka ayrıştırıcılarının ürettiği ParsedStatement'a çevirir.
 *  Toplam kontrolü yapılamaz (bankanın özet satırı bilinmiyor): kart ekstresi
 *  "dönem içi" (provisional) sayılır — Kart Takvimi'ne yazılmaz, taksit bilgisi
 *  olmayan satır sistemdeki taksitle eşleşebilir. Satırlar tarihe göre artan
 *  sıradadır (dosya yeniden eskiye sıralıysa çevrilir). */
export function buildMappedStatement(t: StatementTable, m: ColumnMapping, label: string): ParsedStatement {
  const problem = mappingProblem(m, t.headers.length)
  if (problem) throw new Error(problem)
  let rows = applyMapping(t, m).rows
  if (!rows.length) throw new Error('Seçilen sütunlarla hiçbir satır okunamadı. Tarih biçimini ve ondalık ayracını kontrol edin.')
  if (rows[0].date > rows[rows.length - 1].date) rows = [...rows].reverse()
  rows = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map(x => x.r)

  const lines: StatementLine[] = rows.map((r, index) => ({
    index, date: r.date, description: r.description, amount: r.amount, bonus: null, installment: null, foreign: null,
    kind: kindOf(r.amount, r.description, m.statementType),
    ...(m.statementType === 'checking' && r.balance !== null ? { balance: r.balance } : {}),
  }))
  const first = rows[0].date
  const last = rows[rows.length - 1].date
  const sum = toMajor(lines.reduce((s, l) => s + toMinor(l.amount!), 0))
  const hasBalance = m.statementType === 'checking' && rows.length > 0 && rows.every(r => r.balance !== null)
  const mapped: MappedStatementInfo = { signature: tableSignature(t), hasBalance }
  const base: ParsedStatement = {
    bank: 'custom', bankLabel: label.trim() || 'Elle eşlenen ekstre', type: m.statementType, currency: 'TRY', cards: [],
    statementDate: last, dueDate: null, prevStatementDate: prevDay(first), nextStatementDate: null, nextDueDate: null,
    summary: null, lines,
    check: { ok: true, computed: sum, expected: sum, diff: 0, issues: [] },
    mapped,
  }
  if (m.statementType === 'credit_card') return { ...base, provisional: true }
  const closing = hasBalance ? rows[rows.length - 1].balance! : toMajor(-toMinor(sum))
  const opening = hasBalance ? toMajor(toMinor(rows[0].balance!) + toMinor(rows[0].amount)) : 0
  return {
    ...base,
    account: { iban: '', owner: '', periodStart: first, periodEnd: last, openingBalance: opening, closingBalance: closing },
  }
}
