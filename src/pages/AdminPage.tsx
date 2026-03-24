import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, FLOORS, getFloor, getRoomFeatures, getRoomById, getRoomThumbnail, getRoomGallery } from '../data/master'
import { loadBookings, saveBookings, loadRooms, saveRooms, loadUsers, saveUsers } from '../utils/seed'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

export function AdminView({bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet}) {
  const [activeTab, setActiveTab] = useState("bookings");
  const PER_PAGE = 15;

  return(
    <div style={{maxWidth:1200,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>
      {/* Admin 탭 헤더 */}
      <div className="anm" style={{display:"flex",gap:6,marginBottom:20,background:"#fff",borderRadius:12,padding:6}}>
        {[{id:"bookings",icon:<BarChart2 size={14} strokeWidth={1.8}/>,label:"예약 관리"},{id:"rooms",icon:<Building2 size={14} strokeWidth={1.8}/>,label:"회의실 관리"},{id:"users",icon:<Users size={14} strokeWidth={1.8}/>,label:"사용자 관리"}].map(t=>(
          <button key={t.id} className="btn" onClick={()=>setActiveTab(t.id)}
            style={{flex:1,padding:"10px",fontSize:isMobile?12:13,borderRadius:10,fontWeight:activeTab===t.id?700:500,
              background:activeTab===t.id?"#111":"transparent",color:activeTab===t.id?"#fff":"#64748B",
              display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <span>{t.icon}</span>{isMobile?null:t.label}
          </button>
        ))}
      </div>
      {activeTab==="bookings" && <AdminBookings bookings={bookings} setBookings={setBookings} rooms={rooms} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE}/>}
      {activeTab==="rooms" && <AdminRooms rooms={rooms} setRooms={setRooms} showToast={showToast} isMobile={isMobile}/>}
      {activeTab==="users" && <AdminUsers users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile}/>}
    </div>
  );
}

// ── Admin: 예약 관리 ──
export function AdminBookings({bookings,setBookings,rooms,showToast,isMobile,PER_PAGE}){
  const today=todayStr();
  const [dateFrom,setDateFrom]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`;});
  const [dateTo,setDateTo]=useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`;});
  const [filterRoom,setFilterRoom]=useState("ALL");
  const [filterUser,setFilterUser]=useState("");
  const [filterStatus,setFilterStatus]=useState("ALL");
  const [page,setPage]=useState(1);
  const [cancelModal,setCancelModal]=useState(null);
  const [cancelReason,setCancelReason]=useState("");

  const filtered=useMemo(()=>bookings.filter(b=>{
    const d=tsDate(b.start_at);
    if(d<dateFrom||d>dateTo)return false;
    if(filterRoom!=="ALL"&&b.room_id!==Number(filterRoom))return false;
    if(filterUser&&!b.user.includes(filterUser))return false;
    if(filterStatus==="upcoming"&&(b.autoCancelled||d<today))return false;
    if(filterStatus==="completed"&&(!b.checkedIn&&!b.earlyEnded||b.autoCancelled))return false;
    if(filterStatus==="cancelled"&&!b.autoCancelled)return false;
    return true;
  }).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[bookings,dateFrom,dateTo,filterRoom,filterUser,filterStatus,today]);

  const totalPages=Math.max(1,Math.ceil(filtered.length/PER_PAGE));
  const paged=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE);
  const stats={all:filtered.length,up:filtered.filter(b=>!b.autoCancelled&&tsDate(b.start_at)>=today).length,
    done:filtered.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length,can:filtered.filter(b=>b.autoCancelled).length};

  const doCancel=(id)=>{
    const reason = cancelReason||"관리자 강제 취소";
    setBookings(prev => {
      const u = prev.map(b=>b.id===id?{...b,autoCancelled:true,cancelReason:reason}:b);
      saveBookings(u);
      return u;
    });
    showToast("예약이 강제 취소되었습니다.","info");setCancelModal(null);setCancelReason("");
  };

  return(
    <div className="anm">
      {/* 필터 */}
      <div style={{background:"#fff",borderRadius:16,padding:isMobile?"16px":"20px 24px",marginBottom:16}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end"}}>
          {[{l:"시작일",v:dateFrom,s:setDateFrom,t:"date"},{l:"종료일",v:dateTo,s:setDateTo,t:"date"}].map(f=>(
            <div key={f.l} style={{flex:"1 1 140px",minWidth:130}}>
              <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>{f.l}</label>
              <input type={f.t} value={f.v} onChange={e=>{f.s(e.target.value);setPage(1);}}
                style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#F8FAFC",outline:"none"}}/>
            </div>
          ))}
          <div style={{flex:"1 1 140px",minWidth:130}}>
            <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>회의실</label>
            <select value={filterRoom} onChange={e=>{setFilterRoom(e.target.value);setPage(1);}}
              style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#F8FAFC",outline:"none"}}>
              <option value="ALL">전체</option>{rooms.filter(r=>r.is_active).map(r=><option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>
          <div style={{flex:"1 1 140px",minWidth:130}}>
            <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>예약자</label>
            <input placeholder="이름 검색..." value={filterUser} onChange={e=>{setFilterUser(e.target.value);setPage(1);}}
              style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#F8FAFC",outline:"none"}}/>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:12,flexWrap:"wrap"}}>
          {[{id:"ALL",l:`전체 ${stats.all}`},{id:"upcoming",l:`예정 ${stats.up}`},{id:"completed",l:`완료 ${stats.done}`},{id:"cancelled",l:`취소 ${stats.can}`}].map(s=>(
            <button key={s.id} className="btn" onClick={()=>{setFilterStatus(s.id);setPage(1);}}
              style={{padding:"5px 12px",fontSize:11,borderRadius:999,background:filterStatus===s.id?"#111":"#F8FAFC",color:filterStatus===s.id?"#fff":"#64748B",
                border:filterStatus===s.id?"none":"1px solid #E2E8F0"}}>{s.l}</button>
          ))}
        </div>
      </div>
      {/* 테이블 */}
      <div style={{background:"#fff",borderRadius:16,overflow:"hidden"}}>
        {paged.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:"#CBD5E1"}}><div style={{display:"flex",justifyContent:"center",marginBottom:8}}><Inbox size={40} strokeWidth={1.2} color="#CBD5E1"/></div><div style={{fontSize:13}}>조건에 맞는 예약이 없습니다</div></div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:"#F8FAFC"}}>
                {["회의명","회의실","날짜","시간","예약자","상태","관리"].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#94A3B8",whiteSpace:"nowrap",borderBottom:"1px solid #F1F5F9"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{paged.map(b=>{
                const r=rooms.find(rm=>rm.room_id===b.room_id);
                const isCan=b.autoCancelled,isDone=b.checkedIn&&!isCan,isUp=!isCan&&tsDate(b.start_at)>=today;
                return(<tr key={b.id} style={{borderBottom:"1px solid #F8FAFC"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#FAFBFD"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"10px 14px",fontWeight:600,color:"#111",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{r?.room_name||"?"}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{tsDate(b.start_at)}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{fmtTSRange(b.start_at,b.end_at)}</td>
                  <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}><span style={{fontWeight:600,color:"#111"}}>{b.user}</span> <span style={{color:"#94A3B8",fontSize:11}}>{b.dept}</span></td>
                  <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                    {isCan&&<span style={{background:"#F1F5F9",color:"#94A3B8",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>취소</span>}
                    {isDone&&<span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3,padding:"3px 10px",borderRadius:999}}>완료</span>}
                    {isUp&&!isDone&&<span style={{background:"#EFF6FF",color:"#3B82F6",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>예정</span>}
                    {!isCan&&!isDone&&!isUp&&<span style={{background:"#FEF3C7",color:"#D97706",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>노쇼</span>}
                  </td>
                  <td style={{padding:"10px 14px"}}>{!isCan&&<button className="btn" onClick={()=>setCancelModal(b)}
                    style={{background:"#FEF2F2",border:"1px solid #FCA5A5",color:"#DC2626",padding:"5px 12px",fontSize:11,borderRadius:10}}>강제 취소</button>}</td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        )}
        {totalPages>1&&(
          <div style={{display:"flex",justifyContent:"center",gap:4,padding:"16px",borderTop:"1px solid #F1F5F9"}}>
            <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} style={{padding:"6px 12px",fontSize:12,borderRadius:8,background:"#F1F5F9",color:page===1?"#CBD5E1":"#64748B"}}>‹</button>
            {Array.from({length:Math.min(totalPages,7)},(_,i)=>{let p=totalPages<=7?i+1:page<=4?i+1:page>=totalPages-3?totalPages-6+i:page-3+i;
              return <button key={p} className="btn" onClick={()=>setPage(p)} style={{padding:"6px 10px",fontSize:12,borderRadius:8,minWidth:32,background:page===p?"#111":"#F8FAFC",color:page===p?"#fff":"#64748B",fontWeight:page===p?700:400}}>{p}</button>;
            })}
            <button className="btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)} style={{padding:"6px 12px",fontSize:12,borderRadius:8,background:"#F1F5F9",color:page===totalPages?"#CBD5E1":"#64748B"}}>›</button>
          </div>
        )}
      </div>
      {/* 강제 취소 모달 */}
      {cancelModal&&(
        <div onClick={e=>e.target===e.currentTarget&&setCancelModal(null)}
          style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.55)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div className="anm" style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:400,padding:"24px",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{fontSize:16,fontWeight:800,color:"#111",marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><AlertTriangle size={15} strokeWidth={1.8}/>예약 강제 취소</span></div>
            <div style={{fontSize:13,color:"#64748B",marginBottom:16}}>"{cancelModal.title}" — {cancelModal.user}</div>
            <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:6}}>취소 사유</label>
            <textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value)} rows={3} placeholder="취소 사유를 입력하세요 (선택)"
              style={{width:"100%",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,padding:"10px 14px",fontSize:13,outline:"none",resize:"none"}}/>
            <div style={{display:"flex",gap:8,marginTop:16}}>
              <button className="btn" onClick={()=>setCancelModal(null)} style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"12px",fontSize:13,borderRadius:12}}>돌아가기</button>
              <button className="btn" onClick={()=>doCancel(cancelModal.id)} style={{flex:1,background:"#DC2626",color:"#fff",padding:"12px",fontSize:13,fontWeight:700,borderRadius:12}}>강제 취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: 회의실 관리 ──
export function AdminRooms({rooms,setRooms,showToast,isMobile}){
  const [editRoom,setEditRoom]=useState(null);
  const [form,setForm]=useState<Record<string,any>>({});
  const openEdit=(r)=>{setForm({room_name:r?.room_name||"",room_name_ko:r?.room_name_ko||"",floor_id:r?.floor_id||1,capacity:r?.capacity||4,notes:r?.notes||"",thumbnail:r?.thumbnail||"",is_active:r?.is_active??true});setEditRoom(r||{room_id:null});};
  const saveEdit=()=>{
    if(!form.room_name.trim()){showToast("회의실명을 입력해주세요.","error");return;}
    let updated;
    if(editRoom.room_id){updated=rooms.map(r=>r.room_id===editRoom.room_id?{...r,...form,capacity:Number(form.capacity),floor_id:Number(form.floor_id)}:r);}
    else{const nid=Math.max(...rooms.map(r=>r.room_id),0)+1;updated=[...rooms,{room_id:nid,room_code:`ROOM_${nid}`,color:"#111111",...form,capacity:Number(form.capacity),floor_id:Number(form.floor_id)}];}
    setRooms(updated);saveRooms(updated);showToast(editRoom.room_id?"회의실 정보가 수정되었습니다.":"회의실이 추가되었습니다.");setEditRoom(null);
  };
  const toggleActive=(rid)=>{const updated=rooms.map(r=>r.room_id===rid?{...r,is_active:!r.is_active}:r);setRooms(updated);saveRooms(updated);showToast(updated.find(x=>x.room_id===rid).is_active?"활성화되었습니다.":"비활성화되었습니다.","info");};

  return(
    <div className="anm">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:800,color:"#111"}}>전체 {rooms.length}개 회의실</div>
        <button className="btn" onClick={()=>openEdit(null)} style={{background:"#111",color:"#fff",padding:"8px 16px",fontSize:12,borderRadius:10}}>+ 회의실 추가</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
        {rooms.map(r=>{const fl=getFloor(r.floor_id);const feats=getRoomFeatures(r.room_id);return(
          <div key={r.room_id} className="anm" style={{background:"#fff",borderRadius:16,overflow:"hidden",opacity:r.is_active?1:0.5}}>
            <div style={{display:"flex",gap:16,padding:"16px 20px"}}>
              <div style={{width:80,height:80,borderRadius:10,overflow:"hidden",flexShrink:0,background:"#F8FAFC"}}>
                {r.thumbnail?<img src={r.thumbnail} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLElement).style.display="none";}}/>
                :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"#CBD5E1"}}><Building2 size={28} strokeWidth={1.2} color="#CBD5E1"/></div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,color:"#111"}}>{r.room_name}</div>
                <div style={{fontSize:12,color:"#64748B",marginTop:2}}>{r.room_name_ko} · {fl?.floor_name} · {r.capacity}인</div>
                {feats.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                  {feats.map(f=><span key={f.feature_id} style={{background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:999,padding:"2px 8px",fontSize:10,color:"#0369A1",fontWeight:600}}>{f.feature_name}</span>)}
                </div>}
                {!r.is_active&&<span style={{background:"#FEE2E2",color:"#DC2626",fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:999,marginTop:6,display:"inline-block"}}>비활성</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,padding:"0 20px 16px"}}>
              <button className="btn" onClick={()=>openEdit(r)} style={{flex:1,background:"#F8FAFC",color:"#64748B",padding:"8px",fontSize:12,borderRadius:10,border:"1px solid #E2E8F0"}}>수정</button>
              <button className="btn" onClick={()=>toggleActive(r.room_id)}
                style={{flex:1,background:r.is_active?"#FEF2F2":"#F0FDF4",color:r.is_active?"#DC2626":"#16A34A",padding:"8px",fontSize:12,borderRadius:10,border:`1px solid ${r.is_active?"#FCA5A5":"#86EFAC"}`}}>
                {r.is_active?"비활성화":"활성화"}</button>
            </div>
          </div>
        );})}
      </div>
      {/* 수정 모달 */}
      {editRoom&&(
        <div onClick={e=>e.target===e.currentTarget&&setEditRoom(null)} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.55)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div className="anm" style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:460,maxHeight:"90vh",overflow:"auto",padding:"24px",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:800,color:"#111"}}>{editRoom.room_id?"회의실 정보 수정":"새 회의실 추가"}</div>
              <button className="btn" onClick={()=>setEditRoom(null)} style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",background:"#F1F5F9",color:"#64748B"}}><X size={14} strokeWidth={2}/></button>
            </div>
            {[{k:"room_name",l:"회의실명 (영문) *"},{k:"room_name_ko",l:"회의실명 (한글)"}].map(f=>(
              <div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>{f.l}</label>
              <input value={form[f.k]||""} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:14,background:"#F8FAFC",outline:"none"}}/></div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>층 *</label>
                <select value={form.floor_id} onChange={e=>setForm(p=>({...p,floor_id:e.target.value}))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:14,background:"#F8FAFC",outline:"none"}}>
                  {FLOORS.map(f=><option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}</select></div>
              <div><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>수용인원 *</label>
                <input type="number" value={form.capacity} onChange={e=>setForm(p=>({...p,capacity:e.target.value}))} min={1} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:14,background:"#F8FAFC",outline:"none"}}/></div>
            </div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>설명/메모</label>
              <textarea value={form.notes||""} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#F8FAFC",outline:"none",resize:"none"}}/></div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>대표 이미지 URL</label>
              <input value={form.thumbnail||""} onChange={e=>setForm(p=>({...p,thumbnail:e.target.value}))} placeholder="https://..." style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#F8FAFC",outline:"none"}}/></div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button className="btn" onClick={()=>setEditRoom(null)} style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"12px",fontSize:13,borderRadius:12}}>취소</button>
              <button className="btn" onClick={saveEdit} style={{flex:1,background:"#111",color:"#fff",padding:"12px",fontSize:13,fontWeight:700,borderRadius:12}}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: 사용자 관리 ──
export function AdminUsers({users,setUsers,showToast,isMobile}){
  const [searchQ,setSearchQ]=useState("");
  const [editUser,setEditUser]=useState(null);
  const [form,setForm]=useState<Record<string,any>>({});
  const filtered=users.filter(u=>{if(!searchQ)return true;const q=searchQ.toLowerCase();return u.name.toLowerCase().includes(q)||u.dept.toLowerCase().includes(q)||u.email.toLowerCase().includes(q);});
  const adminCount=users.filter(u=>u.role==="ADMIN").length;
  const toggleRole=(uid)=>{const updated=users.map(u=>u.user_id===uid?{...u,role:u.role==="ADMIN"?"USER":"ADMIN"}:u);setUsers(updated);saveUsers(updated);showToast(`권한이 ${updated.find(x=>x.user_id===uid).role}로 변경되었습니다.`,"info");};
  const openEdit=(u)=>{setForm(u?{name:u.name,dept:u.dept,email:u.email,role:u.role}:{name:"",dept:"",email:"",role:"USER"});setEditUser(u||{user_id:null});};
  const saveEdit=()=>{
    if(!form.name.trim()||!form.email.trim()){showToast("이름과 이메일은 필수입니다.","error");return;}
    let updated;
    if(editUser.user_id){updated=users.map(u=>u.user_id===editUser.user_id?{...u,...form}:u);}
    else{updated=[...users,{user_id:`u${String(users.length+1).padStart(3,"0")}`,...form}];}
    setUsers(updated);saveUsers(updated);showToast(editUser.user_id?"수정되었습니다.":"추가되었습니다.");setEditUser(null);
  };
  return(
    <div className="anm">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:15,fontWeight:800,color:"#111"}}>전체 {users.length}명 <span style={{color:"#94A3B8",fontWeight:400,fontSize:13}}>· ADMIN {adminCount}명</span></div>
        <button className="btn" onClick={()=>openEdit(null)} style={{background:"#111",color:"#fff",padding:"8px 16px",fontSize:12,borderRadius:10}}>+ 사용자 추가</button>
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:"10px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <Search size={14} strokeWidth={1.8} style={{color:"#94A3B8",flexShrink:0}}/>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="이름, 부서, 이메일로 검색..." style={{flex:1,border:"none",outline:"none",fontSize:13,background:"transparent",color:"#111"}}/>
        {searchQ&&<button className="btn" onClick={()=>setSearchQ("")} style={{background:"none",color:"#CBD5E1",display:"flex",alignItems:"center"}}><X size={11} strokeWidth={2}/></button>}
      </div>
      <div style={{background:"#fff",borderRadius:16,overflow:"hidden"}}>
        {isMobile?(
          <div style={{display:"flex",flexDirection:"column"}}>{filtered.map(u=>(
            <div key={u.user_id} style={{padding:"14px 20px",borderBottom:"1px solid #F8FAFC",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:u.role==="ADMIN"?"#111":"#E2E8F0",color:u.role==="ADMIN"?"#fff":"#64748B",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{u.name.charAt(0)}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:"#111"}}>{u.name} <span style={{color:"#94A3B8",fontWeight:400}}>{u.dept}</span></div><div style={{fontSize:11,color:"#94A3B8",marginTop:1}}>{u.email}</div></div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button className="btn" onClick={()=>toggleRole(u.user_id)} style={{padding:"4px 10px",fontSize:10,borderRadius:999,fontWeight:700,background:u.role==="ADMIN"?"#111":"#F8FAFC",color:u.role==="ADMIN"?"#fff":"#64748B",border:u.role==="ADMIN"?"none":"1px solid #E2E8F0"}}>{u.role}</button>
                <button className="btn" onClick={()=>openEdit(u)} style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:10,borderRadius:999}}>수정</button>
              </div>
            </div>
          ))}</div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#F8FAFC"}}>{["","이름","부서","이메일","권한","관리"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#94A3B8",borderBottom:"1px solid #F1F5F9"}}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map(u=>(
              <tr key={u.user_id} style={{borderBottom:"1px solid #F8FAFC"}} onMouseEnter={e=>e.currentTarget.style.background="#FAFBFD"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"10px 14px",width:48}}><div style={{width:32,height:32,borderRadius:"50%",background:u.role==="ADMIN"?"#111":"#E2E8F0",color:u.role==="ADMIN"?"#fff":"#64748B",fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{u.name.charAt(0)}</div></td>
                <td style={{padding:"10px 14px",fontWeight:600,color:"#111"}}>{u.name}</td>
                <td style={{padding:"10px 14px",color:"#64748B"}}>{u.dept}</td>
                <td style={{padding:"10px 14px",color:"#64748B"}}>{u.email}</td>
                <td style={{padding:"10px 14px"}}><button className="btn" onClick={()=>toggleRole(u.user_id)} style={{padding:"4px 12px",fontSize:11,borderRadius:999,fontWeight:700,background:u.role==="ADMIN"?"#111":"#F8FAFC",color:u.role==="ADMIN"?"#fff":"#64748B",border:u.role==="ADMIN"?"none":"1px solid #E2E8F0"}}>{u.role}</button></td>
                <td style={{padding:"10px 14px"}}><button className="btn" onClick={()=>openEdit(u)} style={{background:"#F1F5F9",color:"#64748B",padding:"6px 14px",fontSize:11,borderRadius:10}}>수정</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {editUser&&(
        <div onClick={e=>e.target===e.currentTarget&&setEditUser(null)} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.55)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div className="anm" style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:400,padding:"24px",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:800,color:"#111"}}>{editUser.user_id?"사용자 수정":"새 사용자 추가"}</div>
              <button className="btn" onClick={()=>setEditUser(null)} style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",background:"#F1F5F9",color:"#64748B"}}><X size={14} strokeWidth={2}/></button>
            </div>
            {[{k:"name",l:"이름 *"},{k:"dept",l:"부서"},{k:"email",l:"이메일 *"}].map(f=>(
              <div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>{f.l}</label>
              <input value={form[f.k]||""} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:14,background:"#F8FAFC",outline:"none"}}/></div>
            ))}
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>권한</label>
              <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:14,background:"#F8FAFC",outline:"none"}}>
                <option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button className="btn" onClick={()=>setEditUser(null)} style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"12px",fontSize:13,borderRadius:12}}>취소</button>
              <button className="btn" onClick={saveEdit} style={{flex:1,background:"#111",color:"#fff",padding:"12px",fontSize:13,fontWeight:700,borderRadius:12}}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
