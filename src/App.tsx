/**
 * App.tsx — C&R Space 루트 컴포넌트
 *
 * ✅ 변경 이력
 *  - [2026-10-06 NOTICE-READ] 헤더 공지 조회 — 로그인 후에만, "지금 게시 중" 판정은 서버 함수(get_active_announcement, 20261019)
 *      · 문제 ①: notice 관리자 헤더에 종료된 공지가 떴다 — 배너 조회가 게시 기간을 RLS 에 맡겼는데 RLS 는 관리자에게 전체 행을 준다
 *      · 문제 ②: 로그인 화면에서도 조회가 나가 anon 요청 오류가 쌓였다(24시간 16건, 검색엔진 봇 포함) — 마운트 시 1회 조회였기 때문
 *      · 변경: 조회 effect 를 로그인 사용자 기준([authUser?.user_id])으로 — 비로그인이면 조회·구독하지 않고 배너를 비운다.
 *        로그인 직후(이메일 로그인처럼 새로고침이 없는 경로 포함)에도 조회된다. 판정은 api.loadActiveAnnouncement → RPC
 *      · 불변: 배너 표시(NoticeBar)·dismiss·리얼타임 재조회 신호. 화면 변경 없음
 *  - [2026-10-06 ORG-DEEPLINK] 조직도 캔버스 주소(#admin-org-{fileId})에서 새로고침·메일 링크 진입 시 홈으로 튕기던 버그
 *      · 근본원인: 접두어형 딥링크(admin-tab- / admin-booking- / booking- / workboard-)의 해시→view 매핑이
 *        ①getViewFromHash ②로그인 effect isValidHash ③딥링크 저장 effect 세 곳에 따로 나열돼 있었고,
 *        10/1 신설한 admin-org- 가 세 곳 모두에서 빠졌다 (8/21 DIRECT_VIEWS 로 고친 "복붙 배열" 문제의 접두어판).
 *        ① 초기 렌더가 'home' 을 돌려주고 ② isValidHash=false → setView('home') 이 해시를 #home 으로 덮어썼다.
 *        조직도 알림 메일의 '조직도 열기'(CTA_ORG_FILE = #admin-org-{id})도 같은 이유로 홈에 떨어졌다
 *      · 해결: HASH_PREFIX_VIEWS + resolveDeepHash() 로 SSOT 화 — ①②가 같은 함수를 쓴다. admin-org- → 'admin' 추가
 *      · OAuth 복원: admin-org- 도 cnr_deeplink 저장 대상에 추가하고, 로그인 후 해시가 비어 있으면 해시로 되돌린다
 *        (AdminView·OrgAdminPanel 은 해시에서 탭/파일을 읽는다). 권한 없는 사용자는 어드민 게이트가 home 으로 보낸다
 *      · 불변: 기존 접두어·별칭(myloans)·DIRECT_VIEWS 의 판정 순서와 결과 (해시 26종 × 3권한 차등 검증 — admin-org- 만 달라짐)
 *      · ⭐운영 규칙: 접두어형 딥링크를 새로 만들면 HASH_PREFIX_VIEWS 한 줄만 추가
 *  - [2026-10-06 ADMIN-GATE] 어드민 페이지 접근 권한 검사 (10/6 사고 — 일반 사용자가 어드민 화면에서 본인 예약 승인)
 *      · 원인: view==='admin' 이면 권한 확인 없이 AdminView 를 렌더했고, 푸터 '관리자 페이지' 링크가 전 직원에게 노출됐다
 *      · adminGate('checking'|'allowed'|'denied') 신설 — 어드민 뷰 진입 시마다 admin_roles 재조회.
 *        통과 조건 = 열 수 있는 어드민 탭 1개 이상(visibleTabs) — DB 가 profiles.role='ADMIN' 을 같은 조건으로 재계산하므로 'ADMIN 전원' 과 동일 집합.
 *        isAdmin 을 직접 쓰지 않는다: 세션 직후 role='USER' 로 먼저 렌더돼 관리자가 새로고침 시 home 으로 튕긴다.
 *        로그인 때 받아 둔 역할로 이미 통과면 즉시 표시 + 백그라운드 재확인(관리자 진입 지연 없음),
 *        아니면 재조회가 끝날 때까지 AdminSkeleton. 조회 실패는 닫힘 쪽.
 *      · denied → home 폴백 (#workboard 게이트와 같은 패턴). 저장된 #admin-booking- 딥링크도 함께 정리
 *      · AdminView 에 initialRoles(로딩 구간 없이 탭 확정) · onNoAccess(진입 후 역할 0개가 되면 닫기) 전달
 *      · AppFooter 에 isAdmin 전달 — '관리자 페이지' 링크는 관리자에게만
 *      · 최종 방어는 DB(20261017_booking_write_guard) — 이 게이트는 화면 접근 차단 담당
 *  - [2026-09-30 NOTIFY 5-B] Work Space 딥링크 — #workboard-task-{id}/#workboard-issue-{id} → view 'workboard' (OAuth 복원 cnr_deeplink 포함),
 *      알림벨 onOpenWorkboard → wbDeepLink 상태 → WorkboardPage deepLink prop (소비 후 비움)
 *  - [2026-09-29 WORKBOARD P3-A] WorkboardPage 에 users·authUserId·showToast 전달 (보드 구현)
 *  - [2026-09-29 WORKBOARD P2] Work Space(업무보드) 라우팅·권한 게이트
 *      · DIRECT_VIEWS += 'workboard' (#workboard 새로고침·딥링크 유지)
 *      · myAdminRoles 상태 신설 — authUser 확정 시 loadMyAdminRoles 1회. isAdmin(profiles.role) 과 **별개 축**:
 *        workboard 는 어드민 탭이 아닌 일반 뷰 권한이라 profiles.role 재계산에서 제외됨(20260929 phase1 [B]).
 *        기존 loadMyAdminRoles 호출은 AdminPage·ResourcePage 각자였고 App 레벨엔 역할 상태가 없었다
 *      · canWorkboard = canSeeView(myAdminRoles,'workboard') → AppDrawer 섹션 노출 + 렌더 분기
 *      · 비권한 #workboard 딥링크 → home 폴백. myAdminRoles===null(로딩중)엔 판정 보류 (AdminView 의 null=전체탭 유지와 동일 이유 — 진입 직후 튕김 방지)
 *  - [2026-09-29] 관리자 → 승인완료 에메랄드룸 예약 변경 허용 (updateBooking)
 *      · 배경: DetailModal에서 관리자에게 "예약 변경" 버튼을 열어도 updateBooking이
 *              "승인 완료된 예약은 변경할 수 없습니다"로 저장 차단 + newStatus 식이 pending으로 되돌림
 *      · 변경 ①: 승인룸 confirmed 저장 차단을 !isAdmin 한정 (DetailModal editLockedByApproval 과 동일 조건)
 *      · 변경 ②: newStatus = isAdmin ? 'confirmed' : (에메랄드 ? 'pending' : 'confirmed')
 *                — 관리자 변경은 confirmed 유지 (고지 확정), 대리예약 즉시 확정(L929) 원칙과 동일
 *      · 변경 ③: useCallback 의존성에 isAdmin 추가
 *      · 불변: pending 예약 변경 차단(Bug 2) / 비관리자 경로 전체 / DB·RPC·Edge Function 무변경
 *  - [2026-07-27 목적 Phase 2] 예약 목적 카테고리 저장 연결
 *      · addBooking: 기본 유효성에 purpose 필수(+기타 상세) 추가, nb에 purpose/purposeDetail 포함
 *        → 반복 예약 전 회차 동일값 / 'created'·'pending' 알림 payload에 스프레드로 자동 포함
 *      · updateBooking: changes에 purpose/purposeDetail 추가 (수정 모달 목적 변경 허용, 고지 확정)
 *  - [2026-05-28] 반복예약 종료일 정책 변경 — today+1개월 → 올해 12/31 (어드민 전용)
 *      · 대상: addBooking 반복 날짜 생성 maxDate (L744)
 *      · 변경: maxD.setMonth(getMonth()+1) → maxD.setMonth(11, 31) (올해 12월 31일)
 *      · 동기화: BookingModal.tsx recurPreview maxD2도 동일 변경 (미리보기=실제생성 일치 필수)
 *      · 주의: "매일" 선택 시 연말까지 최대 ~218건 생성 — insertBooking 순차 루프이므로
 *              생성 시간 길어질 수 있음(데이터 정합성/에러는 없음). 배치 insert 최적화는 별도 TODO.
 *
 *  - [2026-05-04] HeaderNav 분리 (Phase 1+2 Step 4 — Phase 완료)
 *      · 대상: 헤더 가운데 Nav pills + "← 홈으로" 버튼 (~47줄 JSX)
 *      · 신규: src/components/layout/HeaderNav.tsx
 *      · App.tsx 변경:
 *        - JSX 영역 → <HeaderNav ... /> 한 줄 호출로 교체
 *        - lucide-react import 라인 통째로 제거 (Calendar/Home → HeaderNav 내부로)
 *      · 동작 로직 무수정 (view 분기 / 모바일 분기 / dark 모드 / Figma 사양 모두 보존)
 *      · 🎉 Phase 1+2 (4 Step) 완료 — App.tsx 2120 → 약 1790줄 (-330줄, -15.6%)
 *
 *  - [2026-05-04] NotificationBell 분리 (Phase 1+2 Step 3)
 *      · 대상: 헤더 알림 벨 + 알림 패널 (~110줄 JSX)
 *      · 신규:
 *        - src/components/layout/NotificationBell.tsx (자기완결적: 자체 state/ref/effect)
 *        - src/data/notificationMeta.ts (type별 색상 맵 + getNotificationColor 헬퍼)
 *      · App.tsx 변경:
 *        - JSX 영역 → <NotificationBell ... /> 한 줄 호출로 교체
 *        - state 4개 제거: notifications / showNotifPanel / notifRef / unreadCount
 *        - useEffect 2개 제거: 알림 load+Realtime 구독 / 외부클릭(잔존)
 *        - import 제거: Bell (lucide) / loadNotifications / markNotificationRead / markAllNotificationsRead / subscribeNotifications / AppNotification
 *        - import 유지: insertNotification (sendNotification 함수에서 사용 중)
 *      · 핵심 설계:
 *        - 알림 클릭 → onOpenBookingDetail(bookingId) 콜백으로 위임
 *        - 부모(App.tsx)가 booking 검색 + setModal 처리 → NotificationBell의 bookings 배열 의존성 0
 *      · 동작 로직 무수정 — Realtime 구독 / payload.new prepend / unsub cleanup 모두 동일
 *
 *  - [2026-05-04] ProfileDropdown 분리 (Phase 1+2 Step 2)
 *      · 대상: 헤더 우측 프로필 버튼 + 드롭다운 메뉴 (140줄 JSX)
 *      · 신규: src/components/layout/ProfileDropdown.tsx
 *      · App.tsx 변경:
 *        - JSX 영역 → <ProfileDropdown ... /> 한 줄 호출로 교체
 *        - state(showDropdown) + ref(dropdownRef) 제거 → 컴포넌트 내부로 이동
 *        - 외부클릭 useEffect 분할: dropdown 처리는 컴포넌트 내부로, notifRef 처리는 잔존 (Step 3에서 이동 예정)
 *        - import 제거: UserCircle / LayoutDashboard / LogOut (lucide) + UserAvatar
 *      · Figma 사양은 ProfileDropdown.tsx 헤더 주석에 명시 (445:535 / 445:377)
 *      · 동작 로직 무수정 — 자기완결적 컴포넌트 (자체 ref + 자체 외부클릭 effect)
 *
 *  - [2026-05-04] LazyErrorBoundary 분리 (Phase 1+2 Step 1)
 *      · 대상: L220~290 (interface ErrorBoundaryState + class LazyErrorBoundary)
 *      · 신규: src/components/common/LazyErrorBoundary.tsx
 *      · App.tsx 변경: import 추가 / 클래스 코드 제거 / Component·ErrorInfo·ReactNode import 제거
 *      · 사용처(L1956, L1958)는 변경 없음 (named import로 동일하게 동작)
 *      · 동작 로직 무수정 — 단순 cut & paste
 *
 *  - [2026-05-04] 헤더 프로필 드롭다운 메뉴 Figma 정확 반영
 *      · 대상: 1746~1880 영역 중 드롭다운 메뉴 부분 (1796~)
 *      · Figma: 445:535 (일반사용자) / 445:377 (관리자)
 *      · 컨테이너: minWidth 180 → width 200, border-radius 12 → 16, 외곽선(1px #E2E8F0) 제거
 *      · ModalHeader: padding 14/16 → 12, 이름 13/600 → 14/500, 부서 11/#94A3B8 → 14/#96A0B3
 *      · 메뉴: padding 10/16 → 8/12, 텍스트 13 → 14 Medium + letter-spacing 0.14px
 *      · 메뉴 라벨: "My Page"→"MY PAGE", "Admin"→"ADMIN" (Figma 표기)
 *      · 아이콘: User → UserCircle, Settings → LayoutDashboard, size 15 → 20
 *      · 로그아웃: 색상 #EF4444(빨강) → #99A1AF(회색, Figma 기준), 외부 padding 4/0 → 8/12
 *      · 짝 변경: lucide-react import 라인 (User, Settings 제거 / UserCircle, LayoutDashboard 추가)
 *      · 동작 로직 무수정 (setView/setShowDropdown/logout 호출 동일)
 *
 *  - [2026-04-30] 캘린더 stale 화면 노쇼 오표시 근본 해결 (Step 1+2+3-A)
 *      · 증상: DailyView에서 브라우저 오래 켜두면 체크인된 예약·진행중 예약이 모두
 *              노쇼 박제로 표시. 클릭하거나 새로고침하면 정상 복원. DB는 정상.
 *      · 진단:
 *        - markNoshow API는 DB 가드 5종(api.ts:562~590)으로 stale 시도를 거름 → DB 안전
 *        - 그러나 useEffect [tick]의 setBookings는 prev에 가드 없이 마킹
 *          → React state만 오염되는 비대칭 결함
 *        - state 오염의 근본은 Realtime 끊김 후 React state ↔ DB sync 단절
 *      · 해결 (3단계, 함께 적용):
 *        Step 1 — 노쇼 useEffect setBookings에 DB 가드 5종 대칭 적용
 *                 (status='confirmed', !checkedIn, !earlyEnded, !autoCancelled, cancelledBy=null)
 *        Step 2 — pending_expired useEffect setBookings에 가드 4종 적용
 *                 (room_id=3, status='pending', !autoCancelled, cancelledBy=null)
 *                 · 메모리 원칙: checkedIn/earlyEnded는 pending에서 의미 없으므로 제외
 *                   ("defensive bloat 금지")
 *        Step 3-A — Realtime 끊김 회복 시 fresh data 강제 sync + 10분 주기 백업 sync
 *                 · subscribeBookings에 onResubscribe 옵셔널 콜백 추가 (api.ts 짝 변경)
 *                 · SUBSCRIBED status 도래 시 loadBookings → setBookings 호출
 *                 · 15분 주기 별도 setInterval로 옵션 다 사각지대(메시지 누락 등) 보강
 *      · 짝 배포: src/lib/api.ts (subscribeBookings 시그니처 확장)
 *      · 원칙: "DB가드와 state가드를 1:1 대칭"이 v3 HOTFIX(4-22) 정신의 일관 적용
 *
 *  - [2026-04-29] 캘린더 탭 재진입 시 오늘 일 뷰로 리셋
 *      · 증상: 주간/월간 뷰 보다가 홈 갔다 캘린더 재진입 시 이전 뷰·날짜 그대로 유지됨
 *      · 해결: setView('calendar') 분기에 setCalView('daily') 추가 (setSelectedDate(todayStr()) 기존 존재)
 *
 *  - [2026-04-29] subModal DetailModal에 onEarlyEnd / currentUserId / currentUserEmail 누락 추가
 *      · RoomDetailModal → 예약 클릭(subModal) 경로에서 세 prop이 전달되지 않아
 *        조기반납 버튼 미노출, 예약자 판정 불가 문제
 *
 *  - [2026-04-29] DetailModal onEarlyEnd={confirmAndEarlyEnd} 추가
 *      · 기존 modal.type==='detail' 호출부에 prop 누락으로 조기반납 버튼 미출력
 *
 *  - [2026-04-24 P2] HomeView 호출에 currentUserId prop 전달 추가
 *      · 목적: HomeView "오늘 내 예약" 필터를 MyPage 방식(UUID + email)으로 통일
 *      · 증상: 팀즈에서 이름 변경한 사용자의 홈 '오늘 내 예약' 카드 미표시
 *              (bookings.user_name snapshot과 profiles.name(현재) 불일치)
 *      · 본 파일 변경: HomeView 호출에 currentUserId={authUser?.user_id ?? ''} 추가
 *      · 짝: HomeView.tsx — isMyBooking 헬퍼 도입, L137 조건식 교체
 *
 *  - [2026-04-24 P1-hotfix] DetailModal에 currentUserEmail prop 추가
 *      · 배경: P1 최초 배포 후에도 편집 버튼 미노출 (이름 fallback 꼬임)
 *      · 해결: DetailModal 판정식을 MyPage 방식(UUID + email)으로 통일
 *      · 본 파일 변경: DetailModal 호출에 currentUserEmail={authUser?.email ?? ''} 1개 추가
 *      · 짝: DetailModal.tsx — isMyBooking 헬퍼 import로 전환 (동시 배포)
 *      · bookingOwnership.ts도 함수명 isBookingOwner → isMyBooking으로 리네이밍
 *
 *  - [2026-04-24 P1 긴급] DetailModal에 currentUserId prop 전달 추가 (L1467 근방)
 *      · 목적: 예약자 판정을 이름 문자열 → UUID 기반으로 전환하기 위해
 *              DetailModal 호출 시 currentUserId={authUser?.user_id ?? ''} 추가
 *      · 증상: 팀즈에서 이름 변경한 사용자가 본인 예약의 취소/편집/체크인 버튼 미노출
 *              (Admin Azure AD 동기화로 profiles.name 변경 후 bookings.user_name snapshot과 불일치)
 *      · 짝: DetailModal.tsx isOwner 계산을 isBookingOwner() 헬퍼로 전환 (동시 배포)
 *      · 본 파일은 prop 1개 전달 추가뿐, 다른 로직 무수정
 *      · 후속: HomeView/CalendarShell/BookingStatusBadge 등 9곳 P2~P8 분리 배포 예정
 *
 *  - [2026-04-22 HOTFIX] 캘린더 → 홈 예약 모달 날짜 꼬임 해결
 *      · 증상: 사용자가 캘린더에서 미래 날짜 선택 후 홈으로 이동 → "바로 예약" 버튼 누르면
 *              예약 모달에 오늘이 아닌 캘린더에서 보던 미래 날짜가 적용됨
 *              → 지금 당장 회의실 잡을 의도였는데 미래 날짜로 예약 생성되는 혼선
 *      · 근본 원인:
 *        - BookingModal의 date prop을 `modal.date || selectedDate` 폴백으로 전달
 *        - 홈의 "바로 예약"(onBook), "+"(openNewBooking 이벤트), RoomDetailModal 예약 버튼 모두
 *          setModal 호출 시 date를 명시하지 않음 → modal.date = undefined
 *        - selectedDate는 캘린더 탐색 상태라 미래 날짜일 수 있음 → 폴백으로 적용되어 버그
 *      · 해결:
 *        - 폴백을 selectedDate → todayStr()로 변경 (date prop 라인 1곳만)
 *        - 캘린더에서 슬롯 클릭 시에는 이미 명시적으로 date 전달 중이라 영향 없음
 *        - edit 모드도 명시적으로 date 전달 중이라 영향 없음
 *      · [2026-04-19 P1 복구]와 무관:
 *        - P1 복구: 캘린더 뷰 내에서 탐색 중 오늘로 강제 이동 버그 (해결됨)
 *        - 본 수정: 캘린더 밖(홈)에서 예약 모달 열 때 날짜 맥락이 새는 문제 (별개)
 *
 *  - [2026-04-22 HOTFIX v3] 노쇼 cancelled_by='user' 오염 근본 해결 (옵션 A)
 *      · 증상: 노쇼 예약이 DB에 auto_cancelled=true + cancelled_by='user'로 저장
 *              → BookingStatusBadge의 isNoshow 판정(cancelled_by==='system') 불성립
 *              → 노쇼 뱃지 미표시 + 캘린더/카드에 opacity 45% 잔존 정책 미적용
 *              → auto-cancel-bookings cron도 auto_cancelled=false 필터에 걸려 이메일 미발송
 *      · 과거 설계 복원 (여러 세션 확정된 내용):
 *        - 노쇼(system)는 화면에 opacity 45%로 "남아야 함" (히스토리 보존)
 *        - 캘린더 슬롯에도 희미하게 + 노쇼 칩 표시
 *        - 이 모든 UI 판별의 키는 cancelled_by='system'
 *      · 근본 원인:
 *        - api.ts의 cancelBooking이 항상 cancelled_by='user'로 기록하는데
 *          프론트 노쇼 감지도 이 함수를 호출 → "system이어야 할 것"을 "user"로 오염
 *      · 해결 (옵션 A — 프론트 즉시 UI + cron 이메일 보장):
 *        - api.ts에 markNoshow(id) 함수 신설 — cancelled_by='system'으로 기록
 *        - 노쇼 감지 useEffect가 apiCancelBooking 대신 markNoshow 호출
 *        - DB에 noshow_notified 컬럼 추가 (이메일 중복 발송 방지)
 *        - auto-cancel-bookings cron은 noshow_notified=false 건 조회로 이메일 발송
 *          (프론트가 먼저 선점해도 cron이 이메일 책임 분담)
 *      · v1/v2 시도 기록:
 *        - v1: apiCancelBooking 호출만 제거하고 setBookings 유지 → Realtime이 DB 덮어써
 *              결국 노쇼 뱃지 미표시 (배포됨, v3로 대체)
 *        - v2: useEffect 블록 전체 삭제 → 노쇼가 아예 화면에 안 남는 심각한 역행 (미배포)
 *        - v3: 함수 분리로 cancelled_by 올바르게 기록 (진짜 근본 해결)
 *      · 원칙: "같은 DB 컬럼에 여러 값을 쓰는 함수 하나"는 의미 혼선의 온상.
 *              의미별 함수 분리(cancelBooking / markNoshow / adminForceCancel)가 정답.
 *
 *  - [2026-04-19 P2 v6] pending_expired 알림 누락 버그 해결 (Race Condition)
 *      · 증상: 에메랄드 룸 승인 대기 예약이 기한 초과로 자동 취소될 때
 *              이메일/인앱 알림이 완전히 발송되지 않음
 *      · 진단 (DB 쿼리 검증 완료):
 *        - bookings 테이블에 status=pending + auto_cancelled=true 행 17건 누적
 *        - notifications 테이블 pending_expired 알림 04-18 이후 0건
 *      · 근본 원인 (Race Condition):
 *        - App.tsx useEffect가 start_at - 1분 시점에 expirePendingBooking() 호출
 *          → DB에 auto_cancelled=true로 저장 (status는 'pending' 유지)
 *        - auto-cancel-bookings cron은 `auto_cancelled=false` 필터로 쿼리
 *          → 프론트가 선점한 건들이 cron 쿼리에서 배제됨
 *        - 결과: send-notification('pending_expired') 호출 안 됨 → 알림 누락
 *      · 노쇼와의 차이 (노쇼는 정상 작동):
 *        - 노쇼: start_at + 10분에 프론트 감지 → 그사이 cron이 이미 선점 (문제 없음)
 *        - pending_expired: start_at - 1분에 프론트 감지 → 거의 항상 프론트가 선점
 *      · 해결 (Option C: 단일 주체 DB 쓰기):
 *        - useEffect pending_expired 블록에서 expirePendingBooking() 호출 제거
 *        - 프론트는 낙관적 UI만 담당 (setBookings로 state만 업데이트)
 *        - DB 상태 변경은 auto-cancel-bookings cron이 단독 수행
 *        - Realtime 구독이 cron 결과를 프론트에 푸시하여 최종 동기화
 *        - 노쇼는 정상 작동 중이므로 건드리지 않음
 *      · 부수 효과: 최대 5분 지연 (cron 주기). 이미 기한 초과 상태이므로 허용 가능
 *      · 원칙: 경쟁 조건은 "같은 DB 컬럼에 여러 주체가 쓴다"는 구조 자체가 문제.
 *              주기를 줄이는 건 창만 좁히는 임시방편. 단일 주체로 수렴이 근본 해결.
 *
 *  - [2026-04-19 P1 복구] selectedDate 전역 자동 보정 제거 (과도한 스코프 되돌림)
 *      · 증상: 캘린더뷰에서 어제/과거 날짜로 이동하면 10초 내에 오늘로 튕겨나감
 *              → 과거 예약 탐색 불가
 *      · 원인: [2026-04-17 P0 fix]에서 심은 `setSelectedDate(prev => prev < t ? t : prev)`가
 *              "사용자가 의도적으로 과거로 이동한 상태"와 "stale 날짜"를 구분 못함
 *      · 해결: 10초 tick 내부 + visibilitychange 내부의 전역 보정 제거
 *              과거 날짜 방어는 실제로 필요한 지점(BookingModal 초기값)에서만 처리
 *      · 교훈: 루트 레벨에서 selectedDate 같은 사용자 인터랙션 상태를 자동으로
 *              덮어쓰는 건 근본적으로 위험. 보정이 필요하면 그게 필요한 지점(모달)에서만.
 *
 *  - [2026-04-18 P0 fix] 뷰 전환 시 흰 화면 버그 해결
 *      · 증상: 배포 직후 캘린더 → 마이페이지/어드민 전환 시 흰 화면
 *              (Console 에러 없음, Network 404 없음, 새로고침하면 정상)
 *      · 근본 원인 1: lazy 선언(42, 44줄)이 일반 import 블록 사이에 섞여있어
 *                     Rollup 프로덕션 빌드에서 청크 분할 시 로드 순서 꼬임
 *                     → lazy 모듈의 default export가 undefined로 평가됨
 *                     → React가 조용히 빈 컴포넌트 렌더링 (에러 없이 흰 화면)
 *      · 근본 원인 2: AdminPage.tsx 중간 import 3개로 인한 청크 의존성 꼬임
 *                     (AdminPage.tsx에서 별도 수정)
 *      · 해결:
 *        (1) 모든 import를 블록 최상단에 모으고, lazy 선언은 별도 섹션으로 분리
 *        (2) LazyErrorBoundary 추가: ChunkLoadError 자동 감지 + 1회 리로드
 *            (세션 플래그로 무한 리로드 루프 방지)
 *        (3) Suspense를 LazyErrorBoundary로 감싸 안전망 확보
 *
 *  - [2026-04-17 P0 fix] selectedDate stale 버그 해결 (자정 경계/탭 유지 케이스)
 *      ⚠️ [2026-04-19 P1 복구로 제거됨 — 위 항목 참고]
 *      · 10초 tick에서 todayStr()과 비교해 과거면 강제 갱신
 *      · visibilitychange에서 탭 복귀 시 동일 로직 적용
 *      · 원인: useState(todayStr())가 마운트 시점에만 평가되어 탭을 밤새 유지하면 과거 날짜 고정
 *
 *  - [2026-04-18 P2] 인앱 알림 중복 INSERT 제거
 *      · 배경: 배송 2에서 send-notification Edge Fn이 인앱 INSERT까지 담당하게 됨
 *      · 그런데 App.tsx는 기존 패턴(프론트가 직접 insertNotification)을 유지
 *        → notifications 테이블에 같은 알림이 2번 쌓이는 중복 발생
 *      · 해결: sendNotification 호출과 쌍이 되던 insertNotification 호출 모두 제거
 *      · 제거된 함수: addBooking(3곳), cancelBooking, approvePendingBooking(2곳),
 *                   rejectPendingBooking(2곳), adminForceCancelBooking,
 *                   updateBooking(2곳 + pending 전환 2곳), useEffect noshow, useEffect pending_expired(2곳)
 *      · 유지: checkIn (POLICIES에 없음, 프론트 전용), earlyEnd (POLICIES에 없음, 프론트 전용)
 *      · Realtime 구독(subscribeNotifications)이 INSERT 이벤트를 <100ms로 푸시하여 UX 지연 없음
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'  // ← [2026-05-04] Component/ErrorInfo/ReactNode 제거 (LazyErrorBoundary 분리)
import { createPortal } from 'react-dom'  // ← [2026-05-05 핫픽스 v17] 헤더 wrap을 document.body에 직접 mount — 부모 체인 transform/filter/contain 등 영향 차단
// ← [2026-05-04] lucide-react import 제거 — Calendar/Home은 HeaderNav 내부로 이동 (Phase 1+2 Step 4)
//                Phase 1+2 분리 후 App.tsx에서 직접 사용하는 lucide 아이콘 없음
// ← [2026-04-30] 헤더 상단 공지 영역 (NoticeBar) 도입 — Figma node 410:6745 반영
import { NoticeBar, type AnnouncementConfig } from './components/layout/NoticeBar'
import { ProfileDropdown } from './components/layout/ProfileDropdown'  // ← [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 2)
import { BookLoanDetailModal } from './components/library/BookLoanDetailModal'
import { fetchBookLoanById } from './lib/api'
// ← [2026-07-24] 헤더 공지 — 게시 중인 1건 조회 (판정은 RLS)
import { loadActiveAnnouncement, subscribeAnnouncementSync } from './lib/api'  // ← [2026-07-27 공지 리얼타임] Broadcast 재조회 구독
import { fetchMyNoshowPenalty } from './lib/api'  // ← [2026-08-10 이용제재] 예약 모달 사전 안내 배너용 내 제재 상태
import type { MyNoshowPenaltyState } from './utils/noshowPenalty'  // ← [2026-08-10 이용제재]
import type { AdminBookLoan } from './types'
import { NotificationBell } from './components/layout/NotificationBell'  // ← [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 3)
// ← [2026-07-31] lucide Menu import 제거 — 햄버거를 고지 제공 인라인 SVG 로 교체
import { ResourceDropdown } from './components/layout/ResourceDropdown'
import { ResourcePage } from './pages/ResourcePage'  // ← [2026-08-19] 자원예약 Phase 2A
import { AnnouncementsPage } from './pages/AnnouncementsPage'  // ← [2026-08-19] 공지사항 페이지 신설  // ← [2026-07-31] 복구 (고지 확정 — ZOOM 만 제거한 v16). 드롭다운=데스크탑 퀵 진입, 드로어=전 해상도 전체 메뉴
import { BrandLogo } from './components/layout/BrandLogo'  // ← [2026-07-31] 워드마크 SVG SSOT
import { AppDrawer } from './components/layout/AppDrawer'
import { AppFooter } from './components/layout/AppFooter'
import { HeaderNav } from './components/layout/HeaderNav'  // ← [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 4)
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtTSFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from './utils/time'
import { employmentErrorMessage } from './utils/employment' // ← [2026-07-30] 서버 재직 가드 에러 한글 매핑
import { noshowPenaltyErrorMessage } from './utils/noshowPenalty' // ← [2026-08-10] 노쇼 이용 제재(20260743) 차단 에러 한글 매핑
import { getFloor } from './data/floors'
import { loadBookings, saveBookings, insertBooking, updateBooking as apiUpdateBooking, cancelBooking as apiCancelBooking, markNoshow, subscribeBookings, loadRooms, saveRooms, loadUsers, saveUsers, loadRoomImages, insertAuditLog, buildBookingDiff, approveBooking, rejectBooking, upsertBookingAttendees, getBookingAttendees, insertNotification, adminForceCancel, changeBookingOwner } from './lib/api'  // ← [2026-06-12] changeBookingOwner 추가 (관리자 예약자 변경)  // ← [2026-05-04] loadNotifications/markNotificationRead/markAllNotificationsRead/subscribeNotifications/AppNotification 제거 (NotificationBell 분리 / Phase 1+2 Step 3) — insertNotification은 sendNotification에서 사용 중이라 유지
import { supabase } from './lib/supabase'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType } from './types'
import { HomeView } from './components/room/HomeView'
import { LibraryPage } from './pages/LibraryPage'  // ← [2026-07-16] 도서관 모듈 추가
import { WorkboardPage, type WbDeepLink } from './pages/WorkboardPage'  // ← [2026-09-29 WORKBOARD P2] Work Space 임시 페이지 (#workboard) · [5-B] WbDeepLink
import { loadMyAdminRoles, loadMyAdminRolesStrict } from './lib/api'        // ← [2026-09-29 WORKBOARD P2] 내 admin_roles — 일반 뷰 권한 게이트용  // ← [2026-10-06 ADMIN-GATE] Strict — 조회 실패 구분
import { canSeeView, canSeeTab, visibleTabs } from './data/adminRoles'       // ← [2026-09-29 WORKBOARD P2] 역할 → 일반 뷰 판정 SSOT  // ← [2026-10-01 ORG] canSeeTab — 드로어 '조직도' 진입 게이트  // ← [2026-10-06 ADMIN-GATE] visibleTabs — 어드민 뷰 접근 판정
import { ReleaseNotesPage } from './pages/ReleaseNotesPage'  // ← [2026-08-03] Release Note + Hotfix 페이지 추가
import HrInterviewPage from './pages/HrInterviewPage'  // ← [2026-09-03] 근태 APP 내재화 HR 1차 인터뷰 임시 단독 페이지 (#hr-interview)
import { RoomDetailModal } from './components/room/RoomDetailModal'
import { CalendarSkeleton, MyPageSkeleton, AdminSkeleton } from './components/skeleton'
import { initGlobalRipple } from './hooks/useGlobalRipple'
import { CalendarShell } from './components/layout/CalendarShell'
import { BookingDoneModal } from './components/booking/BookingDoneModal'
import { RecurDoneModal } from './components/booking/RecurDoneModal'
import { ConfirmCancelModal } from './components/booking/ConfirmCancelModal'
import { ConfirmEarlyEndModal } from './components/booking/ConfirmEarlyEndModal'   // ← [2026-04-29] 조기반납 확인 다이얼로그
import { ConfirmRejectModal } from './components/booking/ConfirmRejectModal'       // ← [2026-04-29] 승인거절 다이얼로그
import { ConfirmForceCancelModal } from './components/booking/ConfirmForceCancelModal' // ← [2026-04-24 P8-B] 관리자 강제취소 공통 다이얼로그
import { ChangeOwnerModal } from './components/booking/ChangeOwnerModal'             // ← [2026-06-12] 관리자 예약자 변경 다이얼로그
import { BookingModal } from './components/booking/BookingModal'
import { DetailModal } from './components/booking/DetailModal'
// ← [2026-05-04] UserAvatar import 제거 — ProfileDropdown 내부로 이동 (Phase 1+2 Step 2)
import { LazyErrorBoundary } from './components/common/LazyErrorBoundary'  // ← [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 1)
import LoginPage from './pages/LoginPage'
import { useBreakpoint, useVisualViewport } from './hooks/useBreakpoint'
import { AuthProvider, useAuth } from './hooks/useAuth'

// ── lazy load — 무거운 페이지는 초기 번들에서 제외 ─────────────────────────
// ← [2026-04-18 P0 fix] lazy 선언이 import 블록 사이에 섞여있던 것을
//    import 블록 완료 후 별도 섹션으로 분리. ES 모듈 호이스팅 보장.
const MyPageView = lazy(() => import('./pages/MyPage').then(m => ({ default: m.MyPageView })))
const AdminView  = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminView })))

// ─── ErrorBoundary ────────────────────────────────────────────────────────────
// [2026-05-04] LazyErrorBoundary는 src/components/common/LazyErrorBoundary.tsx로 분리됨 (Phase 1+2 Step 1)
//              로직 무수정, 사용처(view==="mypage"/"admin")는 그대로 유지

// ─── 공지 영역 ────────────────────────────────────────────────────────────
// ← [2026-07-24] 하드코딩 MOCK_ANNOUNCEMENT 제거 → DB(announcements) 조회로 전환.
//
//   기존에는 공지 문구·색이 이 파일의 상수였다. 그래서 공지를 바꾸려면 코드 수정 +
//   배포가 필요했고, **게시 기간이라는 개념이 아예 없어서** 5/12 핫픽스 안내가
//   두 달 넘게 헤더에 떠 있었다. 내리는 것을 사람 기억에 맡긴 결과다.
//
//   이제 관리는 어드민 '공지 배너' 탭에서 하고, 기간이 지나면 자동으로 사라진다.
//   "지금 보여줄 공지인가" 판정은 서버 함수 get_active_announcement 가 하므로(20261019 — 종전 RLS 겸용에서 분리, 2026-10-06)
//   여기서 다시 거르지 않는다 — 조건이 두 곳에 있으면 한쪽만 고쳐진다.

// ─── App ──────────────────────────────────────────────────────────────────────
function AppContent() {
  // ← [2026-07-24] 헤더 공지 — DB 에서 게시 중인 1건. 없으면 배너 미표시
  // ← [2026-07-27 공지 리얼타임] 마운트 1회 조회 → 조회 함수(refetch)로 추출하고
  //   subscribeAnnouncementSync 로 어드민 저장/삭제 Broadcast 신호에 재조회 연결.
  //   판정은 계속 RLS — 신호는 "다시 물어봐라"일 뿐, 무엇을 보여줄지는 서버가 결정.
  const [announcement, setAnnouncement] = useState<AnnouncementConfig | null>(null)
  // ← [2026-10-06 NOTICE-READ] 조회 effect 는 useAuth() 아래로 이동 — 로그인 사용자 기준으로 조회한다 (아래 'NOTICE-READ' 참조)

  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  const [bookings, setBookings]   = useState([]);
  const [rooms, setRooms]         = useState<any[]>([]);
  const [users, setUsers]         = useState<any[]>([]);
  // ← [2026-05-04] notifications / showNotifPanel / notifRef / unreadCount → NotificationBell 내부로 이동 (Phase 1+2 Step 3)

  // ─── [2026-04-30] 헤더 fixed + 본문 padding-top 동적 계산 ─────────────────
  // 배경: index.css의 `html, body { overflow-x: hidden }`(iOS 가로 흔들림 방지)
  //       으로 인해 position: sticky의 컨테이닝 블록이 viewport가 아닌 body로
  //       잡히면서 sticky가 정상 작동하지 않음.
  // 해결: 헤더 wrap을 position: fixed로 viewport 기준 고정 + 본문에 동일 높이만큼
  //       padding-top 동적 적용. ResizeObserver로 NoticeBar dismiss/모바일 전환
  //       등 모든 높이 변경을 자동 반영 → 콘텐츠가 헤더에 가려지지 않음.
  const headerWrapRef = useRef<HTMLDivElement>(null);
  // ── [2026-04-30 보강] 초기값을 viewport 폭 기반 추정값으로 ──
  //    useState(0)이면 첫 paint에서 한 프레임 동안 콘텐츠가 헤더 영역에 들어옴.
  //    정확한 값은 useLayoutEffect에서 즉시 보정되지만, 첫 frame 가림 방지를 위해
  //    추정 초기값 사용.
  //    [2026-04-30 #2] 헤더 슬림화(padding 8/8, minHeight auto) + NoticeBar 비활성화 반영
  //                    이전: 113 (NoticeBar 41 + 헤더 72)
  //                    이후: 56 (헤더 슬림 ~48 + 여유 8) — NoticeBar 활성화되면 ResizeObserver가 보정
  const [headerHeight, setHeaderHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 56;       // SSR 안전 기본값
    return 56;                                          // 슬림 헤더 (모바일/데스크톱 동일)
  });
  // URL 해시에서 초기 view 복원 (#home, #calendar, #mypage, #admin)
  // ← [2026-05-12] booking-{id} deeplink → home 폴백
  //   배경: 이전에는 booking-/admin-booking- 딥링크 시 mypage/admin으로 강제 이동
  //         → 사용자가 어떤 페이지든 메일 클릭하면 DetailModal만 보고 싶은데 mypage로 끌려감
  //   변경: booking- deeplink는 home으로 폴백 (앱 첫 진입 시) + DetailModal은 별도 useEffect가 오픈
  //         admin-booking-는 그대로 admin 폴백 유지 (관리자 워크플로 의도 보존)
  //   페이지 컨텍스트 유지: 이미 앱에 있던 사용자는 별도 useEffect에서 view 변경 안 함
  // ← [2026-08-21] 🔴근본수정: 직접 진입(새로고침·URL 공유) 가능한 view 화이트리스트 SSOT.
  //   증상: #resources 에서 F5 → 홈으로 튕김.
  //   근본원인: 해시 화이트리스트가 ①getViewFromHash ②로그인 effect isValidHash 두 곳에
  //   **수동 복붙 배열**로 흩어져 있어, 8/19 신규 페이지 2종(resources·announcements)을
  //   추가할 때 두 배열 모두 갱신이 누락됨. 그 결과
  //     ① 초기 렌더: getViewFromHash 가 'resources' 미인식 → 'home' 반환
  //     ② 직후 로그인 effect: isValidHash=false → setView('home') 이 해시까지 #home 으로
  //        덮어써 URL 컨텍스트 자체가 파괴됨 (뒤로가기로도 복구 불가)
  //   해결: 상수 하나로 통일 — 두 판정이 같은 배열을 참조하므로 어긋날 방법이 사라진다.
  //   ⭐운영 규칙: 새 페이지(view) 추가 시 렌더 분기와 함께 이 배열에만 추가하면 끝.
  //   (myloans 는 view 가 아니라 mypage 로 매핑되는 딥링크 별칭 — 여기 넣지 않는다)
  const DIRECT_VIEWS = ['home','calendar','mypage','admin','library','resources','announcements','release-notes','hr-interview','workboard']  // ← [2026-09-29] workboard 추가 (Work Space)  // ← [2026-09-03] hr-interview 추가 (임시 단독 페이지)

  // ← [2026-10-06 ORG-DEEPLINK] 접두어형 딥링크 → view SSOT.
  //   종전엔 이 목록이 getViewFromHash / 로그인 effect isValidHash / 딥링크 저장 effect 에 따로 나열돼 있어
  //   10/1 신설한 admin-org- 가 전부 빠졌고, 조직도 캔버스에서 새로고침하면 홈으로 튕겼다.
  //   ⭐운영 규칙: 접두어형 딥링크를 새로 만들면 여기 한 줄만 추가 (view 는 DIRECT_VIEWS 에 있는 값).
  //     · admin-tab-{tab}        어드민 탭
  //     · admin-booking-{id}     승인요청 메일 CTA → 어드민 승인 관리 + 상세 모달 (AdminView 가 소비)
  //     · admin-org-{fileId}     조직도 캔버스 (AdminView·OrgAdminPanel 이 해시에서 읽음)   ← [2026-10-06] 추가
  //     · booking-{id}           예약 메일 CTA → 현재 화면 위 상세 모달 (첫 진입 폴백 home, 2026-05-12)
  //     · workboard-{task|issue}-{id}  Work Space 메일 CTA (WorkboardPage 가 소비, 2026-09-30)
  const HASH_PREFIX_VIEWS: [string, string][] = [
    ['admin-tab-', 'admin'], ['admin-booking-', 'admin'], ['admin-org-', 'admin'],
    ['booking-', 'home'], ['workboard-', 'workboard'],
  ]
  /** 딥링크 해시(접두어형 + 별칭 myloans) → view. 딥링크가 아니면 null. (직접 view 해시는 DIRECT_VIEWS 가 판정) */
  const resolveDeepHash = (h: string | null | undefined): string | null => {
    if (!h) return null
    if (h === 'myloans') return 'mypage'   // ← [2026-08-11] 도서 CTA 별칭 — 마이페이지 진입 (탭 선택은 아래 딥링크 이펙트)
    const hit = HASH_PREFIX_VIEWS.find(([prefix]) => h.startsWith(prefix))
    return hit ? hit[1] : null
  }

  const getViewFromHash = (): string => {
    const hash = window.location.hash.replace('#', '')
    // 판정 순서는 종전과 동일: ① 현재 해시의 딥링크 ② OAuth 리다이렉트로 해시가 소실된 경우 sessionStorage 복원 ③ 직접 view
    const fromHash = resolveDeepHash(hash)                                   // ← [2026-10-06 ORG-DEEPLINK] 나열식 if → SSOT
    if (fromHash) return fromHash
    const fromSaved = resolveDeepHash(sessionStorage.getItem('cnr_deeplink'))  // ← [2026-10-06 ORG-DEEPLINK] 저장 대상은 아래 저장 effect 가 정한다
    if (fromSaved) return fromSaved
    return DIRECT_VIEWS.includes(hash) ? hash : 'home'  // ← [2026-08-21] 복붙 배열 → SSOT (resources·announcements 포함)
  }
  const [view, setViewState] = useState<string>(getViewFromHash);
  // ← [2026-07-30] 전역 사이드 드로어 (헤더 햄버거 트리거)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // ← [2026-09-29 WORKBOARD P2] 내 admin_roles. null = 아직 조회 전(게이트 판정 보류) / [] = 없음
  const [myAdminRoles, setMyAdminRoles] = useState<string[] | null>(null)
  const canWorkboard = myAdminRoles !== null && canSeeView(myAdminRoles, 'workboard')
  const canOrg = myAdminRoles !== null && canSeeTab(myAdminRoles, 'org')   // ← [2026-10-01 ORG Phase 4-A] org 역할(또는 super) — 드로어 '조직도' 항목 노출. 어드민 탭 게이트(visibleTabs)와 동일 판정
  // ← [2026-09-30 NOTIFY 5-B] 알림벨에서 넘어온 Work Space 열기 요청 (WorkboardPage 가 소비 후 비움)
  const [wbDeepLink, setWbDeepLink] = useState<WbDeepLink | null>(null)
  // ← [2026-07-30] 마이페이지 진입 시 열 세그먼트 탭. 도서관 '나의 도서 대여'
  //   CTA 만 'book' 으로 세팅하고, 마이페이지를 벗어나면 'room' 으로 되돌린다 —
  //   되돌리지 않으면 CTA 를 한 번 쓴 뒤 헤더로 들어간 마이페이지도 계속
  //   도서 탭으로 열려, 기본 동작(회의실 조회)이 조용히 바뀐다.
  const [myPageInitialTab, setMyPageInitialTab] = useState<'room' | 'book' | 'resource'>('room');  // ← [2026-08-19 Phase 4] 자원 탭
  const setView = (v: string) => {
    setViewState(v)
    if (v !== 'mypage') setMyPageInitialTab('room')
    window.location.hash = v
    window.scrollTo({ top: 0, behavior: 'instant' })
    // 탭 전환 시 해당 화면 필터 초기화
    if (v === 'home')     setHomeFilterFloor('ALL')
    if (v === 'calendar') { setCalFilterRoomId('ALL'); setSelectedDate(todayStr()); setCalView('daily') } // ← [2026-04-29] 캘린더 탭 재진입 시 오늘 일 뷰로 리셋  ← [2026-05-07] setCalFilterFloor → setCalFilterRoomId
  }
  const [calView, setCalView]     = useState("daily");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [modal, setModal]         = useState(null);
  // ← [2026-07-21] 도서 대여 상세 (알림 클릭 경로).
  //   loading 상태를 함께 들고 있어야 조회 중 빈 화면이 노출되지 않는다.
  const [loanDetail, setLoanDetail] =
    useState<{ loan: AdminBookLoan | null; loading: boolean } | null>(null);
  // ← [2026-08-10 이용제재] 내 노쇼 제재 상태 — 배너·CTA 잠금은 안내용, 최종 차단은 DB 트리거(20260743).
  //   조회 실패는 조용히 null 유지(서버가 어차피 차단 + addBooking catch가 한글 토스트) — 화면을 막지 않는다
  const [myNoshowPenalty, setMyNoshowPenalty] = useState<MyNoshowPenaltyState | null>(null);
  const [subModal, setSubModal]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [searchQ, setSearchQ]     = useState("");
  const [homeFilterFloor, setHomeFilterFloor] = useState("ALL");

  // 회의실 이미지 일괄 로딩 (초기 렌더 블로킹 방지)
  const loadAllRoomImages = useCallback(async (roomList: any[]) => {
    try {
      const { data } = await supabase
        .from('rooms')
        .select('room_id, thumbnail_url, gallery_urls')
      if (!data) return
      const imgMap = new Map(data.map(d => [d.room_id, d]))
      setRooms(prev => prev.map(room => {
        const imgs = imgMap.get(room.room_id)
        if (!imgs) return room
        return {
          ...room,
          thumbnail: imgs.thumbnail_url || room.thumbnail || '',
          gallery:   imgs.gallery_urls  || room.gallery  || [],
        }
      }))
    } catch (e) {
      console.warn('[App] 이미지 로딩 실패:', e)
    }
  }, [])  // 홈화면 전용
  // ← [2026-05-07] 캘린더 필터 단위 변경: floor → room (CalendarShell 시그니처와 동기화)
  const [calFilterRoomId, setCalFilterRoomId] = useState<'ALL' | number>('ALL');
  const [tick, setTick]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  // ── [2026-04-30] skeleton 표시 정책 = 200/200 하이브리드 ─────────────────
  // 배경: 4월 17일 Disk IO 최적화 후 fetch 100~250ms로 빨라짐 → 기존 300ms
  //       트리거에 안 걸려 shimmer 자체가 화면에 안 그려짐.
  //       동시에 `if (!showSkeleton) return null` 때문에 0~300ms 빈 화면 발생.
  // 정책 (가볍게 보이기 우선):
  //   ① 트리거 지연 200ms — 이보다 빠른 응답에선 skeleton 안 보임 (가벼움 유지)
  //   ② 최소 유지 200ms  — 한번 보였으면 200ms는 보장 (깜빡임 방지, 새로고침 신호)
  //   ③ 추가 지연 최대 +50ms (일반 응답 시) — 인지 한도 미만 (시스템 무거워 보임 방지)
  //   ④ 빈 화면 제거 — 0~200ms는 회색 배경만 (헤더 placeholder는 skeleton 화면에서)
  // 시나리오:
  //   · 빠른 응답(150ms)  : 즉시 콘텐츠 (skeleton 거치지 않음, +0ms)
  //   · 일반 응답(350ms)  : skeleton 200ms 보임 → 콘텐츠 (+50ms)
  //   · 느린 응답(800ms+) : skeleton 600ms+ 보임 → 콘텐츠 (+0ms)
  const skeletonShownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      // ── 로딩 시작 → 200ms 후 skeleton 표시 ──
      const showTimer = setTimeout(() => {
        setShowSkeleton(true);
        skeletonShownAtRef.current = Date.now();
      }, 200);
      return () => clearTimeout(showTimer);
    }

    // ── 로딩 완료 ──
    if (!showSkeleton) {
      // skeleton 미표시 상태에서 데이터 도착 → 즉시 실제 화면 (가볍게)
      return;
    }

    // skeleton 표시 중 데이터 도착 → 최소 유지 시간(200ms) 보장
    const elapsed = Date.now() - (skeletonShownAtRef.current ?? Date.now());
    const remaining = Math.max(0, 200 - elapsed);

    const hideTimer = setTimeout(() => {
      setShowSkeleton(false);
      skeletonShownAtRef.current = null;
    }, remaining);
    return () => clearTimeout(hideTimer);
  }, [loading]);  // showSkeleton은 의존성 X (자기 자신 의존 시 무한 루프 위험)
                  // loading 변경 시 showSkeleton의 현재 값을 closure로 capture
                  // ESLint 경고 가능: 의도적 — showSkeleton은 loading의 부수 결과로만 변경됨
  const [splashDone, setSplashDone] = useState(false); // Text Reveal 최소 표시 보장

  // Text Reveal 최소 표시 시간 (애니메이션 완료 타이밍)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1600);
    return () => clearTimeout(t);
  }, []);

  // modal 닫히면 subModal도 자동 클리어
  useEffect(() => { if (!modal) setSubModal(null) }, [modal]);

  // ─── [2026-04-30] 헤더 wrap 높이 측정 → 본문 padding-top 동기화 ───────────
  // 4단계 측정 전략 (모든 사이드 케이스 대응):
  //   1) 동기 측정 (useLayoutEffect)    : paint 직전 1차 보정 (추정값 → 실제값)
  //   2) RAF 재측정 (다음 frame)        : 폰트/이미지 비동기 로드 후 height 변동 잡기
  //   3) ResizeObserver (지속 관찰)     : NoticeBar dismiss / 자식 콘텐츠 변경 자동 추적
  //   4) window resize (fallback)      : 화면 회전 / 창 크기 변경 / 모바일↔데스크톱 전환
  // ── [2026-04-30 보강] 의존성 [] → [loading]
  //    이전 버그: loading=true 첫 mount 시 실제 헤더가 없어 measure 실패.
  //              의존성 []이라 loading=false 전환 시 재실행 안 됨 → 영구 추정값 사용.
  //    수정: [loading] 의존성으로 loading=false 전환 시 헤더 mount되면 재측정.
  useLayoutEffect(() => {
    const el = headerWrapRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.getBoundingClientRect().height;
      // 0 측정값은 무시 (자식 lazy mount 중 측정되는 케이스 방지)
      if (h > 0) setHeaderHeight(h);
    };

    // 1) 동기 측정 (paint 전, 추정값 → 실제값 1차 보정)
    measure();

    // 2) 다음 frame 재측정 — 폰트 로드 / 자식 비동기 렌더 후 height 변동 보정
    const rafId = requestAnimationFrame(measure);

    // 3) ResizeObserver — 모든 후속 높이 변경 자동 추적 (dismiss 애니메이션 포함)
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    // 4) window resize — 모바일 회전 / 데스크톱↔모바일 분기 변경
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [loading]);

  // ← [2026-05-04] showDropdown / dropdownRef → ProfileDropdown 컴포넌트 내부로 이동 (Phase 1+2 Step 2)
  const { currentUser: authUser, logout, isAdmin, loading: authLoading } = useAuth()
  const currentUser = authUser?.name ?? ""
  const currentDept = authUser?.dept ?? ""

  // ← [2026-10-06 NOTICE-READ] 헤더 공지 조회 — 로그인한 사용자가 있을 때만.
  //   종전에는 마운트 시 1회([]) 조회라 로그인 화면(비로그인)에서도 요청이 나갔다. 공지는 로그인 사용자 전용(20261018)이므로
  //   비로그인 요청은 의미가 없고, 로그인 직후에는 다시 조회해야 한다 → 의존성을 로그인 사용자 id 로.
  //   refetch 본문은 종전 그대로. 판정(게시 중·최근 시작 1건)은 서버 함수 — 여기서 거르지 않는다.
  const noticeUserId = authUser?.user_id ?? null
  useEffect(() => {
    if (!noticeUserId) { setAnnouncement(null); return }   // 비로그인·로그아웃: 조회·구독 없음, 배너 비움
    let cancelled = false
    const refetch = () => {
      loadActiveAnnouncement()
        .then(a => {
          if (cancelled) return
          setAnnouncement(a ? {
            id:        a.id,
            active:    true,          // 서버 함수가 게시 중인 1건만 내려주므로 여기서는 항상 true
            message:   a.message,
            bgColor:   a.bg_color,
            textColor: a.text_color,
          } : null)
        })
        .catch(e => console.warn('[App] 공지 조회 실패:', e))
    }
    refetch()
    const unsubscribe = subscribeAnnouncementSync(refetch)   // ← [2026-07-27 공지 리얼타임]
    return () => { cancelled = true; unsubscribe() }
  }, [noticeUserId])

  // ← [2026-08-10 이용제재] 로그인 확정 시 1회 + 새 예약 모달을 열 때마다 재확인
  //   (모달 오픈 직전에 제재가 새로 발생/해제됐을 수 있음 — 낙관적 캐시 금지 원칙과 동일 취지)
  useEffect(() => {
    if (!authUser) { setMyNoshowPenalty(null); return }
    fetchMyNoshowPenalty().then(setMyNoshowPenalty).catch(() => {})
  }, [authUser?.user_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ← [2026-09-29 WORKBOARD P2] 내 역할 1회 조회 — isAdmin 조건 없이 로그인 확정만으로 실행.
  //   본인 행은 admin_roles RLS(user_id = auth.uid())가 항상 허용. 실패 시 [] (게이트는 닫힘 쪽으로)
  useEffect(() => {
    if (!authUser) { setMyAdminRoles(null); return }
    loadMyAdminRoles(authUser.user_id).then(setMyAdminRoles).catch(() => setMyAdminRoles([]))
  }, [authUser?.user_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ← [2026-09-29 WORKBOARD P2] 비권한 #workboard 진입 → home 폴백. 로딩중(null)엔 판정하지 않는다
  useEffect(() => {
    if (view !== 'workboard' || myAdminRoles === null) return
    if (!canSeeView(myAdminRoles, 'workboard')) setView('home')
  }, [view, myAdminRoles])  // eslint-disable-line react-hooks/exhaustive-deps

  // ← [2026-10-06 ADMIN-GATE] 어드민 페이지 접근 권한 검사 — 진입할 때마다 내 admin_roles 를 다시 읽어 판정한다.
  //   통과 = 열 수 있는 어드민 탭 1개 이상(visibleTabs). DB 가 profiles.role='ADMIN' 을 이 조건으로 재계산하므로
  //   (admin_set_user_roles) 'ADMIN 전원' 과 같은 집합이다. isAdmin 을 직접 쓰지 않는 이유: useAuth 가 세션 직후
  //   role='USER' 로 먼저 렌더하고 프로필 조회 뒤 ADMIN 으로 보정하므로, isAdmin 으로 판정하면 관리자가
  //   어드민 화면에서 새로고침할 때 home 으로 튕긴다 (#workboard 게이트가 역할만 보는 것과 같은 이유).
  //   · 로그인 때 받아 둔 역할(myAdminRoles)로 이미 통과면 즉시 'allowed' — 관리자는 기존처럼 지연 없이 열린다.
  //     백그라운드 재확인 결과가 다르면(권한 회수) 그때 'denied' 로 바뀐다.
  //   · 통과가 아니면 재조회가 끝날 때까지 'checking'(AdminSkeleton) — 일반 사용자에게 어드민 화면이 한 프레임도 뜨지 않는다.
  //   · 조회 실패(loadMyAdminRolesStrict throw): 이미 통과 상태면 유지(순간 네트워크 오류로 관리자를 내쫓지 않음), 아니면 닫힘.
  //   myAdminRoles 는 의존성에서 제외 — 재확인 결과(setMyAdminRoles)를 다시 트리거로 쓰면 재조회가 반복된다.
  const [adminGate, setAdminGate] = useState<'checking' | 'allowed' | 'denied'>('checking')
  useEffect(() => {
    if (view !== 'admin' || !authUser) { setAdminGate('checking'); return }
    setAdminGate(myAdminRoles !== null && visibleTabs(myAdminRoles).length > 0 ? 'allowed' : 'checking')
    let cancelled = false
    loadMyAdminRolesStrict(authUser.user_id)
      .then(r => {
        if (cancelled) return
        setMyAdminRoles(r)
        setAdminGate(visibleTabs(r).length > 0 ? 'allowed' : 'denied')
      })
      .catch(() => { if (!cancelled) setAdminGate(prev => prev === 'allowed' ? 'allowed' : 'denied') })
    return () => { cancelled = true }
  }, [view, authUser?.user_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ← [2026-10-06 ADMIN-GATE] 권한 없음 → home 폴백. 저장된 관리자 딥링크(#admin-booking-…)도 지운다 —
  //   남겨 두면 getViewFromHash 가 새로고침마다 다시 admin 으로 보내 같은 폴백이 반복된다.
  useEffect(() => {
    if (view !== 'admin' || adminGate !== 'denied') return
    if (/^admin-(booking|org)-/.test(sessionStorage.getItem('cnr_deeplink') ?? '')) sessionStorage.removeItem('cnr_deeplink')   // ← [2026-10-06 ORG-DEEPLINK] admin-org- 포함
    setView('home')
  }, [view, adminGate])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (modal?.type === 'new' && authUser) {
      fetchMyNoshowPenalty().then(setMyNoshowPenalty).catch(() => {})
    }
  }, [modal?.type])  // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 로딩: authUser가 확정된 후 실행
  // - authUser가 null→유저로 바뀔 때(로그인) 재실행
  // - authUser가 유저→null로 바뀔 때(로그아웃) 스킵
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      setLoading(false);
      return;
    }
    // 최초 로그인(hash 없을 때)만 홈으로 이동, 새로고침 시 현재 hash 유지
    const currentHash = window.location.hash.replace('#', '');
    const isValidHash = DIRECT_VIEWS.includes(currentHash)  // ← [2026-08-21] 복붙 배열 → SSOT (getViewFromHash 와 동일 근거 — resources·announcements 누락으로 새로고침이 홈 이동하던 버그의 두 번째 지점)
      || resolveDeepHash(currentHash) !== null              // ← [2026-10-06 ORG-DEEPLINK] 접두어·별칭 나열 → getViewFromHash 와 같은 SSOT (admin-org- 누락으로 조직도 캔버스 새로고침이 홈 이동하던 지점)
      || !!sessionStorage.getItem('cnr_deeplink'); // OAuth 후 deeplink 복원 중이면 홈 이동 차단
    if (!isValidHash) {
      setView('home');
    }
    setLoading(true);
    Promise.all([loadBookings(), loadRooms(), loadUsers()])
      .then(([b, r, u]) => {
        setBookings(b); setRooms(r); setUsers(u);
        // 이미지는 별도로 비동기 로딩 (초기 로딩 블로킹 방지)
        loadAllRoomImages(r);
      })
      .catch(err => { console.error('[App] 초기 데이터 로딩 실패:', err); })
      .finally(() => { setLoading(false); });
  }, [authLoading, authUser?.user_id]);

  // 알림 로드 + Realtime 구독
  // ← [2026-05-04] 알림 로드 + Realtime 구독 useEffect → NotificationBell 내부로 이동 (Phase 1+2 Step 3)
  //                인증 의존(authUser?.user_id), payload.new prepend 패턴, unsub cleanup 모두 컴포넌트 내부로 이전

  // admin-booking- 딥링크 해시를 sessionStorage에 저장 (OAuth 리다이렉트 시 소실 방지)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('admin-booking-') || hash.startsWith('admin-org-') || hash.startsWith('booking-') || hash === 'myloans' || hash.startsWith('workboard-')) {  // ← [2026-08-11] myloans · [5-B] workboard-* 도 로그인 후 복원 대상  // ← [2026-10-06 ORG-DEEPLINK] admin-org-* 추가 (조직도 메일 CTA)
      sessionStorage.setItem('cnr_deeplink', hash)
    }
  }, [])

  // ← [2026-10-06 ORG-DEEPLINK] 조직도 딥링크 OAuth 복원 — 로그인 리다이렉트로 해시가 사라졌으면 저장해 둔 값을 해시로 되돌린다.
  //   AdminView(getTabFromHash)·OrgAdminPanel(hashFileId) 은 해시에서 탭/파일을 읽으므로, 해시만 복원하면 나머지는 기존 경로 그대로.
  //   view 는 getViewFromHash 가 저장값으로 이미 'admin' 을 돌려줬다. 권한 없는 사용자는 어드민 게이트가 home 으로 보내며 저장값을 지운다.
  useEffect(() => {
    if (!authUser) return
    const saved = sessionStorage.getItem('cnr_deeplink') ?? ''
    if (!saved.startsWith('admin-org-')) return
    sessionStorage.removeItem('cnr_deeplink')
    if (!window.location.hash.replace('#', '').startsWith('admin-org-')) window.location.hash = saved
  }, [authUser?.user_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── [2026-08-11 CTA 전수검사] #myloans 딥링크 → 마이페이지 '도서 대여' 탭 ──
  //
  //   도서 알림 CTA 10종(urlTemplate {APP_URL}#myloans)이 쓰는 스킴인데 처리
  //   코드가 없어 홈 폴백되는 죽은 링크였다 (7/20 CTA_MY_LOANS 설계 의도 =
  //   "MyPage 진입 + 조회 세그먼트 '도서 대여' 자동 선택" — 프론트 미구현분).
  //   기존 인프라 재사용: myPageInitialTab state(7/30 도서관 CTA 진입용)에
  //   'book' 을 세팅하고 viewFromHash 가 mypage 로 보낸다. OAuth 경유 시엔
  //   cnr_deeplink 로 저장된 값을 로그인 완료 후 소비한다 (booking- 패턴 동일).
  useEffect(() => {
    if (!authUser || loading) return
    const hash  = window.location.hash.replace('#', '')
    const saved = sessionStorage.getItem('cnr_deeplink') ?? ''
    if (hash !== 'myloans' && saved !== 'myloans') return
    setMyPageInitialTab('book')
    setView('mypage')
    if (saved === 'myloans') sessionStorage.removeItem('cnr_deeplink')
    if (hash === 'myloans') {
      // booking- 딥링크와 동일 규칙: 소비 후 해시 정리 (재진입 오동작 방지)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [authUser?.user_id, loading])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── [P2 v7 / 2026-05-12 페이지 컨텍스트 보존] booking-{id} 딥링크 → DetailModal 자동 오픈 ──
  //
  // 이메일 CTA 공통 규칙: "해당 예약에 대한 액션" 버튼은 해당 예약 모달 직접 연결
  //   · 딥링크 스킴: {APP_URL}#booking-{BOOKING_ID}
  //   · 감지 조건: bookings 로드 완료 + 예약 찾음 + 동일 예약 모달이 이미 열려있지 않음
  //   · 동작: 현재 view 그대로 유지 + DetailModal(해당 예약) 자동 오픈
  //   · 1회성: 모달 열린 후 sessionStorage 플래그 정리 + 해시만 제거 (view 변경 X)
  //
  // ← [2026-05-12] 페이지 강제 이동 제거
  //   기존: hash가 'booking-'으로 시작 시 window.location.hash = 'mypage' → setView('mypage') 트리거
  //   변경: history.replaceState로 hash만 제거 → 현재 view(home/calendar/admin/mypage) 그대로 유지
  //   의도: 사용자가 home에서 메일 클릭 후 같은 탭에 돌아오면 home 컨텍스트에서 DetailModal만 오픈
  //
  // ← [2026-05-12] hashchange 이벤트 + modal 의존성 추가
  //   기존: bookings.length 변동 시에만 실행 → 이미 앱이 열린 상태에서 메일 다시 클릭 시 안 열림
  //   변경: hashchange 리스너 + modal?.data?.id 의존성 → 다른 예약 메일 연속 클릭도 대응
  //
  // 대상 이벤트: created, updated, approved, checkin_*, early_end 등
  // 참고: admin-booking-{id}는 AdminView에서 별도 처리 (본 로직은 일반 사용자용)
  useEffect(() => {
    if (!authUser || loading) return
    if (bookings.length === 0) return

    const tryOpenDeeplink = () => {
      const hash       = window.location.hash.replace('#', '')
      const savedHash  = sessionStorage.getItem('cnr_deeplink') ?? ''
      const deeplink   = hash.startsWith('booking-') ? hash :
                         savedHash.startsWith('booking-') ? savedHash : ''

      if (!deeplink) return

      const bookingId  = deeplink.replace('booking-', '')
      if (!bookingId) return

      const target = bookings.find(b => b.id === bookingId)
      if (!target) {
        // 예약이 없음 (삭제됨/권한 없음) — 조용히 딥링크 정리
        console.warn('[deeplink] 예약을 찾을 수 없음:', bookingId)
        sessionStorage.removeItem('cnr_deeplink')
        if (hash.startsWith('booking-')) {
          // ← [2026-05-12] view 변경 없이 hash만 제거 (현재 페이지 컨텍스트 유지)
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
        return
      }

      // ← [2026-05-12] 이미 같은 예약 모달이 열려있으면 재오픈하지 않음 (불필요한 리렌더 방지)
      if (modal?.type === 'detail' && (modal.data as any)?.id === bookingId) {
        sessionStorage.removeItem('cnr_deeplink')
        if (hash.startsWith('booking-')) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
        return
      }

      // 모달 오픈 + 딥링크 정리
      setModal({ type: 'detail', data: target })
      sessionStorage.removeItem('cnr_deeplink')
      // ← [2026-05-12] view 변경 없이 hash만 제거 (현재 페이지 컨텍스트 유지)
      //   기존: window.location.hash = 'mypage' → 강제 mypage 이동
      //   변경: history.replaceState → URL 정리만, 현재 view 보존
      if (hash.startsWith('booking-')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }

    // ① 마운트/의존성 변경 시 1회 실행
    tryOpenDeeplink()

    // ② hashchange 리스너: 이미 앱에 있는 상태에서 메일 클릭 시 같은 탭에 hash 갱신만 발생하는 케이스 대응
    //    (브라우저가 같은 탭으로 포커스 이동 + hash 변경만 일어남, 페이지 리로드 X)
    const onHashChange = () => tryOpenDeeplink()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [authUser?.user_id, loading, bookings.length, modal?.data?.id])

  // 틱 타이머 + Realtime + 이벤트 리스너 + 탭 복귀 새로고침 (마운트 1회)
  useEffect(() => {
    // ① 10초마다 tick → 시간 기반 UI 상태 즉시 반영 (체크인 대기/사용중 등)
    // [2026-04-19 P1 복구] 자정 경계 selectedDate 갱신 로직 제거
    //   · 문제: 사용자가 캘린더뷰에서 의도적으로 과거 날짜로 이동해도 10초마다
    //           오늘로 튕겨나가는 치명적 버그 발생 (어제/과거 예약 탐색 불가)
    //   · 원인: "사용자 의도 과거 이동"과 "stale 날짜"를 구분할 방법 없이
    //           `prev < today` 조건만으로 무조건 덮어씀
    //   · 해결: 이 전역 보정은 제거. 과거 날짜 방어는 꼭 필요한 BookingModal
    //           내부에서만 처리 (initDate < today 일 때 today로 보정)
    const iv = setInterval(() => {
      setTick(t => t+1);
    }, 10000);

    // ── [2026-04-30 Step 3-A] state ↔ DB sync 보강 헬퍼 ────────────────────
    //   호출 시점:
    //     · Realtime 재연결 직후 (subscribeBookings의 onResubscribe)
    //     · 15분 주기 백업 sync (옵션 다 사각지대 보강 — 사일런트 메시지 누락 등)
    //   실패 시: console.error로 기록만 하고 silent skip (다음 sync 기회로 회복)
    const resyncFromDB = () => {
      loadBookings()
        .then(fresh => {
          setBookings(fresh)
          setModal(prev => {
            if (prev?.type !== 'detail') return prev
            const updated = fresh.find((b: any) => b.id === (prev.data as any)?.id)
            return updated ? { ...prev, data: updated } : prev
          })
        })
        .catch(err => console.error('[step3a] resync 실패:', err))
    }

    // ② Realtime 구독 → 다른 사람 예약/취소/체크인 시 즉시 반영
    // 500ms 디바운스: Realtime 재연결 시 연속 호출로 인한 auth lock 경쟁 방지
    let realtimeDebounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeBookings(
      () => {
        if (realtimeDebounce) clearTimeout(realtimeDebounce);
        realtimeDebounce = setTimeout(() => {
          loadBookings().then(fresh => {
            setBookings(fresh)
            setModal(prev => {
              if (prev?.type !== 'detail') return prev
              const updated = fresh.find((b: any) => b.id === (prev.data as any)?.id)
              return updated ? { ...prev, data: updated } : prev
            })
          })
        }, 500);
      },
      // ← [2026-04-30 Step 3-A] 끊김 회복 시 fresh data 강제 sync
      //   Supabase Realtime은 끊김 후 자동 재연결됨 → SUBSCRIBED status 다시 호출됨
      //   그 사이 놓친 메시지가 있을 수 있어 명시적으로 loadBookings 트리거
      resyncFromDB,
    );

    // ── [2026-04-30 Step 3-A] 10분 주기 백업 sync ──────────────────────────
    //   옵션 다(Realtime 끊김 감지)의 사각지대 보강:
    //     · 사일런트 메시지 누락 (연결은 살아있으나 일부 메시지 손실)
    //     · OS 레벨 sleep 등으로 timeout 감지가 늦는 케이스
    //   주기 결정 근거:
    //     · 너무 짧으면 Realtime 메시지 폭증 사건(2026-04-22, 9.74M/일) 재발 우려
    //       (단 이건 WebSocket 채널 문제이고 본 sync는 HTTP 채널이라 직접 무관)
    //     · 옵션 다가 99% 케이스를 잡으므로 백업은 보수적으로 운용
    //   비용: 사용자 300명 × 6회/시간 × 8시간 ≈ 14,400 쿼리/일 (낮음)
    const syncIv = setInterval(resyncFromDB, 10 * 60 * 1000);

    // ③ Page Visibility API → 탭 복귀 시 데이터 강제 새로고침
    // (자리 비운 사이 바뀐 예약 상태를 즉시 반영)
    // [2026-04-19 P1 복구] 탭 복귀 시 selectedDate 갱신 제거 (위 10초 tick과 동일한 이유)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadBookings().then(b => setBookings(b));
        setTick(t => t+1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ④ 예약하기 이벤트
    const handler = () => setModal({type:"new", prefill:{}});
    document.addEventListener("openNewBooking", handler);

    return () => {
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
      clearInterval(iv);
      clearInterval(syncIv);  // ← [2026-04-30 Step 3-A] 10분 주기 백업 sync 정리
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener("openNewBooking", handler);
      unsubscribe();
    };
  }, []);

  // 드롭다운 외부 클릭 닫기
  // ← [2026-05-04] dropdown 외부클릭 → ProfileDropdown 내부로 이동 (Phase 1+2 Step 2)
  //                notif 외부클릭 → NotificationBell 내부로 이동 (Phase 1+2 Step 3)
  //                각 컴포넌트가 자체 외부클릭 effect 보유 (자기완결성 ↑)

  const showToast = useCallback((msg, type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null), 3500);
  }, []);

  // ── 이메일 알림 발송 (Fire & Forget — 실패해도 예약 로직에 영향 없음) ──
  const sendNotification = useCallback(async (
    type: 'created' | 'updated' | 'cancelled' | 'noshow' | 'pending' | 'approved' | 'rejected' | 'attendee_removed' | 'early_end' | 'owner_changed' | 'former_booker' | 'created_on_behalf',  // ← [2026-06-12] created_on_behalf 추가 (대리 예약)
    booking: any,
  ) => {
    try {
      // anon key로 호출 (Edge Function JWT 검증 비활성화)
      // 수신자(예약자·참석자) 이메일은 Edge Function이 DB에서 직접 조회
      const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${supabaseAnon}`,
          'apikey':        supabaseAnon,
        },
        body: JSON.stringify({ type, booking }),
      })
    } catch (e) {
      console.warn('[notify] 알림 발송 실패 (예약은 정상 처리됨):', e)
    }
  }, []);



  const [isSubmitting, setIsSubmitting] = useState(false);

  const addBooking = useCallback(async (form, date) => {
    if (isSubmitting) return false;
    setIsSubmitting(true);
    try {
      const d     = date || selectedDate;
      const fStart = timeToMin(form.start), fEnd = timeToMin(form.end);
      // ← [2026-06-12] 대리 예약 대상(요청자). 어드민 + bookerOverride 있을 때만. 대리 예약은 단건만(되풀이 불가).
      const onBehalf = (isAdmin && form.bookerOverride) ? form.bookerOverride : null;
      const recur  = onBehalf ? "NEVER" : (form.recur || "NEVER"); // "NEVER" | "EVERY_DAY" | "EVERY_WEEK"

      // ── 기본 유효성 ──
      // ← [2026-07-27 목적] 목적 필수 + 기타면 상세 필수 (모달 canSubmit과 동일 계약)
      if (!form.room_id || !form.title.trim() || fStart >= fEnd
          || !form.purpose || (form.purpose === 'etc' && !form.purposeDetail?.trim())) {
        showToast("예약 정보를 확인해주세요.", "error");
        return false;
      }
      // is_admin_only 회의실은 pending 상태로 생성 (아래 isAdminOnlyRoom 변수로 처리)

      // ── 반복 날짜 목록 생성 ──
      // ← [2026-05-28] 반복 종료일 정책: today+1개월 → 올해 12/31 (어드민 전용 기능, recurPreview와 동일)
      const maxD = new Date(); maxD.setMonth(11, 31); // ← 11=12월, 31일 → 올해 마지막날(연도 불변)
      const maxDateStr = objToStr(maxD);
      const targetDates = [];
      if (recur === "NEVER") {
        targetDates.push(d);
      } else {
        const startDow = dateToObj(d).getDay(); // 시작 요일 (EVERY_WEEK 용)
        let cur = dateToObj(d);
        const max = dateToObj(maxDateStr);
        while (cur <= max) {
          const ds  = objToStr(cur);
          const dow = cur.getDay();
          if (recur === "EVERY_DAY") {
            targetDates.push(ds);
          } else if (recur === "EVERY_WEEK" && dow === startDow) {
            targetDates.push(ds);
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      if (targetDates.length === 0) {
        showToast("반복 예약 가능한 날짜가 없습니다.", "error");
        return false;
      }

      // ── freshBookings 준비 ──
      // 단건(NEVER): canSubmit이 이미 충돌 검사를 마쳤으므로 메모리 상태 직접 사용.
      // 반복(EVERY_DAY/WEEK): 다수 날짜를 루프 돌며 freshBookings를 갱신해가므로
      //                       storage에서 최신값을 로드해 race condition 방지.
      let freshBookings;
      if (recur === "NEVER") {
        freshBookings = bookings;
      } else {
        try { freshBookings = await loadBookings(); }
        catch (_) { freshBookings = bookings; }
      }

      // ── 날짜별 충돌 검사 → 충돌 날짜 스킵, 나머지 생성 ──
      const room  = rooms.find(r => r.room_id === form.room_id);
      const floor = getFloor(room?.floor_id);
      // is_admin_only 회의실(에메랄드)이면 pending 상태로 생성
      const isAdminOnlyRoom = room?.is_admin_only ?? false
      const createdAt    = Date.now();
      const recurGroupId = recur !== "NEVER" ? `rg_${createdAt}` : null;
      const newBookings  = [];
      let   skipped      = 0;

      for (let i = 0; i < targetDates.length; i++) {
        const td    = targetDates[i];
        const check = hasTimeConflict(freshBookings, form.room_id, td, fStart, fEnd);
        if (check.conflict) { skipped++; continue; }

        const nb = {
          id:           `b${createdAt}_${i}`,
          room_id:      form.room_id,
          title:        form.title,
          memo:         form.memo,
          // ← [2026-07-27 목적] 목적 코드 + 기타 상세 — 반복 예약도 전 회차 동일값 (루프 내 동일 form 복제)
          purpose:       form.purpose ?? null,
          purposeDetail: form.purpose === 'etc' ? (form.purposeDetail?.trim() || null) : null,
          attendees:    form.attendees || [],
          start_at:     makeTZ(td, form.start),
          end_at:       makeTZ(td, form.end),
          user:         onBehalf ? onBehalf.name : currentUser,   // ← [2026-06-12 대리예약] 요청자 이름
          dept:         onBehalf ? onBehalf.dept : currentDept,   // ← [2026-06-12 대리예약] 요청자 부서
          checkedIn:    false,
          autoCancelled:false,
          status:       onBehalf ? 'confirmed' : (isAdminOnlyRoom ? 'pending' : 'confirmed'),  // ← [2026-06-12 대리예약] 관리자 권한으로 즉시 확정(에메랄드 포함)
          createdAt,
          recurGroupId,  // null이면 단건, 값이 있으면 반복 그룹
        };
        newBookings.push(nb);
        // 이후 루프의 충돌 검사에도 새 예약 반영
        freshBookings = [nb, ...freshBookings];
      }

      if (newBookings.length === 0) {
        showToast("선택한 시간에 모든 날짜가 이미 예약되어 있습니다.", "error");
        return false;
      }

      // ── Supabase 저장 ──
      try {
        for (const nb of newBookings) {
          await insertBooking(nb, onBehalf ? { user_id: onBehalf.user_id, email: onBehalf.email } : undefined);  // ← [2026-06-12 대리예약] 예약자 override 전달
        }
      } catch (err: any) {
        // ← [2026-07-30] 서버 재직 가드(20260735 트리거) 에러 한글 매핑 —
        //   LEAVE_CANNOT_CREATE / AFTER_DEPARTURE_DATE 원문 노출 방지. 그 외는 기존 동작.
        // ← [2026-08-10 이용제재] 노쇼 제재 차단(NOSHOW_PENALTY_BLOCKED) 매핑을 최우선 —
        //   서버 트리거(20260743)가 유일한 강제 지점, 프론트는 문구 변환만 담당
        showToast(noshowPenaltyErrorMessage(err) ?? employmentErrorMessage(err) ?? err.message ?? "예약 저장에 실패했습니다.", "error");
        return false;
      }

      // ── UI 즉시 반영 (Realtime 오기 전 낙관적 업데이트) ──
      setBookings(prev => {
        const ids = new Set(newBookings.map(b => b.id));
        return [...prev.filter(b => !ids.has(b.id)), ...newBookings];
      });

      // ── 완료 피드백 ──
      if (recur === "NEVER") {
        setModal({ type: "bookingDone", data: newBookings[0] });
        // 이메일 알림 발송
        const createdRoom = rooms.find(r => r.room_id === newBookings[0].room_id)
        const roomNameForNotif = createdRoom?.room_name ?? createdRoom?.room_name_ko ?? String(newBookings[0].room_id) + 'F'
        if (onBehalf) {
          // ← [2026-06-12 대리예약] 요청자+참석자에게 'created_on_behalf' — 대리 생성한 관리자 정보 포함
          sendNotification('created_on_behalf', {
            ...newBookings[0],
            user_id:      onBehalf.user_id,                 // 예약자 = 요청자 (resolver 수신자 해석 기준)
            user_name:    onBehalf.name,
            user_email:   onBehalf.email,
            user_dept:    onBehalf.dept,
            admin_name:   currentUser,                      // 대리 생성한 관리자 (이메일 "대리 예약" 행)
            admin_avatar: (authUser as any)?.avatar_url ?? null,
            room_name:    roomNameForNotif,
          })
        } else {
          const notifPayload = {
            ...newBookings[0],
            user_id:    authUser?.user_id ?? '',
            user_name:  currentUser,
            user_email: authUser?.email ?? '',
            user_dept:  currentDept,
            room_name:  roomNameForNotif,
          }
          if (isAdminOnlyRoom) {
            // 승인 요청 — admin emails는 Edge Fn이 DB에서 직접 조회
            sendNotification('pending', notifPayload)
          } else {
            sendNotification('created', notifPayload)
          }
        }
      } else {
        setModal({ type: "recurDone", data: {
          bookings: newBookings,
          skipped,
          recur,
          room: rooms.find(r => r.room_id === form.room_id),
          floor: getFloor(rooms.find(r => r.room_id === form.room_id)?.floor_id),
        }});
        // 반복 예약 이메일 알림 — 1회 발송 (recurBookings에 전체 일정 포함)
        const notifType = isAdminOnlyRoom ? 'pending' : 'created'
        const bkRoom = rooms.find(r => r.room_id === form.room_id)
        sendNotification(notifType, {
          ...newBookings[0],
          user_id:      authUser?.user_id ?? '',
          user_name:    currentUser,
          user_email:   authUser?.email ?? '',
          user_dept:    currentDept,
          room_name:    bkRoom?.room_name ?? bkRoom?.room_name_ko ?? String(newBookings[0].room_id) + 'F',
          recurBookings: newBookings.map(bk => ({ start_at: bk.start_at, end_at: bk.end_at })),
        })
      }
      // Audit log만 프론트에서 처리
      // ← [2026-04-18 P2] 인앱 알림 3개 블록(예약자/관리자/참석자) 제거됨
      //   이유: send-notification Edge Function이 이메일+인앱 모두 담당하도록 통합됨
      //         sendNotification('created' 또는 'pending', ...) 호출 시 자동으로
      //         booker/attendees/admins에게 인앱 알림 INSERT됨 (sendInAppForAllRoles)
      //   결과: notifications 테이블에 같은 알림이 2번 INSERT되던 중복 문제 해결
      for (const bk of newBookings) {
        insertAuditLog({
          // ← [2026-06-12 대리예약] onBehalf면 전용 action + 요청자/관리자 정보 기록 (관리자 화면 노출용)
          action: onBehalf ? 'BOOKING_CREATED_ON_BEHALF' : 'BOOKING_CREATED', entityType: 'booking', entityId: bk.id,
          actorName: currentUser,  // 대리 생성한 관리자
          afterData: onBehalf
            ? { title: bk.title, room_id: bk.room_id, start_at: bk.start_at, end_at: bk.end_at,
                booker_user_id: onBehalf.user_id, booker_name: onBehalf.name, booker_dept: onBehalf.dept, on_behalf_by: currentUser }
            : { title: bk.title, room_id: bk.room_id, start_at: bk.start_at, end_at: bk.end_at }
        }).catch(() => {})
      }
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }, [bookings, selectedDate, currentUser, currentDept, showToast, isSubmitting, isAdmin, rooms, authUser, sendNotification]);  // ← [2026-06-12] rooms/authUser/sendNotification 의존성 추가

  const checkIn = useCallback(async (id) => {
    // pending 상태면 체크인 불가
    const target = bookings.find(b => b.id === id)
    if (target?.status === 'pending') {
      showToast('관리자 승인 후 체크인 가능합니다.', 'info'); return;
    }
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:true} : b));
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, { checkedIn: true })
    insertAuditLog({ action: 'BOOKING_CHECKIN', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{});
      showToast("체크인 완료!");
      if (authUser?.user_id && target) {
        const r = rooms.find(rm => rm.room_id === target.room_id)
        insertNotification({
          userId: authUser.user_id, type: 'booking_checkin',
          title: '체크인 완료',
          body: `${target.title} · ${r?.room_name ?? ''} · ${fmtTSDateFull(target.start_at)} ${fmtTSFull(target.start_at)}`,
          bookingId: id,
        }).catch(() => {})
      }
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:false} : b));
      showToast(err.message ?? "체크인에 실패했습니다.", "error");
    }
  }, [showToast, bookings, rooms, authUser?.user_id]);

  const earlyEnd = useCallback(async (id) => {
    const now = nowMinutes();
    const target = bookings.find(b => b.id === id);
    if (!target) return;
    // 현재 시각이 start_at보다 최소 1분 이후여야 constraint 통과
    const startMin  = tsMin(target.start_at);
    const safeNow   = Math.max(now, startMin + 1);
    const endTimeStr = `${fmt2(Math.floor(safeNow/60))}:${fmt2(safeNow%60)}`;
    // start_at의 날짜가 UTC로 저장됐을 수 있으므로 KST 날짜 기준으로 계산
    const todayKST  = todayStr();
    const newEndAt  = makeTZ(todayKST, endTimeStr);

    // 낙관적 UI 업데이트 — end_at 유지, originalEndAt에 원본 저장
    setBookings(prev => prev.map(b => b.id===id
      ? {...b, originalEndAt: target.end_at, end_at: newEndAt, earlyEnded: true} : b
    ));
    setModal(null);  // ← [2026-04-29] 다이얼로그 경유 구조로 변경됨에 따라 추가 (cancelBooking 패턴 동일)
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, {
        earlyEnded: true,
        end_at: newEndAt,
        originalEndAt: target.end_at,  // 원래 예약 종료 시간 보존
      });
      insertAuditLog({ action: 'BOOKING_EARLY_END', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{})
      showToast("사용 완료! 회의실이 반환되었습니다.");

      // ← [2026-04-19 P2 v7] 조기 반납 이메일 + 인앱 알림 발송
      //   · 기존: App.tsx가 insertNotification 직접 호출 (프론트 전용, 이메일 없음)
      //   · 변경: sendNotification('early_end')으로 변경 → send-notification이 이메일+인앱 전담
      //   · 수신자: 예약자 본인만 (booker_only, POLICIES.early_end.recipients)
      //   · 배송 3 원칙 유지: 프론트 직접 INSERT 제거, 중복 방지
      if (target) {
        const r = rooms.find(rm => rm.room_id === target.room_id)
        sendNotification('early_end', {
          ...target,
          end_at:         newEndAt,               // 실제 반납 시간으로 교체
          original_end_at: target.end_at,         // 원래 종료 시간 (이메일 본문 참조용)
          user_name:      target.user,
          user_dept:      target.dept,
          room_name:      r?.room_name ?? r?.room_name_ko ?? '',
        })
      }
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id
        ? {...b, end_at: target.end_at, earlyEnded: false, originalEndAt: null} : b
      ));
      showToast(err.message ?? "조기 반납에 실패했습니다.", "error");
    }
  }, [bookings, showToast, rooms, authUser?.user_id]);

  const cancelBooking = useCallback(async (id) => {
    // 취소 전 예약 정보 먼저 저장 (낙관적 업데이트 전에)
    const targetBooking = bookings.find(b => b.id === id);
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:true} : b));
    setModal(null);
    try {
      // ← [2026-05-04 옵션 B] apiCancelBooking에 authUser.user_id 전달 (필수 파라미터)
      //   · DB cancelled_by_user_id에 누가 취소했는지 저장
      //   · BookingStatusBadge가 b.cancelledByUserId === b.user_id 비교로
      //     "예약자 취소" / "참석자 취소" 라벨 분기에 사용
      await apiCancelBooking(id, authUser?.user_id ?? '')
    insertAuditLog({ action: 'BOOKING_CANCELLED', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{});
    // ← [2026-04-18 P2] 예약자 인앱 알림 제거 — send-notification('cancelled')이 담당
      showToast("예약이 취소되었습니다.", "info");
      // 이메일 알림 발송
      if (targetBooking) {
        const cancelledRoom = rooms.find(r => r.room_id === targetBooking.room_id)
        sendNotification('cancelled', {
          ...targetBooking,
          user_name:  targetBooking.user,
          user_dept:  targetBooking.dept,
          room_name:  cancelledRoom?.room_name ?? cancelledRoom?.room_name_ko ?? String(targetBooking.room_id) + 'F',
        });
      }
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:false} : b));
      showToast(err.message ?? "취소에 실패했습니다.", "error");
    }
  }, [bookings, showToast, sendNotification, authUser?.user_id]);  // ← [옵션 B] authUser?.user_id 의존성 추가

  // ── [2026-04-19 P2 v8] 예약 취소 확인 다이얼로그 경유 헬퍼 ─────────────────
  //   용도: DetailModal, HomeView, MyPage의 "예약 취소" 버튼에서 호출
  //   정책 변경 이력:
  //     · [P2 v8] DetailModal에서만 confirm dialog 거치도록 분리
  //     · [P8-A 2026-04-24] HomeView/MyPage 소형카드 취소 버튼도 본 헬퍼 사용 —
  //       취소 UX 전면 통일 (cancelBooking 직접 호출은 에러 복구 경로에서만 사용)
  //   구현: setModal로 ConfirmCancelModal 띄우고, 확정 시 cancelBooking 실행
  const confirmAndCancelBooking = useCallback((id: string) => {
    const targetBooking = bookings.find(b => b.id === id)
    if (!targetBooking) return
    setModal({
      type: 'confirmCancel',
      data: {
        booking: targetBooking,
        onConfirm: () => cancelBooking(id),
      },
    })
  }, [bookings, cancelBooking])

  // ── 에메랄드 승인/거절 ─────────────────────────────────────────────────────
  const approvePendingBooking = useCallback(async (id: string) => {
    try {
      await approveBooking(id, currentUser, authUser?.avatar_url ?? null)
      const target = bookings.find(b => b.id === id)
      setBookings(prev => prev.map(b => b.id===id ? {
        ...b, status:'confirmed',
        processedByName: currentUser,
        processedByAvatar: authUser?.avatar_url ?? null,
      } : b))
      // 승인 이메일 — admin_name/admin_avatar 포함
      if (target) {
        const approvedRoom = rooms.find(r => r.room_id === target.room_id)
        sendNotification('approved', {
          ...target,
          user_name:    target.user,
          user_dept:    target.dept,
          room_name:    approvedRoom?.room_name ?? approvedRoom?.room_name_ko ?? '',
          admin_name:   currentUser,
          admin_avatar: authUser?.avatar_url ?? null,
        })
      }
      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('approved')가 booker + attendees에게 자동 INSERT
      showToast('예약이 승인되었습니다.')
    } catch (err: any) { showToast(err.message, 'error') }
  }, [showToast, bookings, rooms, users, sendNotification])

  const rejectPendingBooking = useCallback(async (id: string, reason: string) => {
    setModal(null)  // ← [2026-04-29] 다이얼로그 경유 구조 (confirmAndRejectBooking) — cancelBooking 패턴 동일
    try {
      await rejectBooking(id, reason, currentUser, authUser?.avatar_url ?? null)
      const target = bookings.find(b => b.id === id)
      setBookings(prev => prev.map(b => b.id===id ? {
        ...b, status:'rejected', autoCancelled:true, cancelledBy:'admin',
        processedByName: currentUser,
        processedByAvatar: authUser?.avatar_url ?? null,
      } : b))
      // 거절 이메일 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
      if (target) {
        const rejectedRoom = rooms.find(r => r.room_id === target.room_id)
        sendNotification('rejected', {
          ...target,
          user_name:     target.user,
          user_dept:     target.dept,
          room_name:     rejectedRoom?.room_name ?? rejectedRoom?.room_name_ko ?? '',
          reject_reason: reason || '관리자 거절',
          admin_name:    currentUser,                   // 거절한 관리자 이름
          admin_avatar:  authUser?.avatar_url ?? null,  // 관리자 아바타
        })
      }
      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('rejected')가 booker + attendees에게 자동 INSERT
      showToast('예약이 거절되었습니다.', 'info')
    } catch (err: any) { showToast(err.message, 'error') }
  }, [showToast, bookings, rooms, users, sendNotification])

  // ── 관리자 강제 취소 ────────────────────────────────────────────────────────
  const adminForceCancelBooking = useCallback(async (id: string, reason: string) => {
    const targetB = bookings.find(b => b.id === id)
    // ← [2026-04-23 HOTFIX] 실패 롤백용 원본 status 저장
    const originalStatus = targetB?.status
    try {
      // ← [2026-05-04 옵션 B] adminForceCancel에 authUser.user_id 전달 (필수 파라미터)
      //   · DB cancelled_by_user_id에 어느 관리자가 취소했는지 저장
      //   · 향후 감사 로그 / 알림 메시지에 활용 가능
      await adminForceCancel(id, authUser?.user_id ?? '')
      // 낙관적 UI 업데이트
      // ← [2026-04-23 HOTFIX] status:'cancelled' 추가 (api.ts adminForceCancel과 동기화)
      // ← [2026-05-04 옵션 B] cancelledByUserId도 낙관적 업데이트에 포함
      setBookings(prev => prev.map(b => b.id === id ? {
        ...b,
        status: 'cancelled',
        autoCancelled: true,
        cancelledBy: 'admin',
        cancelledByUserId: authUser?.user_id ?? null,
      } : b))
      setModal(null)  // ← [2026-04-29] 다이얼로그 경유 구조 (confirmAndAdminForceCancel) — earlyEnd 패턴 동일

      // Audit log
      insertAuditLog({
        action: 'ADMIN_FORCE_CANCEL', entityType: 'booking', entityId: id,
        actorName: currentUser,
        afterData: { reason, title: targetB?.title, user: targetB?.user },
      }).catch(() => {})

      // ← [2026-04-18 P2] 예약자 인앱 알림 제거
      //   send-notification('cancelled' + admin_force=true)가 booker + attendees에게 자동 INSERT

      // 이메일 알림 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
      if (targetB) {
        const cancelledRoom = rooms.find(r => r.room_id === targetB.room_id)
        sendNotification('cancelled', {
          ...targetB,
          user_name:     targetB.user,
          user_dept:     targetB.dept,
          room_name:     cancelledRoom?.room_name ?? cancelledRoom?.room_name_ko ?? '',
          admin_force:   true,
          cancel_reason: reason || '관리자 강제 취소',
        })
      }

      showToast('예약이 강제 취소되었습니다.', 'info')
    } catch (err: any) {
      // 실패 시 롤백
      // ← [2026-04-23 HOTFIX] status도 원본으로 복원 (낙관적 UI 수정 대응)
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: originalStatus, autoCancelled: false, cancelledBy: null } : b))
      showToast(err.message ?? '취소 중 오류가 발생했습니다.', 'error')
    }
  }, [bookings, rooms, users, currentUser, showToast, sendNotification, authUser?.user_id])  // ← [옵션 B] authUser?.user_id 의존성 추가

  // ── [2026-04-29] 조기반납 확인 다이얼로그 경유 헬퍼 ─────────────────────
  //   용도: HomeView 소형카드 "조기반납" 버튼
  //   구현: setModal로 ConfirmEarlyEndModal 띄우고, 확정 시 earlyEnd 실행
  const confirmAndEarlyEnd = useCallback((id: string) => {
    const targetBooking = bookings.find(b => b.id === id)
    if (!targetBooking) return
    setModal({
      type: 'confirmEarlyEnd',
      data: {
        booking: targetBooking,
        onConfirm: () => earlyEnd(id),
      },
    })
  }, [bookings, earlyEnd])

  // ── [2026-04-29] 승인거절 확인 다이얼로그 경유 헬퍼 ─────────────────────
  //   용도: DetailModal 관리자 권한 "거절" 버튼 (기존 인라인 flow 대체)
  //   구현: setModal로 ConfirmRejectModal 띄우고, 확정 시 rejectPendingBooking(id, reason) 실행
  const confirmAndRejectBooking = useCallback((id: string) => {
    const targetBooking = bookings.find(b => b.id === id)
    if (!targetBooking) return
    setModal({
      type: 'confirmReject',
      data: {
        booking: targetBooking,
        onConfirm: (reason: string) => rejectPendingBooking(id, reason),
      },
    })
  }, [bookings, rejectPendingBooking])

  // ── [2026-04-24 P8-B] 강제취소 확인 다이얼로그 경유 헬퍼 ─────────────────
  //   용도: AdminPage 예약 관리 탭 + DetailModal 관리자 권한 강제취소 버튼
  //   동기: DetailModal이 하드코딩 사유('관리자 강제취소')로 즉시 호출하던 버그 해결
  //   구현: setModal로 ConfirmForceCancelModal 띄우고, 확정 시 adminForceCancelBooking 실행
  //         (cancelBooking → confirmAndCancelBooking 패턴과 동일)
  //   onConfirm은 사유 문자열을 받아 adminForceCancelBooking(id, reason)에 전달
  const confirmAndAdminForceCancel = useCallback((id: string) => {
    const targetBooking = bookings.find(b => b.id === id)
    if (!targetBooking) return
    setModal({
      type: 'confirmForceCancel',
      data: {
        booking: targetBooking,
        onConfirm: (reason: string) => adminForceCancelBooking(id, reason),
      },
    })
  }, [bookings, adminForceCancelBooking])

  // ── [2026-06-12] 관리자 예약자(소유권) 변경 핸들러 ──────────────────────
  //   호출: ChangeOwnerModal onConfirm(newUserId) → handleChangeOwner(bookingId, newUserId)
  //   흐름: changeBookingOwner RPC(admin 검증+가드+참석자 자동제거+4스냅샷 원자 갱신)
  //        → 낙관적 UI 갱신 → 알림 2종 발사(attendee_removed 패턴과 동일)
  //   알림: ① owner_changed(새 예약자+참석자, Edge가 갱신된 user_id로 해석)
  //        ② former_booker(원래 예약자, payload.former_booker_user_id로 해석)
  const handleChangeOwner = useCallback(async (bookingId: string, newUserId: string) => {
    const prev = bookings.find(b => b.id === bookingId)            // ← 변경 전 예약 스냅샷
    if (!prev) { showToast('예약을 찾을 수 없습니다.', 'error'); return }
    try {
      // RPC — 실패 시 throw (api.ts에서 한글 메시지로 매핑됨)
      const res = await changeBookingOwner(bookingId, newUserId)  // ← { old_booker, new_booker, removed_from_attendees }

      const room     = rooms.find(r => r.room_id === prev.room_id)
      const roomName = room?.room_name ?? room?.room_name_ko ?? String(prev.room_id) + 'F'  // ← 알림 본문용 회의실명
      const newEmailLower = (res.new_booker.email ?? '').trim().toLowerCase()              // ← 참석자 제거 비교용

      // 낙관적 UI: 예약자 4-스냅샷 교체 + 새 예약자가 참석자였으면 목록에서 제거
      setBookings(prevList => prevList.map(b => {
        if (b.id !== bookingId) return b                          // ← 대상 예약만 수정
        const nextAttendees = res.removed_from_attendees           // ← RPC가 참석자 제거했으면 로컬도 동기화
          ? (b.attendees ?? []).filter(a => (a.email ?? '').trim().toLowerCase() !== newEmailLower)
          : b.attendees
        return {
          ...b,
          user_id:    res.new_booker.user_id,                     // ← 새 예약자 UUID
          user_email: res.new_booker.email,                      // ← 새 예약자 이메일 (isBooker email 경로)
          user:       res.new_booker.name,                       // ← 표시용 이름 스냅샷
          dept:       res.new_booker.dept,                       // ← 표시용 부서 스냅샷
          attendees:  nextAttendees,                             // ← 참석자 자동 제거 반영
        }
      }))
      setModal(null)                                              // ← 모달 닫기
      showToast('예약자가 변경되었습니다.')

      // ── 알림 ① owner_changed → 새 예약자 + 참석자 ────────────────
      //   Edge resolver가 갱신된 user_id로 새 예약자/참석자 해석 (DB 이미 커밋됨)
      sendNotification('owner_changed', {
        ...prev,
        user_id:   res.new_booker.user_id,                       // ← [필수] 새 예약자 — resolver 수신자 해석 기준
        user_name: res.new_booker.name,
        user_dept: res.new_booker.dept,
        room_name: roomName,
      })

      // ── 알림 ② former_booker → 원래 예약자 ──────────────────────
      //   payload.former_booker_user_id로 resolver가 원래 예약자 1명 해석
      sendNotification('former_booker', {
        ...prev,
        former_booker_user_id: res.old_booker.user_id,           // ← [필수] 원래 예약자 — resolver former_booker 규칙
        user_name: res.new_booker.name,                          // 본문은 현재(새) 예약자 기준 표시
        user_dept: res.new_booker.dept,
        room_name: roomName,
      })

      // ── 감사 로그 (실패해도 흐름 유지) ─────────────────────────────
      insertAuditLog({
        action: 'BOOKING_OWNER_CHANGED', entityType: 'booking', entityId: bookingId,
        actorName: currentUser,
        beforeData: { user_id: res.old_booker.user_id, user_name: res.old_booker.name },
        afterData:  { user_id: res.new_booker.user_id, user_name: res.new_booker.name },
      }).catch(() => {})
    } catch (err: any) {
      // 실패 시 서버 상태로 원복
      const latest = await loadBookings()
      setBookings(latest)
      showToast(err?.message ?? '예약자 변경에 실패했습니다.', 'error')
    }
  }, [bookings, rooms, showToast, sendNotification, currentUser])  // ← 의존성: 핸들러 내부 참조값

  const updateBooking = useCallback(async (form, date, originalId) => {
    if (!form.room_id || !form.title.trim() || timeToMin(form.start) >= timeToMin(form.end)) {
      showToast("예약 정보를 확인해주세요.", "error"); return false;
    }

    // ── Bug 2 방어: pending 예약은 변경 불가 ──────────────────────────
    const originalBooking = bookings.find(b => b.id === originalId)
    if (originalBooking?.status === 'pending') {
      showToast("승인 대기 중인 예약은 변경할 수 없습니다.", "error"); return false;
    }

    // ── 승인완료된 에메랄드룸 예약은 사용자만 변경 불가 ────────────────
    //   ← [2026-09-29] !isAdmin 한정 — 관리자는 승인 권한 보유자라 변경 허용
    //     (DetailModal editLockedByApproval = isApprovedAdminRoom && !isAdmin 과 동일 조건 — 버튼/저장 정합)
    const originalRoom = rooms.find(r => r.room_id === originalBooking?.room_id)
    if (!isAdmin && originalRoom?.is_admin_only && originalBooking?.status === 'confirmed') {
      showToast("승인 완료된 예약은 변경할 수 없습니다. 취소 후 재예약해주세요.", "error"); return false;
    }

    const otherBookings = bookings.filter(b => b.id !== originalId);
    const check = hasTimeConflict(otherBookings, form.room_id, date, timeToMin(form.start), timeToMin(form.end));
    if (check.conflict) {
      showToast("선택한 시간에 이미 예약이 있습니다.", "error"); return false;
    }

    // ── Bug 1: 변경 후 room이 에메랄드(is_admin_only)면 pending 재설정 ──
    //   ← [2026-09-29] 관리자 변경은 confirmed 유지 (고지 확정: "관리자 변경이므로 confirmed 유지")
    //     · 관리자 행위 = 승인 내재 — 대리예약 즉시 confirmed(L929)와 동일 원칙
    //     · 비관리자는 기존 식 그대로 (에메랄드로 이동 시 pending + Admin 알림)
    const newRoom = rooms.find(r => r.room_id === form.room_id)
    const newStatus = isAdmin ? 'confirmed' : (newRoom?.is_admin_only ? 'pending' : 'confirmed')

    const changes = {
      room_id:   form.room_id,
      title:     form.title,
      memo:      form.memo,
      // ← [2026-07-27 목적] 수정 모달 목적 변경 반영 — api.updateBooking이 etc 외 detail을 null로 정리
      purpose:       form.purpose ?? null,
      purposeDetail: form.purpose === 'etc' ? (form.purposeDetail?.trim() || null) : null,
      attendees: form.attendees || [],
      start_at:  makeTZ(date, form.start),
      end_at:    makeTZ(date, form.end),
      status:    newStatus as 'confirmed' | 'pending',
    };
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id === originalId ? { ...b, ...changes } : b));
    setModal(null);
    try {
      const prevBooking = bookings.find(b => b.id === originalId)

      // diff 계산: upsertBookingAttendees 전에 현재 참석자 조회
      const oldAttendeeEmails = changes.attendees !== undefined
        ? await getBookingAttendees(originalId)
        : []

      await apiUpdateBooking(originalId, changes);

      // attendees 변경 시 booking_attendees 업데이트
      if (changes.attendees !== undefined) {
        await upsertBookingAttendees(originalId, changes.attendees)
      }

      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('updated')가 booker + attendees에게 자동 INSERT
      //   pending 전환 시에도 send-notification('pending')이 자동 처리

      // ── [2026-04-29 Phase 1] 변경 diff 계산 (audit_log + 향후 메일 본문 공통) ──
      //   기존: title/start_at/end_at/room_id 4개 필드만 raw 저장 (memo/status/attendees 누락)
      //   변경: buildBookingDiff()로 변경된 필드만 정밀 추출 (변경 0개면 audit 스킵)
      //   효과: memo/status/attendees 변경도 audit, 변경 안 된 필드는 노이즈 제거
      const diffRecord = prevBooking ? buildBookingDiff(
        {
          title:    prevBooking.title,
          memo:     prevBooking.memo,
          status:   prevBooking.status,
          start_at: prevBooking.start_at,
          end_at:   prevBooking.end_at,
          room_id:  prevBooking.room_id,
        },
        changes,
        rooms,
        oldAttendeeEmails,
        changes.attendees as { email?: string; name?: string }[],
      ) : { before: {}, after: {} }

      // 변경 사항이 있을 때만 audit 기록 (빈 변경 노이즈 방지)
      if (Object.keys(diffRecord.after).length > 0) {
        insertAuditLog({
          action: 'BOOKING_UPDATED', entityType: 'booking', entityId: originalId,
          actorName: currentUser,
          beforeData: diffRecord.before,
          afterData:  diffRecord.after,
        }).catch(() => {})
      }
      showToast(newStatus === 'pending' ? "예약이 변경되었습니다. 관리자 승인 후 확정됩니다." : "예약이 변경되었습니다.");

      // ── 일반 → 에메랄드룸 변경으로 pending이 된 경우 → Admin 알림 ──
      if (newStatus === 'pending') {
        const pendingRoom = rooms.find(r => r.room_id === changes.room_id)
        // ← [2026-04-18 P2] 예약자/관리자 인앱 알림 제거
        //   Admin 이메일 알림 (Edge Fn 내부에서 booker/attendees/admins 인앱 자동 INSERT)
        if (prevBooking) {
          sendNotification('pending', {
            ...prevBooking, ...changes,
            user_name:  prevBooking.user,
            user_dept:  prevBooking.dept,
            room_name:  pendingRoom?.room_name ?? pendingRoom?.room_name_ko ?? '',
          })
        }
      }

      // 이메일 알림 발송
      const updatedB = bookings.find(b => b.id === originalId);
      if (updatedB) {
        const updatedRoom = rooms.find(r => r.room_id === (changes.room_id ?? updatedB.room_id))
        const basePayload = {
          ...updatedB, ...changes,
          user_name:  updatedB.user,
          user_dept:  updatedB.dept,
          room_name:  updatedRoom?.room_name ?? updatedRoom?.room_name_ko ?? String(updatedB.room_id) + 'F',
        }

        // 변경 알림 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
        sendNotification('updated', basePayload)

        // 제거된 참석자 별도 알림
        if (changes.attendees !== undefined) {
          const newAttendeeEmails = (changes.attendees as any[])
            .map(a => typeof a === 'string' ? a : (a as any).email ?? '')
            .filter(Boolean)
          const removedEmails = oldAttendeeEmails.filter(e => !newAttendeeEmails.includes(e))
          if (removedEmails.length > 0) {
            sendNotification('attendee_removed', {
              ...basePayload,
              removed_emails: removedEmails,  // Edge Function에서 직접 사용
            })
          }
        }
      }
    } catch (err: any) {
      // 실패 시 원복
      const latest = await loadBookings();
      setBookings(latest);
      showToast(err.message ?? "예약 변경에 실패했습니다.", "error");
    }
    return true;
  }, [bookings, showToast, isAdmin]);  // ← [2026-09-29] isAdmin 의존성 추가 (승인룸 변경 허용/상태 판정에 사용)

  // Auto-cancel: ① 노쇼(미체크인) 자동 취소  ② pending 승인 기한 초과 자동 취소
  //
  // ← [2026-04-22 HOTFIX v3] 노쇼 cancelled_by='user' 오염 근본 해결
  //    진단:
  //      · 기존 apiCancelBooking은 cancelled_by='user'로 DB 기록 → 시스템 자동 처리한 노쇼를
  //        "사용자 취소"로 오염시키는 치명적 버그
  //      · 과거 설계 복원: 노쇼는 반드시 cancelled_by='system'으로 기록해야
  //        (1) 화면에 노쇼 뱃지 표시 (cancelled_by='system' 필수 조건)
  //        (2) opacity 45% 잔존 정책 적용
  //        (3) cron이 이메일 발송 대상 식별
  //    해결:
  //      · api.ts에 markNoshow(id) 함수 추가 — cancelled_by='system'으로 기록
  //      · 노쇼 감지 시 apiCancelBooking 대신 markNoshow 호출
  //      · 프론트가 DB에 선점해도 cron이 이메일 발송 (noshow_notified 컬럼으로 중복 방지)
  //    과거 동작 복원:
  //      · 프론트 즉시 UI 반영 (Realtime 구독이 전 클라이언트에 전파)
  //      · cron은 최대 5분 내 이메일 발송 보장
  useEffect(() => {
    const now=nowMinutes(), today=todayStr(), nowMs=Date.now();

    // ① 노쇼: 오늘 예약 중 체크인 없이 CHECKIN_WINDOW_MIN 경과
    const toNoshow=bookings.filter(b=>
      tsDate(b.start_at)===today &&
      !b.checkedIn && !b.autoCancelled && b.cancelledBy == null && !b.earlyEnded &&
      b.status !== 'cancelled' &&                              // ← [변경] cancelled 건 차단 (pending·rejected보다 더 중요)
      b.status !== 'pending' && b.status !== 'rejected' &&
      now > tsMin(b.start_at)+CHECKIN_WINDOW_MIN
    );
    if(toNoshow.length>0){
      // ← [2026-08-27 시간가드] 낙관적 UI·audit 을 "서버가 실제로 마킹한 건"으로 한정
      //   배경: 8/27 13:00 사고 — 참석자 브라우저의 stale state + 클라이언트 시계로 13:15 예약이
      //         노쇼 마킹됨. 이전 구조는 DB 결과와 무관하게 먼저 state 를 노쇼로 바꾸고 audit 을
      //         남겨서, 가드에 막힌 9건도 가짜 BOOKING_NOSHOW audit 이 기록됐다.
      //   변경: markNoshow(RPC mark_noshow) 반환값 1인 건만 state 반영 + audit.
      //         0 = 서버(시계 SSOT) 거부 → state 유지, 다음 tick/Realtime 이 진실 반영.
      //         allSettled 로 한 건 예외가 나머지를 중단시키지 않음.
      Promise.allSettled(toNoshow.map(async b => {
        const n = await markNoshow(b.id)
        return n === 1 ? b.id : null
      })).then(results => {
        const marked = new Set<string>()
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) marked.add(r.value)
          else if (r.status === 'rejected') console.error('[noshow] markNoshow failed', r.reason)
        }
        if (marked.size === 0) return
        setBookings(prev => prev.map(b =>
          marked.has(b.id) ? {...b, status:'confirmed', autoCancelled:true, cancelledBy:'system'} : b
        ))
        // ← [2026-04-29 Phase 1] 노쇼 처리 audit 기록 (BOOKING_NOSHOW) — 실제 마킹된 건만
        for (const b of toNoshow) {
          if (!marked.has(b.id)) continue
          insertAuditLog({
            action: 'BOOKING_NOSHOW',
            entityType: 'booking',
            entityId: b.id,
            actorName: 'system',
            beforeData: { status: 'confirmed', checkedIn: false },
            afterData:  { status: 'confirmed', autoCancelled: true, cancelledBy: 'system' },
          }).catch(() => {})
        }
      })
    }

    // ② pending 승인 기한 초과: start_at 1분 전 이후 경과
    //
    // ← [2026-04-19 P2 v6] 프론트 DB 쓰기 제거 — Race Condition 근본 해결
    //   문제 진단 (DB 쿼리 검증 완료):
    //     · 프론트 useEffect가 start_at - 1분에 expirePendingBooking() 호출
    //       → DB에 auto_cancelled=true로 저장 (status는 pending 그대로)
    //     · auto-cancel-bookings cron은 `auto_cancelled=false` 필터로 쿼리
    //       → 프론트가 먼저 처리한 건은 cron 쿼리에서 **완전 배제**
    //     · 결과: send-notification('pending_expired') 호출 안 됨 → 이메일/인앱 누락
    //     · 증거: bookings 테이블에 status=pending + auto_cancelled=true인 행 17건 누적,
    //              notifications 테이블 pending_expired 알림 04-18 이후 0건
    //   해결:
    //     · 프론트는 낙관적 UI만 담당 (setBookings로 state만 업데이트)
    //     · DB 상태 변경은 auto-cancel-bookings cron이 단독 수행
    //     · cron이 처리 후 send-notification이 이메일+인앱 자동 발송
    //     · Realtime 구독(subscribeBookings)이 cron 결과를 프론트에 푸시하여 최종 동기화
    //   차이:
    //     · 노쇼(①)는 start_at + 10분 시점에 감지 → 그사이 cron이 먼저 돌아 문제 없음
    //     · pending_expired는 start_at - 1분 시점에 감지 → 프론트가 cron보다 먼저 선점
    //   최악 지연: 5분 (cron 주기). 이미 기한 초과된 상태이므로 업무상 허용 가능
    const pendingExpired = bookings.filter(b =>
      b.status === 'pending' && !b.autoCancelled &&
      b.room_id === 3 &&  // ← [변경] pending은 admin only 룸(room_id=3)에서만 발생
      nowMs >= new Date(b.start_at).getTime() - 60_000
    );
    if(pendingExpired.length > 0){
      const expiredIds = new Set(pendingExpired.map(b => b.id));
      // 낙관적 UI: state만 업데이트
      // ← [변경] status:'cancelled' 추가 — isExpiredPending 공식과 일치
      //   (status='cancelled' && cancelledBy='system' && room_id=3)
      // ← [2026-04-30 Step 2] state 가드 4종 추가 — DB 쓰기 없는 단독 방어
      //   배경: pending_expired는 cron 단독 DB 처리(P2 v6) 구조라 대칭할 DB 가드 없음.
      //         setBookings만 단독 방어 — admin 승인 덮어쓰기 등 잘못된 마킹 차단.
      //   메모리 원칙: pending에선 checkedIn/earlyEnded 의미 없음 → 가드에 추가 금지
      //               ("defensive bloat" 금지 원칙)
      setBookings(prev => prev.map(b => {
        if (!expiredIds.has(b.id))   return b
        if (b.room_id !== 3)         return b   // ★ 에메랄드 룸 외엔 pending_expired 자체가 불가
        if (b.status !== 'pending')  return b   // ★ admin 승인/사용자 취소/거절 덮어쓰기 차단
        if (b.autoCancelled)         return b   // 중복 마킹 방지 (멱등성)
        if (b.cancelledBy != null)   return b   // 누군가 처리한 건 보호
        return {...b, autoCancelled:true, cancelledBy:'system', status:'cancelled'}
      }));
      // ← expirePendingBooking() 호출 제거
      //   DB 쓰기는 auto-cancel-bookings cron이 단독 처리 (경쟁 조건 방지)
    }
  }, [tick]);

  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvH, off: vvOff } = useVisualViewport();

  // ── 인증 로딩 중 (Text Reveal) ──
  if (authLoading || (!authUser && !splashDone)) return (
    <div style={{
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      minHeight:"100vh",
      background: "#F5F7F9",
      gap: 10, position:"relative", overflow:"hidden"
    }}>
      <style>{`
        @keyframes cnr-reveal {
          0%   { clip-path: inset(0 100% 0 0); }
          15%  { clip-path: inset(0 100% 0 0); }
          72%  { clip-path: inset(0 0% 0 0); }
          100% { clip-path: inset(0 0% 0 0); }
        }
        @keyframes cnr-sub {
          0%, 68%  { opacity: 0; transform: translateY(8px); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes cnr-bar {
          0%   { transform: scaleX(0); }
          70%  { transform: scaleX(0.7); }
          100% { transform: scaleX(0.88); }
        }
      `}</style>

      {/* 로고 텍스트 */}
      <span style={{
        fontSize: 28, fontWeight: 600, letterSpacing: "-0.5px",
        color: dark ? "#F1F5F9" : "#1E293B",
        animation: "cnr-reveal 1.8s cubic-bezier(0.4,0,0.2,1) forwards"
      }}>C&amp;R Space</span>

      {/* 서브타이틀 */}
      <div style={{
        fontSize: 11, color: dark ? "#64748B" : "#94A3B8",
        letterSpacing:"0.02em",
        opacity:0,
        animation:"cnr-sub 2.2s ease forwards"
      }}>회의실 예약 시스템 연결 중...</div>

      {/* 하단 진행 바 */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, height:3,
        background: dark ? "rgba(241,245,249,0.1)" : "rgba(17,17,17,0.08)"
      }}>
        <div style={{
          height:"100%", background: dark ? "#F1F5F9" : "#111111",
          borderRadius:"0 2px 2px 0",
          transformOrigin:"left",
          animation:"cnr-bar 3s ease-out forwards"
        }}/>
      </div>
    </div>
  )

  // ── 미로그인 → 로그인 페이지 ──
  if (!authUser) return <LoginPage />

  // ── [2026-09-03] HR 인터뷰 임시 단독 페이지 (#hr-interview) ──
  //    헤더·푸터·드로어·모달·loading 스켈레톤을 모두 거치지 않는 풀블리드 트리.
  //    bookings/users 등 앱 마스터 데이터를 쓰지 않고 자체 API(hrInterviewApi)만 사용하므로 loading 게이트 앞에 둔다.
  //    로그인 게이트(authUser) 뒤라 Microsoft OAuth 세션은 그대로 승계. 종료 시 이 블록 + import + DIRECT_VIEWS 항목만 제거.
  if (view === 'hr-interview') return <HrInterviewPage />

  // ── 데이터 로딩 중 ──
  if (loading) {
    if (!showSkeleton) {
      // ── [2026-04-30] 0~200ms 윈도우: skeleton 미표시 + 빈 화면 방지 ──
      //    이전: return null → 흰색 빈 화면 → 콘텐츠 점프 (새로고침 느낌 X)
      //    이후: 본문 배경색만 표시 → 색 점프 없음 + 가벼운 인상 유지
      //    skeleton 정책 200/200 하이브리드와 짝을 이루어 동작.
      return <div style={{ minHeight: '100vh', background: '#F5F7F9' }} />;
    }
    // 현재 뷰에 맞는 스켈레톤 렌더
    const SkeletonComp = view === 'calendar' ? CalendarSkeleton
                       : view === 'mypage'   ? MyPageSkeleton
                       : view === 'admin'    ? AdminSkeleton
                       : null; // home: 헤더 스켈레톤만, 콘텐츠 영역은 비워둠
    return (
      <div style={{background:'#F5F7F9', minHeight:'100vh'}}>
        {/* 헤더 스켈레톤 — 좌:로고pill / 중:nav2개 / 우:유저pill */}
        <div style={{background:'#fff', height:60, borderBottom:'1px solid #E2E8F0',
          display:'flex', alignItems:'center', padding:'0 28px'}}>
          {/* 좌: 로고 */}
          <div className="sk-block" style={{width:120, height:36, borderRadius:999, flexShrink:0}} />
          {/* 중: 네비 탭 2개 — 가운데 정렬 */}
          <div style={{flex:1, display:'flex', justifyContent:'center', gap:8}}>
            <div className="sk-block" style={{width:120, height:36, borderRadius:999}} />
            <div className="sk-block" style={{width:120, height:36, borderRadius:999}} />
          </div>
          {/* 우: 유저 정보 */}
          <div className="sk-block" style={{width:180, height:36, borderRadius:999, flexShrink:0}} />
        </div>
        {SkeletonComp && <SkeletonComp />}
      </div>
    );
  }

  return (
    <div className={dark ? "dark" : ""}>
    <div
      className="dark:bg-slate-900 min-h-screen flex flex-col text-slate-800 dark:text-slate-200"  // ← [2026-08-19 고지 지시] sticky footer — 콘텐츠 짧아도 푸터 바닥 고정
      style={{
        background: "#F5F7F9",
        // ── [2026-04-30] 헤더 fixed로 인한 본문 가림 방지 ──
        //    headerHeight는 ResizeObserver로 NoticeBar 활성/비활성 등 모든 변경 자동 반영
        paddingTop: headerHeight,
      }}>
{/* ── 고정 영역: NoticeBar + Header + Gradient Fade ──
     [2026-04-30] Figma node 410:6745 반영 + sticky→fixed 전환
     · sticky가 body의 overflow-x:hidden(iOS 흔들림 방지)과 충돌해 작동 안 함
     · fixed로 viewport 기준 고정 + 본문에 동적 padding-top으로 가림 방지
     · NoticeBar: 헤더 위 공지 영역 (Admin 활성화 시 표시, X 닫기 = 세션 한정)
     · Header  : Pretendard 폰트 + Figma 정확한 색상/패딩 반영 (데스크톱)
     · Gradient: Header 하단 24px 페이드 (Claude UI 스타일, blur 8px)
     ─────────────────────────────────────────────────────────────
     [2026-05-05 핫픽스 v17] createPortal로 document.body 직접 mount
     · 증상: position:fixed가 inline style에 적용됐는데도 스크롤 시 헤더가 함께 올라감
     · 원인: 부모 체인(body / #root / .dark / .min-h-screen) 어딘가에 fixed의 컨테이닝 블록을
             가로채는 CSS 속성(transform/filter/will-change/contain/perspective/backdrop-filter)이 있음
             → fixed가 viewport 기준이 아닌 그 부모 기준이 되어 함께 스크롤됨
     · 해결: createPortal로 body 직접 mount → 부모 체인 우회 → 어떤 CSS 속성에도 영향 0
     · 미래: 부모 컴포넌트가 어떤 CSS 추가해도 헤더는 영향 받지 않음 (구조적 격리)
     · 동작: ResizeObserver는 headerWrapRef로 그대로 추적 (DOM 위치만 다를 뿐 ref 동일)
             paddingTop 보정도 그대로 / React Context 정상 전파 / dark mode 등 props 전달 OK */}
      {createPortal(
      <div
        ref={headerWrapRef}
        className={dark ? "dark" : ""} /* ← [핫픽스 v17] body 직접 mount 후에도 dark 모드 적용 보장 */
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        }}>
        <NoticeBar announcement={announcement} />   {/* ← [2026-07-24] DB 조회 결과 */}
        <header
          className="dark:bg-slate-800 dark:border-b dark:border-slate-700"
          style={{
            position: "relative",
            // ── [2026-04-30] backdrop-blur 제거 → 불투명 흰색
            //    이유: 콘텐츠가 헤더 뒤로 비쳐서 시각적으로 지저분함
            //    그라데이션 fade는 헤더 아래 24px에서만 유지 (자연스러운 경계)
            background: dark ? "#0F172A" : "#FFFFFF",
          }}>
        <div className="max-w-[1400px] mx-auto px-3 sm:px-7">
          <div className="grid items-center gap-3"
            style={{
              gridTemplateColumns:"1fr auto 1fr",
              // ── [2026-04-30 사용자 요청] 헤더 슬림화 ──
              //    padding-top/bottom: 8px (이전 데스크탑 10 / 모바일 7)
              //    min-height: auto (이전 데스크탑 72 / 모바일 52)
              //    데스크탑/모바일 분기 제거 → 단일값으로 코드 단순화
              //    실제 높이는 콘텐츠(아바타 32px + padding 16) 기준 ~48px 내외
              paddingTop: 8,
              paddingBottom: 8,
              minHeight: 'auto',
            }}
            data-desktop-height="auto">

            {/* ① 브랜드 (left) — 클릭 시 홈
                [2026-05-07] 텍스트 → SVG 로고 교체 (desktop: 115×24, mobile: 67×24)
                fill="currentColor" + dark 조건부 색상으로 다크모드 대응 */}
            {/* ① 좌측 그룹 — Figma 2776:8528: [햄버거 24 + gap 16 + 워드마크].
                ← [2026-07-31] 헤더 랩 수정 — 그리드가 1fr auto 1fr 3컬럼인데 햄버거를
                  4번째 직계 자식으로 넣어 우측 셀이 둘째 줄로 밀렸다. Figma 대로
                  햄버거를 브랜드 셀 내부 첫 요소로 이동. 클릭은 stopPropagation —
                  브랜드 셀 전체가 홈 이동 onClick 이라 드로어 열기와 겹치면 안 된다 */}
            <div className="flex items-center min-w-0 cursor-pointer" style={{ gap: 16 }} onClick={()=>setView("home")}>
              <button className="btn" aria-label="전체 메뉴 열기"
                onClick={e => { e.stopPropagation(); setDrawerOpen(true) }}
                style={{ background:'transparent', border:'none', cursor:'pointer', padding:2,
                         display:'flex', alignItems:'center', color: dark ? '#FFFFFF' : '#111111' }}>
                {/* ← [2026-07-31] 햄버거 아이콘 — 고지 제공 SVG 로 교체 (24×24, 라인 3개 풀폭).
                      stroke=black → currentColor: 부모 color 상속으로 다크모드 대응 (로고 SVG 관례) */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path d="M2 5H22" stroke="currentColor" />
                  <path d="M2 12H22" stroke="currentColor" />
                  <path d="M2 19H22" stroke="currentColor" />
                </svg>
              </button>
              <div className="min-w-0 flex items-center">
                {isMobile ? (
                  /* mobile 로고 — SPACE 58×21. ← [2026-07-31] 공용 BrandLogo 로 추출 (드로어·푸터 공유 SSOT) */
                  <BrandLogo variant="mobile" className={dark ? "text-white" : "text-[#111111]"} />
                ) : (
                  /* desktop 로고 — C&R SPACE 100×21. ← [2026-07-31] 공용 BrandLogo 로 추출 */
                  <BrandLogo variant="desktop" className={dark ? "text-white" : "text-[#111111]"} />
                )}
              </div>
            </div>

            {/* ② Nav pills (center) — Figma 410:6865
                [2026-05-04] HeaderNav 컴포넌트로 분리 (Phase 1+2 Step 4)
                · home/calendar 모드 → Nav pills (Home/Calendar 아이콘)
                · mypage/admin 모드 → "← 홈으로" 버튼
                · Figma 사양 / 모바일 분기 / dark 모드 모두 컴포넌트 내부에 보존 */}
            <HeaderNav
              view={view}
              onSetView={setView}
              isMobile={isMobile}
              dark={dark}
            />

            {/* ③ 우측: 자원 예약 드롭다운 + 알림 벨 + 유저 드롭다운 */}
            <div className="flex items-center gap-2 justify-end">

              {/* 자원 예약 드롭다운 — Figma 572:474 (기능 미작동, UI placeholder)
                  [2026-05-13 v7] 헤더 우측 영역에 신규 추가
                  · 트리거 클릭 시 메뉴 펼침/닫힘 작동 (외부 클릭 close 포함)
                  · 메뉴 항목(ZOOM 예약/포인터 대여/도서 대여) onClick 미연결 — 추후 구현
                  · 데스크탑에서만 노출 (모바일은 헤더 공간 확보 위해 숨김) */}
              {/* ← [2026-07-31] 자원 예약 퀵 드롭다운 복구 (데스크탑 전용, ZOOM 제거 v16) — Figma 2772:8350 우측 배치와 일치 */}
              {!isMobile && <ResourceDropdown dark={dark} onSetView={setView} />}

              {/* 알림 벨 */}
              {/* ← [2026-05-04] 알림 벨 + 패널 → NotificationBell 컴포넌트로 분리 (Phase 1+2 Step 3)
                    동작 무수정. state(notifications/showNotifPanel/unreadCount), ref(notifRef),
                    useEffect(load+subscribe, 외부클릭) 모두 컴포넌트 내부로 이동.
                    onOpenBookingDetail으로 부모 setModal 위임 (booking 검색은 부모 책임). */}
              <NotificationBell
                authUser={authUser}
                dark={dark}
                onOpenBookingDetail={(bookingId) => {
                  setModal({type:"detail", data: bookings.find(b=>b.id===bookingId) ?? null})
                }}
                /* ← [2026-07-21] 도서 대여 알림.
                     App 은 book_checkouts 목록을 들고 있지 않다(도서관 화면에서만
                     로드한다). 알림은 어느 화면에서나 열리므로 id 로 단건 조회한다. */
                onOpenBookLoanDetail={(checkoutId) => {
                  setLoanDetail({ loan: null, loading: true })
                  fetchBookLoanById(checkoutId)
                    .then(row => setLoanDetail({ loan: row, loading: false }))
                    .catch(() => setLoanDetail({ loan: null, loading: false }))
                }}
                /* ← [2026-09-30 NOTIFY 5-B] Work Space 알림 — booking_id 'task-{id}' | 'issue-{id}' | 'digest-{date}'.
                     권한 없는 사람(멤버 해제)은 페이지가 home 폴백하므로 여기선 게이트하지 않는다 */
                onOpenWorkboard={(target) => {
                  setWbDeepLink(target)
                  setView('workboard')
                }}
                /* ← [2026-10-01 ORG Phase 4-B] 조직도 알림 → 어드민 조직도 캔버스 (#admin-org-{fileId}). AdminPage hashchange 리스너가 탭을 맞춘다 */
                onOpenOrgFile={(fileId) => {
                  setView('admin')
                  window.location.hash = `admin-org-${fileId}`
                }}
              />

              {/* ← [2026-05-04] 프로필 + 드롭다운 메뉴 → ProfileDropdown 컴포넌트로 분리 (Phase 1+2 Step 2)
                    동작 무수정. state(showDropdown), ref(dropdownRef), 외부클릭 effect 모두 컴포넌트 내부로 이동.
                    Figma 사양은 ProfileDropdown.tsx 헤더 주석 참조. */}
              <ProfileDropdown
                currentUser={currentUser}
                currentDept={currentDept}
                avatarUrl={authUser?.avatar_url}
                isAdmin={isAdmin}
                isMobile={isMobile}
                dark={dark}
                view={view}
                onSetView={setView}
                onLogout={logout}
              />
            </div>

          </div>
        </div>

        {/* ── 그라데이션 fade — Claude UI 스타일
             [2026-04-30] Figma 헤더 배경 이미지 → CSS gradient로 변환
             · 헤더 바로 아래 32px 영역에서 콘텐츠가 자연스럽게 페이드 아웃
             · [2026-04-30 사용자 요청] 24px → 32px (페이드 영역 확장)
             · 헤더가 불투명 흰색으로 변경됨에 따라 그라데이션 시작점도 1.0으로 (이전 0.85)
             · pointer-events:none으로 콘텐츠 클릭 통과 보장 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            height: 32,
            background: dark
              ? "linear-gradient(to bottom, rgba(15, 23, 42, 1), rgba(15, 23, 42, 0))"
              : "linear-gradient(to bottom, rgba(255, 255, 255, 1), rgba(255, 255, 255, 0))",
            pointerEvents: "none",
          }}
        />
      </header>
      </div>
      , document.body)/* ← [핫픽스 v17] createPortal 닫기 — 헤더 wrap을 body에 직접 mount */}
{/* ── 고정 영역 끝 ── */}

      {/* ── Views ── */}
      {(view==="home"||view==="calendar") && (
        <div style={{width:"100%", maxWidth:1400, margin:"0 auto", padding: isMobile?"16px 12px":(view==="calendar"?"20px 28px":"28px 28px")}}>{/* ← [2026-05-13] 캘린더 뷰만 padding 20px 28px (홈은 28px 28px 유지) - CalendarSkeleton과 의도값 일치 */}
          {view==="home"     && <HomeView     bookings={bookings} rooms={rooms} tick={tick} searchQ={searchQ} setSearchQ={setSearchQ} filterFloor={homeFilterFloor} setFilterFloor={setHomeFilterFloor} onBook={(r, status)=>{
              // 바로예약: 지금 시각부터 다음 예약 직전까지 자동 설정
              const now = nowMinutes();
              const snapStart = Math.ceil((now+1)/15)*15;
              const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
              // 다음 예약이 있으면 그 시작 시간을 end 상한으로 사용
              const nextStartMin = status?.nextBooking ? tsMin(status.nextBooking.start_at) : 19*60;
              const clampedEnd = Math.min(clampedStart+60, nextStartMin, 19*60);
              // clampedEnd <= clampedStart: 현재 시각 snap이 다음 예약 직전 → 가능 시간 없음
              // 시간 없이 모달 열기 (사용자가 직접 설정)
              if (clampedEnd <= clampedStart) {
                setModal({type:"new", prefill:{room_id:r.room_id}});
                return;
              }
              const s = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
              const e = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
              setModal({type:"new", prefill:{room_id:r.room_id, start:s, end:e}});
            }} onDetail={(r)=>setModal({type:"roomDetail",data:r})} onBookingDetail={(b)=>setModal({type:"detail",data:b})} onCheckIn={checkIn} onEarlyEnd={confirmAndEarlyEnd} onCancel={confirmAndCancelBooking} currentUser={currentUser} currentUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} dark={dark} />}{/* ← [2026-04-24 P8-A] onCancel: cancelBooking → confirmAndCancelBooking — 홈 "오늘 내 예약" 취소 버튼도 ConfirmCancelModal 다이얼로그 경유 (DetailModal과 동일 정책, 전체 취소 UX 통일) */}
          {/* ← [2026-04-24 P5] CalendarShell에 currentUserId/currentUserEmail/users 추가
                · Daily 슬롯의 이름 live 표시 + filterMine/isOwner UUID/email 판정
                · 원칙: 이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식 */}
          {view==="calendar" && <CalendarShell bookings={bookings} rooms={rooms} selectedDate={selectedDate} setSelectedDate={setSelectedDate} calView={calView} setCalView={setCalView} onBookingClick={b=>setModal({type:"detail",data:b})} onNewBooking={(d, rid, startMin, endMin) => setModal({type:"new", prefill:{room_id:rid, start: startMin!=null?`${fmt2(Math.floor(startMin/60))}:${fmt2(startMin%60)}`:undefined, end: endMin!=null?`${fmt2(Math.floor(endMin/60))}:${fmt2(endMin%60)}`:undefined}, date:d})} onCheckIn={checkIn} filterRoomId={calFilterRoomId} setFilterRoomId={setCalFilterRoomId} currentUser={currentUser} currentUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} users={users} isAdmin={isAdmin} /> /* ← [2026-04-24] onNewBooking 시그니처 변경: (date, hour, rid) → (date, rid, startMin, endMin) — Daily 뷰 15분 단위 클릭 지원 */}
        </div>
      )}

      {/* ← [2026-04-18 P0 fix] LazyErrorBoundary로 감싸 청크 로드 실패 시 흰 화면 방지 */}
      {view==="mypage" && <LazyErrorBoundary><Suspense fallback={<MyPageSkeleton />}><MyPageView bookings={bookings} setBookings={setBookings} currentUser={currentUser} currentDept={currentDept} showToast={showToast} isMobile={isMobile} onDetail={b=>setModal({type:"detail",data:b})} onCheckIn={checkIn} onEarlyEnd={confirmAndEarlyEnd} onCancel={confirmAndCancelBooking} rooms={rooms} users={users} authUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} avatarUrl={authUser?.avatar_url ?? null} initialQueryTab={myPageInitialTab} /></Suspense></LazyErrorBoundary>}{/* ← [2026-04-24 P8-A] onCancel: cancelBooking → confirmAndCancelBooking — MyPage 취소 버튼도 ConfirmCancelModal 경유 */}
      {/* ← [2026-04-24 P8-B] AdminView onForceCancel도 공통 다이얼로그 경유로 통일 */}
      {/* ← [2026-05-06 Admin Phase C] currentUserId/currentUserEmail 전달 — AdminApprovalTable 내 BookingStatusBadge 판정용 */}
      {/* ← [2026-05-06 사이드 sticky 핫픽스] headerHeight 전달 — 사이드 네비 fixed 위치 계산용 (헤더와 동일 패턴) */}
      {/* ← [2026-10-06 ADMIN-GATE] 접근 권한 통과(adminGate) 시에만 AdminView — 판정 중·거부는 스켈레톤(거부는 곧 home 폴백) */}
      {view==="admin" && (adminGate === 'allowed'
        ? <LazyErrorBoundary><Suspense fallback={<AdminSkeleton />}><AdminView bookings={bookings} setBookings={setBookings} rooms={rooms} setRooms={setRooms} users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile} isTablet={isTablet} onApprove={approvePendingBooking} onReject={rejectPendingBooking} onForceCancel={confirmAndAdminForceCancel} onDetail={b=>setModal({type:'detail',data:b})} currentUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} headerHeight={headerHeight} initialRoles={myAdminRoles} onNoAccess={() => setAdminGate('denied')} /></Suspense></LazyErrorBoundary>
        : <AdminSkeleton />)}
      {view==="library" && <LibraryPage isAdmin={isAdmin} users={users} authUserId={authUser?.user_id ?? ''} showToast={showToast} onGoMyLoans={() => { setMyPageInitialTab('book'); setView('mypage') }} />}{/* ← [2026-07-16] 도서관 모듈 추가 */}
      {view==="resources" && <ResourcePage users={users} authUserId={authUser?.user_id ?? ''} showToast={showToast} isMobile={isMobile} onGoMyResources={() => { setMyPageInitialTab('resource'); setView('mypage') }} />}{/* ← [2026-08-19] 자원예약 Phase 2A — 카드+Figma 모달, 2B(타임라인·캘린더) 예정 */}
      {view==="announcements" && <AnnouncementsPage showToast={showToast} />}{/* ← [2026-08-19] 공지사항 — 헤더 배너 이력, RLS 20260749 필요 */}
      {view==="release-notes" && <ReleaseNotesPage />}{/* ← [2026-08-03] Release Note + Hotfix — 데이터 SSOT: src/data/releaseNotes.ts */}
      {view==="workboard" && canWorkboard && <WorkboardPage users={users} authUserId={authUser?.user_id ?? ''} showToast={showToast} deepLink={wbDeepLink} onDeepLinkConsumed={() => setWbDeepLink(null)} />}{/* ← [5-B] 알림벨 딥링크 */}{/* ← [2026-09-29 WORKBOARD P3-A] users·authUserId·showToast 전달 (ResourcePage 관례) */}{/* ← [2026-09-29 WORKBOARD P2] 권한 확정 전(null)·비권한은 렌더하지 않음 */}

      {/* ── Modals ── */}
      {/* ← [2026-07-21] 도서 대여 상세 — 알림 클릭 진입점.
           마이페이지·어드민도 같은 모달을 쓰지만 그쪽은 각자 목록을 들고 있어
           자체적으로 연다. 여기는 목록 없이 id 로만 진입하는 경로다. */}
      {loanDetail && (
        <BookLoanDetailModal
          loan={loanDetail.loan}
          loading={loanDetail.loading}
          onClose={() => setLoanDetail(null)}
        />
      )}

      {modal && (
        <div
          style={{
            position:"fixed",
            top: vvOff,
            left: 0,
            width: "100%",
            height: vvH,
            background:"rgba(15,23,42,0.55)",
            backdropFilter:"blur(6px)",
            display:"flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent:"center",
            zIndex:1000,
            padding: isMobile ? 0 : 16,
          }}>
          {modal.type==="new"         && <BookingModal prefill={modal.prefill} date={modal.date||todayStr()/* ← [2026-04-22 HOTFIX] 캘린더→홈 날짜 꼬임 해결 — selectedDate 폴백 제거, 명시 전달만 사용 */} onClose={()=>setModal(null)} onSubmit={addBooking} onUpdate={()=>false} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} currentUserEmail={authUser?.email ?? ''} rooms={rooms} users={users} penalty={myNoshowPenalty} />}{/* ← [2026-08-10 이용제재] penalty 전달 — edit 인스턴스는 미전달(D6: 기존 예약 유지) */}
            {modal.type==="edit"         && <BookingModal prefill={{}} editBooking={modal.data} date={tsDate(modal.data.start_at)} onClose={()=>setModal(null)} onSubmit={async ()=>false} onUpdate={(form,date)=>updateBooking(form,date,modal.data.id)} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} currentUserEmail={authUser?.email ?? ''} rooms={rooms} users={users} />}
            {/* ← [P2 v8] onCancel={cancelBooking} → onCancel={confirmAndCancelBooking}
                  예약 상세에서만 confirm dialog 경유 (소형카드는 즉시 실행 유지) */}
            {/* ← [2026-04-24 P1-hotfix] DetailModal에 currentUserEmail={authUser?.email} 추가
                  · P1 최초 배포(이름 fallback 포함) 후에도 편집 버튼 미노출 → 헬퍼 단순화(isMyBooking)
                  · MyPage allMyBookings와 동일 기준(UUID + attendee email)으로 판정
                  · 참석자도 본인 예약으로 인정 (2026-04-08 정책과 일관) */}
            {/* ← [2026-04-24 P8-B] DetailModal onForceCancel: adminForceCancelBooking → confirmAndAdminForceCancel
                   하드코딩 사유 '관리자 강제취소' 전달 방식 폐기, ConfirmForceCancelModal로 사유 입력받음 */}
            {/* ← [2026-04-27 Layer 2 가드] modal.data → fresh booking 패턴
                   증상: 모달 열린 상태에서 cron/useEffect가 노쇼 처리해도 modal.data는 stale → BtnCancel 잔존
                   원인: setModal({data:b}) 시점 박제. bookings state 갱신되어도 modal.data는 React state 아님
                   해결: bookings에서 id로 매번 다시 찾아 전달 — Realtime/markNoshow 직후 자동 re-render
                   짝 배포: lib/api.ts cancelBooking Layer 1 가드 (DB 단 차폐) */}
            {modal.type==="detail"      && <DetailModal booking={bookings.find(b=>b.id===modal.data?.id) ?? modal.data} onClose={()=>setModal(null)} onCheckIn={checkIn} onCancel={confirmAndCancelBooking} onEdit={(b)=>setModal({type:"edit",data:b})} onEarlyEnd={confirmAndEarlyEnd} currentUser={currentUser} currentUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} rooms={rooms} users={users} isAdmin={isAdmin} onApprove={approvePendingBooking} onReject={confirmAndRejectBooking} onForceCancel={confirmAndAdminForceCancel} onChangeOwner={(b)=>setModal({type:"changeOwner",data:b})} />}{/* ← [2026-06-12] onChangeOwner 추가 — 관리자 예약자 변경 모달 오픈 *//* ← [2026-04-29] onEarlyEnd={confirmAndEarlyEnd} 추가 */}
            {modal.type==="bookingDone" && <BookingDoneModal booking={modal.data} onClose={()=>setModal(null)} rooms={rooms} users={users} />}
            {modal.type==="recurDone"    && <RecurDoneModal data={modal.data} users={users} onClose={()=>setModal(null)} />}{/* ← [2026-05-28] users 전달 — 예약자/참석자 live 표시 */}
            {/* ← [P2 v8 신규] 예약 취소 확인 다이얼로그 */}
            {modal.type==="confirmCancel" && <ConfirmCancelModal
              booking={modal.data.booking}
              room={rooms.find((r: any) => r.room_id === modal.data.booking.room_id)}
              onConfirm={modal.data.onConfirm}
              onClose={()=>setModal(null)}
            />}
            {/* ← [2026-04-29] 조기반납 확인 다이얼로그 */}
            {modal.type==="confirmEarlyEnd" && <ConfirmEarlyEndModal
              booking={modal.data.booking}
              room={rooms.find((r: any) => r.room_id === modal.data.booking.room_id)}
              onConfirm={modal.data.onConfirm}
              onClose={()=>setModal(null)}
            />}
            {/* ← [2026-04-29] 승인거절 확인 다이얼로그 */}
            {modal.type==="confirmReject" && <ConfirmRejectModal
              booking={modal.data.booking}
              room={rooms.find((r: any) => r.room_id === modal.data.booking.room_id)}
              onConfirm={modal.data.onConfirm}
              onClose={()=>setModal(null)}
            />}
            {/* ← [2026-04-24 P8-B] 관리자 강제취소 공통 다이얼로그 분기 추가
                   confirmAndAdminForceCancel 헬퍼로 띄움. onConfirm은 사유 문자열 받아 처리. */}
            {modal.type==="confirmForceCancel" && <ConfirmForceCancelModal
              booking={modal.data.booking}
              room={rooms.find((r: any) => r.room_id === modal.data.booking.room_id)}
              onConfirm={modal.data.onConfirm}
              onClose={()=>setModal(null)}
            />}
            {/* ← [2026-06-12] 관리자 예약자 변경 모달 — DetailModal onChangeOwner로 진입 */}
            {modal.type==="changeOwner" && <ChangeOwnerModal
              booking={modal.data}
              room={rooms.find((r: any) => r.room_id === modal.data.room_id)}
              users={users}
              onConfirm={(newUserId: string)=>handleChangeOwner(modal.data.id, newUserId)}
              onClose={()=>setModal(null)}
            />}
          {modal.type==="roomDetail"  && <RoomDetailModal room={modal.data} bookings={bookings} users={users} onClose={()=>setModal(null)} onBook={(status)=>{
              const now = nowMinutes();
              const snapStart = Math.ceil((now+1)/15)*15;
              const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
              const nextStartMin = status?.nextBooking ? tsMin(status.nextBooking.start_at) : 19*60;
              const clampedEnd = Math.min(clampedStart+60, nextStartMin, 19*60);
              if (clampedEnd <= clampedStart) {
                setModal(null);
                setModal({type:"new", prefill:{room_id:modal.data.room_id}});
                return;
              }
              const s = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
              const e = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
              setModal(null);
              setModal({type:"new", prefill:{room_id:modal.data.room_id, start:s, end:e}});
            }} onDetail={b=>setSubModal({type:'detail',data:b})} />}
        </div>
      )}

      {/* ── Sub Modal (RoomDetailModal 위에 올라오는 2차 모달) ── */}
      {subModal && (
        <div
          style={{
            position:"fixed",
            top: vvOff,
            left: 0,
            width: "100%",
            height: vvH,
            background:"rgba(15,23,42,0.35)",
            backdropFilter:"blur(3px)",
            display:"flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent:"center",
            zIndex:1001,
            padding: isMobile ? 0 : 16,
          }}>
          {subModal.type==="detail" && <DetailModal
            booking={subModal.data}
            onClose={()=>setSubModal(null)}
            onCheckIn={checkIn}
            onCancel={confirmAndCancelBooking}
            onEdit={(b)=>{ setSubModal(null); setModal({type:"edit",data:b}); }}
            onEarlyEnd={(id: string)=>{ setSubModal(null); confirmAndEarlyEnd(id); }}
            currentUser={currentUser}
            currentUserId={authUser?.user_id ?? ''}
            currentUserEmail={authUser?.email ?? ''}
            rooms={rooms}
            users={users}
            isAdmin={isAdmin}
            onApprove={approvePendingBooking}
            onReject={confirmAndRejectBooking}
            onForceCancel={confirmAndAdminForceCancel}
            /* ← [2026-04-24 P8-B] SubModal도 공통 다이얼로그 경유 */
            /* ← [2026-04-29] onEarlyEnd / currentUserId / currentUserEmail 누락 추가 */
          />}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[9999] px-5 py-3 rounded-xl text-sm font-semibold shadow-lg border
          ${toast.type==="error"
            ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-950 dark:border-red-800 dark:text-red-400"
            : toast.type==="info"
            ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-400"
            : "bg-green-50 border-green-200 text-green-600 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
          }`}
          style={{animation:"tIn 0.3s ease"}}>
          {toast.msg}
        </div>
      )}

      {/* ← [2026-08-19 고지 지시] sticky footer 스페이서 — 콘텐츠가 짧으면 flexGrow 가
            남는 화면을 흡수해 푸터를 뷰포트 바닥에 붙이고, 길면 최소 간격(기존 160px)만 남긴다.
            푸터 fixed 오버레이가 아니라 문서 흐름 유지 — 콘텐츠를 가리지 않는 근본 해법 */}
      <div style={{ flexGrow: 1, minHeight: 160 }} aria-hidden="true" />
      {/* ── Footer — ← [2026-07-30] 서비스 나열 푸터로 교체 (AppFooter) ── */}
      <AppFooter isMobile={isMobile} isAdmin={isAdmin} onSetView={setView} onGoMyPage={(t) => { setMyPageInitialTab(t); setView('mypage') }} />{/* ← [2026-08-19] 신규 푸터 — 마이페이지 탭 정확 이동 */}{/* ← [2026-10-06 ADMIN-GATE] isAdmin — '관리자 페이지' 링크 관리자 한정 */}

      {/* ── 전역 사이드 드로어 — ← [2026-07-30] ── */}
      <AppDrawer
        open={drawerOpen}
        view={view}
        isAdmin={isAdmin}
        canWorkboard={canWorkboard}
        canOrg={canOrg}   // ← [2026-10-01 ORG]
        isMobile={isMobile}
        onSetView={setView}
        onClose={() => setDrawerOpen(false)}
      />

    </div>
    </div>
  );
}

// ─── Home View ─────────────────────────────────────────────────────────────────

// ── AuthProvider로 감싸서 내보내기 ──────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
