import type { PdfPage } from './pdf-text'
import { parseGarantiCard } from './garanti-card'

/* ── Banka ekstresinin bankadan bağımsız biçimi ──────────────────────────────
   Her banka ayrıştırıcısı ekstreyi bu yapıya çevirir; eşleştirme motoru
   (classify.ts) yalnız bunu görür. Yeni banka = yeni ayrıştırıcı. */

export type LineKind =
  | 'purchase'   // harcama (taksitli ya da tek çekim)
  | 'refund'     // iade / alacak (ödeme değil)
  | 'payment'    // karta yapılan ödeme
  | 'fee'        // faiz, gecikme faizi, KKDF/BSMV, ücret
  | 'carry'      // önceki dönemden devir (kayıt değil, toplam kontrolü için)
  | 'bonus'      // yalnız bonus sütunu — kart borcunu etkilemez

export interface StatementInstallment {
  /** Kaçıncı taksit (1 tabanlı) */
  index: number
  count: number
  /** Alımın toplam tutarı */
  total: number
}

export interface StatementLine {
  /** Ekstredeki sıra (0 tabanlı) — kimlik ve kararlar bunu kullanır */
  index: number
  /** ISO tarih; tarihsiz satırlarda (faiz, devir) null */
  date: string | null
  /** Bankanın yazdığı haliyle (boşluklar tekilleştirilmiş) */
  description: string
  /** Kart borcuna etkisi: + borç (harcama, faiz), − alacak (ödeme, iade).
   *  null = yalnız bonus satırı. */
  amount: number | null
  bonus: number | null
  installment: StatementInstallment | null
  /** Yurt dışı harcamanın asıl tutarı (TL dışı) */
  foreign: { amount: number; currency: string } | null
  kind: LineKind
}

export interface StatementSummary {
  previous: number
  spending: number
  fees: number
  payments: number
  debt: number
  minPayment: number | null
}

export interface StatementCheck {
  ok: boolean
  /** Devir + satırların toplamı */
  computed: number
  /** Bankanın dönem borcu */
  expected: number
  diff: number
  issues: string[]
}

export interface ParsedStatement {
  bank: 'garanti'
  bankLabel: string
  type: 'credit_card'
  currency: 'TRY'
  /** Maskeli kart numaraları (son 4 hane), ekstrede geçtiği sırayla */
  cards: string[]
  statementDate: string
  dueDate: string | null
  prevStatementDate: string | null
  nextStatementDate: string | null
  nextDueDate: string | null
  summary: StatementSummary | null
  lines: StatementLine[]
  check: StatementCheck
}

/** Desteklenen bankalardan birini tanıyıp ayrıştırır; tanınmazsa açıklayıcı hata. */
export function parseStatement(pages: PdfPage[]): ParsedStatement {
  const parsed = parseGarantiCard(pages)
  if (parsed) return parsed
  throw new Error('Bu ekstrenin biçimi henüz tanınmıyor. Şimdilik Garanti BBVA kredi kartı ekstresi (PDF) destekleniyor.')
}
