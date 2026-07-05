import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// createBrowserClient stores session in cookies so middleware can read it
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// supabase-js strips keys whose value is `undefined`, so a field cleared with
// `undefined` never reaches Supabase and the old value resurrects on next load.
// Dexie, on the other hand, treats `undefined` as "delete this property".
// Convert explicit `undefined` values to `null` before sending updates.
export function nullifyUndefined<T extends object>(obj: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : v]),
  )
}
