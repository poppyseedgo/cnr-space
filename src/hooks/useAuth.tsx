import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseEnabled } from '../lib/supabase'
import { APP_USERS } from '../data/master'
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
    return APP_USERS.find(u => u.email === email) ?? null
  }

  // Microsoft Graph API로 부서 정보 가져오기
  // provider_token = SIGNED_IN 시 session.provider_token (MS Graph 액세스 토큰)
  async function fetchDeptFromGraph(providerToken: string): Promise<string> {
    try {
      const res = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=department',
        { headers: { Authorization: `Bearer ${providerToken}` } }
      )
      if (!res.ok) return ''
      const data = await res.json()
      return data.department ?? ''
    } catch {
      return ''
    }
  }

  // dept가 비어있으면 Graph API 결과로 profiles 업데이트
  async function syncDept(
    user: AppUser,
    providerToken?: string | null
  ): Promise<AppUser> {
    if (user.dept) return user              // 이미 있으면 스킵
    if (!providerToken) return user         // 토큰 없으면 스킵

    const dept = await fetchDeptFromGraph(providerToken)
    if (!dept) return user

    try {
      await supabase.from('profiles').update({ dept }).eq('id', user.user_id)
    } catch {}
    return { ...user, dept }
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

        // ── 앱 시작 / 새로고침 ──
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

            setTimeout(async () => {
              try {
                let user = await loadProfile(uid, email)
                // 새로고침 시에도 provider_token이 세션에 남아있으면 dept 동기화
                if (user) user = await syncDept(user, session.provider_token)
                setCurrentUser(user)
              } catch {}
              setLoading(false)
            }, 0)
          } else {
            setCurrentUser(null)
            setLoading(false)
          }
        }

        // ── OAuth 로그인 완료 ──
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

            try {
              let user = await loadProfile(uid, email)
              // SIGNED_IN 시 provider_token 확실히 있음 → Graph API로 dept 가져오기
              if (user) user = await syncDept(user, session.provider_token)
              setCurrentUser(user)
            } catch {}
            setLoading(false)

          } else if (!emailLoginHandled.current) {
            const uid   = session.user.id
            const email = session.user.email ?? ''
            try {
              const user = await loadProfile(uid, email)
              setCurrentUser(user)
            } catch {}
            setLoading(false)
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
        // User.Read 스코프 추가 → Graph API /me 호출 권한 (부서 정보 포함)
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
