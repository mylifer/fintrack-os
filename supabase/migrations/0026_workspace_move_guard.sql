-- ============================================================================
-- 0026 — Çalışma alanı taşıması sahipliği değiştiremez
--
-- SORUN (supabase/fresh-install/sync-rules.sql, #R1)
--   0021'in politikaları bir UPDATE'te yalnız "yeni satırın alanına yazabilir
--   miyim" diye bakar; set_workspace_owner da user_id'yi YENİ alanın sahibine
--   çevirir. İki paylaşılan alanın editörü (A'nın "Aile"si ve C'nin "Ortak"ı)
--   A'nın satırının "workspaceId"'sini C'nin alanına çevirdiğinde satır
--   sessizce C'nin hesabına geçer: A onu bir daha göremez, C'nin hesabı
--   silinirse satır da gider.
--
-- KURAL (en az müdahale)
--   Bir UPDATE "workspaceId"'yi değiştiriyorsa, satırın SON user_id'si (bu
--   tetikleyici set_workspace_owner'dan SONRA çalışır) eskisiyle aynı olmalı.
--   Yani taşıma serbest, ama satırı başka bir hesaba devretmek yasak.
--     • Sahip kendi alanları arasında (paylaşılan ya da değil) taşıyabilir.
--     • Aynı sahibin iki paylaşılan alanı arasında editör de taşıyabilir.
--     • Başka sahibin alanına taşıma reddedilir (42501).
--   INSERT'e dokunulmaz: editörün paylaşılan alana yeni satır eklemesi
--   (sahiplik alan sahibine geçer) 0021'in meşru akışıdır.
--
-- İSTEMCİ ETKİSİ: uygulamada mevcut bir satırı başka alana taşıyan akış yok —
--   alanlar arası transfer/borç ödemesi her alana YENİ satır yazar
--   (src/store/transactions.store.ts → addCrossWorkspaceTransfer). Eski
--   (workspaceId'siz) satırın ilk damgalanması null → kendi alanı olduğundan
--   sahiplik değişmez. restore_user_backup user_id'yi çağırana zorlar;
--   kendi alanlarına geri yüklemede sahiplik değişmez.
--
-- Tetikleyici adı bilinçli: aynı olaydaki BEFORE tetikleyicileri ada göre
-- sırayla çalışır — keep_newer_row < set_workspace_owner < workspace_move_guard.
-- keep_newer_row eski yazmayı OLD döndürerek yok saydıysa alan değişmemiştir.
--
-- Idempotent: tekrar çalıştırmak güvenlidir. Veriye dokunmaz.
-- ============================================================================

create or replace function public.workspace_move_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new."workspaceId" is distinct from old."workspaceId"
     and new.user_id is distinct from old.user_id then
    raise exception 'çalışma alanı taşıması satırın sahipliğini değiştiremez (%: % → %)',
      tg_table_name, old."workspaceId", new."workspaceId"
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.workspace_move_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'transactions', 'categories', 'budgets', 'debts',
    'investment_transactions', 'people', 'recurring_transactions',
    'payment_plans', 'payment_occurrences', 'savings_goals'
  ] loop
    execute format('drop trigger if exists workspace_move_guard on public.%I;', t);
    execute format(
      'create trigger workspace_move_guard before update on public.%I '
      'for each row execute function public.workspace_move_guard();', t);
  end loop;
end $$;

-- ============================================================================
-- DOĞRULAMA
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'workspace_move_guard' order by 1;   → 11 satır
-- ============================================================================
