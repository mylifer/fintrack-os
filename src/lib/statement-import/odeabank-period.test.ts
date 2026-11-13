import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseOdeabankPeriod } from './odeabank-period'
import { parseStatement } from './statement'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 6, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 6, right: r, y, str: s })

// Gerçek listedeki konumlar: tarih 15, işlem 286, Tutar sağ kenarı 825; etiket
// değerleri etiketin 8 pt üstünde ayrı satırda.
const page = (spend: string) => ({
  lines: groupLines([
    left(10, 'Kredi Kartı Dönem İçi İşlemler', 938),
    left(10, 'Kart Numarası', 886), left(400, ': 5273********1234', 890),
    left(400, `: ${spend}`, 869), left(10, 'Dönem İçi Toplam TL Harcama', 861),
    left(400, ': 0', 848), left(10, 'Dönem İçi Toplam TL Ödeme', 836),
    left(15, 'Tarih', 806), left(286, 'İşlem', 806), right(584, 'Tutar', 806),
    left(15, '2026-11-03', 772), left(286, 'PARATIKA/FIBASIGORTA', 772), left(439, 'ISTANBUL', 772), left(521, 'TR', 772), right(825, '-3902,14 TL', 772),
    left(15, '2026-11-02', 789), left(286, 'NOMUPA /S SPORT PLUS', 789), left(442, 'ISTANBUL', 789), left(524, 'TR', 789), right(825, '-249 TL', 789),
    left(15, '2026-11-04', 755), left(286, 'KART BORC ODEMESI', 755), right(825, '4313,85 TL', 755),
  ]),
})

describe('Odeabank dönem içi işlemler', () => {
  it('tarihe göre sıralı satırlar; "−" harcama, "+" ödeme; harcama toplamı tutar', () => {
    const st = parseOdeabankPeriod([page('4151,14')])!
    expect(st).toMatchObject({ bank: 'odeabank', provisional: true, cards: ['1234'], statementDate: '2026-11-04', dueDate: null })
    expect(st.check).toMatchObject({ ok: true, computed: 4151.14, expected: 4151.14 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.description])).toEqual([
      ['2026-11-02', 'purchase', 249, 'NOMUPA /S SPORT PLUS'],
      ['2026-11-03', 'purchase', 3902.14, 'PARATIKA/FIBASIGORTA'],
      ['2026-11-04', 'payment', -4313.85, 'KART BORC ODEMESI'],
    ])
    expect(parseStatement([page('4151,14')]).provisional).toBe(true)
  })

  it('harcama toplamı tutmazsa uyarır', () => {
    const st = parseOdeabankPeriod([page('4000')])!
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(151.14)
  })

  it('başlıksız devam sayfası okunur; bekleyen provizyonlar harcama toplamına girmez', () => {
    const cont = { lines: groupLines([
      left(15, '2026-11-05', 938), left(286, 'MASAL KOKOREC', 938), left(398, 'ISTANBUL', 938), left(480, 'TU', 938), right(825, '-2700 TL', 938),
      left(15, '2026-11-05', 921), left(286, 'KART BORC ODEMESI', 921), right(825, '41197,68 TL', 921),
    ]) }
    const prov = { lines: groupLines([
      left(10, 'Bekleyen Provizyonlar', 938),
      left(15, 'Tarih', 806), left(286, 'İşlem', 806), right(584, 'Tutar', 806),
      left(15, '2026-11-12', 789), left(286, 'YEMEKSEPETIPAY /Yemeks', 789), left(454, 'ISTANBUL', 789), left(530, 'TR', 789), right(825, '-1423,6 TL', 789),
      left(15, '2026-11-12', 772), left(286, 'YEMEKSEPETIPAY /Yemeks', 772), left(454, 'ISTANBUL', 772), left(530, 'TR', 772), right(825, '212,95 TL', 772),
      left(280, 'Toplam Türk Lirası İşlem Tutarı', 712), left(560, '1210,65 TL', 712),
    ]) }
    const st = parseOdeabankPeriod([page('6851,14'), cont, prov])!
    expect(st.check).toMatchObject({ ok: true, computed: 6851.14, expected: 6851.14, diff: 0 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount])).toEqual([
      ['2026-11-02', 'purchase', 249],
      ['2026-11-03', 'purchase', 3902.14],
      ['2026-11-04', 'payment', -4313.85],
      ['2026-11-05', 'purchase', 2700],
      ['2026-11-05', 'payment', -41197.68],
      ['2026-11-12', 'purchase', 1423.6],
      ['2026-11-12', 'refund', -212.95],
    ])
    const bad = { lines: prov.lines.map(l => l.text.includes('İşlem Tutarı') ? groupLines([left(280, 'Toplam Türk Lirası İşlem Tutarı', 712), left(560, '1000 TL', 712)])[0] : l) }
    expect(parseOdeabankPeriod([page('6851,14'), cont, bad])!.check.ok).toBe(false)
  })

  it('başka listeyi tanımaz', () => {
    expect(parseOdeabankPeriod([{ lines: groupLines([left(10, 'Dönemiçi İşlemler - TL', 700)]) }])).toBeNull()
  })
})
