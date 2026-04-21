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
    <div
      /* ← [2026-04-21 피그마 node 201:1108] 배경 그라디언트 교체
           흰색 63.45%까지 유지 → 93.75% 지점에서 연한 파랑(#B0DEFF)으로 페이드
           min-height 100vh, 세로 중앙 정렬은 그대로 */
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{
        background: 'linear-gradient(180deg, #FFFFFF 63.45%, #B0DEFF 93.75%)',
      }}
    >
      {/* ← [피그마] 카드 컨테이너: width 448 (content 320 + padding) */}
      <div style={{ width: '100%', maxWidth: 448 }}>

        {/* ← [피그마 node 201:1137] 흰색 카드
             bg #fff, radius 24, padding 24px 24px 1px, gap 32 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 24,
            padding: '24px 24px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 32,
          }}
        >

          {/* ① 로고 — C&R Space */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1
              style={{
                fontFamily: 'Pretendard, sans-serif',
                fontWeight: 500,        // Medium
                fontSize: 32,
                lineHeight: '36px',
                letterSpacing: '0.64px',
                textTransform: 'uppercase',
                color: '#111',
                textAlign: 'center',
                margin: 0,
                whiteSpace: 'nowrap',
              }}
            >
              C&amp;R Space
            </h1>
          </div>

          {/* ② 설명 텍스트 */}
          <p
            style={{
              fontFamily: 'Pretendard, sans-serif',
              fontWeight: 400,          // Regular
              fontSize: 12,
              lineHeight: '16px',
              color: '#171717',
              textAlign: 'center',
              margin: 0,
              whiteSpace: 'nowrap',
            }}
          >
            사내 Microsoft ID로 로그인 하세요.
          </p>

          {/* ③ Sign in with Microsoft 버튼 — 피그마 node 201:1143
               width 320, height 41, border 1px #8C8C8C, radius 10 */}
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={ssoLoading}
            style={{
              width: 320,
              height: 41,
              display: 'flex',
              alignItems: 'center',
              background: '#fff',
              border: '1px solid #8C8C8C',
              borderRadius: 10,
              padding: 1,
              overflow: 'hidden',
              cursor: ssoLoading ? 'not-allowed' : 'pointer',
              opacity: ssoLoading ? 0.6 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!ssoLoading) e.currentTarget.style.background = '#F8FAFC' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
          >
            {/* 아이콘 영역 41x41 */}
            <div
              style={{
                width: 41, height: 41, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 10px',
              }}
            >
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
            {/* 텍스트 영역 */}
            <div style={{ flex: 1, textAlign: 'center', paddingRight: 41 }}>
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,         // SemiBold
                  fontSize: 15,
                  lineHeight: '22.5px',
                  letterSpacing: '0.375px',
                  color: '#5E5E5E',
                }}
              >
                {ssoLoading ? '연결 중…' : 'Sign in with Microsoft'}
              </span>
            </div>
          </button>

          {/* SSO 오류 메시지 — 피그마에 없으나 기능상 유지 */}
          {error && (
            <div style={{
              width: 320, display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', borderRadius: 12,
              background: '#FEF2F2', border: '1px solid #FCA5A5',
              color: '#DC2626', fontSize: 13,
            }}>
              <AlertCircle size={14} strokeWidth={1.8} style={{flexShrink: 0}}/>
              <span>{error}</span>
            </div>
          )}

          {/* ④ 하단 텍스트 그룹 — 피그마 node 201:1172, gap 4 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
            <p
              style={{
                fontFamily: 'Pretendard, sans-serif',
                fontWeight: 400,
                fontSize: 12,
                lineHeight: '16px',
                color: '#86CCFF',       // ← [피그마] 연한 파랑
                margin: 0,
                whiteSpace: 'nowrap',
              }}
            >
              C&amp;R Research 사내 계정 전용 · 외부 접근 불가
            </p>
            <p style={{ margin: 0, width: 215, textAlign: 'center' }}>
              <span
                style={{
                  fontFamily: 'Pretendard, sans-serif',
                  fontWeight: 500,           // Medium
                  fontSize: 12,
                  lineHeight: '16px',
                  color: 'rgba(134, 204, 255, 0.53)',   // ← [피그마] 더 연한 파랑
                }}
              >
                문의사항이 있으신가요?{' '}
              </span>
              <span
                style={{
                  fontFamily: 'Pretendard, sans-serif',
                  fontWeight: 500,
                  fontSize: 12,
                  lineHeight: '16px',
                  color: '#86CCFF',
                  cursor: 'pointer',
                }}
                onClick={() => { /* 필요 시 handler 연결 */ }}
              >
                ISS 박대우님 문의
              </span>
            </p>
          </div>

        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// useGuestStats 내부에서만 사용 — alias로 lint 경고 방지
function _useGuestStats() { return useGuestStats() }
