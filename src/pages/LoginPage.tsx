import React, { useState } from 'react'
import { CalendarDays, Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseEnabled } from '../lib/supabase'

export default function LoginPage() {
  const { login } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-slate-50 to-indigo-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
            <CalendarDays size={28} color="#fff" strokeWidth={1.8} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            C&R Booking Room
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            CNR Research 회의실 예약 시스템
          </p>
        </div>

        {/* 카드 */}
        <div className="bg-white rounded-2xl shadow-md shadow-slate-100 border border-slate-100 px-6 py-7">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* 이메일 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                이메일
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@cnrres.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                             placeholder:text-slate-300 transition-all"
                />
              </div>
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                비밀번호
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  required
                  className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                             placeholder:text-slate-300 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* 오류 메시지 */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-600">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white
                         bg-indigo-600 hover:bg-indigo-700 active:scale-95
                         disabled:bg-indigo-300 disabled:cursor-not-allowed
                         transition-all shadow-sm shadow-indigo-100"
            >
              {loading ? '로그인 중…' : '로그인'}
            </button>

          </form>

          {/* 데모 안내 */}
          {!isSupabaseEnabled && (
            <div className="mt-5 p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500 space-y-1">
              <p className="font-bold text-slate-700">🧪 데모 모드</p>
              <p>이메일: <code className="text-indigo-600 font-semibold">gohyunjung@me.com</code></p>
              <p>비밀번호: <code className="text-indigo-600 font-semibold">cnr1234</code></p>
              <p className="text-slate-400">(ADMIN) 또는 다른 직원 이메일 + cnr1234</p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
