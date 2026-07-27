/**
 * BookingModal.tsx — 예약 생성/수정 모달
 *
 * ✅ 변경 이력
 *  - [2026-07-27 목적 Phase 2] 회의 목적 카테고리 선택 UI (Figma 2688:1081/603, 2656:1837)
 *      · 신규 PurposeChips 컴포넌트 (데스크톱/모바일 공용, 칩 10종 단일선택 + 기타 상세입력)
 *      · form에 purpose/purposeDetail 추가 (신규=null, 수정=기존값 로드)
 *      · pickPurpose: 재클릭 해제, etc 이탈 시 상세 초기화
 *      · canSubmit에 purposeValid 게이트 추가 (목적 필수 + 기타면 상세 필수 — 확정 스펙)
 *      · 데스크톱: Field "목적" (회의 필드 위) / 모바일: Step1 "회의 목적 *" (회의 제목 위)
 *  - [2026-05-28] 반복예약 종료일 정책 + 어드민 시작일 선택 범위 확대
 *      · 반복 종료일: today+1개월 → 올해 12/31 (recurPreview maxD2) — addBooking과 동기화 필수
 *      · 시작일 선택기(maxDate): 어드민=올해 12/31(절대 권한), 비어드민=today+1개월(기존 유지)
 *      · 데스크톱 "매일" sub 라벨: "시작일~1달" → "올해 말까지" (정책 일치)
 *      · 주의: "매일" 선택 시 연말까지 최대 ~218건 생성 (생성 시간 길어질 수 있음, 에러 아님)
 *
 *  - [2026-05-28] 반복 예약 — 어드민(role==='ADMIN') 전용으로 재개방
 *      · 배경: 2026-04-22 "12월까지 생성" 버그로 전면 비활성화 → 생성 로직(App.tsx addBooking)은
 *              today+1개월 캡으로 이미 근본 수정됨(시뮬레이션 검증 완료). UI 잠금만 남아 있었음.
 *      · 정책: 비어드민은 반복예약 섹션 자체를 보지 못함(단일 예약만). 어드민만 섹션 노출+사용.
 *      · 변경점(데스크톱/모바일 각각):
 *        1) 섹션 게이트: 모바일 `{!editBooking ...}` / 데스크톱 `{false && !editBooking ...}`
 *           → 양쪽 모두 `{isAdmin && !editBooking ...}`
 *        2) 옵션 disabled 해제: `isDisabled = o.val!=="NEVER"` → `isDisabled = false`
 *        3) "기능 일시중지" 점검 배너 제거(어드민 전용 활성 기능과 모순)
 *        4) 제출부: `recur:"NEVER"` 강제 → `recur: isAdmin ? recur : "NEVER"`
 *           (UI는 비어드민에게 숨기지만, 제출부에서도 NEVER 강제 — 이중 방어)
 *      · 무변경: recur/setRecur/recurPreview/canSubmit/RecurDoneModal, addBooking 생성 로직,
 *               insertBooking(단건 insert+서버 충돌검사+exclusion constraint) 일체 그대로.
 *      · editBooking(예약 변경) 경로는 기존대로 반복 UI 미노출 — 영향 없음.
 *
 *  - [2026-04-29] 우측 패널 noTimeLeft 상태 안내 추가
 *      · 증상: 오후 7시 이후 모달 열면 우측에 시간·회의실이 그대로 표시됨
 *      · 원인: 우측 패널이 validTime만 체크 — noTimeLeft(오늘+슬롯 없음)를 무시
 *      · 해결: noTimeLeft 우선 분기 추가
 *        · 헤더: "시간을 선택하세요" (#CBD5E1 회색)
 *        · 회의실 영역: Clock 아이콘 + "선택할 수 있는 회의실이 없습니다"
 *      · 판단 로직(noTimeLeft/validTime/availableRooms) 무수정
 *
 *  - [2026-04-28 Phase G 보충 18] 시간 필드 "N분 사용" 배지 padding 변경
 *      · padding: 4 → "16px 4px" (상하 16px / 좌우 4px)
 *      · 변경 위치: L2043 (데스크톱 좌측 시간 필드 validTime 분기 내 배지)
 *      · 미변경: 배지 높이(26) / 반경(6) / 배경(#edf8ff) / 폰트 / 판단 로직 일체
 *
 *  - [2026-04-27 Phase G 보충 17] 참석자 chip X 아이콘 — 사용자 제공 SVG 교체
 *      · 사용자 명시 요청 (Figma 331:1232 참석자 chip / 331:1238 close 아이콘)
 *      · 변경 위치 2곳:
 *        1) BookingModal.tsx — 데스크톱 인라인 chip (AttendeeChip 컴포넌트 미사용 분기)
 *        2) src/components/common/AttendeeChip.tsx — 공유 컴포넌트 편집 모드 (onRemove 분기)
 *      · 영향 범위 검증:
 *        · BookingModal.tsx 인라인 칩: 데스크톱 좌측 패널만
 *        · AttendeeChip onRemove 분기 사용처: BookingModal 모바일 step1 (L928) 만
 *        · DetailModal/BookingDoneModal 은 onRemove 미전달 → if (onRemove) 미진입 → 평문 모드 → 영향 없음
 *      · 변경 내용:
 *        · BookingModal 인라인: <X size={16} strokeWidth={1.8} color="#111"/> → 사용자 SVG 인라인 (fill #1C1B1F)
 *        · AttendeeChip: <X size={10} strokeWidth={1.8} /> → 사용자 SVG 인라인 (size 10 → 16, fill #1C1B1F)
 *        · button 의 color:#CBD5E1 prop 제거 (인라인 SVG 자체 fill 사용)
 *      · 사이즈 16: Figma 331:1238 size-[16px] 정확 매칭 — 디자인 일관성 확보 위해 모바일도 동일 16 적용
 *      · 미변경:
 *        · 검증/판단 로직 / removeAttendee 핸들러
 *        · chip 외형 (배경 #edf7ff / padding / radius / avatar / 이름 폰트)
 *        · AttendeeChip 평문 모드 (DetailModal/BookingDoneModal 사용)
 *
 *  - [2026-04-27 Phase G 보충 16] 회의실 필드 — Figma 329:981(선택) 색상 / 329:1043(미선택) 글씨 정정
 *      · 사용자 명시 요청: 회의실 필드 (기본) 색상변경 + 회의실 미선택 시 글씨변경
 *      · 변경 범위: 데스크톱 좌측 패널 회의실 필드 2곳만 (1줄씩 surgical 변경)
 *      · 회의실 선택 상태 (Figma 329:981 — 색상변경):
 *        · border 색: #b9f8cf → #d3fae1 (Figma 329:988 신 border 색상)
 *        · 그 외 (배경 / padding / radius / 회의실명 / 부가정보 / close 등) 보충 12/14 그대로
 *      · 회의실 미선택 상태 (Figma 329:1043 — 글씨변경):
 *        · placeholder 텍스트: "오른쪽에서 회의실을 선택해 주세요." → "오른쪽에서 회의실을 선택하세요" (Figma 329:1050 신 문구)
 *        · 마침표 (.) 제거 / "해 " 제거 / "주" 제거 — 더 짧고 자연스러운 문구
 *        · 그 외 (border 색 / 텍스트 색 / padding / radius / fontSize / lh 등) 보충 14 그대로
 *      · 미변경:
 *        · 시간 필드 가능 상태 (Figma 337:1245 / 보충 14 그대로)
 *        · 시간 필드 미선택 (Figma 331:1223 / 보충 15 그대로)
 *        · 모바일 시간 필드 select placeholder "선택하세요" (다른 컨텍스트, L1083/1128)
 *        · 다른 #b9f8cf 사용처 (L1286 — 다른 곳 background)
 *        · 검증/판단 로직 일체
 *
 *  - [2026-04-27 Phase G 보충 15] 시간필드 미선택 시 (noTimeLeft) — Figma 331:1223 정정 환원
 *      · 사용자 보고: "시간필드 미선택시 어디갔어" — 보충 14 에서 noTimeLeft 상태를 원본(점선박스+Ban+1줄)으로 잘못 되돌림
 *      · 정정: Figma 331:1223 (시간필드 미선택 시) 가 정확한 디자인. 보충 13 의 디자인을 다시 적용
 *      · 변경 범위: 데스크톱 좌측 패널 시간 필드 noTimeLeft 분기만
 *      · Figma 331:1223 (시간필드 미선택 시):
 *        · Right area (331:1229): w 240 / h 60 / gap 10 / flex-col items-start
 *        · 텍스트 (331:1230): Pretendard Medium 16 / lh 1.5 / rgba(189,197,212,0.8) = PLACEHOLDER_COLOR
 *        · 2줄: "오늘은 더 예약할 수 없습니다" / "날짜를 변경하세요"
 *        · 점선 박스 / Ban 아이콘 / bg / radius / padding 일체 없음 (boxless)
 *      · 미변경:
 *        · 시간 필드 가능 상태 (Figma 337:1245 / 보충 14 그대로)
 *        · 회의실 미선택/선택 상태 (보충 12/14 그대로)
 *        · noTimeLeft 판단 로직 (`bookingDate === todayStr() && tOpts.length === 0` 정의 그대로)
 *        · 그 외 시간/예약 로직 일체
 *
 *  - [2026-04-27 Phase G 보충 14] 시간 필드 / 회의실 미선택 — 사용자 정정 Figma 기준 재매칭
 *      · 사용자 보고: "피그마 잘못 줬다" — 보충 13에서 사용한 Figma 331:1201/1223 가 잘못된 노드였음
 *      · 정정 Figma:
 *        · 시간 필드 가능 상태: 337:1245 (보충 13 의 331:1201 → 정정)
 *        · 회의실 미선택 상태: 329:1043 (보충 12 동일 노드, 색상값 미세 변경)
 *      · 변경 범위: 데스크톱 좌측 패널 시간 필드 + 회의실 빈 상태만 (기능/검증/판단 로직 절대 불변)
 *
 *      · 시간 필드 가능 상태 (Figma 337:1245) — 보충 13 다수 항목 정정:
 *        · 시간 row layout: justify-between → gap:24 (Figma 337:1267)
 *        · ⎯ 구분자 제거 (Figma 337:1267 에 ⎯ 없음 — 보충 13 에서 잘못 환원)
 *        · "부터"/"까지" 라벨 환원 (Figma 337:1271/1278 / color rgba(189,197,212,0.8) = PLACEHOLDER_COLOR)
 *        · 시작/종료 그룹 외곽 gap: 8 → 24 (Figma 337:1268/1275 gap-[24px])
 *        · 텍스트 wrap 추가: 시간 + "부터"/"까지" 를 inline-flex gap:4 로 묶음 (Figma 337:1269/1276)
 *        · 우측 영역 width: 240 고정 → 제거 (Figma 337:1251 에 명시적 width 없음, 콘텐츠 auto)
 *        · 외곽 column gap 14 유지 (Figma 337:1251 동일)
 *        · down arrow 사용자 제공 SVG 인라인 유지 (보충 13 동일)
 *      · 시간 필드 불가 상태 (noTimeLeft):
 *        · 신 Figma 미정의 → 보충 13 의 2줄 boxless 텍스트 → 원본 (점선 박스 + Ban + 1줄 "오늘은 더 예약할 수 없습니다") 복원
 *
 *      · 회의실 미선택 상태 (Figma 329:1043) — 색상값 미세 정정:
 *        · border 색: #dee5f1 → rgba(189,197,212,0.4) (Figma 329:1049 신 값)
 *        · placeholder text 색: #b4bcca → PLACEHOLDER_COLOR = rgba(189,197,212,0.8) (Figma 329:1050 신 값)
 *        · 그 외 (h 82 / radius 14 / dashed / padding 10 14 / bg white / 14px Medium / 텍스트 문구) 보충 12 동일 유지
 *
 *      · 미변경:
 *        · 회의실 선택 상태 (Figma 329:981 / 보충 12 그대로)
 *        · 모바일 시간 필드 (TimeRangePicker)
 *        · 시간 판단 로직 (tOpts/endOpts/validTime/noTimeLeft/isAfter7pm 정의 그대로)
 *        · select onChange 핸들러
 *        · isAfter7pm 경고 UI (Figma 미정의 안전망)
 *        · 다른 ChevronDown 사용처 (L1033/1078/1474)
 *        · "N분 사용" 배지 (Figma 337:1265 일치)
 *        · 검증/판단 로직 일체 (사용자 명시 금지)
 *
 *  - [2026-04-27 Phase G 보충 13] 시간 필드 Figma 331:1201(가능) / 331:1223(불가) 1:1 매칭 + down arrow SVG 교체
 *      · ⚠ 사용자가 Figma 노드 잘못 전달 — 보충 14 에서 정정됨
 *      · 보충 13 의 가능 상태 디자인 변경분 (justify-between / ⎯ 환원 / "부터·까지" 제거 / gap 8 / 폭 240) 모두 보충 14 에서 되돌림
 *      · 보충 13 의 불가 상태 변경분 (2줄 boxless) 보충 14 에서 원본 복원
 *      · down arrow SVG 인라인은 사용자 제공 자산이라 보충 14 에서도 유지
 *      · 변경 범위: 데스크톱 좌측 패널 시간 필드만 (기능/검증/판단 로직 절대 불변)
 *      · Figma 331:1201 (시간 가능 상태):
 *        · 외곽 column gap: 16 → 14 (Figma 331:1207)
 *        · 외곽 width: flex:1 → 240px 고정 (Figma 331:1207)
 *        · 시간 row layout: gap:24 → justify-between + w-full (Figma 331:1208)
 *        · ⎯ 구분자 환원 (Phase G에서 제거되었던 것을 새 Figma 331:1214에서 다시 명시)
 *        · "부터"/"까지" 라벨 제거 (Figma에 없음)
 *        · 시작/종료 그룹: 외곽 gap 24 → gap 8 단순화 (Figma 331:1209/1215)
 *      · Figma 331:1223 (시간 불가 상태 = noTimeLeft):
 *        · 점선 박스 + Ban 아이콘 + 1줄 → boxless 2줄 placeholder 텍스트 (Figma 331:1229/1230)
 *        · 텍스트 "오늘은 더 예약할 수 없습니다" + "날짜를 변경하세요" (Figma 331:1230 정확)
 *        · 폰트 13px 600 #94A3B8 → Pretendard Medium 16px / lh 1.5 / PLACEHOLDER_COLOR
 *        · Ban 아이콘 / 점선 박스 / bg / radius / padding 일체 제거
 *      · down arrow 아이콘 교체:
 *        · lucide-react <ChevronDown size={16} ... /> 2곳 → 사용자 제공 arrow_svg.svg 인라인 (Figma 331:1211/1217)
 *        · path fill: #1C1B1F (사용자 제공 SVG 정확 매칭)
 *      · 미변경:
 *        · 모바일 시간 필드 (TimeRangePicker)
 *        · 시간 판단 로직 (tOpts / endOpts / validTime / noTimeLeft / isAfter7pm 정의 그대로)
 *        · select onChange 핸들러 (시작 변경 시 종료 +15분 자동 보정 등)
 *        · isAfter7pm 경고 UI (Figma 미정의 케이스 — 안전망 유지)
 *        · 다른 ChevronDown 사용처 (L1007/1052 모바일, L1448 다른 드롭다운)
 *        · "N분 사용" 배지 폰트/배경/사이즈 (Figma 331:1221 일치)
 *
 *  - [2026-04-27 Phase G 보충 12] 회의실 필드 카드 Figma 329:1043(빈) / 329:981(선택) 1:1 매칭 + close 아이콘 SVG 교체
 *      · 사용자 명시 요청 (Figma 절대 기준)
 *      · 변경 범위: 데스크톱 좌측 패널 회의실 필드만 (기능/검증/판단 로직 절대 불변)
 *      · Figma 329:1043 (빈 상태):
 *        · 카드 환원: boxless span → 박스 컨테이너
 *        · 사이즈: w 358 (Field 컨텐츠 영역 100%) / h 82 / radius 14
 *        · 보더: 1px dashed #dee5f1
 *        · 배경: #ffffff
 *        · padding: 10px 14px
 *        · placeholder 텍스트: "오른쪽에서 회의실을 선택하세요" → "오른쪽에서 회의실을 선택해 주세요." (마침표·주 환원, Figma 329:1050)
 *        · placeholder 폰트: 16px → 14px / PLACEHOLDER_COLOR → #b4bcca / Pretendard Medium / lh 1.5
 *      · Figma 329:981 (선택 상태):
 *        · h 69 → 82 (Figma 329:988)
 *        · radius 10 → 14 (Figma 329:988)
 *        · 회의실명 fontSize 14 → 16 (Figma 329:990)
 *        · 그 외 (border #b9f8cf / bg rgba 0.2 / padding 10 / 부가정보 12px Regular #979fb1 / 좌-우 flex space-between) Figma 매칭 유지
 *      · close 아이콘 교체:
 *        · lucide-react <X size={20} ... /> → 사용자 제공 close_svg.svg 인라인 적용 (Figma 329:995)
 *        · path fill: #1C1B1F (사용자 제공 SVG 정확 매칭)
 *      · Field paddingBottom={32} 제거 → 기본값 16 환원 (Figma 329:981 py-[16px])
 *        · Phase G 보충 8 의 +16 추가 여백은 신 Figma에서 재정의됨
 *      · 변경 안 함:
 *        · 모바일 step2 RoomGrid2 (모바일 Figma 별도)
 *        · Field 컴포넌트 (라벨 / borderBottom 색 등)
 *        · L1990 참석자 chip 의 lucide X (회의실 close와 무관)
 *        · 검증/판단 로직 일체 (사용자 명시 금지)
 *
 *  - [2026-04-27 Phase G 보충 11] placeholder color alpha 0.6 → 0.8
 *      · 사용자 명시 요청: rgba(189, 197, 212, 0.6) → rgba(189, 197, 212, 0.8)
 *      · 효과: placeholder 톤이 약간 더 진해짐 (가독성 강화)
 *      · 변경 위치 (2곳, 단일 진실 출처 + 안전망 동기화):
 *        1) L375 PLACEHOLDER_COLOR 상수 — 인라인 사용 5곳 일괄 적용
 *           · 회의실 빈상태 / 시간 "부터"·"까지" / div 오버레이 3곳 (회의제목·참석자·메모)
 *        2) L401 IIFE 내부 .bm-boxless::placeholder CSS — 모바일 native placeholder 백업
 *      · 적용 범위: placeholder 톤 텍스트 전체 — 5+모바일 = 일괄 톤 통일
 *      · 변경 안 함 (별도 톤):
 *        · 카운터 #d1d9e7 (placeholder 아님)
 *        · 라벨 #414a5f (Phase G 보충 10)
 *        · "클릭해서 선택" rgba(150,160,179,0.5) (의도적 흐림)
 *
 *  - [2026-04-27 Phase G 보충 10] Field 라벨 color #96a0b3 → #414a5f
 *      · 사용자 명시 요청
 *      · 변경: Field 컴포넌트 라벨 color rgb(150,160,179)/#96a0b3 → #414a5f
 *      · 효과: 6개 라벨 (회의/날짜/시간/회의실/참석자/메모) 모두 더 진한 회색으로 통일
 *      · 적용 위치: L451 Field 컴포넌트 라벨 span color (단 1곳 수정으로 6개 라벨 일괄 적용)
 *      · 변경 안 함 (placeholder/서브타이틀 톤은 사용자 별도 결정사항):
 *        · 우측 헤더 서브 "개 예약 가능" #111 (Phase G에서 #96a0b3 → #111로 통일됨)
 *        · "클릭해서 선택" rgba(150,160,179,0.5) — 의도적 흐림
 *        · placeholder rgba(189,197,212,0.6) — 별도 톤
 *
 *  - [2026-04-27 Phase G 보충 9] 모달 헤더 fontSize 24 → 20
 *      · 사용자 명시 요청
 *      · 변경: 데스크톱 모달 헤더 "새 회의실 예약" / "예약 변경" — fontSize 24 → 20
 *      · 위치: L1355 (Phase A에서 absolute로 추가한 데스크톱 헤더)
 *      · 모바일 헤더(L1330, fontSize 15) 무영향
 *
 *  - [2026-04-27 Phase G 보충 8] 회의실 필드 padding-bottom 16 → 32 (Figma 308:555)
 *      · Figma 노드 308:555: pb-[32px] pt-[16px] (이전 302:5639는 py-[16px])
 *      · 변경: 회의실 Field 외곽 padding-bottom 16 → 32
 *      · 효과: 회의실 필드와 다음 필드(참석자) 사이 여백 +16px 추가
 *      · 적용 범위: 회의실 Field만 (다른 Field는 16 유지)
 *      · 구현:
 *        · Field 컴포넌트에 paddingBottom?: number prop 추가 (기본 16)
 *        · 회의실 Field에만 paddingBottom={32} 적용
 *        · 빈/선택 상태 모두 동일 적용 (Field 외곽 padding이라 자동)
 *      · placeholder color는 사용자 통일 결정에 따라 PLACEHOLDER_COLOR 유지
 *        (Figma는 #d1d7e1로 미세 변경됐으나 사용자 명시 통일 요청 우선)
 *
 *  - [2026-04-27 Phase G 보충 7] placeholder native → div 오버레이 (100% 적용 보장)
 *      · 사용자 보고 (스크린샷): IIFE CSS 강제 주입에도 placeholder 색이 여전히 진하게 표시됨
 *      · 발견된 단서: 메모 영역에 Grammarly 확장 아이콘(G) 표시
 *      · 진단:
 *        · Grammarly 같은 브라우저 확장이 input/textarea의 ::placeholder 영역을 가로챔
 *        · 또는 사용자 환경의 글로벌 CSS reset이 더 강한 specificity로 덮어씀
 *        · CSS pseudo-element는 inline style 적용 불가 → 글로벌 CSS 의존 한계
 *      · 근본 해결:
 *        · native placeholder 속성을 빈 문자열로 변경 (placeholder="")
 *        · 별도 div 오버레이로 placeholder 텍스트 표시 (position:absolute)
 *        · div의 inline color로 직접 적용 → 어떤 외부 CSS/확장도 영향 못 줌
 *        · 접근성 유지: aria-label 추가 (스크린리더 지원)
 *        · value 비어있을 때만 표시 (자연스럽게 입력 시 사라짐)
 *      · 변경 위치 (3곳):
 *        1) 회의 제목 input — placeholder="" + aria-label + div 오버레이
 *        2) 참석자 검색 input — placeholder="" + aria-label + div 오버레이
 *        3) 메모 textarea — placeholder="" + aria-label + div 오버레이
 *      · IIFE는 그대로 유지 (안전망 역할 — .bm-boxless 다른 컴포넌트 사용 가능성)
 *      · 검증/판단 로직 변경 없음 (form.title, attendeeQ, form.memo onChange 그대로)
 *      · 모바일 영역 무영향
 *
 *  - [2026-04-27 Phase G 보충 6] placeholder 색 강제 주입 + 반복예약 UI 숨김
 *      · 사용자 보고 (스크린샷):
 *        1) "회의 제목/참석자/메모 placeholder가 너무 진하다" — CSS .bm-boxless::placeholder 미적용
 *        2) "회의실 빈상태만 혼자 옅다 — placeholder와 통일" — 회의실 빈상태는 inline color로 적용됨
 *        3) "반복예약 섹션 화면에서 제거 (기능 보류)"
 *      · 진단:
 *        · inline color로 적용된 곳 (회의실 빈상태/부터/까지): PLACEHOLDER_COLOR 정확 표시 ✅
 *        · CSS .bm-boxless::placeholder로 적용 의존 (회의/참석자/메모): 적용 안 됨 ❌
 *        · 원인: index.css 변경분 미배포 + Tailwind/글로벌 CSS reset이 덮어씀
 *      · 해결:
 *        1) 모듈 scope에서 document.head에 style 태그 강제 주입 (BookingModal.tsx import 시점에 1회)
 *           · CSS 파일 배포 의존성 제거 — BookingModal.tsx 단독 변경으로 효과 보장
 *           · id 기반 중복 방지 (idempotent)
 *           · SSR 호환 (typeof document check)
 *           · 모든 글로벌 CSS보다 늦게 주입 + !important로 우선순위 강제
 *        2) 데스크톱 반복예약 영역에 false 조건 추가 (UI에서만 제거, 코드/기능 보존)
 *           · 복구 시 false → true 한 단어만 변경하면 즉시 활성화
 *      · 변경 위치:
 *        · 파일 상단 (import 다음): forceBmBoxlessPlaceholderStyle() 모듈 scope 호출
 *        · L2011 데스크톱 반복예약: SHOW_RECUR_UI 조건 추가 (false)
 *      · 검증/판단 로직 변경 없음 (recur, setRecur, recurPreview 등 그대로)
 *      · 모바일 영역 무영향 (모바일 step1의 반복예약은 별도 — 변경 없음)
 *
 *  - [2026-04-27 Phase G 보충 5] FONT COLOR 정밀 대조 — 1곳 수정
 *      · 사용자 명시 요청: Figma 노드 302:5364 기준 모든 FONT COLOR 정확 매칭
 *      · 정밀 대조 결과:
 *        ✅ 매칭됨 (변경 불필요): 라벨/placeholder/카운터/날짜/시간(좌측)/회의실 박스/우측 헤더/카드 그리드/푸터/헤더/칩
 *        ❌ 차이 발견 — 1곳: 참석자 검색 input 입력값
 *           · Figma 299:3765: text-black (= #000)
 *           · 현재 코드: #111
 *           · 변경: input style color "#111" → "#000"
 *      · 변경 안 함 (사용자 결정):
 *        · 시간 "부터"/"까지" — PLACEHOLDER_COLOR 통일 (Phase G 보충 사용자 명시)
 *      · 변경 안 함 (피그마 명시 없음 — 보수적 결정):
 *        · 회의 input value, 메모 textarea value 입력값 색 (피그마 placeholder만 명시)
 *      · 영향: 참석자 검색 시 입력 텍스트 색이 약간 더 진한 검정으로 표시
 *      · 검증/판단 로직 변경 없음 (attendeeQ value/onChange 그대로)
 *
 *  - [2026-04-27 Phase G 보충 4] 참석자 검색 인풋 border-radius 0 강제
 *      · 사용자 시각 확인: border-bottom이 양 끝에서 곡선으로 휘어 올라감
 *      · 원인: input element에 글로벌/브라우저 기본 border-radius 적용 → border-bottom 휘어 보임
 *      · 코드 점검: inline style에 borderRadius 명시 안 됨 (불특정 외부 CSS가 영향)
 *      · 해결: inline style에 borderRadius: 0 명시 (브라우저/글로벌 어떤 값이든 강제 덮어씀)
 *      · 적용 범위: 참석자 검색 input 1곳만 (다른 input/textarea는 boxless가 아니거나 영향 없음)
 *
 *  - [2026-04-27 Phase G 보충 3] placeholder 5개 문구 색 통일 강화 (CSS specificity 보강)
 *      · 사용자 명시 요청: rgba(189, 197, 212, 0.6) = #BDC5D4 + alpha 0.6 통일
 *      · 대상 5개 문구:
 *        1. 회의 제목 placeholder "회의 제목을 입력하세요"
 *        2. 시간 보조 텍스트 "부터", "까지"
 *        3. 회의실 빈 상태 "오른쪽에서 회의실을 선택하세요"
 *        4. 참석자 placeholder "팀즈에 등록된 이름으로 검색하세요"
 *        5. 메모 placeholder "회의상세"
 *      · 점검 결과: BookingModal.tsx 본 코드는 모두 표준값 적용됨 (변경 없음)
 *        · 1, 4, 5: input/textarea의 className="bm-boxless" + CSS .bm-boxless::placeholder
 *        · 2, 3: inline color: PLACEHOLDER_COLOR
 *      · 변경 위치: src/index.css (Phase C에서 추가한 .bm-boxless::placeholder 강화)
 *        · selector specificity 0,1,1 → 0,2,1 (input.bm-boxless / textarea.bm-boxless 추가)
 *        · 모든 속성에 !important 추가 (글로벌 CSS 덮어쓰기 방지)
 *        · font-size 명시 추가 (16px) — 글로벌 input 폰트가 덮어쓰는 케이스 방어
 *      · ⚠️ 배포 시 src/index.css 반드시 함께 배포 필요 (BookingModal.tsx 단독 배포는 효과 없음)
 *      · 사용자 환경에서 시각 차이 보이는 원인 추정:
 *        1. Phase C 추가한 index.css가 미배포 상태 (가장 가능성 높음)
 *        2. 브라우저 CSS 캐시 (Ctrl+Shift+R 강제 새로고침 필요)
 *        3. 다른 글로벌 input/textarea placeholder CSS 충돌 → !important로 해결
 *
 *  - [2026-04-27 Phase G 보충 2] 참석자 필드 스타일 정확 매칭
 *      · Figma 노드: 308:322 (기본) / 308:340 (입력 중) / 308:331 (칩)
 *      · 변경 내용:
 *        1) 검색 인풋 밑줄 토글 — 핵심 변경
 *           · 이전: 항상 borderBottom 1px solid #000 (빈 상태에서도 표시)
 *           · 새 디자인: 기본(308:329)은 밑줄 없음 / 입력 중(308:346)은 검정 밑줄
 *           · 적용: focused 또는 attendeeQ 길이 > 0일 때만 밑줄 표시 (transparent로 토글)
 *           · 사유: focus 즉시 시각 피드백 + blur 후에도 입력값 있으면 유지 (자연 UX)
 *        2) Field 라벨 line-height — required 여부에 따라 분기
 *           · required true (회의/날짜/시간/회의실): 1.2 (현재 그대로)
 *           · required false (참석자/메모): 1.5 (Figma 308:326, 302:5477)
 *           · 디자이너 의도: optional 라벨은 더 자연스러운 leading
 *      · 검증/판단 로직 변경 없음 (attendeeFocus, attendeeQ, addAttendee, removeAttendee 그대로)
 *      · 칩 구조: 시각 동일 (Phase E inline chip 그대로 유지)
 *
 *  - [2026-04-27 Phase G 보충] placeholder color 통일 (#BDC5D4, opacity 60%)
 *      · 사용자 명시 요청: "placeholder color : #BDC5D4 , opacity:60% 통일"
 *      · 표준값: rgba(189, 197, 212, 0.6) = #BDC5D4 + alpha 0.6
 *      · 변경 내용:
 *        1) 모듈 상수 PLACEHOLDER_COLOR 정의 (근본 해결 — 단일 진실 출처)
 *        2) 시간 필드 "부터"/"까지" 색 #d2d2d2 → PLACEHOLDER_COLOR (2곳)
 *        3) 회의실 빈 상태 텍스트 인라인 색 → PLACEHOLDER_COLOR (1곳, 기존 표준값과 동일)
 *        4) src/index.css .bm-boxless::placeholder는 이미 표준값 — 변경 없음
 *      · 적용 안 함:
 *        · 카운터 ("0/40", "0/100") 색 #d1d9e7 — placeholder 아님 (그대로)
 *        · 인풋의 실제 입력 텍스트 색 — 검정 #111 그대로
 *
 *  - [2026-04-26 Phase G] 피그마 새 버전 매칭 — 정렬/간격/텍스트 정확 매칭
 *      · Figma 노드: 302:5364 (업데이트된 상세 버전)
 *      · 변경 범위: 데스크톱만 (모바일 무영향)
 *      · 변경 내용:
 *        1) Field 컴포넌트 — 라벨 영역 정렬 변경
 *           · 라벨 영역 alignItems: center → flex-start (위쪽 정렬)
 *           · 라벨 영역 justifyContent: flex-end → 제거 (좌측 정렬, 자연 spacing 확보)
 *           · 외곽 wrapper gap: 12 → 0 (Phase F 보충 되돌림 — 라벨 좌측 정렬로 자연 spacing)
 *           · height prop 추가 (메모 Field 120px 고정용)
 *        2) 시간 필드 — "부터" / "까지" 텍스트 추가, 구분자 ⎯ 제거
 *           · 시작 그룹: "오전 12:15 (gap 4) 부터 (gap 24) ▼"
 *           · 종료 그룹: "오후 1:00 (gap 4) 까지 (gap 24) ▼"
 *           · 시작↔종료 사이 gap: 24
 *           · 시간 행↔"N분 사용" 배지 사이 gap: 10 → 16
 *           · "부터"/"까지": Pretendard Medium 16px, color #d2d2d2 (옅은 회색)
 *        3) 회의실 빈 상태 — 점선 박스 제거 (boxless로 단순화)
 *           · 점선 border, padding 14/16, height 69 모두 제거
 *           · 단순 텍스트 "오른쪽에서 회의실을 선택하세요" (마침표/주 제거)
 *           · Pretendard Medium 16px, color rgba(189,197,212,0.6) — 다른 placeholder와 통일
 *        4) 메모 Field — 외곽 height 120px 고정 (Field height prop 활용)
 *        5) 우측 헤더 서브 — 12px → 14px, 색상 통일
 *           · "6" + "개 예약 가능" 둘 다 #111 검정 (이전: "개 예약 가능"만 #96a0b3)
 *           · "클릭해서 선택"은 그대로 rgba(150,160,179,0.5)
 *        6) 참석자 placeholder 텍스트 정정
 *           · "팀즈에 등록된 이름으로 검색" → "팀즈에 등록된 이름으로 검색하세요" (Figma 매칭)
 *      · 검증/판단 로직 변경 없음 (form.start/end onChange, set, validTime, durMin 그대로)
 *      · 모바일 시간 필드(TimeRangePicker)는 그대로 유지
 *
 *  - [2026-04-26 Phase F 보충] Field 라벨↔컨텐츠 spacing 추가 (한국어 가독성)
 *      · 자체 판단 수정 (사용자 시각 검증 후 발견된 명백한 문제)
 *      · 증상: 모든 6개 Field에서 라벨과 컨텐츠가 한 단어처럼 보임
 *              · "회의•회의 제목을 입력하세요"
 *              · "날짜•2026년 4월 26일 일요일"
 *              · "참석자팀즈에 등록된 이름으로 검색"
 *              · "메모회의상세"
 *      · 원인: Figma 코드 라벨 영역(72px) + 컨텐츠 0px 간격
 *              영문은 빨간 점(•)이 자연 spacing 역할을 하지만,
 *              한국어 자모는 폰트 metric상 더 조밀해 한 단어처럼 보임
 *      · 해결: Field wrapper에 gap: 12px 추가 (단 1줄, 모든 Field 일괄 개선)
 *      · 영향: 6개 Field (회의/날짜/시간/회의실/참석자/메모) 모두 시각 개선
 *      · 트레이드오프: Figma 0px와 미세 차이 vs 한국어 실 사용 가독성 — 후자 우선
 *
 *  - [2026-04-26 Phase F] 우측 패널 — 시간 헤더 + 회의실 그리드 카드 Figma 매칭
 *      · Figma 노드: 302:5508-5615 (우측 패널 전체)
 *      · 변경 범위: 데스크톱 우측 패널만 (모바일 RoomGrid2 그대로 유지)
 *      · 변경 내용:
 *        1) 우측 패널 컨테이너: padding 24/28 → 16, gap 16 → 24 (Figma)
 *        2) 우측 헤더 시간: 17px/600 → 18px SemiBold / line-height 1.5
 *           · "오전 12:15 ⎯ 오후 1:00 이용 가능 회의실" → "오전 12:15 ⎯ 오후 1:00" (간결)
 *           · 구분자 "-" → "⎯" (Figma)
 *        3) 우측 헤더 서브: 13px/#94A3B8 → 12px / "6 + 개 예약 가능 + 클릭해서 선택"
 *           · "6": SemiBold #111 / "개 예약 가능": Regular #96a0b3 / "클릭해서 선택": Regular rgba(150,160,179,0.5)
 *        4) 새 함수 RoomGridDesktop 작성 — 데스크톱 우측 전용 (모바일 RoomGrid2 무영향)
 *           · 그리드: padding 24px 0 추가, gap 10, bg white
 *           · 카드 공통: h:100, p:10, radius:16, flex-col justify-between (회의실명 위 / 배지 아래)
 *           · 가용 카드: bg #fff, border 1px #dee5f1
 *           · 선택 카드: bg #000, border 1px #000, 흰 글씨
 *           · 예약됨/곧사용 카드: bg #fef2f2, border transparent, text #ff8b8b
 *           · 회의실명: 14px Medium, line-height: 1
 *           · 부가정보: 10px Medium #6a7282 / #ff8b8b, gap 2 with "•" bullet
 *           · 배지: padding 4/8, radius 24, gap 2
 *             · 선택됨: bg #b9f8cf + Check 16 + 텍스트
 *             · 예약가능: bg #d5f0ff
 *             · HR 승인 필요: bg #e6ffb0 (라임)
 *             · 예약됨/곧 사용: bg #ffdbdb, text #dc1a1a (곧 사용은 SemiBold)
 *           · "곧 시작" → "곧 사용" 표시 변환 (getRoomUnavailStatus의 label은 그대로 두고 표시 시점 변환)
 *           · "승인 필요" / "승인 후 확정" → "HR 승인 필요" 통일 (Figma 매칭)
 *           · 배치: 회의실명 위쪽, 배지 아래쪽 (현재 코드 반전됨 → 정정)
 *      · 검증/판단 로직 변경 없음 (availableRooms, unavailableRooms, getRoomUnavailStatus, set("room_id") 그대로)
 *      · 모바일 step2 회의실 그리드: 기존 RoomGrid2 그대로 — Figma 모바일 디자인 받은 후 별도 처리
 *
 *  - [2026-04-26 Phase E 보충] 메모 maxLength=100 적용 (사용자 명시 승인)
 *      · 사용자 요청: "100자까지 입력 가능, 엔터(줄바꿈) 사용 가능"
 *      · 변경: textarea에 maxLength={100} 추가
 *      · 엔터(줄바꿈)은 textarea native 동작이라 별도 처리 불필요 — 그대로 작동
 *      · 기존 100자 초과 데이터 보호: textarea value는 기존 값 그대로 로드,
 *        새 입력만 100자까지 제한 (브라우저 native 동작), 저장 시 그대로 저장
 *      · 카운터 빨간색 로직 (length > 100 ? red : default) 그대로 유지
 *        → 기존 100자 초과 데이터 시각 경고용 (예: "120/100" 빨강)
 *
 *  - [2026-04-26 Phase E] 좌측 5/6 — 참석자 + 메모 변환 + 좌측 패널 gap 정리
 *      · Figma 노드: 빈 상태 302:5629-5482 / 채워진 상태 299:3719-3816
 *      · 변경 범위: 데스크톱 좌측 참석자/메모 + 좌측 패널 gap (모바일 변경 없음)
 *      · 변경 내용:
 *        1) 참석자 필드 → Field 적용 (required X — 빨간 점 없음, 선택 입력)
 *           · 참석자 chip: AttendeeChip 컴포넌트 사용 안 함 (DetailModal/BookingDoneModal와 공유 → 부작용 방지)
 *             · BookingModal 내 inline chip — bg #edf7ff, padding 2/4/2/2, gap 7, radius 1000
 *             · 아바타 24 (UserAvatar 그대로) + 이름 14 Medium + X 16 (lucide-react X)
 *             · removeAttendee 로직 그대로
 *           · 검색 인풋: 박스형 → border-bottom 1px #000, height 36, padding-bottom 12, boxless
 *           · 드롭다운: bg white, border 0.5px #dee5f1, radius 14, padding 10, gap 10
 *             · 각 항목: padding 4/10/4/2, radius 8, justify-between
 *             · 좌: 아바타 32 + 이름 14/Medium + 이메일 10/Regular #99a1af
 *             · 우: "+ 추가" 10/Regular #7088ac
 *           · "검색 중..." / "검색 결과가 없습니다" 메시지: 드롭다운과 동일 스타일
 *        2) 메모 필드 → Field 적용 (required X — 선택 입력)
 *           · textarea 박스 제거, boxless
 *           · placeholder "안건, 준비물 등" → "회의상세" (Figma 매칭)
 *           · 우측 카운터 0/100 추가 (10px Medium #d1d9e7, 100자 초과 시 #EF4444)
 *           · ⚠️ maxLength=100은 본 Phase에서 미적용 → [Phase E 보충]에서 사용자 승인 후 적용됨
 *           · min-height 72px
 *        3) 좌측 패널 gap: 18 → 0
 *           · Field 자체 padding 16 0 + border-bottom이 간격/구분선 담당
 *           · 인접 Field 사이 간격: padding-bottom 16 + padding-top 16 = 32px (Figma 매칭)
 *           · 반복 예약(Field 아님)은 메모 Field padding-bottom 16 다음 자연 시작
 *      · 검증/판단 로직 변경 없음 (form.attendees, attendeeQ, addAttendee, removeAttendee, attendeeSuggestions 그대로)
 *
 *  - [2026-04-26 Phase D] 좌측 4 — 회의실 박스 (빈 상태 / 선택 상태) Figma 매칭
 *      · Figma 노드: 빈 상태 302:5639-5647 / 선택 상태 299:3948-3955
 *      · 변경 범위: 데스크톱 좌측 패널 회의실 필드만 (모바일/우측/다른 필드 불변)
 *      · 변경 내용:
 *        1) Field 적용 (라벨 "선택된 회의실" → "회의실" + 빨간 점)
 *        2) 빈 상태: 점선 박스
 *           · border 1.5px dashed #E2E8F0 → 1px dashed rgba(189,197,212,0.5)
 *           · padding 18 → 14px 16px, height 자동 → 69px
 *           · text-align center → flex-col items-start (좌측 정렬)
 *           · 텍스트 "오른쪽에서 회의실을 선택해주세요" → 마침표 추가, Pretendard Regular 12px / #bdc5d4
 *        3) 선택 상태: 연두 박스
 *           · background #b9f8cf42 → rgba(185,248,207,0.2)
 *           · border 1.5px solid #86EFAC → 1px solid #b9f8cf
 *           · padding 14/16 → 10, alignItems center → flex-start, height 69px
 *           · 회의실명: 15px/600 → 14px/Medium, line-height none
 *           · 부가정보: 12px/#64748B → 12px Regular #979fb1, "•" bullet 명시
 *           · 변경 버튼(pill) → X 아이콘 20px (lucide-react X import 추가, set("room_id",null) 그대로)
 *      · 검증/판단 로직 변경 없음 (selectedRoom, selectedFloor, set("room_id") 그대로)
 *
 *  - [2026-04-26 Phase C] 좌측 1/2/3 — 회의 제목 / 날짜 / 시간 (boxless 변환)
 *      · Figma 노드: 302:5364 / 299:3607
 *      · 변경 범위: 데스크톱 좌측 패널 첫 3개 필드만 (모바일/우측/회의실/참석자/메모 불변)
 *      · 변경 내용:
 *        1) 회의 제목: Field 적용, input 박스 제거(boxless), 우측 카운터 0/40 인라인
 *        2) 날짜: Field 적용, 버튼 → 텍스트("YYYY년 M월 D일 X요일") + 클릭 시 캘린더 popover
 *           · fmtDateFull util import 추가
 *           · Calendar/ChevronUp/ChevronDown trigger 아이콘 제거
 *           · 캘린더 popover 자체는 그대로 (월 이동, 날짜 셀 로직 변경 없음)
 *        3) 시간: Field 적용, select 두 개 → 텍스트 "오전 12:15 ▼ ⎯ 오후 1:00 ▼"
 *           · native select를 absolute(opacity:0)로 텍스트 위에 띄움 (네이티브 dropdown UX 유지)
 *           · 동적 "N분 사용" 배지 추가 (height 26, radius 6, bg #edf8ff)
 *           · noTimeLeft / isAfter7pm 안내는 기존 디자인 유지 (피그마에 없음)
 *      · CSS: src/index.css에 .bm-boxless::placeholder 클래스 추가
 *      · 검증/판단 로직 변경 없음 (canSubmit, availableRooms, validTime, durMin 그대로)
 *      · 좌측 패널 gap:18 그대로 유지 (Phase E에서 모든 필드 변환 후 0으로)
 *
 *  - [2026-04-26 Phase B] 좌측 패널 골조 + 인라인 라벨 공통 wrapper (Field) 정의
 *      · Figma 노드: 302:5364 (빈 상태) / 299:3607 (채워진 상태)
 *      · 변경 범위: 데스크톱 좌측 패널만 (모바일/우측 패널 변경 없음)
 *      · 변경 내용:
 *        1) 좌측 패널 외곽 padding: "24px 28px" → "16px 16px 100px 16px" (Figma)
 *        2) 좌측 패널 borderRight 색 #F1F5F9 → #f1f5f9 (Figma 매칭, 동일 값)
 *        3) 모듈 scope에 Field 컴포넌트 정의 — 라벨 72px(우측정렬) + 빨간점(필수) + 컨텐츠
 *           · 정의만 하고 실제 사용은 Phase C부터 (필드 변환 시작)
 *           · React unmount/remount 깜빡임 방지 위해 module scope에 정의
 *      · 검증/판단 로직 변경 없음
 *      · 시각적 변화: 좌측 패널 padding 변경에 따른 위치 미세 조정만 발생
 *
 *  - [2026-04-26 Phase A] 데스크톱 모달 골격 — Figma 매칭 (UI 리디자인 1단계)
 *      · Figma 노드: 302:5364 (빈 상태) / 299:3607 (채워진 상태)
 *      · 변경 범위: 데스크톱만 (모바일 분기 일체 변경 없음)
 *      · 변경 내용:
 *        1) 모달 컨테이너: maxWidth 960→924, borderRadius 16→24
 *        2) 로딩 오버레이 borderRadius 16→24 (모달과 동기화)
 *        3) 헤더: 데스크톱에서 position absolute(top:0), padding 16/20,
 *           borderRadius 24px 24px 0 0, drop-shadow 효과, border-bottom 제거
 *        4) 데스크톱 헤더 타이틀: fontSize 18→24, fontWeight 600→500 (Pretendard Medium)
 *        5) 데스크톱 본체 컨테이너: padding 60px 0 (헤더/푸터 absolute 영역 확보)
 *        6) 데스크톱 푸터: position absolute(bottom:0), padding 8, gap 8,
 *           borderRadius 0 0 24px 24px, 배경 #f5f5f5 over #fff,
 *           Button height 56, borderRadius 16
 *      · 검증/판단 로직 변경 없음 (canSubmit, availableRooms, validTime 등 그대로)
 *      · CTA 텍스트 로직 그대로 (변경 저장 / 승인 요청 / 예약 확정)
 *
 *  - [2026-04-26] 기본 회의 시간 60분 → 15분 변경 (UX 개선)
 *      · 사용자 요청: 모달 오픈 시 미리 입력되어있는 시간 예약값을 1시간 → 15분으로 변경
 *                    (예: 현재 14:08 → 시작 14:15 → 종료 14:30)
 *      · 적용 범위 (B안: UX 일관성 확보 — 5곳 모두 동기화):
 *        1) L87  — 모달 오픈 시 초기 form 생성 (신규 예약 진입점)
 *        2) L247 — tick 자동 시간 보정 (탭 오래 켜둔 후 form.start가 과거로 밀려날 때)
 *        3) L312 — selectDate (캘린더에서 "오늘"로 다시 선택 시 재계산)
 *        4) L422 — handleTimeBtn (모바일 시간 그리드에서 시작 클릭 시 자동 종료)
 *        5) L1071 — 데스크톱 select 시작 변경 시 자동 종료
 *      · 변경 사유: 어떤 경로로 진입하든 동일한 기본값(15분) 보장.
 *                  ①만 변경하면 날짜·시간 재선택 시 60분으로 되돌아가는 UX 비일관 발생.
 *      · 19:00 한계는 그대로 유지 (Math.min(..., 19*60))
 *      · 검증/판단 로직(canSubmit, availableRooms, validTime 등)은 일체 변경 없음
 *
 *  - [2026-04-22 HOTFIX] 반복예약 기능 임시 비활성화 (Phase 1 긴급 차단)
 *      · 증상: 반복예약이 "시작일~1달" 안내와 달리 DB에 12월 말까지 생성됨
 *              → 일반 사용자 정책 위반(30일 제한)
 *              → 오늘 하루 동안 288건 오염 데이터 누적 → SQL DELETE로 정리 완료
 *      · 조치 (버튼 근본 수정 전 임시 차단, 3중 방어):
 *        1) 모바일/데스크톱 모두 "매일"/"매주" 옵션 disabled + opacity 0.25 처리
 *        2) 상단에 "반복 예약은 오남용으로 사용을 일시중지합니다. 정책확정 전까지,
 *           단일 예약만 가능합니다." 경고 배너 표시
 *        3) handleSubmit onClick 핸들러에서 recur를 강제로 "NEVER"로 세팅
 *           (DevTools 조작 등 우회 시도 대응)
 *      · 복구: 반복예약 생성 로직(allDates 계산 + maxDate 적용)을 근본 수정 후 해제
 *      · 참고: 이 수정은 UI 차단만 담당. DB 저장 로직(onSubmit)의 버그는 별도 세션에서 수정.
 *
 *  - [2026-04-19 P1] 과거 날짜 방어 로직 추가 (App.tsx 전역 보정 제거에 따른 이동)
 *      · 배경: App.tsx 10초 tick에서 selectedDate를 강제로 today로 갱신하던 로직이
 *              캘린더 과거 날짜 탐색을 막아버리는 버그를 일으켜 제거됨.
 *              그러나 원래 방어하고자 했던 "탭 밤새 유지 후 예약" 시나리오는 여전히 유효.
 *      · 해결: 예약 생성 플로우에 한정하여 여기서만 방어
 *              · initDate가 과거면 today로 보정 (새 예약 한정)
 *              · editBooking은 그 예약의 실제 날짜 그대로 유지 (과거 예약 수정 가능해야 함)
 *              · 달력 초기 월/연도도 보정된 날짜 기준으로 계산
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, AlertTriangle, Ban, Calendar, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, X } from 'lucide-react'
import { useBreakpoint, useVisualViewport } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  fmtDateFull, // ← [Phase C] 날짜 풀 표기 ("2026년 5월 1일")
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
// [2026-04-17 Step 3] searchGraphUsers import 제거 — 참석자 검색을 DB 호출에서 메모리 필터링(usersProp 기반)으로 전환
// import { searchGraphUsers } from '../../lib/api'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'
// ← [2026-07-27 목적] 목적 카테고리 SSOT — 코드/라벨 10종, 기타 상세 40자
import { BOOKING_PURPOSES, PURPOSE_DETAIL_MAX, isEtcPurpose } from '../../data/bookingPurpose'
import type { BookingPurposeCode } from '../../data/bookingPurpose'

import { UserAvatar } from '../common/UserAvatar'
import { AttendeeChip } from '../common/AttendeeChip'
import { Button } from '../common/Button' 
import { ModalCloseButton } from '../common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화

// ─── [Phase G 보충 2026-04-27] placeholder 색 단일 상수 ───────────────────────
//   사용자 요청: placeholder color #BDC5D4
//   - [Phase G 보충 11 2026-04-27] alpha 0.6 → 0.8 (가독성 강화)
//   사용처: 시간 "부터/까지", 회의실 빈 상태, div 오버레이 placeholder 3곳 (회의제목/참석자/메모)
const PLACEHOLDER_COLOR = "rgba(189, 197, 212, 0.8)";

// ─── [Phase G 보충 6 2026-04-27] .bm-boxless::placeholder 강제 주입 ──────────
//   문제: index.css의 .bm-boxless::placeholder가 일부 환경에서 적용 안 됨
//         (CSS 미배포 / Tailwind reset 덮어씀 / 글로벌 input CSS 충돌 등)
//   해결: 모듈 import 시점에 document.head에 <style> 태그 강제 주입 (1회)
//         · CSS 파일 배포 의존성 제거 — BookingModal.tsx 단독으로 효과 보장
//         · id 기반 중복 방지 (idempotent — 모듈 다중 import 안전)
//         · SSR 호환 (typeof document check)
//         · 모든 글로벌 CSS보다 늦게 주입 + !important 강제 우선순위
(function injectBmBoxlessPlaceholderStyle() {
  if (typeof document === "undefined") return; // SSR 가드
  const STYLE_ID = "bm-boxless-placeholder-force-style";
  if (document.getElementById(STYLE_ID)) return; // 중복 방지
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .bm-boxless::placeholder,
    .bm-boxless::-webkit-input-placeholder,
    .bm-boxless::-moz-placeholder,
    input.bm-boxless::placeholder,
    input.bm-boxless::-webkit-input-placeholder,
    input.bm-boxless::-moz-placeholder,
    textarea.bm-boxless::placeholder,
    textarea.bm-boxless::-webkit-input-placeholder,
    textarea.bm-boxless::-moz-placeholder {
      color: rgba(189, 197, 212, 0.8) !important;
      font-family: "Pretendard", sans-serif !important;
      font-weight: 500 !important;
      font-size: 16px !important;
      opacity: 1 !important;
    }
  `;
  document.head.appendChild(style);
})();

// ─── [Phase B 2026-04-26] 좌측 패널 인라인 라벨 공통 wrapper ──────────────────────
//   Figma 노드: 302:5364 / 299:3607 / [Phase G 업데이트] 302:5366~
//   구조: 라벨 영역(72px, 좌측정렬) + 빨간 점(required) + 컨텐츠 영역(flex:1) + border-bottom
//   - module scope에 정의 (React unmount/remount 깜빡임 방지)
//   - 라벨: Pretendard Medium 16px / line-height 1.2 / color #96a0b3
//   - 빨간 점: 4×4px round, #ef4444 (필수 필드만 — 회의/날짜/시간/회의실)
//   - border-bottom: 1px solid #f6faff (필드 구분선)
//   - padding: 16px 0
//   - alignItems: flex-start (라벨/컨텐츠 위쪽 정렬)
//   - [Phase G] 라벨 영역 좌측 정렬 (피그마 새 버전): justify-end 제거, items-start
//             외곽 wrapper gap 제거 (Phase F 보충 되돌림 — 라벨 좌측 정렬로 자연 spacing 확보)
//   - [Phase G] height prop 추가 (메모 Field 120px 고정용)
//   - [Phase G 보충 8 2026-04-27] paddingBottom prop 추가 (회의실 Field 32px 용)
function Field({
  label,
  required = false,
  children,
  height,
  paddingBottom = 16, // ← [Phase G 보충 8] 기본 16px, 회의실 Field만 32 (Figma 308:555)
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  height?: number;
  paddingBottom?: number;
}) {
  return (
    <div style={{
      borderBottom: "1px solid #f6faff",
      padding: `16px 0 ${paddingBottom}px 0`, // ← [Phase G 보충 8] padding-bottom 동적
      display: "flex",
      alignItems: "flex-start",
      width: "100%",
      // ← [Phase G 2026-04-26] gap:12 제거 (Phase F 보충 되돌림) — 라벨 영역 좌측 정렬로 자연 spacing
      ...(height ? { height, boxSizing: "border-box" as const } : {}),
    }}>
      {/* 라벨 영역 (72px, 좌측 정렬 + 위쪽 정렬, gap 2px) */}
      {/* ← [Phase G] alignItems: center → flex-start, justifyContent: flex-end 제거 */}
      <div style={{
        width: 72,
        flexShrink: 0,
        display: "flex",
        alignItems: "flex-start",
        gap: 2,
      }}>
        <span style={{
          fontFamily: "Pretendard, sans-serif",
          fontWeight: 500,
          fontSize: 16,
          lineHeight: required ? 1.2 : 1.5, // ← [Phase G 보충 2] required는 1.2, optional은 1.5 (Figma 308:326, 302:5477)
          color: "#414a5f", // ← [Phase G 보충 10 2026-04-27] #96a0b3 → #414a5f (사용자 명시 요청)
          whiteSpace: "nowrap",
        }}>{label}</span>
        {required && (
          <span style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#ef4444",
            flexShrink: 0,
            display: "inline-block",
          }} aria-hidden="true"/>
        )}
      </div>
      {/* 컨텐츠 영역 */}
      <div style={{flex: 1, minWidth: 0}}>
        {children}
      </div>
    </div>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

// ─── [2026-07-27 목적] 목적 카테고리 선택 UI (데스크톱/모바일 공용) ──────────────
//   · Figma 2688:1081(default) / 2688:603(선택시) / 2656:1837(기타선택시) 실측 반영
//   · 칩 기본:   border 1px #EBEEF4 / 텍스트 13px Medium #96A0B3 / padding 4px 14px / r16
//   · 칩 선택:   bg #CAEFFF / 체크 20px + gap 2 / padding 좌 8px / 텍스트 #000
//     (border는 transparent 유지 — 없애면 선택 시 칩 높이 2px 변해 줄바꿈이 흔들림)
//   · 헬퍼:      미선택시에만 "회의 목적을 선택하세요" 12px SemiBold #D1D7E1 (Figma 2688:1311)
//   · 기타 입력: variant별 분기 — 데스크톱은 검정 언더라인 boxless(Figma 2688:595),
//                모바일은 기존 모바일 입력 박스 스타일(회의 제목 필드와 통일)
// ← [2026-07-27 iOS 입력 HOTFIX] Enter = 입력 완료(키보드 닫기) 공용 핸들러.
//   ⚠ 한글 IME 조합 중 Enter(isComposing)는 조합 확정이므로 무시 — 가드 없이 blur하면 한글 입력이 끊긴다.
//   참석자 검색(Enter=선택)·메모(Enter=줄바꿈)에는 적용하지 않는다.
function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter' || (e.nativeEvent as KeyboardEvent).isComposing) return
  e.currentTarget.blur()
}

// ← [2026-07-27 제목 자동줄바꿈] 제목 textarea 자동 높이 — 폭을 넘으면 시각적(soft-wrap)으로만 줄바꿈.
//   height를 auto로 리셋 후 scrollHeight로 재설정 — 입력/삭제 양방향 모두 따라간다.
function autoGrowTitle(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// ← [2026-07-27 제목 자동줄바꿈] 제목은 단일 문자열(카드·목록·이메일 한 줄 전제) — Enter는 개행 삽입 대신
//   입력 완료(blur). 한글 IME 조합 중 Enter 가드는 blurOnEnter와 동일 이유로 필수.
function titleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== 'Enter' || (e.nativeEvent as KeyboardEvent).isComposing) return
  e.preventDefault()          // 개행 삽입 차단
  e.currentTarget.blur()      // = 입력 완료 (모바일 키보드 닫힘)
}

// ─── [2026-07-27 모바일 예약모달 v2] Figma 2697:251 / 2710:1250 / 2715:1952 실측 기반 신규 UI ───
//   적용 범위: 모바일 한정 (데스크톱 불변 — 고지 확정 ④)

// 순서안내 (Figma 2703:811 활성/대기, 2715:2104 완료) — 헤더 아래 바디 첫 요소
//   넘버링 32×32 r12: 완료 bg #00DE59+흰 체크24 / 활성 bg #000+흰 숫자14 / 대기 bg #D1D7E1+흰 숫자
//   라벨 16px Medium: 완료 #00DE59 / 활성 #111 / 대기 #D1D7E1. 요소 gap 24, 라벨 gap 12, 연결선 1px
function StepIndicatorM({ step }: { step: 1 | 2 }) {
  const items = [{ n: 1 as const, label: "일정 입력" }, { n: 2 as const, label: "회의실 선택" }]
  return (
    <div style={{display:"flex", alignItems:"center", gap:24, padding:"16px 0", flexShrink:0}}>
      {items.map((it, i) => {
        const done = step > it.n, active = step === it.n
        const boxBg      = done ? "#00DE59" : active ? "#000" : "#D1D7E1"
        const labelColor = done ? "#00DE59" : active ? "#111" : "#D1D7E1"
        return (
          <React.Fragment key={it.n}>
            <div style={{display:"flex", alignItems:"center", gap:12}}>
              <div style={{width:32, height:32, borderRadius:12, background:boxBg, flexShrink:0,
                display:"flex", alignItems:"center", justifyContent:"center"}}>
                {done
                  ? <Check size={24} strokeWidth={2.4} color="#fff"/>
                  : <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:400, fontSize:14, lineHeight:1.25, color:"#fff"}}>{it.n}</span>}
              </div>
              <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:16, lineHeight:1.5,
                color:labelColor, whiteSpace:"nowrap"}}>{it.label}</span>
            </div>
            {i === 0 && <div style={{flex:1, height:1, background:"#111"}}/>}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// 모바일 필드 라벨 (Figma 2697:257 등) — 16px Medium #96A0B3 + 필수 빨간점 4px (gap 2)
function MLabel({ text, required = false }: { text: string; required?: boolean }) {
  return (
    <div style={{display:"flex", gap:2, alignItems:"flex-start"}}>
      <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:16, lineHeight:1.2, color:"#96A0B3"}}>{text}</span>
      {required && <span style={{width:4, height:4, borderRadius:"50%", background:"#EF4444", display:"inline-block", flexShrink:0}} aria-hidden="true"/>}
    </div>
  )
}

// 시각 칩 한 줄 가로 스크롤 (Figma 2710:1154/1190 실측) — 시작/종료 공용
//   헤더: 라벨 20px Medium #111 + gap24 + 현재값 20px #111 + 접미사(부터/까지) #D2D2D2 gap4, py8
//   칩: w90 h41 px16 py10 r12 gap8 — "오전/오후" Regular + 시각 Medium 14px gap4
//        기본 border #EBEEF4 텍스트 #96A0B3 / 선택 bg #000 border #000 흰색
//   선택 칩 자동 스크롤: scrollIntoView는 세로 스크롤까지 유발하므로 container.scrollLeft 직접 계산
function TimeChipRow({ label, valueText, suffix, options, selected, onPick }: {
  label: string; valueText: string; suffix: string;
  options: string[]; selected: string; onPick: (t: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const row = rowRef.current; if (!row) return
    const el = row.querySelector<HTMLElement>('[data-sel="1"]'); if (!el) return
    row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2)
  }, [selected, options.length])
  return (
    <div style={{display:"flex", flexDirection:"column", gap:16}}>
      {/* 헤더 행 */}
      <div style={{display:"flex", alignItems:"center", gap:24, padding:"8px 0"}}>
        <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:20, lineHeight:1, color:"#111", whiteSpace:"nowrap"}}>{label}</span>
        <div style={{display:"flex", alignItems:"center", gap:4, fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:20, lineHeight:1, whiteSpace:"nowrap"}}>
          <span style={{color:"#111"}}>{valueText}</span>
          <span style={{color:"#D2D2D2"}}>{suffix}</span>
        </div>
      </div>
      {/* 칩 줄 — 풀블리드 가로 스크롤 (부모 padding 20 보상) */}
      <div ref={rowRef} className="bm-chip-scroll"
        style={{display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch",
          margin:"0 -20px", padding:"0 20px"}}>
        {options.map(t => {
          const sel = t === selected
          const [ampm, clock] = (() => { const parts = fmtTime(t).split(" "); return [parts[0], parts.slice(1).join(" ")] })()
          return (
            <button key={t} type="button" data-sel={sel ? "1" : "0"} onClick={() => onPick(t)}
              style={{
                width:90, height:41, flexShrink:0, boxSizing:"border-box",
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:4,
                padding:"10px 16px", borderRadius:12,
                border:`1px solid ${sel ? "#000" : "#EBEEF4"}`,
                background: sel ? "#000" : "#fff",
                color: sel ? "#fff" : "#96A0B3",
                fontFamily:"Pretendard, sans-serif", fontSize:14, lineHeight:1.5,
                cursor:"pointer", transition:"background .12s, color .12s",
              }}>
              <span style={{fontWeight:400}}>{ampm}</span>
              <span style={{fontWeight:500}}>{clock}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PurposeChips({
  value, detail, onPick, onDetailChange, variant,
}: {
  value: BookingPurposeCode | null;
  detail: string;
  onPick: (code: BookingPurposeCode) => void;
  onDetailChange: (v: string) => void;
  variant: 'desktop' | 'mobile';
}) {
  const isEtc = isEtcPurpose(value);
  return (
    <div style={{display:"flex", flexDirection:"column", width:"100%"}}>
      {/* 칩 랩 — Figma chips wrapper: flex-wrap, gap 4 */}
      <div style={{display:"flex", flexWrap:"wrap", gap:4, width:"100%"}}>
        {BOOKING_PURPOSES.map(p => {
          const selected = value === p.code;
          return (
            <button
              key={p.code}
              type="button"
              className="btn"
              onClick={() => onPick(p.code)}
              aria-pressed={selected}
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:2,
                padding: selected ? "4px 14px 4px 8px" : "4px 14px",  // ← 선택 시 좌측 8 (체크 아이콘 자리, Figma 2688:624)
                borderRadius:16,
                border:`1px solid ${selected ? "transparent" : "#EBEEF4"}`,
                background: selected ? "#CAEFFF" : "#fff",
                fontFamily:"Pretendard, sans-serif",
                /* ← [2026-07-27 모바일 v2] Figma 2697:263 — 모바일 칩 16px(h32), 데스크톱 13px 유지 */
                fontWeight:500, fontSize: variant === 'mobile' ? 16 : 13, lineHeight:1.5,
                color: selected ? "#000" : "#96A0B3",
                cursor:"pointer",
                transition:"background .15s, color .15s",
              }}
            >
              {selected && (
                <span style={{width:20, height:20, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
                  <Check size={14} strokeWidth={2.4} color="#000"/>
                </span>
              )}
              {p.label}
            </button>
          );
        })}
      </div>

      {/* 헬퍼 — 미선택시에만 (선택시 프레임 2688:603엔 헬퍼 없음)
            ← [2026-07-27 스타일 변경] Figma 2697:758 갱신 반영 — 12px #D1D7E1 → 14px SemiBold #96D7FF(칩 파랑 계열), 래퍼 py4.
              데스크톱/모바일 공용 컴포넌트라 이 한 곳 수정으로 양쪽 모두 반영됨 */}
      {!value && (
        <div style={{
          marginTop:8,
          padding:"4px 0",
          fontFamily:"Pretendard, sans-serif",
          fontWeight:600, fontSize:14, lineHeight:1.5,
          color:"#96D7FF",
        }}>
          회의 목적을 선택하세요
        </div>
      )}

      {/* 기타 상세 입력 — etc 선택시에만 */}
      {isEtc && (variant === 'desktop' ? (
        // 데스크톱: 검정 언더라인 boxless (Figma 2688:595 — border-b black, pb 12)
        <div style={{
          marginTop:12,                       // ← Figma: 칩(y68)→입력(y80) 간격 12
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
          borderBottom:"1px solid #111",
          paddingBottom:12,
          position:"relative",                // ← placeholder 오버레이 기준 (회의 제목 필드와 동일 패턴)
        }}>
          <input
            className="bm-boxless"
            value={detail}
            onChange={e => onDetailChange(e.target.value)}
            placeholder=""
            aria-label="기타 목적을 구체적으로 입력하세요"
            maxLength={PURPOSE_DETAIL_MAX}
            autoComplete="off"
            autoFocus
            style={{
              flex:1, minWidth:0,
              background:"transparent", border:"none", outline:"none", padding:0,
              fontFamily:"Pretendard, sans-serif",
              fontWeight:500, fontSize:16, lineHeight:1.5, color:"#111",
            }}
          />
          {!detail && (
            <div style={{
              position:"absolute", top:0, left:0, pointerEvents:"none",
              fontFamily:"Pretendard, sans-serif",
              fontWeight:500, fontSize:16, lineHeight:1.5,
              color:PLACEHOLDER_COLOR, whiteSpace:"nowrap",
            }}>
              기타 목적을 구체적으로 입력하세요
            </div>
          )}
          <span style={{
            flexShrink:0,
            fontFamily:"Pretendard, sans-serif",
            fontWeight:500, fontSize:10, lineHeight:1.5,
            color: detail.length >= PURPOSE_DETAIL_MAX - 2 ? "#EF4444" : "#d1d9e7",  // ← 회의 제목 카운터와 동일 규칙(38자부터 경고색)
          }}>
            {detail.length}/{PURPOSE_DETAIL_MAX}
          </span>
        </div>
      ) : (
        // 모바일: 기존 모바일 입력 박스 스타일 (회의 제목 필드와 통일)
        <div style={{marginTop:8}}>
          {/* ← [2026-07-27 iOS 입력 HOTFIX] fontSize 15→16(iOS 자동줌 차단) + enterKeyHint/Enter→완료 */}
          <input
            value={detail}
            onChange={e => onDetailChange(e.target.value)}
            placeholder="기타 목적을 구체적으로 입력하세요"
            maxLength={PURPOSE_DETAIL_MAX}
            autoComplete="off"
            enterKeyHint="done" onKeyDown={blurOnEnter}
            style={{width:"100%", background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:10,
              color:"#111111", padding:"12px 14px", fontSize:16, outline:"none"}}
            onFocus={e=>e.target.style.borderColor="#111111"}
            onBlur={e=>e.target.style.borderColor="#E2E8F0"}
          />
          <div style={{textAlign:"right", fontSize:11,
            color: detail.length >= PURPOSE_DETAIL_MAX - 2 ? "#EF4444" : "#CBD5E1", marginTop:4}}>
            {detail.length}/{PURPOSE_DETAIL_MAX}
          </div>
        </div>
      ))}
    </div>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

export function BookingModal({prefill, date:initDate, editBooking=null, onClose, onSubmit, onUpdate, bookings, isAdmin=false, currentUser="홍길동", currentUserEmail="", rooms:roomsProp=[], users:usersProp=[]}) {
  // ── 모든 hooks를 최상단에 선언 ──────────────────────────────────────────────
  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvHeight, off: vvOff } = useVisualViewport();
  const today = todayStr();
  // ← [2026-05-28] 시작일 선택 범위: 어드민=올해 12/31(절대 권한), 비어드민=today+1개월(기존 유지)
  const maxDateObj = new Date();
  if (isAdmin) maxDateObj.setMonth(11, 31);                  // ← 어드민: 올해 12월 31일
  else         maxDateObj.setMonth(maxDateObj.getMonth()+1); // ← 비어드민: 기존 today+1개월
  const maxDate = objToStr(maxDateObj);

  const [bookingDate, setBookingDate] = useState(
    // ← [2026-04-19 P1] editBooking이면 그 예약의 날짜 유지(과거 예약 수정 가능),
    //   새 예약이면 initDate < today 일 때 today로 보정 (탭 밤새 유지 방어)
    editBooking ? tsDate(editBooking.start_at) : (initDate && initDate >= today ? initDate : today)
  );
  const [showPicker,  setShowPicker]  = useState(false);
  // ← [2026-04-19 P1] 달력 초기 표시 월/연도도 보정된 날짜 기준으로 계산
  const [calYear,  setCalYear]  = useState(() => dateToObj((initDate && initDate >= today) ? initDate : today).getFullYear());
  const [calMonth, setCalMonth] = useState(() => dateToObj((initDate && initDate >= today) ? initDate : today).getMonth());
  const [form, setForm] = useState(() => {
    if (editBooking) {
      return {
        room_id:   editBooking.room_id,
        title:     editBooking.title,
        // ← [2026-07-27 목적] 수정 모달에서 목적 변경 허용 (고지 확정) — 기존 값 초기 로드
        purpose:       (editBooking.purpose ?? null) as BookingPurposeCode | null,
        purposeDetail: editBooking.purposeDetail ?? "",
        start:     tsTime(editBooking.start_at),  // "HH:MM" 24시간 형식 유지
        end:       tsTime(editBooking.end_at),
        memo:      editBooking.memo || "",
        // AttendeeRef[] → AttendeeFormItem[]
        // email로 usersProp에서 역조회해 user_id·dept·avatar_url 복원
        attendees: (editBooking.attendees || []).map(a => {
          const u = (usersProp as any[]).find(u => u.email === a.email)
          return {
            user_id:    u?.user_id   ?? a.email,   // 없으면 email을 임시 key로
            name:       a.name       || u?.name    || a.email,
            email:      a.email,
            dept:       u?.dept      ?? '',
            avatar_url: u?.avatar_url ?? null,
          }
        }),
      };
    }
    // 현재 시각 기준 다음 15분 단위 스냅 (예: 6:08 → 6:15, 6:15 → 6:30)
    const nowMin = nowMinutes();
    const snapStart = Math.ceil((nowMin+1)/15)*15;
    const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
    const clampedEnd   = Math.min(clampedStart+15, 19*60); // ← [2026-04-26] 60→15: 모달 오픈 시 기본 15분
    const defStart = prefill?.start || `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
    const defEnd   = prefill?.end   || `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
    return {
      room_id:    prefill?.room_id || null,
      title:      "",
      // ← [2026-07-27 목적] 신규 예약 초기값 — 미선택(null), 기타 상세 빈 문자열
      purpose:       null as BookingPurposeCode | null,
      purposeDetail: "",
      start:      defStart,
      end:        defEnd,
      memo:       "",
      attendees:  [],
      bookerOverride: null,  // ← [2026-06-12] 대리 예약 대상(요청자). null=본인 예약
    };
  });
  const pickerRef    = useRef(null);
  const pickerRef2   = useRef(null);
  const attendeeRef  = useRef(null);
  const [attendeeQ,  setAttendeeQ]  = useState("");
  const [attendeeFocus, setAttendeeFocus] = useState(false);
  // ← [2026-05-04 핫픽스 v14] 키보드 네비게이션 — 하이라이트 인덱스 state
  //   · -1: 하이라이트 없음 (마우스 모드)
  //   · 0~N-1: 키보드로 선택된 항목 인덱스
  //   · 검색어 변경 시 자동 -1로 리셋 (useEffect)
  const [attendeeHighlight, setAttendeeHighlight] = useState(-1);
  const [recur, setRecur] = useState("NEVER"); // "NEVER" | "EVERY_DAY" | "EVERY_WEEK"
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [graphUsers,    setGraphUsers]    = useState<AppUser[]>([]);
  const [isSearching,   setIsSearching]   = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  // ← [2026-06-12] 대리 예약 — 어드민 전용 예약자 피커 검색 상태
  const [bookerQ,     setBookerQ]     = useState("");
  const [bookerFocus, setBookerFocus] = useState(false);
  const bookerRef = useRef<HTMLDivElement>(null);

  // [2026-04-17 Step 3] 참석자 검색: DB 호출 → 메모리 필터링으로 전환
  // ────────────────────────────────────────────────────────────────────
  // 변경 이유:
  //   - 기존: searchGraphUsers(q) → profiles 테이블 ILIKE %q% 쿼리
  //           → 인덱스 활용 불가 → 매 키스트로크마다 profiles 529행 Full Scan
  //           → BookingModal 열 때마다 3~5회 DB 호출 발생
  //   - 변경: usersProp(앱 시작 시 1회 로드된 전체 users)에서 로컬 필터링
  //           → DB 호출 0회 + 즉시 반응 + 디바운스 불필요
  //
  // 설계 원칙: 마스터 데이터(users 500명)는 앱 시작 시 1회만 로드,
  //            검색/필터링은 메모리에서 처리 (rooms 패턴과 동일)
  //
  // UX 호환성:
  //   - "길동"으로 "홍길동" 검색 가능 (includes 사용 — ILIKE %q% 와 동일)
  //   - 이름·이메일·부서 3개 필드 중 하나라도 매칭 (기존 동일)
  //   - 최대 8개 결과 (기존 LIMIT 8 과 동일)
  //   - 본인 제외, 퇴사자(is_active=false) 제외 (기존 동일)
  useEffect(() => {
    const q = attendeeQ.trim().toLowerCase();  // ← [변경] 대소문자 무시 위해 lowercase 통일
    // 입력값 없으면 즉시 동기 초기화 (리스트 잔존 방지)
    if (q.length < 1) {
      setGraphUsers([]);
      setIsSearching(false);
      setSearchedQuery("");
      return;
    }
    // [변경] 디바운스 제거 — 메모리 검색이라 즉시 실행 (DB 부담 없음)
    // usersProp에서 로컬 필터링
    const results = (usersProp as AppUser[])
      .filter(u => {
        // 본인 제외 (currentUserEmail 있을 때만)
        if (currentUserEmail && u.email === currentUserEmail) return false;
        // 비활성 유저(퇴사자) 제외
        if (u.is_active === false) return false;
        // 이름/이메일/부서 중 하나라도 포함되면 매칭 (ILIKE %q% 동등)
        const name  = (u.name  ?? '').toLowerCase();
        const email = (u.email ?? '').toLowerCase();
        const dept  = (u.dept  ?? '').toLowerCase();
        return name.includes(q) || email.includes(q) || dept.includes(q);
      })
      .slice(0, 8);  // 기존 LIMIT 8 동등
    setGraphUsers(results);
    setSearchedQuery(attendeeQ.trim());  // 원본 query (UI 렌더링에서 trim된 값과 비교하므로)
    setIsSearching(false);  // 동기 실행이라 항상 false
  }, [attendeeQ, currentUserEmail, usersProp]);


  useEffect(() => {
    const h = (e) => {
      const inPicker = (pickerRef.current && pickerRef.current.contains(e.target))
                    || (pickerRef2.current && pickerRef2.current.contains(e.target));
      if(!inPicker) setShowPicker(false);
      if(attendeeRef.current && !attendeeRef.current.contains(e.target)) setAttendeeFocus(false);
      if(bookerRef.current && !bookerRef.current.contains(e.target)) setBookerFocus(false);  // ← [2026-06-12] 예약자 피커 외부 클릭 닫기
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── 파생 값 ────────────────────────────────────────────────────────────────
  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  // 시작 슬롯: 07:00 ~ 18:45 (19:00 이후 시작 불가)
  // 종료 슬롯: 시작보다 늦고 최대 19:00
  const tOpts = (() => {
    const all: string[] = [];
    for(let h=7; h<=18; h++) for(let m=0; m<60; m+=15) all.push(`${fmt2(h)}:${fmt2(m)}`);
    all.push('18:45'); // 마지막 시작 슬롯 (중복 방지: 루프가 18:00~18:45 이미 포함)
    // 중복 제거 후 정렬
    const unique = [...new Set(all)].sort();
    // 오늘 날짜면 현재 시각 이전 슬롯 제거
    if (bookingDate === todayStr()) {
      const now = nowMinutes();
      return unique.filter(t => timeToMin(t) > now);
    }
    return unique;
  })();
  // 종료 슬롯: 시작보다 늦고 최대 19:00
  const endOpts = (() => {
    const all: string[] = [];
    for(let h=7; h<=19; h++) for(let m=0; m<60; m+=15) all.push(`${fmt2(h)}:${fmt2(m)}`);
    all.push('19:00');
    const unique = [...new Set(all)].sort();
    return unique.filter(t => timeToMin(t) > timeToMin(form.start) && timeToMin(t) <= 19*60);
  })();
  // 오늘인데 예약 가능한 시작 슬롯이 없는 경우 (18:45 이후)
  // 오늘이고 현재시각이 18:45 이후(= 시작 슬롯 없음) → 예약 불가 안내
  const noTimeLeft     = bookingDate === todayStr() && tOpts.length === 0;
  // 오늘이고 현재시각이 19:00 이상 → "오후 7시 이후 예약 불가" 안내
  const isAfter7pm     = bookingDate === todayStr() && nowMinutes() >= 19 * 60;

  const validTime   = form.start < form.end;
  const durMin      = timeToMin(form.end) - timeToMin(form.start);
  const allRooms = roomsProp;
  const selectedRoom     = form.room_id ? allRooms.find(r=>r.room_id===form.room_id) : null;
  const isApprovalRoom   = !editBooking && (selectedRoom?.is_admin_only ?? false);  // Admin 포함 모두 승인 요청
  const selectedFloor    = selectedRoom  ? getFloor(selectedRoom.floor_id) : null;
  const selectedFeatures = selectedRoom?.features ?? [];

  // ── 편집 모드에서 자기 자신 예약 제외 (충돌 검사 용) ──
  const bookingsForCheck = editBooking
    ? bookings.filter(b => b.id !== editBooking.id)
    : bookings;

  // ── 중앙화된 가용 회의실 검증 ──
  const { available: availableRooms, unavailable: unavailableRooms } = useMemo(
    () => getAvailableRooms(allRooms, bookingsForCheck, bookingDate, form.start, form.end, isAdmin),
    [bookingsForCheck, bookingDate, form.start, form.end, isAdmin]
  );

  // 선택된 회의실이 현재 시간 기준으로 여전히 가용한지 실시간 검증
  const isSelectedRoomAvailable = form.room_id
    ? availableRooms.some(r => r.room_id === form.room_id)
    : false;

  // ── 핵심: 시간/날짜 변경 시 선택된 회의실이 불가능하면 자동 해제 ──
  // 초기 마운트 시에는 실행하지 않음 (prefill room_id 보호)
  // skipRoomClear: 자동 시간보정 직후 1회 skip — 캘린더 빈칸 클릭 시 room_id 보호
  const isMounted     = useRef(false);
  const skipRoomClear = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (skipRoomClear.current) { skipRoomClear.current = false; return; } // 자동보정 직후 skip
    if (form.room_id && validTime && !availableRooms.some(r => r.room_id === form.room_id)) {
      set("room_id", null);
    }
  }, [form.start, form.end, bookingDate, availableRooms]);

  // 시간이 흘러 form.start가 tOpts 범위 밖(과거)으로 밀려났을 때 자동 보정
  // tick(30초) 기반으로만 체크 — tOpts[0] 의존성은 React 렌더 사이클과 맞지 않아 제거
  useEffect(() => {
    if (bookingDate !== todayStr() || tOpts.length === 0) return;
    const startMin = timeToMin(form.start);
    const now = nowMinutes();
    if (startMin <= now) {
      const nextStart = tOpts[0];
      if (nextStart === form.start) return; // 이미 같으면 스킵
      const nextEndMin = Math.min(timeToMin(nextStart) + 15, 19*60); // ← [2026-04-26] 60→15: tick 자동보정 시 기본 15분
      skipRoomClear.current = true; // 자동보정 발생 → auto-clear 1회 건너뜀
      setForm(f => ({
        ...f,
        start: nextStart,
        end: `${fmt2(Math.floor(nextEndMin/60))}:${fmt2(nextEndMin%60)}`,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDate]); // 날짜 변경 시에만 보정 (tick 의존 제거)

  // 반복 선택 시 생성 가능 건수 미리 계산 (maxDate 기준)
  // 반복 예약 미리보기: 전체 날짜 목록 + 회의실 선택 시 충돌 날짜까지 계산
  const recurPreview = useMemo(() => {
    if (editBooking || recur === "NEVER") return { total: 1, available: 1, conflictDates: [], allDates: [] };
    // ← [2026-05-28] 반복 종료일 정책: today+1개월 → 올해 12/31 (어드민 전용, App.tsx addBooking과 동일)
    const maxD2 = new Date(); maxD2.setMonth(11, 31); // ← 11=12월, 31일 → 올해 마지막날(연도 불변)
    const maxStr = objToStr(maxD2);
    const startDow = dateToObj(bookingDate).getDay();
    const allDates = [];
    let cur = dateToObj(bookingDate);
    const max = dateToObj(maxStr);
    while (cur <= max) {
      const ds = objToStr(cur), dow = cur.getDay();
      if (recur === "EVERY_DAY") allDates.push(ds);
      else if (recur === "EVERY_WEEK" && dow === startDow) allDates.push(ds);
      cur.setDate(cur.getDate() + 1);
    }
    // 회의실이 선택돼 있고 시간이 유효하면 충돌 날짜도 미리 계산
    const conflictDates = [];
    if (form.room_id && validTime) {
      const fS = timeToMin(form.start), fE = timeToMin(form.end);
      allDates.forEach(ds => {
        const check = hasTimeConflict(bookingsForCheck, form.room_id, ds, fS, fE);
        if (check.conflict) conflictDates.push(ds);
      });
    }
    return {
      total: allDates.length,
      available: allDates.length - conflictDates.length,
      conflictDates,
      allDates,
      maxStr,
    };
  }, [recur, bookingDate, form.room_id, form.start, form.end, validTime, bookings]);
  const recurPreviewCount = recurPreview.total; // 하위 호환용
  // ─── [2026-07-27 목적] 선택/해제 핸들러 + 필수 검증 ────────────────────────
  //   · 같은 칩 재클릭 = 해제(null) — 필수값이라 제출만 차단되고 해제 자체는 허용
  //   · 다른 칩 전환 시 기타 상세는 초기화 (etc 외 값에 detail이 남으면 DB CHECK 위반)
  const pickPurpose = (code: BookingPurposeCode) => {
    setForm(f => {
      if (f.purpose === code) return { ...f, purpose: null, purposeDetail: "" };
      return { ...f, purpose: code, purposeDetail: isEtcPurpose(code) ? f.purposeDetail : "" };
    });
  };
  // 목적 필수 + 기타면 상세 필수 (요구사항 확정 스펙)
  // ← [2026-07-27 제목 자동줄바꿈] 수정 모드 초기값·데스크톱↔모바일 전환(재마운트) 시 높이 반영
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { autoGrowTitle(titleRef.current) }, [isMobile])

  const purposeValid = !!form.purpose && (!isEtcPurpose(form.purpose) || form.purposeDetail.trim().length > 0);
  const canSubmit = !!(form.room_id && form.title.trim() && purposeValid && validTime && isSelectedRoomAvailable && recurPreview.available > 0);  // ← [2026-07-27 목적] purposeValid 게이트 추가

  // ── 날짜 피커 helpers ───────────────────────────────────────────────────────
  const todayObj   = dateToObj(today);
  const maxObj     = dateToObj(maxDate);
  const canGoPrev  = calYear > todayObj.getFullYear() || (calYear===todayObj.getFullYear() && calMonth > todayObj.getMonth());
  const canGoNext  = calYear < maxObj.getFullYear()   || (calYear===maxObj.getFullYear()   && calMonth < maxObj.getMonth());
  const prevMonth  = () => { if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1); };
  const nextMonth  = () => { if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1); };

  const selectDate = (ds) => {
    if(ds < today || ds > maxDate) return;
    setBookingDate(ds);
    setShowPicker(false);
    set("room_id", null);
    // 오늘로 변경 시 start/end가 과거면 현재 기준으로 재계산
    if (ds === todayStr()) {
      const now = nowMinutes();
      const snapStart = Math.ceil((now+1)/15)*15;
      const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
      const clampedEnd   = Math.min(clampedStart+15, 19*60); // ← [2026-04-26] 60→15: 날짜 변경 시 기본 15분
      const newStart = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
      const newEnd   = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
      setForm(f => ({...f, start:newStart, end:newEnd, room_id:null}));
    }
  };

  const calFirstDay    = new Date(calYear, calMonth, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const calCells       = [];
  for(let i=0; i<calFirstDay; i++) calCells.push(null);
  for(let i=1; i<=calDaysInMonth; i++) calCells.push(i);
  while(calCells.length%7!==0) calCells.push(null);

  // ── 참석자 helpers ──────────────────────────────────────────────────────────
  const addAttendee = (u) => {
    if (form.attendees.find(a => a.user_id === u.user_id)) return;
    set("attendees", [...form.attendees, { ...u, role: "ATTENDEE" }]);
    setAttendeeQ("");
    setAttendeeFocus(false);
  };
  const removeAttendee = (uid) => set("attendees", form.attendees.filter(a => a.user_id !== uid));

  // 검색 결과: 현재 사용자 + 이미 추가된 사람 제외
  // Graph API 결과에서 이미 추가된 참석자만 제거
  const attendeeSuggestions = graphUsers
    .filter(u => !form.attendees.find(a => a.user_id === u.user_id));

  // ─── [2026-05-04 핫픽스 v14] 키보드 네비게이션 ────────────────────────────
  //   ↓/↑: 드롭다운 항목 이동 (순환) / Enter: 선택 / Esc: 드롭다운 닫기
  //   적용: 모바일 input(L974) + 데스크톱 input(L2228) 두 곳 모두
  //
  //   1) 검색어 변경 → 결과 갱신 → 인덱스 -1로 자동 리셋 (잘못된 인덱스 선택 방지)
  //      attendeeQ가 바뀔 때마다 실행 (graphUsers 변경 트리거 됨)
  useEffect(() => {
    setAttendeeHighlight(-1);
  }, [attendeeQ]);

  //   2) 키보드 이벤트 핸들러 (모바일/데스크톱 input 공통)
  const onAttendeeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const items = attendeeSuggestions;
    if (!attendeeFocus || items.length === 0) {
      // Enter만 특별 처리 — 결과 0 + Enter는 무시 (input 기본 동작 차단)
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAttendeeHighlight(i => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAttendeeHighlight(i => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 하이라이트 없으면(-1) 첫 번째 자동 선택 (UX 관행)
      const idx = attendeeHighlight >= 0 ? attendeeHighlight : 0;
      const target = items[idx];
      if (target) addAttendee(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAttendeeFocus(false);
      setAttendeeHighlight(-1);
    }
  };

  // 참석자 UI JSX (재사용: 모바일 Step1 + 데스크톱 폼)
  const AttendeeSection = (compact = false) => (
    <div>
      {/* ← [2026-07-27 모바일 v2] 라벨 신규 문법(16px Medium #96A0B3) — AttendeeSection은 모바일 전용(데스크톱은 Field 인라인) */}
      <div style={{display:"flex", alignItems:"baseline", gap:6, marginBottom:16}}>
        <span style={{fontFamily:"Pretendard, sans-serif",fontWeight:500,fontSize:16,lineHeight:1.5,color:"#96A0B3"}}>참석자</span>
        <span style={{fontSize:11,fontWeight:400,color:"#CBD5E1"}}>초대 메일 자동 발송</span>
      </div>

      {/* 선택된 참석자 칩 */}
      {form.attendees.length > 0 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
          {form.attendees.map(a => (
            <AttendeeChip
              key={a.user_id}
              name={a.name}
              avatarUrl={a.avatar_url}
              dept={a.dept}
              onRemove={() => removeAttendee(a.user_id)}
            />
          ))}
        </div>
      )}

      {/* 검색 인풋 */}
      <div ref={attendeeRef} style={{position:"relative"}}>
        <input
          value={attendeeQ}
          onChange={e=>{setAttendeeQ(e.target.value);setAttendeeFocus(true);}}
          onFocus={()=>setAttendeeFocus(true)}
          onKeyDown={onAttendeeKeyDown}/* ← [핫픽스 v14] ↓/↑/Enter/Esc 키보드 네비게이션 */
          placeholder="이름 또는 부서로 검색..."
          style={{width:"100%",background:"#F8FAFC",border:`1px solid ${attendeeFocus?"#6366F1":"#E2E8F0"}`,
            borderRadius:10,color:"#111111",padding:"10px 14px",
            fontSize:isMobile?16:13,  /* ← [2026-07-27 iOS 입력 HOTFIX] 모바일 16 — 자동줌 차단. Enter는 기존 선택 UX(onAttendeeKeyDown) 유지 */
            outline:"none"}}/>
        {/* 드롭다운 */}
        {attendeeFocus && attendeeSuggestions.length > 0 && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            boxShadow:"0 8px 24px rgba(0,0,0,0.10)",overflow:"hidden"}}>
            {attendeeSuggestions.map((u, idx) => (
              <div key={u.user_id} onClick={()=>addAttendee(u)}
                onMouseEnter={()=>setAttendeeHighlight(idx)/* ← [핫픽스 v14] 마우스 hover로 인덱스 동기화 */}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",
                  cursor:"pointer",borderBottom:"1px solid #F8FAFC",
                  background: attendeeHighlight === idx ? "#F8FAFC" : "#fff"/* ← [핫픽스 v14] 하이라이트 표시 */}}>
                <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={28} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{u.name}</div>
                  <div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div>
                </div>
                <span style={{fontSize:11,color:"#CBD5E1",flexShrink:0}}>+ 추가</span>
              </div>
            ))}
          </div>
        )}
        {attendeeFocus && attendeeQ.trim().length > 0 && isSearching && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            padding:"12px 14px",fontSize:12,color:"#94A3B8",
            boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
            검색 중...
          </div>
        )}
        {attendeeFocus && attendeeQ.trim().length > 0 && !isSearching && searchedQuery === attendeeQ.trim() && attendeeSuggestions.length === 0 && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            padding:"12px 14px",fontSize:12,color:"#94A3B8",
            boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
            검색 결과가 없습니다
          </div>
        )}
      </div>
    </div>
  );

  // ── [2026-06-12] 대리 예약 — 어드민 전용 예약자 피커 섹션 ───────────────────
  //   기본값: 본인(currentUser) 예약. "다른 사람으로 지정"하면 form.bookerOverride에 요청자 저장.
  //   요청자 선택 시 단건만 생성됨(되풀이 불가) — addBooking에서 recur 강제 NEVER.
  //   검색: usersProp 메모리 필터(AttendeeSection 동일 패턴, DB 호출 0회).
  const bookerSuggestions = (() => {
    const q = bookerQ.trim().toLowerCase();
    if (q.length < 1) return [] as AppUser[];
    return (usersProp as AppUser[])
      .filter(u => {
        if (currentUserEmail && u.email === currentUserEmail) return false;  // 본인 제외(기본값이 본인)
        if (u.is_active === false) return false;                              // 퇴사자 제외
        if (!u.email) return false;                                           // user_email NOT NULL — 이메일 없는 사용자 제외
        const name  = (u.name  ?? '').toLowerCase();
        const email = (u.email ?? '').toLowerCase();
        const dept  = (u.dept  ?? '').toLowerCase();
        return name.includes(q) || email.includes(q) || dept.includes(q);
      })
      .slice(0, 8);
  })();

  const pickBooker = (u: AppUser) => {                  // ← 요청자 선택
    set("bookerOverride", { user_id: u.user_id, name: u.name, email: u.email, dept: u.dept ?? '', avatar_url: (u as any).avatar_url ?? null });
    setBookerQ("");
    setBookerFocus(false);
  };
  const clearBooker = () => set("bookerOverride", null); // ← 본인으로 되돌리기

  const BookerSection = () => {
    const ov = (form as any).bookerOverride;
    return (
      <div>
        <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6,letterSpacing:"0.4px"}}>
          예약자 <span style={{fontWeight:400,color:"#CBD5E1"}}>(관리자 · 대리 예약)</span>
        </label>

        {ov ? (
          /* 대리 대상 선택됨 */
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,background:"#EEF2FF",border:"1px solid #C7D2FE",
              borderRadius:10,padding:"10px 12px"}}>
              <UserAvatar name={ov.name} avatarUrl={ov.avatar_url ?? null} size={32} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{ov.name}</div>
                <div style={{fontSize:11,color:"#6366F1"}}>{ov.dept}{ov.dept && ov.email ? " · " : ""}{ov.email}</div>
              </div>
              <button onClick={clearBooker} type="button"
                style={{fontSize:12,fontWeight:600,color:"#4F46E5",background:"transparent",border:0,cursor:"pointer",flexShrink:0}}>
                본인으로
              </button>
            </div>
            <div style={{marginTop:6,fontSize:11,color:"#64748B",lineHeight:1.5}}>
              이 사용자를 예약자로 지정해 대신 예약합니다. 대리 예약은 단건만 생성됩니다.
            </div>
          </>
        ) : (
          /* 기본: 본인 + 다른 사람 검색 */
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,background:"#F8FAFC",border:"1px solid #E2E8F0",
              borderRadius:10,padding:"10px 12px",marginBottom:8}}>
              <UserAvatar name={currentUser} avatarUrl={null} size={28} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{currentUser} <span style={{fontSize:11,fontWeight:400,color:"#94A3B8"}}>(본인)</span></div>
              </div>
            </div>
            <div ref={bookerRef} style={{position:"relative"}}>
              <input
                value={bookerQ}
                onChange={e=>{setBookerQ(e.target.value);setBookerFocus(true);}}
                onFocus={()=>setBookerFocus(true)}
                placeholder="다른 사람을 예약자로 지정 (이름/부서 검색)"
                style={{width:"100%",background:"#F8FAFC",border:`1px solid ${bookerFocus?"#6366F1":"#E2E8F0"}`,
                  borderRadius:10,color:"#111111",padding:"10px 14px",fontSize:isMobile?16:13,outline:"none",boxSizing:"border-box"}}/>  {/* ← [2026-07-27 iOS 입력 HOTFIX] 모바일 16 */}
              {bookerFocus && bookerSuggestions.length > 0 && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
                  background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  boxShadow:"0 8px 24px rgba(0,0,0,0.10)",overflow:"hidden"}}>
                  {bookerSuggestions.map(u => (
                    <div key={u.user_id} onClick={()=>pickBooker(u)}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",borderBottom:"1px solid #F8FAFC"}}
                      onMouseEnter={e=>(e.currentTarget.style.background="#F8FAFC")}
                      onMouseLeave={e=>(e.currentTarget.style.background="#fff")}>
                      <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={28} />
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{u.name}</div>
                        <div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div>
                      </div>
                      <span style={{fontSize:11,color:"#CBD5E1",flexShrink:0}}>지정</span>
                    </div>
                  ))}
                </div>
              )}
              {bookerFocus && bookerQ.trim().length > 0 && bookerSuggestions.length === 0 && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
                  background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  padding:"12px 14px",fontSize:12,color:"#94A3B8",boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
                  검색 결과가 없습니다
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  // ← [2026-07-27 모바일 v2] 구 시간 UI(TimeRangePicker 아코디언 + TimeGrid 6열 + handleTimeBtn/timePickerStep/startOpen/endOpen) 전면 제거.
  //   대체: TimeChipRow(시작/종료 칩 가로 스크롤, 모듈 레벨) + pickStartChip. 옵션 생성(tOpts/endOpts)·자동보정 useEffect는 불변.

  // ── Step 상태 (모바일 전용) ─────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 항상 step1(일정입력)부터 시작 — prefill room_id가 있어도 동일
  // ← [2026-07-27 목적 HOTFIX] purposeValid 추가 — canSubmit과 검증 계약 일치.
  //   누락 시: 목적 미완인 채 Step2 진입 → '예약 확정' 영구 비활성인데 Step2엔 목적 UI가
  //   없어 사유 확인 불가(모바일 미작동 신고의 근본 원인). 미완 항목은 그 UI가 있는 Step1에서 차단한다.
  const canGoStep2 = !!(form.title.trim() && validTime && purposeValid);

  // ← [2026-07-27 모바일 v2] 시작 칩 선택 — 데스크톱 select onChange와 동일 계약(종료=시작+15 클램프).
  //   종료 칩은 endOpts가 이미 시작 이후만 생성하므로 set("end", t)만으로 안전
  const pickStartChip = (t: string) => {
    set("start", t);
    const clamped = Math.min(timeToMin(t) + 15, 19*60);
    set("end", `${fmt2(Math.floor(clamped/60))}:${fmt2(clamped%60)}`);
  };

  // ── 공통: 회의실 카드 그리드 ────────────────────────────────────────────────
  // 회의실별 상태 판별 (unavailable room용)
  const getRoomUnavailStatus = (rid) => {
    const now = nowMinutes();
    const isToday = bookingDate === todayStr();
    const dayBks = bookings.filter(b => b.room_id===rid && tsDate(b.start_at)===bookingDate && !b.autoCancelled);
    const fStart = timeToMin(form.start), fEnd = timeToMin(form.end);
    // 요청 시간과 겹치는 예약 찾기
    const conflict = dayBks.find(b => {
      const bs=tsMin(b.start_at), be=tsMin(b.end_at);
      return bs<fEnd && be>fStart;
    });
    if (!conflict) return { label:"예약됨", color:"#DC2626", bg:"#FEF2F2" };
    // 곧 시작 vs 이미 예약됨 구분
    if (isToday) {
      const minsUntil = tsMin(conflict.start_at) - now;
      if (minsUntil > 0 && minsUntil <= 30) return { label:"곧 시작", color:"#D97706", bg:"#FFFBEB" };
    }
    return { label:"예약됨", color:"#DC2626", bg:"#FEF2F2" };
  };

  const RoomGrid2 = (cols) => (
    <div style={{display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:10}}>
      {/* 예약 가능 회의실 */}
      {availableRooms.map(r => {
        const fl=getFloor(r.floor_id);
        const isSel=form.room_id===r.room_id;
        const isAdminRoom = allRooms.find(rm=>rm.room_id===r.room_id)?.is_admin_only ?? false;
        return (
          <div key={r.room_id} onClick={()=>set("room_id", isSel?null:r.room_id)}
            style={{background:isSel?"#111":"#fff",
              border:`1.5px solid ${isSel?"#111":"#E2E8F0"}`, borderRadius:12,
              padding:"16px 18px", cursor:"pointer", transition:"all 0.15s", boxSizing:"border-box"}}
            onMouseEnter={e=>{if(!isSel){e.currentTarget.style.borderColor="#94A3B8";}}}
            onMouseLeave={e=>{if(!isSel){e.currentTarget.style.borderColor="#E2E8F0";}}}>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {isSel
                ? <span style={{background:"#B9F8CF",color:"#111",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999,display:"inline-flex",alignItems:"center",gap:3}}><Check size={10} strokeWidth={1.8}/>선택됨</span>
                : <span style={{background:"#D5F0FF",color:"#000",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>예약가능</span>}
              {isAdminRoom && !isSel && (
                <span style={{background:"#FEF3C7",color:"#92400E",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>승인 필요</span>
              )}
              {isAdminRoom && isSel && (
                <span style={{background:"#FEF3C7",color:"#92400E",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>승인 후 확정</span>
              )}
            </div>
            <div style={{fontSize:15,fontWeight:600,color:isSel?"#fff":"#111",marginBottom:4}}>{r.room_name}</div>
            <div style={{fontSize:12,color:isSel?"rgba(255,255,255,0.5)":"#94A3B8"}}>{fl.floor_name} · {r.capacity}인</div>
          </div>
        );
      })}
      {/* 사용 불가 회의실 — separator 없이 자연스럽게 이어짐 */}
      {unavailableRooms.map(r => {
        const fl=getFloor(r.floor_id);
        const st=getRoomUnavailStatus(r.room_id);
        return (
          <div key={r.room_id} style={{background:st.bg, border:"1.5px solid transparent",
            borderRadius:12, padding:"16px 18px", boxSizing:"border-box"}}>
            <div style={{marginBottom:10}}>
              <span style={{background:st.bg==="FEF2F2"?"#FEE2E2":"#FEE2E2",color:st.color,fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>{st.label}</span>
            </div>
            <div style={{fontSize:15,fontWeight:600,color:"#ff9494",marginBottom:4}}>{r.room_name}</div>
            <div style={{fontSize:12,color:"#ff9494",opacity:0.6}}>{fl.floor_name} · {r.capacity}인</div>
          </div>
        );
      })}
    </div>
  );

  // ── [Phase F 2026-04-26] 데스크톱 우측 패널 전용 회의실 그리드 ────────────────
  //   Figma 노드: 302:5519-5615 / 299:3828-4724
  //   기존 RoomGrid2와 분리 — 모바일 step2는 기존 RoomGrid2 그대로 사용
  //   카드 레이아웃: h:100, p:10, radius:16, flex-col justify-between (회의실명 위 / 배지 아래)
  //   배지 위치 반전 (현재 위쪽 → 아래쪽)
  const RoomGridDesktop = () => (
    <div style={{
      display:"grid",
      gridTemplateColumns:"repeat(2, minmax(0, 1fr))",
      gap:10,
      padding:"24px 0",
      background:"#fff",
      width:"100%",
    }}>
      {/* 가용 회의실 */}
      {availableRooms.map(r => {
        const fl = getFloor(r.floor_id);
        const isSel = form.room_id === r.room_id;
        const isAdminRoom = allRooms.find(rm => rm.room_id === r.room_id)?.is_admin_only ?? false;
        return (
          <div key={r.room_id}
            onClick={()=>set("room_id", isSel ? null : r.room_id)}
            style={{
              background: isSel ? "#000" : "#fff",
              border: `1px solid ${isSel ? "#000" : "#dee5f1"}`,
              borderRadius:16,
              padding:10,
              height:100,
              cursor:"pointer",
              display:"flex",
              flexDirection:"column",
              justifyContent:"space-between",
              boxSizing:"border-box",
              transition:"border-color 0.15s",
            }}
            onMouseEnter={e => { if (!isSel) e.currentTarget.style.borderColor = "#94A3B8"; }}
            onMouseLeave={e => { if (!isSel) e.currentTarget.style.borderColor = "#dee5f1"; }}
          >
            {/* 위쪽: 회의실명 + 부가정보 */}
            <div style={{display:"flex", flexDirection:"column", gap:4}}>
              <span style={{
                fontFamily:"Pretendard, sans-serif",
                fontWeight:500, fontSize:14, lineHeight:1,
                color: isSel ? "#fff" : "#000",
                whiteSpace:"nowrap",
              }}>{r.room_name}</span>
              <div style={{display:"flex", gap:2, alignItems:"center"}}>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5,
                  color:"#6a7282",
                }}>{fl.floor_name}</span>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5,
                  color:"#6a7282",
                }}>•</span>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5,
                  color:"#6a7282",
                }}>{r.capacity}인</span>
              </div>
            </div>
            {/* 아래쪽: 배지 (선택됨 또는 예약가능, + HR 승인 필요 emerald) */}
            <div style={{display:"flex", gap:4, alignItems:"center", flexWrap:"wrap"}}>
              {isSel ? (
                /* 선택됨 배지 */
                <div style={{
                  background:"#b9f8cf",
                  padding:"4px 8px",
                  borderRadius:24,
                  display:"flex", gap:2, alignItems:"center", justifyContent:"center",
                }}>
                  <Check size={16} strokeWidth={1.8} color="#000"/>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500, fontSize:10, lineHeight:1.5, color:"#000",
                    whiteSpace:"nowrap",
                  }}>선택됨</span>
                </div>
              ) : (
                /* 예약가능 배지 */
                <div style={{
                  background:"#D5F0FF",
                  padding:"4px 8px",
                  borderRadius:24,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500, fontSize:10, lineHeight:1.5, color:"#000",
                    whiteSpace:"nowrap",
                  }}>예약가능</span>
                </div>
              )}
              {/* HR 승인 필요 (emerald) — 선택 여부와 무관하게 추가 표시 */}
              {isAdminRoom && (
                <div style={{
                  background:"#e6ffb0",
                  padding:"4px 8px",
                  borderRadius:24,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500, fontSize:10, lineHeight:1.5, color:"#000",
                    whiteSpace:"nowrap",
                  }}>HR 승인 필요</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 불가용 회의실 (예약됨 / 곧 사용) */}
      {unavailableRooms.map(r => {
        const fl = getFloor(r.floor_id);
        const st = getRoomUnavailStatus(r.room_id);
        // [Phase F] "곧 시작" → "곧 사용" 표시 변환 (label 자체는 그대로 유지)
        const displayLabel = st.label === "곧 시작" ? "곧 사용" : st.label;
        const isImminent   = st.label === "곧 시작";
        return (
          <div key={r.room_id}
            style={{
              background:"#fef2f2",
              borderRadius:16,
              padding:10,
              height:100,
              display:"flex",
              flexDirection:"column",
              justifyContent:"space-between",
              boxSizing:"border-box",
              border:"1px solid transparent",
            }}
          >
            {/* 위쪽: 회의실명 + 부가정보 */}
            <div style={{display:"flex", flexDirection:"column", gap:4}}>
              <span style={{
                fontFamily:"Pretendard, sans-serif",
                fontWeight:500, fontSize:14, lineHeight:1,
                color:"#ff8b8b",
                whiteSpace:"nowrap",
              }}>{r.room_name}</span>
              <div style={{display:"flex", gap:2, alignItems:"center"}}>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5, color:"#ff8b8b",
                }}>{fl.floor_name}</span>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5, color:"#ff8b8b",
                }}>•</span>
                <span style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500, fontSize:10, lineHeight:1.5, color:"#ff8b8b",
                }}>{r.capacity}인</span>
              </div>
            </div>
            {/* 아래쪽: 배지 */}
            <div style={{
              background:"#ffdbdb",
              padding:"4px 8px",
              borderRadius:24,
              alignSelf:"flex-start",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <span style={{
                fontFamily:"Pretendard, sans-serif",
                fontWeight: isImminent ? 600 : 500,
                fontSize:10, lineHeight:1.5, color:"#dc1a1a",
                whiteSpace:"nowrap",
              }}>{displayLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
  // ──────────────────────────────────────────────────────────────────────────────

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  // 모바일: visualViewport 실제 가시 높이 기준으로 모달 높이 결정
  // (iOS Safari 주소창/탭바 영역을 정확히 제외)
  const modalMaxH = isMobile
    ? Math.floor(vvHeight * 0.92)   // 가시 영역의 92%
    : "90vh";

  return (
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [Phase A] 16→24 (Figma)
      width:"100%", maxWidth: isMobile ? "100%" : 924, // ← [Phase A] 960→924 (Figma)
      maxHeight: isMobile ? `${Math.floor(vvHeight * 0.95)}px` : modalMaxH,
      height: isMobile ? `${Math.floor(vvHeight * 0.95)}px` : "auto",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column",
      overflow: "hidden",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {/* 모바일 핸들 */}
      {isMobile && <div style={{width:40,height:4,background:"#D1D5DB",borderRadius:2,
        position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",zIndex:10}}/>}

      {/* 예약 생성 로딩 오버레이 — submit 후 250ms 이상 소요 시 표시 */}
      {isSubmitting && (
        <div style={{
          position:"absolute", inset:0, zIndex:500,
          background:"rgba(255,255,255,0.88)",
          backdropFilter:"blur(3px)",
          borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [Phase A] 모달과 동기화
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          gap:16,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:13,fontWeight:600,color:"#111"}}>예약을 생성 중입니다</span>
            <span className="loading-dots">
              <span/><span/><span/>
            </span>
          </div>
        </div>
      )}

      {/* ════ 헤더 (모바일: 일반 / 데스크톱: absolute) ════ */}
      {/* ← [Phase A] 데스크톱은 absolute(top:0)로 본체 위에 떠 있음 + drop-shadow */}
      <div style={{
        padding: isMobile ? "20px 20px 12px" : "16px 20px",
        borderBottom: isMobile ? "1px solid #F1F5F9" : "none", // ← [Phase A] 데스크톱은 boder 제거
        borderRadius: isMobile ? 0 : "24px 24px 0 0", // ← [Phase A] 모달 상단 라운드 매칭
        position: isMobile ? "static" : "absolute", // ← [Phase A] 데스크톱 absolute
        top: isMobile ? "auto" : 0,
        left: isMobile ? "auto" : 0,
        right: isMobile ? "auto" : 0,
        background: "#fff",
        filter: isMobile ? "none" : "drop-shadow(0px 4px 4px #fff)", // ← [Phase A] Figma drop-shadow
        zIndex: 10,
        display:"flex",
        justifyContent:"space-between",
        alignItems: isMobile ? "flex-start" : "center",
        flexShrink:0
      }}>

        {isMobile ? (
          /* 모바일 헤더 — [2026-07-27 모바일 v2] 구 26px 원형 인디케이터 제거.
             순서안내는 Figma(2697:253/2710:1450)대로 바디 첫 요소(StepIndicatorM)로 이동 */
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:600,color:"#111111"}}>{editBooking ? "예약 변경" : "새 회의 예약"}</div>
          </div>
        ) : (
          // ← [Phase A] 데스크톱 타이틀: 18→24, fontWeight 600→500 (Pretendard Medium)
          <div style={{fontSize:20,fontWeight:500,color:"#111",lineHeight:1.5}}>{editBooking ? "예약 변경" : "새 회의실 예약"}</div>
        )}
        {/* ← [피그마 2026-04-22] 헤더 X → ModalCloseButton 공통 컴포넌트 */}
        <ModalCloseButton onClick={onClose} style={{marginLeft:12}} />
      </div>

      {/* ════ 모바일: 2-Step Wizard ════ */}
      {isMobile ? (<>
        {/* Step 바디 — ← [2026-07-27 스크롤 HOTFIX] 표준 드로어 패턴으로 정정.
              · 기존 주석("모달 전체가 스크롤됨")과 달리 실제로는 오버레이·모달 루트(overflow:hidden)·
                바디 어디에도 overflowY가 없어, 콘텐츠가 (95%vv − 헤더 − 푸터)를 넘는 순간
                잘린 영역에 접근 불가였음 (목적 필드 추가로 Step1이 길어지며 표면화된 잠재 결함)
              · 바디만 스크롤(flex:1 + minHeight:0 + overflowY:auto) — 헤더·CTA는 항상 고정 노출
              · overscrollBehavior:contain — iOS 러버밴드가 배경(body) 스크롤로 새는 것 차단 */}
        <div style={{display:"flex",flexDirection:"column",
          flex:1, minHeight:0, overflowY:"auto",
          WebkitOverflowScrolling:"touch", overscrollBehavior:"contain"}}>

          {/* Step 1: 일정 입력 — [2026-07-27 모바일 v2] Figma 2697:251 전면 재구성.
                필드 문법: 라벨 16px Medium #96A0B3 + 필수점, 섹션 구분선 #F6FAFF (MLabel).
                순서안내(StepIndicatorM)는 바디 첫 요소 — 스크롤 영역 포함(Figma 동일) */}
          {step===1 && (
            <div style={{padding:"0 20px 8px",
              display:"flex",flexDirection:"column"}}>
              <StepIndicatorM step={1}/>
              {/* 목적 (Figma 2697:256 — py8/16, 라벨↔칩 gap 16) */}
              <div style={{borderBottom:"1px solid #F6FAFF", padding:"8px 0 16px",
                display:"flex", flexDirection:"column", gap:16}}>
                <MLabel text="목적" required/>
                <PurposeChips
                  variant="mobile"
                  value={form.purpose}
                  detail={form.purposeDetail}
                  onPick={pickPurpose}
                  onDetailChange={v => set("purposeDetail", v)}
                />
              </div>
              {/* 회의 (Figma 2697:287 — py20, boxless 20px, 카운터 10px 우측 하단 정렬)
                    ← [2026-07-27 모바일 v2] 박스형 → boxless 20px. iOS 자동줌 무관(≥16px).
                    auto-grow textarea + Enter=완료(titleKeyDown) + 개행 공백 치환은 기존 그대로.
                    placeholder는 div 오버레이 — bm-boxless CSS가 16px을 강제하므로 native placeholder 불가(20px 필드) */}
              <div style={{borderBottom:"1px solid #F6FAFF", padding:"20px 0",
                display:"flex", flexDirection:"column"}}>
                <MLabel text="회의" required/>
                <div style={{display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:8,
                  paddingTop:16, position:"relative"}}>
                  <textarea ref={titleRef} rows={1} value={form.title}
                    onChange={e=>{ set("title", e.target.value.replace(/\r?\n/g," ")); autoGrowTitle(e.currentTarget) }}
                    placeholder="" aria-label="회의 제목을 입력하세요" maxLength={40}
                    autoComplete="off"
                    enterKeyHint="done" onKeyDown={titleKeyDown}
                    style={{flex:1, minWidth:0, background:"transparent", border:"none", outline:"none", padding:0,
                      fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:20, lineHeight:1.5, color:"#111",
                      resize:"none", overflow:"hidden"}}/>
                  {!form.title && (
                    <div style={{position:"absolute", top:16, left:0, pointerEvents:"none",
                      fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:20, lineHeight:1.5,
                      color:"#D1D7E1", whiteSpace:"nowrap"}}>
                      회의 제목을 입력하세요
                    </div>
                  )}
                  <span style={{flexShrink:0, fontFamily:"Pretendard, sans-serif", fontWeight:500,
                    fontSize:10, lineHeight:1.5,
                    color: form.title.length>=38 ? "#EF4444" : "#D1D9E7"}}>
                    {form.title.length}/40
                  </span>
                </div>
              </div>
              {/* 날짜 (Figma 2697:296 — 값 텍스트 20px Medium #111 + 요일 #99A1AF gap4, 버튼 박스 제거)
                    탭 시 기존 캘린더 팝오버 그대로 (월 이동·셀 로직 무변경) */}
              <div ref={pickerRef} style={{position:"relative",zIndex:200,
                borderBottom:"1px solid #F6FAFF", padding:"20px 0",
                display:"flex", flexDirection:"column", gap:16}}>
                <MLabel text="날짜" required/>
                <div onClick={()=>setShowPicker(v=>!v)}
                  style={{display:"inline-flex", alignItems:"center", gap:4, cursor:"pointer", userSelect:"none",
                    fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:20, lineHeight:1.5}}>
                  <span style={{color:"#111"}}>{fmtDateFull(bookingDate)}</span>
                  <span style={{color:"#99A1AF"}}>{DAY_NAMES[dateToObj(bookingDate).getDay()]}요일</span>
                </div>
                {showPicker && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                        style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                      <span style={{fontSize:13,fontWeight:600,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                      <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                        style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                      {DAY_NAMES.map((n,i)=>(
                        <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:600,
                          color:i===0?"#EF4444":i===6?"#3B82F6":"#94A3B8",padding:"2px 0"}}>{n}</div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                      {calCells.map((day,idx)=>{
                        if(!day) return <div key={`e${idx}`}/>;
                        const ds=`${calYear}-${fmt2(calMonth+1)}-${fmt2(day)}`;
                        const disabled=ds<today||ds>maxDate, isSel=ds===bookingDate, isToday2=ds===today;
                        const dow=(calFirstDay+day-1)%7;
                        return (
                          <div key={day} onClick={()=>!disabled&&selectDate(ds)}
                            style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:13,
                              fontWeight:isSel||isToday2?700:400,
                              background:isSel?"#111111":isToday2?"#EFF6FF":"transparent",
                              color:disabled?"#D1D5DB":isSel?"#fff":isToday2?"#3B82F6":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151",
                              cursor:disabled?"not-allowed":"pointer"}}>
                            {day}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #F1F5F9",fontSize:10,color:"#94A3B8",textAlign:"center"}}>
                      오늘부터 1개월 이내만 선택 가능
                    </div>
                  </div>
                )}
              </div>
              {/* 시간 (Figma 2697:304 — pt24 pb40, 라벨↔시작블록·블록간 gap32, 칩 한 줄 가로 스크롤)
                    ← [2026-07-27 모바일 v2] 아코디언 TimeRangePicker 폐기 → TimeChipRow 시작/종료.
                    옵션 = 기존 tOpts(오늘 지난 슬롯 자동 제외 — 고지 확정 ②)/endOpts 그대로.
                    길이 pill 폐기(확정 ③). noTimeLeft/isAfter7pm 안전망 유지 */}
              <div style={{borderBottom:"1px solid #F6FAFF", padding:"24px 0 40px",
                display:"flex", flexDirection:"column", gap:32}}>
                <MLabel text="시간" required/>
                {isAfter7pm && (
                  <div style={{display:"flex", alignItems:"center", gap:6, padding:"7px 12px", borderRadius:8,
                    background:"#FFF7ED", border:"1px solid #FED7AA"}}>
                    <AlertCircle size={13} strokeWidth={1.8} color="#F97316" style={{flexShrink:0}}/>
                    <span style={{fontSize:11, fontWeight:600, color:"#C2410C"}}>오후 7시 이후에는 예약할 수 없습니다.</span>
                  </div>
                )}
                {noTimeLeft ? (
                  <div style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:16, lineHeight:1.5,
                    color:PLACEHOLDER_COLOR}}>
                    오늘은 더 예약할 수 없습니다<br/>날짜를 변경하세요
                  </div>
                ) : (<>
                  <TimeChipRow label="시작" valueText={fmtTime(form.start)} suffix="부터"
                    options={tOpts} selected={form.start} onPick={pickStartChip}/>
                  <TimeChipRow label="종료" valueText={fmtTime(form.end)} suffix="까지"
                    options={endOpts} selected={form.end} onPick={t=>set("end",t)}/>
                </>)}
              </div>
              {/* 참석자 (Figma 순서: 시간 다음 참석자 — [2026-07-27 모바일 v2] 메모와 순서 교체.
                    입력·드롭다운·칩은 기존 검증된 구조 그대로 — 승인 문서 3항 "라벨만 신규 문법" */}
              <div style={{borderBottom:"1px solid #F6FAFF", padding:"20px 0"}}>
                {AttendeeSection()}
              </div>
              {/* 메모 */}
              <div style={{padding:"20px 0", display:"flex", flexDirection:"column", gap:16}}>
                <MLabel text="메모"/>
                <textarea value={form.memo} onChange={e=>set("memo",e.target.value)} rows={2} placeholder="안건, 준비물 등"
                  style={{width:"100%",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,
                    color:"#111111",padding:"12px 14px",fontSize:16,outline:"none",resize:"none",boxSizing:"border-box"}}  /* ← [2026-07-27 iOS 입력 HOTFIX] 16px 유지. Enter=줄바꿈 */
                  onFocus={e=>e.target.style.borderColor="#111111"}
                  onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
              </div>
              {/* 예약자(대리) — [2026-06-12] 어드민 전용, 생성 시에만.
                    ← [2026-07-27 모바일 v2] 기존 스타일 유지(고지 확정 ①) — 컨테이너 gap 폐기에 따른 간격만 wrapper로 보존 */}
              {isAdmin && !editBooking && <div style={{padding:"20px 0 0"}}>{BookerSection()}</div>}
              {/* 반복 예약 — [2026-05-28] 어드민 전용 재개방 (게이트 isAdmin, 배너/ disabled 제거) */}
              {isAdmin && !editBooking && <div style={{padding:"20px 0 0"}}>{/* ← [2026-05-28] 어드민 전용 · [2026-07-27 모바일 v2] 간격 wrapper */}
                <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6,letterSpacing:"0.4px"}}>반복 예약</label>
                {/* ← [2026-05-28] 점검 중 배너 제거 — 어드민 전용 활성 기능과 모순되므로 삭제 */}
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[
                    {val:"NEVER",      label:"반복 안함",      sub:"단일 예약"},
                    {val:"EVERY_DAY",  label:"매일",           sub:"시작일부터 매일"},
                    {val:"EVERY_WEEK", label:"매주",           sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                  ].map(o=>{
                    // ← [2026-05-28] 어드민 전용 섹션 — 모든 옵션 활성화 (기존: o.val!=="NEVER")
                    const isDisabled = false;
                    return (
                    <button key={o.val} onClick={()=>{ if(!isDisabled) setRecur(o.val); }}
                      disabled={isDisabled}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"11px 14px",borderRadius:10,border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                        background:recur===o.val?"#111":(isDisabled?"#F1F5F9":"#F8FAFC"),
                        cursor:isDisabled?"not-allowed":"pointer",textAlign:"left",transition:"all 0.13s",
                        opacity:isDisabled?0.25:1}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:recur===o.val?"#fff":"#374151"}}>{o.label}</div>
                        <div style={{fontSize:11,color:recur===o.val?"rgba(255,255,255,0.55)":"#94A3B8",marginTop:1}}>{o.sub}</div>
                      </div>
                      {recur===o.val && <CheckCircle2 size={14} strokeWidth={1.8} color="#fff"/>}
                    </button>
                    );
                  })}
                </div>
                {recur!=="NEVER" && (
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
                    {/* 요약 배지 */}
                    <div style={{padding:"8px 12px",background:"#EFF6FF",borderRadius:8,fontSize:12,color:"#2563EB",fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>{bookingDate} ~ {recurPreview.maxStr || ""}</span>
                      <span>
                        <b>{recurPreview.available}건</b> 예약 예정
                        {recurPreview.conflictDates.length > 0 && <span style={{color:"#DC2626",marginLeft:6}}>({recurPreview.conflictDates.length}건 불가)</span>}
                      </span>
                    </div>
                    {/* 충돌 날짜 경고 */}
                    {form.room_id && recurPreview.conflictDates.length > 0 && (
                      <div style={{padding:"8px 12px",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:11,color:"#DC2626"}}>
                        <div style={{fontWeight:600,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.8}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {recurPreview.conflictDates.slice(0,10).map(ds=>(
                            <span key={ds} style={{background:"#FEE2E2",padding:"2px 7px",borderRadius:4,fontWeight:600}}>{ds} ({DAY_NAMES[dateToObj(ds).getDay()]})</span>
                          ))}
                          {recurPreview.conflictDates.length > 10 && <span style={{color:"#EF4444"}}>외 {recurPreview.conflictDates.length - 10}건</span>}
                        </div>
                      </div>
                    )}
                    {/* 회의실 미선택 시 안내 */}
                    {!form.room_id && (
                      <div style={{padding:"7px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:11,color:"#92400E"}}>
                        회의실을 선택하면 날짜별 예약 가능 여부를 미리 확인할 수 있습니다
                      </div>
                    )}
                  </div>
                )}
              </div>}
            </div>
          )}

          {/* Step 2: 회의실 선택 — [2026-07-27 모바일 v2] Figma 2710:1250(선택)/2715:1952(default) 전면 재구성.
                구 요약칩("수정" 버튼)·구 선택확인 카드(#F0FDF4)·"이용 가능 회의실" 헤더 폐기 →
                날짜+시간 요약 / "N개 예약 가능" / 선택 요약 카드(X=해제, 미선택 점선)로 교체.
                Step1 복귀는 CTA "이전". 충돌 경고·RoomGrid2(2)는 유지 */}
          {step===2 && (
            <div style={{padding:"0 20px 8px",
              display:"flex",flexDirection:"column"}}>
              <StepIndicatorM step={2}/>
              {/* 날짜 + 시간 요약 (Figma 2715:1587 — 날짜 20px Regular, 시간 24px Medium "⎯" 18px, 컨테이너 gap4) */}
              <div style={{padding:"8px 0 0", display:"flex", flexDirection:"column", gap:4, flexShrink:0}}>
                <div style={{display:"flex", alignItems:"center", gap:4,
                  fontFamily:"Pretendard, sans-serif", fontWeight:400, fontSize:20, lineHeight:1.5, color:"#111"}}>
                  <span>{fmtDateFull(bookingDate)}</span>
                  <span>{DAY_NAMES[dateToObj(bookingDate).getDay()]}요일</span>
                </div>
                <div style={{display:"flex", alignItems:"center", gap:8, fontFamily:"Pretendard, sans-serif", fontWeight:500}}>
                  <span style={{fontSize:24, lineHeight:1.5, color:"#000"}}>{fmtTime(form.start)}</span>
                  <span style={{fontSize:18, lineHeight:1, color:"#111"}}>⎯</span>
                  <span style={{fontSize:24, lineHeight:1.5, color:"#000"}}>{fmtTime(form.end)}</span>
                </div>
              </div>
              {/* 서브타이틀 + 선택 요약 카드 (Figma 2715:1616 — gap12, 카드 h82 r14) */}
              <div style={{padding:"24px 0 12px", display:"flex", flexDirection:"column", gap:12, flexShrink:0}}>
                <div style={{display:"flex", alignItems:"flex-start", gap:4,
                  fontFamily:"Pretendard, sans-serif", fontSize:20, lineHeight:1.5, whiteSpace:"nowrap"}}>
                  <div style={{display:"flex", alignItems:"center", color:"#000"}}>
                    <span style={{fontWeight:600}}>{availableRooms.length}</span>
                    <span style={{fontWeight:400}}>개 예약 가능</span>
                  </div>
                  <span style={{fontWeight:400, color:"rgba(150,160,179,0.5)"}}>클릭해서 선택</span>
                </div>
                {selectedRoom ? (
                  /* 선택시 (Figma 2715:1605): bg rgba(185,248,207,.2) border #B9F8CF r14 h82 p10, 우측 X 20px = 해제 */
                  <div style={{height:82, boxSizing:"border-box", padding:10, borderRadius:14,
                    border:"1px solid #B9F8CF", background:"rgba(185, 248, 207, 0.2)",
                    display:"flex", alignItems:"flex-start", justifyContent:"space-between"}}>
                    <div style={{display:"flex", flexDirection:"column", gap:4}}>
                      <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:16, lineHeight:1, color:"#111"}}>
                        {selectedRoom.room_name}
                      </span>
                      <div style={{display:"flex", gap:2, alignItems:"center",
                        fontFamily:"Pretendard, sans-serif", fontWeight:400, fontSize:12, lineHeight:1.5, color:"#727B8E"}}>
                        <span>{selectedFloor?.floor_name}</span><span>•</span><span>{selectedRoom.capacity}인</span>
                      </div>
                    </div>
                    <button type="button" onClick={()=>set("room_id",null)} aria-label="회의실 선택 해제"
                      style={{width:20, height:20, padding:0, background:"transparent", border:"none", cursor:"pointer",
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M5.33464 15.0846L4.91797 14.668L9.58464 10.0013L4.91797 5.33464L5.33464 4.91797L10.0013 9.58464L14.668 4.91797L15.0846 5.33464L10.418 10.0013L15.0846 14.668L14.668 15.0846L10.0013 10.418L5.33464 15.0846Z" fill="#1C1B1F"/>
                      </svg>
                    </button>
                  </div>
                ) : (
                  /* default (Figma 2715:2101): bg #fff, dashed rgba(189,197,212,.4) r14 px14 py10 */
                  <div style={{height:82, boxSizing:"border-box", padding:"10px 14px", borderRadius:14,
                    border:"1px dashed rgba(189, 197, 212, 0.4)", background:"#fff",
                    display:"flex", alignItems:"flex-start"}}>
                    <span style={{fontFamily:"Pretendard, sans-serif", fontWeight:500, fontSize:14, lineHeight:1.5,
                      color:"rgba(189, 197, 212, 0.8)", whiteSpace:"nowrap"}}>
                      회의실을 선택하세요
                    </span>
                  </div>
                )}
              </div>
              {/* 충돌 경고 — 선택된 회의실이 불가능한 경우 (기존 안전망 유지) */}
              {form.room_id && validTime && !isSelectedRoomAvailable && (
                <div style={{background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#DC2626",flexShrink:0,marginBottom:12}}>
                  선택한 회의실은 이 시간에 이미 예약이 있습니다. 다른 회의실을 선택해주세요.
                </div>
              )}
              {/* 회의실 그리드 (기존 카드·상태 배지 그대로) */}
              {RoomGrid2(2)}
            </div>
          )}
        </div>

        {/* ── 모바일 CTA 버튼 — 스크롤 영역 맨 아래 (fixed 없음) ── */}
        <div style={{
          padding:"16px 20px 32px",
          borderTop:"1px solid #F1F5F9",
          display:"flex",gap:8,background:"#fff",marginTop:"auto"}}>
          {step===1 ? (<>
            <Button variant="ghost"   flex onClick={onClose}>취소</Button>
            <Button variant="primary" flex onClick={()=>setStep(2)} disabled={!canGoStep2}>다음 → 회의실 선택</Button>
          </>) : (<>
            {isApprovalRoom && (
              <div style={{width:"100%",marginBottom:8,padding:"10px 14px",borderRadius:10,
                background:"#FEF3C7",border:"1px solid #FCD34D",fontSize:12,color:"#92400E",
                display:"flex",alignItems:"center",gap:8}}>
                관리자 승인 후 예약이 확정됩니다. 에메랄드 룸은 사전 승인이 필요합니다.
              </div>
            )}
            <Button variant="ghost"   flex onClick={()=>setStep(1)} style={{minHeight:52}}>← 이전</Button>
            <Button variant="primary" flex disabled={!canSubmit} loading={isSubmitting} style={{minHeight:52}}
              onClick={async ()=>{
                if(!canSubmit)return;
                submitTimerRef.current = setTimeout(()=>setIsSubmitting(true), 250);
                try {
                  editBooking ? await onUpdate({...form},bookingDate) : await onSubmit({...form, recur: isAdmin ? recur : "NEVER"},bookingDate) /* ← [2026-05-28] 어드민만 실제 recur 전달, 비어드민은 NEVER 강제(이중 방어) */;
                } finally {
                  if(submitTimerRef.current) clearTimeout(submitTimerRef.current);
                  setIsSubmitting(false);
                }
              }}>
              {/* ← [2026-07-27 모바일 v2] "예약 확정" → "예약완료" (Figma 2710:1570). 변경/승인 분기 유지 */}
              {editBooking ? "변경 저장" : isApprovalRoom ? "승인 요청" : "예약완료"}
            </Button>
          </>)}
        </div>
      </>) : (

      /* ════ 데스크톱: 이미지 기반 리디자인 ════ */
      // ← [Phase A] padding 60px 0: 헤더/푸터 absolute 영역 확보 (Figma py-[60px])
      <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden",padding:"60px 0"}}>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* LEFT: 폼 (50%) */}
          {/* ← [Phase B] padding 24/28 → 16/16/100/16 (Figma) */}
          {/* ← [Phase E] gap: 18 → 0 (Field 자체 padding 16 0 + border-bottom이 간격/구분선 담당) */}
          <div style={{flex:1,padding:"16px 16px 100px 16px",borderRight:"1px solid #f1f5f9",
            display:"flex",flexDirection:"column",gap:0,overflowY:"auto"}}>
            {/* 목적 — [2026-07-27 목적] 회의 목적 카테고리 (Figma 2688:1081 field 2, 회의 필드 위) */}
            <Field label="목적" required>
              <PurposeChips
                variant="desktop"
                value={form.purpose}
                detail={form.purposeDetail}
                onPick={pickPurpose}
                onDetailChange={v => set("purposeDetail", v)}
              />
            </Field>
            {/* 회의 제목 — [Phase C] Field 적용, boxless input + 우측 카운터 0/40 (Figma 302:5368-5376) */}
            {/*   ← [Phase G 보충 7] native placeholder 제거 → div 오버레이 (브라우저 확장/글로벌 CSS 무관) */}
            <Field label="회의" required>
              <div style={{
                display:"flex",
                alignItems:"flex-end",
                justifyContent:"space-between",
                width:"100%",
                gap:8,
                position:"relative", // ← [Phase G 보충 7] div 오버레이 기준
              }}>
                {/* ← [2026-07-27 제목 자동줄바꿈] input → auto-grow textarea (bm-boxless placeholder CSS는
                      textarea.bm-boxless 셀렉터가 이미 있어 호환 — index.css L506 확인) */}
                <textarea
                  ref={titleRef} rows={1}
                  className="bm-boxless"
                  value={form.title}
                  onChange={e=>{ set("title", e.target.value.replace(/\r?\n/g," ")); autoGrowTitle(e.currentTarget) }}
                  placeholder="" // ← [Phase G 보충 7] native placeholder 제거 — div 오버레이로 대체
                  aria-label="회의 제목을 입력하세요"
                  maxLength={40}
                  autoComplete="off"
                  onKeyDown={titleKeyDown}
                  style={{
                    flex:1, minWidth:0,
                    background:"transparent",
                    border:"none",
                    outline:"none",
                    padding:0,
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:16,
                    lineHeight:1.5,
                    color:"#111",
                    resize:"none",
                    overflow:"hidden",
                  }}
                />
                {/* ← [Phase G 보충 7] placeholder 오버레이 (value 없을 때만 표시) */}
                {!form.title && (
                  <div style={{
                    position:"absolute",
                    top:0, left:0,
                    pointerEvents:"none",
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:16,
                    lineHeight:1.5,
                    color:PLACEHOLDER_COLOR,
                    whiteSpace:"nowrap",
                  }}>
                    회의 제목을 입력하세요
                  </div>
                )}
                <span style={{
                  flexShrink:0,
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500,
                  fontSize:10,
                  lineHeight:1.5,
                  color: form.title.length>=38 ? "#EF4444" : "#d1d9e7",
                }}>
                  {form.title.length}/40
                </span>
              </div>
            </Field>
            {/* 날짜 — [Phase C] Field 적용, 버튼 → 텍스트 trigger ("YYYY년 M월 D일 X요일") */}
            {/*   캘린더 popover 자체는 그대로 (월 이동, 셀 로직 변경 없음) */}
            <Field label="날짜" required>
              <div ref={pickerRef2} style={{position:"relative", width:"100%"}}>
                <div
                  onClick={()=>setShowPicker(v=>!v)}
                  style={{
                    display:"inline-flex",
                    alignItems:"center",
                    gap:4,
                    cursor:"pointer",
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:16,
                    lineHeight:1.5,
                    color:"#111",
                    userSelect:"none",
                  }}
                >
                  <span>{fmtDateFull(bookingDate)}</span>
                  <span>{DAY_NAMES[dateToObj(bookingDate).getDay()]}요일</span>
                </div>
                {showPicker && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                        style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                      <span style={{fontSize:13,fontWeight:600,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                      <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                        style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                      {DAY_NAMES.map((n,i)=>(
                        <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:600,
                          color:i===0?"#EF4444":i===6?"#3B82F6":"#94A3B8",padding:"2px 0"}}>{n}</div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                      {calCells.map((day,idx)=>{
                        if(!day) return <div key={`e${idx}`}/>;
                        const ds=`${calYear}-${fmt2(calMonth+1)}-${fmt2(day)}`;
                        const disabled=ds<today||ds>maxDate, isSel=ds===bookingDate, isToday2=ds===today;
                        const dow=(calFirstDay+day-1)%7;
                        return (
                          <div key={day} onClick={()=>!disabled&&selectDate(ds)}
                            style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:13,
                              fontWeight:isSel||isToday2?700:400,
                              background:isSel?"#111111":isToday2?"#EFF6FF":"transparent",
                              color:disabled?"#D1D5DB":isSel?"#fff":isToday2?"#3B82F6":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151",
                              cursor:disabled?"not-allowed":"pointer"}}>
                            {day}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #F1F5F9",fontSize:10,color:"#94A3B8",textAlign:"center"}}>
                      오늘부터 1개월 이내만 선택 가능
                    </div>
                  </div>
                )}
              </div>
            </Field>
            {/* 시간 — [Phase G 보충 14/15 2026-04-27] 사용자 정정 Figma 기준 매칭 */}
            {/*   가능 상태 (Figma 337:1245): 외곽 gap 14 / 고정폭 제거 / 시간 row gap 24 / "부터·까지" 라벨 환원 / ⎯ 구분자 제거 / 그룹 외곽 gap 24 / 텍스트 wrap gap 4 */}
            {/*   미선택 상태 (Figma 331:1223 / 보충 15): w 240 / boxless 2줄 placeholder / Pretendard Medium 16 lh 1.5 PLACEHOLDER_COLOR */}
            {/*   down arrow: 사용자 제공 arrow_svg.svg 인라인 유지 (Figma 337:1272/1279) */}
            {/*   native select absolute(opacity:0) 트릭 / onChange 핸들러 / 시간 판단 로직 일체 불변 */}
            <Field label="시간" required>
              {noTimeLeft ? (
                /* 불가 상태 (시간필드 미선택 시) — [Phase G 보충 15 2026-04-27] Figma 331:1223 정정 매칭 */
                /*   사유: 보충 14 에서 신 Figma 미정의로 판단해 원본(Ban+박스)으로 되돌렸으나, */
                /*         사용자가 331:1223 가 미선택 상태의 정확한 디자인임을 명시 → 보충 13 동일 디자인 환원 */
                /*   Figma 331:1229: w 240 / h 60 / gap 10 / flex-col items-start */
                /*   Figma 331:1230: Pretendard Medium 16 / lh 1.5 / rgba(189,197,212,0.8) (= PLACEHOLDER_COLOR) */
                /*   2줄: "오늘은 더 예약할 수 없습니다" / "날짜를 변경하세요" */
                <div style={{
                  display:"flex", flexDirection:"column",
                  width:240, // ← [Phase G 보충 15] Figma 331:1229 w-[240px]
                }}>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500, fontSize:16, lineHeight:1.5,
                    color:PLACEHOLDER_COLOR, // ← [Phase G 보충 15] Figma 331:1230 rgba(189,197,212,0.8) = PLACEHOLDER_COLOR
                    whiteSpace:"nowrap",
                  }}>오늘은 더 예약할 수 없습니다</span>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500, fontSize:16, lineHeight:1.5,
                    color:PLACEHOLDER_COLOR,
                    whiteSpace:"nowrap",
                  }}>날짜를 변경하세요</span> {/* ← [Phase G 보충 15] 2번째 줄 (Figma 331:1230) */}
                </div>
              ) : (
                /* 가능 상태 — Figma 337:1245 / 337:1251 */
                <div style={{
                  display:"flex", flexDirection:"column",
                  gap:14, // ← [Phase G 보충 14] Figma 337:1251 gap-[14px] (보충 13 동일값 유지)
                  // ← [Phase G 보충 14] width:240 제거 — Figma 337:1251 에 명시적 width 없음 (콘텐츠에 의한 auto)
                }}>
                  {isAfter7pm && (
                    /* 19:00 이후 — 기존 경고 유지 (Figma 미정의 케이스 / 안전망) */
                    <span style={{fontSize:11,fontWeight:600,color:"#C2410C",display:"flex",alignItems:"center",gap:4}}>
                      <AlertCircle size={11} strokeWidth={1.8} color="#F97316"/>
                      오후 7시 이후에는 예약할 수 없습니다.
                    </span>
                  )}
                  {/* 시간 선택 행 — [Phase G 보충 14] Figma 337:1267 1:1 매칭: gap 24 / items-center / ⎯ 구분자 없음 */}
                  <div style={{
                    display:"flex", alignItems:"center",
                    gap:24, // ← [Phase G 보충 14] justify-between → gap:24 (Figma 337:1267 gap-[24px])
                    // ← [Phase G 보충 14] width:"100%" 제거, ⎯ 구분자 제거 (Figma 337:1267 에 ⎯ 없음)
                  }}>
                    {/* 시작 그룹 — Figma 337:1268: gap 24 / items-center / 텍스트 wrap + arrow */}
                    <div style={{
                      position:"relative", display:"inline-flex", alignItems:"center",
                      gap:24, // ← [Phase G 보충 14] gap:8 → gap:24 (Figma 337:1268 gap-[24px])
                      cursor:"pointer",
                    }}>
                      {/* 텍스트 wrap — Figma 337:1269: gap 4 / items-center / 시간 + "부터" */}
                      <div style={{display:"inline-flex", alignItems:"center", gap:4}}>
                        <span style={{
                          fontFamily:"Pretendard, sans-serif",
                          fontWeight:500, fontSize:16, lineHeight:1, color:"#111",
                          whiteSpace:"nowrap",
                        }}>
                          {fmtTime(form.start)}
                        </span>
                        {/* ← [Phase G 보충 14] "부터" span 환원 (Figma 337:1271 / rgba(189,197,212,0.8) = PLACEHOLDER_COLOR) */}
                        <span style={{
                          fontFamily:"Pretendard, sans-serif",
                          fontWeight:500, fontSize:16, lineHeight:1,
                          color:PLACEHOLDER_COLOR,
                          whiteSpace:"nowrap",
                        }}>부터</span>
                      </div>
                      {/* down arrow — 사용자 제공 arrow_svg.svg 인라인 (Figma 337:1272 / fill #1C1B1F) — 보충 13 유지 */}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M7.99961 9.66693L4.59961 6.26693L4.93294 5.93359L7.99961 9.00026L11.0663 5.93359L11.3996 6.26693L7.99961 9.66693Z" fill="#1C1B1F"/>
                      </svg>
                      <select value={form.start} onChange={e=>{
                          set("start",e.target.value);
                          const newEnd=timeToMin(e.target.value)+15; // ← [2026-04-26] 60→15: 데스크톱 select 시작 변경 시 기본 15분
                          const clamped=Math.min(newEnd,19*60);
                          set("end",`${fmt2(Math.floor(clamped/60))}:${fmt2(clamped%60)}`);
                        }}
                        style={{
                          position:"absolute", inset:0,
                          opacity:0, cursor:"pointer",
                          width:"100%", height:"100%",
                          border:"none", outline:"none", padding:0,
                          fontFamily:"inherit",
                        }}>
                        {tOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                    {/* ← [Phase G 보충 14] ⎯ 구분자 span 제거 (Figma 337:1267 에 없음) */}
                    {/* 종료 그룹 — Figma 337:1275: gap 24 / items-center / 텍스트 wrap + arrow */}
                    <div style={{
                      position:"relative", display:"inline-flex", alignItems:"center",
                      gap:24, // ← [Phase G 보충 14] gap:8 → gap:24 (Figma 337:1275 gap-[24px])
                      cursor:"pointer",
                    }}>
                      {/* 텍스트 wrap — Figma 337:1276: gap 4 / items-center / 시간 + "까지" */}
                      <div style={{display:"inline-flex", alignItems:"center", gap:4}}>
                        <span style={{
                          fontFamily:"Pretendard, sans-serif",
                          fontWeight:500, fontSize:16, lineHeight:1, color:"#111",
                          whiteSpace:"nowrap",
                        }}>
                          {fmtTime(form.end)}
                        </span>
                        {/* ← [Phase G 보충 14] "까지" span 환원 (Figma 337:1278 / rgba(189,197,212,0.8) = PLACEHOLDER_COLOR) */}
                        <span style={{
                          fontFamily:"Pretendard, sans-serif",
                          fontWeight:500, fontSize:16, lineHeight:1,
                          color:PLACEHOLDER_COLOR,
                          whiteSpace:"nowrap",
                        }}>까지</span>
                      </div>
                      {/* down arrow — 사용자 제공 arrow_svg.svg 인라인 (Figma 337:1279 / fill #1C1B1F) — 보충 13 유지 */}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M7.99961 9.66693L4.59961 6.26693L4.93294 5.93359L7.99961 9.00026L11.0663 5.93359L11.3996 6.26693L7.99961 9.66693Z" fill="#1C1B1F"/>
                      </svg>
                      <select value={form.end} onChange={e=>set("end",e.target.value)}
                        style={{
                          position:"absolute", inset:0,
                          opacity:0, cursor:"pointer",
                          width:"100%", height:"100%",
                          border:"none", outline:"none", padding:0,
                          fontFamily:"inherit",
                        }}>
                        {endOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* 동적 "N분 사용" 배지 — Figma 337:1265 (h26 / r6 / bg #edf8ff / 12px Regular #111) */}
                  {validTime && (
                    <div style={{
                      width:"100%",
                      height:26,
                      padding:"16px 4px", // ← [2026-04-28 Phase G 보충 18] 4 → "16px 4px" (상하 16 / 좌우 4)
                      borderRadius:6,
                      background:"#edf8ff",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      boxSizing:"border-box",
                    }}>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:400, fontSize:12, lineHeight:1.5, color:"#111",
                      }}>
                        {(() => {
                          // ← [Phase C] 동적 N분 사용 표기 (예: "15분 사용", "1시간 사용", "1시간 30분 사용")
                          const h = Math.floor(durMin / 60);
                          const m = durMin % 60;
                          const parts: string[] = [];
                          if (h > 0) parts.push(`${h}시간`);
                          if (m > 0) parts.push(`${m}분`);
                          return `${parts.join(" ")} 사용`;
                        })()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Field>
            {/* 회의실 — [Phase G 보충 12 2026-04-27] Figma 329:1043(빈) / 329:981(선택) 1:1 매칭 */}
            {/*   빈 상태 (Figma 329:1043): 점선 박스 (#dee5f1) + "오른쪽에서 회의실을 선택해 주세요." (14px / #b4bcca) */}
            {/*   선택 상태 (Figma 329:981): 연두 박스 (#b9f8cf) + 회의실명 16px / #111 + 부가정보 + close SVG */}
            {/*   close 아이콘: 사용자 제공 close_svg.svg 인라인 적용 (path fill #1C1B1F) */}
            <Field label="회의실" required> {/* ← [Phase G 보충 12] paddingBottom={32} 제거 (Figma 329:981 py-[16px]) */}
              {selectedRoom ? (
                /* 선택 상태 — Figma 329:981 */
                <div style={{
                  width:"100%",
                  height:82, // ← [Phase G 보충 12] 69 → 82 (Figma 329:988)
                  padding:10,
                  borderRadius:14, // ← [Phase G 보충 12] 10 → 14 (Figma 329:988)
                  border:"1px solid #d3fae1", // ← [Phase G 보충 16] #b9f8cf → #d3fae1 (Figma 329:988 신 border 색상)
                  background:"rgba(185, 248, 207, 0.2)",
                  display:"flex",
                  justifyContent:"space-between",
                  alignItems:"flex-start",
                  boxSizing:"border-box",
                }}>
                  {/* 좌측: 회의실명 + 부가정보 */}
                  <div style={{display:"flex", flexDirection:"column", gap:4}}>
                    <span style={{
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:500, fontSize:16, lineHeight:1, color:"#111", // ← [Phase G 보충 12] fontSize 14 → 16 (Figma 329:990)
                    }}>
                      {selectedRoom.room_name}
                    </span>
                    <div style={{display:"flex", gap:2, alignItems:"center"}}>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:400, fontSize:12, lineHeight:1.5, color:"#979fb1",
                      }}>{selectedFloor?.floor_name}</span>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:400, fontSize:12, lineHeight:1.5, color:"#979fb1",
                      }}>•</span>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:400, fontSize:12, lineHeight:1.5, color:"#979fb1",
                      }}>{selectedRoom.capacity}인</span>
                    </div>
                  </div>
                  {/* 우측: close 아이콘 20px (해제) — [Phase G 보충 12] 사용자 제공 SVG 인라인 */}
                  <button
                    type="button"
                    onClick={()=>set("room_id", null)}
                    aria-label="회의실 선택 해제"
                    style={{
                      width:20, height:20,
                      padding:0, background:"transparent", border:"none",
                      cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      flexShrink:0,
                    }}
                  >
                    {/* ← [Phase G 보충 12] lucide X → 사용자 제공 close_svg.svg 인라인 (path fill #1C1B1F) */}
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M5.33464 15.0846L4.91797 14.668L9.58464 10.0013L4.91797 5.33464L5.33464 4.91797L10.0013 9.58464L14.668 4.91797L15.0846 5.33464L10.418 10.0013L15.0846 14.668L14.668 15.0846L10.0013 10.418L5.33464 15.0846Z" fill="#1C1B1F"/>
                    </svg>
                  </button>
                </div>
              ) : (
                /* 빈 상태 — Figma 329:1043 — [Phase G 보충 14/16 2026-04-27] 색상 (보충 14) + 텍스트 (보충 16) 정정 */
                /*   사이즈: w 100% / h 82 / radius 14 / border 1px dashed rgba(189,197,212,0.4) / bg #ffffff / padding 10px 14px */
                /*   placeholder 텍스트: "오른쪽에서 회의실을 선택하세요" (Figma 329:1050 신 문구 — 보충 16 정정) */
                /*   placeholder 폰트: Pretendard Medium 14px / rgba(189,197,212,0.8) (= PLACEHOLDER_COLOR) / lh 1.5 */
                <div style={{
                  width:"100%",
                  height:82,
                  padding:"10px 14px",
                  border:"1px dashed rgba(189, 197, 212, 0.4)", // ← [Phase G 보충 14] #dee5f1 → rgba(189,197,212,0.4) (Figma 329:1049)
                  borderRadius:14,
                  background:"#ffffff",
                  boxSizing:"border-box",
                  display:"flex",
                  alignItems:"flex-start",
                }}>
                  <span style={{
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:14,
                    lineHeight:1.5,
                    color:PLACEHOLDER_COLOR, // ← [Phase G 보충 14] #b4bcca → PLACEHOLDER_COLOR = rgba(189,197,212,0.8) (Figma 329:1050)
                    whiteSpace:"nowrap",
                  }}>
                    오른쪽에서 회의실을 선택하세요{/* ← [Phase G 보충 16] "선택해 주세요." → "선택하세요" (Figma 329:1050 신 문구, 마침표/주 제거) */}
                  </span>
                </div>
              )}
            </Field>
            {/* 참석자 — [Phase E] Field 적용 (선택 입력 — 빨간 점 없음) */}
            {/*   chip: AttendeeChip 컴포넌트 사용 안 함 (DetailModal/BookingDoneModal와 공유라 부작용 방지) → inline */}
            {/*   검색 인풋: boxless border-bottom + 드롭다운 카드형 */}
            <Field label="참석자">
              <div style={{display:"flex", flexDirection:"column", gap:16}}>
                {/* 참석자 chip 영역 (Figma 299:3726) — flex-wrap gap:8 */}
                {form.attendees.length > 0 && (
                  <div style={{display:"flex", flexWrap:"wrap", gap:8}}>
                    {form.attendees.map(a => (
                      <div key={a.user_id} style={{
                        display:"inline-flex",
                        alignItems:"center",
                        gap:7,
                        background:"#edf7ff",
                        padding:"2px 4px 2px 2px",
                        borderRadius:1000,
                      }}>
                        <UserAvatar name={a.name} avatarUrl={a.avatar_url ?? null} size={24} />
                        <span style={{
                          fontFamily:"Pretendard, sans-serif",
                          fontWeight:500,
                          fontSize:14,
                          lineHeight:1.3,
                          color:"#111",
                        }}>{a.name}</span>
                        <button
                          type="button"
                          onClick={()=>removeAttendee(a.user_id)}
                          aria-label={`${a.name} 제거`}
                          style={{
                            width:16, height:16, padding:0,
                            background:"transparent", border:"none", cursor:"pointer",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            flexShrink:0,
                          }}
                        >
                          {/* ← [Phase G 보충 17 2026-04-27] lucide X → 사용자 제공 attendeechipX.svg 인라인 (Figma 331:1238 / fill #1C1B1F) */}
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M4.26693 12.0669L3.93359 11.7336L7.66693 8.00026L3.93359 4.26693L4.26693 3.93359L8.00026 7.66693L11.7336 3.93359L12.0669 4.26693L8.33359 8.00026L12.0669 11.7336L11.7336 12.0669L8.00026 8.33359L4.26693 12.0669Z" fill="#1C1B1F"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 검색 인풋 + 드롭다운 (Figma 308:340 입력 / 308:329 기본) */}
                <div ref={attendeeRef} style={{position:"relative", width:"100%"}}>
                  {/* boxless 검색 인풋 — [Phase G 보충 2 2026-04-27] 밑줄 토글 */}
                  {/*   기본(빈+blur): 투명 밑줄 (시각적으로 숨김, 레이아웃 height 유지) */}
                  {/*   focus 또는 입력값 있음: 검정 1px 밑줄 표시 */}
                  {/*   ← [Phase G 보충 7 2026-04-27] native placeholder 제거 → div 오버레이 */}
                  <input
                    value={attendeeQ}
                    onChange={e=>{setAttendeeQ(e.target.value);setAttendeeFocus(true);}}
                    onFocus={()=>setAttendeeFocus(true)}
                    onKeyDown={onAttendeeKeyDown}/* ← [핫픽스 v14] ↓/↑/Enter/Esc 키보드 네비게이션 */
                    placeholder="" // ← [Phase G 보충 7] native placeholder 제거 — div 오버레이로 대체
                    aria-label="팀즈에 등록된 이름으로 검색하세요"
                    className="bm-boxless"
                    style={{
                      width:"100%",
                      height:36,
                      paddingBottom:12,
                      paddingTop:0, paddingLeft:0, paddingRight:0,
                      background:"transparent",
                      border:"none",
                      borderBottom: (attendeeFocus || attendeeQ.length > 0)
                        ? "1px solid #000"
                        : "1px solid transparent", // ← 빈 상태에서 밑줄 숨김 (height 유지)
                      borderRadius: 0, // ← [Phase G 보충 4 2026-04-27] 글로벌/브라우저 기본 border-radius 강제 0 (border-bottom 직선)
                      outline:"none",
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:500,
                      fontSize:16,
                      lineHeight:1.5,
                      color:"#000", // ← [Phase G 보충 5 2026-04-27] Figma 299:3765 text-black 매칭 (#111 → #000)
                      boxSizing:"border-box",
                      transition:"border-bottom-color 0.15s ease",
                    }}
                  />
                  {/* ← [Phase G 보충 7] placeholder 오버레이 (value 없을 때만 표시) */}
                  {!attendeeQ && (
                    <div style={{
                      position:"absolute",
                      top:0, left:0,
                      pointerEvents:"none",
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:500,
                      fontSize:16,
                      lineHeight:1.5,
                      color:PLACEHOLDER_COLOR,
                      whiteSpace:"nowrap",
                    }}>
                      팀즈에 등록된 이름으로 검색하세요
                    </div>
                  )}
                  {/* 드롭다운 — 검색 결과 (Figma 299:3766) */}
                  {attendeeFocus && attendeeSuggestions.length > 0 && (
                    <div style={{
                      position:"absolute",
                      top:"calc(100% + 4px)",
                      left:0, right:0, zIndex:400,
                      background:"#fff",
                      border:"0.5px solid #dee5f1",
                      borderRadius:14,
                      padding:10,
                      display:"flex", flexDirection:"column", gap:10,
                      boxShadow:"0 8px 24px rgba(0,0,0,0.06)",
                    }}>
                      {attendeeSuggestions.map((u, idx) => (
                        <div key={u.user_id} onClick={()=>addAttendee(u)}
                          onMouseEnter={()=>setAttendeeHighlight(idx)/* ← [핫픽스 v14] 마우스 hover로 인덱스 동기화 */}
                          style={{
                            display:"flex",
                            alignItems:"center",
                            justifyContent:"space-between",
                            padding:"4px 10px 4px 2px",
                            borderRadius:8,
                            cursor:"pointer",
                            background: attendeeHighlight === idx ? "#F8FAFC" : "transparent",/* ← [핫픽스 v14] 하이라이트 */
                          }}>
                          {/* 좌측: 아바타 32 + 이름 + 이메일 */}
                          <div style={{display:"flex", alignItems:"center", gap:7}}>
                            <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={32} />
                            <div style={{display:"flex", alignItems:"center", gap:4}}>
                              <span style={{
                                fontFamily:"Pretendard, sans-serif",
                                fontWeight:500, fontSize:14, lineHeight:1.3, color:"#111",
                              }}>{u.name}</span>
                              <span style={{
                                fontFamily:"Pretendard, sans-serif",
                                fontWeight:400, fontSize:10, lineHeight:1.3, color:"#99a1af",
                              }}>{u.email}</span>
                            </div>
                          </div>
                          {/* 우측: + 추가 */}
                          <span style={{
                            fontFamily:"Pretendard, sans-serif",
                            fontWeight:400, fontSize:10, lineHeight:1.3, color:"#7088ac",
                            flexShrink:0,
                          }}>+ 추가</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 검색 중 */}
                  {attendeeFocus && attendeeQ.trim().length > 0 && isSearching && (
                    <div style={{
                      position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:400,
                      background:"#fff", border:"0.5px solid #dee5f1", borderRadius:14,
                      padding:"12px 14px",
                      fontFamily:"Pretendard, sans-serif", fontSize:12, color:"#94A3B8",
                      boxShadow:"0 8px 24px rgba(0,0,0,0.06)",
                    }}>
                      검색 중...
                    </div>
                  )}
                  {/* 검색 결과 없음 */}
                  {attendeeFocus && attendeeQ.trim().length > 0 && !isSearching && searchedQuery === attendeeQ.trim() && attendeeSuggestions.length === 0 && (
                    <div style={{
                      position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:400,
                      background:"#fff", border:"0.5px solid #dee5f1", borderRadius:14,
                      padding:"12px 14px",
                      fontFamily:"Pretendard, sans-serif", fontSize:12, color:"#94A3B8",
                      boxShadow:"0 8px 24px rgba(0,0,0,0.06)",
                    }}>
                      검색 결과가 없습니다
                    </div>
                  )}
                </div>
              </div>
            </Field>
            {/* 메모 — [Phase E] Field 적용 (선택 입력 — 빨간 점 없음), boxless textarea + 카운터 0/100 */}
            {/*   placeholder "안건, 준비물 등" → "회의상세" (Figma 매칭) */}
            {/*   maxLength=100 적용 [Phase E 보충 2026-04-26] — 사용자 명시 승인, 엔터(줄바꿈) 사용 가능 */}
            {/*   ← [Phase G 2026-04-26] Field height 120px 적용 (Figma 302:5473) */}
            <Field label="메모" height={120}>
              <div style={{
                display:"flex",
                alignItems:"flex-start",
                justifyContent:"space-between",
                width:"100%",
                gap:8,
                minHeight:72,
                position:"relative", // ← [Phase G 보충 7] div 오버레이 기준
              }}>
                <textarea
                  className="bm-boxless"
                  value={form.memo}
                  onChange={e=>set("memo", e.target.value)}
                  rows={3}
                  maxLength={100}
                  placeholder="" // ← [Phase G 보충 7] native placeholder 제거 — div 오버레이로 대체
                  aria-label="회의상세"
                  style={{
                    flex:1, minWidth:0,
                    background:"transparent",
                    border:"none",
                    outline:"none",
                    padding:0,
                    resize:"none",
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:16,
                    lineHeight:1.5,
                    color:"#111",
                    minHeight:72,
                  }}
                />
                {/* ← [Phase G 보충 7] placeholder 오버레이 (value 없을 때만 표시) */}
                {!form.memo && (
                  <div style={{
                    position:"absolute",
                    top:0, left:0,
                    pointerEvents:"none",
                    fontFamily:"Pretendard, sans-serif",
                    fontWeight:500,
                    fontSize:16,
                    lineHeight:1.5,
                    color:PLACEHOLDER_COLOR,
                    whiteSpace:"nowrap",
                  }}>
                    회의상세
                  </div>
                )}
                <span style={{
                  flexShrink:0,
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:500,
                  fontSize:10,
                  lineHeight:1.5,
                  color: form.memo.length > 100 ? "#EF4444" : "#d1d9e7",
                }}>
                  {form.memo.length}/100
                </span>
              </div>
            </Field>
            {/* 예약자(대리) — [2026-06-12] 어드민 전용, 생성 시에만 */}
            {isAdmin && !editBooking && BookerSection()}
            {/* 반복 예약 — [2026-05-28] 어드민 전용 재개방 (false 게이트 제거 → isAdmin) */}
            {isAdmin && !editBooking && <div>{/* ← [2026-05-28] `false &&` → `isAdmin &&`: 어드민만 섹션 노출 */}
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>반복 예약</label>
              {/* ← [2026-05-28] 점검 중 배너 제거 — 어드민 전용 활성 기능과 모순되므로 삭제 */}
              <div style={{display:"flex",gap:8}}>
                {[
                  {val:"NEVER",      label:"반복 안함", sub:"단일"},
                  // ← [2026-05-28] '시작일~1달' → '올해 말까지' (정책 일치)
                  {val:"EVERY_DAY",  label:"매일",      sub:"올해 말까지"},
                  {val:"EVERY_WEEK", label:"매주",      sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                ].map(o=>{
                  // ← [2026-05-28] 어드민 전용 섹션 — 모든 옵션 활성화 (기존: o.val!=="NEVER")
                  const isDisabled = false;
                  return (
                  <button key={o.val} onClick={()=>{ if(!isDisabled) setRecur(o.val); }}
                    disabled={isDisabled}
                    style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      padding:"12px 8px",borderRadius:10,
                      border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                      background:recur===o.val?"#111":(isDisabled?"#F1F5F9":"#F8FAFC"),
                      cursor:isDisabled?"not-allowed":"pointer",transition:"all 0.13s",
                      opacity:isDisabled?0.25:1}}>
                    <span style={{fontSize:13,fontWeight:600,color:recur===o.val?"#fff":"#374151"}}>{o.label}</span>
                    <span style={{fontSize:10,color:recur===o.val?"rgba(255,255,255,0.5)":"#94A3B8",textAlign:"center"}}>{o.sub}</span>
                  </button>
                  );
                })}
              </div>
              {recur!=="NEVER" && (
                <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
                  {/* 요약 배지 */}
                  <div style={{padding:"8px 12px",background:"#EFF6FF",borderRadius:8,fontSize:12,color:"#2563EB",fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span>{bookingDate} ~ {recurPreview.maxStr || ""}</span>
                    <span>
                      <b>{recurPreview.available}건</b> 예약 예정
                      {recurPreview.conflictDates.length > 0 && <span style={{color:"#DC2626",marginLeft:6}}>({recurPreview.conflictDates.length}건 불가)</span>}
                    </span>
                  </div>
                  {/* 충돌 날짜 경고 */}
                  {form.room_id && recurPreview.conflictDates.length > 0 && (
                    <div style={{padding:"8px 12px",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:11,color:"#DC2626"}}>
                      <div style={{fontWeight:600,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.8}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {recurPreview.conflictDates.slice(0,10).map(ds=>(
                          <span key={ds} style={{background:"#FEE2E2",padding:"2px 7px",borderRadius:4,fontWeight:600}}>{ds} ({DAY_NAMES[dateToObj(ds).getDay()]})</span>
                        ))}
                        {recurPreview.conflictDates.length > 10 && <span style={{color:"#EF4444"}}>외 {recurPreview.conflictDates.length - 10}건</span>}
                      </div>
                    </div>
                  )}
                  {/* 회의실 미선택 시 안내 */}
                  {!form.room_id && (
                    <div style={{padding:"7px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:11,color:"#92400E"}}>
                      회의실을 선택하면 날짜별 예약 가능 여부를 미리 확인할 수 있습니다
                    </div>
                  )}
                </div>
              )}
            </div>}
          </div>

          {/* RIGHT: 회의실 패널 (50%) — [Phase F] padding 24/28 → 16, gap 16 → 24 */}
          <div style={{flex:1,padding:16,overflowY:"auto",display:"flex",flexDirection:"column",gap:24}}>
            {/* ← [Phase F] 우측 헤더 — Figma 매칭 */}
            {/*   시간: 18px SemiBold + ⎯ + 18px SemiBold (gap 8) */}
            {/*   서브: "{N}" SemiBold #111 + "개 예약 가능" Regular #96a0b3 + "클릭해서 선택" Regular rgba(150,160,179,0.5) */}
            <div style={{display:"flex", flexDirection:"column", gap:4}}>
              {/* ← [2026-04-29] noTimeLeft 우선 분기 추가 — validTime이 true여도 예약 불가 시간대면 안내 표시 */}
              {noTimeLeft ? (
                <div style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:600, fontSize:18, lineHeight:1.5, color:"#CBD5E1",
                }}>시간을 선택하세요</div>
              ) : validTime ? (
                <>
                  {/* 시간 행 */}
                  <div style={{display:"flex", alignItems:"center", gap:8}}>
                    <span style={{
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:600, fontSize:18, lineHeight:1.5, color:"#000",
                    }}>{fmtTime(form.start)}</span>
                    <span style={{
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:500, fontSize:18, lineHeight:1, color:"#111",
                    }}>⎯</span>
                    <span style={{
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:600, fontSize:18, lineHeight:1.5, color:"#000",
                    }}>{fmtTime(form.end)}</span>
                  </div>
                  {/* 서브타이틀 행 — [Phase G 2026-04-26] 12px → 14px, "개 예약 가능" 색 #96a0b3 → #111 */}
                  <div style={{display:"flex", alignItems:"flex-start", gap:4}}>
                    <div style={{display:"flex", alignItems:"center"}}>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:600, fontSize:14, lineHeight:1.5, color:"#111",
                      }}>{availableRooms.length}</span>
                      <span style={{
                        fontFamily:"Pretendard, sans-serif",
                        fontWeight:400, fontSize:14, lineHeight:1.5, color:"#111",
                      }}>개 예약 가능</span>
                    </div>
                    <span style={{
                      fontFamily:"Pretendard, sans-serif",
                      fontWeight:400, fontSize:14, lineHeight:1.5,
                      color:"rgba(150, 160, 179, 0.5)",
                    }}>클릭해서 선택</span>
                  </div>
                </>
              ) : (
                /* 시간 미설정 — 기존 안내 유지 (Figma에 없는 케이스) */
                <div style={{
                  fontFamily:"Pretendard, sans-serif",
                  fontWeight:600, fontSize:18, lineHeight:1.5, color:"#000",
                }}>시간을 먼저 선택해주세요</div>
              )}
            </div>
            {noTimeLeft ? (  /* ← [2026-04-29] noTimeLeft 시 회의실 그리드 대신 안내 문구 */
              <div style={{textAlign:"center",padding:"60px 20px",color:"#CBD5E1"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Clock size={40} strokeWidth={1.8} color="#CBD5E1"/></div>
                <div style={{fontSize:13}}>선택할 수 있는 회의실이 없습니다</div>
              </div>
            ) : !validTime ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"#CBD5E1"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Clock size={40} strokeWidth={1.8} color="#CBD5E1"/></div>
                <div style={{fontSize:13}}>시작/종료 시간을 설정하면<br/>예약 가능한 회의실이 자동으로 표시됩니다</div>
              </div>
            ) : RoomGridDesktop()}
          </div>
        </div>

        {/* ── 하단 버튼 (데스크톱: absolute / 모달 전체 너비) ── */}
        {/* ← [Phase A] absolute(bottom:0), padding 8, gap 8, radius 0/24, 배경 #f5f5f5 over #fff */}
        <div style={{
          display:"flex",
          gap:8,
          padding:"8px",
          position:"absolute",
          bottom:0,
          left:0,
          right:0,
          borderRadius:"0 0 24px 24px",
          background:"linear-gradient(0deg, #fff, #fff), linear-gradient(0deg, #f5f5f5, #f5f5f5)",
          backgroundBlendMode:"normal",
          flexShrink:0,
          zIndex:10
        }}>
          {/* ← [Phase A] Button height 56, radius 16 (Figma) — minHeight로 강제 override */}
          <Button variant="ghost"   flex onClick={onClose} style={{minHeight:56, borderRadius:16}}>취소</Button>
          <Button variant="primary" flex disabled={!canSubmit} loading={isSubmitting}
            style={{minHeight:56, borderRadius:16}}
            onClick={async ()=>{
                if(!canSubmit)return;
                submitTimerRef.current = setTimeout(()=>setIsSubmitting(true), 250);
                try {
                  editBooking ? await onUpdate({...form},bookingDate) : await onSubmit({...form, recur: isAdmin ? recur : "NEVER"},bookingDate) /* ← [2026-05-28] 어드민만 실제 recur 전달, 비어드민은 NEVER 강제(이중 방어) */;
                } finally {
                  if(submitTimerRef.current) clearTimeout(submitTimerRef.current);
                  setIsSubmitting(false);
                }
              }}>
            {editBooking ? "변경 저장" : isApprovalRoom ? "승인 요청" : "예약 확정"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────
