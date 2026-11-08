import { describe, it, expect } from 'vitest'
import type { Category, Person, Transaction } from '@/types'
import type { BatchOp } from '@/lib/sync/engine'
import type { ParsedStatement, StatementLine } from './statement'
import { addMonthsIso, bankInstallmentAmounts, buildImportPlan, type PlanInput } from './classify'
import { buildCommit } from './commit'
import { merchantKey, prettyMerchant } from './merchant'

const ACC = 'card-1'
const BANK = 'bank-1'

let n = 0
function line(p: Partial<StatementLine> & { description: string; amount: number | null }): StatementLine {
  return { index: n++, date: '2026-10-10', bonus: null, installment: null, foreign: null, kind: p.amount === null ? 'bonus' : p.amount < 0 ? 'refund' : 'purchase', ...p }
}

function statement(lines: StatementLine[]): ParsedStatement {
  lines.forEach((l, i) => { l.index = i })
  const sum = lines.reduce((s, l) => s + Math.round((l.amount ?? 0) * 100), 0) / 100
  return {
    bank: 'garanti', bankLabel: 'Garanti BBVA', type: 'credit_card', currency: 'TRY', cards: ['9010'],
    statementDate: '2026-10-30', dueDate: '2026-11-09', prevStatementDate: '2026-09-28', nextStatementDate: null, nextDueDate: null,
    summary: null, lines, check: { ok: true, computed: sum, expected: sum, diff: 0, issues: [] },
  }
}

const tx = (p: Partial<Transaction> & Pick<Transaction, 'id' | 'amount' | 'date'>): Transaction => ({
  type: 'expense', currency: 'TRY', accountId: ACC, description: 'x', isInstallment: false,
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', ...p,
})

const people: Person[] = [
  { id: 'p-ys', name: 'Yemeksepeti', role: 'recipient', createdAt: '' },
  { id: 'p-itc', name: 'iTC', role: 'recipient', createdAt: '' },
  { id: 'p-ikea', name: 'IKEA', role: 'recipient', createdAt: '' },
  { id: 'p-bank', name: 'Garanti Bankası', role: 'recipient', createdAt: '' },
]
const cat = (id: string, name: string): Category => ({ id, name, icon: '', color: '', scope: 'expense', isSystem: false, sortOrder: 0 })
const categories: Category[] = [cat('c-food', 'Yemek'), cat('c-hgs', 'HGS'), cat('c-ev', 'Ev'), cat('c-bank', 'Banka Giderleri')]

function plan(lines: StatementLine[], txs: Transaction[], extra: Partial<PlanInput> = {}) {
  return buildImportPlan({
    statement: statement(lines),
    account: { id: ACC, name: 'Garanti', currency: 'TRY', createdAt: '2026-07-15T00:00:00Z', type: 'credit_card' },
    accounts: [{ id: ACC, name: 'Garanti', type: 'credit_card', isArchived: false }, { id: BANK, name: 'Vadesiz', type: 'checking', isArchived: false }],
    transactions: [tx({ id: 'opening-marker', amount: 1, date: '2026-07-15', description: 'ilk' }), ...txs],
    people, categories, todayStr: '2026-11-01', ...extra,
  })
}

function commit(p: ReturnType<typeof plan>, txs: Transaction[], choices: Record<string, number> = {}, edits = {}) {
  let id = 0
  return buildCommit({
    rows: p.rows, choices, edits, accountId: ACC, existing: new Map(txs.map(t => [t.id, t])), people,
    nowIso: '2026-11-01T10:00:00.000Z', todayStr: '2026-11-01', newId: () => `new-${++id}`,
  })
}

const created = (ops: BatchOp[]) => ops.filter(o => o.kind === 'upsert' && o.table === 'transactions').map(o => (o as unknown as { entity: Transaction }).entity)

describe('yardımcılar', () => {
  it('bankanın taksit bölüşümü: kalan ilk taksitte, toplam korunur', () => {
    expect(bankInstallmentAmounts(1099.91, 3, 366.65)).toEqual([366.65, 366.63, 366.63])
    expect(bankInstallmentAmounts(11357.85, 6, 1893)).toEqual([1893, 1892.97, 1892.97, 1892.97, 1892.97, 1892.97])
  })
  it('ay ekleme kısa ayda ay sonuna sıkışır', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2026-09-16', -1)).toBe('2026-08-16')
  })
  it('işyeri adı ve okunur ad', () => {
    expect(merchantKey('IYZICO   *AMAZON.COM.T(2/3)')).toBe('iyzico *amazon.com.t')
    expect(prettyMerchant('PAYTR ODEME /AROASTINGLAB')).toBe('Aroastinglab')
    expect(prettyMerchant('WWW.İDEFİX.COM')).toBe('İdefix')
    expect(prettyMerchant('IYZICO/RUSTANDRICH.COM.TR')).toBe('Rustandrich')
  })
})

describe('eşleştirme', () => {
  it('aynı tutar ±4 gün → zaten var; bekleyen kayıt onaylanır, işyeri adı öğrenilir', () => {
    const t = tx({ id: 't1', amount: 500, date: '2026-10-12', approvalStatus: 'pending', recipientId: 'p-itc', categoryId: 'c-hgs', description: 'HGS' })
    const p = plan([line({ description: 'HGS-34ABC', amount: 500 })], [t])
    const r = p.rows[0]
    expect(r.status).toBe('exists')
    expect(r.sideEffects).toEqual([{ type: 'patch', txId: 't1', patch: { approvalStatus: 'approved', merchant: 'HGS-34ABC' } }])
  })

  it('öğrenilmiş işyeri: alıcı ve kategori geçmişten gelir', () => {
    const hist = [
      tx({ id: 'h1', amount: 500, date: '2026-08-01', merchant: 'HGS-34ABC', recipientId: 'p-itc', categoryId: 'c-hgs', description: 'HGS' }),
      tx({ id: 'h2', amount: 1355, date: '2026-08-05', merchant: 'HGS-34ABC', recipientId: 'p-itc', categoryId: 'c-hgs', description: 'HGS' }),
    ]
    const r = plan([line({ description: 'HGS-34ABC', amount: 700, date: '2026-10-25' })], hist).rows[0]
    expect(r.status).toBe('new')
    expect([r.recipientId, r.categoryId, r.categoryGuess, r.title]).toEqual(['p-itc', 'c-hgs', false, 'HGS'])
  })

  it('alıcı adı işyeri metninde geçiyorsa o alıcı önerilir', () => {
    const hist = [tx({ id: 'h1', amount: 300, date: '2026-08-01', recipientId: 'p-ys', categoryId: 'c-food', description: 'Dürümle' })]
    const r = plan([line({ description: 'IYZICO/YEMEKSEPETİ.COM', amount: 450 })], hist).rows[0]
    expect([r.status, r.recipientId, r.categoryId]).toEqual(['new', 'p-ys', 'c-food'])
  })

  it('bilinmeyen işyeri: yeni alıcı kararı istenir, kategori yoksa yazılamaz', () => {
    const p = plan([line({ description: 'İDDAALI BÜFE TEKEL', amount: 600 })], [])
    const r = p.rows[0]
    expect([r.status, r.kind, r.newRecipient]).toEqual(['review', 'unknown', true])
    expect(commit(p, []).problems).toEqual([{ rowKey: r.key, message: 'Karar verilmedi' }])
    expect(commit(p, [], { [r.key]: 0 }).problems[0].message).toBe('Kategori seçilmedi')
    const ok = commit(p, [], { [r.key]: 0 }, { [r.key]: { categoryId: 'c-food' } })
    expect(ok.problems).toEqual([])
    expect(ok.createdPeople.map(x => x.name)).toEqual(['İddaali Büfe Tekel'])
    expect(created(ok.ops)[0].recipientId).toBe('new-1')
  })

  it('iki ödeme satırı tek transferle eşleşir', () => {
    const t = tx({ id: 'pay', type: 'transfer', accountId: BANK, toAccountId: ACC, amount: 175130.15, date: '2026-10-11' })
    const p = plan([
      line({ description: 'ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', amount: -75130.15, kind: 'payment' }),
      line({ description: 'ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', amount: -100000, kind: 'payment' }),
    ], [t])
    expect(p.rows.map(r => r.status)).toEqual(['exists', 'exists'])
  })

  it('gelir tarafı eşleşmeyen ödeme karar ister, kaynak hesaptan transfer önerir', () => {
    const old = tx({ id: 'old', type: 'transfer', accountId: BANK, toAccountId: ACC, amount: 100, date: '2026-08-01' })
    const p = plan([line({ description: 'ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', amount: -5000, kind: 'payment' })], [old])
    const r = p.rows[0]
    expect([r.status, r.recommended]).toEqual(['review', null])
    const c = commit(p, [old], { [r.key]: 1 })
    expect(created(c.ops)[0]).toMatchObject({ type: 'transfer', accountId: BANK, toAccountId: ACC, amount: 5000 })
  })
})

describe('taksitler', () => {
  const inst = (k: number, date: string, amount: number) =>
    line({ description: 'IKEA-ÜMRANIYE MAĞAZA', amount, date, installment: { index: k, count: 3, total: 1099.91 } })

  it('yeni taksitli alım bankanın tutarlarıyla tüm taksitleri oluşturur; sonraki ay kimlikten bulunur', () => {
    const hist = [tx({ id: 'h', amount: 10, date: '2026-08-01', merchant: 'IKEA-ÜMRANIYE MAĞAZA', recipientId: 'p-ikea', categoryId: 'c-ev', description: 'IKEA' })]
    const p1 = plan([inst(1, '2026-10-11', 366.65)], hist)
    expect([p1.rows[0].status, p1.rows[0].kind]).toEqual(['new', 'installment-new'])
    const c1 = commit(p1, hist)
    const rows = created(c1.ops)
    expect(rows.map(r => [r.amount, r.date, r.installIndex])).toEqual([[366.65, '2026-10-11', 1], [366.63, '2026-11-11', 2], [366.63, '2026-12-11', 3]])
    expect(new Set(rows.map(r => r.installGroupId)).size).toBe(1)

    // Sonraki ekstre: 2. taksit (satır tarihi alım + 1 ay)
    const p2 = plan([inst(2, '2026-11-11', 366.63)], [...hist, ...rows])
    expect([p2.rows[0].status, p2.rows[0].reason]).toEqual(['exists', expect.stringContaining('daha önce içe aktarılmış')])
  })

  it('hesap açılışından önceki alımın taksiti açılış bakiyesindedir', () => {
    const r = plan([inst(5, '2026-08-14', 1455.82)], []).rows[0]
    expect([r.status, r.kind]).toEqual(['exists', 'opening'])
  })

  it('tek seferde girilmiş taksitli alım tanınır', () => {
    const lump = tx({ id: 'lump', amount: 1099.91, date: '2026-09-11', description: 'Toplu' })
    const r = plan([inst(2, '2026-10-11', 366.63)], [lump]).rows[0]
    expect([r.status, r.kind, r.match?.txIds]).toEqual(['exists', 'lump', ['lump']])
  })

  it('elle girilmiş taksit kuruş farkıyla eşleşir', () => {
    const t = tx({ id: 'm2', amount: 366.64, date: '2026-10-11', isInstallment: true, installIndex: 2, installTotal: 3, installGroupId: 'g' })
    const r = plan([inst(2, '2026-10-11', 366.63)], [t]).rows[0]
    expect([r.status, r.note]).toEqual(['exists', '0,01 ₺ kuruş farkı'])
  })

  it('iptal edilen taksitli alım: sistemdeki grup silinmek üzere önerilir', () => {
    const group = [1, 2, 3].map(k => tx({ id: `g${k}`, amount: 550, date: addMonthsIso('2026-09-28', k - 1), isInstallment: true, installIndex: k, installTotal: 3, installGroupId: 'G' }))
    const total = { index: 0, count: 3, total: 1650 }
    const p = plan([
      line({ description: 'BEYMEN', amount: -550, date: '2026-09-28', installment: { ...total, index: 1 } }),
      line({ description: 'BEYMEN', amount: 550, date: '2026-10-28', installment: { ...total, index: 2 } }),
      line({ description: 'BEYMEN', amount: -550, date: '2026-10-28', installment: { ...total, index: 2 } }),
    ], group)
    const cancel = p.rows.find(r => r.kind === 'cancel')!
    expect(cancel.recommended).toBe(0)
    expect(cancel.options[0].actions).toEqual([{ type: 'delete', txIds: ['g1', 'g2', 'g3'] }])
    const c = commit(p, group, { [cancel.key]: 0 })
    expect(c.deletedTxIds.sort()).toEqual(['g1', 'g2', 'g3'])
    expect(c.undo).toContainEqual({ kind: 'patchMany', table: 'transactions', ids: expect.arrayContaining(['g1', 'g2', 'g3']), patch: { deleted_at: null } })
  })

  it('iadesi düşülmüş net giriş: alım ve iade dizisi sistemdeki gruba bağlanır', () => {
    const group = [1, 2, 3].map(k => tx({ id: `n${k}`, amount: 700, date: addMonthsIso('2026-08-23', k - 1), isInstallment: true, installIndex: k, installTotal: 3, installGroupId: 'N' }))
    const p = plan([
      line({ description: 'AMAZON', amount: 1400, date: '2026-09-23', installment: { index: 2, count: 3, total: 4200 } }),
      line({ description: 'AMAZON', amount: -700, date: '2026-09-23', installment: { index: 2, count: 3, total: 2100 } }),
    ], group)
    expect(p.rows.map(r => [r.status, r.match?.txIds])).toEqual([['exists', ['n2']], ['exists', ['n2']]])
  })
})

describe('iade, net sıfır, ters kontrol', () => {
  it('aynı tutarda çekim + iade: ikisini de girmemek önerilir', () => {
    const p = plan([
      line({ description: 'LinkedIn Pre', amount: 2108.33, date: '2026-10-01' }),
      line({ description: 'LinkedIn Pre', amount: -2108.33, date: '2026-10-02' }),
    ], [])
    expect(p.rows).toHaveLength(1)
    expect([p.rows[0].kind, p.rows[0].recommended, p.rows[0].lines]).toEqual(['net-zero', 0, [0, 1]])
  })

  it('iade, aynı tutardaki alıma bağlanmayı önerir', () => {
    const orig = tx({ id: 'o', amount: 335, date: '2026-10-01', merchant: 'AMAZON', recipientId: 'p-ikea', categoryId: 'c-ev', description: 'Kedi kumu', tags: ['Ev'] })
    const p = plan([line({ description: 'AMAZON', amount: -335, date: '2026-10-20' })], [orig])
    const r = p.rows[0]
    expect([r.kind, r.issue]).toEqual(['refund', 'İade — asıl alım bulundu'])
    const made = created(commit(p, [orig], { [r.key]: 0 }).ops)[0]
    expect(made).toMatchObject({ amount: -335, refundOfId: 'o', description: '[İade] Kedi kumu', tags: ['Ev', 'İade'] })
  })

  it('ekstrede olmayan, bonusla ödenmiş kayıt silinmek üzere önerilir', () => {
    const t = tx({ id: 'eth', amount: 490, date: '2026-10-23', description: 'Ethem Et' })
    const p = plan([line({ description: 'BONUS BEDAVA ALIŞVERİŞ', amount: null, bonus: -490, date: '2026-10-23' })], [t])
    const orphan = p.rows.find(r => r.kind === 'orphan')!
    expect(orphan.recommended).toBe(1)
    expect(orphan.options[1].actions).toEqual([{ type: 'delete', txIds: ['eth'] }])
  })

  it('"girme" kararı hatırlanır', () => {
    const lines = [line({ description: 'BİLİNMEYEN YER', amount: 99 })]
    const p1 = plan(lines, [])
    const c = commit(p1, [], { [p1.rows[0].key]: 2 })
    expect(c.skippedKeys).toEqual([p1.rows[0].stableKey])
    const p2 = plan(lines, [], { skipped: new Set(c.skippedKeys) })
    expect(p2.rows[0].status).toBe('exists')
  })

  it('"Var olan alıcıyla gir": alıcı seçilmeden kayıt yok, seçilince o alıcıyla', () => {
    const lines = [line({ description: 'BİLİNMEYEN YER', amount: 99 })]
    const p1 = plan(lines, [])
    const row = p1.rows[0]
    expect(row.options.map(o => o.key)).toEqual(['create-new', 'create', 'skip', 'create-existing'])
    const i = row.options.findIndex(o => o.key === 'create-existing')
    const bare = commit(p1, [], { [row.key]: i }, { [row.key]: { categoryId: 'c-hgs' } })
    expect(bare.problems).toEqual([{ rowKey: row.key, message: 'Alıcı seçilmedi' }])
    const ok = commit(p1, [], { [row.key]: i }, { [row.key]: { categoryId: 'c-hgs', recipientId: 'p-itc' } })
    expect(ok.problems).toEqual([])
    expect(created(ok.ops)[0]).toMatchObject({ recipientId: 'p-itc', categoryId: 'c-hgs' })
  })

  it('aynı onay iki kez yazılsa da çift kayıt oluşmaz (kimlik satırdan türetilir)', () => {
    const hist = [tx({ id: 'h', amount: 5, date: '2026-08-01', merchant: 'HGS-1', recipientId: 'p-itc', categoryId: 'c-hgs', description: 'HGS' })]
    const lines = [line({ description: 'HGS-1', amount: 500, date: '2026-10-20' }), line({ description: 'HGS-1', amount: 500, date: '2026-10-20' })]
    const a = created(commit(plan(lines, hist), hist).ops)
    const b = created(commit(plan(lines, hist), hist).ops)
    expect(a.map(t => t.id)).toEqual(b.map(t => t.id))
    expect(new Set(a.map(t => t.id)).size).toBe(2)   // aynı gün iki ayrı geçiş
  })

  it('onaylanan ekstre tekrar yüklenince hiçbir değişiklik önerilmez', () => {
    const hist = [tx({ id: 'h', amount: 5, date: '2026-08-01', merchant: 'HGS-1', recipientId: 'p-itc', categoryId: 'c-hgs', description: 'HGS' })]
    const lines = [
      line({ description: 'HGS-1', amount: 500, date: '2026-10-20' }),
      line({ description: 'DÖNEM FAİZİ', amount: 12.5, date: null, kind: 'fee' }),
    ]
    const c = commit(plan(lines, hist), hist)
    const after = [...hist, ...created(c.ops)]
    const again = plan(lines, after)
    expect(again.rows.map(r => r.status)).toEqual(['exists', 'exists'])
    expect(again.rows.flatMap(r => r.sideEffects)).toEqual([])
    expect(commit(again, after).ops).toEqual([])
  })

  it('faiz satırı kesim tarihine, önceki aynı adlı kaydın alıcı/kategorisiyle', () => {
    const prev = tx({ id: 'f', amount: 46.86, date: '2026-09-09', description: 'Dönem Faizi', recipientId: 'p-bank', categoryId: 'c-bank' })
    const r = plan([line({ description: 'DÖNEM FAİZİ', amount: 1630.89, date: null, kind: 'fee' })], [prev]).rows[0]
    expect([r.status, r.title, r.date, r.recipientId, r.categoryId]).toEqual(['new', 'Dönem Faizi', '2026-10-30', 'p-bank', 'c-bank'])
  })
})

describe('alacak satırı gelir olarak (cashback)', () => {
  it('karttaki "indirim" gelirinden öğrenir; yeni indirim satırı aynı gelir olarak girilir', () => {
    const cashback = tx({ id: 'cb', type: 'income', amount: 37.45, date: '2026-10-05', description: 'Yemek Cashback', recipientId: 'p-bank', categoryId: 'c-bank' })
    const p = plan([
      line({ date: '2026-10-05', description: 'YEMEKPAY /YEMEKSEPE 337.05 alşv ind', amount: -37.45 }),
      line({ date: '2026-10-12', description: 'YEMEKPAY /YEMEKSEPE 414.00 alşv ind', amount: -46 }),
    ], [cashback])
    expect(p.rows[0]).toMatchObject({ status: 'exists' })
    expect(p.rows[0].sideEffects).toEqual([{ type: 'patch', txId: 'cb', patch: { merchant: 'YEMEKPAY /YEMEKSEPE 337.05 alşv ind' } }])
    const r = p.rows[1]
    expect(r).toMatchObject({ status: 'new', kind: 'income', title: 'Yemek Cashback' })
    const made = created(commit(p, [cashback]).ops)
    expect(made.map(t => [t.type, t.amount, t.accountId, t.description, t.recipientId, t.categoryId])).toEqual([['income', 46, ACC, 'Yemek Cashback', 'p-bank', 'c-bank']])
  })

  it('alıcı adı kelime olarak aranır: "Aksi" alıcısı "BITAKSI" değildir', () => {
    expect(prettyMerchant('BITAKSI 34 TR')).toBe('Bitaksi')
    expect(prettyMerchant('Uber Eats Yemek İSTANBUL TRTR')).toBe('Uber Eats Yemek')
    const p = plan([line({ description: 'BITAKSI 34 TR', amount: 467 })], [], {
      people: [...people, { id: 'p-aksi', name: 'Aksi', role: 'recipient', createdAt: '' }],
    })
    expect(p.rows[0]).toMatchObject({ kind: 'unknown', recipientName: 'Bitaksi' })
  })
})

describe('öğrenilmemiş indirim satırı', () => {
  it('kartta en sık girilen gelir biçimi önerilir, karar sorulur', () => {
    const old = [1, 2, 3].map(i => tx({ id: `cb${i}`, type: 'income', amount: 10 * i, date: `2026-08-0${i}`, description: 'Yemek Cashback', recipientId: 'p-bank', categoryId: 'c-bank' }))
    const r = plan([line({ date: '2026-10-12', description: 'Uber Eats Yemek İSTANBU Indirim', amount: -54.7 })], old).rows[0]
    expect(r).toMatchObject({ status: 'review', kind: 'income', title: 'Yemek Cashback', recommended: 0, issue: 'İndirim satırı' })
  })
  it('gelir olarak girilmiş kart ödemeleri öneri olmaz (daha sık olsalar da)', () => {
    const pays = [1, 2, 3, 4].map(i => tx({ id: `pay${i}`, type: 'income', amount: 1000 * i, date: `2026-0${i + 4}-12`, description: 'Kredi Kartı Ödemesi' }))
    // Kategorili olsa da bu ekstrede ödeme satırıyla eşleşen gelir de sayılmaz
    const paid = tx({ id: 'pay-cat', type: 'income', amount: 500, date: '2026-10-05', description: 'Kart ödemesi', categoryId: 'c-bank' })
    // Tek cashback kaydı: eşitlikte önce gelen ödeme kaydı kazanırdı
    const cb = tx({ id: 'cb1', type: 'income', amount: 10, date: '2026-08-01', description: 'Yemek Cashback', recipientId: 'p-bank', categoryId: 'c-bank' })
    const p = plan([
      line({ date: '2026-10-05', description: 'ÖDEME-İNTERNET BANKACILIĞI', amount: -500, kind: 'payment' }),
      line({ date: '2026-10-12', description: 'Uber Eats Yemek İSTANBU Indirim', amount: -54.7 }),
    ], [...pays, paid, cb])
    expect(p.rows.find(r => r.kind === 'income')).toMatchObject({ status: 'review', title: 'Yemek Cashback' })
  })
})

describe('işyeri adı ve ödeme', () => {
  it('"Tur" gibi kelimeler ülke kodu sayılıp atılmaz', () => {
    expect(prettyMerchant('JOLLY TUR')).toBe('Jolly Tur')
  })
  it('kaynak hesapsız "gelir" olarak girilmiş kart ödemesi ödeme satırıyla eşleşir', () => {
    const pay = tx({ id: 'pay-inc', type: 'income', amount: 4146.64, date: '2026-10-12', description: 'Kredi Kartı Ödemesi' })
    const p = plan([line({ date: '2026-10-12', description: 'ÖDEME-İNTERNET BANKACILIĞI', amount: -4146.64, kind: 'payment' })], [pay])
    expect(p.rows[0]).toMatchObject({ status: 'exists', match: { txIds: ['pay-inc'] } })
  })
})
