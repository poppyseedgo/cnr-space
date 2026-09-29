/**
 * WorkboardPage.tsx — Work Space (WORKBOARD) · MS팀 업무보드
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P2] 임시 페이지 (미리보기 승인분) — 라우팅·권한 게이트 검증용.
 *      · 진입: 드로어 '팀 워크스페이스 > Work Space' / #workboard 딥링크
 *      · 권한: admin_roles 'workboard'(또는 super). 게이트는 App.tsx 가 담당하고 이 컴포넌트는 판정하지 않는다
 *      · Phase 3 에서 실제 화면(보드 · 일정 · 마일스톤 · 이슈보드 · 내 업무)으로 교체 — 파일명·view id 유지
 *
 * 데이터: 없음 (wb_ 테이블 조회는 Phase 3 부터)
 */

const FONT = "'Pretendard', -apple-system, sans-serif"

export function WorkboardPage() {
  return (
    <div style={{
      width: '100%', maxWidth: 1400, margin: '0 auto', padding: '24px 16px 60px',
      fontFamily: FONT, color: '#111',
    }}>
      <div style={{
        minHeight: 480, borderRadius: 12, background: '#F6F6F6',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        textAlign: 'center', padding: 24,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1E6FE8', background: '#EAF2FF',
          borderRadius: 999, padding: '3px 10px', letterSpacing: '0.6px' }}>
          WORKBOARD
        </span>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '0.3px' }}>Work Space</h2>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          Phase 3 화면 준비 중 — 보드 · 일정 · 마일스톤 · 이슈보드 · 내 업무
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
          이 페이지는 권한(workboard) 보유자에게만 열립니다
        </div>
      </div>
    </div>
  )
}
