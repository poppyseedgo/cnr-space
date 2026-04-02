import React, { useState, useEffect } from 'react'
import { CalendarDays, Mail, Lock, AlertCircle, Eye, EyeOff, Circle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseEnabled, supabase } from '../lib/supabase'
import { ROOMS_DB } from '../data/master'
import { todayStr, tsDate, tsMin, nowMinutes } from '../utils/time'

/**
 * 사용중 측정 정책:
 *   checked_in = true + 현재 시각이 start_at ~ end_at 사이 + 취소/반납 없음
 * 예약됨 (사용중 아님):
 *   체크인 안 했거나 아직 시작 전
 * 예약가능:
 *   위 두 경우 모두 해당 없는 회의실
 */
function useGuestStats() {
  const [stats, setStats] = useState<{ busy: number; available: number } | null>(null)

  useEffect(() => {
    if (!isSupabaseEnabled) return

    async function fetchStats() {
      try {
        const today = todayStr()
        const now   = nowMinutes()
        // rooms 테이블에서 활성 회의실 수 직접 조회 (ROOMS_DB 하드코딩 제거)
        const { count } = await supabase
          .from('rooms').select('*', { count: 'exact', head: true }).eq('is_active', true)
        const total = count ?? 9  // fallback

        const { data } = await supabase
          .from('bookings')
          .select('room_id, start_at, end_at, checked_in, auto_cancelled, early_ended')
          .eq('auto_cancelled', false)
          .eq('early_ended',    false)
          .gte('start_at', `${today}T00:00:00+09:00`)
          .lte('start_at', `${today}T23:59:59+09:00`)

        if (!data) return

        // 홈카드와 동일한 정책: 시간 범위 내 예약 = 사용중 (체크인 여부 무관)
        // DB에서 오는 start_at이 UTC일 수 있으므로 KST 변환 후 비교
        const toKSTMin = (ts: string): number => {
          if (!ts) return 0
          // +09:00 포함된 경우 그대로, UTC인 경우 +9시간 보정
          if (ts.includes('+09:00') || ts.includes('+09')) {
            return tsMin(ts)
          }
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
              !b.auto_cancelled &&
              !b.early_ended &&
              toKSTDate(b.start_at) === today &&
              toKSTMin(b.start_at) <= now &&
              now < toKSTMin(b.end_at)
            )
            .map(b => b.room_id)
        )

        setStats({
          busy:      busyRoomIds.size,
          available: total - busyRoomIds.size,
        })
      } catch {}
    }

    fetchStats()
    const iv = setInterval(fetchStats, 30000)
    return () => clearInterval(iv)
  }, [])

  return stats
}

import { isAzureEnabled } from '../lib/msalConfig'

export default function LoginPage() {
  const { login } = useAuth()
  const { loginWithAzure } = useAuth()
  const [azureLoading, setAzureLoading] = useState(false)
  const [azureErr, setAzureErr] = useState('')

  async function handleAzureLogin() {
    setAzureErr('')
    setAzureLoading(true)
    try {
      await loginWithAzure()
    } catch (err: any) {
      if (err?.errorCode !== 'user_cancelled') {
        setAzureErr(err?.message ?? '회사 계정 로그인에 실패했습니다.')
      }
    } finally {
      setAzureLoading(false)
    }
  }
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const stats = useGuestStats()

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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(145deg, #0F0F1A 0%, #1A1A2E 50%, #0F0F1A 100%)' }}>

      <div className="w-full max-w-sm">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', boxShadow: '0 8px 32px rgba(99,102,241,0.4)' }}>
            <CalendarDays size={30} color="#fff" strokeWidth={1.6} />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">C&R Space</h1>
          <p className="text-sm mt-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
            CNR Research 회의실 예약 시스템
          </p>
        </div>

        {/* 실시간 현황 */}
        {isSupabaseEnabled && (
          <div className="flex gap-3 mb-6">
            {stats ? (
              <>
                <div className="flex-1 rounded-2xl px-4 py-3"
                  style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Circle size={6} fill="#F43F5E" strokeWidth={0} />
                    <span className="text-xs font-medium" style={{ color: 'rgba(244,63,94,0.8)' }}>사용중</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {stats.busy}
                    <span className="text-sm font-normal ml-1" style={{ color: 'rgba(255,255,255,0.4)' }}>개</span>
                  </p>
                </div>
                <div className="flex-1 rounded-2xl px-4 py-3"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Circle size={6} fill="#10B981" strokeWidth={0} />
                    <span className="text-xs font-medium" style={{ color: 'rgba(16,185,129,0.8)' }}>예약가능</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {stats.available}
                    <span className="text-sm font-normal ml-1" style={{ color: 'rgba(255,255,255,0.4)' }}>개</span>
                  </p>
                </div>
              </>
            ) : (
              <>
                {[0,1].map(i => (
                  <div key={i} className="flex-1 h-20 rounded-2xl animate-pulse"
                    style={{ background: 'rgba(255,255,255,0.06)' }} />
                ))}
              </>
            )}
          </div>
        )}

        {/* 로그인 카드 */}
        <div className="rounded-2xl px-6 py-6"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)' }}>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* 이메일 */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                이메일
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@cnrres.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-white transition-all outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.8)'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                />
              </div>
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                비밀번호
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  required
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl text-sm text-white transition-all outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.8)'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* 오류 메시지 */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}>
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Azure AD 로그인 버튼 (환경변수 설정 시 표시) */}
            {isAzureEnabled && (
              <>
                <button
                  type="button"
                  onClick={handleAzureLogin}
                  disabled={azureLoading}
                  className="btn w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: azureLoading ? 'rgba(0,114,206,0.5)' : '#0072CE',
                    color: '#fff',
                    cursor: azureLoading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 23 23" fill="none">
                    <path d="M1 1h10v10H1z" fill="#F25022"/>
                    <path d="M12 1h10v10H12z" fill="#7FBA00"/>
                    <path d="M1 12h10v10H1z" fill="#00A4EF"/>
                    <path d="M12 12h10v10H12z" fill="#FFB900"/>
                  </svg>
                  {azureLoading ? '로그인 중…' : '회사 계정으로 로그인'}
                </button>
                {azureErr && <p style={{ color: '#FCA5A5', fontSize: 11, textAlign: 'center' }}>{azureErr}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }}/>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>또는</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }}/>
                </div>
              </>
            )}

            {/* 이메일 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{
                background: loading ? 'rgba(99,102,241,0.5)' : 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(99,102,241,0.4)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '로그인 중…' : '로그인'}
            </button>

          </form>
        </div>

        {/* 데모 안내 */}
        {!isSupabaseEnabled && (
          <div className="mt-4 p-3 rounded-xl text-xs space-y-1"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
            <p className="font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>🧪 데모 모드</p>
            <p>이메일: <code className="text-indigo-400 font-semibold">gohyunjung@me.com</code></p>
            <p>비밀번호: <code className="text-indigo-400 font-semibold">cnr1234</code></p>
          </div>
        )}

      </div>
    </div>
  )
}
