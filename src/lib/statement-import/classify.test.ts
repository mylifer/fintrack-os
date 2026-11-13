import { describe, it, expect } from 'vitest'
import type { Category, Person, Transaction } from '@/types'
import type { BatchOp } from '@/lib/sync/engine'
import type { ParsedStatement, StatementLine } from './statement'
import { addMonthsIso, bankInstallmentAmounts, buildImportPlan, type PlanInput } from './classify'
import { buildCommit, remapByStableKey, rowTitle } from './commit'
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

/** Kararlar testte seçenek indeksiyle verilir; buildCommit seçenek anahtarı bekler */
function commit(p: ReturnType<typeof plan>, txs: Transaction[], choices: Record<string, number> = {}, edits = {}) {
  let id = 0
  const keys = Object.fromEntries(Object.entries(choices).map(([k, i]) => [k, p.rows.find(r => r.key === k)!.options[i].key]))
  return buildCommit({
    rows: p.rows, choices: keys, edits, accountId: ACC, existing: new Map(txs.map(t => [t.id, t])), people,
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
    expect(prettyMerchant('PAYTR /THECHAMP')).toBe('Thechamp')
    expect(prettyMerchant('MONEYPAY/MIGROSONE ISTANBUL TR')).toBe('Migrosone')
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
    const hist = [tx({ id: 'h', amount: 10, date: '2026-08-01', merchant: 'KOÇTAŞ-ÜMRANİYE MAĞAZA', recipientId: 'p-ikea', categoryId: 'c-ev', description: 'IKEA' })]
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

  it('dönem içi listede taksit bilgisi olmayan satır sistemdeki taksitle eşleşir', () => {
    const inst = tx({ id: 'i4', amount: 3902.14, date: '2026-10-03', isInstallment: true, installIndex: 4, installTotal: 8, installGroupId: 'G8' })
    const lines = [line({ description: 'PARATIKA/FIBASIGORTA', amount: 3902.14, date: '2026-10-03' })]
    const prov = plan(lines, [inst], { statement: { ...statement(lines), provisional: true } })
    expect(prov.rows[0].match?.txIds).toEqual(['i4'])
    // Kesilmiş ekstrede taksit bilgisi her zaman var: bilgisiz satır taksite bağlanmaz
    expect(plan(lines, [inst]).rows[0].match?.txIds).not.toEqual(['i4'])
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

describe('akıllı alıcı ve kategori eşleştirme', () => {
  const vet: Person = { id: 'p-vet', name: 'Özel Duru Veteriner', role: 'recipient', createdAt: '' }
  const migros: Person = { id: 'p-migros', name: 'Migros', role: 'recipient', createdAt: '' }
  const hb: Person = { id: 'p-hb', name: 'Hepsiburda', role: 'recipient', createdAt: '' }
  const more = [...people, vet, migros, hb]
  const cats = [...categories, cat('c-market', 'Market'), cat('c-pet', 'Evcil Hayvan'), cat('c-giyim', 'Giyim')]
  const p2 = (lines: StatementLine[], txs: Transaction[]) => plan(lines, txs, { people: more, categories: cats })

  it('kesik ve aracılı yazım kayıtlı alıcıya gider (yeni alıcı sanılmaz)', () => {
    const hist = [tx({ id: 'h1', amount: 900, date: '2026-08-01', recipientId: 'p-vet', categoryId: 'c-pet', description: 'Aşı' })]
    const rows = p2([
      line({ description: 'OZEL DURU VETERINERL ISTANBUL TR', amount: 2500 }),
      line({ description: 'MONEYPAY/MIGROSONE ISTANBUL TR', amount: 273.8 }),
      line({ description: 'YEMEKSEPETIPAY/YEMEKSEPISTANBUL', amount: 260 }),
    ], hist).rows
    expect(rows.map(r => [r.status, r.recipientId])).toEqual([['new', 'p-vet'], ['new', 'p-migros'], ['new', 'p-ys']])
    expect(rows[0].categoryId).toBe('c-pet')
  })

  it('başka bankanın yazımı geçmişteki aynı işyerini bulur', () => {
    const hist = [tx({ id: 'h1', amount: 120, date: '2026-08-01', merchant: 'ÖZEL DURU VETERİNERL', recipientId: 'p-itc', categoryId: 'c-pet', description: 'Mama' })]
    const r = p2([line({ description: 'OZEL DURU VETERINERL ISTANBUL TR', amount: 2500 })], hist).rows[0]
    expect([r.status, r.recipientId, r.categoryId]).toEqual(['new', 'p-itc', 'c-pet'])
    expect(r.reason).toContain('ÖZEL DURU VETERİNERL')
  })

  it('aynı markanın başka şubesi markanın alıcısına gider', () => {
    const hist = [
      tx({ id: 'h1', amount: 100, date: '2026-08-01', merchant: 'KOÇTAŞ-ÜMRANİYE MAĞAZA', recipientId: 'p-itc', categoryId: 'c-ev', description: 'Raf' }),
      tx({ id: 'h2', amount: 200, date: '2026-08-03', merchant: 'KOCTAS BAYRAMPASA', recipientId: 'p-itc', categoryId: 'c-ev', description: 'Lamba' }),
    ]
    const r = p2([line({ description: 'KOÇTAŞ-KARTAL MAĞAZASI', amount: 826.65 })], hist).rows[0]
    expect([r.status, r.recipientId, r.categoryId]).toEqual(['new', 'p-itc', 'c-ev'])
    expect(r.title).toBe('iTC')   // ürün açıklaması şubeye taşınmaz
  })

  it('emin olunamayan benzerlik sorulur: önerilen alıcı, yeni alıcı, girme, başka alıcı', () => {
    const p = p2([line({ description: 'HEPSİPAY-HEP*HEPSİBURADA', amount: 325.12 })], [])
    const r = p.rows[0]
    expect([r.status, r.kind, r.recipientId, r.recommended, r.issue]).toEqual(['review', 'purchase', 'p-hb', 0, 'Alıcı “Hepsiburda” mı?'])
    expect(r.options.map(o => o.key)).toEqual(['create-guess', 'create-new', 'skip', 'create-existing'])
    const ok = commit(p, [], { [r.key]: 0 }, { [r.key]: { categoryId: 'c-market' } })
    expect(created(ok.ops)[0].recipientId).toBe('p-hb')
    const fresh = commit(p, [], { [r.key]: 1 }, { [r.key]: { categoryId: 'c-market' } })
    expect(fresh.createdPeople.map(x => x.name)).toEqual(['Hepsiburada'])
  })

  it('bankanın kategorisi: önce bu ekstrede eşleşen satırlardan, yoksa kategori adından', () => {
    const hist = [tx({ id: 'm1', amount: 40, date: '2026-10-10', categoryId: 'c-food', description: 'Fırın' })]
    const rows = p2([
      line({ description: 'FIRINCI', amount: 40, bankCategory: 'Yeme / İçme' }),         // sistemde var → öğretir
      line({ description: 'SMOOK CAFE GIDA', amount: 900, bankCategory: 'Yeme / İçme' }), // öğrenilenden
      line({ description: 'HAKMAR LTD', amount: 338.55, bankCategory: 'Market' }),        // ad benzerliğinden
      line({ description: 'TRENDYOL', amount: 99, bankCategory: 'Diğer' }),               // eşlenmez
    ], hist).rows
    expect(rows.map(r => [r.status, r.categoryId, r.categoryGuess]).slice(1)).toEqual([
      ['review', 'c-food', true], ['review', 'c-market', true], ['review', undefined, false],
    ])
    expect(rows[1].reason).toContain('“Yeme / İçme”')
  })

  it('rastlantısal benzerlik yeni alıcı olarak kalır', () => {
    const r = p2([line({ description: 'DÜRÜMLE ISTANBUL TR', amount: 442 })], []).rows[0]
    expect([r.kind, r.newRecipient]).toEqual(['unknown', true])
  })
})

describe('alacak satırını gelir olarak girme', () => {
  const income: Category = { id: 'c-inc', name: 'Vergi İadesi', icon: '', color: '', scope: 'income', isSystem: false, sortOrder: 0 }
  const cats = [...categories, income]

  it('her iade satırında "Gelir olarak gir" var; gelir kategorisiyle yazılır ve sonraki ekstrede öğrenilmiş olur', () => {
    const l = line({ description: 'Yurt Disi Cikis Harc Iadesi', amount: -1250, date: '2026-10-20' })
    const p = plan([l], [], { categories: cats })
    const r = p.rows[0]
    expect(r.kind).toBe('refund')
    const i = r.options.findIndex(o => o.key === 'income')
    expect(i).toBeGreaterThan(-1)
    const draft = (r.options[i].actions[0] as { draft: { type: string; amount: number } }).draft
    expect([draft.type, draft.amount]).toEqual(['income', 1250])
    expect(commit(p, [], { [r.key]: i }).problems[0].message).toBe('Kategori seçilmedi')
    const ok = commit(p, [], { [r.key]: i }, { [r.key]: { categoryId: 'c-inc' } })
    expect(ok.problems).toEqual([])
    const made = created(ok.ops)[0]
    expect([made.type, made.amount, made.categoryId]).toEqual(['income', 1250, 'c-inc'])

    // Liste başlığı seçilen karara uyar: iade "[İade] …", gelir öneksiz, elle yazılan her zaman
    expect(rowTitle(r, {})).toBe(r.title)
    expect(rowTitle(r, { [r.key]: 'standalone' })).toBe('[İade] Yurt Disi Cikis Harc Iadesi')
    expect(rowTitle(r, { [r.key]: 'income' })).toBe('Yurt Disi Cikis Harc Iadesi')
    expect(rowTitle(r, { [r.key]: 'income' }, { description: 'Harç iadesi' })).toBe('Harç iadesi')

    // Sonraki ekstre: aynı satır kendiliğinden gelir olarak önerilir
    const next = plan([line({ description: 'Yurt Disi Cikis Harc Iadesi', amount: -1250, date: '2026-10-27' })], [made], { categories: cats }).rows[0]
    expect([next.status, next.kind, next.categoryId]).toEqual(['new', 'income', 'c-inc'])
  })
})

describe('yarım kalan ekstre yeniden okununca', () => {
  it('kararlar satır sırasıyla değil satırın kimliğiyle taşınır; karşılığı olmayan atılır', () => {
    const a = () => line({ description: 'İDDAALI BÜFE TEKEL', amount: 600, date: '2026-10-05' })
    const b = () => line({ description: 'ORNEK KAFE', amount: 80, date: '2026-10-06' })
    const old = plan([a(), b()], [])
    // Okuyucu düzeltmesiyle araya (ikinci sayfadan) yeni satır girdi, sıra kaydı
    const fresh = plan([line({ description: 'KART BORC ODEMESI', amount: -500, date: '2026-10-01', kind: 'payment' }), a(), b()], [])
    const [ka, kb] = [old.rows[0].key, old.rows[1].key]
    const choices = { [ka]: 'create-new', [kb]: 'skip', L99: 'create' }
    const moved = remapByStableKey(old.rows, fresh.rows, choices)
    const rowOf = (desc: string) => fresh.rows.find(r => r.raw === desc)!.key
    expect(moved).toEqual({ [rowOf('İDDAALI BÜFE TEKEL')]: 'create-new', [rowOf('ORNEK KAFE')]: 'skip' })
    expect(rowOf('İDDAALI BÜFE TEKEL')).not.toBe(ka)
  })
})

describe('satır penceresinden etiket / abonelik', () => {
  it('düzenlemedeki etiketler (abonelik) kayda yazılır', () => {
    const p = plan([line({ description: 'NETFLIX.COM', amount: 229.99 })], [])
    const r = p.rows[0]
    const c = commit(p, [], { [r.key]: 0 }, { [r.key]: { categoryId: 'c-food', tags: ['abonelik'] } })
    expect(c.problems).toEqual([])
    expect(created(c.ops)[0].tags).toEqual(['abonelik'])
  })
})

describe('iadeyi alıma bağlama (satırın altında seçim)', () => {
  const hist = [
    tx({ id: 'a1', amount: 4143.78, date: '2026-09-18', merchant: 'IYZICO *AMAZON.COM.T', recipientId: 'p-ys', categoryId: 'c-ev', description: 'Mutfak robotu', tags: ['ev'] }),
    tx({ id: 'a2', amount: 2350, date: '2026-09-12', merchant: 'IYZICO *AMAZON.COM.T', recipientId: 'p-ys', categoryId: 'c-food', description: 'Koşu ayakkabısı' }),
    tx({ id: 'a3', amount: 410.16, date: '2026-09-30', merchant: 'IYZICO *AMAZON.COM.T', recipientId: 'p-ys', categoryId: 'c-food', description: 'Kitap' }),
    tx({ id: 'o1', amount: 3199, date: '2026-10-05', merchant: 'HEPSIPAY', recipientId: 'p-itc', categoryId: 'c-ev', description: 'Süpürge' }),
  ]
  const refund = () => line({ description: 'IYZICO *AMAZON.COM.T', amount: -1996.36, date: '2026-10-20' })

  it('aynı işyerinin iadeden küçük olmayan alımları aday; diğer alımlar "Diğer…" listesinde', () => {
    const r = plan([refund()], hist).rows[0]
    expect(r.options.map(o => o.key)).toEqual(['link', 'standalone', 'income', 'skip'])
    expect(r.options[r.recommended!].key).toBe('standalone')
    expect(r.refundLink!.candidates.map(c => c.txId)).toEqual(['a1', 'a2'])
    expect(r.refundLink!.more.map(c => c.txId)).toEqual(['o1'])
  })

  it('alım seçilmeden kayıt yapılmaz; seçilen alımın açıklaması, alıcısı, kategorisi ve etiketleri iadeye geçer', () => {
    const p = plan([refund()], hist)
    const r = p.rows[0]
    const mine = (c: ReturnType<typeof commit>) => c.problems.filter(x => x.rowKey === r.key)
    expect(mine(commit(p, hist, { [r.key]: 0 }))[0].message).toBe('İadenin bağlanacağı alım seçilmedi')
    const c = commit(p, hist, { [r.key]: 0 }, { [r.key]: r.refundLink!.candidates[0].patch })
    expect(mine(c)).toEqual([])
    const made = created(c.ops)[0]
    expect([made.refundOfId, made.description, made.recipientId, made.categoryId, made.amount]).toEqual(['a1', '[İade] Mutfak robotu', 'p-ys', 'c-ev', -1996.36])
    expect(made.tags).toEqual(['ev', 'İade'])
  })
})

describe('abonelik öğrenimi', () => {
  const draftTags = (p: ReturnType<typeof plan>) => {
    const a = p.rows[0].options[0].actions[0]
    return a.type === 'create' ? a.draft.tags : undefined
  }
  it('tek kayıtta abonelik işaretlendiyse sonraki ekstrede de abonelik gelir', () => {
    const hist = [tx({ id: 'n1', amount: 229.99, date: '2026-09-10', merchant: 'NETFLIX.COM', recipientId: 'p-itc', categoryId: 'c-food', description: 'Netflix', tags: ['abonelik'] })]
    expect(draftTags(plan([line({ description: 'NETFLIX.COM', amount: 229.99, date: '2026-10-10' })], hist))).toEqual(['abonelik'])
  })
  it('son kayıtta işaret kaldırıldıysa artık abonelik gelmez', () => {
    const hist = [
      tx({ id: 'n1', amount: 229.99, date: '2026-08-10', merchant: 'NETFLIX.COM', recipientId: 'p-itc', categoryId: 'c-food', description: 'Netflix', tags: ['abonelik'] }),
      tx({ id: 'n2', amount: 229.99, date: '2026-09-10', merchant: 'NETFLIX.COM', recipientId: 'p-itc', categoryId: 'c-food', description: 'Netflix' }),
    ]
    expect(draftTags(plan([line({ description: 'NETFLIX.COM', amount: 229.99, date: '2026-10-10' })], hist))).toBeUndefined()
  })
})
