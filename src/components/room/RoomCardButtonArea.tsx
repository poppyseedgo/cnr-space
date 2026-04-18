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
// 2026-04-17 (8차): 버튼 스타일 리팩토링
//   - 3개 스타일 객체(BOOK/SOON/DETAIL) 공통 속성을 BASE_BTN으로 추출
//   - spread + override 패턴으로 중복 제거 (46줄 → 15줄)
//   - 앞으로 공통 속성(fontWeight, borderRadius 등) 변경 시 BASE 한 곳만 수정
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
  btnPadding: string             // 개별 버튼 내부 padding (현재 "14px" 통일, 향후 조정 여지 위해 string으로 유지)
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

  // ── 버튼 스타일 정리 ─────────────────────────────────────────────────────
  // [2026-04-17 8차] 공통 속성은 BASE에 모으고, 각 variant는 차이점만 override
  //   - 공통: flex, fontWeight, fontSize, padding, borderRadius, border, textAlign
  //   - BOOK: 검정 배경, 흰 글자 (primary action)
  //   - SOON: 핑크 배경, 와인색 글자, not-allowed 커서 (비활성 상태)
  //   - DETAIL: 투명 배경, 회색 글자 (ghost action)
  const BASE_BTN: React.CSSProperties = {
    flex: 1,
    fontWeight: 600,
    fontSize: btnSize,
    padding: btnPadding,
    borderRadius: 12,
    border: 'none',
    textAlign: 'center',
    cursor: 'pointer',
  }
  const BOOK_BTN_STYLE:   React.CSSProperties = { ...BASE_BTN, background: '#111111', color: '#fff' }
  const SOON_BTN_STYLE:   React.CSSProperties = { ...BASE_BTN, background: '#FCE7F3', color: '#BE185D', cursor: 'not-allowed' }
  const DETAIL_BTN_STYLE: React.CSSProperties = { ...BASE_BTN, background: 'none',    color: '#64748B' }

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
