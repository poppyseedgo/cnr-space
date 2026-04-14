import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Building2, Calendar, ClipboardList, Clock, FileText, User, Users } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { AttendeeChip } from '../common/AttendeeChip'

export function BookingDoneModal({booking:b, onClose, rooms:rp=[], users:up=[]}) {
  const { isMobile } = useBreakpoint();
  const r = rp.find(r=>r.room_id===b.room_id);
  const floor = getFloor(r?.floor_id);
  const isPending = b.status === 'pending' || r?.is_admin_only

  return (
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 16,
      width:"100%", maxWidth: isMobile?"100%":460,
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column", overflow:"hidden",
      alignSelf: isMobile?"flex-end":"center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* 성공 배너 */}
      <div style={{background:"#FFFFFF",
        padding: isMobile?"28px 24px 24px":"32px 32px 28px", textAlign:"center", position:"relative"}}>
        
        <img src="data:image/png;base64,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" alt="예약완료" style={{width:140, height:140, objectFit:"contain", display:"block", margin:"0 auto 12px"}}/>
        <div style={{fontSize: isMobile?18:20, fontWeight:600, color:"#111111", marginBottom:6}}>{isPending ? '승인 요청 완료!' : '예약 완료!'}</div>
        <div style={{fontSize:13, color:"#555555"}}>{isPending ? '승인이 요청되었습니다. 관리자 승인 후 확정됩니다.' : '예약이 성공적으로 등록되었습니다'}</div>
      </div>

      {/* 예약 상세 */}
      <div style={{padding: isMobile?"16px 20px":"16px 24px", display:"flex", flexDirection:"column", gap:8}}>
        {[
          [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><ClipboardList size={11} strokeWidth={1.8}/>회의명</span>, b.title, null],
          [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Calendar size={11} strokeWidth={1.8}/>날짜</span>,   tsDate(b.start_at), `${DAY_NAMES[dateToObj(tsDate(b.start_at)).getDay()]}요일`],
          [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Clock size={11} strokeWidth={1.8}/>시간</span>,   `${fmtTS(b.start_at)} – ${fmtTS(b.end_at)}`,
            `${Math.floor((tsMin(b.end_at)-tsMin(b.start_at))/60)}시간 ${(tsMin(b.end_at)-tsMin(b.start_at))%60>0?(tsMin(b.end_at)-tsMin(b.start_at))%60+"분":""}`],
          [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Building2 size={11} strokeWidth={1.8}/>회의실</span>, <span style={{color:r?.color,fontWeight:600}}>{r?.room_name}</span>, `${floor?.floor_name} · ${r?.capacity}인`],
          b.memo && [<span style={{display:"inline-flex",alignItems:"center",gap:4}}><FileText size={11} strokeWidth={1.8}/>메모</span>, b.memo, null],
        ].filter(Boolean).map(([label,main,sub],i)=>(
          <div key={i} style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0,paddingTop:1}}>{label}</div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13,color:"#111111",fontWeight:600,wordBreak:"break-word"}}>{main}</div>
              {sub&&<div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{sub}</div>}
            </div>
          </div>
        ))}

        {/* 예약자 — user_id로 users에서 avatar_url 역조회 (패턴 C) */}
        {(()=>{
          const owner = (up as any[]).find(u => u.user_id === b.user_id)
          return (
            <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
              <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0,paddingTop:1,display:"flex",alignItems:"center",gap:4}}>
                <User size={11} strokeWidth={1.8}/>예약자
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <UserAvatar name={b.user} avatarUrl={owner?.avatar_url ?? null} size={24} />
                <div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600}}>{b.user}</div>
                  <div style={{fontSize:11,color:"#94A3B8",marginTop:1}}>{b.dept}</div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* 참석자 — email로 users에서 avatar_url·dept 역조회 (패턴 B) */}
        {b.attendees && b.attendees.length > 0 && (
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0,paddingTop:4,display:"flex",alignItems:"center",gap:4}}>
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

        {/* 체크인 안내 */}
        {tsDate(b.start_at)===todayStr() && (
          <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,
            padding:"10px 14px",fontSize:12,color:"#92400E",display:"flex",gap:8,alignItems:"flex-start"}}>
            <Clock size={16} strokeWidth={1.8} style={{flexShrink:0}}/>
            <span>회의 시작 후 <strong>{CHECKIN_WINDOW_MIN}분 이내</strong> 체크인이 필요합니다. 미체크인 시 자동 취소됩니다.</span>
          </div>
        )}
      </div>

      {/* 버튼 */}
      <div style={{padding: isMobile?"12px 20px 24px":"12px 24px 20px",
        borderTop:"1px solid #F1F5F9",display:"flex",gap:8,flexShrink:0}}>
        <button className="btn" onClick={onClose}
          style={{flex:1,background:"#111111",color:"#fff",padding:"13px",fontSize:14,fontWeight:600,borderRadius:12}}>
          확인
        </button>
      </div>
    </div>
  );
}


// ─── Recur Done Modal ─────────────────────────────────────────────────────────
