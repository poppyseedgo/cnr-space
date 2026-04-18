// ─────────────────────────────────────────────────────────────────────────────
// RoomCardButtonArea - 룸카드 하단 버튼 영역 공통 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
// [생성 이력]
// 2026-04-17: HomeView RoomCard의 버튼 영역을 별도 컴포넌트로 추출.
//   - 기존 문제: '자세히 보기' 버튼이 AVAILABLE/SOON/BUSY 분기마다 3번 반복 렌더링 →
//     스타일 변경 시 3곳 찾아 수정해야 했음
//   - 컨테이너 padding도 인라인이라 조정 시마다 D.btnBottomPadding 문자열 파싱 필요
//   - 이 컴포넌트로 추출하여 단일 변경 지점(Single Point of Change) 확보
//
// [상태별 렌더링 규칙]
// ┌───────────┬──────────────────┬──────────────────┐
// │ 상태      │ 데스크탑(≥1024)   │ 터치(<1024)       │
// ├───────────┼──────────────────┼──────────────────┤
// │ AVAILABLE │ [바로 예약][자세히] │ [바로 예약]만    │
// │ SOON      │ [N분 뒤][자세히]   │ 영역 자체 숨김   │
// │ BUSY      │ [자세히] 하나만    │ 영역 자체 숨김   │
// └───────────┴──────────────────┴──────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

interface RoomCardButtonAreaProps {
  status: {
    type: 'AVAILABLE' | 'SOON' | 'BUSY'
    minsUntil?: number
  }
  onBook: () => void             // 이미 (room, status) 바인딩된 핸들러
  onDetail: () => void           // 이미 (room) 바인딩된 핸들러
  isTouchLayout: boolean         // < 1024px
  showDetailBtn: boolean         // '자세히 보기' 버튼 노출 여부 (= !isTouchLayout)
  btnSize: number                // 버튼 폰트 크기 (13 or 14)
  btnPadding: string             // 개별 버튼 내부 padding ("10px" or "13px")
  containerPadding: string       // 버튼 영역 컨테이너 padding (예: "0.5rem" or "4px 20px 20px")
}

export function RoomCardButtonArea({
  status,
  onBook,
  onDetail,
  isTouchLayout,
  showDetailBtn,
  btnSize,
  btnPadding,
  containerPadding,
}: RoomCardButtonAreaProps) {
  const isBusy  = status.type === 'BUSY'
  const isSoon  = status.type === 'SOON'
  const isAvail = status.type === 'AVAILABLE'

  // 터치 환경에서 SOON/BUSY는 버튼 영역 전체 숨김 (카드 탭으로 상세 모달 진입)
  if (isTouchLayout && !isAvail) return null

  // 공통 스타일 상수
  const BOOK_BTN_STYLE: React.CSSProperties = {
    flex: 1,
    background: '#111111',
    color: '#fff',
    fontWeight: 600,
    borderRadius: 12,
    padding: btnPadding,
    fontSize: btnSize,
    textAlign: 'center',
    border: 'none',
    cursor: 'pointer',
  }

  const SOON_BTN_STYLE: React.CSSProperties = {
    flex: 1,
    background: '#FCE7F3',
    color: '#BE185D',
    fontWeight: 600,
    borderRadius: 12,
    padding: btnPadding,
    fontSize: btnSize,
    textAlign: 'center',
    cursor: 'not-allowed',
    border: 'none',
  }

  const DETAIL_BTN_STYLE: React.CSSProperties = {
    flex: 1,
    background: 'none',
    border: 'none',
    color: '#64748B',
    fontWeight: 600,
    fontSize: btnSize,
    padding: btnPadding,
    cursor: 'pointer',
    textAlign: 'center',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: containerPadding }}>
      {isAvail && (
        <button className="btn" onClick={e => { e.stopPropagation(); onBook() }} style={BOOK_BTN_STYLE}>
          바로 예약
        </button>
      )}
      {isSoon && (
        <button className="btn" disabled style={SOON_BTN_STYLE}>
          {status.minsUntil}분 뒤 사용
        </button>
      )}
      {showDetailBtn && (
        <button className="btn" onClick={e => { e.stopPropagation(); onDetail() }} style={DETAIL_BTN_STYLE}>
          자세히 보기
        </button>
      )}
    </div>
  )
}
