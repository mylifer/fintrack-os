import type { PdfPage } from './pdf-text'
import { parseGarantiCard } from './garanti-card'
import { parseGarantiPeriod } from './garanti-period'
import { parseOdeabankAccount } from './odeabank-account'
import { parseOdeabankCard } from './odeabank-card'
import { parseOdeabankPeriod } from './odeabank-period'
import { parseKuveytCard } from './kuveyt-card'
import { parseQnbPeriod, parseQnbStatement } from './qnb-card'
import { parseBurganCard } from './burgan-card'
import { parseYapiKrediCard } from './yapikredi-card'

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
  | 'debit'      // vadesiz hesap: hesaptan çıkan para
  | 'credit'     // vadesiz hesap: hesaba giren para

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
   *  null = yalnız bonus satırı. Vadesiz hesapta aynı yön: + hesaptan çıkan,
   *  − hesaba giren (önizleme girişleri yeşil "+" gösterir). */
  amount: number | null
  bonus: number | null
  installment: StatementInstallment | null
  /** Yurt dışı harcamanın asıl tutarı (TL dışı) */
  foreign: { amount: number; currency: string } | null
  kind: LineKind
  /** Vadesiz hesap: işlem saati ("02:43") ve işlemden sonraki bakiye */
  time?: string
  balance?: number
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

/** Vadesiz hesap dökümünün başlığı ve bakiyeleri */
export interface AccountInfo {
  iban: string
  owner: string
  periodStart: string
  periodEnd: string
  /** Dönem başı (ilk işlemden önceki) ve dönem sonu bakiyesi */
  openingBalance: number
  closingBalance: number
}

export interface ParsedStatement {
  bank: 'garanti' | 'odeabank' | 'qnb' | 'burgan' | 'yapikredi' | 'kuveyt'
  bankLabel: string
  /** credit_card: kart ekstresi · checking: vadesiz hesap dökümü */
  type: 'credit_card' | 'checking'
  currency: 'TRY'
  /** Maskeli kart numaraları (son 4 hane), ekstrede geçtiği sırayla */
  cards: string[]
  /** Kart: hesap kesim tarihi · vadesiz: dönem sonu */
  statementDate: string
  dueDate: string | null
  prevStatementDate: string | null
  nextStatementDate: string | null
  nextDueDate: string | null
  summary: StatementSummary | null
  lines: StatementLine[]
  /** Kart: devir + satırlar = dönem borcu · vadesiz: bakiye zinciri */
  check: StatementCheck
  /** Yalnız vadesiz hesap dökümünde */
  account?: AccountInfo
  /** Henüz ekstresi kesilmemiş dönem içi işlem listesi: toplam kontrolü yok,
   *  tarihleri Kart Takvimi'ne yazılmaz */
  provisional?: boolean
}

/** Desteklenen bankalardan birini tanıyıp ayrıştırır; tanınmazsa açıklayıcı hata. */
export function parseStatement(pages: PdfPage[]): ParsedStatement {
  const parsed = parseGarantiCard(pages) ?? parseQnbStatement(pages) ?? parseBurganCard(pages) ?? parseYapiKrediCard(pages) ?? parseQnbPeriod(pages) ?? parseGarantiPeriod(pages) ?? parseOdeabankCard(pages) ?? parseKuveytCard(pages) ?? parseOdeabankPeriod(pages) ?? parseOdeabankAccount(pages)
  if (parsed) return parsed
  throw new Error('Bu ekstrenin biçimi henüz tanınmıyor. Şimdilik Garanti BBVA, QNB, Burgan (ON), Yapı Kredi, Odeabank ve Kuveyt Türk kredi kartı ekstresi, Garanti BBVA, QNB ve Odeabank dönem içi işlemler ve Odeabank vadesiz hesap dökümü (PDF) destekleniyor.')
}
