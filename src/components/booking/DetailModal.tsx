import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AlertTriangle, Building2, CheckCircle2, Clock, FileText, Monitor, ShieldCheck, ShieldX, User, Users } from 'lucide-react'
import { useState } from 'react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtTSFull, fmtDateFull, fmtTSDateFull, fmtTimeFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

import { AttendeeChip } from '../common/AttendeeChip'
import { UserChip } from '../common/UserChip'
import { BookingStatusBadge } from '../common/BookingStatusBadge'
import { MetaBadge } from '../common/MetaBadge'
import { Button } from '../common/Button'
// ← [2026-04-21] 피그마 전면 재설계 반영
import { IconClose } from '../common/IconClose'
import { StatusChipSquare } from '../common/StatusChipSquare'

export function DetailModal({booking:b,onClose,onCheckIn,onCancel,onEdit,currentUser, rooms:rp=[], users:up=[], isAdmin=false, onApprove=null, onReject=null, onForceCancel=null}: any) {
  const { isMobile } = useBreakpoint();
  const r=rp.find(r=>r.room_id===b.room_id);
  const floor=r ? getFloor(r.floor_id) : null;
  const features=r?.features ?? [];
  const isToday=tsDate(b.start_at)===todayStr(),now=nowMinutes();
  const sm=tsMin(b.start_at),em=tsMin(b.end_at);
  const isAct=isToday&&sm<=now&&now<em&&!b.autoCancelled&&!b.earlyEnded,nci=isAct&&!b.checkedIn;
  const isOwner=b.user===currentUser,tl=sm-now;
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
  // 관리자 거절 인라인 flow 상태
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  // ── [2026-04-21] 시간 차이 계산 (피그마 "1시간 15분" 뱃지용)
  const durationMin = em - sm  // 분 단위
  const durationLabel = (() => {
    if (durationMin <= 0) return ''
    const h = Math.floor(durationMin / 60)
    const m = durationMin % 60
    if (h === 0) return `${m}분`
    if (m === 0) return `${h}시간`
    return `${h}시간 ${m}분`
  })()

  // ── [2026-04-21] StatusChipSquare 라벨·variant 결정 (헤더 전용)
  //   우선순위: rejected > cancelled(admin/user) > expired > noshow > pending > confirmed(에메랄드) > checkedIn/using > done
  const squareStatus = (() => {
    if (b.status === 'rejected') return { variant: 'solid' as const, status: 'rejected' as const, label: '거절됨' }
    if (b.status === 'cancelled' && b.cancelledBy === 'admin') return { variant: 'solid' as const, status: 'admin' as const, label: '관리자 강제취소' }
    if (b.status === 'cancelled' && b.cancelledBy === 'user')  return { variant: 'solid' as const, status: 'cancelled' as const, label: '예약자 취소' }
    if (isExpiredPending) return { variant: 'solid' as const, status: 'expired' as const, label: '승인기한초과 취소' }
    // 노쇼: autoCancelled + system + !checkedIn
    if (b.autoCancelled && b.cancelledBy === 'system' && !b.checkedIn) {
      return { variant: 'solid' as const, status: 'noshow' as const, label: '노쇼' }
    }
    if (b.status === 'pending') return { variant: 'solid' as const, status: 'pending' as const, label: '승인 대기' }
    if (b.earlyEnded) return { variant: 'solid' as const, status: 'early-end' as const, label: '조기반납' }
    if (b.checkedIn && isAct)  return { variant: 'solid' as const, status: 'using' as const, label: '진행 중' }
    if (isAct && !b.checkedIn) return { variant: 'solid' as const, status: 'pending' as const, label: '체크인 대기' }
    if (!isFuture && !isAct)   return { variant: 'solid' as const, status: 'done' as const, label: '종료' }
    if (b.status === 'confirmed' && r?.is_admin_only) {
      return { variant: 'solid' as const, status: 'approved' as const, label: '승인완료' }
    }
    return null
  })()

  return(
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 24,          // ← [피그마] 16 → 24
      width:"100%", maxWidth: isMobile ? "100%" : 500,         // ← [피그마] 460 → 500 (본문 460 + 패딩)
      minHeight: isMobile ? undefined : 500,                   // ← [2026-04-21] 피그마 min-height 500px 적용
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ══════════════ [피그마 node 180:535] BookingModalHeader ══════════════
          padding 20px 16px, borderBottom 제거, 배경 그라디언트(흰→투명 페이드)
          헤더: [내 예약 outline chip] + [상태 solid chip]  +  X 닫기
                [회의 제목 21px SemiBold]                                 */}
      <div style={{
        padding: isMobile ? "20px 20px 24px" : "20px 20px 28px",
        background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 60%, rgba(255,255,255,0) 100%)",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        flexShrink: 0, position: "relative", zIndex: 2,
      }}>
        <div style={{flex:1, minWidth:0, display:"flex", flexDirection:"column"}}>
          {/* StatusBadge row — 칩 있을 때만 렌더 + row에 margin-bottom 8로 타이틀과 간격 */}
          {(() => {
            const showAttendChip = !isOwner && !!b.attendees?.some((a: any) => a.name === currentUser)
            const hasAnyChip = isOwner || showAttendChip || !!b.recurGroupId || !!squareStatus
            if (!hasAnyChip) return null
            return (
              <div style={{display:"flex", gap:4, alignItems:"center", flexWrap:"wrap", marginBottom: 8}}>
                {isOwner && <StatusChipSquare variant="outline">내 예약</StatusChipSquare>}
                {showAttendChip && <StatusChipSquare variant="outline">참석</StatusChipSquare>}
                {b.recurGroupId && <StatusChipSquare variant="outline">반복</StatusChipSquare>}
                {squareStatus && (
                  <StatusChipSquare variant={squareStatus.variant} status={squareStatus.status}>
                    {squareStatus.label}
                  </StatusChipSquare>
                )}
              </div>
            )
          })()}
          {/* 회의 제목 */}
          <div style={{
            fontSize: isMobile ? 18 : 21, fontWeight: 600, color: "#111",
            lineHeight: 1.5, wordBreak: "break-word",
          }}>{b.title}</div>
        </div>
        <button className="btn" onClick={onClose}
          style={{width:32, height:32, borderRadius:"50%", background:"transparent",
            border:"none", cursor:"pointer", flexShrink:0,
            display:"flex", alignItems:"center", justifyContent:"center"}}>
          <IconClose size={20}/>
        </button>
      </div>

      {/* ══════════════ [피그마 node 180:545] Hero (본문) ══════════════
          정보 행: label 16px SemiBold #96A0B3 width 100, 값 16px Regular #111
          각 행 border-bottom 0.5px #F1F5F9, py 10px                     */}
      <div style={{padding: isMobile ? "0 20px 16px" : "0 20px 20px", overflowY:"auto", flex:1,
        display:"flex", flexDirection:"column", gap:16}}>

        {/* ── 정보 행들 (회의실 → 위치 → 날짜 → 시간 → 메모 → 예약자 → 참석자) ── */}
        <div style={{display:"flex", flexDirection:"column"}}>

          {/* 회의실 — room_name만 (스펙 삭제) */}
          <InfoRow label="회의실">
            <span style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5}}>
              {r?.room_name ?? '-'}
            </span>
          </InfoRow>

          {/* 위치 — floor 정보 */}
          <InfoRow label="위치">
            <span style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5}}>
              {floor?.floor_name ?? '-'}
            </span>
          </InfoRow>

          {/* 날짜 */}
          <InfoRow label="날짜">
            <span style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5}}>
              {fmtTSDateFull(b.start_at)}
            </span>
          </InfoRow>

          {/* 시간 — duration XS 뱃지 */}
          <InfoRow label="시간">
            <div style={{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
              {b.earlyEnded && b.originalEndAt ? (
                <>
                  <span style={{color:"#94A3B8", textDecoration:"line-through", fontSize:14}}>
                    {fmtTSFull(b.start_at)} – {fmtTSFull(b.originalEndAt!)}
                  </span>
                  <span style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5}}>
                    {fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}
                  </span>
                  <span style={{fontSize:11, color:"#7C3AED"}}>반납</span>
                </>
              ) : (
                <>
                  <span style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5}}>
                    {fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}
                  </span>
                  {/* duration XS 뱃지 (피그마 node 191:375) — border 0.5px #AFAFAF, radius 4, fs 9 Medium */}
                  {durationLabel && (
                    <span style={{
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      padding:"1px 4px", borderRadius:4,
                      border:"0.5px solid #AFAFAF",
                      fontSize:9, fontWeight:500, color:"#AFAFAF",
                      lineHeight:1.5, whiteSpace:"nowrap",
                    }}>{durationLabel}</span>
                  )}
                </>
              )}
            </div>
          </InfoRow>

          {/* 메모 — 있을 때만 노출 */}
          {b.memo && (
            <InfoRow label="메모">
              <div style={{fontSize:16, color:"#111", fontWeight:400, lineHeight:1.5, whiteSpace:"pre-wrap", wordBreak:"break-word"}}>
                {b.memo}
              </div>
            </InfoRow>
          )}

          {/* 예약자 — ← [2026-04-21] UserChip detail variant (피그마 node 202:1178)
               아바타 24 bg #000, 이름 14 Medium + 부서 11 Regular rgba(17,17,17,0.35) */}
          {(() => {
            const owner = (up as any[]).find(u => u.user_id === b.user_id)
            return (
              <InfoRow label="예약자">
                <div style={{display:"flex", alignItems:"center"}}>
                  <UserChip
                    name={b.user}
                    avatarUrl={owner?.avatar_url ?? null}
                    variant="detail"
                    showDept
                    dept={b.user_dept ?? owner?.dept}
                    userInfo={owner}
                  />
                </div>
              </InfoRow>
            )
          })()}

          {/* 거절 사유 — 있을 때만 노출 */}
          {(b as any).reject_reason && (
            <InfoRow label="거절 사유" labelColor="#DC2626">
              <div style={{fontSize:14, color:"#DC2626", wordBreak:"break-word", lineHeight:1.5}}>
                {(b as any).reject_reason}
              </div>
            </InfoRow>
          )}

          {/* 참석자 — 2-column grid, 아바타 24 + 이름 14 Medium (피그마 node 202:1184)
               ← [2026-04-21] AttendeeChip variant="plain" 사용 (배경 없이 UserChip detail 그대로) */}
          {b.attendees && b.attendees.length > 0 && (
            <InfoRow label="참석자" align="flex-start">
              <div style={{
                display:"grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                columnGap: 10, rowGap: 10,
                flex: 1, minWidth: 0,
              }}>
                {b.attendees.map((a: any, idx: number) => {
                  const u = (up as any[]).find(u => u.email === a.email)
                  return (
                    <div key={a.email || idx} style={{display:"flex", alignItems:"center", minWidth:0}}>
                      <AttendeeChip
                        name={a.name || a.email}
                        avatarUrl={u?.avatar_url ?? null}
                        dept={u?.dept}
                        userInfo={u}
                        variant="plain"
                      />
                    </div>
                  )
                })}
              </div>
            </InfoRow>
          )}
        </div>

        {/* ── 하단 알림박스 — nci일 때: 체크인 안내 ── */}
        {nci && (
          <div style={{
            background:"#FFF7ED", borderRadius:12, padding:"8px 12px", minHeight:62,
            display:"flex", flexDirection:"column", justifyContent:"flex-start",
            border:"1px solid #FED7AA",
          }}>
            <div style={{display:"flex", alignItems:"flex-start", gap:6}}>
              <AlertTriangle size={14} strokeWidth={1.8} style={{flexShrink:0, marginTop:2, color:"#92400E"}}/>
              <span style={{fontSize:12, color:"#92400E", lineHeight:1.5}}>
                회의 시작 후 <strong>{CHECKIN_WINDOW_MIN}분 이내</strong> 체크인 필요
              </span>
            </div>
          </div>
        )}

        {/* ── 에메랄드 승인 안내 (pending일 때) ── */}
        {b.status === 'pending' && !b.autoCancelled && (
          <div style={{
            background:"#E6FFB0", borderRadius:12, padding:"8px 12px", minHeight:62,
            display:"flex", flexDirection:"column", justifyContent:"flex-start",
          }}>
            <div style={{fontSize:12, color:"#111", fontWeight:500, lineHeight:1.5}}>
              관리자 승인 후 예약이 확정됩니다
            </div>
          </div>
        )}
      </div>
      {/* 버튼 영역 - 항상 하단 고정 */}
      {(()=>{
        // ← [2026-04-21] 피그마 Modal Bottom (node 180:620) 반영
        //   padding: 8px, borderTop 제거, 배경 그라디언트, gap 16,
        //   버튼 h:56 radius:16 fs:14 SemiBold
        const btnWrap = (children: React.ReactNode) => (
          <div style={{
            padding: 8,
            display:"flex", gap:16, flexShrink:0,
          }}>
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
        const BtnReject   = () => <Button variant="danger-outline" flex onClick={()=>setShowRejectInput(true)} icon={<ShieldX size={13} strokeWidth={1.8}/>}>거절</Button>
        const BtnForce    = () => <Button variant="danger-outline" flex onClick={()=>{onForceCancel(b.id,'관리자 강제취소');onClose();}}>강제취소</Button>

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
          // 거절 사유 입력 flow
          if (showRejectInput) return (
            <div style={{flexShrink:0}}>
              <div style={{padding: isMobile?"12px 20px 0":"12px 24px 0"}}>
                <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,padding:"12px 14px",marginBottom:8}}>
                  <div style={{fontSize:11,color:"#92400E",marginBottom:8,fontWeight:600}}>⚠️ 거절 시 예약이 즉시 취소되며 신청자에게 알림이 발송됩니다</div>
                  <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6}}>거절 사유 (신청자에게 전달됩니다)</label>
                  <textarea value={rejectReasonInput} onChange={e=>setRejectReasonInput(e.target.value)} rows={2} placeholder="거절 사유를 입력하세요 (선택)"
                    style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #E2E8F0",fontSize:12,outline:"none",resize:"none",background:"#fff",boxSizing:"border-box" as const}} />
                </div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <Button variant="ghost"  flex size="sm" onClick={()=>{setShowRejectInput(false);setRejectReasonInput('');}}>취소</Button>
                  <Button variant="danger" flex size="sm" onClick={()=>{onReject(b.id,rejectReasonInput||'');setShowRejectInput(false);setRejectReasonInput('');onClose();}}>거절 확정</Button>
                </div>
              </div>
            </div>
          )
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

// ─── InfoRow ───────────────────────────────────────────────────────────────
// [2026-04-21 신규] BookingDetailModal 피그마 재설계 - 정보 행 공통 컴포넌트
// 피그마 스펙 (node 180:550 등):
//  · border-bottom 0.5px #F1F5F9
//  · padding: 10px 0 (py 10)
//  · label: 16px SemiBold #96A0B3, width 100px
//  · value: 16px Regular #111 (children으로 전달)
//  · align: 기본 center, '참석자'는 flex-start
interface InfoRowProps {
  label: string
  labelColor?: string
  align?: 'center' | 'flex-start'
  children: React.ReactNode
}
function InfoRow({ label, labelColor = '#96A0B3', align = 'center', children }: InfoRowProps) {
  return (
    <div style={{
      display: 'flex', alignItems: align,
      padding: '10px 0',
      borderBottom: '0.5px solid #F1F5F9',
      width: '100%',
    }}>
      <div style={{
        width: 100, flexShrink: 0,
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{
          fontSize: 16, fontWeight: 600, color: labelColor,
          lineHeight: 1.5,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
      </div>
      <div style={{flex: 1, minWidth: 0, display: 'flex', alignItems: align === 'flex-start' ? 'flex-start' : 'center'}}>
        {children}
      </div>
    </div>
  )
}

// ─── Booking Done Modal ────────────────────────────────────────────────────────
