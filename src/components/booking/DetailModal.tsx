import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AlertTriangle, CheckCircle2, X, Building2, Clock, User, Monitor, FileText, Users } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtTimeFull, fmtTSFull, fmtTSRangeFull, fmtDateFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

import { AttendeeChip } from '../common/AttendeeChip'
import { BookingStatusBadge } from '../common/BookingStatusBadge'

export function DetailModal({booking:b,onClose,onCheckIn,onCancel,onEdit,currentUser, rooms:rp=[], users:up=[]}) {
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
              <BookingStatusBadge booking={b} room={r} currentUser={currentUser} />
            </div>
            <div style={{fontSize: isMobile ? 17 : 20, fontWeight:600, color:"#111111", wordBreak:"break-word"}}>{b.title}</div>
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
        // ── 버튼 표시 조건 (매트릭스 기준) ─────────────────────────
        // 체크인: 진행중 + 본인 + 미체크인
        const showCheckin = isAct && isOwner && !b.checkedIn
        // 예약변경: 미래 + 본인 + confirmed (pending 제외)
        const showEdit    = isOwner && isFuture && !b.autoCancelled && !b.checkedIn && b.status === 'confirmed'
        // 예약취소: 미래 + 본인 (confirmed + pending 모두 가능)
        const showCancel  = isOwner && isFuture && !b.autoCancelled
        // 닫기: 위 버튼 하나도 없을 때
        const showClose   = !showCheckin && !showEdit && !showCancel
        return (
          <div style={{padding: isMobile ? "12px 20px 24px" : "12px 24px 20px", display:"flex", gap:8, flexShrink:0,
            borderTop: "1px solid #F1F5F9"}}>
            {showCheckin && (
              <button className="btn" onClick={()=>{onCheckIn(b.id);onClose();}}
                style={{flex:2, background:"#16A34A", color:"#fff",
                  padding:"13px 8px", fontSize: isMobile ? 13 : 14, fontWeight:600, borderRadius:12}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                  <CheckCircle2 size={14} strokeWidth={2}/>체크인하기
                </span>
              </button>
            )}
            {showEdit && (
              <button className="btn" onClick={()=>{ onClose(); onEdit(b); }}
                style={{flex:1, background:"#EFF6FF", border:"1px solid #BFDBFE", color:"#1D4ED8",
                  padding:"13px 8px", fontSize: isMobile ? 12 : 13, fontWeight:600, borderRadius:12}}>
                예약 변경
              </button>
            )}
            {showCancel && (
              <button className="btn" onClick={()=>onCancel(b.id)}
                style={{flex:1, background:"#FEF2F2", border:"1px solid #FCA5A5", color:"#DC2626",
                  padding:"13px 8px", fontSize: isMobile ? 12 : 13, borderRadius:12}}>
                예약 취소
              </button>
            )}
            {showClose && (
              <button className="btn" onClick={onClose}
                style={{flex:1, background:"#F1F5F9", color:"#64748B", padding:"13px 8px", borderRadius:12}}>
                닫기
              </button>
            )}
          </div>
        )
      })()}
    </div>
  );
}

// ─── Booking Done Modal ────────────────────────────────────────────────────────
