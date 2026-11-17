import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { OcrLine, OcrPage } from './ocr'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Burgan (ON) "Kart Hareketleri / Ekstre → Dönem İçi" ekran görüntüleri (OCR)
   Mobil uygulama dönem içi işlemleri yalnız ekranda gösterir; liste uzun
   olduğundan birden çok ekran görüntüsü (aşağı kaydırarak) birlikte okunur.
   Ekran:
     Toplam Dönem İçi Harcama
     592,63 TL / 0,00 USD                         ← bekleyenler hariç borç toplamı
     Bekleyen İşlemler                            ← provizyon
     IYZICO/TESLA.COM   ISTANBUL   TR   -354,72 TL
     17.11.2026
     MaxiPuan • + 0,04
     Diğer Tüm İşlemler
     ON Kredi Kartı Elektrikli Araç Şarj   +56,39 TL   ← açıklama iki satır,
     Kampanyası kazanım iadesi                          tutar ortada
     13.11.2026
   Her satır bir blok: açıklama (+ şehir · ülke) ve tutar, altında tarih, varsa
   altında MaxiPuan. Tutar her zaman işaretlidir: "−" borç, "+" (yeşil) alacak.

   OCR'ın bilinen yanılgıları: "+" → "*" ya da "4" ("+30,00" → "430,00"),
   tarihte "11" → "N" / "1" ya da noktalar kaybolur ("10112026"), puanda
   "0" → "O"/"D". Okunamayan ay, aynı listede net okunan tarihlerin ayından
   tamamlanır. Ekran görüntüleri arasındaki ortak (üst üste binen) satırlar
   tekilleştirilir; kesik satırlar (tarihi ya da tutarı görünmeyen) atılır.
   Kontrol: "Diğer Tüm İşlemler"deki borç satırlarının toplamı ekrandaki
   "Toplam Dönem İçi Harcama"yı tutmalı. */

// İşaretsiz okunan tutarın başında "+"tan dönme "4" olabilir: "4354,72" = +354,72
const AMOUNT_RE = /^([^\d\s]?)(\d{1,4}(?:\.\d{3})*,\d{2})/
const DEBIT_SIGNS = new Set(['-', '–', '—', '~', '_', '='])

const num = (s: string) => toMajor(toMinor(Number(s.replace(/\./g, '').replace(',', '.'))))

interface Amount { credit: boolean; value: number; x0: number; signUnread: boolean; foreign: boolean }

/** Satırın sağındaki işaretli tutar: "-354,72 TL" · "*56,39" · "430,00" (= +30,00) */
function amountIn(line: OcrLine, width: number): Amount | null {
  // En sağdaki ",dd" içeren kelime; hemen solundaki ayrık işaret ("- 354,72") de alınır
  let at = -1
  for (let i = line.words.length - 1; i >= 0; i--) if (/\d,\d{2}/.test(line.words[i].text)) { at = i; break }
  if (at < 0 || line.words[at].x0 < width * 0.5) return null
  const prev = line.words[at - 1]
  if (prev && /^[^\p{L}\d]$/u.test(prev.text) && line.words[at].x0 - prev.x1 < width * 0.03) at--
  const words = line.words.slice(at)
  const right = words.map(w => w.text).join('')
  const m = right.match(AMOUNT_RE)
  if (!m) return null
  const foreign = /USD|EUR|GBP/i.test(right)
  const x0 = words[0].x0
  const sign = m[1]
  if (DEBIT_SIGNS.has(sign)) return { credit: false, value: num(m[2]), x0, signUnread: false, foreign }
  // "+" çoğunlukla "*" okunur; "−" dışındaki her işaret alacaktır
  if (sign) return { credit: true, value: num(m[2]), x0, signUnread: false, foreign }
  // İşaret rakam olarak okunmuş: Burgan her tutarı işaretli yazar, "+" → "4"
  const rest = m[2].match(/^4(\d{1,3}(?:\.\d{3})*,\d{2})$/)
  if (rest) return { credit: true, value: num(rest[1]), x0, signUnread: false, foreign }
  return { credit: false, value: num(m[2]), x0, signUnread: true, foreign }
}

interface RawDate { day: number; month: number | null; year: number }

/** "17.11.2026" · "16.N.2026" (ay okunamadı) · "10112026" · "1111.2026" */
function dateOf(line: OcrLine): RawDate | null {
  if (line.words.length > 3) return null
  const t = line.text.replace(/\s+/g, '')
  const m = t.match(/^(\d{2})(\D?\w{0,2}\D?)(20\d{2})$/)
  if (!m) return null
  const day = Number(m[1])
  const mid = m[2].replace(/\D/g, '')
  const mo = mid.length === 2 ? Number(mid) : NaN
  return { day, month: mo >= 1 && mo <= 12 ? mo : null, year: Number(m[3]) }
}

function isoOf(d: RawDate, month: number): string | null {
  const dt = new Date(Date.UTC(d.year, month - 1, d.day))
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== d.day) return null
  return `${d.year}-${String(month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** "MaxiPuan • * D03" → 0.03 (puan her zaman iki ondalıklı) */
function bonusOf(line: OcrLine): number | null {
  const last = line.words[line.words.length - 1]?.text ?? ''
  const digits = last.replace(/[OoDQ]/g, '0').replace(/\D/g, '')
  return digits.length >= 2 ? toMajor(Number(digits)) : null
}

/** Açıklama kelimeleri: simge ve OCR kırıntıları ("ş", "ri", ".") atılır */
const keepWord = (s: string) => /[\p{L}\d]/u.test(s) && !(s.length <= 2 && !/^[\p{Lu}\d]+$/u.test(s))

interface Row {
  page: number
  pending: boolean
  date: RawDate
  desc: string
  amount: Amount
  bonus: number | null
}

const HEADER_KEYS = ['kart hareketleri', 'donem ici gelecek', 'gelecek donem']

function pageRows(page: OcrPage, pageIndex: number, startPending: boolean) {
  const { lines, width } = page
  const rows: Row[] = []
  let pending = startPending
  let total: number | null = null
  let words: { text: string; x0: number; x1: number }[][] = []
  let amount: Amount | null = null
  const reset = () => { words = []; amount = null }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = foldText(line.text).trim()
    if (f.startsWith('bekleyen islemler')) { pending = true; reset(); continue }
    if (f.startsWith('diger tum islemler')) { pending = false; reset(); continue }
    if (f.startsWith('toplam donem ici harcama')) {
      // Tutar aynı satırda ya da hemen altında: "592,63 TL / 0,00 USD"
      for (const l of [line, lines[i + 1]]) {
        const m = l?.text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*T/)
        if (m) { total = num(m[1]); if (l !== line) i++; break }
      }
      reset()
      continue
    }
    if (HEADER_KEYS.some(k => f.startsWith(k))) { reset(); continue }
    if (f.startsWith('maxipuan')) {
      const last = rows[rows.length - 1]
      if (last && !words.length && !amount && last.bonus === null) last.bonus = bonusOf(line)
      continue
    }
    const date = dateOf(line)
    if (date) {
      const desc = words.map(ws => ws.map(w => w.text).filter(keepWord).join(' ')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
      if (amount && desc) rows.push({ page: pageIndex, pending, date, desc, amount, bonus: null })
      reset()
      continue
    }
    const a = amountIn(line, width)
    let left = line.words
    if (a) {
      if (amount) { reset() } // önceki blok kesik (tarihi görünmüyor)
      amount = a
      left = line.words.filter(w => w.x1 < a.x0)
      // "IYZICO/TESLA.COM   ISTANBUL   TR": geniş boşlukla ayrılmış şehir · ülke sütunları
      const n = left.length
      if (n >= 3 && /^[A-Z]{2}$/.test(left[n - 1].text) && /^[\p{Lu}İ.-]+$/u.test(left[n - 2].text) && left[n - 2].x0 - left[n - 3].x1 > width * 0.035) {
        left = left.slice(0, n - 2)
      }
    }
    if (left.length) words.push(left)
  }
  return { rows, total, pending }
}

function kindOf(desc: string, credit: boolean): LineKind {
  const f = foldText(desc)
  if (credit) return /odeme|tahsilat/.test(f) ? 'payment' : 'refund'
  return /faiz|bsmv|kkdf|ucret|gecikme/.test(f) ? 'fee' : 'purchase'
}

const rowKey = (r: { iso: string; row: Row }) => `${r.iso}|${r.row.amount.credit ? '+' : '-'}${r.row.amount.value}|${foldText(r.row.desc)}`

/** Sayfa Burgan dönem içi ekranına mı ait (ya da onun devamı mı)? */
export function isBurganScreenshot(page: OcrPage): boolean {
  const f = page.lines.map(l => foldText(l.text))
  return f.some(t => t.startsWith('toplam donem ici harcama') || t.startsWith('bekleyen islemler') || t.startsWith('diger tum islemler'))
    || (f.some(t => t.startsWith('maxipuan')) && !f.some(t => t.includes('donem ici harcamalar')))
}

export function parseBurganScreenshots(pages: OcrPage[]): ParsedStatement | null {
  if (!pages.length || !pages.some(isBurganScreenshot)) return null
  const head = pages.findIndex(p => p.lines.some(l => foldText(l.text).startsWith('toplam donem ici harcama')))

  // 1) Her sayfanın satırları; ay tamamlama için önce net okunan aylar
  const firstPass = pages.map((p, i) => pageRows(p, i, false).rows)
  const months = firstPass.flat().map(r => r.date.month).filter((m): m is number => m !== null)
  const counts = new Map<number, number>()
  for (const m of months) counts.set(m, (counts.get(m) ?? 0) + 1)
  const commonMonth = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const isoRow = (r: Row) => isoOf(r.date, r.date.month ?? commonMonth ?? NaN)
  const maxDate = (rows: Row[]) => rows.map(isoRow).filter((d): d is string => !!d).sort().pop() ?? ''

  // 2) Sayfa sırası: toplamın yazdığı ilk ekran başta, kalanlar liste düzeninde
  //    (yeniden eskiye) — ekran görüntüleri hangi sırayla seçilirse seçilsin
  const order = pages.map((_, i) => i).sort((a, b) => {
    if (a === head) return -1
    if (b === head) return 1
    const d = maxDate(firstPass[b]).localeCompare(maxDate(firstPass[a]))
    return d || a - b
  })

  // 3) Bölüm (bekleyen / diğer) bir sayfadan sonrakine taşınır
  let pending = false
  let total: number | null = null
  const merged: { iso: string; row: Row }[] = []
  const issues: string[] = []
  for (const i of order) {
    const res = pageRows(pages[i], i, pending)
    pending = res.pending
    if (total === null) total = res.total
    const list: { iso: string; row: Row }[] = []
    for (const row of res.rows) {
      const iso = isoRow(row)
      if (!iso) { issues.push(`"${row.desc}" satırının tarihi okunamadı; satır atlandı.`); continue }
      if (row.amount.foreign) { issues.push(`"${row.desc}" döviz işlemi; dönem içi döviz harcamaları henüz desteklenmiyor, satır atlandı.`); continue }
      list.push({ iso, row })
    }
    // Ekran görüntüleri üst üste biniyorsa: önceki sayfanın sonu = bu sayfanın başı
    let k = Math.min(list.length, merged.length)
    for (; k > 0; k--) {
      const tail = merged.slice(merged.length - k)
      if (tail.every((r, j) => rowKey(r) === rowKey(list[j]))) break
    }
    for (let j = 0; j < k; j++) {
      const prev = merged[merged.length - k + j].row
      if (prev.bonus === null) prev.bonus = list[j].row.bonus
    }
    merged.push(...list.slice(k))
  }

  if (!merged.length) issues.push('Ekran görüntüsünde işlem satırı bulunamadı.')
  for (const { row } of merged) {
    if (row.amount.signUnread) issues.push(`"${row.desc}" satırının işareti (+/−) okunamadı; borç sayıldı — önizlemede kontrol edin.`)
  }

  // Liste yeniden eskiye; ekstre sırası eskiden yeniye (aynı gün ekrandaki tersine)
  const sorted = merged.slice().reverse().sort((a, b) => a.iso.localeCompare(b.iso))
  const out: StatementLine[] = sorted.map(({ iso, row }, index) => ({
    index, date: iso, description: row.desc, amount: row.amount.credit ? -row.amount.value : row.amount.value,
    bonus: row.bonus, installment: null, foreign: null, kind: kindOf(row.desc, row.amount.credit),
  }))

  // ── Kontrol: bekleyenler hariç borç satırları = "Toplam Dönem İçi Harcama" ──
  const spentMinor = sorted.reduce((s, { row }) => s + (!row.pending && !row.amount.credit ? toMinor(row.amount.value) : 0), 0)
  const spent = toMajor(spentMinor)
  if (total === null) issues.push('Ekrandaki "Toplam Dönem İçi Harcama" okunamadı; tutarlar kontrol edilemedi. Listenin en üstünü gösteren ekran görüntüsünü de ekleyin.')
  const diff = total === null ? 0 : toMajor(spentMinor - toMinor(total))
  if (diff !== 0) {
    issues.push(`Okunan harcamaların toplamı (${spent.toFixed(2)}) ekrandaki "Toplam Dönem İçi Harcama"yı (${total!.toFixed(2)}) tutmuyor: ${diff < 0
      ? 'listenin tamamı görüntülerde olmayabilir (aşağı kaydırıp kalan ekran görüntülerini de ekleyin) ya da bir tutar yanlış okunmuş.'
      : 'bir tutar yanlış okunmuş ya da bir satır iki kez sayılmış olabilir.'}`)
  }

  const asOf = out.reduce<string | null>((m, l) => (!m || l.date! > m ? l.date : m), null)
  if (!asOf) throw new Error('Ekran görüntüsünde tarih okunamadı.')

  return {
    bank: 'burgan', bankLabel: 'Burgan (ON)', type: 'credit_card', currency: 'TRY', cards: [],
    statementDate: asOf, dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null,
    lines: out,
    check: { ok: issues.length === 0, computed: spent, expected: total ?? spent, diff, issues },
    provisional: true,
  }
}
