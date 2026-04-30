import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { todayStr, nowMinutes, tsDate, tsMin, fmtTSFull, fmtTSDateFull, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'

import { AttendeeChip } from '../common/AttendeeChip'
import { UserChip } from '../common/UserChip'
import { DetailModalStatusBadge } from '../common/DetailModalStatusBadge'  // ← [2026-04-24] DetailModal 전용 상태 칩
import { MetaBadge } from '../common/MetaBadge'
import { Button } from '../common/Button'
import { ModalCloseButton } from '../common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화
import { isMyBooking, isAttendee } from '../../utils/bookingOwnership'  // ← [2026-04-24 P6-C] isAttendee 추가 — MetaBadge guest 조건 이름 비교 제거

/**
 * BookingDetailModal (export name: DetailModal)
 *
 * ✅ 변경 이력
 *  - [2026-04-30 참석자 가로스크롤 회귀 fix]
 *    · 증상: 긴 이름(예: "안영환_Yeonghwan An", "권혁준_David Hyuckjun") 참석자 시
 *            모달 전체 가로 스크롤 발생, 칩이 영역 밖으로 삐져나감
 *    · 원인: grid `repeat(2, minmax(0, 1fr))`는 grid track shrink 허용하지만
 *            grid item 자체의 `min-width: auto` 기본값이 콘텐츠 최소 너비를 강제 →
 *            grid track이 콘텐츠 크기로 늘어나며 부모 width 초과
 *    · 해결: 참석자 컨테이너 grid → flex-wrap 변경 (Figma 의도와 일치)
 *            짝 변경: AttendeeChip 조회 모드에 wrapper 추가 (max-width:100% + min-width:0)
 *            → 칩 단위로 자연스럽게 다음 줄 wrap, Figma 272:831 동작 일치
 *    · 무수정: UserChip 자체 (다른 사용처 영향 차단), props/로직/시그니처
 *
 *  - [2026-04-24 P4-A-1] 예약자·참석자 이름을 snapshot → live 데이터로 전환
 *    · 배경: 팀즈/Azure AD에서 이름 변경 후 Admin 동기화 실행 시 profiles.name은
 *            최신으로 갱신되지만 bookings.user_name / booking_attendees.name은
 *            예약 생성 시점 snapshot이라 옛 이름 그대로 표시됨
 *    · 원인: UserChip/AttendeeChip에 b.user / a.name (snapshot)을 직접 전달
 *    · 해결: users 배열(loadUsers로 로드된 live profiles 데이터)에서 이름 재조회
 *            · 예약자: users.find(user_id === b.user_id)?.name ?? b.user
 *            · 참석자: users.find(email === a.email)?.name ?? a.name ?? a.email
 *    · 원리: 헤더 프로필 칩과 동일한 live 데이터 방식 — DB 변경 시 새로고침으로 자동 반영
 *    · Fallback 유지: users 배열에 없는 퇴사자/외부인은 snapshot 표시 (정보 보존)
 *    · 영향: 표시 로직만 변경, 권한 판정(isMyBooking) 무관. UI/스타일 무수정.
 *    · 주의: 아바타·부서는 이미 live였음(owner?.avatar_url, owner?.dept) — 이름도 동일 원칙 적용
 *
 *  - [2026-04-24 P1-hotfix] 예약자 판정을 MyPage 방식(UUID + email)으로 재정렬
 *    · 배경: P1 최초 배포(이름 fallback 포함 isBookingOwner) 후에도 편집 버튼 미노출
 *            → 이름 fallback이 profiles.name 변경 시 snapshot과 꼬여 false 반환하는 엣지 케이스
 *    · 해결: isMyBooking(b, currentUserId, currentUserEmail) — 이름 비교 완전 제거
 *            · 예약자: b.user_id === currentUserId (MyPage allMyBookings 쿼리와 동일)
 *            · 참석자: attendees email === currentUserEmail (booking_attendees 설계와 일관)
 *    · 정책: 참석자도 편집/취소 권한 인정 (2026-04-08 정책, MyPage 표시 범위와 일관)
 *    · 추가 prop: currentUserEmail (App.tsx에서 authUser.email 전달)
 *    · 영향: DetailModal 내 isOwner 기반 6개 분기(canEdit/취소/체크인 등) 자동 복구
 *
 *  - [2026-04-24 P1 긴급] 예약자 판정을 이름 문자열 비교 → UUID 비교로 전환 (deprecated by P1-hotfix)
 *    · 증상: 팀즈에서 이름 변경한 사용자가 본인 예약의 '취소/편집/체크인' 버튼 미노출
 *    · 원인: isOwner = b.user === currentUser (이름 비교)
 *            → Admin 동기화로 profiles.name 변경 후 bookings.user_name(snapshot)과 불일치 → false
 *            → canEdit, 취소 버튼, 체크인 버튼 등 isOwner 의존 분기 전부 차단
 *    · 해결: isBookingOwner(b, currentUserId, currentUser) 헬퍼 사용
 *            · user_id(UUID) 우선 — auth.users.id ON UPDATE CASCADE로 이름 변경에 불변
 *            · user_id 누락 레거시 데이터는 이름 fallback 유지 (안전망)
 *    · 신규 prop: currentUserId (App.tsx에서 authUser.user_id 전달)
 *    · 영향: 논리만 변경, UI/스타일 무수정. 다른 분기(adminCanApprove 등) 원본 유지.
 *    · 후속: 동일 패턴 9곳(HomeView/CalendarShell/slotHelpers/Badge/ListTable/MyPage/Admin)
 *            은 P2~P8로 분리 배포 예정 — 본 P1은 '권한 손실' 긴급 복구에 한정.
 *
 *  - [2026-04-29] 조기반납 버튼 추가
 *    · 조건: isAct(진행중) && b.checkedIn(체크인 완료) → 닫기 + 조기반납 버튼 표시
 *    · 섹션 3(Admin·본인) / 섹션 4(유저·본인) 에 분기 추가
 *    · onEarlyEnd prop 신설 (App.tsx에서 전달 필요)
 *    · isDone에 b.earlyEnded 이미 포함 → 조기반납 완료 후 닫기만 표시됨 (기존 로직 유지)
 *
 *  - [2026-04-22 피그마 UI 재구성] Figma node 180:534 절대 기준 적용 (로직 무수정)
 *    · 헤더: 사각 상태칩(chip--square, radius 8) + 제목 21px SemiBold
 *    · 정보 리스트: 카드형(#F8FAFC) → 0.5px #F1F5F9 구분선형
 *        회의실(room_name만) / 위치(floor) / 날짜 / 시간(+소요시간 칩) / 메모(있을 때만)
 *        / 예약자(아바타+이름+부서) / 참석자(2-grid 아바타+이름)
 *    · 에메랄드룸 전용 알림박스(bg #E6FFB0, rounded 12, padding 8·12, min-h 62) Hero 하단 배치
 *    · 모달 radius 16→24, Footer padding 8·gap 16·버튼 height 56·radius 16 (Button lg 공통 반영분 활용)
 *    · 공통 컴포넌트 수정: chip-mine 피그마화(0.5px 검정 테두리),
 *      chip--square modifier 신설, UserAvatar 기본값(#000/#E7E7E7/fw 500),
 *      UserChip md(24/gap 7, dept prop 지원), AttendeeChip 평문화(조회 모드)
 *    · 로직 완전 보존: 버튼 분기 전체(isAdmin/isOwner/showRejectInput/adminCanApprove 등)
 *      /메모 표시 조건/props 시그니처 전부 원본 그대로
 */

// ── 시간 소요 포맷터 (피그마 180:534 '1시간 15분' 칩) ─────────────────────────
// 순수 표시 유틸 — 기능 로직 아님. utils에 의존하지 않도록 파일 로컬 함수로 정의.
function fmtDuration(startISO: string, endISO: string): string {
  const diffMin = tsMin(endISO) - tsMin(startISO)
  if (diffMin <= 0) return ''
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  if (h > 0 && m > 0) return `${h}시간 ${m}분`
  if (h > 0)          return `${h}시간`
  return `${m}분`
}

export function DetailModal({booking:b,onClose,onCheckIn,onCancel,onEdit,onEarlyEnd=null,currentUser, currentUserId='', currentUserEmail='', rooms:rp=[], users:up=[], isAdmin=false, onApprove=null, onReject=null, onForceCancel=null}: any) {  // ← [2026-04-29] onEarlyEnd 추가 — 체크인 완료 후 조기반납 버튼용  // ← [2026-04-24 P1-hotfix] currentUserEmail 추가 — MyPage 방식 참석자 판정용
  const { isMobile } = useBreakpoint();
  const r=rp.find(r=>r.room_id===b.room_id);
  const floor=r ? getFloor(r.floor_id) : null;
  const features=r?.features ?? [];
  const isToday=tsDate(b.start_at)===todayStr(),now=nowMinutes();
  const sm=tsMin(b.start_at),em=tsMin(b.end_at);
  const isAct=isToday&&sm<=now&&now<em&&!b.autoCancelled&&!b.earlyEnded,nci=isAct&&!b.checkedIn;
  // ← [2026-04-24 P1-hotfix] MyPage 방식(UUID + email)으로 통일 — 이름 비교 완전 제거
  //   기존 P1: isBookingOwner(b, currentUserId, currentUser) — 이름 fallback이 꼬임 원인
  //   현재:   isMyBooking(b, currentUserId, currentUserEmail) — snapshot 이름 영향 없음
  //   정책:   예약자(user_id) OR 참석자(attendees.email) 모두 본인 예약으로 인정
  const isOwner = isMyBooking(b, currentUserId, currentUserEmail);
  const tl = sm - now;
  // 변경 가능 조건: 본인 예약, 취소/체크인 안됨, 시작 전
  const isFuture = tsDate(b.start_at) > todayStr() || (tsDate(b.start_at) === todayStr() && sm > now);
  const canEdit  = isOwner && !b.autoCancelled && !b.checkedIn && isFuture;
  // 관리자 승인 가능 여부 (시작 1분 전까지)
  const nowMs = Date.now();
  const startMs = new Date(b.start_at).getTime();
  const adminCanApprove = isAdmin && b.status === 'pending' && !b.autoCancelled && nowMs < startMs - 60_000;
  const isExpiredPending = b.status === 'pending' && b.autoCancelled;
  // 승인완료된 관리자 전용룸(에메랄드) → 변경 불가, 취소만 가능
  const isApprovedAdminRoom = !!(r?.is_admin_only && b.status === 'confirmed')
  return(
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [피그마] 16 → 24
      width:"100%", maxWidth: isMobile ? "100%" : 460,
      minHeight: isMobile ? undefined : 460, // ← [2026-04-24] 500 → 460 (요청 반영)
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── Header [피그마] padding 16/20, gap 8(배지↔제목), border-bottom 제거 ── */}
      <div style={{padding: isMobile ? "20px 20px 14px" : "16px 20px", flexShrink:0}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12}}>
          <div style={{flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:8 /* ← [피그마] 배지↔제목 gap 8 */}}>
            {/* ← [2026-04-24 Figma 212:322 / 212:324] DetailModal 전용 사각 상태칩
                  · 기존 BookingStatusBadge(shape='square')를 DetailModalStatusBadge 래퍼로 교체
                  · 캘린더 슬롯용 CalendarSlotBadge(XS)와 완전 분리된 독립 컴포넌트
                  · 스펙: padding 4×10, radius 8, 11px Medium, lineHeight 1.5 */}
            {/* ← [2026-04-24 P7-A] currentUser 전달 제거 — isBooker 판정은 currentUserId/Email로 충분 */}
            <DetailModalStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} currentUserId={currentUserId} currentUserEmail={currentUserEmail} />
            {/* ← [피그마] 제목 21px SemiBold #111 */}
            <div style={{fontSize: isMobile ? 18 : 21, fontWeight:600, color:"#111", lineHeight:1.5, wordBreak:"break-word"}}>{b.title}</div>
            {/* ← [P2 v7] 반복/참석자 메타 뱃지 — 피그마엔 없지만 기능(정보성) 유지. 스크린샷에 노출 안 되더라도 로직 보존 */}
            {b.recurGroupId && (
              <div><MetaBadge type="recurring" size="sm" /></div>
            )}
            {/* ← [2026-04-24 P6-C] 참석자 뱃지 표시 조건 이름 비교 → isAttendee(email) 전환
                  기존: b.user !== currentUser && attendees.some(a => a.name === currentUser)
                        · b.user(snapshot) vs currentUser(live name) 이름 비교
                        · attendees의 a.name도 snapshot — 이름 변경 시 전부 false
                  변경: isAttendee(b, currentUserEmail) — email 고정 식별자 기반
                        · 참석자 목록에 내 email 포함 여부만 판정 (booking_attendees.email 단일 기준)
                        · 예약자 OR 참석자 상호 배타 정책(§1.3)에 따라 예약자는 자동 제외됨 */}
            {isAttendee(b, currentUserEmail) && (
              <div><MetaBadge type="guest" size="sm" /></div>
            )}
          </div>
          {/* ← [피그마 2026-04-22] Close 공통 컴포넌트로 교체 */}
          <ModalCloseButton onClick={onClose} />
        </div>
      </div>

      {/* ── Body (Hero) [피그마] padding 20, gap 16 ──
          ← [2026-04-24] padding-bottom 16 → 60 (본문-버튼 사이 여유 공간 확대) */}
      <div style={{padding: isMobile ? "0 20px 60px" : "0 20px 60px", overflowY:"auto", flex:1,
        display:"flex", flexDirection:"column", gap:16}}>

        {/* ── 정보 리스트: 0.5px #F1F5F9 구분선형 (피그마) ── */}
        <div style={{display:"flex", flexDirection:"column"}}>
          {/* 회의실 — room_name만 (capacity 제거) */}
          <InfoRow label="회의실" value={r?.room_name ?? '-'} />
          {/* 위치 — floor */}
          <InfoRow label="위치" value={floor?.floor_name ?? '-'} />
          {/* 날짜 ← [2026-04-22 HOTFIX] fmtDateFull(b.start_at)은 'YYYY-MM-DD' 문자열을 기대하는데
                 b.start_at은 timestamp ISO라 파싱 실패 → 'NaN년 NaN월 NaN일' 표시.
                 fmtTSDateFull(내부에서 tsDate로 KST 날짜 추출 후 포맷) 사용. */}
          <InfoRow label="날짜" value={fmtTSDateFull(b.start_at)} />
          {/* 시간 + 소요시간 칩 */}
          <InfoRow
            label="시간"
            value={
              b.earlyEnded && b.originalEndAt ? (
                <span style={{display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
                  <span style={{color:"#94A3B8", textDecoration:"line-through"}}>
                    {fmtTSFull(b.start_at)} – {fmtTSFull(b.originalEndAt)}
                  </span>
                  <span>{fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}</span>
                  <span className="chip chip--xs" style={{border:"0.5px solid #7C3AED", color:"#7C3AED", background:"transparent", fontWeight:500}}>조기반납</span>
                </span>
              ) : (
                <span style={{display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
                  <span>{fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}</span>
                  {/* ← [피그마 191:375] 소요시간 칩: border 0.5px #AFAFAF, text 9px Medium #AFAFAF, radius 4 */}
                  <span className="chip chip--xs" style={{border:"0.5px solid #AFAFAF", color:"#AFAFAF", background:"transparent", fontWeight:500}}>
                    {fmtDuration(b.start_at, b.end_at)}
                  </span>
                </span>
              )
            }
          />
          {/* 메모 — 있을 때만 (피그마 스크린샷 지시) */}
          {b.memo && (
            <InfoRow label="메모" value={b.memo} alignTop />
          )}
          {/* 예약자 — 아바타+이름+부서 (UserChip dept prop)
              ← [2026-04-24 P4-A-1] 이름 표시를 live 데이터 우선으로 전환
                · 기존: name={b.user} (bookings.user_name snapshot)
                · 변경: name={owner?.name ?? b.user}
                  - owner: users 배열(loadUsers로 로드된 live profiles 데이터)에서 user_id 매칭
                  - live 우선 → DB profiles.name 변경 시 새로고침으로 자동 반영
                  - fallback: owner가 없으면(퇴사자 등) snapshot 표시 (정보 보존) */}
          {(()=>{
            const owner = (up as any[]).find((u:any) => u.user_id === b.user_id)
            return (
              <InfoRow
                label="예약자"
                value={
                  <UserChip
                    name={owner?.name ?? b.user}
                    avatarUrl={owner?.avatar_url ?? null}
                    variant="md"
                    userInfo={owner}
                    dept={owner?.dept ?? b.dept}
                  />
                }
              />
            )
          })()}
          {/* 참석자 — flex-wrap (Figma 272:831 의도: 짧은 이름 2칩 한 줄, 긴 이름은 칩 단위로 다음 줄 wrap)
              ← [2026-04-30 가로스크롤 회귀 fix]
                 · 증상: 긴 이름(예: "안영환_Yeonghwan An", "권혁준_David Hyuckjun") 시
                         모달 전체 가로 스크롤 발생, 칩이 영역 밖으로 삐져나감
                 · 원인: grid `repeat(2, minmax(0, 1fr))`는 grid track shrink 허용하지만
                         grid item 자체의 `min-width: auto` 기본값이 콘텐츠 최소 너비를
                         강제 → grid track이 늘어나 부모 width 초과
                 · 해결: grid → flex-wrap (Figma 의도와 일치, 칩 단위 wrap)
                         + AttendeeChip wrapper의 max-width:100% (부모 너비 초과 차단)
                 · 짝 배포: AttendeeChip wrapper 추가 (한 묶음으로만 효과 있음)
              ← [2026-04-23] 1열 무너짐 버그 수정 흔적 — grid 패턴은 회귀로 인해 폐기 */}
          {b.attendees && b.attendees.length > 0 && (
            <InfoRow
              label="참석자"
              alignTop
              value={
                /* ── [2026-04-30 #3 사용자 요청] flex-wrap + outer wrapper minWidth 50% ──
                     #2 시도(grid 2컬럼)는 긴 이름이 컬럼 안에서 잘리는 문제 → 사용자 거부.
                     사용자 의도:
                       · 이름은 자르거나 줄이지 않고 100% 표시
                       · 짧은 이름들은 2컬럼으로 정렬
                       · 긴 이름은 다음 줄로 자동 wrap (image 1 같은 자연스러운 동작)

                     해결: flex-wrap + 각 칩 outer wrapper에 minWidth 50% 강제
                       · 짧은 이름: minWidth 50%로 강제 → 한 줄에 2개 (2컬럼 정렬)
                       · 긴 이름: 콘텐츠 너비대로 차지 → 다음 칩이 자동 wrap
                       · gap 14 → 자식 minWidth는 calc(50% - 7px)로 보정

                     이전 가로스크롤 회귀 방지: AttendeeChip wrapper의
                     max-width:100% + min-width:0 + overflow:hidden 그대로 유지 */
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  columnGap: 14,
                  rowGap: 10,
                  width: "100%",
                }}>
                  {b.attendees.map((a:any, idx:number) => {
                    const u = (up as any[]).find((u:any) => u.email === a.email)
                    return (
                      <div key={a.email || idx} style={{
                        flex: "0 1 auto",                  // 콘텐츠 너비 우선, 필요시 shrink
                        minWidth: "calc(50% - 7px)",       // 기본 절반 강제 (gap 14의 절반)
                        maxWidth: "100%",                  // 부모 100% 초과 방지
                      }}>
                        <AttendeeChip
                          name={u?.name ?? a.name ?? a.email}
                          avatarUrl={u?.avatar_url ?? null}
                          dept={u?.dept}
                          userInfo={u}
                        />
                      </div>
                    )
                    // ← [2026-04-24 P4-A-1] 이름 표시 live 우선
                    //   기존: name={a.name || a.email} (booking_attendees.name snapshot)
                    //   변경: name={u?.name ?? a.name ?? a.email}
                    //     1순위 u.name (profiles.name live — DB 변경 자동 반영)
                    //     2순위 a.name (snapshot — 외부인/퇴사자 대응)
                    //     3순위 a.email (이름도 없는 예외 케이스)
                  })}
                </div>
              }
            />
          )}
          {/* 거절 사유 — 있을 때만 (기능 유지) */}
          {(b as any).reject_reason && (
            <InfoRow
              label="거절 사유"
              alignTop
              value={<span style={{color:"#DC2626", wordBreak:"break-word"}}>{(b as any).reject_reason}</span>}
            />
          )}
        </div>

        {/* ── 에메랄드룸 알림박스 [피그마 189:346] bg #E6FFB0, rounded 12, padding 8·12, min-h 62 ──
            ← [2026-04-23] 노출 조건 타이트닝 (근본 원인 해결)
            기존: r?.is_admin_only (에메랄드룸이면 승인 완료/취소/거절된 건에도 계속 노출됨)
            변경: 에메랄드룸 AND status='pending' AND !autoCancelled
                  · 승인완료(confirmed) → 숨김 ✅
                  · 거절(rejected)      → 숨김 ✅
                  · 관리자 취소(admin cancel) → 숨김 ✅
                  · 기한초과 만료(pending+autoCancelled) → 숨김 ✅
                  · 승인 대기 중인 pending만 노출 */}
        {r?.is_admin_only && b.status === 'pending' && !b.autoCancelled && (
          <div style={{background:"#E6FFB0", borderRadius:12, padding:"8px 12px", minHeight:62,
            display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"flex-start"}}>
            <p style={{fontSize:12, fontWeight:500, color:"#000", lineHeight:1.5, margin:0}}>
              관리자 승인 후 예약이 확정됩니다
            </p>
          </div>
        )}

        {/* ── 미체크인 경고 (기능 유지) ── */}
        {nci && (
          <div style={{background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, padding:"10px 14px",
            fontSize:12, color:"#92400E", display:"flex", alignItems:"flex-start", gap:6}}>
            <AlertTriangle size={14} strokeWidth={1.8} style={{flexShrink:0, marginTop:1}}/>
            <span>회의 시작 후 <strong>{CHECKIN_WINDOW_MIN}분 이내</strong> 체크인 필요</span>
          </div>
        )}
      </div>
      {/* 버튼 영역 - 항상 하단 고정 */}
      {(()=>{
        const btnWrap = (children: React.ReactNode) => (
          // ← [2026-04-24] 버튼 간격 gap 16 → 8 (요청: 간격 축소)
          <div style={{padding: isMobile?"8px 20px 24px":8, display:"flex", gap:8, flexShrink:0}}>
            {children}
          </div>
        )
        const BtnClose    = () => <Button variant="ghost"         flex onClick={onClose}>닫기</Button>
        const BtnCancel   = () => <Button variant="danger-outline" flex onClick={()=>onCancel(b.id)}>예약 취소</Button>
        const BtnEdit     = () => <Button variant="info-outline"   flex onClick={()=>{onClose();onEdit(b);}}>예약 변경</Button>
        const BtnCheckin  = () => <Button variant="success"        flex onClick={()=>{onCheckIn(b.id);onClose();}} icon={<CheckCircle2 size={14} strokeWidth={1.8}/>}>체크인하기</Button>
        // ← [2026-04-19 P2 v8] 체크인 대기 상태 버튼 (비활성화 안내용)
        //   정책: 체크인은 '시작 후 10분 이내'만 가능 → 시작 전에는 체크인 불가
        //   표시 조건: 본인 예약 + 시작 10분 이내 남음 + 아직 시작 안 함 + 취소/거절 안 됨 + pending 아님
        //   UX: disabled로 시각 안내만 제공, 실제 클릭 불가 (Button.disabled → opacity 0.45 + cursor 'not-allowed')
        const BtnCheckinWait = () => <Button variant="secondary"   flex disabled icon={<Clock size={14} strokeWidth={1.8}/>}>체크인 대기</Button>
        const BtnApprove  = () => <Button variant="success"        flex onClick={()=>{onApprove(b.id);onClose();}} icon={<ShieldCheck size={14} strokeWidth={1.8}/>}>승인</Button>
        const BtnReject   = () => <Button variant="danger-outline" flex onClick={()=>onReject(b.id)} icon={<ShieldX size={13} strokeWidth={1.8}/>}>거절</Button> // ← [2026-04-29] 인라인 flow 제거 → confirmAndRejectBooking 다이얼로그 경유
        // ← [2026-04-24 P8-B] 강제취소 버튼 동작 변경
        //   기존: onForceCancel(id, '관리자 강제취소') — 하드코딩 사유로 즉시 실행 (사유 입력 다이얼로그 없음)
        //   변경: onForceCancel(id) — App.tsx confirmAndAdminForceCancel이 ConfirmForceCancelModal 자동 오픈
        //         사유 입력 받은 후 adminForceCancelBooking(id, reason) 실행
        //   onClose() 유지: DetailModal 닫고 → 강제취소 다이얼로그가 그 자리에 뜸 (자연스러운 모달 교체)
        // onClose() 없음 — confirmAndAdminForceCancel이 setModal('confirmForceCancel')로 교체하는 구조 (BtnReject 동일 패턴)
        const BtnForce    = () => <Button variant="danger-outline" flex onClick={()=>onForceCancel(b.id)}>강제취소</Button>
        // ← [2026-04-29] 체크인 완료 후 조기반납 버튼 (bg #111, text #FFF)
        // onClose() 없음 — confirmAndEarlyEnd가 setModal('confirmEarlyEnd')로 모달 교체하는 구조
        // onClose() 같이 호출 시 React 18 배칭으로 setModal(null)이 마지막 적용 → 다이얼로그 소멸
        const BtnEarlyEnd = () => <Button variant="primary" flex onClick={()=>onEarlyEnd(b.id)}>조기반납</Button>

        // ── [P2 v8] 체크인 대기 표시 조건 ──────────────────────────
        //   isFuture(시작 전) + tl <= 10 (10분 이내) + confirmed(승인된) + 취소/거절/체크인 안 됨
        //   · pending 예약은 대기 상태 표시 안 함 (승인부터 받아야 함)
        //   · 에메랄드 승인완료 예약에는 표시됨 (approved + 시작 임박)
        const showCheckinWait = isOwner && isFuture && tl > 0 && tl <= 10
                                && b.status === 'confirmed'
                                && !b.autoCancelled && !b.earlyEnded && !b.checkedIn

        // ── 1. 종료/취소/노쇼/거절/조기반납 → 닫기 ─────────────────
        const isDone = b.autoCancelled || b.status === 'rejected' || b.earlyEnded || (!isFuture && !isAct)
        if (isDone) return btnWrap(<BtnClose />)

        // ── 2. Admin · 타인 ──────────────────────────────────────────
        if (isAdmin && !isOwner) {
          // pending → 닫기 + 거절 + 승인
          if (adminCanApprove) return btnWrap(<><BtnClose />{onReject&&<BtnReject />}{onApprove&&<BtnApprove />}</>)
          // confirmed 미래 → 닫기 + 변경 + 강제취소
          if (b.status === 'confirmed' && isFuture) return btnWrap(<><BtnClose />{onEdit&&!isApprovedAdminRoom&&<BtnEdit />}{onForceCancel&&<BtnForce />}</>)
          // 진행중 → 닫기 + 강제취소
          if (isAct) return btnWrap(<><BtnClose />{onForceCancel&&<BtnForce />}</>)
          return btnWrap(<BtnClose />)
        }

        // ── 3. Admin · 본인 ──────────────────────────────────────────
        if (isAdmin && isOwner) {
          // pending → 취소 + 승인 (Admin은 본인 예약 직접 승인 가능)
          if (adminCanApprove) return btnWrap(<>{onApprove&&<BtnApprove />}<BtnCancel /></>)
          // 진행중 미체크인 → 체크인 + 취소
          if (isAct && !b.checkedIn) return btnWrap(<><BtnCancel /><BtnCheckin /></>)
          // ← [2026-04-29] 진행중 체크인 완료 → 닫기 + 조기반납
          if (isAct && b.checkedIn) return btnWrap(<><BtnClose />{onEarlyEnd&&<BtnEarlyEnd />}</>)
          // ← [P2 v8] 시작 10분 이내 confirmed → 취소 + 변경 + 체크인 대기(비활성)
          //   에메랄드룸은 변경 불가 → 취소 + 체크인 대기만
          if (showCheckinWait) return btnWrap(<><BtnCancel />{!isApprovedAdminRoom&&<BtnEdit />}<BtnCheckinWait /></>)
          // 미래 confirmed → 변경 + 취소 (승인완료 에메랄드룸은 취소만)
          if (isFuture && b.status === 'confirmed') return btnWrap(<><BtnCancel />{!isApprovedAdminRoom&&<BtnEdit />}</>)
          return btnWrap(<BtnClose />)
        }

        // ── 4. 유저 · 본인 ────────────────────────────────────────────
        if (isOwner) {
          // 진행중 미체크인 → 체크인 + 취소
          if (isAct && !b.checkedIn) return btnWrap(<><BtnCancel /><BtnCheckin /></>)
          // ← [2026-04-29] 진행중 체크인 완료 → 닫기 + 조기반납
          if (isAct && b.checkedIn) return btnWrap(<><BtnClose />{onEarlyEnd&&<BtnEarlyEnd />}</>)
          // ← [P2 v8] 시작 10분 이내 confirmed → 취소 + 변경 + 체크인 대기(비활성)
          //   정책: 체크인은 시작 후 10분 이내만 가능 → 지금은 '대기' 상태만 노출
          //   에메랄드룸 승인완료도 동일 로직 (에메랄드는 변경 불가이므로 BtnEdit 제외)
          if (showCheckinWait) return btnWrap(<><BtnCancel />{!isApprovedAdminRoom&&<BtnEdit />}<BtnCheckinWait /></>)
          // 미래 → 변경 + 취소 (승인완료 에메랄드룸은 취소만)
          if (isFuture && b.status === 'confirmed') return btnWrap(<><BtnCancel />{!isApprovedAdminRoom&&<BtnEdit />}</>)
          // pending 미래 → 취소만
          if (isFuture && b.status === 'pending') return btnWrap(<><BtnCancel /></>)
          return btnWrap(<BtnClose />)
        }

        // ── 5. 타인 예약 (비어있는 상태) → 닫기 ─────────────────────
        return btnWrap(<BtnClose />)
      })()}
    </div>
  );
}

// ─── InfoRow 헬퍼 ──────────────────────────────────────────────────────────────
// 피그마 180:534 정보 리스트 1행 (0.5px #F1F5F9 구분선, padding 10 0)
//   · 라벨: 16px SemiBold #96A0B3, width 100px 고정 (모바일은 auto)
//   · 값:   16px Regular #111 (line-height 1.5)
//   · alignTop: true → align-items flex-start (참석자/메모 처럼 여러 줄)
interface InfoRowProps {
  label:     string
  value:     React.ReactNode
  alignTop?: boolean
}
function InfoRow({ label, value, alignTop = false }: InfoRowProps) {
  return (
    <div style={{
      padding:      "10px 0",
      borderBottom: "0.5px solid #F1F5F9",
      display:      "flex",
      alignItems:   alignTop ? "flex-start" : "center",
      width:        "100%",
    }}>
      <div style={{
        fontSize:   16,
        fontWeight: 600,
        color:      "#96A0B3",
        width:      100,
        flexShrink: 0,
        lineHeight: 1.5,
      }}>{label}</div>
      {/* ── [2026-04-30] value 영역 정렬 수정 ──
           이전: 일반 block + lineHeight 1.5 → 자식이 칩 컴포넌트면 baseline에
                 의해 위로 떠서 부모 행 가운데 정렬 안 됨 (예약자 행 시각 결함)
           수정: alignTop=false일 땐 flex + alignItems:center로 자식 강제 가운데 정렬
                  · 텍스트 자식: anonymous flex item으로 정상 표시 + wordBreak 보존
                  · 칩 자식: 부모 행 높이 안에서 항상 가운데 (예약자 칩 정상화)
                 alignTop=true (메모·참석자 등 여러 줄) 케이스는 block 그대로 유지 */}
      <div style={{
        fontSize:   16,
        fontWeight: 400,
        color:      "#111",
        lineHeight: 1.5,
        flex:       1,
        minWidth:   0,
        wordBreak:  "break-word",
        display:    alignTop ? "block" : "flex",
        alignItems: alignTop ? undefined : "center",
      }}>{value}</div>
    </div>
  )
}

// ─── Booking Done Modal ────────────────────────────────────────────────────────
