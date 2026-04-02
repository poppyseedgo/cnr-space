import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App'

// StrictMode 제거 — Supabase auth lock 충돌 방지
// StrictMode는 개발 환경에서 useEffect를 2번 실행해서
// Supabase의 auth token lock이 해제 안 된 채로 충돌 발생
createRoot(document.getElementById('root')!).render(
  <App />
)
