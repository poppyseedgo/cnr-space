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
    // 팝업 창 — 앱 렌더링 없이 auth 처리 후 닫힘
    if (window.opener) {
      return msalInstance.handleRedirectPromise()
        .then(() => {
          // MSAL이 자동으로 닫지 않으면 강제로 닫음
          setTimeout(() => window.close(), 500)
        })
        .catch(() => {
          window.close()
        })
    }
    // 메인 창 — 앱 렌더링
    renderApp()
  })
  .catch((err) => {
    console.error('[MSAL] 초기화 실패:', err)
    if (window.opener) {
      window.close()
    } else {
      renderApp()
    }
  })
