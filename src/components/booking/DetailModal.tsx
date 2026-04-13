import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, X, Building2, Clock, User, Monitor, FileText, Users, ShieldCheck, ShieldX } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtTimeFull, fmtTSFull, fmtTSRangeFull, fmtDateFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

import { AttendeeChip } from '../common/AttendeeChip'
import { BookingStatusBadge } from '../common/BookingStatusBadge'

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
  return(
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 16,
      width:"100%", maxWidth: isMobile ? "100%" : 460,
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}
      <div style={{padding: isMobile ? "20px 20px 16px" : "20px 24px 16px", overflowY:"auto", flex:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div style={{flex:1,minWidth:0,marginRight:12}}>
            <div style={{marginBottom:8}}>
              <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} currentUser={currentUser} />
            </div>
            <div style={{fontSize: isMobile ? 17 : 20, fontWeight:800, color:"#111111", wordBreak:"break-word"}}>{b.title}</div>
          </div>
          <button className="btn" onClick={onClose}
            style={{width:32,height:32,borderRadius:"50%",background:"#F1F5F9",
              color:"#64748B",flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center"}}><X size={14} strokeWidth={2}/></button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {[
            [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Building2 size={11} strokeWidth={1.8}/>회의실</span>, <span style={{color:r?.color,fontWeight:700}}>{r?.room_name ?? '-'}</span>, r ? `${r.capacity}인` : ''],
            [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Clock size={11} strokeWidth={1.8}/>시간</span>,
              b.earlyEnded && b.originalEndAt
                ? <span>
                    <span style={{color:"#94A3B8",textDecoration:"line-through",fontSize:12}}>
                      {fmtTSFull(b.start_at)} – {fmtTSFull(b.originalEndAt!)}
                    </span>
                    <br/>
                    <span style={{fontWeight:700}}>{fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}</span>
                    <span style={{fontSize:11,color:"#7C3AED",marginLeft:6}}>반납</span>
                  </span>
                : `${fmtTSFull(b.start_at)} – ${fmtTSFull(b.end_at)}`,
              fmtTSDateFull(b.start_at)],
            features.length>0&&[<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Monitor size={11} strokeWidth={1.8}/>설비</span>, features.map(f=>f.feature_name).join(", "), null],
            b.memo&&[<span style={{display:"inline-flex",alignItems:"center",gap:4}}><FileText size={11} strokeWidth={1.8}/>메모</span>, b.memo, null],
          ].filter(Boolean).map(([label,main,sub],i)=>(
            <div key={i} style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
              <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>{label}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,color:"#111111",fontWeight:600,wordBreak:"break-word"}}>{main}</div>
                {sub&&<div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{sub}</div>}
              </div>
            </div>
          ))}

          {/* 예약자 — AttendeeChip 통일 */}
          {(()=>{
            const owner = (up as any[]).find(u => u.user_id === b.user_id)
            return (
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0,display:"flex",alignItems:"center",gap:4}}>
                  <User size={11} strokeWidth={1.8}/>예약자
                </div>
                <div style={{display:"flex",alignItems:"center"}}>
                  <AttendeeChip
                    name={b.user}
                    avatarUrl={owner?.avatar_url ?? null}
                    userInfo={owner}
                  />
                </div>
              </div>
            )
          })()}

          {/* 참석자 — email로 users에서 avatar_url·dept 역조회 (패턴 B) */}
          {(b as any).reject_reason && (
            <div style={{background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
              <div style={{fontSize:11,color:"#DC2626",minWidth:60,fontWeight:600,flexShrink:0,display:"flex",alignItems:"center",gap:4}}>
                거절 사유
              </div>
              <div style={{fontSize:13,color:"#DC2626",wordBreak:"break-word"}}>{(b as any).reject_reason}</div>
            </div>
          )}

          {b.attendees && b.attendees.length > 0 && (
            <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
              <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0,paddingTop:2,display:"flex",alignItems:"center",gap:4}}>
                <Users size={11} strokeWidth={1.8}/>참석자
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {b.attendees.map((a, idx) => {
                  const u = (up as any[]).find(u => u.email === a.email)
                  return (
                    <AttendeeChip
                      key={a.email || idx}
                      name={a.name || a.email}
                      avatarUrl={u?.avatar_url ?? null}
                      dept={u?.dept}
                      userInfo={u}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
        {nci&&<div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400E",display:"flex",alignItems:"flex-start",gap:6}}>
          <AlertTriangle size={14} strokeWidth={1.8} style={{flexShrink:0,marginTop:1}}/><span>회의 시작 후 <strong>{CHECKIN_WINDOW_MIN}분 이내</strong> 체크인 필요</span>
        </div>}
      </div>
      {/* 버튼 영역 - 항상 하단 고정 */}
      {(()=>{
        const btnWrap = (children: React.ReactNode) => (
          <div style={{padding: isMobile?"12px 20px 24px":"12px 24px 20px", display:"flex", gap:8, flexShrink:0, borderTop:"1px solid #F1F5F9"}}>
            {children}
          </div>
        )
        const BtnClose    = () => <button className="btn" onClick={onClose} style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"13px 8px",borderRadius:12}}>닫기</button>
        const BtnCancel   = () => <button className="btn" onClick={()=>onCancel(b.id)} style={{flex:1,background:"#FEF2F2",border:"1px solid #FCA5A5",color:"#DC2626",padding:"13px 8px",fontSize:isMobile?12:13,borderRadius:12}}>예약 취소</button>
        const BtnEdit     = () => <button className="btn" onClick={()=>{onClose();onEdit(b);}} style={{flex:1,background:"#EFF6FF",border:"1px solid #BFDBFE",color:"#1D4ED8",padding:"13px 8px",fontSize:isMobile?12:13,fontWeight:600,borderRadius:12}}>예약 변경</button>
        const BtnCheckin  = () => <button className="btn" onClick={()=>{onCheckIn(b.id);onClose();}} style={{flex:2,background:"#16A34A",color:"#fff",padding:"13px 8px",fontSize:isMobile?13:14,fontWeight:600,borderRadius:12}}><span style={{display:"inline-flex",alignItems:"center",gap:5}}><CheckCircle2 size={14} strokeWidth={2}/>체크인하기</span></button>
        const BtnApprove  = () => <button className="btn" onClick={()=>{onApprove(b.id);onClose();}} style={{flex:2,background:"#16A34A",color:"#fff",padding:"13px 8px",fontSize:isMobile?13:14,fontWeight:600,borderRadius:12}}><span style={{display:"inline-flex",alignItems:"center",gap:5}}><ShieldCheck size={14} strokeWidth={2}/>승인</span></button>
        const BtnReject   = () => <button className="btn" onClick={()=>setShowRejectInput(true)} style={{flex:1,background:"#FEF2F2",border:"1px solid #FCA5A5",color:"#DC2626",padding:"13px 8px",fontSize:isMobile?12:13,borderRadius:12}}><span style={{display:"inline-flex",alignItems:"center",gap:5}}><ShieldX size={13} strokeWidth={2}/>거절</span></button>
        const BtnForce    = () => <button className="btn" onClick={()=>{onForceCancel(b.id,'관리자 강제취소');onClose();}} style={{flex:1,background:"#FEF2F2",border:"1px solid #FCA5A5",color:"#DC2626",padding:"13px 8px",fontSize:isMobile?12:13,borderRadius:12}}>강제취소</button>

        // ── 1. 종료/취소/노쇼/거절/조기반납 → 닫기 ─────────────────
        const isDone = b.autoCancelled || b.status === 'rejected' || b.earlyEnded || (!isFuture && !isAct)
        if (isDone) return btnWrap(<BtnClose />)

        // ── 2. Admin · 타인 ──────────────────────────────────────────
        if (isAdmin && !isOwner) {
          // 거절 사유 입력 flow
          if (showRejectInput) return (
            <div style={{flexShrink:0, borderTop:"1px solid #F1F5F9"}}>
              <div style={{padding: isMobile?"12px 20px 0":"12px 24px 0"}}>
                <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,padding:"12px 14px",marginBottom:8}}>
                  <div style={{fontSize:11,color:"#92400E",marginBottom:8,fontWeight:600}}>⚠️ 거절 시 예약이 즉시 취소되며 신청자에게 알림이 발송됩니다</div>
                  <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6}}>거절 사유 (신청자에게 전달됩니다)</label>
                  <textarea value={rejectReasonInput} onChange={e=>setRejectReasonInput(e.target.value)} rows={2} placeholder="거절 사유를 입력하세요 (선택)"
                    style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #E2E8F0",fontSize:12,outline:"none",resize:"none",background:"#fff",boxSizing:"border-box" as const}} />
                </div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button className="btn" onClick={()=>{setShowRejectInput(false);setRejectReasonInput('');}} style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"10px 8px",borderRadius:10,fontSize:12}}>취소</button>
                  <button className="btn" onClick={()=>{onReject(b.id,rejectReasonInput||'');setShowRejectInput(false);setRejectReasonInput('');onClose();}} style={{flex:2,background:"#DC2626",color:"#fff",padding:"10px 8px",borderRadius:10,fontSize:12,fontWeight:600}}>거절 확정</button>
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
          // 미래 confirmed → 변경 + 취소 (승인완료 에메랄드룸은 취소만)
          if (isFuture && b.status === 'confirmed') return btnWrap(<><BtnCancel />{!isApprovedAdminRoom&&<BtnEdit />}</>)
          return btnWrap(<BtnClose />)
        }

        // ── 4. 유저 · 본인 ────────────────────────────────────────────
        if (isOwner) {
          // 진행중 미체크인 → 체크인 + 취소
          if (isAct && !b.checkedIn) return btnWrap(<><BtnCancel /><BtnCheckin /></>)
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

// ─── Booking Done Modal ────────────────────────────────────────────────────────
