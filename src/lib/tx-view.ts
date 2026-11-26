/* ── İşlem listesi görünüm tercihi ───────────────────────────────────────────
   Tercih ÇEREZDE tutulur (localStorage değil): hesap detayı sunucuda render
   edilirken çerez okunabildiği için ilk HTML doğrudan kullanıcının seçtiği
   görünümle basılır. localStorage olsaydı sunucu varsayılanı (Tablo) basar,
   hidrasyondan sonra seçili görünüme atlardı — her sayfa açılışında görünür bir
   sıçrama. Aynı gerekçeyle kenar çubuğu varyantı da çerezde (bkz.
   lib/sidebar-variant.ts).

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type TxViewId = 'table' | 'ruleless' | 'datecol'

export const TX_VIEW_COOKIE = 'fintrack-tx-view'
export const DEFAULT_TX_VIEW: TxViewId = 'table'

const VALID: readonly TxViewId[] = ['table', 'ruleless', 'datecol']

/** Çerez değeri bozuk/eksik/ARTIK GEÇERSİZ ise varsayılana düşer — kaldırılmış
 *  bir görünümün adı tarayıcıda kalmış olabilir. */
export function parseTxView(value: string | undefined | null): TxViewId {
  return VALID.includes(value as TxViewId) ? (value as TxViewId) : DEFAULT_TX_VIEW
}
