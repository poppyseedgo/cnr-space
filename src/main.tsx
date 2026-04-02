import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App'
import { msalInstance, msalReady } from './lib/msalConfig'

const renderApp = () => {
  createRoot(document.getElementById('root')!).render(<App />)
}

msalReady
  .then(() => msalInstance.handleRedirectPromise()) // ← 이게 핵심
  .then(() => renderApp())
  .catch((err) => {
    console.error('[MSAL] 초기화 실패:', err)
    renderApp()
  })