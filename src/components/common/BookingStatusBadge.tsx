import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes, CHECKIN_EARLY_MIN, isCheckinable, isCheckedInWaiting } from '../../utils/time'  // ← [2026-05-28] isCheckedInWaiting 추가 — 시작 전 체크인 완료 칩 표시용
// ← [2026-07-23] 노쇼·기한초과 판정을 SSOT로 통일 (자체 규칙 폐기)
import { isNoshow as isNoshowSSOT } from '../../utils/noshow'
import { isExpiredPending as isExpiredPendingSSOT } from '../../utils/pendingStatus'
import { isBooker, isAttendee } from '../../utils/bookingOwnership'  // ← [2026-04-24 P4-B] isOwner를 isBooker(UUID/email)로 교체 / [2026-05-04 핫픽스 v11] isAttendee 추가 — mine 칩 라벨 분기용

/**
 * BookingStatusBadge — 예약 상태 뱃지 묶음
 *
 * ✅ 변경 이력
 *  - [2026-05-28 시작 전 체크인 완료 칩 표시] 'checkin-done' 칩 조건 확장
 *    · 배경: 2026-05-12 체크인 활성 5분 전 변경 시 'checkin-done' 칩의 isAct 가드를
 *            그대로 두어, 시작 전 체크인 완료(checkedIn=true && isFuture=true) 상태에서
 *            "체크인 완료" 칩이 사라지는 버그 발견 (사용자 보고 2026-05-28).
 *    · 변경: hasAny / chipList push 2곳 조건 동일하게 확장
 *      기존: b.checkedIn && isAct
 *      변경: b.checkedIn && (isAct || isCheckedInWaiting(b))
 *    · isCheckedInWaiting(time.ts SSOT)에 status='confirmed' + !autoCancelled + !earlyEnded
 *      가드가 포함되어 있어, 다른 cancel/reject 분기와 자동 배타.
 *    · 다른 칩과의 배타성:
 *        · countdown 칩: tl > 5 가드. 5분 전부터 체크인 가능 → 5분 전~시작 직전 체크인 시
 *          tl <= 5 이므로 countdown 자동 미표시. 만에 하나 어드민이 10분 전 강제 체크인
 *          마킹한 비정상 케이스에서 중복 표시 가능하나 실사용 경로 아님.
 *        · isConfirmed 칩: !b.checkedIn 가드 있음 → 자동 배타.
 *        · active/checkin-wait: 자동 배타 (시간/checkedIn 가드).
 *
 *  - [2026-05-12 Figma 556:6212~6225 사용자 요청] 체크인 라벨 + 칩 색상 일괄 변경
 *    · "체크인 대기" → "체크인 대기 중" (라벨 텍스트만)
 *    · chip-checkin-wait 색상은 tokens.css에서 #FFFAB3/#111로 변경 (별도 PR)
 *    · 본 파일은 텍스트만 변경, CSS 클래스 그대로
 *
 *  - [2026-05-12 체크인 상태 칩 우선순위 상향]
 *    · chipList push 순서: ⑧ 체크인 대기/완료 / ⑨ 진행 중 (기존 역순)
 *    · 배경: maxChips=1 환경(HomeView 소형 카드 등)에서 "진행 중" 칩이 체크인 상태를 가림
 *    · 효과: 진행 중인 회의 카드에 "체크인 대기" 또는 "체크인 완료" 라벨이 우선 표시
 *    · maxChips 미지정 화면(DetailModal 등) 영향: 표시 순서만 변경, 모든 칩 그대로 표시
 *
 *  - [2026-05-12 체크인 활성 5분 전 핫픽스]
 *    · countdown 칩 표시 범위: tl > 0 && tl <= 10 → tl > CHECKIN_EARLY_MIN(5) && tl <= 10
 *      → 10~5분 전 사이에만 카운트다운 표시 (5분 전부터는 checkin-wait 칩이 자리 대체)
 *    · checkin-wait 칩 조건: nci = isAct && !checkedIn → isCheckinable(b)
 *      → 시작 5분 전부터 시작 후 10분까지 미체크인 동안 표시 (체크인 시 자동 사라짐)
 *    · 칩 라벨 정책:
 *        · 10~5분 전 → "곧 시작" (chip-countdown 재사용, 라벨 변경)
 *        · 5분 전 ~ 체크인 → "체크인 대기" (chip-checkin-wait, 기존 라벨 유지)
 *    · BadgeType 추가 없음, 호출부 호환 100% (only 필터 그대로)
 *
 *  - [2026-05-04 옵션 B] '예약자 취소' / '참석자 취소' 라벨 분기 + isOwner 버그 수정
 *    · 메인 버그: user-cancel 칩에 `&& isOwner` 가드가 있어서 본인이 예약자가 아니면 칩 안 보임
 *      (MyPage 참석자 시점, AdminPage 등) → 가드 제거
 *    · DB 신규 칼럼 cancelled_by_user_id 활용해 라벨 동적 분기:
 *        b.cancelledByUserId === b.user_id ? '예약자 취소' : '참석자 취소'
 *    · NULL fallback: 기존 데이터(backfill 안 함)는 cancelledByUserId NULL → '예약자 취소' 기본 표시
 *    · 칩 디자인 그대로 (chip-user-cancel 클래스 동일, 신규 BadgeType 추가 X)
 *    · only=['user-cancel'] 호출부(HomeView) 영향 0 — BadgeType 그대로
 *
 *  - [2026-05-04 STEP 3] MY PAGE 테이블 재설계 — 신규 BadgeType + size 추가
 *    · BadgeType 'confirmed' 신규 — 일반 룸 미래 confirmed 살아있는 예약 표시 (chip-confirmed / bg #CBECFF)
 *    · size 'list' 신규 — MyBookingTable 전용 사이즈 (chip--list / 10px / padding 2 7 / radius pill)
 *    · isConfirmed 판정 변수 신규 — Emerald(approved) / countdown / checkin-wait / past 등과 모두 배타
 *    · size='list' 시 자동 maxChips=1 — 테이블 행 단일 칩 표시 정책
 *    · size='list' 시 mine 칩 표시 안 함 (기존 sm과 동일 정책)
 *    · 기존 판정 함수(isAct/nci/isPast/isApproved/isExpiredPending/isNoshow 등)는 변경 없음
 *
 *  - [2026-04-30 다이아몬드 hotfix] isExpiredPending에 room_id=3 가드 추가
 *  - [2026-04-24 P7-A] isOwner fallback 제거 — 이름 비교 코드 완전 삭제
 *  - [2026-04-24 P4-B] "내 예약" 뱃지 판정 이름 비교 → UUID/email 기반 (isBooker)
 *  - [2026-04-19 P2 v7] 판별 로직 전면 재설계 — pending_expired 노쇼 오표시 버그 해결
 *  - 이전 이력은 git log 참조
 */

export type BadgeType =
  | 'rejected'
  | 'expired-pending'
  | 'admin-cancel'
  | 'noshow'
  | 'user-cancel'
  | 'pending'
  | 'approved'
  | 'confirmed'      // ← [2026-05-04 STEP 3] 신규: 일반 룸 미래 confirmed 살아있는 예약 (Emerald 'approved'와 분리)
  | 'mine'
  | 'active'
  | 'checkin-wait'
  | 'checkin-done'
  | 'past'
  | 'early-end'
  | 'countdown'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  /** is_admin_only 직접 전달 — room prop 없이도 승인완료 배지 표시 가능 */
  isAdminRoom?: boolean
  /** @deprecated P4-B-3 이후 제거 예정. 대신 currentUserId + currentUserEmail 사용 */
  currentUser?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 UUID (authUser.user_id) */
  currentUserId?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 이메일 (authUser.email) */
  currentUserEmail?: string
  /** md = DetailModal·ListView / sm = 소형카드 / xs = 캘린더 슬롯 / list = MyBookingTable 행 (← [2026-05-04 STEP 3] 신규) */
  size?:        'md' | 'sm' | 'xs' | 'list'
  /** 지정 시 해당 타입의 뱃지만 렌더. 미지정 시 전체 자동 판별. */
  only?:        BadgeType[]
  /** ← [피그마 180:534 신규] 'square' = BookingDetailModal 사각형 칩(radius 8) / 기본 'pill' */
  shape?:       'pill' | 'square'
  /** ← [Figma UI갱신 2026-04-29] 소형 카드용 표시 칩 수 상한 (기본: 제한 없음)
   *    · 우선순위 순서대로 chipList 수집 후 slice(0, maxChips) 처리
   *    · 뱃지 순서: rejected > expired-pending > admin-cancel > noshow > user-cancel
   *               > pending > approved > active > checkin-wait > checkin-done
   *               > early-end > past > countdown */
  maxChips?:    number
}

/** size별 chip modifier 클래스 — tokens.css 정의 */
const SIZE_CLASS = {
  md: '',
  sm: 'chip--sm',
  xs: 'chip--xs',
  list: 'chip--list',  // ← [2026-05-04 STEP 3] MyBookingTable 행 전용 — padding 2 7 / radius pill / 10 Medium
} as const

export function BookingStatusBadge({
  booking: b,
  room: r,
  isAdminRoom,
  currentUser = '',
  currentUserId = '',      // ← [2026-04-24 P4-B]
  currentUserEmail = '',   // ← [2026-04-24 P4-B]
  size = 'md',
  only,
  shape = 'pill',
  maxChips,                // ← [Figma UI갱신 2026-04-29] 소형 카드 1칩 제한용
}: BookingStatusBadgeProps) {
  const now     = nowMinutes()
  const isToday = tsDate(b.start_at) === todayStr()
  const sm      = tsMin(b.start_at)
  const em      = tsMin(b.end_at)

  // isAdminRoom prop 우선, 없으면 room.is_admin_only fallback
  const adminRoom = isAdminRoom ?? !!r?.is_admin_only

  // ── 취소 상태 판별 (상호 배타적, 우선순위 엄격) ──────────────────────
  //
  // ← [2026-04-19 P2 v7 판별 재설계] pending_expired 노쇼 오표시 버그 해결
  //
  //   배경:
  //     · P2 v6에서 pending_expired는 auto-cancel-bookings cron이 처리하며
  //       status='pending' → 'cancelled'로 최종 변경됨
  //     · 기존 판별 `isExpiredPending = status==='pending' && autoCancelled`은
  //       cron 처리 후 status='cancelled'가 되면 false → isNoshow로 오분류
  //     · 또한 사용자가 pending 수동 취소 시 isExpiredPending + isUserCancel
  //       둘 다 true가 되어 뱃지 중복 표시
  //
  //   해결 원칙:
  //     1. 우선순위 엄격화: 사용자 의도(user_cancel) > 거절/관리자 > 시스템 판별
  //     2. 시스템 취소(cancelled_by=system) 내부에서 '기한초과'와 '노쇼' 구분
  //        · 기한초과(pending_expired): 승인 대기 중 start_at 도래 전에 자동 취소
  //        · 노쇼(noshow):              체크인 없이 start_at + 10분 경과 시 자동 취소
  //     3. 판별 기준: status + start_at 시점 조합 (status만으로는 불충분)
  //        · status='pending'  → 무조건 기한초과 (승인 대기 상태의 system 취소)
  //        · status='cancelled' + now < start_at → 기한초과 (시작 전 system 취소)
  //        · status='cancelled' + now >= start_at + 10분 → 노쇼 (시작 후 미체크인)
  //        · 그 외 → 노쇼 폴백 (안전한 기본값)
  //
  //   배타성 보장:
  //     · isUserCancel이 true면 다른 system/admin 판별은 전부 false
  //     · isRejected가 true면 admin/expired/noshow 전부 false
  //     · expired와 noshow는 시간축으로 완전 분리 (한 건이 동시 해당 불가)

  const isRejected    = b.status === 'rejected'
  // ① 사용자 취소가 최우선 (사용자 의도가 가장 명확)
  // ← [2026-05-06 사용자 명시 승인 Option A] autoCancelled 가드 제거
  //   배경: classify()와 비대칭 발견 — 23건의 비정상 데이터가 '취소' 탭에 들어오는데
  //         isUserCancel=false로 평가되어 '예약자 취소' 칩 대신 '사용완료' 칩 표시됨
  //   진단 데이터: status='cancelled' + cancelledBy='user' + auto_cancelled=FALSE 23건
  //              (2026-04-20~22 사이 사용자 직접 취소 건들)
  //   원인: insert 경로가 사용자 취소 시 auto_cancelled=false로 저장 (정상 동작)
  //         BookingStatusBadge의 isUserCancel 공식이 잘못된 전제(autoCancelled=true)를 요구
  //   해결: classify()와 동일 조건으로 통일 → 두 분류 로직 일관성 보장
  //   영향 분석:
  //     · isAdminCancel/isSystemCancel: cancelledBy='admin/system' 배타 → 영향 0
  //     · isAttendeeCancel: 의도된 라벨 분기 동작 그대로
  //     · isPast: 영향받지만 size='list' maxChips=1로 user-cancel이 우선순위 차단
  const isUserCancel  = b.status === 'cancelled' && b.cancelledBy === 'user'

  // ─── [2026-05-04 옵션 B] 예약자/참석자 취소 분기 (신규) ───────────────────
  //   확정 공식 isUserCancel은 변경 없음 — 라벨 분기용 boolean만 추가
  //   · cancelledByUserId === user_id  → 예약자 본인 취소 → "예약자 취소"
  //   · cancelledByUserId !== user_id  → 참석자 취소     → "참석자 취소"
  //   · cancelledByUserId === null     → 백필 안된 기존 데이터 → "예약자 취소" (안전 fallback)
  //   userMemories #13 정책: 예약자뿐 아니라 참석자도 예약 취소 가능 (2026-04-08~)
  const isAttendeeCancel = isUserCancel
                         && !!b.cancelledByUserId
                         && b.cancelledByUserId !== b.user_id

  // ② 관리자 강제 취소 (거절과 구분)
  const isAdminCancel = b.autoCancelled && b.cancelledBy === 'admin'
                        && !isRejected && !isUserCancel
  // ③ 시스템 취소 (기한초과 vs 노쇼 분리)
  const isSystemCancel = b.autoCancelled && b.cancelledBy === 'system'
                         && !isRejected && !isUserCancel && !isAdminCancel
  // ─── [2026-07-23] ③-1/③-2 판정 SSOT 전환 ─────────────────────────────────
  //
  //  🐞 수정한 버그
  //    기존 isExpiredPending은 `b.status === 'pending'`을 기한초과의 신호로 삼았다.
  //    그런데 App.tsx tick(L1539)이 만료 pending을 `status:'cancelled'`로 낙관 변조하고,
  //    cron 처리본도 'cancelled'이므로 **신호가 사라진 채 노쇼로 폴백**했다.
  //    → 승인조차 되지 않은 과거 에메랄드 예약이 상세 모달에서 '노쇼'로 표시됨.
  //
  //  🔧 전환 내용
  //    · 노쇼      → utils/noshow.ts SSOT (status='confirmed' && cancelledBy='system' && !checkedIn)
  //    · 기한초과  → utils/pendingStatus.ts SSOT(DB 원본 형태) + 처리본/변조본 분기
  //
  //  📌 구분 키: **status**
  //    markNoshow는 status를 바꾸지 않아 진짜 노쇼는 'confirmed'로 남고,
  //    기한초과는 cron·tick 어느 쪽이 처리하든 'cancelled'가 된다. 이 차이로 갈린다.
  //
  //  ⚠ 기존 동작 보존
  //    비-에메랄드(room_id≠3)의 시스템 취소 오염 데이터는 예전처럼 '노쇼'로 남긴다.
  //    여기서 빼면 칩이 아무것도 뜨지 않는 회귀가 생긴다.
  //    (노쇼 **통계**는 utils/noshow SSOT를 쓰므로 이 폴백에 영향받지 않는다 — 표시 전용)

  // 엄격 판정 — 통계와 동일한 기준
  const isNoshowStrict = isNoshowSSOT(b)

  // ③-1 기한초과 (에메랄드 전용)
  //   ⓐ DB 원본:            status='pending' + auto_cancelled=false + 마감 경과
  //   ⓑ 처리본/tick 변조본:  status='cancelled' + auto_cancelled=true + cancelled_by='system'
  //   ★ `b.status === 'pending' || !b.checkedIn` — 전수 시뮬로 다듬은 조건이다.
  //     · status='pending' + auto_cancelled=true = 구버전 프론트가 status는 두고 플래그만
  //       세웠던 기한초과 데이터(과거 17건 누적 이력). 이건 checkedIn 값과 무관하게 기한초과다.
  //       (메모리 원칙: pending 상태에서 checkedIn은 의미 없음 — 가드로 쓰지 말 것)
  //     · status='cancelled' 처리본/변조본은 체크인됐다면 기한초과일 수 없다.
  //       체크인 = 실제로 사용했다는 뜻이라 '사용 못 함'과 배타이기 때문.
  const isExpiredPending = isExpiredPendingSSOT(b)
                           || (isSystemCancel && b.room_id === 3 && !isNoshowStrict
                               && (b.status === 'pending' || !b.checkedIn))

  // ③-2 노쇼 — SSOT 우선, 비-에메랄드 오염 데이터만 기존 폴백 유지
  const isNoshow         = isNoshowStrict || (isSystemCancel && !isExpiredPending)

  // ── 진행 상태 판별 ──────────────────────────────────────────────
  const isAct     = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const isApproved = adminRoom && b.status === 'confirmed' && !b.autoCancelled
  // ← [2026-05-12] nci: "체크인 대기" 칩 표시 조건 변경
  //   기존: isAct && !checkedIn — 시작 후 미체크인 동안만
  //   변경: isCheckinable(b)    — 시작 5분 전부터 시작 후 10분까지 미체크인 동안
  //   isCheckinable 내부에 status='confirmed' + !checkedIn + !autoCancelled + !earlyEnded 가드 포함
  //   사용자 정책: "체크인 활성 시점부터 사용자가 체크인 할 때까지 '체크인 대기' 라벨 표시"
  const nci       = isCheckinable(b)
  const isFuture  = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  // ← [2026-04-23] 조기반납도 '사용완료'에 포함 (earlyEnded는 조기 사용완료의 서브셋)
  //   기존: !b.earlyEnded 제외 → 조기반납이면 사용완료 칩 안 나옴
  //   변경: 조기반납도 실제로 끝난 예약이므로 사용완료(isPast)에 포함
  //   결과: earlyEnded 예약은 "조기반납" 칩 + "사용완료" 칩 세트로 표시
  //   안전: isPast = !isAct && !isFuture 조건이 '시작 시간 지남'을 이미 보장
  //         미래 예약이 earlyEnded=true인 경우는 데이터 오염 — 방어 불필요
  // ← [2026-05-06 사용자 명시 승인 Option 1] !isUserCancel 가드 추가 — 배타성 통일
  //   배경: 사용자가 직접 취소한 예약(autoCancelled=false 케이스 23건)이 isPast=true로
  //         평가되어 DetailModal/HomeView 등 maxChips 제한 없는 화면에서
  //         '예약자 취소' + '사용완료' 칩 동시 표시되는 문제
  //   원인: 다른 모든 cancel 분기(rejected/expired-pending/admin-cancel/noshow)는
  //         이미 isPast와 자동 배타 보장됨:
  //         · isRejected: status !== 'rejected' 조건으로 차단
  //         · isExpiredPending/isAdminCancel/isNoshow: !autoCancelled 조건으로 차단
  //         · isUserCancel만 autoCancelled=false 케이스에서 배타 보호 누락
  //   해결: 다른 분기와 동일한 배타 패턴 적용 → isUserCancel=true면 isPast=false
  //   의미: '사용완료'는 정상 사용 후 종료. 사용자가 취소한 건 '사용된 적 없음'.
  const isPast    = !isAct && !isFuture && !b.autoCancelled
                    && b.status !== 'pending' && b.status !== 'rejected'
                    && !isUserCancel                  // ← 신규: 다른 cancel 분기와 배타성 통일
  const tl        = sm - now
  // ─── [2026-05-04 STEP 3] isConfirmed: 일반 룸 미래 confirmed 살아있는 예약 ───
  //   · 정의: 미래(또는 오늘 시작 전) + status='confirmed' + 살아있음 + 일반 룸(non-Emerald) + countdown 외
  //   · 배타성:
  //     - Emerald 룸은 chip-approved(승인완료, 라임)로 별도 표시 → adminRoom 제외
  //     - "곧 시작" 카운트다운 표시 시 양보 → countdown 조건 제외
  //     - autoCancelled / checkedIn / earlyEnded 시 다른 상태 칩이 표시되므로 자동 배타
  //   · 적용: chip-confirmed (#CBECFF) — Figma node 449:796 1:1
  const isConfirmed = isFuture
                    && b.status === 'confirmed'
                    && !b.autoCancelled
                    && !b.checkedIn
                    && !b.earlyEnded
                    && !adminRoom                                  // ← Emerald 'approved' 칩과 배타
                    && !(isToday && tl > CHECKIN_EARLY_MIN && tl <= 10)            // ← [2026-05-12] "곧 시작" 칩(10~5분 전) 우선
  // ← [2026-04-24 P7-A] isOwner 판정 fallback 제거 — 이름 비교 0건 원칙 달성
  //   기존(P4-B): (currentUserId || currentUserEmail) ? isBooker(...) : (b.user === currentUser)
  //                ↑ 호환성 위해 이름 비교 fallback 유지
  //   변경(P7-A): isBooker(...) 단일 경로
  //                ↑ 호출부 4곳(MyPage/HomeView/BookingListTable/DetailModal) 모두
  //                  currentUserId/Email 전달 완료 확인됨 → fallback 불필요
  //   원칙: "이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식" (UUID OR email 이중 복원)
  //   주의: currentUser prop은 인터페이스 레벨에서 유지 (@deprecated), 내부 로직에서 참조 안 함
  const isOwner = isBooker(b, currentUserId, currentUserEmail)

  // ─── [2026-05-04 핫픽스 v11] mine 칩 라벨 분기 ───────────────────────────
  //   배경: 본인이 예약자(booker)일 때와 참석자(attendee)일 때 동일한 "내 예약" 칩 표시 → 역할 모호
  //   해결: A안+C안 — 라벨만 분기 (스타일 chip-mine 동일)
  //         · isOwner=true              → "내 예약"  (예약자 본인)
  //         · isOwner=false + isAttendeeOnly=true → "참석자" (참석자 본인)
  //   isAttendeeOnly: 본인이 예약자가 아니면서 참석자 목록에 있는 경우 (이중 신원 식별)
  //   정책 (userMemories §1.3): 예약자 OR 참석자 상호 배타 (예약자는 attendees에 포함 안 함)
  //                            → isOwner와 isAttendeeOnly는 동시 true 불가능
  const isAttendeeOnly = !isOwner && isAttendee(b, currentUserEmail)
  // mine 칩 표시 조건: 본인이 예약자이거나 참석자
  const isMine = isOwner || isAttendeeOnly

  // ── only 필터 헬퍼 ─────────────────────────────────────────────
  const show = (t: BadgeType) => !only || only.includes(t)

  const hasAny =
    (show('rejected')        && isRejected) ||
    (show('expired-pending') && isExpiredPending) ||
    (show('admin-cancel')    && isAdminCancel) ||
    (show('noshow')          && isNoshow) ||
    // ← [2026-05-04 옵션 B 메인 버그 수정] isOwner 가드 제거
    //   기존: (show('user-cancel') && isUserCancel && isOwner)
    //   문제: 본인이 예약자가 아닌 경우(참석자/관리자 시점) user-cancel 칩이 안 보임
    //   해결: isOwner 가드 제거 — 모든 시점에서 일관되게 표시 (라벨은 isAttendeeCancel로 분기)
    (show('user-cancel')     && isUserCancel) ||
    // ← [P2 v7] pending 뱃지는 '자동취소되지 않은 진짜 승인 대기'만
    //   isExpiredPending이 status='pending' 상태도 커버하므로 중복 방지
    (show('pending')         && b.status === 'pending' && !b.autoCancelled) ||
    (show('approved')        && isApproved) ||
    // ← [2026-05-04 STEP 3] confirmed 칩은 size='list'(MyBookingTable)에서만 표시
    //   배경: 다른 화면(HomeView/DetailModal/BookingListTable 등)에 자동 등장하면
    //         예상치 못한 디자인 변경 발생. 일단 MyBookingTable 전용으로 제한.
    //   추후: 다른 화면 디자인 정책 통일 시 가드 제거 가능 (Admin 재설계 채팅에서 검토)
    (show('confirmed')       && isConfirmed && size === 'list') ||
    (show('mine')            && isMine && !b.autoCancelled && !isRejected) ||
    (show('active')          && isAct) ||
    (show('checkin-wait')    && nci) ||
    (show('checkin-done')    && b.checkedIn && (isAct || isCheckedInWaiting(b))) ||  // ← [2026-05-28] 시작 전 체크인 완료 케이스도 포함
    (show('past')            && isPast) ||
    (show('early-end')       && b.earlyEnded) ||
    (show('countdown')       && !isAct && !b.autoCancelled && isToday && tl > CHECKIN_EARLY_MIN && tl <= 10)  // ← [2026-05-12] tl > 0 → tl > CHECKIN_EARLY_MIN: 10~5분 전만 "곧 시작" 표시

  if (!hasAny) return null

  const sizeClass  = SIZE_CLASS[size]
  // ← [피그마 180:534] shape='square'면 chip--square modifier 자동 추가 (radius 8)
  const shapeClass = shape === 'square' ? 'chip--square' : ''
  const gap = size === 'xs' ? 3 : shape === 'square' ? 4 : 5 // ← [피그마] 사각칩은 gap 4

  const C = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
    <span className={`chip ${sizeClass} ${shapeClass} ${cls}`.trim().replace(/\s+/g, ' ')}>{children}</span>
  )

  // ← [Figma UI갱신 2026-04-29] 칩을 배열로 수집 → maxChips로 slice 가능하게 변경
  //   · 기존: 각 칩을 JSX 조건부 렌더로 직렬 나열 → maxChips 지원 불가
  //   · 변경: chipList 배열에 push → slice(0, maxChips) 후 렌더
  //   · 판정 조건 완전 동일 (공식 변경 없음, 렌더 방식만 변경)
  //   · 뱃지 순서 정책 (소형 카드 우선순위 기준):
  //     mine → rejected → expired-pending → admin-cancel → noshow → user-cancel
  //     → pending → approved → active → checkin-wait → checkin-done
  //     → early-end → past → countdown
  const chipList: React.ReactNode[] = []

  // ← [피그마 180:534] 내 예약은 항상 맨 앞. sm 소형카드 + list 테이블행 제외, 노쇼(생성자 박제)도 표시
  //   ← [2026-05-04 STEP 3] size='list' 추가 — MyBookingTable은 단일 상태 칩만 표시 (mine 별도 칩 X)
  //   ← [2026-05-04 핫픽스 v11] isOwner → isMine (예약자 OR 참석자) + 라벨 동적 분기
  //      예약자 → "내 예약" / 참석자 → "참석자"  (스타일 chip-mine 동일)
  if (show('mine') && isMine && (!b.autoCancelled || isNoshow) && !isRejected && size !== 'sm' && size !== 'list')
    chipList.push(
      <C key="mine" cls="chip-mine">
        {isOwner ? '내 예약' : '참석자'}
      </C>
    )
  // ① 거절됨 — 최우선, 단독 표시
  if (show('rejected') && isRejected)
    chipList.push(<C key="rejected" cls="chip-rejected">거절됨</C>)
  // ② 기한초과 취소 (pending + autoCancelled)
  if (show('expired-pending') && isExpiredPending)
    chipList.push(<C key="expired" cls="chip-expired">기한초과 취소</C>)
  // ③ 관리자 강제취소 (rejected 제외)
  if (show('admin-cancel') && isAdminCancel)
    chipList.push(<C key="admin" cls="chip-admin">관리자 강제취소</C>)
  // ④ 노쇼 (system 자동취소)
  if (show('noshow') && isNoshow)
    chipList.push(<C key="noshow" cls="chip-noshow">노쇼</C>)
  // ⑤ 사용자 직접 취소 — 모든 시점에서 표시
  // ← [2026-05-04 옵션 B] isOwner 가드 제거 + 라벨 분기 (예약자 취소 / 참석자 취소)
  //   기존: chipList.push(<C cls="chip-neutral">취소됨</C>) — isOwner=true에서만
  //   변경: 모든 시점에서 표시 + isAttendeeCancel로 라벨 분기
  //   칩 클래스(chip-neutral)는 그대로 유지 — 사용자 결정: "user-cancel 칩 디자인 그대로, 라벨만 분기"
  if (show('user-cancel') && isUserCancel)
    chipList.push(
      <C key="usercancel" cls="chip-neutral">
        {isAttendeeCancel ? '참석자 취소' : '예약자 취소'}
      </C>
    )
  // ⑥ 승인 대기
  if (show('pending') && b.status === 'pending' && !b.autoCancelled)
    chipList.push(<C key="pending" cls="chip-pending">승인 대기</C>)
  // ⑦ 승인완료 (Emerald 룸 전용)
  if (show('approved') && isApproved)
    chipList.push(<C key="approved" cls="chip-approved">승인완료</C>)
  // ⑦-2 ← [2026-05-04 STEP 3] 예약확정 — size='list'(MyBookingTable) 전용 표시
  //   · Emerald는 위 approved로 처리되므로 배타
  //   · 다른 화면 영향 0을 위해 size 가드 적용 (hasAny와 동일)
  if (show('confirmed') && isConfirmed && size === 'list')
    chipList.push(<C key="confirmed" cls="chip-confirmed">예약확정</C>)
  // ⑧ 체크인 대기 / 완료 ← [2026-05-12] 우선순위 상향: ⑨ "진행 중"보다 위로 이동
  //   배경: maxChips=1 환경(HomeView 소형 카드/BookingListTable 등)에서 "진행 중" 칩이
  //         체크인 상태를 가려 사용자가 체크인 완료/대기 여부를 알기 어려웠음.
  //   변경: 체크인 상태를 먼저 push → maxChips=1이어도 "체크인 대기"/"체크인 완료"가 우선 표시.
  //   영향: maxChips 미지정 화면(DetailModal 등)은 표시 순서만 바뀜, 모든 칩 그대로 다 보임.
  if (show('checkin-wait') && nci)
    chipList.push(<C key="checkin-wait" cls="chip-checkin-wait">체크인 대기 중</C>)
  if (show('checkin-done') && b.checkedIn && (isAct || isCheckedInWaiting(b)))  // ← [2026-05-28] 시작 전 체크인 완료 케이스도 포함 (isCheckedInWaiting SSOT)
    chipList.push(<C key="checkin-done" cls="chip-success">체크인 완료</C>)
  // ⑨ 진행 중 (room color 동적 적용) ← [2026-05-12] ⑧ → ⑨로 우선순위 하향
  if (show('active') && isAct && !b.autoCancelled)
    chipList.push(
      <span key="active" className={`chip ${sizeClass} ${shapeClass}`.trim().replace(/\s+/g, ' ')}
        style={{ background: (r?.color ?? '#6366F1') + '18', color: r?.color ?? '#6366F1' }}>
        진행 중
      </span>
    )
  // ⑩ 조기반납 — '사용완료'보다 먼저 (Figma 242:427 순서)
  //    ← [2026-04-23] earlyEnded=true면 '조기반납' + '사용완료' 세트로 표시
  if (show('early-end') && b.earlyEnded)
    chipList.push(<C key="early-end" cls="chip-earlyend">조기반납</C>)
  // ⑪ 사용완료 ← [2026-04-23] 라벨 '종료' → '사용완료', !earlyEnded 제외
  if (show('past') && isPast)
    chipList.push(<C key="past" cls="chip-done">사용완료</C>)
  // ⑫ "곧 시작" 카운트다운 ← [2026-05-12] 라벨 "{tl}분 후" → "곧 시작" + 표시 범위 10~5분 전으로 축소
  //   · 5분 전부터는 checkin-wait 칩이 자리 대체 (사용자 정책)
  if (show('countdown') && !isAct && !b.autoCancelled && isToday && tl > CHECKIN_EARLY_MIN && tl <= 10)
    chipList.push(<C key="countdown" cls="chip-countdown">곧 시작</C>)

  // ← [Figma UI갱신] maxChips 미지정 시 전체 표시, 지정 시 상위 N개만
  // ← [2026-05-04 STEP 3] size='list'(MyBookingTable)는 단일 칩 표시 정책 — 자동 maxChips=1
  //   · 사용자 명시 maxChips가 있으면 그 값 우선
  //   · size='list' + maxChips 미지정 → 1개만
  //   · 그 외 → 전체 표시 (기존 동일)
  // ← [2026-05-06 핫픽스] AdminApprovalTable 사용자 보고: '승인완료' 칩만 보이고 라이프사이클 칩(사용완료/진행중) 안 보임
  //   근본 원인: chipList에 [approved, active/past/...] 다중 push되는데 maxChips=1로 첫 항목(approved)만 표시됨
  //   해결: size='list' + isApproved 시 maxChips 1 → 2 (승인완료 + 라이프사이클 1개 동시 표시)
  //   안전성: isApproved=true이면 ①~⑥ 칩 모두와 배타라 chipList[0]이 항상 'approved'
  //          → slice(0, 2)는 자연스럽게 [approved, lifecycle] 슬라이스
  //   영향: size!=='list'는 분기 자체가 아님 → 다른 화면(HomeView/DetailModal 등) 영향 0
  //         일반 룸(non-Emerald)은 isApproved=false → maxChips=1 유지 (기존 동일)
  const effectiveMax = maxChips !== undefined
    ? maxChips
    : (size === 'list'
        ? (isApproved ? 2 : 1)                // ← 핫픽스: 승인완료 룸은 라이프사이클 칩까지 2개 표시
        : undefined)
  const visibleChips = effectiveMax !== undefined ? chipList.slice(0, effectiveMax) : chipList

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {visibleChips}
    </div>
  )
}