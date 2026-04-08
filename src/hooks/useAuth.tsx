import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseEnabled } from '../lib/supabase'
import type { AppUser } from '../types'

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

  // 세션 토큰으로 즉시 만드는 최소 유저 (DB 조회 전 빠른 렌더용)
  function sessionToUser(sessionUser: any): AppUser {
    const meta = sessionUser.user_metadata ?? {}
    return {
      user_id:     sessionUser.id,
      employee_id: '',
      name:        meta.full_name ?? meta.name ?? sessionUser.email?.split('@')[0] ?? '사용자',
      dept:        meta.department ?? meta.custom_claims?.department ?? '',
      role:        'USER',
      email:       sessionUser.email ?? '',
    }
  }

  // DB에서 풀 프로필 조회
  async function loadProfile(userId: string, email: string): Promise<AppUser | null> {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', userId).single()
      if (!error && data) return profileToUser(data)
    } catch {}
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('email', email).single()
      if (!error && data) return profileToUser(data)
    } catch {}
    return null
  }

  // Graph API로 부서 가져와 DB 저장 (첫 SSO 로그인 시, fire-and-forget)
  async function fetchAndSaveDept(userId: string, providerToken: string): Promise<string> {
    try {
      const res = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=department',
        { headers: { Authorization: `Bearer ${providerToken}` } }
      )
      if (!res.ok) return ''
      const json = await res.json()
      const dept = json.department ?? ''
      if (dept) await supabase.from('profiles').update({ dept }).eq('id', userId)
      return dept
    } catch { return '' }
  }

  function cleanCallbackUrl() {
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/')
    }
  }

  useEffect(() => {
    if (!isSupabaseEnabled) {
      const saved = localStorage.getItem('cnr_mock_user')
      if (saved) { try { setCurrentUser(JSON.parse(saved)) } catch {} }
      setLoading(false)
      return
    }

    const urlParams = new URLSearchParams(window.location.search)
    const errorDesc = urlParams.get('error_description')
    if (errorDesc) {
      setSsoError(decodeURIComponent(errorDesc))
      window.history.replaceState({}, document.title, '/')
    }

    const fallbackTimer = setTimeout(() => setLoading(false), 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        // ── 새로고침 / 앱 시작 ─────────────────────────────────────────
        if (event === 'INITIAL_SESSION') {
          clearTimeout(fallbackTimer)
          cleanCallbackUrl()

          if (session?.user) {
            const uid   = session.user.id
            const email = session.user.email ?? ''

            if (!email.endsWith(ALLOWED_DOMAIN)) {
              await supabase.auth.signOut()
              setCurrentUser(null)
              setLoading(false)
              setSsoError(`${ALLOWED_DOMAIN} 사내 계정만 로그인할 수 있습니다.`)
              return
            }

            // ★ 핵심: 세션 있으면 즉시 앱 진입 (DB 기다리지 않음)
            setCurrentUser(sessionToUser(session.user))
            setLoading(false)

            // DB 프로필은 백그라운드에서 조회 후 업데이트 (name/dept/role 보정)
            loadProfile(uid, email).then(async user => {
              if (!user) return
              // DB dept가 비어있으면 Graph API로 보정 (sync로 인해 dept 유실된 경우 복구)
              if (!user.dept && session.provider_token) {
                const dept = await fetchAndSaveDept(uid, session.provider_token)
                if (dept) user = { ...user, dept }
              }
              setCurrentUser(user)
            }).catch(() => {})

          } else {
            setCurrentUser(null)
            setLoading(false)
          }
        }

        // ── 첫 SSO 로그인 완료 ─────────────────────────────────────────
        else if (event === 'SIGNED_IN' && session?.user) {
          const provider = session.user.app_metadata?.provider
          cleanCallbackUrl()

          if (provider && provider !== 'email') {
            const uid   = session.user.id
            const email = session.user.email ?? ''

            if (!email.endsWith(ALLOWED_DOMAIN)) {
              await supabase.auth.signOut()
              setCurrentUser(null)
              setLoading(false)
              setSsoError(`${ALLOWED_DOMAIN} 사내 계정만 로그인할 수 있습니다.`)
              return
            }

            // 즉시 세션 기반 유저 세팅
            setCurrentUser(sessionToUser(session.user))
            setLoading(false)

            // 백그라운드: DB 프로필 조회 + Graph API 부서 동기화
            loadProfile(uid, email).then(async user => {
              if (!user) return
              if (!user.dept && session.provider_token) {
                const dept = await fetchAndSaveDept(uid, session.provider_token)
                if (dept) user = { ...user, dept }
              }
              setCurrentUser(user)
            }).catch(() => {})

          } else if (!emailLoginHandled.current) {
            const uid   = session.user.id
            const email = session.user.email ?? ''
            const user  = await loadProfile(uid, email)
            setCurrentUser(user)
            setLoading(false)
          }

          emailLoginHandled.current = false
        }

        // ── 로그아웃 ──────────────────────────────────────────────────
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

  const login = useCallback(async (email: string, password: string) => {
    setSsoError(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Invalid login'))       throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
      if (error.message.includes('Email not confirmed')) throw new Error('이메일 인증이 필요합니다.')
      throw new Error(error.message)
    }
    if (data.user) {
      emailLoginHandled.current = true
      const user = await loadProfile(data.user.id, data.user.email ?? '')
      setCurrentUser(user)
    }
  }, [])

  const loginWithMicrosoft = useCallback(async () => {
    setSsoError(null)
    if (!isSupabaseEnabled) {
      throw new Error('SSO는 Supabase 연결 후 사용 가능합니다.')
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'openid profile email User.Read',
        redirectTo: window.location.origin,
      },
    })
    if (error) throw new Error(error.message)
  }, [])

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
