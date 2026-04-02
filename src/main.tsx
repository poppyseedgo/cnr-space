import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App'
import { msalReady } from './lib/msalConfig'

// MSAL 초기화 완료 후 앱 렌더링
// 팝업 창이 React 앱 로드 시 MSAL이 자동으로 auth 응답 처리 후 팝업 닫힘
msalReady.then(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})
