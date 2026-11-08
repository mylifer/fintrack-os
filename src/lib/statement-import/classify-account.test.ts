import { describe, it, expect } from 'vitest'
import type { Account, Category, Person, Transaction } from '@/types'
import type { ParsedStatement, StatementLine } from './statement'
import { analyzeLine, buildAccountPlan } from './classify-account'
import { buildCommit } from './commit'
import { txIdFromSeed, type DraftTx, type ImportPlan, type PlanRow } from './classify'

const A = 'acc-nakit'
const accounts = [
  { id: A, name: 'Nakit', type: 'checking', isArchived: false },
  { id: 'card-yk', name: 'Yapı Kredi Platinum', type: 'credit_card', isArchived: false },
  { id: 'card-odea', name: 'Odeabank Kredi Kartı', type: 'credit_card', isArchived: false },
] as Pick<Account, 'id' | 'name' | 'type' | 'isArchived'>[]
const account = { id: A, name: 'Nakit', currency: 'TRY', createdAt: '2026-01-01', type: 'checking' } as Pick<Account, 'id' | 'name' | 'currency' | 'createdAt' | 'type'>
const people: Person[] = [
  { id: 'p-ali', name: 'Ali Kaya', role: 'recipient', createdAt: '' },
  { id: 'p-odea', name: 'Odeabank', role: 'recipient', createdAt: '' },
  { id: 'p-itc', name: 'iTC', role: 'recipient', createdAt: '' },
]
const categories = [
  { id: 'c-kira', name: 'Kira', scope: 'expense' },
  { id: 'c-faiz', name: 'Faiz', scope: 'income' },
  { id: 'c-vergi', name: 'Vergi', scope: 'expense' },
] as Category[]

// [tarih, saat, + çıkış / − giriş, açıklama]
type L = [string, string, number, string]
function statement(rows: L[]): ParsedStatement {
  const lines: StatementLine[] = rows.map(([date, time, amount, description], index) => ({
    index, date, time, amount, description, bonus: null, installment: null, foreign: null, kind: amount > 0 ? 'debit' : 'credit',
  }))
  return {
    bank: 'odeabank', bankLabel: 'Odeabank', type: 'checking', currency: 'TRY', cards: [],
    statementDate: '2026-10-31', dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null,
    lines, check: { ok: true, computed: 0, expected: 0, diff: 0, issues: [] },
    account: { iban: 'TR09', owner: 'AYŞE YILMAZ', periodStart: '2026-10-01', periodEnd: '2026-10-31', openingBalance: 0, closingBalance: 0 },
  }
}

let n = 0
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>): Transaction {
  return { id: `t${++n}`, currency: 'TRY', accountId: A, description: '', isInstallment: false, createdAt: '', ...p } as Transaction
}

const plan = (rows: L[], transactions: Transaction[], skipped?: Set<string>): ImportPlan =>
  buildAccountPlan({ statement: statement(rows), account, accounts, transactions, people, categories, todayStr: '2026-11-03', skipped })
const row = (p: ImportPlan, i: number): PlanRow => p.rows.find(r => r.lines.includes(i))!
const draftOf = (r: PlanRow, opt = r.recommended ?? 0): DraftTx => (r.options[opt].actions[0] as { draft: DraftTx }).draft

describe('analyzeLine', () => {
  it('karşı tarafı ve türü tanır', () => {
    expect(analyzeLine('Oksijen Devam Faizi - Vadesizden Vadeliye Aktarım', 'AYŞE YILMAZ').type).toBe('sweep')
    expect(analyzeLine('%36,00 Oksijen Devam Faizi - Faizi %', 'AYŞE YILMAZ').type).toBe('interest')
    expect(analyzeLine('Oksijen Devam Faizi - Gelir Vergisi Stopaj Kesintisi', 'AYŞE YILMAZ').type).toBe('tax')
    expect(analyzeLine('Banka: 0067 SN: 6385 Ayşe yılmaz Açk: 3612.76 TRY Gönd.', 'AYŞE YILMAZ')).toMatchObject({ type: 'own', label: 'Ayşe Yılmaz · Yapı Kredi', bankCode: '0067' })
    expect(analyzeLine('Banka: 0046 SN: 836 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk: Midas', 'AYŞE YILMAZ')).toMatchObject({ type: 'broker', label: 'Midas Menkul Değerler' })
    expect(analyzeLine('Banka: 0010 SN: 6200 Mehmet Ali Kaya Açk: Kira bedeli', 'AYŞE YILMAZ')).toMatchObject({ type: 'person', label: 'Mehmet Ali Kaya' })
    expect(analyzeLine('KK HESAPTAN ÖDEME6218.86 TRY 512345******1234 Nolu KKna yapılan', 'AYŞE YILMAZ')).toMatchObject({ type: 'card', card4: '1234' })
    expect(analyzeLine('Fon Alış:807Pay x 5.567806000000-ZBJ-ZİRAAT PORTFÖY', 'AYŞE YILMAZ')).toMatchObject({ type: 'fund', label: 'Fon alımı ZBJ' })
  })
})

describe('buildAccountPlan', () => {
  it('birebir eşleşir, öğrenir; içe aktarılan satır kimliğiyle bulunur', () => {
    const kira = tx({ type: 'expense', amount: 70000, date: '2026-10-06', description: 'Kira', recipientId: 'p-ali', categoryId: 'c-kira' })
    const p = plan([['2026-10-06', '13:58', 70000, 'Banka: 0010 SN: 63 Mehmet Ali Kaya Açk: Kira bedeli']], [kira])
    const r = row(p, 0)
    expect(r.status).toBe('exists')
    expect(r.match!.txIds).toEqual([kira.id])
    expect(r.sideEffects).toEqual([{ type: 'patch', txId: kira.id, patch: { merchant: 'Mehmet Ali Kaya' } }])

    // Bir sonraki ay: aynı karşı taraf geçmişteki gibi önerilir
    const learned = { ...kira, merchant: 'Mehmet Ali Kaya' }
    const p2 = plan([['2026-11-06', '10:00', 67000, 'Banka: 0010 SN: 99 Mehmet Ali Kaya Açk: Kira']], [learned])
    const r2 = row(p2, 0)
    expect(r2.status).toBe('new')
    expect(draftOf(r2)).toMatchObject({ type: 'expense', amount: 67000, description: 'Kira', recipientId: 'p-ali', categoryId: 'c-kira' })

    // Yazıldıktan sonra aynı döküm tekrar yüklenirse satır kimliğiyle bulunur
    const imported = tx({ id: txIdFromSeed(draftOf(r2).idSeed), type: 'expense', amount: 67000, date: '2026-11-20' })
    expect(row(plan([['2026-11-06', '10:00', 67000, 'Banka: 0010 SN: 99 Mehmet Ali Kaya Açk: Kira']], [learned, imported]), 0).status).toBe('exists')
  })

  it('Oksijen aktarımı ve fon alımı kayda girmez; takip dışı hesaptan gelen para da', () => {
    const p = plan([
      ['2026-10-05', '01:18', 4747.59, 'Oksijen Devam Faizi - Vadesizden Vadeliye Aktarım'],
      ['2026-10-06', '02:54', -4747.59, 'Oksijen Devam Faizi - Vadesize Dönen Anapara'],
      ['2026-10-07', '10:49', 49992.31, 'Fon Alış:9,488Pay x 5.269004000000-ZBJ-ZİRAAT PORTFÖY BAŞAK PARA PİYASASI (TL) FONU'],
      ['2026-10-08', '17:05', -50000, 'Banka: 0157 SN: 48005 Ayşe Yılmaz Açk:'],
    ], [])
    expect(p.rows.map(r => r.status)).toEqual(['info', 'info', 'info', 'info'])
    expect(row(p, 3).kind).toBe('untracked')
  })

  it('aracı kurum girişi = satış + kâr − stopaj; karşılığı yoksa girilmez', () => {
    const sale = [
      tx({ type: 'income', amount: 66667.34, date: '2026-10-06', description: '32.882 TP2 Satışı' }),
      tx({ type: 'income', amount: 3332.58, date: '2026-10-06', description: 'TP2 Satış Kârı' }),
      tx({ type: 'expense', amount: 980.81, date: '2026-10-06', description: 'Stopaj' }),
    ]
    const p = plan([
      ['2026-10-06', '17:02', -69019.12, 'Banka: 0046 SN: 2071822 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk: Midas'],
      ['2026-10-30', '19:00', -84625.27, 'Banka: 0046 SN: 8361718 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk: Midas'],
    ], sale)
    expect(row(p, 0)).toMatchObject({ status: 'exists', kind: 'investment' })
    expect(row(p, 0).match!.txIds.sort()).toEqual(sale.map(t => t.id).sort())
    const r = row(p, 1)
    expect(r.status).toBe('review')
    expect(r.options.map(o => o.actions.length)).toEqual([0])
    expect(r.reason).toContain('Yatırımlar')
  })

  it('iki havaleyle yapılan tek kart ödemesi eşleşir', () => {
    const pay = tx({ type: 'transfer', amount: 175130.15, date: '2026-10-21', accountId: A, toAccountId: 'card-yk', description: 'Kredi Kartı Ödemesi' })
    const p = plan([
      ['2026-10-20', '20:50', 100000, 'Banka: 0062 SN: 61 Elif yılmaz Açk: Borç 100000.00 TRY Gönd.'],
      ['2026-10-20', '20:51', 75130.15, 'Banka: 0062 SN: 62 Elif yılmaz Açk: Borç 75130.15 TRY Gönd.'],
    ], [pay])
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0]).toMatchObject({ status: 'exists', lines: [0, 1], note: '2 satır tek kayıt' })
  })

  it('faiz brüt gelir, stopaj gider olarak; kendi kartına ödeme transfer olarak önerilir', () => {
    const p = plan([
      ['2026-10-14', '02:42', -22.27, '%36,00 Oksijen Devam Faizi - Faizi %'],
      ['2026-10-14', '02:42', 3.9, 'Oksijen Devam Faizi - Gelir Vergisi Stopaj Kesintisi'],
      ['2026-10-15', '09:00', 6218.86, 'KK HESAPTAN ÖDEME6218.86 TRY 512345******1234 Nolu KKna yapılan HESAPTAN ödeme.'],
    ], [])
    expect(row(p, 0).status).toBe('new')
    expect(draftOf(row(p, 0))).toMatchObject({ type: 'income', amount: 22.27, description: 'Faiz', recipientId: 'p-odea', categoryId: 'c-faiz' })
    expect(draftOf(row(p, 1))).toMatchObject({ type: 'expense', amount: 3.9, description: 'Stopaj', recipientId: 'p-itc', categoryId: 'c-vergi' })
    const card = row(p, 2)
    expect(card.status).toBe('review')
    expect(card.recommended).toBe(0)
    expect(draftOf(card)).toMatchObject({ type: 'transfer', amount: 6218.86, toAccountId: 'card-odea' })

    // Yazım: gelir, gider ve hesaptan çıkan transfer
    const res = buildCommit({ rows: p.rows, choices: { [card.key]: card.options[0].key }, edits: {}, accountId: A, existing: new Map(), people, nowIso: '2026-11-03T00:00:00Z', todayStr: '2026-11-03' })
    expect(res.problems).toEqual([])
    const made = res.ops.filter(o => o.kind === 'upsert').map(o => (o as unknown as { entity: Transaction }).entity)
    expect(made.map(t => [t.type, t.amount, t.accountId, t.toAccountId ?? null])).toEqual([
      ['income', 22.27, A, null],
      ['expense', 3.9, A, null],
      ['transfer', 6218.86, A, 'card-odea'],
    ])
  })

  it('farklı tarihli aynı tutar: karar sorulur, "aynı kayıt" tarihi düzeltir', () => {
    const fee = tx({ type: 'expense', amount: 4500, date: '2026-10-08', description: 'Muhasebe Ücreti' })
    const p = plan([['2026-10-18', '18:35', 4500, 'Banka: 0064 SN: 62 Can Demir Açk: 4500.00 TRY Gönd.']], [fee])
    const r = row(p, 0)
    expect(r).toMatchObject({ status: 'review', kind: 'possible-dup', recommended: 0 })
    expect(r.options[0].actions).toEqual([{ type: 'patch', txId: fee.id, patch: { date: '2026-10-18', merchant: 'Can Demir' } }])
  })

  it('aynı dakikada iki eş satır ayrı kimlik alır; tekrar yüklemede ikisi de ayrı eşleşir', () => {
    const atm: L[] = [
      ['2026-10-21', '10:00', 100, 'ATM PARA ÇEKME-9900'],
      ['2026-10-21', '10:00', 100, 'ATM PARA ÇEKME-9900'],
    ]
    const p = plan(atm, [])
    const [a, b] = [row(p, 0), row(p, 1)]
    expect(a.stableKey).not.toBe(b.stableKey)
    // İlk satır eski tohumu korur (önceki yüklemeler eşleşmeye devam eder)
    expect(draftOf(a).idSeed).toMatch(new RegExp(`^acct:${A}:2026-10-21:10:00:10000:[^:]+$`))
    expect(draftOf(b).idSeed).toBe(`${draftOf(a).idSeed}:1`)

    const res = buildCommit({ rows: p.rows, choices: { [a.key]: a.options[0].key, [b.key]: b.options[0].key }, edits: { [a.key]: { categoryId: 'c-kira' }, [b.key]: { categoryId: 'c-kira' } }, accountId: A, existing: new Map(), people, nowIso: '2026-11-03T00:00:00Z', todayStr: '2026-11-03' })
    expect(res.problems).toEqual([])
    const made = res.ops.filter(o => o.kind === 'upsert').map(o => (o as unknown as { entity: Transaction }).entity)
    expect(made).toHaveLength(2)
    expect(new Set(made.map(t => t.id)).size).toBe(2)

    const again = plan(atm, made)
    expect(row(again, 0)).toMatchObject({ status: 'exists', match: { txIds: [made[0].id] } })
    expect(row(again, 1)).toMatchObject({ status: 'exists', match: { txIds: [made[1].id] } })
    expect(again.rows.filter(r => r.kind === 'orphan')).toEqual([])
  })

  it('sistemde olup dökümde olmayan kayıt sorulur; "kalsın" kararı hatırlanır', () => {
    const odd = tx({ type: 'income', amount: 7.91, date: '2026-10-20', description: 'Hibe' })
    const p = plan([['2026-10-21', '10:00', 100, 'ATM PARA ÇEKME-9900']], [odd])
    const orphan = p.rows.find(r => r.kind === 'orphan')!
    expect(orphan).toMatchObject({ status: 'review', recommended: 0, issue: 'Sistemde var, dökümde yok' })
    const again = plan([['2026-10-21', '10:00', 100, 'ATM PARA ÇEKME-9900']], [odd], new Set([orphan.stableKey]))
    expect(again.rows.find(r => r.kind === 'orphan')!.status).toBe('exists')
  })
})
