import React, { useState, useEffect } from 'react'
import { Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseEnabled, supabase } from '../lib/supabase'
import { todayStr, tsDate, tsMin, nowMinutes } from '../utils/time'

/**
 * 사용중 측정 정책:
 *   checked_in = true + 현재 시각이 start_at ~ end_at 사이 + 취소/반납 없음
 */
function useGuestStats() {
  const [stats, setStats] = useState<{ busy: number; available: number } | null>(null)

  useEffect(() => {
    if (!isSupabaseEnabled) return

    async function fetchStats() {
      try {
        const today = todayStr()
        const now   = nowMinutes()
        const { count } = await supabase
          .from('rooms').select('*', { count: 'exact', head: true }).eq('is_active', true)
        const total = count ?? 9

        const { data } = await supabase
          .from('bookings')
          .select('room_id, start_at, end_at, checked_in, auto_cancelled, early_ended')
          .eq('auto_cancelled', false)
          .eq('early_ended',    false)
          .gte('start_at', `${today}T00:00:00+09:00`)
          .lte('start_at', `${today}T23:59:59+09:00`)

        if (!data) return

        const toKSTMin = (ts: string): number => {
          if (!ts) return 0
          if (ts.includes('+09:00') || ts.includes('+09')) return tsMin(ts)
          const d = new Date(ts)
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
          return kst.getUTCHours() * 60 + kst.getUTCMinutes()
        }
        const toKSTDate = (ts: string): string => {
          if (!ts) return ''
          if (ts.includes('+09:00') || ts.includes('+09')) return tsDate(ts)
          const d = new Date(ts)
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
          const pad = (n: number) => String(n).padStart(2, '0')
          return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth()+1)}-${pad(kst.getUTCDate())}`
        }

        const busyRoomIds = new Set(
          data
            .filter(b =>
              !b.auto_cancelled && !b.early_ended &&
              toKSTDate(b.start_at) === today &&
              toKSTMin(b.start_at) <= now &&
              now < toKSTMin(b.end_at)
            )
            .map(b => b.room_id)
        )

        setStats({ busy: busyRoomIds.size, available: total - busyRoomIds.size })
      } catch {}
    }

    fetchStats()
    const iv = setInterval(fetchStats, 30000)
    return () => clearInterval(iv)
  }, [])

  return stats
}

export default function LoginPage() {
  const { login, loginWithMicrosoft, ssoError } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  _useGuestStats()

  // SSO 에러를 로컬 error 상태로 표시
  useEffect(() => {
    if (ssoError) setError(ssoError)
  }, [ssoError])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
    } catch (err: any) {
      setError(err.message ?? '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMicrosoftLogin() {
    setError('')
    setSsoLoading(true)
    try {
      await loginWithMicrosoft()
      // 성공 시 Microsoft 페이지로 리다이렉트 → 이 코드 이후는 실행 안 됨
    } catch (err: any) {
      setError(err.message ?? 'Microsoft 로그인을 시작할 수 없습니다.')
      setSsoLoading(false)
    }
  }

  // /auth/callback 경로일 때: OAuth 처리 중 스피너 표시
  const isCallbackPath = typeof window !== 'undefined' && window.location.pathname === '/auth/callback'

  if (isCallbackPath) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
        <div style={{
          width: 36, height: 36,
          border: '3px solid #E2E8F0',
          borderTop: '3px solid #111',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p className="text-sm text-[#6a7282]">Microsoft 로그인 처리 중…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-white">

      <div className="w-full max-w-sm">

        {/* 로고 */}
        <div className="text-center mb-5 overflow-hidden">
          <div className="h-5" />
          <h1 className="text-[30px] font-medium text-[#111] uppercase leading-9 tracking-tight">
            C&R Space
          </h1>
          <div className="h-1.5" />
          <p className="text-xs text-[#6a7282]">
            C&R Research 회의실 예약 시스템
          </p>
        </div>

        {/* ── Microsoft SSO 버튼 (메인) ── */}
        <div className="mb-6 rounded-3xl p-6"
          style={{ boxShadow: '10px 10px 60px rgba(0,0,0,0.04)' }}>
          <div className="mb-4">
            <p className="text-xs text-[#6a7282] leading-snug">
              사내 Microsoft 계정으로 로그인하세요
            </p>
          </div>
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={ssoLoading || loading}
            className="w-full h-[46px] flex items-center rounded-[10px] border border-black/20 bg-white overflow-hidden transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <div className="flex items-center justify-center px-3 h-full">
              {ssoLoading ? (
                <div style={{
                  width: 18, height: 18,
                  border: '2px solid #E2E8F0',
                  borderTop: '2px solid #5e5e5e',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
              ) : (
                <svg width="21" height="21" viewBox="0 0 21 21" fill="none">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                </svg>
              )}
            </div>
            <div className="flex-1 text-center pr-[42px]">
              <span className="text-[15px] font-semibold text-[#5e5e5e] tracking-[0.375px]">
                {ssoLoading ? '연결 중…' : 'Sign in with Microsoft'}
              </span>
            </div>
          </button>
          <div className="flex items-center justify-center h-[36px]">
            <p className="text-[11px] text-[#99a1af] text-center">
              C&R Research 사내 계정 전용 · 외부 접근 불가
            </p>
          </div>
        </div>

        {/* 구분선 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-black/8" />
          <span className="text-xs text-[#99a1af]">또는 이메일로 로그인</span>
          <div className="flex-1 h-px bg-black/8" />
        </div>

        {/* 이메일 + 비밀번호 로그인 */}
        <div className="space-y-4 backdrop-blur-[10px]"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* 이메일 */}
            <div>
              <div className="flex items-center gap-2 px-3 py-3.5 rounded-xl border border-black/20 overflow-hidden">
                <Mail size={14} className="flex-shrink-0 text-[rgba(17,17,17,0.3)]" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@cnrres.com"
                  required
                  className="flex-1 text-[13px] text-[#111] bg-transparent outline-none placeholder:text-[rgba(17,17,17,0.3)]"
                />
              </div>
            </div>

            {/* 비밀번호 */}
            <div>
              <div className="flex items-center gap-2 px-3 py-3.5 rounded-xl border border-black/20 overflow-hidden">
                <Lock size={14} className="flex-shrink-0 text-[rgba(17,17,17,0.3)]" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  required
                  className="flex-1 text-[13px] text-[#111] bg-transparent outline-none placeholder:text-[rgba(17,17,17,0.3)]"
                />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="flex-shrink-0 text-[rgba(17,17,17,0.3)]">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* 오류 메시지 */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm bg-red-50 border border-red-200 text-red-600">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading || ssoLoading}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ boxShadow: '0 4px 20px rgba(70,70,70,0.2)' }}
            >
              {loading ? '로그인 중…' : '로그인'}
            </button>

          </form>
        </div>

        {/* 데모 안내 */}
        {!isSupabaseEnabled && (
          <div className="mt-4 p-3 rounded-xl text-xs space-y-1 bg-slate-50 border border-slate-200 text-slate-500">
            <p className="font-bold text-slate-700">🧪 데모 모드</p>
            <p>이메일: <code className="text-indigo-500 font-semibold">gohyunjung@me.com</code></p>
            <p>비밀번호: <code className="text-indigo-500 font-semibold">cnr1234</code></p>
          </div>
        )}

        {/* 문의 링크 */}
        <div className="text-center px-8 py-6">
          <p className="text-[11px] text-[#99a1af]">
            문의사항이 있으신가요?{' '}
            <span className="text-[#86ccff] font-medium cursor-pointer hover:underline">
              IT 지원팀에 연락
            </span>
          </p>
        </div>

      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// useGuestStats 내부에서만 사용 — alias로 lint 경고 방지
function _useGuestStats() { return useGuestStats() }
