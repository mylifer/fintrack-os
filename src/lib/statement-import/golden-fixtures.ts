import { groupLines, type PdfItem, type PdfPage } from './pdf-text'
import type { OcrLine, OcrPage } from './ocr'

/* ── Altın çıktı testlerinin girdileri ───────────────────────────────────────
   Banka başına ayrıştırıcı testlerindeki örnek sayfaların BİREBİR kopyası
   (*.test.ts dosyalarından; yeni ekstre uydurulmadı). golden.test.ts bunları
   tüm ayrıştırıcılardan geçirip çıktıyı sabitler. Yalnız testler içe aktarır. */

const L = (w: number) => (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * w, y, str: s })
const R = (w: number) => (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * w, right: r, y, str: s })
const left = L(4)
const right = R(4)

// ── garanti-card.test.ts ────────────────────────────────────────────────────
function garantiRow(y: number, date: string | null, desc: string, opts: { inst?: string; bonus?: string; tutar?: string } = {}): PdfItem[] {
  const out: PdfItem[] = []
  if (date) out.push(left(105, date, y))
  out.push(left(170, desc, y))
  if (opts.inst) out.push(left(303, opts.inst, y))
  if (opts.bonus) out.push(right(445, opts.bonus, y))
  if (opts.tutar) out.push(right(553, opts.tutar, y))
  return out
}
export function garantiCard(): PdfPage[] {
  const debt = '1.867,85'
  const row = garantiRow
  return [{ lines: groupLines([
    left(36, 'Hesap Kesim Tarihi', 700), left(205, '30 Ekim 2026', 700),
    left(36, 'Son Ödeme Tarihi', 690), left(199, '09 Kasım 2026', 690),
    left(36, 'Dönem Borcunuz', 680), left(207, `${debt} TL`, 680),
    left(36, 'Kart Numarası', 670), left(184, '5407 09** **** 9010', 670),
    left(105, 'İşlem Tarihi', 600), left(170, 'Dönem İçi İşlemler', 600), left(303, 'Kalan Borç / Taksit', 600),
    { x: 405, right: 445, y: 600, str: 'Bonus (TL)' }, { x: 517, right: 553, y: 600, str: 'Tutar (TL)' },
    ...row(590, null, 'ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR', { tutar: '5.000,00' }),
    ...row(582, null, 'DÖNEM FAİZİ', { tutar: '100,00' }),
    ...row(574, '09 Ekim 2026', 'ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', { tutar: '5.000,00+' }),
    ...row(566, '22 Ekim 2026', 'BONUS BEDAVA ALIŞVERİŞ', { bonus: '615,00-' }),
    ...row(558, '02 Ekim 2026', 'GİYİM BONUS KAMPANYASI', { bonus: '350,00' }),
    ...row(550, '25 Ekim 2026', 'IYZICO  *AMAZON.COM.T', { bonus: '0,32', tutar: '644,00' }),
    ...row(542, '24 Ekim 2026', 'IYZICO  *AMAZON.COM.T', { bonus: '0,17-', tutar: '335,00+' }),
    ...row(534, '11 Eylül 2026', 'ÖZDİLEKTEYİM MAĞAZA', { inst: '366,63x3=1.099,91 2.Taksit', tutar: '366,63' }),
    ...row(526, '21 Ekim 2026', 'IYZICO/RUSTANDRICH.COM.TR', { inst: '535,50x3=1.606,50 1.Taksit', bonus: '1,45', tutar: '535,50' }),
    ...row(518, '04 Ekim 2026', 'STARTER (TIMELY)', { inst: '11,00 USD', tutar: '556,72' }),
    ...row(510, null, 'YURT DIŞI HARCAMALARINIZ'),
    left(105, 'Toplam', 400), right(445, '-264,85', 400), right(553, debt, 400),
    left(36, 'Önceki Bakiye', 380), left(110, 'Dönem Harcamaları', 380), left(200, 'Faiz ve Ücretler', 380), left(300, 'Ödemeleriniz', 380), left(380, 'Dönem Borcunuz', 380),
    left(36, `5.000,00 TL + 1.767,85 TL + 100,00 TL - 5.000,00 TL = ${debt} TL 1.766,00 TL`, 370),
    left(36, 'Bir sonraki hesap kesiminiz 29 Kasım 2026 Pazar ve son ödemeniz 09 Aralık 2026 Çarşamba \'dir. Bir önceki hesap kesim tarihiniz 28 Eylül', 360),
    left(36, '2026 Pazartesi \'dir.', 352),
    left(37, 'T. Garanti Bankası A.Ş. Genel Müdürlük', 30),
  ]) }]
}

// ── garanti-period.test.ts ──────────────────────────────────────────────────
export function garantiPeriod(): PdfPage[] {
  const header = (y: number) => [left(34, 'Tarih', y), left(85, 'İşlem', y), left(354, 'Etiket', y), left(451, 'Bonus', y), right(561, 'Tutar (TL)', y)]
  const row = (y: number, date: string, desc: string, tutar: string | null, bonus: string | null = null, city = 'İSTANBUL') => [
    left(34, date, y), left(85, desc, y), ...(city ? [left(265, city, y)] : []), left(354, 'Market', y),
    ...(bonus ? [right(482, bonus, y)] : []), ...(tutar ? [right(561, tutar, y)] : []),
  ]
  return [
    { lines: groupLines([
      left(450, 'T. Garanti Bankası A.Ş.', 800),
      left(30, 'Kredi kartınıza ait açık provizyon ve dönem içi işlem bilgileriniz aşağıda listelenmektedir.', 673),
      left(75, 'KART TİPİ', 628), left(207, 'KART NO', 628), left(295, 'Dönemiçi İşlemler - TL', 628),
      left(37, 'BONUS PLATINUM', 603), left(188, '5407 **** **** 1234', 603), left(319, '1.851,10 TL', 603), left(423, '30.10.2026', 603), left(502, '09.11.2026', 603),
      left(34, 'Açık Provizyon İşlemler - TL', 572),
      ...header(550),
      ...row(530, '07/11/2026', 'HGS YÜKLEME', '-500,00'),
      left(339, 'Toplam Açık Provizyon Tutarı :', 428), right(561, '500,00 TL', 428),
      left(34, 'Dönemiçi İşlemler - TL', 385),
      ...header(363),
      ...row(342, '28/11/2026', 'BEYMEN PERAKENDE VE TEKST (3/6)', '1.649,00'),
      ...row(321, '28/11/2026', 'BEYMEN PERAKENDE VE TEKST (3/6)', '-1.649,00'),
      ...row(300, '06/11/2026', 'MİGROS- ETHEMEFENDİ MİGRO', '-22,25', '0,01'),
      ...row(280, '06/11/2026', 'BonusFlaş Ödeme', '76.650,35', null, ''),
    ]) },
    { lines: groupLines([
      ...header(799),
      ...row(780, '05/11/2026', 'HEPSİPAY-HEP*HEPSİBURADA', null, '-285,45'),
      ...row(760, '03/11/2026', 'TRENDYOLGO YEMEK', null, '+285,00', ''),
      ...row(740, '02/11/2026', 'IYZICO *AMAZON.COM.T (1/3)', '-1.328,85', '6,22'),
      left(354, 'Toplam TL Harcama Tutarı :', 105), right(561, '1.351,10 TL', 105),
    ]) },
  ]
}

// ── qnb-card.test.ts ────────────────────────────────────────────────────────
export function qnbCard(): PdfPage[] {
  return [{ lines: groupLines([
    left(47, 'QNB Fix', 749),
    left(47, 'Kredi Kartı Numarası', 736), left(227, '5311 57** **** 1234', 736), left(381, 'deme Tarihi: 13 Ekim 2026, Salı', 736),
    left(47, 'Hesap Kesim Tarihi', 720), left(159, ':', 720), left(253, '03/10/2026', 720),
    left(56, 'İşlem Tarihi', 507), left(124, 'İşlem Açıklaması', 507), left(431, 'Tutar', 507), left(477, 'Taksit', 507), left(522, 'ParaPuan', 507),
    left(123, '\u0003nceki D\u0002nem Bakiyeniz', 490), right(449, '24.21', 490),
    left(59, 'ASIL KART: 5311 57** **** 1234 - AYŞE YILMAZ', 482),
    left(59, '14/09/2026', 474), left(124, 'deme - Tesekk', 474), left(176, '\u0000', 474), left(179, 'r Ederiz -', 474), right(449, '-24.21', 474),
    left(59, '19/09/2026', 465), left(124, 'TAM', 465), left(141, '-', 465), left(143, '\u0004', 465), left(148, 'DEME /STARBUCKS', 465), right(449, '1,350.00', 465),
    left(59, '24/09/2026', 456), left(124, 'YEMEKPAY', 456), left(170, '/YEMEKSEPE 337.05 al', 456), left(246, '\u0001', 456), left(250, 'v ind', 456), right(449, '-37.45', 456),
    left(124, 'Bu alışverişinizin sipariş kodu: 10000000001', 447),
    left(59, '28/09/2026', 272), left(124, 'ParaPuan Kullanımı -LCW.COM', 272), right(555, '-249,460', 272),
    left(59, 'Genel Toplam - TL Hesap Ekstresi', 212), right(449, '1,312.55', 212),
    left(80, '24.21', 169), left(161, '1,350.00', 169), left(238, '0.00', 169), left(303, '0.00', 169), left(378, '0.00', 169), left(448, '-61.66', 169), left(516, '1,312.55 TL', 169),
    left(47, '* Bir sonraki hesap kesim tarihiniz', 112), left(154, '03/11/2026', 112), left(189, ', bir sonraki son', 112), left(244, 'deme tarihiniz', 112), left(290, '13/11/2026', 112),
  ]) }]
}

export function qnbPeriod(): PdfPage[] {
  return [{ lines: groupLines([
    left(20, '03/11/2026 tarihli son 4 hanesi 1234 olan kartınıza ait Dönem İçi Hareketler', 733),
    left(21, 'İşlem Tarihi', 706), left(96, 'Açıklama', 706), right(422, 'Tutar', 706), left(538, 'ParaPuan', 706),
    left(20, '13/10/2026', 686), left(95, 'Ödeme - Tesekkür Ederiz -', 686), right(421, '-3278,05 TRY', 686), left(485, '0/0,0', 686),
    left(20, '24/10/2026', 666), left(95, 'BITAKSI 34 TR', 666), right(421, '467,0 TRY', 666), left(485, '1/1,0', 666),
    left(20, '05/10/2026', 646), left(95, 'YEMEKPAY /YEMEKSEPE 414.00 alşv ind', 646), right(421, '-46,0 TRY', 646),
    left(20, '01/11/2026', 626), left(95, 'İlk Alışverişine 500 TL PP Geri Alım', 626), right(421, '-0,0 TRY', 626), right(574, '-540,0', 626),
  ]) }]
}

// ── burgan-card.test.ts ─────────────────────────────────────────────────────
export function burganCard(): PdfPage[] {
  const row = (y: number, date: string | null, desc: string, amount: string) =>
    [...(date ? [left(41, date, y)] : []), left(109, desc, y), right(560, amount, y)]
  return [{ lines: groupLines([
    left(401, 'Kredi Kartı Hesap Özeti', 775),
    left(39, 'Hesap Kesim Tarihi', 686), left(167, ':', 686), right(288, '07/10/2026', 686),
    left(39, 'Dönem Borcu (TL)', 674), left(167, ':', 674), right(288, '1,747.90', 674),
    left(39, 'Son Ödeme Tarihi', 650), left(167, ':', 650), right(288, '19/10/2026', 650),
    left(39, 'Bir Sonraki Hesap Kesim Tarihi', 639), left(167, ':', 639), right(288, '07/11/2026', 639),
    left(39, 'Bir Sonraki Son Ödeme Tarihi', 627), left(167, ':', 627), right(288, '17/11/2026', 627),
    left(41, '5418 75** **** 1234 NOLU KARTIN HARCAMALARI', 484),
    left(41, 'İşlem Tarihi', 462), left(109, 'İşlem Açıklama', 462), left(324, 'Kalan Tutar/Taksit:', 462), left(434, 'MaxiPuan', 462), left(536, 'Tutar:', 462),
    ...row(437, null, 'Önceki Dönem Ekstre Borcu', '10,000.00'),
    ...row(426, '07/09/2026', 'ORNEK BAKKAL ISTANBUL TR', '310.00'),
    ...row(415, '08/09/2026', 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kaz', '+62.10'),
    [left(41, '09/09/2026', 403), left(109, 'ORNEK KUAFOR ISTANBUL TR', 403), left(460, '0.07', 403), right(560, '1,500.00', 403)],
    ...row(392, '17/09/2026', 'KREDI KARTI BORC ODEME', '+10,000.00'),
    [left(41, 'BU KARTINIZLA YAPILAN İŞLEM TOPLAMI :', 380), right(560, '-8,252.10', 380)],
    left(365, 'Toplam Tutar:', 300), left(448, '1,747.90', 300),
    left(32, 'Burgan Bank A.Ş. Maslak Mah.', 30),
  ].flat()) }]
}

// ── yapikredi-card.test.ts ──────────────────────────────────────────────────
export function yapiKrediCard(): PdfPage[] {
  return [{ lines: groupLines([
    left(28, 'HESAP BİLGİLERİ', 749),
    left(28, 'Hesap Kesim Tarihi', 737), left(198, ':', 737), left(202, '18 Ekim 2026', 737),
    left(28, 'Son Ödeme Tarihi', 727), left(198, ': 28 Ekim 2026', 727),
    left(28, 'Dönem Borcu', 716), left(198, ': 2.000,00 TL', 716),
    left(28, 'Önceki Dönem Hesap Özeti Borcu', 685), left(198, ': 1.000,00 TL', 685), left(337, 'ÖRNEK MAH.', 685),
    left(28, 'Dönem İçi Harcamalar', 675), left(198, ': 2.000,00 TL', 675),
    left(28, 'Dönem İçi Ödemeler', 662), left(198, ': +1.000,00 TL', 662),
    left(28, 'Bir Sonraki Ay Hesap Kesim Tarihi', 629), left(198, ': 18 Kasım 2026', 629),
    left(28, 'Bir Sonraki Ay Son Ödeme Tarihi', 618), left(198, ': 30 Kasım 2026', 618),
    left(28, 'Kart Numarası', 575), left(198, ': 5258 64** **** 1234', 575),
    left(40, 'İşlem Tarihi', 424), left(104, 'İşlemler', 424), left(387, 'Tutar(TL)', 424), left(442, 'Kalan Tutar/Taksit', 424), left(545, 'Puan', 424),
    left(104, 'ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU', 415), right(427, '1.000,00', 415),
    left(40, '28 Eylül 2026', 405), left(105, 'ÖDEME-İNTERNET BANKACILIĞI', 405), right(427, '+1.000,00', 405),
    left(40, '29 Nisan 2026', 392), left(105, 'ORNEK GIYIM', 392), left(194, 'ISTANBUL', 392), left(238, 'TR', 392), right(427, '1.200,00', 392),
    left(105, "7.200,00 TL'lik işlemin 6 / 6 taksidi", 382),
    left(40, '06 Eylül 2026', 372), left(105, 'ORNEK MAGAZA', 372), right(427, '800,00', 372), left(483, '2.400,00 / 3', 372),
    left(105, "4.000,00 TL'lik işlemin 2 / 5 taksidi", 363),
    left(40, 'TOPLAM', 351), right(427, '2.000,00', 351),
    left(12, 'YAPI ve KREDİ BANKASI A.Ş.', 133),
  ]) }]
}

// ── odeabank-card.test.ts ───────────────────────────────────────────────────
export function odeabankCard(): PdfPage[] {
  const header = (y: number) => [left(70, 'İşlem Tarihi', y), left(128, 'Dönem İçi İşlemler', y), right(420, 'Borç Tutarı (TL)', y), left(439, 'Kalan Taksit', y), right(563, 'Chip Para (TL)', y)]
  return [
    { lines: groupLines([
      left(48, 'Dönem Borcu', 738), left(184, ': 1,642.72 TL', 738),
      left(48, 'Dönem Başlangıç Tarihi', 725), left(184, ': 25/08/2026', 725),
      left(48, 'Son Ödeme Tarihi', 711), left(184, ': 05/10/2026', 711),
      left(48, 'Asgari Ödeme Tutarı', 697), left(184, ': 328.54 TL', 697),
      left(48, 'Hesap Kesim Tarihi', 683.5), left(184, ': 24/09/2026', 682.6), left(369, '34400 KAĞITHANE / İSTANBUL', 682.3),
      left(48, 'Bir Sonraki Hesap Kesim Tarihi', 670), left(184, ': 24/10/2026', 670),
      left(48, 'Bir Sonraki Son Ödeme Tarihi', 656), left(184, ': 03/11/2026', 656),
      left(48, 'Kart Numarası', 615), left(184, ': 5273 83** **** 1234 / MasterCard', 615),
      left(67, '(+) Önceki Hesap Bakiyeniz', 352), left(168, '(+) Dönem İçi Harcamalarınız', 352), left(289, '(+) Toplam Faiz ve', 352), left(396, '(-) Ödemeleriniz', 352), left(491, '(=) Dönem Borcunuz', 352),
      left(92, '500.00 TL', 328), left(197, '1,642.72 TL', 328), left(307, '0.00 TL', 328), left(401, '500.00 TL', 328), left(506, '1,642.72 TL', 328),
      ...header(251),
      left(128, 'Önceki Dönem Hesap Özeti Bakiyesi', 233), right(425, '500.00', 233),
      left(67, '04/09/2026', 216), left(129, 'Ödemeniz için tesekkür ederiz.', 216), right(425, '(-) 500.00', 216),
      left(67, '26/08/2026', 163), left(129, 'NAZLIM ECZANESI', 163), left(218, 'ISTANBUL', 163), left(273, 'TU 2/1. taksit', 163), right(425, '162.72', 163), left(463, '1', 163),
      left(129, '27/08/2026 vadeli', 154),
      left(67, '27/08/2026', 139), left(129, 'SHELL ACIBADEM', 139), left(218, 'ISTANBUL', 139), left(273, 'TR', 139), right(425, '130.00', 139), right(571, '0.03', 139),
      left(67, 'Ara Toplam', 95), right(425, '292.72', 95),
      left(35, 'Odea Bank A.Ş', 74),
    ]) },
    { lines: groupLines([
      ...header(710),
      left(65, '02/09/2026', 692), left(127, 'NOMUPA /S SPORT PLUS', 692), left(231, 'ISTANBUL', 692), left(286, 'TR', 692), right(421, '1,350.00', 692),
      left(65, 'Toplam Borç', 678), right(421, '1,642.72', 678), right(567, '0.03', 678),
    ]) },
  ]
}

// ── odeabank-period.test.ts (parçalar 6 pt/harf) ────────────────────────────
export function odeabankPeriod(): PdfPage[] {
  const l6 = L(6)
  const r6 = R(6)
  const page = (spend: string) => ({ lines: groupLines([
    l6(10, 'Kredi Kartı Dönem İçi İşlemler', 938),
    l6(10, 'Kart Numarası', 886), l6(400, ': 5273********1234', 890),
    l6(400, `: ${spend}`, 869), l6(10, 'Dönem İçi Toplam TL Harcama', 861),
    l6(400, ': 0', 848), l6(10, 'Dönem İçi Toplam TL Ödeme', 836),
    l6(15, 'Tarih', 806), l6(286, 'İşlem', 806), r6(584, 'Tutar', 806),
    l6(15, '2026-11-03', 772), l6(286, 'PARATIKA/FIBASIGORTA', 772), l6(439, 'ISTANBUL', 772), l6(521, 'TR', 772), r6(825, '-3902,14 TL', 772),
    l6(15, '2026-11-02', 789), l6(286, 'NOMUPA /S SPORT PLUS', 789), l6(442, 'ISTANBUL', 789), l6(524, 'TR', 789), r6(825, '-249 TL', 789),
    l6(15, '2026-11-04', 755), l6(286, 'KART BORC ODEMESI', 755), r6(825, '4313,85 TL', 755),
  ]) })
  // Devam sayfası ve bekleyen provizyonlar ("başlıksız devam sayfası okunur" testi)
  const cont = { lines: groupLines([
    l6(15, '2026-11-05', 938), l6(286, 'MASAL KOKOREC', 938), l6(398, 'ISTANBUL', 938), l6(480, 'TU', 938), r6(825, '-2700 TL', 938),
    l6(15, '2026-11-05', 921), l6(286, 'KART BORC ODEMESI', 921), r6(825, '41197,68 TL', 921),
  ]) }
  const prov = { lines: groupLines([
    l6(10, 'Bekleyen Provizyonlar', 938),
    l6(15, 'Tarih', 806), l6(286, 'İşlem', 806), r6(584, 'Tutar', 806),
    l6(15, '2026-11-12', 789), l6(286, 'YEMEKSEPETIPAY /Yemeks', 789), l6(454, 'ISTANBUL', 789), l6(530, 'TR', 789), r6(825, '-1423,6 TL', 789),
    l6(15, '2026-11-12', 772), l6(286, 'YEMEKSEPETIPAY /Yemeks', 772), l6(454, 'ISTANBUL', 772), l6(530, 'TR', 772), r6(825, '212,95 TL', 772),
    l6(280, 'Toplam Türk Lirası İşlem Tutarı', 712), l6(560, '1210,65 TL', 712),
  ]) }
  return [page('6851,14'), cont, prov]
}

// ── odeabank-account.test.ts ────────────────────────────────────────────────
export function odeabankAccount(): PdfPage[] {
  const row = (y: number, dt: string, desc: string, amount: string, balance: string) =>
    [left(15, dt, y), left(138, desc, y), right(702, amount, y), right(825, balance, y)]
  const rows = [
    row(795, '03.11.2026 02:43', 'Oksijen Devam Faizi - Gelir Vergisi Stopaj Kesintisi', '-32,46', '208.207,32'),
    row(778, '03.11.2026 02:43', '%36,00 Oksijen Devam Faizi - Faizi %', '+185,48', '208.239,78'),
    row(761, '02.11.2026 10:46', 'Banka: 0062 SN: 600000000000000001 Ayşe yılmaz Açk: 3612.76 TRY', '-3.612,76', '208.054,30'),
    [left(138, 'Gönd.', 744)],
    row(727, '01.11.2026 19:00', 'Banka: 0046 SN: 8361718 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk:', '+211.667,06', '211.667,06'),
    [left(141, 'Midas', 710)],
  ]
  return [{ lines: groupLines([
    left(10, 'Hesap', 938), left(142, 'Hareketleri', 938),
    left(10, 'Ad Soyad/Ünvan', 897), left(200, ': AYŞE YILMAZ', 897),
    left(10, 'IBAN', 863), left(200, ': TR120014600000000000000001', 863),
    left(10, 'Tarih Aralığı', 846), left(200, ': 03.08.2026 Pzt - 03.11.2026 Sal', 846),
    left(15, 'Tarih', 812), left(138, 'İşlem', 812), { x: 642, right: 702, y: 812, str: 'Tutar(TRY)' }, { x: 757, right: 825, y: 812, str: 'Bakiye(TRY)' },
    ...rows.flat(),
  ]) }]
}

// ── kuveyt-card.test.ts ─────────────────────────────────────────────────────
export function kuveytCard(): PdfPage[] {
  const label = (y: number, tr: string, en: string, value: string) => [left(331, `${tr} /`, y), left(400, en, y), right(574, value, y)]
  const rows = [
    left(34, '13/08/2026', 505), left(94, 'Taksit - ÖZEL DURU VETERİNERL', 505), left(217, 'İSTANBUL', 505), left(263, 'TR', 505),
    left(349, '6.750,00 TL İşlemin 3 / 5 Taksidi', 505), right(513, '1.350,00 TL', 505), right(570, '0.00', 505),
    left(34, '05/10/2026', 489), left(94, 'Kredi Kartı Borç Ödeme', 489), right(513, '-1.350,00 TL', 489), right(570, '0.00', 489),
    left(34, '10/10/2026', 473), left(94, 'MİGROS ERENKÖY', 473), left(217, 'İSTANBUL', 473), left(263, 'TR', 473), right(513, '250,00 TL', 473), right(570, '2.50', 473),
  ]
  return [{ lines: groupLines([
    left(30, 'KREDİ KARTI EKSTRESİ / Credit Card Statement', 760),
    ...label(712, 'Kart No', 'Card Number', '518896******1234'),
    ...label(667, 'Hesap Kesim Tarihi', 'Statement Issue Date', '23/10/2026'),
    ...label(658, 'Son Ödeme Tarihi', 'Due Date for Payment', '02/11/2026'),
    ...label(650, 'Dönem Borcunuz', 'Your Current Debt', '1.600,00 TL'),
    ...label(642, 'Asgari Ödeme Tutarı', 'Minimum Payment Amount', '1.600,00 TL'),
    ...label(605, 'Sonraki Hesap Kesim Tarihi', 'Next Statement Date', '23/11/2026'),
    ...label(596, 'Sonraki Son Ödeme Tarihi', 'Next Due Date for Payment', '03/12/2026'),
    left(34, 'İŞLEM TARİHİ', 537), left(93, 'İŞLEM AÇIKLAMASI', 537), left(476, 'TUTAR', 537), left(526, 'ALTIN', 537), left(547, 'PUAN', 537),
    left(93, '518896******1234 ile yapılan işlemler', 518),
    ...rows,
    left(111, 'Devreden Bakiye', 460), left(222, 'Dönem Harcamaları', 460), left(335, 'Ödemeleriniz', 460), left(448, 'Dönem Borcunuz', 460),
    left(123, '1.350,00', 444.3), left(186, '+', 443.7), left(233, '1.600,00', 444.3), left(339, '1.350,00', 444.3), left(461, '1.600,00', 444.3),
    left(299, '-', 440.7), left(412, '=', 441.2),
    left(130, '0,00', 400), left(241, '0,00', 400), left(347, '0,00', 400), left(465, '0,00', 400),
    left(30, 'Kuveyt Türk Katılım Bankası A.Ş.', 100),
  ]) }]
}

// ── kuveyt-period.test.ts (OCR ekran görüntüsü) ─────────────────────────────
export function kuveytScreenshot(): OcrPage {
  const line = (y: number, ...words: [string, number, number][]): OcrLine =>
    ({ y, text: words.map(w => w[0]).join(' '), words: words.map(([text, x0, x1]) => ({ text, x0, x1 })) })
  return {
    width: 738,
    lines: [
      line(37, ['00:04', 81, 166], ['56', 575, 607]),
      line(113, ['<', 42, 63], ['Dönem', 222, 315], ['İçi', 325, 353], ['Harcamalar', 364, 519]),
      line(241, ['Sağlam', 202, 303], ['Kart', 314, 370], ['Mastercard', 379, 536]),
      line(279, ['5188', 238, 304], ['...', 317, 362], ['«...', 376, 421], ['1234', 434, 502]),
      line(622, ['TL', 63, 91], ['Harcamalar', 101, 233], ['11.250,00', 541, 674]),
      line(661, ['Bu', 64, 91], ['Döneme', 102, 197], ['Ait', 206, 236], ['Taksitler', 244, 341], ['0,00', 624, 674]),
      line(749, ['Toplam', 63, 145], ['11.250,001L', 510, 675]),
      line(872, ['Tümü', 66, 128], ['Bekleyen', 181, 275], ['Ücretsiz', 354, 440], ['Taksitlendir', 448, 569]),
      line(948, ['08.11.2026', 110, 239], ['23:22', 249, 310], ['3.750,001L', 486, 634]),
      line(972, ['©', 61, 87], ['VET', 110, 152], ['HAST', 161, 221], ['UNIVERSAL', 232, 359], ['FATİH', 369, 430], ['ıBİ', 648, 680]),
      line(1012, ['ISTANBUL', 111, 221], ['TR', 230, 257]),
      line(1082, ['06.11.2026', 63, 193], ['7.500,00', 486, 602], ['1L', 609, 634]),
      line(1106, ['VET', 64, 105], ['HAST', 115, 175], ['UNİVERSAL', 185, 312], ['FATİH', 323, 384], ['YE', 648, 680]),
      line(1145, ['İSTANBUL', 64, 175], ['TR', 184, 211]),
      line(1216, ['02.11.2026', 63, 192], ['*249,071L', 544, 684]),
      line(1251, ['Kredi', 64, 118], ['Kartı', 128, 176], ['Borç', 186, 234], ['Ödeme', 243, 321]),
      line(1321, ['02.11.2026', 63, 192], ['*1.100,93', 516, 652], ['TL', 659, 683]),
      line(1352, ['Kredi', 64, 118], ['Kartı', 128, 176], ['Borç', 186, 234], ['Ödeme', 243, 320]),
      line(1467, ['NM', 64, 94], ['Mâ', 207, 243], ['*', 497, 529]),
      line(1512, ['Ana', 33, 69], ['Sayfa', 77, 128], ['Döviz/Yatırım', 163, 287], ['Menü', 632, 682]),
    ],
  }
}
