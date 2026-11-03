import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfItem, PdfLine, PdfPage } from './pdf-text'
import type { ParsedStatement, StatementLine } from './statement'

/* ── Odeabank vadesiz hesap dökümü (PDF, "Hesap Hareketleri") ────────────────
   Başlık: Ad Soyad/Ünvan, IBAN (banka kodu 00146), Tarih Aralığı.
   Tablo:  Tarih (gg.aa.yyyy ss:dd) | İşlem | Tutar(TRY) | Bakiye(TRY)

   • Satırlar yeniden eskiye sıralıdır; açıklama alt satırlara taşabilir
     (tarihsiz, tutarsız satır bir öncekinin devamıdır).
   • Tutar işaretlidir: "+188.054,30" giriş, "-32,46" çıkış. Tutar ve bakiye
     sütunu sağa yaslıdır; hangisi olduğu sağ kenardan anlaşılır.
   • Kontrol: her satırın bakiyesi = bir sonraki (daha eski) satırın bakiyesi +
     bu satırın tutarı. Zincir kuruşu kuruşuna tutmazsa bir satır eksik ya da
     yanlış okunmuştur.
   • Satırlar eskiden yeniye çevrilir; tutar kart ekstresiyle aynı yöndedir:
     + hesaptan çıkan, − hesaba giren. */

const DATE_TIME_RE = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/
const AMOUNT_RE = /^[+-]?[\d.]+,\d{2}$/
const PERIOD_RE = /(\d{2})\.(\d{2})\.(\d{4}).*?(\d{2})\.(\d{2})\.(\d{4})/
/** Sütun sağ kenarı eşleşme payı (pt) */
const COL_TOLERANCE = 25

const iso = (d: string, m: string, y: string) => `${y}-${m}-${d}`

/** "+1.234,56" → 1234.56 · "-32,46" → -32.46 */
function signedAmount(s: string): number {
  const neg = s.trim().startsWith('-')
  const body = s.trim().replace(/^[+-]/, '').replace(/\./g, '').replace(',', '.')
  return toMajor(toMinor(Number(body)) * (neg ? -1 : 1))
}

function isOdeabank(pages: PdfPage[]): boolean {
  const lines = pages.flatMap(p => p.lines.map(l => l.text))
  const text = foldText(lines.join(' '))
  const compact = lines.join('').replace(/\s+/g, '').toUpperCase()
  return text.includes('hesap hareketleri') && /TR\d{2}00146/.test(compact)
}

/** "Ad Soyad/Ünvan : AYŞE YILMAZ" → "AYŞE YILMAZ" */
function labelValue(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    if (!foldText(l.text).startsWith(key)) continue
    const rest = l.items.slice(1).map(i => i.str).join(' ').replace(/^\s*:\s*/, '').trim()
    return rest || null
  }
  return null
}

interface Columns { amountRight: number; balanceRight: number; descLeft: number }

function findColumns(lines: PdfLine[]): Columns | null {
  for (const l of lines) {
    const amount = l.items.find(i => foldText(i.str).startsWith('tutar'))
    const balance = l.items.find(i => foldText(i.str).startsWith('bakiye'))
    const desc = l.items.find(i => foldText(i.str) === 'islem')
    if (amount && balance) return { amountRight: amount.right, balanceRight: balance.right, descLeft: desc?.x ?? 120 }
  }
  return null
}

interface RawRow { date: string; time: string; desc: string[]; amount: number; balance: number }

export function parseOdeabankAccount(pages: PdfPage[]): ParsedStatement | null {
  if (!isOdeabank(pages)) return null
  const first = pages[0]?.lines ?? []
  const owner = labelValue(first, 'Ad Soyad/Ünvan') ?? ''
  const iban = (labelValue(first, 'IBAN') ?? '').replace(/\s+/g, '')
  const period = (labelValue(first, 'Tarih Aralığı') ?? '').match(PERIOD_RE)

  let cols: Columns | null = null
  const rows: RawRow[] = []
  const near = (it: PdfItem, right: number) => Math.abs(it.right - right) <= COL_TOLERANCE

  for (const page of pages) {
    cols = findColumns(page.lines) ?? cols
    if (!cols) continue
    const c = cols
    let inTable = false
    for (const line of page.lines) {
      if (findColumns([line])) { inTable = true; continue }
      const dt = line.text.match(DATE_TIME_RE)
      const amounts = line.items.filter(i => AMOUNT_RE.test(i.str.trim()))
      if (dt) {
        const amountItem = amounts.find(i => near(i, c.amountRight))
        const balanceItem = amounts.find(i => near(i, c.balanceRight))
        if (!amountItem || !balanceItem) continue
        const desc = line.items
          .filter(i => i !== amountItem && i !== balanceItem && i.x >= c.descLeft - 20)
          .map(i => i.str).join(' ')
        rows.push({
          date: iso(dt[1], dt[2], dt[3]), time: `${dt[4]}:${dt[5]}`, desc: [desc],
          amount: signedAmount(amountItem.str), balance: signedAmount(balanceItem.str),
        })
        inTable = true
        continue
      }
      // Tarihsiz, tutarsız, açıklama sütunundaki satır: bir öncekinin devamı
      if ((inTable || rows.length) && !amounts.length && rows.length && line.items.every(i => i.x >= c.descLeft - 20 && i.right <= c.amountRight - 60)) {
        rows[rows.length - 1].desc.push(line.text)
      }
    }
  }
  if (!rows.length) return null

  // Bakiye zinciri (liste yeniden eskiye): bakiye[i] − tutar[i] = bakiye[i+1]
  const issues: string[] = []
  for (let i = 0; i < rows.length - 1; i++) {
    const diff = toMinor(rows[i].balance) - toMinor(rows[i].amount) - toMinor(rows[i + 1].balance)
    if (diff !== 0) {
      const r = rows[i]
      issues.push(`${r.date.slice(8, 10)}.${r.date.slice(5, 7)} ${r.time} satırında bakiye zinciri tutmuyor (fark ${toMajor(diff).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL); bir satır eksik ya da yanlış okunmuş olabilir.`)
    }
  }
  const last = rows[rows.length - 1]
  const openingBalance = toMajor(toMinor(last.balance) - toMinor(last.amount))
  const closingBalance = rows[0].balance

  const chrono = rows.slice().reverse()
  const lines: StatementLine[] = chrono.map((r, index) => ({
    index,
    date: r.date,
    time: r.time,
    description: r.desc.join(' ').replace(/\s+/g, ' ').trim(),
    amount: toMajor(-toMinor(r.amount)),
    bonus: null,
    installment: null,
    foreign: null,
    kind: r.amount < 0 ? 'debit' : 'credit',
    balance: r.balance,
  }))
  const computed = toMajor(toMinor(openingBalance) + rows.reduce((s, r) => s + toMinor(r.amount), 0))

  const periodStart = period ? iso(period[1], period[2], period[3]) : chrono[0].date
  const periodEnd = period ? iso(period[4], period[5], period[6]) : chrono[chrono.length - 1].date
  return {
    bank: 'odeabank',
    bankLabel: 'Odeabank',
    type: 'checking',
    currency: 'TRY',
    cards: [],
    statementDate: periodEnd,
    dueDate: null,
    prevStatementDate: null,
    nextStatementDate: null,
    nextDueDate: null,
    summary: null,
    lines,
    check: { ok: issues.length === 0, computed, expected: closingBalance, diff: toMajor(toMinor(computed) - toMinor(closingBalance)), issues },
    account: { iban, owner, periodStart, periodEnd, openingBalance, closingBalance },
  }
}
