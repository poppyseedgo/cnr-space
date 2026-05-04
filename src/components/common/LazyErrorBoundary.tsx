/**
 * LazyErrorBoundary.tsx — lazy chunk 로드 실패 시 흰 화면 방지용 안전망
 *
 * ✅ 변경 이력
 *  - [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 1)
 *      · App.tsx L220~290 클래스 컴포넌트를 그대로 이동 (로직 무수정)
 *      · 사용처는 App.tsx의 view==="mypage" / view==="admin" 라우팅 (Suspense 래핑)
 *      · 분리 이유: 단일 책임(청크 로드 실패 자동 복구)이고 App.tsx 비즈니스와 무관 → 범용 utility
 *
 * 동작:
 *  - ChunkLoadError 감지 시 자동 1회 리로드 (구버전 청크 참조 문제 자동 복구)
 *  - 무한 리로드 루프 방지: sessionStorage 플래그(__chunk_reload__) 사용
 *  - 정상 렌더 도달 시 플래그 자동 해제 (다음 배포 시 재발 대응 가능)
 *  - 기타 렌더 에러는 사용자에게 에러 UI 표시 + 새로고침 유도
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  hasReloaded: boolean
}

export class LazyErrorBoundary extends Component<{ children: ReactNode, fallback?: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode, fallback?: ReactNode }) {
    super(props)
    // 세션 스토리지로 무한 리로드 루프 방지
    const hasReloaded = typeof window !== 'undefined' &&
      window.sessionStorage.getItem('__chunk_reload__') === '1'
    this.state = { hasError: false, error: null, hasReloaded }
  }
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const msg = error?.message || ''
    const name = error?.name || ''
    const isChunkError =
      name === 'ChunkLoadError' ||
      /Loading chunk [\d]+ failed/i.test(msg) ||
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg)

    console.error('[LazyErrorBoundary]', error, info)

    // 청크 로드 실패면 자동 1회 리로드 (무한 루프 방지용 세션 플래그)
    if (isChunkError && !this.state.hasReloaded) {
      try { window.sessionStorage.setItem('__chunk_reload__', '1') } catch {}
      window.location.reload()
    }
  }
  handleManualReload = () => {
    try { window.sessionStorage.removeItem('__chunk_reload__') } catch {}
    window.location.reload()
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          minHeight:'60vh', padding:'24px', gap:'16px', textAlign:'center'
        }}>
          <div style={{ fontSize:'18px', fontWeight:600 }}>페이지를 불러오지 못했어요</div>
          <div style={{ fontSize:'14px', color:'#666' }}>
            잠시 후 다시 시도해주세요.
          </div>
          <button
            onClick={this.handleManualReload}
            style={{
              padding:'10px 20px', borderRadius:'8px', border:'none',
              background:'#111', color:'#fff', fontSize:'14px', cursor:'pointer'
            }}
          >
            새로고침
          </button>
        </div>
      )
    }
    // 정상 렌더에 도달하면 세션 플래그 해제 (다음 배포 시 재발 대응 가능)
    if (typeof window !== 'undefined' && window.sessionStorage.getItem('__chunk_reload__') === '1') {
      try { window.sessionStorage.removeItem('__chunk_reload__') } catch {}
    }
    return this.props.children
  }
}
