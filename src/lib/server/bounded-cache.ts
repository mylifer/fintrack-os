/* ── Boyutu sınırlı süreç-içi önbellek (yalnızca sunucu tarafı) ──────────────

   API route'ları upstream çağrılarını yumuşatmak için `new Map()` kullanıyordu.
   Sorun: anahtar uzayı İSTEK SAHİBİNİN kontrolünde ve hiçbir tahliye yok —
   /api/brand-logo'da anahtar 64 karaktere kadar serbest metin (marka adı),
   yani kimliği doğrulanmış bir kullanıcı benzersiz isimler göndererek Map'i
   sınırsız büyütebilir ve fonksiyon instance'ını belleğe boğabilir. TTL bunu
   çözmez: süresi dolan girdi yalnızca OKUNURKEN göz ardı edilir, yerinde durur.
   (Güvenlik denetimi 2026-08-29, bulgu F5.)

   Tahliye politikası: ekleme sırasına göre en eski girdi atılır. JS'te Map
   ekleme sırasını koruduğu için `keys().next()` en eskiyi verir — public/sw.js
   içindeki trimCache ile aynı yaklaşım. `set` her çağrıda anahtarı önce siler,
   böylece yeniden yazılan bir anahtar sıranın SONUNA taşınır ve sıcak girdiler
   hayatta kalır (yaklaşık LRU).

   TTL bilinçli olarak burada DEĞİL: her çağıran farklı bir tazelik kuralı
   uyguluyor (fiyat vs. marka domain'i), o mantık çağıranda kalsın. Bu sınıfın
   tek işi büyümeyi sınırlamak. */

export class BoundedCache<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('BoundedCache: max en az 1 olmalı')
  }

  get(key: string): V | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }

  set(key: string, value: V): void {
    // Var olan anahtarı sona taşı (yaklaşık LRU) — tahliyeden ÖNCE silinmeli ki
    // kapasitedeyken kendi kendini tahliye eden bir güncelleme oluşmasın.
    this.map.delete(key)
    while (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.map.set(key, value)
  }
}
