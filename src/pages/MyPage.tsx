/**
 * MyPage.tsx — 내 마이페이지 (MyPageView) + 주간 뷰 (MyBookingWeeklyView)
 *
 * ✅ 변경 이력
 *  - [2026-05-04 STEP 5] 상단 카드 영역 재디자인 (Figma node 454:3883 1:1)
 *    · 영역 높이: 196 → 152 (더 컴팩트)
 *    · 프로필 카드 폭: 475 → 540 + min-width 320
 *    · 프로필 카드 레이아웃: 아바타 위 세로 → 아바타 + 이름 가로 (gap 8)
 *    · 아바타: 64×64 rounded-24 / bg #CBECFF / text #1E1E1E 24 Regular
 *           → 42×42 rounded-full(원형) / bg #000(기본) / text #fff Light(300) 24
 *    · 이름 폰트: 24 SemiBold → 30 SemiBold (+6)
 *    · 부서/이메일: 별도 블록 + mail 아이콘 + 메일 12 / 부서 12
 *                → 하나의 블록 (둘 다 12 Regular #AEB5C4 leading 1.5), mail 아이콘 제거
 *    · 부서명 없을 때 div 출력 안 함 (Figma 명시: "부서명 없을 시에 div 출력하지 않기")
 *    · 우측 카드(이번달예약/노쇼횟수) 폭: 226.5 → 194 (flex-1 자동), 높이 196 → 152
 *    · 노쇼 안내문: 자연 줄바꿈 → 명시적 3줄 ("3회 이상 누적시" / "패널티가 적용됩니다." / "꼭 체크인 해주세요!")
 *    · MailIcon import 제거 (mail 아이콘 새 디자인에서 미사용)
 *
 *  - [2026-05-04 STEP 4] MY PAGE 재설계 통합 — 모든 영역 새 디자인 적용 완료
 *    · BookingListTable → MyBookingTable로 교체 (Admin은 BookingListTable 그대로 유지)
 *    · 월별 이용 통계 섹션 완전 제거 (statYear/statMonth/monthStats useMemo + UI 통째 제거)
 *    · 외곽 wrapper 추가: 페이지 배경 #F3F4F7 (App.tsx의 #F5F7F9를 부분 덮어씀, 다른 페이지 영향 0)
 *    · 기간별 예약 조회 섹션: 흰 카드 wrapper 제거 + 헤더 19 SemiBold + ClipboardList 아이콘 제거
 *    · CSV 버튼 클릭 시 showToast 안내 (CSV 기능은 추후 단계)  ← [2026-05-07] 버튼 자체 제거
 *    · dead code 정리: cancelBooking 함수 / tab/upcoming/completed/cancelled/tabData state
 *    · lucide 미사용 import 제거: BarChart2 / ClipboardList / Inbox
 *
 *  - [2026-05-04 STEP 1] MY PAGE 재설계 (Figma node 445:576) — 상단 카드 영역 + 데이터 보강
 *    · mapRow에 user_id, user_email 추가 (userMemories 룰: UUID OR email dual-recovery 준수)
 *    · 통계 계산 로직 변경
 *      - 기존: thisBks(전체 이번달) / thisRate(체크인율%) → 체크인율 카드 제거에 따라 삭제
 *      - 신규: thisMonthCount (미래 확정+승인대기, 노쇼/취소/거절 제외)
 *      - 신규: noshowCount (전체 누적 — 예약자+참석자 공통 책임)
 *    · 상단 1-통합카드 → 3-분리카드 (프로필 / 이번 달 예약 / 노쇼 횟수)
 *    · UserAvatar borderRadius prop 활용 (STEP 5에서 다시 기본 '50%' 원형으로 복원)
 *
 *  - [2026-04-27 KST FIX] mapRow에서 utcToKST 변환 적용
 *  - 이전 이력은 git log 참조
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
// ← [2026-05-04 STEP 4] lucide 미사용 import 제거: BarChart2/ClipboardList/Inbox 모두 새 디자인에서 사용 안 함
//   · BarChart2: 월별 통계 섹션 헤더 → 섹션 자체 제거
//   · ClipboardList: 기간별 예약 조회 헤더 → Figma 새 디자인은 아이콘 없음 ("기간별 예약 조회" 19 SemiBold)
//   · Inbox: 코드상 사용 0건 (dead import)
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN, CHECKIN_EARLY_MIN, isCheckinable, isCheckedInWaiting } from '../utils/time'  // ← [2026-05-28] isCheckedInWaiting 추가 — 시작 전 체크인 완료 미니카드 분기용

// ← [2026-05-04 STEP 4] api import 정리: cancelBooking/upsertBookingAttendees 미사용
//   · cancelBooking: STEP 4에서 함수 제거 (취소는 부모 onCancel prop 경유)
//   · upsertBookingAttendees: 본 파일 내 사용처 0건
import { utcToKST } from '../lib/api'
import { WeeklyView } from '../components/layout/CalendarShell'
import { BookingStatusBadge } from '../components/common/BookingStatusBadge'
import { supabase } from '../lib/supabase'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

import { UserAvatar } from '../components/common/UserAvatar'
// ← [2026-05-04 STEP 5] MailIcon import 제거 — 새 디자인 (Figma node 454:3883)은 이메일 옆 mail 아이콘 미사용
//   · Icons.tsx의 MailIcon export 자체는 유지 (향후 재사용 가능성)
// ← [2026-05-04 STEP 4] BookingListTable → MyBookingTable로 교체 (Admin은 BookingListTable 그대로 유지)
import { MyBookingTable } from '../components/common/MyBookingTable'
// ← [2026-07-18] 마이페이지 '내 대여' — 도서 대여 조회 + 연장(1회 +7일)
import { MyBookLoans } from '../components/library/MyBookLoans'
import { MyResourceBookings } from '../components/resource/MyResourceBookings'  // ← [2026-08-19 Phase 4] 자원 예약 탭
import { Button } from '../components/common/Button' 
import { isNoshow } from '../utils/noshow'  // ← [2026-05-11 Phase 2] isNoshow SSOT 통일 (기존 isNoshowBooking 별칭 사용)

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, onCheckIn, onEarlyEnd, onCancel, rooms:rp=[], users:up=[], authUserId='', currentUserEmail='', avatarUrl=null, initialQueryTab='room'}) {
  // ← [2026-05-04 STEP 4] dead state 제거:
  //   · const [tab, setTab]             — 탭 관리는 MyBookingTable 내부로 이전됨 (외부 탭 미존재)
  //   · const [statYear/statMonth]      — 월별 통계 섹션 자체 제거
  //   영향: 아래 upcoming/completed/cancelled/tabData/monthStats 사용 코드도 동시 제거
  const today = todayStr();
  const now = nowMinutes();
  const allUsers = up;
  const allRooms = rp;
  const userInfo = allUsers.find(u=>u.name===currentUser);

  // 전체 내 예약 기록 (마이페이지 전용 — 기간 제한 없이)
  const [allMyBookings, setAllMyBookings] = useState<Booking[]>([]);
  const [allLoading, setAllLoading] = useState(false);

  // ← [2026-07-18] 조회 섹션 세그먼트 탭: 회의실 예약 ↔ 도서 대여
  //   · 기본값 'room' — 기존 동작(회의실 조회) 그대로 보존
  //   · 'book' 선택 시 MyBookLoans (도서 대여 조회 + 연장) 렌더
  //   ← [2026-07-30] initialQueryTab: 도서관 '나의 도서 대여' CTA 진입 시 'book'.
  //     MyPage 는 view 전환마다 언마운트되므로 초기값 주입만으로 충분하다
  //     (마운트 후 prop 변경을 따라갈 필요 없음 — 사용자가 탭을 바꾼 상태를
  //      외부 값이 되돌리면 안 된다).
  const [queryTab, setQueryTab] = useState<'room' | 'book' | 'resource'>(initialQueryTab as 'room' | 'book' | 'resource');  // ← [Phase 4] 'resource' 추가

  // 딥링크 처리: #booking-{id} 로 진입 시 해당 예약 모달 자동 오픈
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    const raw = hash.startsWith('booking-')
      ? hash
      : (sessionStorage.getItem('cnr_deeplink') ?? '')
    if (!raw.startsWith('booking-')) return
    const bookingId = raw.replace('booking-', '')
    const target = allMyBookings.find((b: any) => b.id === bookingId)
    if (target) {
      onDetail(target)
      window.location.hash = 'mypage'
      sessionStorage.removeItem('cnr_deeplink')
    }
  }, [allMyBookings])

  // ── 내 예약 전체 fetch (예약자 + 참석자 모두 포함) ──────────────────────────
  // 정책: 내가 예약자이거나 참석자로 등록된 예약 모두 = 내 예약
  useEffect(() => {
    if (!authUserId) return;
    setAllLoading(true);

    const mapRow = (row: any) => ({
      id:            row.id,
      room_id:       row.room_id,
      title:         row.title,
      memo:          row.memo ?? '',
      attendees:     (row.booking_attendees ?? []).map((a: any) => ({
        email: a.email ?? '',
        name:  a.name  ?? '',
      })),
      // ← [2026-04-27 KST FIX] Supabase가 timestamptz를 UTC ISO("...+00:00")로 반환 → utcToKST로 +09:00 형식 변환 필수
      //   · 배경: 기존 row.start_at 그대로 저장 → BookingListTable에서 tsTime(ts.slice(11,16))이 UTC 시각 슬라이스 → 9시간 차이 표시
      //   · 해결: api.ts의 rowToBooking과 동일 패턴 적용 (utcToKST 함수 재사용)
      //   · 영향: 시간 판정 로직 변경 없음 — 표시 데이터의 변환 타이밍만 정상화
      start_at:      utcToKST(row.start_at),
      end_at:        utcToKST(row.end_at),
      user:          row.user_name,
      dept:          row.user_dept,
      user_id:       row.user_id,                     // ← [2026-05-04 STEP 1] 추가: isBooker 판정용 (UUID 불변 식별자)
      user_email:    row.user_email,                  // ← [2026-05-04 STEP 1] 추가: isBooker 판정 보조 (NOT NULL 보장)
      checkedIn:     row.checked_in,
      autoCancelled: row.auto_cancelled,
      cancelledBy:   row.cancelled_by ?? null,
      status:        row.status ?? 'confirmed',
      earlyEnded:    row.early_ended ?? false,
      recurGroupId:  row.recur_group_id ?? null,
      createdAt:     new Date(row.created_at).getTime(),
    });

    Promise.all([
      // ① 내가 예약자인 예약
      supabase
        .from('bookings')
        .select('*, booking_attendees(email, name)')
        .eq('user_id', authUserId)
        .order('start_at', { ascending: false }),

      // ② 내가 참석자인 예약 ID 목록
      currentUserEmail
        ? supabase
            .from('booking_attendees')
            .select('booking_id')
            .eq('email', currentUserEmail)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]).then(async ([bookerRes, attendeeRes]) => {
      const bookerRows   = bookerRes.data ?? [];
      const attendeeIds  = (attendeeRes.data ?? []).map((a: any) => a.booking_id);

      // ③ 참석자 예약 상세 조회 (예약자 목록과 중복 제거)
      let attendeeRows: any[] = [];
      if (attendeeIds.length > 0) {
        const bookerSet = new Set(bookerRows.map((r: any) => r.id));
        const idsToFetch = attendeeIds.filter((id: string) => !bookerSet.has(id));
        if (idsToFetch.length > 0) {
          const { data } = await supabase
            .from('bookings')
            .select('*, booking_attendees(email, name)')
            .in('id', idsToFetch)
            .order('start_at', { ascending: false });
          attendeeRows = data ?? [];
        }
      }

      // ④ 합치고 날짜 내림차순 정렬
      const merged = [...bookerRows, ...attendeeRows]
        .sort((a: any, b: any) => b.start_at.localeCompare(a.start_at));

      setAllMyBookings(merged.map(mapRow));
      setAllLoading(false);
    });

  }, [authUserId, currentUserEmail]);

  // ← [2026-05-04 STEP 4] dead code 일괄 제거:
  //   · cancelBooking 함수: 사용처 0건 (취소는 부모의 onCancel prop으로 처리)
  //   · upcoming/completed/cancelled/tabData: 외부 탭 UI 제거됨 (MyBookingTable이 자체 탭 관리)
  //   · monthStats: 월별 통계 섹션 자체 제거됨
  //   영향 범위 검증: grep 결과 위 변수들 사용 코드는 모두 삭제 대상 영역에만 존재
  //
  // ─────────────────────────────────────────────────────────────────────────
  // ⚠️  참석자 정책 (절대 변경 금지)
  //   "내 예약" = 내가 예약자(user_id)이거나 참석자(booking_attendees.email)인 예약
  //   allMyBookings 가 이 두 조건을 모두 포함해서 fetch함 (위 useEffect 참고)
  //   아래 통계는 allMyBookings 단일 소스 사용 — fallback/분기 없음
  // ─────────────────────────────────────────────────────────────────────────

  // 이번달 요약
  const thisPrefix  = `${new Date().getFullYear()}-${fmt2(new Date().getMonth()+1)}`;
  // ← [2026-05-04 STEP 1] 기존 thisCI/thisRate(체크인율) 제거 → 새 디자인은 "이번 달 예약 수" + "노쇼 횟수" 2개 카드
  //
  // ─── 이번 달 예약 수 (사용자 정의 2026-05-04) ────────────────────────────────
  //   · 포함: 미래(확정예약) + 승인대기(pending)
  //   · 제외: 노쇼 / 취소(autoCancelled 모든 종류) / 거절(rejected)
  //   · 해석: "이번 달에 살아있는 일정 + 정상적으로 끝난 일정" — 노쇼/취소/거절은 이번 달 예약으로 카운트하지 않음
  //   · 데이터 소스: allMyBookings (예약자+참석자 모두) — 사용자 정의 "공통의 책임" 원칙 적용
  // ─────────────────────────────────────────────────────────────────────────
  // ─── 노쇼 판별 ───────────────────────────────────────────────────────────
  // ← [2026-05-11 Phase 2] 로컬 isNoshowBooking 제거 — utils/noshow.ts SSOT 사용
  //   확정 룰 동일 (status==='confirmed' && cancelledBy==='system' && !checkedIn)
  //   기존 변수명 isNoshowBooking 유지 위해 isNoshow를 별칭으로 사용 (호출처 변경 0)
  const isNoshowBooking = isNoshow;

  const thisMonthCount = useMemo(() =>                  // ← [2026-05-04 STEP 1] 신규 — 상단 카드 "이번 달 예약" 값
    allMyBookings.filter(b => {
      if (!tsDate(b.start_at).startsWith(thisPrefix)) return false;  // ← 이번 달 예약만
      if (isNoshowBooking(b))             return false;              // ← 노쇼 제외
      if (b.autoCancelled)                return false;              // ← 모든 취소(user/admin) 제외
      if (b.status === 'rejected')        return false;              // ← Emerald 거절 제외
      return true;                                                    // ← 남은 것: confirmed(미래/완료) + pending(승인대기)
    }).length
  , [allMyBookings, thisPrefix]);

  // ─── 노쇼 횟수 (사용자 정의 2026-05-04) ──────────────────────────────────
  //   · 정의: 공통의 책임 — 예약자 + 참석자 모두 포함 (allMyBookings 전체에서 노쇼만)
  //   · 기간: 전체 누적 (3회 이상 누적시 패널티 적용 정책 — 패널티 시스템은 별도 채팅에서 구현)
  //   · 본 STEP 1에서는 카운트 표시까지만 구현
  // ─────────────────────────────────────────────────────────────────────────
  const noshowCount = useMemo(() =>                     // ← [2026-05-04 STEP 1] 신규 — 상단 카드 "노쇼 횟수" 값
    allMyBookings.filter(isNoshowBooking).length
  , [allMyBookings]);

  // ← [2026-05-04 STEP 1] 노쇼 라벨용 월 표시 — "5월 예약 수" 부제 (mn = month number 1~12)
  const thisMonthLabel = `${new Date().getMonth() + 1}월 예약 수`;

  return(
    /* ═══════════════════════════════════════════════════════════════════
       ↓ [2026-05-04 STEP 4] 외곽 wrapper — 페이지 전체 #F3F4F7 배경
       · Figma node 449:2333 1:1 (bg #F3F4F7)
       · App.tsx의 #F5F7F9 전역 배경을 부분 덮어씀 (다른 페이지 영향 0)
       · width 100% / minHeight 미지정 (콘텐츠가 충분히 길어서 viewport 자연 채움)
       ═══════════════════════════════════════════════════════════════════ */
    <div style={{
      background:'#F3F4F7',                              // ← Figma: 페이지 배경
      width:'100%',
    }}>
      <div style={{maxWidth:1024,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>{/* ← [2026-05-04] max-width 960 → 1024 (상태 컬럼 잘림 방지) */}

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ [2026-05-04 STEP 5] 상단 카드 영역 — Figma node 454:3883 1:1 재반영
          ─────────────────────────────────────────────────────────────────
          · 영역 높이: 196 → 152 (더 컴팩트)
          · 카드 1 프로필: 540 (min 320) / padding 16 / radius 24 / bg #fff
            - 내부 gap 12 (가로 블록 ↔ 부서/이메일 블록)
            - 가로 블록 (Figma 454:3886): avatar 42 + 이름 30 SemiBold, gap 8
            - 부서/이메일 블록: 둘 다 12 Regular #AEB5C4 leading 1.5, mail 아이콘 제거
            - 부서명 빈 경우 div 출력 X (Figma 454:3891 명시)
          · 카드 2/3 폭: 226.5 → 194 (flex-1 자동), 높이 196 → 152
          · 데스크톱: 가로 3-카드 / 모바일: 세로 스택
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="anm" style={{
        display:'flex',
        gap:8,                                                   // ← [2026-05-06] Figma: gap 8
        alignItems:'stretch',                                    // ← 카드 높이 균일
        flexDirection: isMobile ? 'column' : 'row',              // ← 모바일은 세로 스택
        marginBottom:24,                                         // ← Figma: 영역 간 24
      }}>

        {/* ── 카드 1: 프로필 카드 (Figma node 454:3884) ──────────────────── */}
        {/*    · width 540 (min 320, 모바일 100%) / padding 16 / radius 24 / bg #fff
              · 내부: flex flex-col gap 12 (가로 블록 ↔ 부서/이메일 블록)
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          width:    isMobile ? '100%' : 540,                    // ← Figma: 540 (이전 475)
          minWidth: isMobile ? undefined : 320,                  // ← Figma: min-w 320
          minHeight: isMobile ? 120 : 152,                       // ← Figma: 152 (이전 196)
          padding:  16,                                          // ← Figma: padding 16
          borderRadius: 24,                                       // ← Figma: rounded 24
          background: '#fff',                                     // ← Figma: bg #fff
          display:'flex', flexDirection:'column', gap:12,        // ← Figma: gap 12
        }}>
          {/* 가로 블록: 아바타 + 이름 (Figma node 454:3886) */}
          <div style={{
            display:'flex', alignItems:'center', gap:8,          // ← Figma: gap 8 / items-center
          }}>
            {/* 아바타 42×42 원형, bg #000 black, text #fff Light(300) 24 (Figma node 454:3887) */}
            <UserAvatar
              name={currentUser}
              avatarUrl={avatarUrl}
              size={42}                                          // ← Figma: 42 (이전 64)
              fontSize={24}                                       // ← Figma: 24
              fontWeight={300}                                    // ← Figma: Light (Pretendard:Light)
              textColor="#fff"                                    // ← Figma: white (기본 #E7E7E7 → 명시적 #fff)
              /* bgColor / borderRadius는 기본값 (#000 / '50%' 원형) 그대로 사용 */
            />
            {/* 이름 30 SemiBold #111 leading 1.25 (Figma node 454:3889) */}
            <span style={{
              fontSize:27,                                        // ← [2026-05-04] 사용자 요청 27 (이전 32)
              fontWeight:600,                                     // ← Figma: SemiBold
              color:'#111',                                       // ← Figma: #111
              lineHeight:1.25,                                    // ← Figma: leading 1.25
              whiteSpace:'nowrap',
              overflow:'hidden', textOverflow:'ellipsis',         // ← 이름 너무 길 때 ellipsis (이전 디자인의 wordBreak는 가로 배치이므로 부적합)
              minWidth:0,
            }}>{currentUser}</span>
          </div>

          {/* 부서/이메일 블록 (Figma node 454:3890) — 둘 다 12 Regular #AEB5C4 leading 1.5 */}
          <div style={{
            display:'flex', flexDirection:'column', alignItems:'flex-start',
            // ← Figma: 두 텍스트 같은 스타일이라 gap 0 (각 텍스트의 line-height 1.5로 자연 간격)
          }}>
            {/* ← Figma 454:3891 명시 요구사항: "부서명 없을 시에 div 출력하지 않기"
                  currentDept가 falsy(undefined/null/'')일 때 div 자체 미출력 */}
            {currentDept && (
              <p style={{
                margin:0,                                         // ← p 기본 margin 제거
                fontSize:12,                                      // ← Figma: 12
                fontWeight:400,                                   // ← Figma: Regular
                color:'#AEB5C4',                                  // ← Figma: #AEB5C4
                lineHeight:1.5,                                   // ← Figma: leading 1.5
                whiteSpace:'nowrap',
                overflow:'hidden', textOverflow:'ellipsis',
                maxWidth:'100%',
              }}>{currentDept}</p>
            )}
            <p style={{
              margin:0,
              fontSize:12,
              fontWeight:400,
              color:'#AEB5C4',
              lineHeight:1.5,
              whiteSpace:'nowrap',
              overflow:'hidden', textOverflow:'ellipsis',
              maxWidth:'100%',
            }}>{userInfo?.email ?? '—'}</p>
          </div>
        </div>

        {/* ── 카드 2: 이번 달 예약 카드 (Figma node 454:3893) ─────────────── */}
        {/*    · flex-1 / padding 16 12 / radius 24 / bg #fff
              · 높이 196 → 152 (모바일 120 유지)
              · 라벨/숫자 디자인 동일
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          flex:1, minWidth:0,                                      // ← Figma: flex 1 0 0 / min-w 1px
          padding:'12px 16px',                                     // ← Figma: pl/pr 16 pt/pb 12
          borderRadius:24,                                         // ← Figma: rounded 24
          background:'#fff',
          display:'flex', flexDirection:'column', justifyContent:'space-between',
          minHeight: isMobile ? 120 : 152,                         // ← [STEP 5] Figma: 152 (이전 196)
        }}>
          {/* 라벨 + 부제 (gap 2) */}
          <div style={{display:'flex', flexDirection:'column', gap:2}}>{/* ← Figma: gap 2 */}
            <div style={{
              fontSize:16,                                         // ← Figma: 16
              fontWeight:500,                                      // ← [2026-05-06] 700→500 Medium
              color:'#111',                                        // ← [2026-05-06] #9ED2FF→#111
              lineHeight:1.4,                                      // ← [2026-05-06] Figma: 1.4
              height:48,                                           // ← [2026-05-06] Figma: 2줄 고정 h-48
              overflow:'hidden',
            }}>이번 달<br/>나의 예약</div>{/* ← [2026-05-06] "이번 달 예약" → 2줄 */}
            <div style={{
              fontSize:12,                                         // ← Figma: 12
              fontWeight:400,                                      // ← [2026-05-06] 500→400 Regular
              color:'#AEB5C4',
              lineHeight:1.5,
            }}>{thisMonthLabel}</div>{/* ← 동적: "5월 예약 수" 등 */}
          </div>
          {/* 숫자 (오른쪽 정렬, 32 Medium) */}
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end'}}>
            <span style={{
              // ← [2026-05-04 핫픽스 v7] fontWeight:500 유지 (이미 적용됨, 사용자 요청 600→500 확인)
              //   색상은 검정 #111 유지 (노쇼 카운트만 컬러)
              fontSize:32, fontWeight:500, color:'#111',
              lineHeight:1.5, textAlign:'right',
            }}>{allLoading ? '—' : thisMonthCount}</span>
          </div>
        </div>

        {/* ── 카드 3: 노쇼 횟수 카드 (Figma node 454:3899) ────────────────── */}
        {/*    · flex-1 / padding 16 12 / radius 24 / bg #fff / 높이 152
              · 안내문 명시적 3줄 (Figma 디자이너 의도)
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          flex:1, minWidth:0,
          padding:'12px 16px',
          borderRadius:24,
          background:'#fff',
          display:'flex', flexDirection:'column', justifyContent:'space-between',
          minHeight: isMobile ? 120 : 152,                         // ← [STEP 5] Figma: 152 (이전 196)
        }}>
          <div style={{display:'flex', flexDirection:'column', gap:2}}>
            <div style={{
              fontSize:16,                                         // ← Figma: 16
              fontWeight:500,                                      // ← [2026-05-06] 700→500 Medium
              color:'#FF6969',                                     // ← Figma: #FF6969
              lineHeight:1.4,                                      // ← [2026-05-06] Figma: 1.4
            }}>노쇼 횟수</div>
            {/* ← [STEP 5] Figma node 454:3902 1:1: 명시적 3줄 분리
                기존 STEP 1에서는 자연 줄바꿈으로 2줄 표시. 새 디자인은 3줄로 끊음. */}
            <div style={{
              fontSize:12,                                         // ← Figma: 12
              fontWeight:400,                                      // ← [2026-05-06] 500→400 Regular
              color:'#AEB5C4',
              lineHeight:1.5,
            }}>
              <p style={{margin:0, lineHeight:1.5}}>3회 이상 누적시</p>
              <p style={{margin:0, lineHeight:1.5}}>패널티가 적용됩니다.</p>
              <p style={{margin:0, lineHeight:1.5}}>꼭 체크인 해주세요!</p>
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end'}}>
            <span style={{
              // ← [2026-05-04 핫픽스 v7] 노쇼 카운트 색상 검정 → rgb(252,126,126) (사용자 요청)
              //   fontWeight:500 유지 (이미 적용됨, 사용자 요청 600→500 확인)
              fontSize:32, fontWeight:500, color:'#FF6969',  // ← [2026-05-06] rgb(252,126,126)→#FF6969
              lineHeight:1.5, textAlign:'right',
            }}>{allLoading ? '—' : noshowCount}</span>
          </div>
        </div>

      </div>
      {/* ═══════════════════════════════════════════════════════════════════
          ↑ [2026-05-04 STEP 5] 상단 3-카드 영역 끝
          ═══════════════════════════════════════════════════════════════════ */}

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ [2026-05-04 STEP 4] 기간별 예약 조회 — Figma node 446:418 1:1
          ─────────────────────────────────────────────────────────────────
          · 기존: 흰색 카드 wrapper + ClipboardList 아이콘 + BookingListTable
          · 변경:
            - wrapper 카드 제거 (Figma 새 디자인은 페이지 배경 위 직접 배치)
            - 헤더: "기간별 예약 조회" 19px SemiBold #111, 좌우 패딩 0
            - 본체: MyBookingTable 신규 컴포넌트 (DateDisplay/세그먼트탭/회의실필터/h60행)
                                                  ↑ [2026-05-07] CSV 제거 / 회의실 필터 추가
          · padding: 24 0 (영역 자체 상하 24, 좌우 0 — Figma 449:2382)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="anm" style={{
        padding:'24px 0',                                  // ← Figma: py 24
        display:'flex', flexDirection:'column', gap:24,    // ← Figma: gap 24 (헤더 ↔ 필터 Row1 ↔ Row2 ↔ 테이블)
        animationDelay:'150ms',
      }}>
        {/* 섹션 헤더 (Figma node 449:2383: 19 Medium #111 leading 1.5) */}
        <div style={{
          fontSize:19,                                     // ← Figma: 19
          fontWeight:500,                                  // ← [2026-05-06] 600→500 Medium
          color:'#111',                                    // ← Figma: #111
          lineHeight:1.5,                                  // ← Figma: leading 1.5
          whiteSpace:'nowrap',
        }}>{queryTab === 'room' ? '나의 예약 조회' : queryTab === 'book' ? '나의 대여 조회' : '나의 자원 예약 조회'}</div>{/* ← [2026-07-18] 탭에 따라 제목 전환 */}

        {/* ── [2026-07-18] 세그먼트 탭: 회의실 예약 ↔ 도서 대여 ──────────────
            · 기존 회의실 조회 동작은 그대로 유지 (기본 탭 'room')
            · 도서 탭은 MyBookLoans가 자체 fetch/연장 처리 */}
        <div style={{ display:'flex', gap:6, padding:4, background:'#F1F5F9',
          borderRadius:12, width:'fit-content' }}>
          {([['room','회의실 예약'],['book','도서 대여'],['resource','자원 예약']] as const).map(([key,label]) => (  // ← [Phase 4] 자원 세그먼트
            <button
              key={key}
              onClick={() => setQueryTab(key)}
              style={{
                padding:'8px 18px', borderRadius:9, border:'none', fontSize:13,
                fontWeight: queryTab === key ? 600 : 500,
                background:  queryTab === key ? '#fff' : 'transparent',
                color:       queryTab === key ? '#111' : '#64748B',
                boxShadow:   queryTab === key ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                cursor:'pointer',
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── [2026-08-19 Phase 4] 자원 예약 탭 — MyResourceBookings 자체 fetch ── */}
        {queryTab === 'resource' && (
          <MyResourceBookings
            authUserId={authUserId}
            showToast={showToast}
            isMobile={isMobile}
          />
        )}

        {/* ── 도서 대여 탭 ─────────────────────────────────────────────── */}
        {queryTab === 'book' && (
          <MyBookLoans
            authUserId={authUserId}
            showToast={showToast}
            isMobile={isMobile}
          />
        )}

        {/* ── 회의실 예약 탭 (기존) ────────────────────────────────────── */}
        {/* MyBookingTable — 모든 필터/탭/테이블/페이지네이션 자체 관리 */}
        {/* ← [2026-05-07] CSV 버튼 제거 + 회의실 필터 추가 (MyBookingTable 내부에서 처리) */}
        {queryTab === 'room' && (
        <MyBookingTable
          bookings={allMyBookings}
          rooms={allRooms}
          users={allUsers}
          currentUserId={authUserId}                       // ← BookingStatusBadge isBooker 판정용
          currentUserEmail={currentUserEmail}              // ← 이중 복원 fallback
          onDetail={onDetail}
          loading={allLoading}
        />
        )}{/* ← [2026-07-18] queryTab === 'room' 조건부 닫기 */}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ [2026-05-04 STEP 4] 월별 이용 통계 섹션 완전 제거
          ─────────────────────────────────────────────────────────────────
          · 기존: monthStats 막대그래프 + 체크인율 + 가장 많이 이용 + 월 네비게이션
          · 제거 사유: 새 디자인에 통계 섹션 자체 없음. 통계 UI는 상단 노쇼 횟수
                      카드(STEP 1)로 부분 대체. 추후 별도 통계 페이지로 분리 가능.
          · 영향: monthStats useMemo / statYear/statMonth state 모두 제거 (작업 4-2/4-3 완료)
          · BarChart2 lucide 아이콘 import도 제거 (작업 4-1 완료)
          ═══════════════════════════════════════════════════════════════════ */}

      </div>
      {/* ↑ 콘텐츠 wrapper 닫기 (max-width 960) */}
      {/* ↑ [2026-05-04 STEP 4] 외곽 wrapper 닫기는 다음 라인 (#F3F4F7 배경) */}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ─── My Booking Weekly View ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// ← [2026-04-24 P5 FIX] authUserId, currentUserEmail prop 추가
//   · 사용처: L353 BookingStatusBadge 호출 시 isBooker 판정용 전달
//   · 기존 authUser 객체도 유지 (다른 위치에서 사용 중)
export function MyBookingWeeklyView({bookings, currentUser, rooms=[], onDetail, onCheckIn, onEarlyEnd, onCancel, onNewBooking, authUser, authUserId = '', currentUserEmail = ''}: {bookings:any[], currentUser:string, rooms?:any[], onDetail:(b:any)=>void, onCheckIn:(id:string)=>void, onEarlyEnd:(id:string)=>void, onCancel:(id:string)=>void, onNewBooking:()=>void, authUser:any, authUserId?:string, currentUserEmail?:string}) {
  const today = todayStr()
  const now   = nowMinutes()
  const [selectedDate, setSelectedDate] = useState(today)
  const { isMobile } = useBreakpoint()

  // 본인 예약만 필터
  const myBookings = bookings.filter(b => b.user === currentUser)

  // 오늘 내 예약 (취소 제외, 사용자가 취소한 것만 제외)
  const todayBookings = myBookings
    .filter(b => tsDate(b.start_at) === today && b.cancelledBy !== 'user')
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  // 주 네비게이션
  const weekStart = getWeekStart(selectedDate)
  const weekEnd   = addDays(weekStart, 6)
  const ws = dateToObj(weekStart), we = dateToObj(weekEnd)
  const weekLabel = `${ws.getFullYear()}년 ${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}일 – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}일`

  const goWeek = (dir: number) => setSelectedDate(addDays(selectedDate, dir * 7))

  return (
    <div style={{maxWidth:1400, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>

      {/* ── 오늘 내 예약 — HomeView 동일 카드 UI ── */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12}}>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <span style={{fontSize:15, fontWeight:600, color:"#111"}}>오늘 내 예약</span>
            <span style={{fontSize:12, color:"#94A3B8", fontWeight:500}}>{todayBookings.length}건</span>
          </div>
        </div>

        <div className="flex gap-3 pb-2"
          style={{overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch", paddingRight:4}}>

          {/* + 예약하기 첫 카드 */}
          <button onClick={()=>document.dispatchEvent(new CustomEvent("openNewBooking"))}
            className="btn flex-none flex flex-col items-center justify-center rounded-2xl text-white font-semibold"
            style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
              background:"#111111", flexShrink:0, gap:8}}>
            <span style={{fontSize:24, lineHeight:1}}>＋</span>
            <span style={{fontSize:isMobile?12:13}}>예약하기</span>
          </button>

          {todayBookings.length === 0 ? (
            <div className="flex-none flex items-center justify-center rounded-2xl text-slate-300 text-sm"
              style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140, background:"#F3F4F8"}}>
              오늘 예약 없음
            </div>
          ) : todayBookings.map(b => {
            const r = (rooms as any[]).find((r:any) => r.room_id === b.room_id)
            const isActive  = tsMin(b.start_at) <= now && now < tsMin(b.end_at) && !b.autoCancelled
            const isPast    = tsMin(b.end_at) < now
            const minsUntil = tsMin(b.start_at) - now
            // ← [2026-05-12] isSoon 범위 변경: 10~5분 전만 "곧 시작" 표시 (5분 전부터는 isCheckinable이 자리 대체)
            const isSoon    = minsUntil > CHECKIN_EARLY_MIN && minsUntil <= 10
            // ← [2026-05-12] cardState 분기 변경 — HomeView와 동일 패턴
            //   · "checkin" 활성 조건: isActive → isCheckinable(b) (5분 전부터 활성)
            //   · "soon"/"waiting" 라벨: "체크인 대기" → "곧 시작" (전체 라벨 통일)
            // ← [2026-05-28] checkedInWaiting 분기 신규 추가 — HomeView와 동일 패턴
            //   배경: 5분 전 체크인 후 checkedIn=true && isActive=false 상태가
            //         기존 분기에서 "done"(종료)으로 잘못 폴백되어 "종료" 라벨 표시
            //   해결: isCheckedInWaiting SSOT 헬퍼로 새 분기 추가
            const cardState: string = b.status === 'rejected'       ? "rejected"
              : b.cancelledBy === 'admin'         ? "adminCancel"
              : b.cancelledBy === 'system'        ? "noshow"
              : b.autoCancelled                   ? "cancelled"
              : b.earlyEnded                      ? "earlyEnded"
              : b.checkedIn && isActive           ? "using"
              : isCheckedInWaiting(b)             ? "checkedInWaiting"   // ← [2026-05-28] 시작 전 체크인 완료
              : b.checkedIn                       ? "done"
              : isCheckinable(b)                  ? "checkin"   // ← [2026-05-12] 5분 전부터 활성
              : isActive                          ? "checkin"   // 진행중인데 isCheckinable=false → 폴백
              : isPast                            ? "done"
              : b.status === 'pending'            ? "pending"
              : isSoon                            ? "soon"      // ← [2026-05-12] 10~5분 전
              : "waiting"
            const S: any = {
              // ← [2026-05-12 Figma 556:6212~6225 사용자 요청] 라벨/색상 변경
              //   · checkin 라벨: "체크인" → "체크인 하세요"
              //   · earlyEnded 색상: 파랑(#DBEAFE/#2563EB) → 보라(#EDE9FE/#7C3AED) — chip-earlyend와 통일
              waiting:    {label:"곧 시작",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              soon:       {label:"곧 시작",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              pending:    {label:"승인 대기",    btnBg:"#FEF3C7", btnColor:"#92400E", disabled:true,  action:null,                    showBtn:true},
              checkin:    {label:"체크인 하세요", btnBg:"#16A34A", btnColor:"#fff",    disabled:false, action:()=>onCheckIn(b.id),     showBtn:true},  // ← [2026-05-12] 라벨 변경
              using:      {label:"조기반납",     btnBg:"#111111", btnColor:"#fff",    disabled:false, action:()=>onEarlyEnd(b.id),    showBtn:true},
              // ← [2026-05-28] 시작 전 체크인 완료 — HomeView와 동일 패턴
              //   · "{N}분 뒤 사용" 카운트다운 (양수일 때), 0 이하면 "곧 시작" 폴백
              //   · MyPage 회색 톤(#F1F5F9/#94A3B8) 적용 — waiting/soon과 동일
              //   · 상단 BookingStatusBadge가 "체크인 완료" 칩 자동 표시
              checkedInWaiting: {label: minsUntil > 0 ? `${minsUntil}분 뒤 사용` : "곧 시작", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true, action:null, showBtn:true},
              noshow:     {label:null,           btnBg:"",        btnColor:"",        disabled:true,  action:null,                    showBtn:false},
              done:       {label:"종료",         btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              earlyEnded: {label:"반납됨",       btnBg:"#EDE9FE", btnColor:"#7C3AED", disabled:true,  action:null,                    showBtn:true},  // ← [2026-05-12] 칩과 색상 통일
              adminCancel:{label:"강제취소",      btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              rejected:   {label:"거절됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              cancelled:  {label:"취소됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
            }[cardState] ?? {label:"곧 시작", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true, action:null, showBtn:true}
            const isCancellable = cardState==="waiting" || cardState==="soon" || cardState==="pending"
            return (
              <div key={b.id}
                className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl p-3"
                onClick={()=>onDetail(b)}
                style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
                  flexShrink:0, cursor:"pointer",
                  opacity:(cardState==="cancelled"||cardState==="noshow"||cardState==="adminCancel"||cardState==="rejected")?0.45:1,
                  border:cardState==="pending"?"1.5px solid #FCD34D":"none"}}>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2 mb-1.5">{b.title}</div>
                  <div style={{marginBottom:4}}>
                    {/* ← [2026-04-24 P7-A] currentUser 전달 제거 — isBooker 판정은 currentUserId/Email로 충분 */}
                    <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} size="sm" currentUserId={authUserId} currentUserEmail={currentUserEmail} />
                  </div>
                  <div className="text-[10px] text-slate-400">{r?.room_name ?? ''}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRangeFull(b.start_at, b.end_at)}</div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {S.showBtn && (
                    <button className="btn flex-1 text-[11px] font-semibold rounded-xl py-2"
                      onClick={e=>{e.stopPropagation(); S.action?.();}}
                      disabled={S.disabled}
                      style={{background:S.btnBg, color:S.btnColor, cursor:S.disabled?"default":"pointer",
                        minHeight:32, display:"flex", alignItems:"center", justifyContent:"center"}}>
                      {S.label}
                    </button>
                  )}
                  {isCancellable && (
                    <Button variant="ghost" size="sm" style={{borderRadius:12}}
                      onClick={e=>{e.stopPropagation(); onCancel(b.id);}}>취소</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 주간 예약 ── */}
      <div>
        {/* 주 네비게이션 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 mb-4"
          style={{padding: isMobile?"10px 12px":"12px 18px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, position:"relative"}}>
          <button className="btn rounded-lg text-slate-600"
            style={{padding:"7px 14px", fontSize:20, background:"#F8FAFC", lineHeight:1}}
            onClick={()=>goWeek(-1)}>‹</button>
          <span style={{fontSize:isMobile?14:15, fontWeight:600, color:"#111111", whiteSpace:"nowrap"}}>
            {weekLabel}
          </span>
          <button className="btn rounded-lg text-slate-600"
            style={{padding:"7px 14px", fontSize:20, background:"#F8FAFC", lineHeight:1}}
            onClick={()=>goWeek(1)}>›</button>
          {selectedDate !== today && (
            <Button variant="primary" size="sm" style={{marginLeft:4}}
              onClick={()=>setSelectedDate(today)}>오늘</Button>
          )}
        </div>

        {/* WeeklyView */}
        <WeeklyView
          bookings={myBookings}
          selectedDate={selectedDate}
          onBlockClick={onDetail}
          onEmptyClick={()=>{}}
          rooms={rooms}
          currentUser={currentUser}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin View ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
