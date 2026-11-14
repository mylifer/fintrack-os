import { describe, it, expect } from 'vitest'
import * as F from './golden-fixtures'
import { expectGolden, goldenSummary, lineDigest } from './test-helpers'
import { parseKuveytScreenshot } from './kuveyt-period'
import { parseScreenshot } from './statement'

/* ── Banka başına regresyon ağı ("altın çıktı") ──────────────────────────────
   Her bankanın depodaki örnek ekstresi (golden-fixtures.ts) için:
   - yalnız kendi ayrıştırıcısı tanır, diğer dokuzu null döner;
   - dağıtıcı parseStatement aynı çıktıyı verir (sıra / tanıma çakışması yok);
   - satır sayısı, tür başına toplamlar, kontrol, ilk/son satır sabittir;
   - bütün satırların özeti __snapshots__/golden.test.ts.snap'te sabittir.
   Bir ayrıştırıcıya dokunan değişiklik başka bankanın çıktısını değiştirirse
   burası kırmızı olur. Bilinçli değişiklikte: değerleri güncelleyip
   `npx vitest run src/lib/statement-import/golden.test.ts -u`. */

describe('altın çıktı: PDF ekstreleri', () => {
  it('garanti-card', () => {
    expectGolden('parseGarantiCard', F.garantiCard(), {"bank": "garanti", "type": "credit_card", "provisional": false, "statementDate": "2026-10-30", "dueDate": "2026-11-09", "cards": ["9010"], "check": {"ok": true, "computed": 1867.85, "expected": 1867.85}, "count": 10, "total": 1867.85, "byKind": {"carry": [1, 5000], "fee": [1, 100], "payment": [1, -5000], "bonus": [2, 0], "purchase": [4, 2102.85], "refund": [1, -335]}, "first": "0 | — | carry | 5000.00 | bonus=— | taksit=— | döviz=— | ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR |", "last": "9 | 2026-10-04 | purchase | 556.72 | bonus=— | taksit=— | döviz=11.00 USD | STARTER (TIMELY) |"})
  })
  it('garanti-period', () => {
    expectGolden('parseGarantiPeriod', F.garantiPeriod(), {"bank": "garanti", "type": "credit_card", "provisional": true, "statementDate": "2026-11-07", "dueDate": null, "cards": ["1234"], "check": {"ok": true, "computed": 1851.1, "expected": 1851.1}, "count": 8, "total": -74799.25, "byKind": {"purchase": [4, 3500.1], "bonus": [2, 0], "payment": [1, -76650.35], "refund": [1, -1649]}, "first": "0 | 2026-11-02 | purchase | 1328.85 | bonus=6.22 | taksit=1/3@3986.55 | döviz=— | IYZICO *AMAZON.COM.T | etiket=Market", "last": "7 | 2026-11-28 | refund | -1649.00 | bonus=— | taksit=3/6@-9894.00 | döviz=— | BEYMEN PERAKENDE VE TEKST | etiket=Market"})
  })
  it('qnb-card', () => {
    expectGolden('parseQnbStatement', F.qnbCard(), {"bank": "qnb", "type": "credit_card", "provisional": false, "statementDate": "2026-10-03", "dueDate": "2026-10-13", "cards": ["1234"], "check": {"ok": true, "computed": 1312.55, "expected": 1312.55}, "count": 4, "total": 1312.55, "byKind": {"carry": [1, 24.21], "payment": [1, -24.21], "purchase": [1, 1350], "refund": [1, -37.45]}, "first": "0 | — | carry | 24.21 | bonus=— | taksit=— | döviz=— | Önceki dönem bakiyesi |", "last": "3 | 2026-09-24 | refund | -37.45 | bonus=— | taksit=— | döviz=— | YEMEKPAY /YEMEKSEPE 337.05 alşv ind |"})
  })
  it('qnb-period', () => {
    expectGolden('parseQnbPeriod', F.qnbPeriod(), {"bank": "qnb", "type": "credit_card", "provisional": true, "statementDate": "2026-11-03", "dueDate": null, "cards": ["1234"], "check": {"ok": true, "computed": -2857.05, "expected": -2857.05}, "count": 3, "total": -2857.05, "byKind": {"refund": [1, -46], "payment": [1, -3278.05], "purchase": [1, 467]}, "first": "0 | 2026-10-05 | refund | -46.00 | bonus=— | taksit=— | döviz=— | YEMEKPAY /YEMEKSEPE 414.00 alşv ind |", "last": "2 | 2026-10-24 | purchase | 467.00 | bonus=— | taksit=— | döviz=— | BITAKSI 34 TR |"})
  })
  it('burgan-card', () => {
    expectGolden('parseBurganCard', F.burganCard(), {"bank": "burgan", "type": "credit_card", "provisional": false, "statementDate": "2026-10-07", "dueDate": "2026-10-19", "cards": ["1234"], "check": {"ok": true, "computed": 1747.9, "expected": 1747.9}, "count": 5, "total": 1747.9, "byKind": {"carry": [1, 10000], "purchase": [2, 1810], "refund": [1, -62.1], "payment": [1, -10000]}, "first": "0 | — | carry | 10000.00 | bonus=— | taksit=— | döviz=— | Önceki dönem bakiyesi |", "last": "4 | 2026-09-17 | payment | -10000.00 | bonus=— | taksit=— | döviz=— | KREDI KARTI BORC ODEME |"})
  })
  it('yapikredi-card', () => {
    expectGolden('parseYapiKrediCard', F.yapiKrediCard(), {"bank": "yapikredi", "type": "credit_card", "provisional": false, "statementDate": "2026-10-18", "dueDate": "2026-10-28", "cards": ["1234"], "check": {"ok": true, "computed": 2000, "expected": 2000}, "count": 4, "total": 2000, "byKind": {"carry": [1, 1000], "payment": [1, -1000], "purchase": [2, 2000]}, "first": "0 | — | carry | 1000.00 | bonus=— | taksit=— | döviz=— | Önceki dönem bakiyesi |", "last": "3 | 2026-10-06 | purchase | 800.00 | bonus=— | taksit=2/5@4000.00 | döviz=— | ORNEK MAGAZA |"})
  })
  it('odeabank-card', () => {
    expectGolden('parseOdeabankCard', F.odeabankCard(), {"bank": "odeabank", "type": "credit_card", "provisional": false, "statementDate": "2026-09-24", "dueDate": "2026-10-05", "cards": ["1234"], "check": {"ok": true, "computed": 1642.72, "expected": 1642.72}, "count": 5, "total": 1642.72, "byKind": {"carry": [1, 500], "payment": [1, -500], "purchase": [3, 1642.72]}, "first": "0 | — | carry | 500.00 | bonus=— | taksit=— | döviz=— | Önceki dönem bakiyesi |", "last": "4 | 2026-09-02 | purchase | 1350.00 | bonus=— | taksit=— | döviz=— | NOMUPA /S SPORT PLUS |"})
  })
  it('odeabank-period', () => {
    expectGolden('parseOdeabankPeriod', F.odeabankPeriod(), {"bank": "odeabank", "type": "credit_card", "provisional": true, "statementDate": "2026-11-12", "dueDate": null, "cards": ["1234"], "check": {"ok": true, "computed": 6851.14, "expected": 6851.14}, "count": 7, "total": -37449.74, "byKind": {"purchase": [4, 8274.74], "payment": [2, -45511.53], "refund": [1, -212.95]}, "first": "0 | 2026-11-02 | purchase | 249.00 | bonus=— | taksit=— | döviz=— | NOMUPA /S SPORT PLUS |", "last": "6 | 2026-11-12 | refund | -212.95 | bonus=— | taksit=— | döviz=— | YEMEKSEPETIPAY /Yemeks |"})
  })
  it('odeabank-account', () => {
    expectGolden('parseOdeabankAccount', F.odeabankAccount(), {"bank": "odeabank", "type": "checking", "provisional": false, "statementDate": "2026-11-03", "dueDate": null, "cards": [], "check": {"ok": true, "computed": 208207.32, "expected": 208207.32}, "count": 4, "total": -208207.32, "byKind": {"credit": [2, -211852.54], "debit": [2, 3645.22]}, "first": "0 | 2026-11-01 | credit | -211667.06 | bonus=— | taksit=— | döviz=— | Banka: 0046 SN: 8361718 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk: Midas | saat=19:00 bakiye=211667.06", "last": "3 | 2026-11-03 | debit | 32.46 | bonus=— | taksit=— | döviz=— | Oksijen Devam Faizi - Gelir Vergisi Stopaj Kesintisi | saat=02:43 bakiye=208207.32"})
  })
  it('kuveyt-card', () => {
    expectGolden('parseKuveytCard', F.kuveytCard(), {"bank": "kuveyt", "type": "credit_card", "provisional": false, "statementDate": "2026-10-23", "dueDate": "2026-11-02", "cards": ["1234"], "check": {"ok": true, "computed": 1600, "expected": 1600}, "count": 4, "total": 1600, "byKind": {"carry": [1, 1350], "purchase": [2, 1600], "payment": [1, -1350]}, "first": "0 | — | carry | 1350.00 | bonus=— | taksit=— | döviz=— | Önceki dönem bakiyesi |", "last": "3 | 2026-10-10 | purchase | 250.00 | bonus=2.50 | taksit=— | döviz=— | MİGROS ERENKÖY |"})
  })
})
describe('altın çıktı: Kuveyt Türk ekran görüntüsü (OCR)', () => {
  it('kuveyt-period', () => {
    const st = parseKuveytScreenshot(F.kuveytScreenshot())!
    expect(parseScreenshot(F.kuveytScreenshot())).toEqual(st)
    const g = goldenSummary(st)
    expect(g).toMatchObject({ bank: 'kuveyt', provisional: true, check: { ok: true } })
    // Satır sayısı, tür başına toplamlar, ilk/son satır
    expect(g).toMatchSnapshot('özet')
    expect(st.lines.map(lineDigest)).toMatchSnapshot()
  })
})
