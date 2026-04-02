/**
 * useAzureAuth — Azure AD SSO 훅
 * MSAL로 로그인 → Supabase profiles에 매핑
 *
 * 동작 흐름:
 *  1. loginWithAzure() 호출
 *  2. MSAL popup → Azure AD 인증
 *  3. id_token 획득 → Supabase signInWithIdToken
 *  4. profiles 테이블 자동 생성/업데이트
 *  5. AppUser 반환
 */
import { useState, useCallback } from 'react'
import { msalInstance, loginRequest, isAzureEnabled } from '../lib/msalConfig'
import { supabase } from '../lib/supabase'
import type { AppUser } from '../types'

export function useAzureAuth() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const loginWithAzure = useCallback(async (): Promise<AppUser | null> => {
    if (!isAzureEnabled) {
      setError('Azure AD 환경변수가 설정되지 않았습니다.')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      // ── 1. MSAL 초기화 ──────────────────────────────────────────
      await msalInstance.initialize()

      // ── 2. Popup 로그인 (redirect 대신 popup — Cloudflare Pages 호환) ──
      const msResult = await msalInstance.loginPopup({
        ...loginRequest,
        prompt: 'select_account',
      })

      const { idToken, account } = msResult
      if (!idToken || !account) throw new Error('토큰을 받지 못했습니다.')

      // ── 3. Supabase에 Azure ID 토큰으로 로그인 ──────────────────
      const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'azure',
        token:    idToken,
      })
      if (authError) throw new Error(`Supabase 인증 실패: ${authError.message}`)
      if (!authData.user) throw new Error('사용자 정보를 가져오지 못했습니다.')

      // ── 4. profiles 테이블 upsert (이름·부서·azure_user_id 동기화) ──
      const azureUserId = account.localAccountId
      const email       = account.username             // UPN = 회사 이메일
      const name        = account.name ?? email.split('@')[0]

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id:            authData.user.id,
          email,
          name,
          azure_user_id: azureUserId,   // Teams DM 발송에 사용
          updated_at:    new Date().toISOString(),
        }, { onConflict: 'id' })
        .select()
        .single()

      if (profileError) console.warn('[Azure SSO] profile upsert 실패:', profileError.message)

      // ── 5. AppUser 구성 ──────────────────────────────────────────
      const appUser: AppUser = {
        user_id:     authData.user.id,
        employee_id: profile?.employee_id ?? '',
        name:        profile?.name ?? name,
        dept:        profile?.dept ?? '',
        role:        profile?.role ?? 'USER',
        email,
      }

      return appUser

    } catch (err: any) {
      // 사용자가 팝업 닫은 경우 — 에러 표시 안 함
      if (err?.errorCode === 'user_cancelled') return null
      const msg = err?.message ?? '로그인 중 오류가 발생했습니다.'
      setError(msg)
      console.error('[Azure SSO]', err)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const logoutFromAzure = useCallback(async () => {
    try {
      await msalInstance.initialize()
      const accounts = msalInstance.getAllAccounts()
      if (accounts.length > 0) {
        await msalInstance.logoutPopup({ account: accounts[0] })
      }
    } catch (err) {
      console.warn('[Azure SSO] 로그아웃 실패:', err)
    }
  }, [])

  return { loginWithAzure, logoutFromAzure, loading, error, isAzureEnabled }
}
