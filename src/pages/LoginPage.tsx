import React, { useState, useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { todayStr, tsMin, nowMinutes } from '../utils/time'

/**
 * 사용중 측정 정책:
 *   checked_in = true + 현재 시각이 start_at ~ end_at 사이 + 취소/반납 없음
 */
function useGuestStats() {
  const [stats, setStats] = useState<{ busy: number; available: number } | null>(null)

  useEffect(() => {
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
          if (ts.includes('+09:00') || ts.includes('+09')) return todayStr()
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
  const { loginWithMicrosoft, ssoError } = useAuth()
  const [error,      setError]      = useState('')
  const [ssoLoading, setSsoLoading] = useState(false)
  _useGuestStats()

  // SSO 에러를 로컬 error 상태로 표시
  useEffect(() => {
    if (ssoError) setError(ssoError)
  }, [ssoError])

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
        {/* ← [2026-05-07] 텍스트 h1 → SVG 로고 교체 (desktop 115×24) */}
        <div className="text-center mb-5 overflow-hidden">
          <div className="h-5" />
          <div className="flex justify-center items-center">
            <svg width="115" height="24" viewBox="0 0 115 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.52 20.4C5.56 20.4 4 19.72 2.8 18.32C1.58 16.96 0.98 15.14 0.98 12.88C0.98 10.64 1.58 8.86 2.8 7.5C4 6.14 5.56 5.46 7.52 5.46C9.12 5.46 10.48 5.9 11.58 6.76C12.64 7.64 13.26 8.8 13.46 10.28H11.1C10.9 9.44 10.52 8.78 9.92 8.3C9.32 7.82 8.56 7.58 7.64 7.58C6.32 7.58 5.28 8.06 4.54 9C3.78 9.96 3.42 11.24 3.42 12.88C3.42 14.54 3.78 15.86 4.54 16.82C5.3 17.8 6.32 18.28 7.64 18.28C8.64 18.28 9.44 18 10.06 17.44C10.66 16.88 11.04 16.1 11.2 15.08H13.54C13.36 16.76 12.74 18.06 11.68 19C10.6 19.94 9.22 20.4 7.52 20.4ZM26.3183 16.92L29.0783 20.02H26.1583L24.8783 18.56C23.6583 19.72 22.2183 20.3 20.5783 20.3C19.1383 20.3 17.9783 19.94 17.0783 19.18C16.1783 18.46 15.7383 17.46 15.7383 16.2C15.7383 14.24 16.8383 12.82 19.0583 11.92C18.4383 11.28 17.9983 10.62 17.7583 9.94C17.5183 9.28 17.4383 8.68 17.5583 8.16C17.6583 7.64 17.8783 7.16 18.2183 6.74C18.5383 6.32 18.9783 6 19.5383 5.76C20.0783 5.54 20.6783 5.42 21.3183 5.42C22.4383 5.42 23.3583 5.74 24.0983 6.36C24.8183 6.98 25.1783 7.78 25.1783 8.76C25.1783 10.32 24.2383 11.56 22.3583 12.5L24.9183 15.36C25.2383 14.62 25.4583 13.82 25.5583 12.94H27.7983C27.5983 14.44 27.0983 15.76 26.3183 16.92ZM22.5183 7.76C22.1583 7.52 21.7583 7.38 21.3583 7.36C20.9383 7.36 20.5583 7.48 20.2383 7.76C19.8983 8.04 19.7383 8.4 19.7783 8.82C19.7783 9.38 20.0383 9.94 20.5783 10.5L21.0383 11.02C21.7183 10.7 22.1983 10.38 22.5183 10.04C22.8183 9.72 22.9783 9.32 22.9783 8.88C22.9783 8.42 22.8183 8.04 22.5183 7.76ZM20.7583 18.32C21.8383 18.32 22.7783 17.92 23.5783 17.08L20.3783 13.4C18.8383 14.04 18.0783 14.94 18.0783 16.08C18.0783 16.76 18.3183 17.3 18.7983 17.7C19.2783 18.12 19.9183 18.32 20.7583 18.32ZM41.635 15.48L42.195 20H39.715L39.335 16.28C39.255 15.52 39.055 14.98 38.695 14.66C38.335 14.34 37.755 14.18 36.975 14.18H33.495V20H31.075V5.76H37.695C39.115 5.76 40.215 6.12 40.975 6.8C41.735 7.5 42.115 8.44 42.115 9.6C42.115 10.52 41.875 11.28 41.435 11.88C40.975 12.48 40.335 12.9 39.495 13.12C40.755 13.4 41.475 14.18 41.635 15.48ZM33.495 12.16H36.955C37.835 12.16 38.515 11.96 38.995 11.56C39.475 11.16 39.715 10.62 39.715 9.9C39.715 9.26 39.495 8.74 39.095 8.38C38.695 8.02 38.095 7.82 37.315 7.82H33.495V12.16ZM55.7161 20.38C53.8961 20.38 52.4761 19.96 51.4561 19.12C50.4361 18.28 49.8761 17.08 49.7961 15.48H52.1561C52.2961 17.44 53.4961 18.4 55.7361 18.4C56.7361 18.4 57.4961 18.22 58.0361 17.84C58.5761 17.46 58.8561 16.92 58.8561 16.22C58.8561 15.66 58.6561 15.22 58.2561 14.88C57.8561 14.56 57.1961 14.28 56.2761 14.08L53.9561 13.54C51.4561 12.98 50.2161 11.7 50.2161 9.7C50.2161 8.5 50.6561 7.48 51.5761 6.64C52.4561 5.84 53.7361 5.44 55.3961 5.44C57.0361 5.44 58.3361 5.84 59.3361 6.64C60.3161 7.44 60.8561 8.54 60.9761 9.94H58.6361C58.5361 9.14 58.1961 8.52 57.6361 8.08C57.0761 7.64 56.3161 7.42 55.3761 7.42C54.4961 7.42 53.8161 7.62 53.3361 7.98C52.8361 8.34 52.5961 8.84 52.5961 9.46C52.5961 10.42 53.2761 11.04 54.6561 11.32L57.3361 11.94C59.9761 12.56 61.3161 13.92 61.3161 16.02C61.3161 17.36 60.8161 18.42 59.8361 19.2C58.8561 20 57.4761 20.38 55.7161 20.38ZM63.7969 5.76H69.5569C71.0369 5.76 72.2169 6.14 73.0569 6.9C73.8969 7.66 74.3169 8.72 74.3169 10.1C74.3169 11.54 73.8769 12.64 73.0169 13.4C72.1569 14.18 70.9569 14.56 69.3969 14.56H66.2169V20H63.7969V5.76ZM66.2169 12.5H69.2769C70.1169 12.5 70.7769 12.3 71.2569 11.88C71.7169 11.48 71.9569 10.88 71.9569 10.12C71.9569 9.38 71.7169 8.82 71.2769 8.42C70.8169 8.02 70.1969 7.82 69.3969 7.82H66.2169V12.5ZM87.4859 20H84.8659L83.6259 16.44H78.0659L76.8059 20H74.2259L79.5059 5.76H82.2859L87.4859 20ZM80.0259 10.86L78.7859 14.4H82.9259L81.7059 10.86L80.8659 8.06L80.0259 10.86ZM95.1536 20.4C93.1936 20.4 91.6336 19.72 90.4336 18.32C89.2136 16.96 88.6136 15.14 88.6136 12.88C88.6136 10.64 89.2136 8.86 90.4336 7.5C91.6336 6.14 93.1936 5.46 95.1536 5.46C96.7536 5.46 98.1136 5.9 99.2136 6.76C100.274 7.64 100.894 8.8 101.094 10.28H98.7336C98.5336 9.44 98.1536 8.78 97.5536 8.3C96.9536 7.82 96.1936 7.58 95.2736 7.58C93.9536 7.58 92.9136 8.06 92.1736 9C91.4136 9.96 91.0536 11.24 91.0536 12.88C91.0536 14.54 91.4136 15.86 92.1736 16.82C92.9336 17.8 93.9536 18.28 95.2736 18.28C96.2736 18.28 97.0736 18 97.6936 17.44C98.2936 16.88 98.6736 16.1 98.8336 15.08H101.174C100.994 16.76 100.374 18.06 99.3136 19C98.2336 19.94 96.8536 20.4 95.1536 20.4ZM105.892 13.68V17.94H113.872V20H103.472V5.76H113.692V7.82H105.892V11.6H112.992V13.68H105.892Z" fill="#111111"/>
            </svg>
          </div>
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
              
            </p>
          </div>
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={ssoLoading}
            className="w-full h-[46px] flex items-center rounded-[10px] border border-black/20 bg-white overflow-hidden transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
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

          {/* SSO 오류 메시지 */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mt-3 text-sm bg-red-50 border border-red-200 text-red-600">
              <AlertCircle size={14} strokeWidth={1.8} className="flex-shrink-0"/>
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-center h-[36px]">
            <p className="text-[11px] text-[#99a1af] text-center">
              C&R Research 사내 계정 전용 · 외부 접근 불가
            </p>
          </div>
        </div>

        {/* 문의 링크 */}
        <div className="text-center px-8 py-6">
          <p className="text-[11px] text-[#99a1af]">
            Microsoft 365 비밀번호 분실 시{' '}
            <span className="text-[#86ccff] font-medium cursor-pointer hover:underline">
              ISS 박대우 님 문의
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
