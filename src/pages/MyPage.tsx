import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, getFloor, getRoomFeatures, getRoomById } from '../data/master'
import { cancelBooking as apiCancelBooking } from '../lib/api'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, rooms:rp=[], users:up=[]}) {
  const [tab, setTab] = useState("upcoming");
  const [statYear, setStatYear] = useState(()=>new Date().getFullYear());
  const [statMonth, setStatMonth] = useState(()=>new Date().getMonth());
  const today = todayStr();
  const now = nowMinutes();
  const allUsers = up.length>0 ? up : APP_USERS;
  const allRooms = rp.length>0 ? rp : ROOMS_DB;  // 컴포넌트 스코프 — 모든 곳에서 접근 가능
  const userInfo = allUsers.find(u=>u.name===currentUser);

  // 기간별 조회
  const [listFrom, setListFrom] = useState(()=>{const d=new Date();d.setDate(1);return objToStr(d);});
  const [listTo, setListTo] = useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return objToStr(d);});
  const [listStatus, setListStatus] = useState("ALL"); // ALL | upcoming | completed | cancelled

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

  const myBookings = useMemo(()=>bookings.filter(b=>b.user===currentUser),[bookings,currentUser]);
  const upcoming = useMemo(()=>myBookings.filter(b=>!b.autoCancelled&&(tsDate(b.start_at)>today||(tsDate(b.start_at)===today&&tsMin(b.end_at)>now))).sort((a,b)=>a.start_at.localeCompare(b.start_at)),[myBookings,today,now]);
  const completed = useMemo(()=>myBookings.filter(b=>!b.autoCancelled&&b.checkedIn&&(tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now))).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[myBookings,today,now]);
  const cancelled = useMemo(()=>myBookings.filter(b=>b.autoCancelled).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[myBookings]);
  const tabData = tab==="upcoming"?upcoming:tab==="completed"?completed:cancelled;

  // 월별 통계
  const monthStats = useMemo(()=>{
    const prefix=`${statYear}-${fmt2(statMonth+1)}`;
    const mb=myBookings.filter(b=>tsDate(b.start_at).startsWith(prefix));
    const total=mb.length, ci=mb.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length, can=mb.filter(b=>b.autoCancelled).length;
    const rate=total>0?Math.round((ci/total)*100):0;
    const rc={};mb.filter(b=>!b.autoCancelled).forEach(b=>{rc[b.room_id]=(rc[b.room_id]||0)+1;});
    const top=Object.entries(rc).sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
  const topRoom=top?(allRooms.find(r=>r.room_id===Number(top[0])) ?? null):null;
    return{total,checkedIn:ci,cancelled:can,rate,topRoom,topCount:top?top[1]:0};
  },[myBookings,statYear,statMonth]);

  // 이번달 요약
  const thisPrefix=`${new Date().getFullYear()}-${fmt2(new Date().getMonth()+1)}`;
  const thisBks=myBookings.filter(b=>tsDate(b.start_at).startsWith(thisPrefix)&&!b.autoCancelled);
  const thisCI=thisBks.filter(b=>b.checkedIn).length;
  const thisRate=thisBks.length>0?Math.round((thisCI/thisBks.length)*100):0;

  // 기간별 조회 리스트
  const filteredList = useMemo(()=>{
    return myBookings.filter(b=>{
      const d=tsDate(b.start_at);
      if(d<listFrom||d>listTo) return false;
      if(listStatus==="upcoming"&&(b.autoCancelled||d<today)) return false;
      if(listStatus==="completed"&&(!b.checkedIn&&!b.earlyEnded||b.autoCancelled)) return false;
      if(listStatus==="cancelled"&&!b.autoCancelled) return false;
      return true;
    }).sort((a,b)=>b.start_at.localeCompare(a.start_at));
  },[myBookings,listFrom,listTo,listStatus,today]);
  const listStats = {
    all: filteredList.length,
    up: filteredList.filter(b=>!b.autoCancelled&&tsDate(b.start_at)>=today).length,
    done: filteredList.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length,
    can: filteredList.filter(b=>b.autoCancelled).length,
  };

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>
      {/* 프로필 카드 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",marginBottom:20,
        display:"flex",alignItems:isMobile?"flex-start":"center",gap:isMobile?16:20,flexDirection:isMobile?"column":"row"}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:"#111",color:"#fff",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,flexShrink:0}}>
          {currentUser.charAt(0)}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontWeight:800,color:"#111"}}>{currentUser}</div>
          <div style={{fontSize:13,color:"#64748B",marginTop:2}}>{currentDept} · {userInfo?.email}</div>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"#111"}}>{thisBks.length}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>이번 달 예약</div>
          </div>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:thisRate>=70?"#16A34A":"#D97706"}}>{thisRate}%</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
          </div>
        </div>
      </div>

      {/* 예약 탭 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,overflow:"hidden",marginBottom:20}}>
        <div style={{display:"flex",borderBottom:"1px solid #F1F5F9"}}>
          {[{id:"upcoming",label:"예정",count:upcoming.length},{id:"completed",label:"완료",count:completed.length},{id:"cancelled",label:"취소",count:cancelled.length}].map(t=>(
            <button key={t.id} className="btn" onClick={()=>setTab(t.id)}
              style={{flex:1,padding:"14px 8px",fontSize:13,fontWeight:tab===t.id?700:500,
                color:tab===t.id?"#111":"#94A3B8",background:"transparent",
                borderBottom:tab===t.id?"2px solid #111":"2px solid transparent",
                display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {t.label}
              <span style={{background:tab===t.id?"#111":"#F1F5F9",color:tab===t.id?"#fff":"#94A3B8",
                fontSize:11,fontWeight:700,padding:"1px 8px",borderRadius:999}}>{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{padding:isMobile?"12px":"16px 20px"}}>
          {tabData.length===0?(
            <div style={{textAlign:"center",padding:"40px 20px",color:"#CBD5E1"}}>
              <div style={{fontSize:36,marginBottom:8}}>{tab==="upcoming"?<Inbox size={36} strokeWidth={1.2} color="#CBD5E1"/>:tab==="completed"?<CheckCircle2 size={36} strokeWidth={1.2} color="#CBD5E1"/>:<Ban size={36} strokeWidth={1.2} color="#CBD5E1"/>}</div>
              <div style={{fontSize:13}}>{tab==="upcoming"?"예정된 예약이 없습니다":tab==="completed"?"완료된 예약이 없습니다":"취소된 예약이 없습니다"}</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {tabData.map((b,i)=>{
                const r=allRooms.find(rm=>rm.room_id===b.room_id);
                const fl=getFloor(r?.floor_id);
                const dateObj=new Date(b.start_at);
                return(
                  <div key={b.id} className="anm" style={{animationDelay:`${i*30}ms`,
                    background:"#F8FAFC",borderRadius:12,padding:"14px 16px",
                    display:"flex",alignItems:isMobile?"flex-start":"center",gap:14,flexDirection:isMobile?"column":"row"}}>
                    <div style={{width:52,height:52,borderRadius:10,background:"#fff",border:"1px solid #E2E8F0",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:"#94A3B8"}}>{MONTH_NAMES[dateObj.getMonth()]}</div>
                      <div style={{fontSize:18,fontWeight:800,color:"#111",lineHeight:1}}>{dateObj.getDate()}</div>
                      <div style={{fontSize:9,color:"#CBD5E1"}}>{DAY_NAMES[dateObj.getDay()]}</div>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:"#111",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</div>
                      <div style={{fontSize:12,color:"#64748B"}}>{r?.room_name} · {fl?.floor_name} · {r?.capacity}인</div>
                      <div style={{fontSize:12,color:"#94A3B8",marginTop:2}}>{fmtTSRange(b.start_at,b.end_at)}</div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                      {tab==="completed"&&<span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3,padding:"4px 10px",borderRadius:999}}><CheckCircle2 size={10} strokeWidth={2}/>완료</span>}
                      {tab==="cancelled"&&<span style={{background:"#F1F5F9",color:"#94A3B8",fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:999}}><Ban size={10} strokeWidth={1.8} style={{marginRight:3}}/>취소</span>}
                      <button className="btn" onClick={()=>onDetail(b)}
                        style={{background:"#F1F5F9",color:"#64748B",padding:"8px 14px",fontSize:12,borderRadius:10}}>상세</button>
                      {tab==="upcoming"&&(
                        <button className="btn" onClick={()=>cancelBooking(b.id)}
                          style={{background:"#FEF2F2",border:"1px solid #FCA5A5",color:"#DC2626",padding:"8px 14px",fontSize:12,borderRadius:10}}>취소</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 월별 통계 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",animationDelay:"100ms"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:800,color:"#111"}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><BarChart2 size={15} strokeWidth={1.8}/>월별 이용 통계</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button className="btn" onClick={()=>{if(statMonth===0){setStatYear(y=>y-1);setStatMonth(11);}else setStatMonth(m=>m-1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>‹</button>
            <span style={{fontSize:13,fontWeight:700,color:"#111",minWidth:100,textAlign:"center"}}>{statYear}년 {MONTH_NAMES[statMonth]}</span>
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
                  <span style={{color:"#64748B",fontWeight:600}}>{bar.label}</span><span style={{color:"#111",fontWeight:700}}>{bar.value}건</span>
                </div>
                <div style={{height:8,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${monthStats.total>0?(bar.value/monthStats.total)*100:0}%`,background:bar.color,borderRadius:4,transition:"width 0.4s"}}/>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
                <div style={{fontSize:18,fontWeight:800,color:monthStats.rate>=70?"#16A34A":"#D97706",marginTop:2}}>{monthStats.rate}%</div>
              </div>
              {monthStats.topRoom&&(
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                  <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>가장 많이 이용</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#111",marginTop:2}}>{(monthStats.topRoom as any).room_name} ({monthStats.topCount}회)</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 기간별 예약 조회 ── */}
      <div className="anm" style={{background:"#fff",borderRadius:16,overflow:"hidden",marginTop:20,animationDelay:"150ms"}}>
        <div style={{padding:isMobile?"16px 20px":"20px 28px",borderBottom:"1px solid #F1F5F9"}}>
          <div style={{fontSize:15,fontWeight:800,color:"#111",marginBottom:14}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><ClipboardList size={15} strokeWidth={1.8}/>기간별 예약 조회</span></div>
          {/* 날짜 필터 */}
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 140px",minWidth:120}}>
              <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>시작일</label>
              <input type="date" value={listFrom} onChange={e=>setListFrom(e.target.value)}
                style={{width:"100%",padding:"8px 12px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#fff",outline:"none"}}/>
            </div>
            <span style={{color:"#CBD5E1",marginTop:16}}>~</span>
            <div style={{flex:"1 1 140px",minWidth:120}}>
              <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>종료일</label>
              <input type="date" value={listTo} onChange={e=>setListTo(e.target.value)}
                style={{width:"100%",padding:"8px 12px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#fff",outline:"none"}}/>
            </div>
          </div>
          {/* 상태 필터 */}
          <div style={{display:"flex",gap:6,marginTop:12}}>
            {[{id:"ALL",l:"전체",c:listStats.all},{id:"upcoming",l:"예정",c:listStats.up},{id:"completed",l:"완료",c:listStats.done},{id:"cancelled",l:"취소",c:listStats.can}].map(s=>(
              <button key={s.id} className="btn" onClick={()=>setListStatus(s.id)}
                style={{padding:"5px 12px",fontSize:11,borderRadius:999,
                  background:listStatus===s.id?"#111":"#F8FAFC",color:listStatus===s.id?"#fff":"#64748B",
                  border:listStatus===s.id?"none":"1px solid #E2E8F0"}}>
                {s.l} {s.c}
              </button>
            ))}
          </div>
        </div>

        {/* 리스트 */}
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {filteredList.length===0?(
            <div style={{textAlign:"center",padding:"40px 20px",color:"#CBD5E1"}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:8}}><Inbox size={32} strokeWidth={1.2} color="#CBD5E1"/></div>
              <div style={{fontSize:13}}>해당 기간에 예약 내역이 없습니다</div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:"#F8FAFC"}}>
                  {["날짜","시간","회의명","회의실","상태",""].map(h=>(
                    <th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#94A3B8",whiteSpace:"nowrap",borderBottom:"1px solid #F1F5F9"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredList.map(b=>{
                  const r=allRooms.find(rm=>rm.room_id===b.room_id);
                  const isCan=b.autoCancelled;
                  const isDone=b.checkedIn&&!isCan;
                  const isUp=!isCan&&tsDate(b.start_at)>=today;
                  return(
                    <tr key={b.id} style={{borderBottom:"1px solid #F8FAFC"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#FAFBFD"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{tsDate(b.start_at)}</td>
                      <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap",fontSize:12}}>{fmtTSRange(b.start_at,b.end_at)}</td>
                      <td style={{padding:"10px 14px",fontWeight:600,color:"#111",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</td>
                      <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{r?.room_name||"?"}</td>
                      <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                        {isCan&&<span style={{background:"#F1F5F9",color:"#94A3B8",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>취소</span>}
                        {isDone&&<span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3,padding:"3px 10px",borderRadius:999}}>완료</span>}
                        {isUp&&!isDone&&<span style={{background:"#EFF6FF",color:"#3B82F6",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>예정</span>}
                        {!isCan&&!isDone&&!isUp&&<span style={{background:"#FEF3C7",color:"#D97706",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>노쇼</span>}
                      </td>
                      <td style={{padding:"10px 14px"}}>
                        <button className="btn" onClick={()=>onDetail(b)}
                          style={{background:"#F1F5F9",color:"#64748B",padding:"5px 12px",fontSize:11,borderRadius:10}}>상세</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin View ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
