/**
 * MSAL 설정 — Azure AD SSO
 * 환경변수: VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID
 *
 * 샌드박스: M365 Developer Program 테넌트 값 입력
 * 실환경:   IT팀 발급 값으로 교체
 */
import { PublicClientApplication, type Configuration } from '@azure/msal-browser'

const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID as string

export const msalConfig: Configuration = {
  auth: {
    clientId:    CLIENT_ID || '',
    authority:   `https://login.microsoftonline.com/${TENANT_ID || 'common'}`,
    redirectUri: window.location.origin + '/auth/callback',
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:       'sessionStorage',

  },
}

// 요청 스코프 — SSO 기본
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
}

// MSAL 인스턴스 (싱글톤)
export const msalInstance = new PublicClientApplication(msalConfig)

/** Azure AD 활성화 여부 */
export const isAzureEnabled = !!CLIENT_ID && !!TENANT_ID
