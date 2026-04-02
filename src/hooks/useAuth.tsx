import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseEnabled } from '../lib/supabase'
import { APP_USERS } from '../data/master'
import type { AppUser } from '../types'

// ─── 상수 ────────────────────────────────────────────────────────────────────
const ALLOWED_DOMAIN = '@cnrres.com'

interface AuthContextType {
  currentUser: AppUser | null
  loading:     boolean
  login:       (email: string, password: string) => Promise<void>
  loginWithMicrosoft: () => Promise<void>
  logout:      () => Promise<void>
  isAdmin:     boolean
  ssoError:    string | null
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [ssoError,    setSsoError]    = useState<string | null>(null)

  // email/password login()이 이미 처리했음을 표시 → SIGNED_IN 중복 방지용
  const emailLoginHandled = useRef(false)

  function profileToUser(p: Record<string, any>): AppUser {
    return {
      user_id:     p.id,
      employee_id: p.employee_id ?? '',
      name:        p.name  ?? '사용자',
      dept:        p.dept  ?? '',
      role:        p.role  ?? 'USER',
      email:       p.email ?? '',
    }
  }

  // profiles 테이블 조회 → 없으면 email로 재시도 → APP_USERS fallback
  async function loadProfile(userId: string, email: string): Promise<AppUser | null> {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', userId).single()
      if (!error && data) return profileToUser(data)
    } catch {}
    // SSO 신규 유저: DB 트리거가 profiles에 생성했을 수 있으므로 email로 재시도
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('email', email).single()
      if (!error && data) return profileToUser(data)
    } catch {}
    // 최후 fallback: 하드코딩 APP_USERS (개발/데모용)
    return APP_USERS.find(u => u.email === email) ?? null
  }

  // OAuth 콜백 URL 정리: /auth/callback → /
  function cleanCallbackUrl() {
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/')
    }
  }

  useEffect(() => {
    // ── localStorage 모드 (개발/데모) ────────────────────────────────────
    if (!isSupabaseEnabled) {
      const saved = localStorage.getItem('cnr_mock_user')
      if (saved) { try { setCurrentUser(JSON.parse(saved)) } catch {} }
      setLoading(false)
      return
    }

    // ── URL 에러 파라미터 확인 (OAuth 실패 시 Supabase가 쿼리로 전달) ──
    const urlParams = new URLSearchParams(window.location.search)
    const errorDesc = urlParams.get('error_description')
    if (errorDesc) {
      setSsoError(decodeURIComponent(errorDesc))
      window.history.replaceState({}, document.title, '/')
    }

    // ── Supabase onAuthStateChange ────────────────────────────────────────
    const fallbackTimer = setTimeout(() => setLoading(false), 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        // ── 앱 시작 / 새로고침 / OAuth 리다이렉트 복귀 ──
        if (event === 'INITIAL_SESSION') {
          clearTimeout(fallbackTimer)
          cleanCallbackUrl()

          if (session?.user) {
            const uid   = session.user.id
            const email = session.user.email ?? ''

            // 도메인 검증
            if (!email.endsWith(ALLOWED_DOMAIN)) {
              await supabase.auth.signOut()
              setCurrentUser(null)
              setLoading(false)
              setSsoError(`${ALLOWED_DOMAIN} 사내 계정만 로그인할 수 있습니다.`)
              return
            }

            setTimeout(() => {
              loadProfile(uid, email).then(user => {
                setCurrentUser(user)
                setLoading(false)
              }).catch(() => setLoading(false))
            }, 0)
          } else {
            setCurrentUser(null)
            setLoading(false)
          }
        }

        // ── OAuth 로그인 완료 (Azure SSO 코드 교환 완료 후 발화) ──
        else if (event === 'SIGNED_IN' && session?.user) {
          const provider = session.user.app_metadata?.provider
          cleanCallbackUrl()

          if (provider && provider !== 'email') {
            // Azure SSO: login() 미호출 → 여기서 직접 프로필 로드
            const uid   = session.user.id
            const email = session.user.email ?? ''

            if (!email.endsWith(ALLOWED_DOMAIN)) {
              await supabase.auth.signOut()
              setCurrentUser(null)
              setLoading(false)
              setSsoError(`${ALLOWED_DOMAIN} 사내 계정만 로그인할 수 있습니다.`)
              return
            }

            loadProfile(uid, email).then(user => {
              setCurrentUser(user)
              setLoading(false)
            }).catch(() => setLoading(false))

          } else if (!emailLoginHandled.current) {
            // email/password 신규 로그인인데 login()이 처리 못한 엣지 케이스
            const uid   = session.user.id
            const email = session.user.email ?? ''
            loadProfile(uid, email).then(user => {
              setCurrentUser(user)
              setLoading(false)
            }).catch(() => setLoading(false))
          }

          emailLoginHandled.current = false
        }

        // ── 로그아웃 ──
        else if (event === 'SIGNED_OUT') {
          setCurrentUser(null)
          setLoading(false)
        }
      }
    )

    return () => {
      clearTimeout(fallbackTimer)
      subscription.unsubscribe()
    }
  }, [])

  // ── Email + Password 로그인 ───────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    setSsoError(null)
    if (!isSupabaseEnabled) {
      const found = APP_USERS.find(u => u.email === email)
      if (!found)                 throw new Error('등록되지 않은 이메일입니다.')
      if (password !== 'cnr1234') throw new Error('비밀번호가 올바르지 않습니다.')
      setCurrentUser(found)
      localStorage.setItem('cnr_mock_user', JSON.stringify(found))
      return
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Invalid login'))       throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
      if (error.message.includes('Email not confirmed')) throw new Error('이메일 인증이 필요합니다.')
      throw new Error(error.message)
    }
    if (data.user) {
      emailLoginHandled.current = true  // SIGNED_IN 이벤트 중복 처리 방지
      const user = await loadProfile(data.user.id, data.user.email ?? '')
      setCurrentUser(user)
    }
  }, [])

  // ── Microsoft SSO 로그인 ─────────────────────────────────────────────────
  const loginWithMicrosoft = useCallback(async () => {
    setSsoError(null)
    if (!isSupabaseEnabled) {
      throw new Error('SSO는 Supabase 연결 후 사용 가능합니다.')
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'openid profile email',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw new Error(error.message)
    // 이후 Microsoft 로그인 페이지로 리다이렉트됨 → 복귀 시 SIGNED_IN 발화
  }, [])

  // ── 로그아웃 ─────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    setSsoError(null)
    if (!isSupabaseEnabled) {
      setCurrentUser(null)
      localStorage.removeItem('cnr_mock_user')
      return
    }
    await supabase.auth.signOut()
    setCurrentUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      currentUser,
      loading,
      login,
      loginWithMicrosoft,
      logout,
      isAdmin: currentUser?.role === 'ADMIN',
      ssoError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서 사용해야 합니다.')
  return ctx
}
