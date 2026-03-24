import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] 환경변수 미설정 — localStorage 모드로 동작합니다.')
}

export const supabase = createClient(
  SUPABASE_URL      || 'http://localhost:54321',
  SUPABASE_ANON_KEY || 'placeholder'
)

/** Supabase 연결 여부 확인 */
export const isSupabaseEnabled =
  !!SUPABASE_URL && SUPABASE_URL !== 'http://localhost:54321'
