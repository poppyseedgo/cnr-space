/**
 * MSAL 설정 — Azure AD SSO
 * 환경변수: VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID
 */
import { PublicClientApplication, type Configuration } from '@azure/msal-browser'

const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID as string

export const msalConfig: Configuration = {
  auth: {
    clientId:             CLIENT_ID || '',
    authority:            `https://login.microsoftonline.com/${TENANT_ID || 'common'}`,
    redirectUri:          window.location.origin,  // popup 방식은 루트 URL로 충분
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
}

export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
}

// MSAL 인스턴스 — 싱글톤
export const msalInstance = new PublicClientApplication(msalConfig)

// 앱 시작 시 딱 한 번만 초기화 — Promise로 export해서 재사용
export const msalReady: Promise<void> = msalInstance.initialize()

/** Azure AD 활성화 여부 */
export const isAzureEnabled = !!CLIENT_ID && !!TENANT_ID
