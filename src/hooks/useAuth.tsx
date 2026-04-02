import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { msalInstance, msalReady, isAzureEnabled } from '../lib/msalConfig'
import { supabase, isSupabaseEnabled } from '../lib/supabase'
import { APP_USERS } from '../data/master'
import type { AppUser } from '../types'

interface AuthContextType {
  currentUser:    AppUser | null
  loading:        boolean
  login:          (email: string, password: string) => Promise<void>
  loginWithAzure: () => Promise<void>
  logout:         () => Promise<void>
  isAdmin:        boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [loading,     setLoading]     = useState(true)

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

  // profiles 조회 — auth lock과 무관하게 별도 실행
  async function loadProfile(userId: string, email: string): Promise<AppUser | null> {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', userId).single()
      if (!error && data) return profileToUser(data)
    } catch {}
    return APP_USERS.find(u => u.email === email) ?? null
  }

  useEffect(() => {
    // ── localStorage 모드 ──────────────────────────────────────────
    if (!isSupabaseEnabled) {
      const saved = localStorage.getItem('cnr_mock_user')
      if (saved) { try { setCurrentUser(JSON.parse(saved)) } catch {} }
      setLoading(false)
      return
    }

    // ── Supabase 모드 ──────────────────────────────────────────────
    // getSession()을 직접 호출하지 않음 — onAuthStateChange가 내부적으로
    // INITIAL_SESSION 이벤트를 발화시키면서 현재 세션을 전달함.
    // getSession() + onAuthStateChange 동시 실행 시 auth lock 충돌 발생.

    // 안전망: INITIAL_SESSION이 5초 내 안 오면 강제 로딩 종료
    const fallbackTimer = setTimeout(() => {
      setLoading(false)
    }, 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'INITIAL_SESSION') {
          // 앱 시작/새로고침/새 탭 시 반드시 발화
          clearTimeout(fallbackTimer)
          if (session?.user) {
            // ★ auth lock 해제 후 비동기로 프로필 조회 (lock 충돌 방지)
            // setTimeout(0)으로 현재 이벤트 루프 사이클 이후 실행
            const uid   = session.user.id
            const email = session.user.email ?? ''
            setTimeout(() => {
              loadProfile(uid, email).then(user => {
                setCurrentUser(user)
                setLoading(false)
              }).catch(() => {
                setLoading(false)
              })
            }, 0)
          } else {
            // 미로그인 상태
            setCurrentUser(null)
            setLoading(false)
          }
        } else if (event === 'SIGNED_IN' && session?.user) {
          // 로그인 이벤트 (login() 함수 호출 후 발화)
          // login()에서 이미 setCurrentUser 처리하므로 중복 방지
        } else if (event === 'SIGNED_OUT') {
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

  const loginWithAzure = useCallback(async () => {
    if (!isAzureEnabled) throw new Error('Azure AD 환경변수가 설정되지 않았습니다.')
    await msalReady

    // 이전 interaction 상태 잔여물 제거 — interaction_in_progress 방지
    const keys = Object.keys(sessionStorage).filter(k =>
      k.includes('msal') && (k.includes('interaction.status') || k.includes('request'))
    )
    keys.forEach(k => sessionStorage.removeItem(k))

    // 혹시 진행중인 redirect 처리 먼저
    await msalInstance.handleRedirectPromise().catch(() => {})
    const result = await msalInstance.loginPopup({
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      prompt: 'select_account',
    })
    const { idToken, account } = result
    if (!idToken || !account) throw new Error('토큰을 받지 못했습니다.')

    // Supabase에 Azure 토큰으로 로그인
    const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
      provider: 'azure',
      token: idToken,
    })
    if (authError) throw new Error(authError.message)
    if (!authData.user) throw new Error('사용자 정보를 가져오지 못했습니다.')

    // profiles upsert — azure_user_id 저장
    await supabase.from('profiles').upsert({
      id:            authData.user.id,
      email:         account.username,
      name:          account.name ?? account.username.split('@')[0],
      azure_user_id: account.localAccountId,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'id' })

    const user = await loadProfile(authData.user.id, account.username)
    setCurrentUser(user)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
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
      const user = await loadProfile(data.user.id, data.user.email ?? '')
      setCurrentUser(user)
    }
  }, [])

  const logout = useCallback(async () => {
    if (!isSupabaseEnabled) {
      setCurrentUser(null)
      localStorage.removeItem('cnr_mock_user')
      return
    }
    await supabase.auth.signOut()
    setCurrentUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, loginWithAzure, logout, isAdmin: currentUser?.role === 'ADMIN' }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서 사용해야 합니다.')
  return ctx
}
