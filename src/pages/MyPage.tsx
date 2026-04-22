import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { BarChart2, ClipboardList, Inbox } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'

import { cancelBooking as apiCancelBooking, upsertBookingAttendees } from '../lib/api'
import { WeeklyView } from '../components/layout/CalendarShell'
import { BookingStatusBadge } from '../components/common/BookingStatusBadge'
import { supabase } from '../lib/supabase'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

import { UserAvatar } from '../components/common/UserAvatar'
import { BookingListTable } from '../components/common/BookingListTable'
import { MiniBookingCard } from '../components/common/MiniBookingCard'  // ← [v2.1 신규] 공통 카드 컴포넌트
import { Button } from '../components/common/Button' 

/**
 * MyPage — 마이페이지 (프로필 + 통계 + 예약 관리)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력 (v2.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2026-04-21 v2.1] auto_cancelled 설계 재정립 + 4개 탭 UI 신설
 *   · 배경: api.ts/BookingStatusBadge/HomeView가 v2.1로 업데이트됨
 *   · v2.1 DB 규칙:
 *     · User/Admin 취소: status='cancelled' + autoCancelled=false + cancelledBy='user'/'admin'
 *     · Admin 거절:      status='rejected'
 *     · 기한초과(cron):  status='pending'   + autoCancelled=true  + cancelledBy='system'
 *     · 노쇼(cron):      status='confirmed' + autoCancelled=true  + cancelledBy='system' + !checkedIn
 *
 *   · 변경 범위:
 *     [MyPageView]
 *       (1) isNoshow() / isCancelled() 헬퍼 추가 (BookingListTable과 동일 로직)
 *       (2) upcoming/completed/cancelled/noshow 필터 v2.1 재작성
 *       (3) tab state: "upcoming"/"completed"/"cancelled"/"noshow" 4개 탭
 *       (4) tab UI 신설: 탭 버튼 4개 + BookingStatusBadge 형식 리스트
 *       (5) monthStats: 체크인/취소 카운트 v2.1 필터 반영
 *     [MyBookingWeeklyView]
 *       (6) todayBookings 필터 v2.1 업데이트 (User/Admin 취소 명시적 제외)
 *       (7) cardState 판정 재작성 (HomeView와 동일 로직, userCancel 분기 추가)
 *       (8) opacity 조건 cancelled → userCancel 이름 변경 반영
 *
 *   · 정책 준수:
 *     · 노쇼 별도 탭: "취소된 예약"과 질적으로 다르므로 분리 (고지님 설계 원칙)
 *     · BookingListTable과 동일한 노쇼/취소 판정 로직 사용 (단일 진실 원천)
 *
 *   · 설계 문서: 예약상태관리_설계문서_v2.1.md
 */

// ─── 노쇼 판별 (v2.1) ─────────────────────────────────────────────────────────
// ← [2026-04-21 v2.1] BookingListTable과 동일 로직 — 단일 진실 원천
//   노쇼 정의: status='confirmed' + autoCancelled=true + cancelledBy='system'
//            + !checkedIn + !earlyEnded (체크인 안 한 것만)
function isNoshow(b: Booking): boolean {
  return b.status === 'confirmed'
      && !!b.autoCancelled
      && b.cancelledBy === 'system'
      && !b.checkedIn
      && !b.earlyEnded
}

// ─── 취소 판별 (v2.1) ─────────────────────────────────────────────────────────
// ← [2026-04-21 v2.1] BookingListTable과 동일 로직
//   취소 카테고리: Admin 거절 + User/Admin 취소 + 기한초과 (노쇼 제외)
function isCancelled(b: Booking): boolean {
  if (b.status === 'rejected') return true
  if (b.status === 'cancelled') return true
  if (b.status === 'pending' && b.autoCancelled) return true
  return false
}

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, onCheckIn, onEarlyEnd, onCancel, rooms:rp=[], users:up=[], authUserId='', currentUserEmail='', avatarUrl=null}) {
  // ← [v2.1] 탭 4개: 예정/완료/취소/노쇼 (노쇼 별도 분리)
  const [tab, setTab] = useState<"upcoming"|"completed"|"cancelled"|"noshow">("upcoming");
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
      start_at:      row.start_at,
      end_at:        row.end_at,
      user:          row.user_name,
      dept:          row.user_dept,
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
    // ← [v2.1] 롤백 안전장치: 원본 booking snapshot 저장
    //   롤백 시 원래 status/autoCancelled/cancelledBy 복원 (pending/confirmed 구분)
    let snapshot: Booking | undefined
    setBookings(prev => {
      snapshot = prev.find(b => b.id === id)
      // 낙관적 UI 업데이트 (즉시 반영)
      // v2.1 User 취소 DB 저장 형태: status='cancelled' + autoCancelled=false + cancelledBy='user'
      return prev.map(b => b.id===id ? {
        ...b,
        status: 'cancelled',            // ← [v2.1 추가] cancelled 상태 명시
        autoCancelled: false,            // ← [v2.1 변경] true→false (사람 개입이므로)
        cancelledBy: 'user'              // ← [v2.1 추가] user 명시
      } : b)
    });
    showToast("예약이 취소되었습니다.", "info");
    try {
      // DB 반영
      await apiCancelBooking(id);
    } catch (err: any) {
      // ← [v2.1] 실패 시 snapshot으로 원상 복구 (status/autoCancelled/cancelledBy 전부)
      if (snapshot) {
        setBookings(prev => prev.map(b => b.id===id ? snapshot! : b));
      }
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

  // ← [v2.1] 실시간 탭 뷰 (예정/완료/취소/노쇼) — BookingListTable과 동일 로직
  //   · upcoming:  미래 예약 (취소/노쇼/기한초과 제외)
  //   · completed: 체크인 완료 또는 조기종료 (취소/노쇼 제외, status='confirmed')
  //   · cancelled: User/Admin 취소 + 거절 + 기한초과 (노쇼 제외)
  //   · noshow:    노쇼만 별도 (v2.1 설계 - 노쇼 별도 탭 분리)
  const upcoming = useMemo(()=>
    allMyBookings
      .filter(b =>
        !b.autoCancelled &&                                    // 노쇼/기한초과 제외
        b.status !== 'cancelled' &&                             // ← [v2.1 추가] User/Admin 취소 제외
        b.status !== 'rejected' &&                              // ← [v2.1 추가] 거절 제외
        (tsDate(b.start_at) > today || (tsDate(b.start_at) === today && tsMin(b.end_at) > now))
      )
      .sort((a,b) => a.start_at.localeCompare(b.start_at)),
    [allMyBookings, today, now]
  );
  const completed = useMemo(()=>
    allMyBookings
      .filter(b =>
        !b.autoCancelled &&
        b.status === 'confirmed' &&                             // ← [v2.1 추가] 확정 상태만
        b.checkedIn &&
        (tsDate(b.start_at) < today || (tsDate(b.start_at) === today && tsMin(b.end_at) <= now))
      )
      .sort((a,b) => b.start_at.localeCompare(a.start_at)),
    [allMyBookings, today, now]
  );
  // ← [v2.1] cancelled: isCancelled() 헬퍼 사용 (노쇼 제외)
  const cancelled = useMemo(()=>
    allMyBookings
      .filter(b => isCancelled(b))
      .sort((a,b) => b.start_at.localeCompare(a.start_at)),
    [allMyBookings]
  );
  // ← [v2.1 신규] noshow 탭 - 노쇼만 별도 분리
  const noshow = useMemo(()=>
    allMyBookings
      .filter(b => isNoshow(b))
      .sort((a,b) => b.start_at.localeCompare(a.start_at)),
    [allMyBookings]
  );
  const tabData = tab==="upcoming" ? upcoming
                : tab==="completed" ? completed
                : tab==="cancelled" ? cancelled
                : noshow;

  // ← [v2.1] 월별 통계 — 체크인율과 취소/노쇼 카운트를 명확히 분리
  const monthStats = useMemo(()=>{
    const prefix=`${statYear}-${fmt2(statMonth+1)}`;
    const mb=allMyBookings.filter(b=>tsDate(b.start_at).startsWith(prefix));
    const total=mb.length;
    // 체크인 = 체크인 완료 또는 조기종료 (정상 종료, 취소/노쇼 제외)
    const ci=mb.filter(b=>(b.checkedIn||b.earlyEnded) && !b.autoCancelled && b.status === 'confirmed').length;
    // 취소+노쇼 = 모든 취소 유형 (cancelled + noshow 합산)
    const can=mb.filter(b => isCancelled(b) || isNoshow(b)).length;
    const rate=total>0?Math.round((ci/total)*100):0;
    // 자주 예약하는 회의실 — 취소 건 제외
    const rc: Record<number,number>={};
    mb.filter(b=>!isCancelled(b) && !isNoshow(b)).forEach(b=>{rc[b.room_id]=(rc[b.room_id]||0)+1;});
    const top=Object.entries(rc).sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
    const topRoom=top?(allRooms.find(r=>r.room_id===Number(top[0]))??null):null;
    return{total,checkedIn:ci,cancelled:can,rate,topRoom,topCount:top?top[1]:0};
  },[allMyBookings,statYear,statMonth]);

  // ← [v2.1] 이번달 요약 — 체크인율 계산
  const thisPrefix  = `${new Date().getFullYear()}-${fmt2(new Date().getMonth()+1)}`;
  const thisBks     = allMyBookings.filter(b=>tsDate(b.start_at).startsWith(thisPrefix));
  const thisPastBks = thisBks.filter(b=>tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now));
  // ← [v2.1] 체크인 완료만 카운트 (취소/노쇼 제외)
  const thisCI      = thisPastBks.filter(b=>b.checkedIn && !b.autoCancelled && b.status === 'confirmed').length;
  const thisRate    = thisPastBks.length>0?Math.round((thisCI/thisPastBks.length)*100):0;

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>

      {/* 프로필 카드 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",marginBottom:20,
        display:"flex",alignItems:isMobile?"flex-start":"center",gap:isMobile?16:20,flexDirection:isMobile?"column":"row"}}>
        <UserAvatar name={currentUser} avatarUrl={avatarUrl} size={56} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontWeight:600,color:"#111"}}>{currentUser}</div>
          <div style={{fontSize:13,color:"#64748B",marginTop:2}}>{currentDept} · {userInfo?.email}</div>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:600,color:"#111"}}>{allLoading ? "—" : thisBks.length}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>이번 달 예약</div>
          </div>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:600,color:thisRate>=70?"#16A34A":"#D97706"}}>{allLoading ? "—" : `${thisRate}%`}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
          </div>
        </div>
      </div>

      {/* ── [v2.1 신규] 내 예약 빠른 조회 (4개 탭: 예정/완료/취소/노쇼) ── */}
      {/* 정책: 전체 기간 대상으로 "예정/완료/취소/노쇼"만 빠르게 확인 */}
      {/* BookingListTable에 controlled + hideFilters 전달 → 자체 필터는 숨기고 리스트만 렌더 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"16px 16px 20px":"20px 28px 24px",marginTop:20,animationDelay:"100ms"}}>
        <div style={{fontSize:15,fontWeight:600,color:"#111",marginBottom:16,display:"flex",alignItems:"center",gap:6}}>
          <ClipboardList size={15} strokeWidth={1.8}/>내 예약
        </div>

        {/* 4개 탭 버튼 */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
          {[
            { id: 'upcoming',  label: '예정',   count: upcoming.length,  activeStyle:{ background:'#854F0B', color:'#FAEEDA' } },
            { id: 'completed', label: '완료',   count: completed.length, activeStyle:{ background:'#0F6E56', color:'#E1F5EE' } },
            { id: 'cancelled', label: '취소',   count: cancelled.length, activeStyle:{ background:'#5F5E5A', color:'#F1EFE8' } },
            { id: 'noshow',    label: '노쇼',   count: noshow.length,    activeStyle:{ background:'#A32D2D', color:'#FCEBEB' } },
          ].map(t => (
            <button key={t.id} className="btn"
              onClick={() => setTab(t.id as typeof tab)}
              style={{
                display:"flex",alignItems:"center",gap:5,
                height:34,padding:"0 14px",
                border:"0.5px solid #E2E8F0",borderRadius:999,
                fontSize:12,cursor:"pointer",whiteSpace:"nowrap",
                background:"#fff",color:"#64748B",
                ...(tab === t.id ? { ...t.activeStyle, borderColor:'transparent' } : {}),
              }}>
              <span>{t.label}</span>
              <span style={{fontWeight:600,fontSize:13}}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* 탭 결과: BookingListTable에 controlled + hideFilters 전달 */}
        {/*   controlled={tabData}: 부모가 필터한 리스트 전달 → 자체 날짜 필터 비활성 */}
        {/*   hideFilters: 필터 UI(날짜/상태칩/층/검색) 숨김 — 탭 UI가 위에서 제어하므로 중복 방지 */}
        {/*   viewType 토글(리스트/카드)은 유지됨 (컴포넌트 내부에서) */}
        <BookingListTable
          bookings={allMyBookings}
          rooms={allRooms}
          users={allUsers}
          currentUser={currentUser}
          currentUserEmail={currentUserEmail}
          onDetail={onDetail}
          loading={allLoading}
          controlled={tabData}
          hideFilters={true}
        />
      </div>

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
          currentUserEmail={currentUserEmail}
          onDetail={onDetail}
          loading={allLoading}
        />
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
export function MyBookingWeeklyView({bookings, currentUser, rooms=[], onDetail, onCheckIn, onEarlyEnd, onCancel, onNewBooking, authUser}: {bookings:any[], currentUser:string, rooms?:any[], onDetail:(b:any)=>void, onCheckIn:(id:string)=>void, onEarlyEnd:(id:string)=>void, onCancel:(id:string)=>void, onNewBooking:()=>void, authUser:any}) {
  const today = todayStr()
  const now   = nowMinutes()
  const [selectedDate, setSelectedDate] = useState(today)
  const { isMobile } = useBreakpoint()

  // 본인 예약만 필터
  const myBookings = bookings.filter(b => b.user === currentUser)

  // ← [v2.1] 오늘 내 예약 필터 — User 본인 취소만 제외 (HomeView와 동일 정책)
  //   기존 v1.x: b.cancelledBy !== 'user' (autoCancelled=true 전제)
  //   v2.1:      User 취소는 status='cancelled'+cancelledBy='user'로 저장
  //   포함: 정상예약, 승인대기, 체크인, 조기종료, 노쇼, 기한초과, Admin취소, 거절
  //   제외: User 본인이 직접 취소한 것만
  const todayBookings = myBookings
    .filter(b =>
      tsDate(b.start_at) === today &&
      !(b.status === 'cancelled' && b.cancelledBy === 'user')   // ← [v2.1 변경] 명시적 status+cancelledBy 조합
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  // 주 네비게이션
  const weekStart = getWeekStart(selectedDate)
  const weekEnd   = addDays(weekStart, 6)
  const ws = dateToObj(weekStart), we = dateToObj(weekEnd)
  const weekLabel = `${ws.getFullYear()}년 ${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}일 – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}일`

  const goWeek = (dir: number) => setSelectedDate(addDays(selectedDate, dir * 7))

  return (
    <div style={{maxWidth:1400, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>

      {/* ── 오늘 내 예약 — MiniBookingCard 공통 컴포넌트 사용 (v2.1) ── */}
      {/* ← [v2.1] 기존 인라인 cardState 판정 블록(~65줄)을 MiniBookingCard로 대체
            · cardState/버튼/opacity 로직 모두 MiniBookingCard 내부로 이관
            · HomeView/BookingListTable과 동일한 단일 진실 원천 사용
            · 판정 규칙 변경 시 MiniBookingCard만 수정하면 3곳 자동 반영 */}
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
            return (
              <MiniBookingCard
                key={b.id}
                booking={b}
                room={r}
                currentUser={currentUser}
                size="sm"
                onClick={onDetail}
                onCheckIn={onCheckIn}
                onEarlyEnd={onEarlyEnd}
                onCancel={onCancel}
                isMobile={isMobile}
              />
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
