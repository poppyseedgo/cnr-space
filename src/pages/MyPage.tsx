/**
 * MyPage.tsx — 내 마이페이지 (MyPageView) + 주간 뷰 (MyBookingWeeklyView)
 *
 * ✅ 변경 이력
 *  - [2026-05-04 STEP 1] MY PAGE 재설계 (Figma node 445:576) — 상단 카드 영역 + 데이터 보강
 *    · mapRow에 user_id, user_email 추가 (userMemories 룰: UUID OR email dual-recovery 준수)
 *    · 통계 계산 로직 변경
 *      - 기존: thisBks(전체 이번달) / thisRate(체크인율%) → 체크인율 카드 제거에 따라 삭제
 *      - 신규: thisMonthCount (미래 확정+승인대기, 노쇼/취소/거절 제외)
 *      - 신규: noshowCount (전체 누적 — 예약자+참석자 공통 책임)
 *    · 상단 1-통합카드 → 3-분리카드 (프로필 / 이번 달 예약 / 노쇼 횟수)
 *    · UserAvatar borderRadius prop 활용 (64×64 rounded-24, 원형 아님)
 *    · Icons.tsx에서 MailIcon import (Figma 추출 SVG)
 *    · 미수행 (다음 STEP): 기간별 예약 조회 영역, 월별 통계 섹션 제거
 *
 *  - [2026-04-27 KST FIX] mapRow에서 utcToKST 변환 적용
 *  - 이전 이력은 git log 참조
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { BarChart2, ClipboardList, Inbox } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'

import { cancelBooking as apiCancelBooking, upsertBookingAttendees, utcToKST } from '../lib/api'
import { WeeklyView } from '../components/layout/CalendarShell'
import { BookingStatusBadge } from '../components/common/BookingStatusBadge'
import { supabase } from '../lib/supabase'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

import { UserAvatar } from '../components/common/UserAvatar'
import { MailIcon } from '../components/common/Icons'   // ← [2026-05-04 STEP 1] Figma 추출 SVG 아이콘 (프로필 카드 이메일 옆)
import { BookingListTable } from '../components/common/BookingListTable'
import { Button } from '../components/common/Button' 

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, onCheckIn, onEarlyEnd, onCancel, rooms:rp=[], users:up=[], authUserId='', currentUserEmail='', avatarUrl=null}) {
  const [tab, setTab] = useState("upcoming");
  const [statYear, setStatYear] = useState(()=>new Date().getFullYear());
  const [statMonth, setStatMonth] = useState(()=>new Date().getMonth());
  const today = todayStr();
  const now = nowMinutes();
  const allUsers = up;
  const allRooms = rp;
  const userInfo = allUsers.find(u=>u.name===currentUser);

  // 전체 내 예약 기록 (마이페이지 전용 — 기간 제한 없이)
  const [allMyBookings, setAllMyBookings] = useState<Booking[]>([]);
  const [allLoading, setAllLoading] = useState(false);

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

  const cancelBooking = async (id) => {
    // 낙관적 UI 업데이트 (즉시 반영)
    setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:true} : b));
    showToast("예약이 취소되었습니다.", "info");
    try {
      // DB 반영
      await apiCancelBooking(id);
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:false} : b));
      showToast(err.message ?? "취소 중 오류가 발생했습니다.", "error");
    }
  };

  // user_id 기반 필터 (정확) → fallback: name 기반 (SSO 연동 전)
  // ─────────────────────────────────────────────────────────────────────────
  // ⚠️  참석자 정책 (절대 변경 금지)
  //   "내 예약" = 내가 예약자(user_id)이거나 참석자(booking_attendees.email)인 예약
  //   allMyBookings 가 이 두 조건을 모두 포함해서 fetch함 (위 useEffect 참고)
  //   아래 모든 통계·목록은 allMyBookings 단일 소스 사용 — fallback/분기 없음
  // ─────────────────────────────────────────────────────────────────────────

  // 실시간 탭 뷰 (예정/완료/취소)
  const upcoming  = useMemo(()=>allMyBookings.filter(b=>!b.autoCancelled&&(tsDate(b.start_at)>today||(tsDate(b.start_at)===today&&tsMin(b.end_at)>now))).sort((a,b)=>a.start_at.localeCompare(b.start_at)),[allMyBookings,today,now]);
  const completed = useMemo(()=>allMyBookings.filter(b=>!b.autoCancelled&&b.checkedIn&&(tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now))).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[allMyBookings,today,now]);
  const cancelled = useMemo(()=>allMyBookings.filter(b=>b.autoCancelled).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[allMyBookings]);
  const tabData = tab==="upcoming"?upcoming:tab==="completed"?completed:cancelled;

  // 월별 통계
  const monthStats = useMemo(()=>{
    const prefix=`${statYear}-${fmt2(statMonth+1)}`;
    const mb=allMyBookings.filter(b=>tsDate(b.start_at).startsWith(prefix));
    const total=mb.length, ci=mb.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length, can=mb.filter(b=>b.autoCancelled).length;
    const rate=total>0?Math.round((ci/total)*100):0;
    const rc: Record<number,number>={};mb.filter(b=>!b.autoCancelled).forEach(b=>{rc[b.room_id]=(rc[b.room_id]||0)+1;});
    const top=Object.entries(rc).sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
    const topRoom=top?(allRooms.find(r=>r.room_id===Number(top[0]))??null):null;
    return{total,checkedIn:ci,cancelled:can,rate,topRoom,topCount:top?top[1]:0};
  },[allMyBookings,statYear,statMonth]);

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
  const isNoshowBooking = (b: Booking) =>
    // ← userMemories 확정 룰 (절대 변경 금지): isNoshow = status==='confirmed' && cancelledBy==='system' && !checkedIn
    //   · auto_cancelled는 노쇼 판정에 사용 금지 (룰 명시)
    b.status === 'confirmed' && b.cancelledBy === 'system' && !b.checkedIn;

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
    <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ [2026-05-04 STEP 1] 상단 카드 영역 — Figma node 445:702 1:1 반영
          ─────────────────────────────────────────────────────────────────
          · 데스크톱: 가로 3-카드 (프로필 475px / 이번 달 예약 flex-1 / 노쇼 횟수 flex-1)
          · 모바일: 세로 스택 (각 카드 폭 100%) — Figma는 데스크톱만 정의, 모바일은 응답형 적용
          · 카드 공통: bg #fff, padding/내부구조는 카드별 상이, border-radius 24
          · gap: 16px (카드 사이)
          · 기존 1-통합카드 + 체크인율 카드 → 모두 제거됨
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="anm" style={{
        display:'flex',
        gap:16,                                                  // ← Figma: gap 16
        alignItems:'stretch',                                    // ← 카드 높이 균일 (flex-1 카드들이 prof 카드에 맞춤)
        flexDirection: isMobile ? 'column' : 'row',              // ← 모바일은 세로 스택
        marginBottom:24,                                         // ← Figma: 영역 간 24
      }}>

        {/* ── 카드 1: 프로필 카드 (Figma node 449:2525) ──────────────────── */}
        {/*    · width 475 (모바일은 100%) / padding 16 / radius 24 / bg #fff
              · 내부 gap 12 (avatar ↔ 프로필 정보)
              · 프로필 정보: padding 4 0 8 0 / gap 12 (이름블록 ↔ 이메일줄)
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          width: isMobile ? '100%' : 475,                        // ← Figma: 475
          padding: 16,                                            // ← Figma: padding 16
          borderRadius: 24,                                       // ← Figma: rounded 24
          background: '#fff',                                     // ← Figma: bg #fff
          display:'flex', flexDirection:'column', gap:12,
        }}>
          {/* 아바타 64×64, bg #CBECFF, rounded 24, 글자 #1E1E1E 24px Regular(400) */}
          <UserAvatar
            name={currentUser}
            avatarUrl={avatarUrl}
            size={64}                                             // ← Figma: 64×64
            bgColor="#CBECFF"                                     // ← Figma: bg #CBECFF (avatar)
            textColor="#1E1E1E"                                   // ← Figma: text #1E1E1E
            fontSize={24}                                          // ← Figma: 24px
            fontWeight={400}                                       // ← Figma: Regular
            borderRadius={24}                                      // ← [2026-05-04 STEP 1] 신규 prop — 새 디자인 사각 둥근모서리(원형 아님)
          />

          {/* 프로필 정보: 이름/부서 블록 + 이메일 줄 */}
          <div style={{
            paddingTop: 4, paddingBottom: 8,                       // ← Figma: pt 4 pb 8
            display:'flex', flexDirection:'column', gap:12,        // ← Figma: gap 12
          }}>
            {/* 이름 블록: 이름(24/SemiBold/#111/lh 1.25) + 부서(12/Regular/#AEB5C4/lh 1) */}
            <div style={{display:'flex', flexDirection:'column', gap:6}}>{/* ← Figma: gap 6 */}
              <div style={{
                fontSize:24,                                       // ← Figma: 24
                fontWeight:600,                                    // ← Figma: SemiBold
                color:'#111',                                      // ← Figma: #111
                lineHeight:1.25,                                   // ← Figma: leading 1.25
                wordBreak:'keep-all',                              // ← 한글 줄바꿈 자연스럽게 (Figma "성이름이 진짜 길면 줄바꿈으로 표기")
              }}>{currentUser}</div>
              <div style={{
                fontSize:12,                                       // ← Figma: 12
                fontWeight:400,                                    // ← Figma: Regular
                color:'#AEB5C4',                                   // ← Figma: #AEB5C4
                lineHeight:1,                                      // ← Figma: leading none
              }}>{currentDept}</div>
            </div>
            {/* 이메일 줄: mail 아이콘 16 + 이메일 텍스트 12/Regular/#262930 / gap 4 */}
            <div style={{display:'flex', alignItems:'center', gap:4}}>{/* ← Figma: gap 4 */}
              <MailIcon size={16}/>{/* ← Figma 추출 SVG (color #262930) */}
              <span style={{
                fontSize:12,                                       // ← Figma: 12
                fontWeight:400,                                    // ← Figma: Regular
                color:'#262930',                                   // ← Figma: #262930
                lineHeight:1,                                      // ← Figma: leading none
                whiteSpace:'nowrap',
                overflow:'hidden', textOverflow:'ellipsis',
              }}>{userInfo?.email ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* ── 카드 2: 이번 달 예약 카드 (Figma node 446:385) ─────────────── */}
        {/*    · flex-1 / padding 16 12 (좌우 16 상하 12) / radius 24 / bg #fff
              · 라벨 #9ED2FF Bold 16, 부제 #AEB5C4 Medium 12
              · 숫자 #111 Medium 32, text-align right
              · justify-content: space-between (라벨 위, 숫자 아래)
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          flex:1, minWidth:0,                                      // ← Figma: flex 1 0 0 / min-w 1px
          padding:'12px 16px',                                     // ← Figma: pl/pr 16 pt/pb 12
          borderRadius:24,                                         // ← Figma: rounded 24
          background:'#fff',
          display:'flex', flexDirection:'column', justifyContent:'space-between',
          minHeight: isMobile ? 120 : 196,                         // ← 모바일에선 좀 작게 / 데스크톱은 Figma 196 동일
        }}>
          {/* 라벨 + 부제 (gap 2) */}
          <div style={{display:'flex', flexDirection:'column', gap:2}}>{/* ← Figma: gap 2 */}
            <div style={{
              fontSize:16,                                         // ← Figma: 16
              fontWeight:700,                                      // ← Figma: Bold
              color:'#9ED2FF',                                     // ← Figma: #9ED2FF (브랜드 블루 액센트)
              lineHeight:1.5,                                      // ← Figma: leading 1.5
            }}>이번 달 예약</div>
            <div style={{
              fontSize:12,                                         // ← Figma: 12
              fontWeight:500,                                      // ← Figma: Medium
              color:'#AEB5C4',                                     // ← Figma: #AEB5C4
              lineHeight:1.5,
            }}>{thisMonthLabel}</div>{/* ← 동적: "5월 예약 수" 등 */}
          </div>
          {/* 숫자 (오른쪽 정렬, 32 Medium) */}
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end'}}>
            <span style={{
              fontSize:32,                                         // ← Figma: 32
              fontWeight:500,                                      // ← Figma: Medium
              color:'#111',                                        // ← Figma: #111
              lineHeight:1.5,                                      // ← Figma: leading 1.5
              textAlign:'right',
            }}>{allLoading ? '—' : thisMonthCount}</span>
          </div>
        </div>

        {/* ── 카드 3: 노쇼 횟수 카드 (Figma node 446:410) ────────────────── */}
        {/*    · flex-1 / padding 16 12 / radius 24 / bg #fff
              · 라벨 #FF6969 Bold 16 (브랜드 레드 액센트)
              · 안내문 #AEB5C4 Medium 12 leading 1.5 (2줄, 자동 줄바꿈)
              · 숫자 #111 Medium 32, text-align right
        ─────────────────────────────────────────────────────────────── */}
        <div style={{
          flex:1, minWidth:0,                                      // ← Figma: flex 1 0 0
          padding:'12px 16px',                                     // ← Figma: 16 12
          borderRadius:24,                                         // ← Figma: rounded 24
          background:'#fff',
          display:'flex', flexDirection:'column', justifyContent:'space-between',
          minHeight: isMobile ? 120 : 196,
        }}>
          <div style={{display:'flex', flexDirection:'column', gap:2}}>
            <div style={{
              fontSize:16,                                         // ← Figma: 16
              fontWeight:700,                                      // ← Figma: Bold
              color:'#FF6969',                                     // ← Figma: #FF6969 (브랜드 레드 액센트)
              lineHeight:1.5,
            }}>노쇼 횟수</div>
            <div style={{
              fontSize:12,                                         // ← Figma: 12
              fontWeight:500,                                      // ← Figma: Medium
              color:'#AEB5C4',
              lineHeight:1.5,
              wordBreak:'keep-all',                                // ← 한글 자연스러운 줄바꿈
            }}>
              {/* ← Figma: 2줄 안내문 — 패널티 정책 안내 (3회 이상 누적 시 적용) */}
              3회 이상 누적시 패널티가 적용됩니다.<br/>꼭 체크인 해주세요!
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end'}}>
            <span style={{
              fontSize:32, fontWeight:500, color:'#111',
              lineHeight:1.5, textAlign:'right',
            }}>{allLoading ? '—' : noshowCount}</span>
          </div>
        </div>

      </div>
      {/* ═══════════════════════════════════════════════════════════════════
          ↑ [2026-05-04 STEP 1] 상단 3-카드 영역 끝
          ═══════════════════════════════════════════════════════════════════ */}

      {/* ── 기간별 예약 조회 ── */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"16px 16px 20px":"20px 28px 24px",marginTop:20,animationDelay:"150ms"}}>
        <div style={{fontSize:15,fontWeight:600,color:"#111",marginBottom:16,display:"flex",alignItems:"center",gap:6}}>
          <ClipboardList size={15} strokeWidth={1.8}/>기간별 예약 조회
        </div>
        <BookingListTable
          bookings={allMyBookings}
          rooms={allRooms}
          users={allUsers}
          currentUser={currentUser}
          currentUserId={authUserId}
          currentUserEmail={currentUserEmail}
          onDetail={onDetail}
          loading={allLoading}
        />
        {/* ← [2026-04-24 P4-B] currentUserId={authUserId} 추가 — BookingListTable 내부 BookingStatusBadge가 isBooker 판정에 사용 */}
      </div>

      {/* 월별 통계 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",animationDelay:"100ms",marginTop:32}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:600,color:"#111"}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><BarChart2 size={15} strokeWidth={1.8}/>월별 이용 통계</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button className="btn" onClick={()=>{if(statMonth===0){setStatYear(y=>y-1);setStatMonth(11);}else setStatMonth(m=>m-1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>‹</button>
            <span style={{fontSize:13,fontWeight:600,color:"#111",minWidth:100,textAlign:"center"}}>{statYear}년 {MONTH_NAMES[statMonth]}</span>
            <button className="btn" onClick={()=>{if(statMonth===11){setStatYear(y=>y+1);setStatMonth(0);}else setStatMonth(m=>m+1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>›</button>
          </div>
        </div>
        {monthStats.total===0?(
          <div style={{textAlign:"center",padding:"32px",color:"#CBD5E1",fontSize:13}}>이 달의 예약 데이터가 없습니다</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {[{label:"예약",value:monthStats.total,color:"#3B82F6"},{label:"체크인",value:monthStats.checkedIn,color:"#16A34A"},{label:"취소/노쇼",value:monthStats.cancelled,color:"#F59E0B"}].map(bar=>(
              <div key={bar.label}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span style={{color:"#64748B",fontWeight:600}}>{bar.label}</span><span style={{color:"#111",fontWeight:600}}>{bar.value}건</span>
                </div>
                <div style={{height:8,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${monthStats.total>0?(bar.value/monthStats.total)*100:0}%`,background:bar.color,borderRadius:4,transition:"width 0.4s"}}/>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
                <div style={{fontSize:18,fontWeight:600,color:monthStats.rate>=70?"#16A34A":"#D97706",marginTop:2}}>{monthStats.rate}%</div>
              </div>
              {monthStats.topRoom&&(
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                  <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>가장 많이 이용</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#111",marginTop:2}}>{(monthStats.topRoom as any).room_name} ({monthStats.topCount}회)</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
            const isSoon    = minsUntil > 0 && minsUntil <= 10
            const cardState: string = b.status === 'rejected'       ? "rejected"
              : b.cancelledBy === 'admin'         ? "adminCancel"
              : b.cancelledBy === 'system'        ? "noshow"
              : b.autoCancelled                   ? "cancelled"
              : b.earlyEnded                      ? "earlyEnded"
              : b.checkedIn && isActive           ? "using"
              : b.checkedIn                       ? "done"
              : isActive                          ? "checkin"
              : isPast                            ? "done"
              : b.status === 'pending'            ? "pending"
              : isSoon                            ? "soon"
              : "waiting"
            const S: any = {
              waiting:    {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              soon:       {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              pending:    {label:"승인 대기",    btnBg:"#FEF3C7", btnColor:"#92400E", disabled:true,  action:null,                    showBtn:true},
              checkin:    {label:"체크인",       btnBg:"#16A34A", btnColor:"#fff",    disabled:false, action:()=>onCheckIn(b.id),     showBtn:true},
              using:      {label:"조기반납",     btnBg:"#111111", btnColor:"#fff",    disabled:false, action:()=>onEarlyEnd(b.id),    showBtn:true},
              noshow:     {label:null,           btnBg:"",        btnColor:"",        disabled:true,  action:null,                    showBtn:false},
              done:       {label:"종료",         btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              earlyEnded: {label:"반납됨",       btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  action:null,                    showBtn:true},
              adminCancel:{label:"강제취소",      btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              rejected:   {label:"거절됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              cancelled:  {label:"취소됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
            }[cardState] ?? {label:"체크인 대기", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true, action:null, showBtn:true}
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
