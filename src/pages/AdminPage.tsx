import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, fmtRoomName, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, FLOORS, getFloor, getRoomFeatures, getRoomById, getRoomThumbnail, getRoomGallery } from '../data/master'
import { uploadRoomImage, deleteRoomImage, saveRoomImages, loadRoomImages, cancelBooking as apiCancelBooking, insertAuditLog, upsertRoom, toggleRoomActive, saveRoomFeatures, loadFeatures, updateProfile } from '../lib/api'
import { Upload, ImagePlus, Trash2, X as XIcon } from 'lucide-react'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

export function AdminView({bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet, onApprove, onReject, onDetail}) {
  const [activeTab, setActiveTab] = useState("bookings");
  const PER_PAGE = 15;

  return(
    <div className="max-w-[1200px] mx-auto px-3 py-4 sm:px-6 sm:py-7">
      {/* Admin 탭 헤더 */}
      <div className="anm flex gap-1.5 mb-5 bg-white dark:bg-slate-800 rounded-xl p-1.5">
        {[{id:"bookings",icon:<BarChart2 size={14} strokeWidth={1.8}/>,label:"예약 관리"},{id:"approvals",icon:<Inbox size={14} strokeWidth={1.8}/>,label:"승인 관리",badge:bookings.filter(b=>b.status==='pending').length},{id:"rooms",icon:<Building2 size={14} strokeWidth={1.8}/>,label:"회의실 관리"},{id:"users",icon:<Users size={14} strokeWidth={1.8}/>,label:"사용자 관리"}].map(t=>(
          <button key={t.id} className="btn" onClick={()=>setActiveTab(t.id)}
            style={{flex:1,padding:"10px",fontSize:isMobile?12:13,borderRadius:10,fontWeight:activeTab===t.id?700:500,
              background:activeTab===t.id?"#111":"transparent",color:activeTab===t.id?"#fff":"#64748B",
              display:"flex",alignItems:"center",justifyContent:"center",gap:6,position:"relative"}}>
            <span>{t.icon}</span>{isMobile?null:t.label}
            {t.badge>0&&<span style={{position:"absolute",top:4,right:4,background:"#EF4444",color:"#fff",fontSize:9,fontWeight:700,borderRadius:999,padding:"1px 5px",lineHeight:1.4}}>{t.badge}</span>}
          </button>
        ))}
      </div>
      {activeTab==="approvals" && <AdminApprovals bookings={bookings} rooms={rooms} onApprove={onApprove} onReject={onReject} showToast={showToast} isMobile={isMobile} onDetail={onDetail}/>}
      {activeTab==="bookings" && <AdminBookings bookings={bookings} setBookings={setBookings} rooms={rooms} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail}/>}
      {activeTab==="rooms" && <AdminRooms rooms={rooms} setRooms={setRooms} showToast={showToast} isMobile={isMobile}/>}
      {activeTab==="users" && <AdminUsers users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile}/>}
    </div>
  );
}

// ── Admin: 예약 관리 ──
export function AdminBookings({bookings,setBookings,rooms,showToast,isMobile,PER_PAGE,onDetail}){
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
    const targetB = bookings.find(b => b.id === id);
    setBookings(prev => prev.map(b=>b.id===id?{...b,autoCancelled:true,cancelledBy:'user'}:b));
    // Audit log — 관리자 강제 취소
    insertAuditLog({
      action: 'ADMIN_FORCE_CANCEL', entityType: 'booking', entityId: id,
      afterData: { reason, title: targetB?.title, user: targetB?.user }
    }).catch(() => {})
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
                return(<tr key={b.id} style={{borderBottom:"1px solid #F8FAFC",cursor:"pointer"}}
                  onClick={()=>onDetail&&onDetail(b)}
                  onMouseEnter={e=>e.currentTarget.style.background="#FAFBFD"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"10px 14px",fontWeight:600,color:"#111",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{r ? fmtRoomName(r, {floor_name: r.floor_id+'층'}) : '?'}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{fmtTSDateFull(b.start_at)}</td>
                  <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
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
  // 이미지 관련 상태
  const [thumbnail, setThumbnail]       = useState('');
  const [gallery,   setGallery]         = useState<string[]>([]);
  const [uploading, setUploading]       = useState(false);
  const thumbRef  = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // features 상태
  const [allFeatures,   setAllFeatures]   = useState<any[]>([]);
  const [selectedFeats, setSelectedFeats] = useState<number[]>([]);

  // 최초 마운트 시 features 목록 로드
  useState(() => { loadFeatures().then(setAllFeatures); });

  const openEdit = async (r) => {
    setForm({room_name:r?.room_name||"",room_name_ko:r?.room_name_ko||"",floor_id:r?.floor_id||1,capacity:r?.capacity||4,notes:r?.notes||"",is_active:r?.is_active??true,is_admin_only:r?.is_admin_only??false});
    setEditRoom(r||{room_id:null});
    // 기존 이미지 로드
    if (r?.room_id) {
      const imgs = await loadRoomImages(r.room_id);
      setThumbnail(imgs.thumbnail_url);
      setGallery(imgs.gallery_urls);
      // 기존 features 로드
      const feats = r.features ?? [];
      setSelectedFeats(feats.map((f:any) => f.feature_id));
    } else {
      setThumbnail(''); setGallery([]); setSelectedFeats([]);
    }
  };

  // 대표 이미지 업로드
  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !editRoom?.room_id) return;
    setUploading(true);
    try {
      if (thumbnail) await deleteRoomImage(thumbnail); // 기존 삭제
      const url = await uploadRoomImage(editRoom.room_id, file, 'thumbnail');
      setThumbnail(url);
      showToast('대표 이미지가 업로드되었습니다.');
    } catch (err: any) { showToast(err.message, 'error'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  // 갤러리 이미지 업로드 (여러 장)
  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); if (!files.length || !editRoom?.room_id) return;
    setUploading(true);
    try {
      const urls = await Promise.all(files.map(f => uploadRoomImage(editRoom.room_id, f, 'gallery')));
      setGallery(prev => [...prev, ...urls]);
      showToast(`갤러리 이미지 ${urls.length}장이 추가되었습니다.`);
    } catch (err: any) { showToast(err.message, 'error'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  // 갤러리 이미지 삭제
  const removeGalleryImage = async (url: string) => {
    await deleteRoomImage(url);
    setGallery(prev => prev.filter(u => u !== url));
    showToast('이미지가 삭제되었습니다.', 'info');
  };

  const saveEdit = async () => {
    if(!form.room_name.trim()){showToast("회의실명을 입력해주세요.","error");return;}
    try {
      const capacity  = Number(form.capacity);
      const floor_id  = Number(form.floor_id);
      let roomId = editRoom.room_id;

      if (roomId) {
        // 기존 회의실 수정 — Supabase upsert
        await upsertRoom({
          room_id:      roomId,
          room_code:    form.room_code    ?? '',
          room_name:    form.room_name    ?? '',
          room_name_ko: form.room_name_ko ?? '',
          floor_id,
          capacity,
          notes:        form.notes        ?? '',
          is_active:    form.is_active    ?? true,
          is_admin_only: form.is_admin_only ?? false,
          color:        '#111111',
          thumbnail,
          gallery,
        });
        await saveRoomImages(roomId, thumbnail, gallery);
        await saveRoomFeatures(roomId, selectedFeats);
        const updated = rooms.map(r => r.room_id === roomId
          ? { ...r, ...form, capacity, floor_id, thumbnail, gallery,
              features: allFeatures.filter(f => selectedFeats.includes(f.feature_id)) }
          : r);
        setRooms(updated);
      } else {
        // 새 회의실 추가 — Supabase insert
        const nid = Math.max(...rooms.map(r => r.room_id), 0) + 1;
        const newRoom = {
          room_id:      nid,
          room_code:    form.room_code    ?? `ROOM_${nid}`,
          room_name:    form.room_name    ?? '',
          room_name_ko: form.room_name_ko ?? '',
          floor_id,
          capacity,
          notes:        form.notes        ?? '',
          is_active:    form.is_active    ?? true,
          is_admin_only: form.is_admin_only ?? false,
          color:        '#111111',
          thumbnail,
          gallery,
        };
        await upsertRoom(newRoom);
        await saveRoomImages(nid, thumbnail, gallery);
        await saveRoomFeatures(nid, selectedFeats);
        setRooms([...rooms, { ...newRoom,
          features: allFeatures.filter(f => selectedFeats.includes(f.feature_id)) }]);
      }
      showToast(editRoom.room_id ? "회의실 정보가 수정되었습니다." : "회의실이 추가되었습니다.");
      setEditRoom(null);
    } catch (err: any) { showToast(err.message, 'error'); }
  };
  const toggleActive = async (rid) => {
    const next = !rooms.find(r=>r.room_id===rid)?.is_active;
    try {
      await toggleRoomActive(rid, next);
      setRooms(rooms.map(r => r.room_id===rid ? {...r, is_active: next} : r));
      showToast(next ? "활성화되었습니다." : "비활성화되었습니다.", "info");
    } catch (err: any) { showToast(err.message, 'error'); }
  };

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
            {/* 관리자 전용 */}
            <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" id="is_admin_only" checked={!!form.is_admin_only}
                onChange={e=>setForm(p=>({...p,is_admin_only:e.target.checked}))}
                style={{width:16,height:16,cursor:"pointer"}}/>
              <label htmlFor="is_admin_only" style={{fontSize:13,color:"#374151",cursor:"pointer",fontWeight:500}}>
                관리자 전용 회의실 (일반 유저 예약 불가)
              </label>
            </div>
            {/* features 체크박스 */}
            {allFeatures.length > 0 && (
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:8}}>회의실 기능</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {allFeatures.map(f => (
                    <label key={f.feature_id} style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",
                      padding:"6px 12px",borderRadius:8,border:"1px solid #E2E8F0",fontSize:12,fontWeight:500,
                      background:selectedFeats.includes(f.feature_id)?"#111":"#F8FAFC",
                      color:selectedFeats.includes(f.feature_id)?"#fff":"#64748B"}}>
                      <input type="checkbox"
                        checked={selectedFeats.includes(f.feature_id)}
                        onChange={e => setSelectedFeats(prev =>
                          e.target.checked ? [...prev, f.feature_id] : prev.filter(id => id !== f.feature_id)
                        )}
                        style={{display:"none"}}/>
                      {f.feature_name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {/* ── 대표 이미지 ── */}
            {editRoom?.room_id && (
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:8}}>대표 이미지</label>
                <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                  {/* 미리보기 */}
                  <div style={{width:80,height:80,borderRadius:10,overflow:"hidden",background:"#F8FAFC",flexShrink:0,border:"1px solid #E2E8F0"}}>
                    {thumbnail
                      ? <img src={thumbnail} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                      : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><Building2 size={24} color="#CBD5E1"/></div>
                    }
                  </div>
                  <div style={{flex:1}}>
                    <input ref={thumbRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleThumbnailUpload}/>
                    <button className="btn" onClick={()=>thumbRef.current?.click()} disabled={uploading}
                      style={{width:"100%",padding:"10px",borderRadius:10,border:"1.5px dashed #CBD5E1",background:"#F8FAFC",color:"#64748B",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer"}}>
                      <Upload size={14}/>{uploading ? '업로드 중...' : thumbnail ? '이미지 교체' : '이미지 업로드'}
                    </button>
                    {thumbnail && (
                      <button className="btn" onClick={async()=>{await deleteRoomImage(thumbnail);setThumbnail('');showToast('삭제되었습니다.','info');}}
                        style={{width:"100%",marginTop:6,padding:"8px",borderRadius:10,background:"#FEF2F2",color:"#DC2626",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                        <Trash2 size={11}/> 삭제
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* ── 갤러리 이미지 ── */}
            {editRoom?.room_id && (
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:8}}>갤러리 ({gallery.length}장)</label>
                {gallery.length > 0 && (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
                    {gallery.map((url,i) => (
                      <div key={i} style={{position:"relative",paddingBottom:"100%",borderRadius:8,overflow:"hidden",background:"#F8FAFC"}}>
                        <img src={url} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
                        <button onClick={()=>removeGalleryImage(url)}
                          style={{position:"absolute",top:4,right:4,width:20,height:20,borderRadius:"50%",background:"rgba(0,0,0,0.6)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <XIcon size={10} color="#fff" strokeWidth={2.5}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={galleryRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={handleGalleryUpload}/>
                <button className="btn" onClick={()=>galleryRef.current?.click()} disabled={uploading}
                  style={{width:"100%",padding:"10px",borderRadius:10,border:"1.5px dashed #CBD5E1",background:"#F8FAFC",color:"#64748B",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer"}}>
                  <ImagePlus size={14}/>{uploading ? '업로드 중...' : '갤러리 이미지 추가 (여러 장 가능)'}
                </button>
              </div>
            )}
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
  const toggleRole = async (uid) => {
    const next = users.find(u=>u.user_id===uid)?.role === 'ADMIN' ? 'USER' : 'ADMIN';
    try {
      await updateProfile(uid, { role: next });
      setUsers(users.map(u => u.user_id===uid ? {...u, role: next} : u));
      showToast(`권한이 ${next}로 변경되었습니다.`, "info");
    } catch (err: any) { showToast(err.message, 'error'); }
  };
  const openEdit=(u)=>{setForm(u?{name:u.name,dept:u.dept,email:u.email,role:u.role}:{name:"",dept:"",email:"",role:"USER"});setEditUser(u||{user_id:null});};
  const saveEdit = async () => {
    if(!form.name.trim()||!form.email.trim()){showToast("이름과 이메일은 필수입니다.","error");return;}
    try {
      if (editUser.user_id) {
        // 기존 사용자 수정 — profiles 테이블 update
        await updateProfile(editUser.user_id, {
          name: form.name, dept: form.dept,
          role: form.role, employee_id: form.employee_id ?? ''
        });
        setUsers(users.map(u => u.user_id===editUser.user_id ? {...u,...form} : u));
        showToast("수정되었습니다.");
      } else {
        // 신규 사용자 추가 — Auth 없이는 불가, 안내 메시지
        showToast("신규 사용자는 Supabase 대시보드 → Authentication에서 추가해주세요.", "info");
        setEditUser(null);
        return;
      }
      setEditUser(null);
    } catch (err: any) { showToast(err.message, 'error'); }
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

// ── Admin: 승인 관리 ──────────────────────────────────────────────────────────
export function AdminApprovals({bookings, rooms, onApprove, onReject, showToast, isMobile, onDetail}) {
  const [rejectModal, setRejectModal] = useState<{id:string;title:string;user:string}|null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pending = bookings.filter(b => b.status === 'pending');
  const emeraldRoom = rooms.find(r => r.is_admin_only);

  const doApprove = async (id: string) => {
    await onApprove(id);
    showToast('예약이 승인되었습니다.');
  };

  const doReject = async () => {
    if (!rejectModal) return;
    await onReject(rejectModal.id, rejectReason || '관리자 거절');
    setRejectModal(null);
    setRejectReason('');
    showToast('예약이 거절되었습니다.', 'info');
  };

  return (
    <div className="anm">
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:800,color:'#111'}}>승인 대기</div>
        <span style={{background:'#EF4444',color:'#fff',fontSize:11,fontWeight:700,
          borderRadius:999,padding:'2px 8px'}}>{pending.length}건</span>
      </div>

      {pending.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 0',color:'#94A3B8'}}>
          <div style={{fontSize:36,marginBottom:8}}>✅</div>
          <div style={{fontSize:14,fontWeight:600}}>대기 중인 승인 요청이 없습니다</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {pending.map(b => {
            const fl = rooms.find(r=>r.room_id===b.room_id);
            return (
              <div key={b.id} onClick={()=>onDetail&&onDetail(b)} style={{background:'#fff',borderRadius:14,padding:'16px 20px',
                border:'1.5px solid #FCD34D',cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                      <span style={{background:'#FEF3C7',color:'#92400E',fontSize:11,fontWeight:700,
                        padding:'2px 8px',borderRadius:999}}>승인 대기</span>
                      <span style={{fontSize:12,color:'#94A3B8'}}>{fl?.room_name_ko ?? fl?.room_name}</span>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:'#111',marginBottom:4}}>{b.title}</div>
                    <div style={{fontSize:12,color:'#64748B'}}>
                      신청자: {b.user} ({b.dept})
                    </div>
                    <div style={{fontSize:12,color:'#64748B',marginTop:2}}>
                      {fmtTSDateFull(b.start_at)} · {fmtTSRangeFull(b.start_at,b.end_at)}
                    </div>
                    {b.memo && <div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>메모: {b.memo}</div>}
                  </div>
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    <button className="btn" onClick={()=>doApprove(b.id)}
                      style={{padding:'8px 16px',fontSize:12,fontWeight:700,borderRadius:10,
                        background:'#16A34A',color:'#fff'}}>
                      승인
                    </button>
                    <button className="btn" onClick={()=>setRejectModal({id:b.id,title:b.title,user:b.user})}
                      style={{padding:'8px 16px',fontSize:12,fontWeight:700,borderRadius:10,
                        background:'#FEF2F2',color:'#DC2626',border:'1px solid #FCA5A5'}}>
                      거절
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 거절 사유 모달 */}
      {rejectModal && (
        <div onClick={e=>e.target===e.currentTarget&&setRejectModal(null)}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',
            display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:420,padding:'24px',
            boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'#111',marginBottom:4}}>예약 거절</div>
            <div style={{fontSize:13,color:'#64748B',marginBottom:16}}>
              "{rejectModal.title}" — {rejectModal.user}
            </div>
            <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:6}}>
              거절 사유 (신청자에게 전달됩니다)
            </label>
            <textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)}
              rows={3} placeholder="거절 사유를 입력하세요 (선택)"
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',
                fontSize:13,outline:'none',resize:'none',background:'#F8FAFC',boxSizing:'border-box'}}/>
            <div style={{display:'flex',gap:8,marginTop:16}}>
              <button className="btn" onClick={()=>setRejectModal(null)}
                style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>
                취소
              </button>
              <button className="btn" onClick={doReject}
                style={{flex:1,background:'#DC2626',color:'#fff',padding:'12px',fontSize:13,fontWeight:700,borderRadius:12}}>
                거절 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
