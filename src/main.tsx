import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App'
import { VisitorKiosk } from './pages/VisitorKiosk'  // ← [2026-07-10] 방문 키오스크 공개 라우트

// ── [2026-07-10] 공개 라우트 분기 (Phase 3) ──
//   /visit(및 /visit/*) 경로는 로그인 없이 익명 방문 등록 폼(VisitorKiosk)을 렌더.
//   AuthProvider / 로그인 게이트를 거치지 않는 App과 완전 분리된 트리.
//   _redirects의 `/* /index.html 200` 덕분에 /visit도 index.html이 서빙되어 여기서 분기됨.
const path = window.location.pathname.replace(/\/+$/, '')  // 끝 슬래시 제거
const isVisitorRoute = path === '/visit' || path.startsWith('/visit/')

// StrictMode 제거 — Supabase auth lock 충돌 방지
// StrictMode는 개발 환경에서 useEffect를 2번 실행해서
// Supabase의 auth token lock이 해제 안 된 채로 충돌 발생
createRoot(document.getElementById('root')!).render(
  isVisitorRoute ? <VisitorKiosk /> : <App />
)
