-- ============================================================================
-- 0008 — debts."borrowDate" + transactions."debtPrincipalId"
--
-- Borcun anaparası (paranın hesaba girişi / hesaptan çıkışı) bugüne kadar
-- borcun "ilk taksit" tarihinden türetiliyordu. Kredide ilk taksit genelde
-- para girişinden ~1 ay sonra olduğu için satır ileri tarihli doğuyor, onay
-- kapısında bekleyip bakiyeye hiç girmiyordu; bunu önlemek için tarih bugüne
-- çekiliyor ve paranın gerçekten el değiştirdiği gün kayboluyordu.
--
--   "borrowDate"      — borcun alındığı/verildiği gün. Anapara işleminin
--                       tarihi artık budur; geriye dönük de girilebilir.
--   "debtPrincipalId" — anapara satırının borcuna ID bağı. "debtId"den AYRI
--                       tutulur bilerek: debtId'li satır her akışta bir ÖDEME
--                       sayılır (silinince borcun ödenen tutarı düşer), oysa
--                       anapara bir ödeme değildir. Alım tarihi düzenlenince
--                       taşınacak satır bu bağdan bulunur.
--
-- Mevcut satırlara DOKUNULMAZ: iki sütun da null kalır. null "borrowDate" =
-- eski kayıt (o borçta anapara satırının kendi tarihi tek gerçektir), null
-- "debtPrincipalId" = bağ eklenmeden önce yazılmış satır; istemci bu satırları
-- açıklama eşleşmesiyle bulmayı sürdürür ve ilk düzenlemede bağı damgalar
-- (0006'daki P&L bağıyla aynı desen).
--
-- ⚠️ Bu migration, alanları yazan kod deploy edilmeden ÖNCE çalıştırılmalıdır;
-- aksi halde sync upsert'leri bilinmeyen sütun nedeniyle 4xx alıp outbox'ı
-- dead-letter'a düşürür (bkz. 0003'teki bilezik olayı).
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.debts
  add column if not exists "borrowDate" text;

alter table public.transactions
  add column if not exists "debtPrincipalId" text;
