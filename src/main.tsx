import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App'
import { msalInstance, msalReady } from './lib/msalConfig'

const renderApp = () => {
  createRoot(document.getElementById('root')!).render(<App />)
}

msalReady
  .then(() => {
    // 팝업 창일 때만 handleRedirectPromise 실행
    // 메인 창에서는 호출하지 않음 (no_token_request_cache_error 방지)
    if (window.opener) {
      return msalInstance.handleRedirectPromise()
    }
    return Promise.resolve(null)
  })
  .then(() => renderApp())
  .catch((err) => {
    console.error('[MSAL] 초기화 실패:', err)
    renderApp()
  })
