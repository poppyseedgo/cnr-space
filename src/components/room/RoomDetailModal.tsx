import { useState } from 'react'
import { X } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsMin, fmtTimeFull, fmtTSFull, getRoomStatus } from '../../utils/time'
import { getFloor } from '../../data/floors'
import { RoomStatusBadge } from '../common/RoomStatusBadge'

/**
 * RoomDetailModal
 *
 * ✅ 변경 이력
 *  - [2026-04-18 스타일 정리] 헤더 상태 chip을 인라인 하드코딩 → RoomStatusBadge로 교체
 *  - [2026-04-21 피그마 디자인 전면 적용] Figma node 177:346 반영
 *     · 모달 borderRadius: 16 → 24
 *     · 헤더 padding 16px 20px, borderBottom 제거
 *     · 제목 20 → 24, subtitle 12 → 14 (color #6A7282), 내용 room_name_ko만
 *     · 닫기 버튼 배경 제거 (icon만)
 *     · 2컬럼 padding 16, LEFT gap 16 / RIGHT gap 24
 *     · 썸네일 borderRadius 12 → 16
 *     · 기본 정보: 회색 박스 → border-bottom 구분선 스타일 (라벨 14 SemiBold #96A0B3 width 64, 값 14 Regular #111)
 *     · 오늘 예약 현황: 제목 14, 카운트 chip radius 8 px8py4 fs10 Medium
 *     · 예약 카드 배경 #F6F9FF 통일, padding 10px 12px, 시간 색 #5E636D
 *     · 예약자/부서: 별도 span (이름 Medium #3A3F4A, 부서 Regular #A2A7B2, gap 4, 중앙점 없음)
 *     · Footer: Button 컴포넌트 → 인라인 (p:8, gap:16, h:56, radius:16, 닫기 #F1F5F9/#64748B)
 */

export function RoomDetailModal({room:r, bookings, onClose, onBook, onDetail}: {room:any,bookings:any[],onClose:any,onBook:any,onDetail?:any}) {
  const { isMobile } = useBreakpoint();
  const floor    = getFloor(r.floor_id);
  const features = r.features ?? [];
  const today    = todayStr();
  // ← 필터 정책: rejected·사용자취소(user)·강제취소(admin) 제외, 노쇼(system)·승인대기(pending) 포함
  const todayBks = bookings
    .filter(b =>
      b.room_id === r.room_id &&
      tsDate(b.start_at) === today &&
      b.status !== 'rejected' &&
      b.cancelledBy !== 'user' &&
      b.cancelledBy !== 'admin'
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const status   = getRoomStatus(r.room_id, bookings, today);
  const thumbnail = r.thumbnail ?? '';

  const [lightbox, setLightbox] = useState(false);

  return (
    <>
    {/* 라이트박스 — 썸네일 확대 */}
    {lightbox && thumbnail && (
      <div onClick={()=>setLightbox(false)}
        style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.92)",
          display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
        <img src={thumbnail} alt={r.room_name}
          onClick={e=>e.stopPropagation()}
          style={{maxWidth:"90vw",maxHeight:"85vh",objectFit:"contain",borderRadius:12,
            boxShadow:"0 8px 40px rgba(0,0,0,0.6)",cursor:"default"}}/>
        <button onClick={()=>setLightbox(false)}
          style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.15)",
            border:"none",borderRadius:"50%",width:36,height:36,color:"#fff",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><X size={16} strokeWidth={1.8}/></button>
      </div>
    )}

    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 24,             // ← [피그마] 16 → 24
      width:"100%", maxWidth: isMobile ? "100%" : 760,
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── 헤더 바 ── */}
      {/* ← [피그마] padding 18px 28px 14px → 16px 20px, borderBottom 제거 */}
      <div style={{padding: isMobile ? "20px 20px 14px" : "16px 20px",
        display:"flex", justifyContent:"space-between",
        alignItems:"flex-start", flexShrink:0}}>
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:4}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {/* ← [피그마] 제목 20 → 24 (SemiBold) */}
            <div style={{fontSize: isMobile ? 20 : 24, fontWeight:600, color:"#111", lineHeight:1.5}}>{r.room_name}</div>
            <RoomStatusBadge status={status} />
          </div>
          {/* ← [피그마] subtitle 12 #64748B → 14 #6A7282 Regular, 내용 room_name_ko만 */}
          <div style={{fontSize:14,color:"#6A7282",fontWeight:400,lineHeight:1.5}}>{r.room_name_ko}</div>
        </div>
        {/* ← [피그마] 닫기 버튼 배경 제거 — icon만 */}
        <button className="btn" onClick={onClose}
          style={{width:32,height:32,borderRadius:"50%",background:"transparent",
            color:"#111",flexShrink:0,border:"none",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}><X size={20} strokeWidth={1.8}/></button>
      </div>

      {/* ── 본문: 데스크톱 2컬럼 / 모바일 1컬럼 ── */}
      <div style={{flex:1, overflowY:"auto"}}>
        <div style={{
          display: isMobile ? "flex" : "grid",
          // ← [피그마] 정확한 50/50 — minmax(0, 1fr)로 content 넘침 방지
          gridTemplateColumns: isMobile ? undefined : "minmax(0, 1fr) minmax(0, 1fr)",
          flexDirection: isMobile ? "column" : undefined,
          gap: 0,
        }}>

          {/* ── LEFT: 썸네일 + 기본 정보 ── */}
          {/* ← [피그마] padding 20px 24px → 16px, gap 12 → 16 */}
          <div style={{
            padding: 16,
            borderRight: isMobile ? "none" : "1px solid #F1F5F9",
            display:"flex", flexDirection:"column", gap:16,
            minWidth: 0,                // ← grid 50/50 보장 (content overflow 방지)
          }}>
            {/* 썸네일 — ← [피그마] borderRadius 12 → 16 */}
            <div style={{width:"100%", height: isMobile ? 180 : 200, borderRadius:16, overflow:"hidden",
              background:thumbnail?"#F3F4F8":"rgb(251, 253, 255)", cursor: thumbnail ? "zoom-in" : "default"}}
              onClick={()=>thumbnail&&setLightbox(true)}>
              {thumbnail ? (
                <img src={thumbnail} alt={r.room_name}
                  style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                  onError={e=>{(e.target as HTMLElement).style.display="none";}}/>
              ) : (
                <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgb(199, 213, 228)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                  </svg>
                  <div style={{fontSize:11,color:"rgb(199, 213, 228)",fontWeight:500}}>이미지 준비중</div>
                </div>
              )}
            </div>

            {/* 기본 정보 — ← [피그마] 완전 재설계
                회색 박스 → border-bottom 0.5px #F1F5F9 구분선
                컨테이너 padding 4px 8px, 각 row padding py:10
                라벨 14 SemiBold #96A0B3 width 64
                값 14 Regular #111 */}
            <div style={{display:"flex",flexDirection:"column",padding:"8px 4px"}}>
              {[
                ["위치", floor?.floor_name ?? ""],
                ["수용인원", `${r.capacity}명`],
              ].map(([label,val],i)=>(
                <div key={i} style={{borderBottom:"0.5px solid #F1F5F9",padding:"10px 0",
                  display:"flex",alignItems:"center"}}>
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.5}}>{label}</div>
                  <div style={{fontSize:14,color:"#111",fontWeight:400,lineHeight:1.5}}>{val}</div>
                </div>
              ))}
              {r.notes && (
                <div style={{borderBottom:"0.5px solid #F1F5F9",padding:"10px 0",
                  display:"flex",alignItems:"flex-start"}}>
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.5}}>설명</div>
                  <div style={{fontSize:14,color:"#111",fontWeight:400,flex:1,minWidth:0,
                    wordBreak:"break-word",lineHeight:1.5}}>{r.notes}</div>
                </div>
              )}
              {features.length>0 && (
                <div style={{borderBottom:"0.5px solid #F1F5F9",padding:"10px 0",
                  display:"flex",alignItems:"center"}}>
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.5}}>설비</div>
                  <div style={{fontSize:14,color:"#111",fontWeight:400,lineHeight:1.5}}>
                    {features.map(f=>f.value_text||f.feature_name).join(", ")}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: 상태 + 오늘 예약 현황 ── */}
          {/* ← [피그마] padding 20px 24px → 16px, gap 12 → 24 */}
          <div style={{
            padding: 16,
            display:"flex", flexDirection:"column", gap:24,
            minWidth: 0,                // ← grid 50/50 보장 (content overflow 방지)
          }}>
            {status.type==="BUSY" && (
              <div style={{background:"#FEF2F2",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#DC2626",fontWeight:600,marginBottom:6}}>현재 사용 중</div>
                <div style={{fontSize:14,color:"#111",fontWeight:600}}>{status.booking?.title}</div>
                <div style={{fontSize:12,color:"#6A7282",marginTop:4}}>{fmtTimeFull(status.endTime)}까지 · {status.minsLeft}분 남음</div>
              </div>
            )}
            {status.type==="SOON" && (
              <div style={{background:"#FFFBEB",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#D97706",fontWeight:600,marginBottom:6}}>사용 예정</div>
                <div style={{fontSize:14,color:"#111",fontWeight:600}}>{status.minsUntil}분 후 사용 시작</div>
                <div style={{fontSize:12,color:"#6A7282",marginTop:4}}>{fmtTimeFull(status.nextStart)} 부터</div>
              </div>
            )}
            {status.type==="AVAILABLE" && r.is_admin_only && (
              /* ← [피그마] 에메랄드 안내 메시지 (승인 후 확정) */
              <div style={{background:"#E6FFB0",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:12,color:"#111",fontWeight:500,lineHeight:1.5}}>관리자 승인 후 예약이 확정됩니다</div>
              </div>
            )}
            {status.type==="AVAILABLE" && !r.is_admin_only && (
              <div style={{background:"#E8F4FF",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#0369A1",fontWeight:600,marginBottom:4}}>예약 가능</div>
                <div style={{fontSize:13,color:"#111",fontWeight:600}}>지금 바로 이용 가능합니다</div>
              </div>
            )}

            {/* 오늘 예약 현황 */}
            <div>
              {/* ← [피그마] 제목 12 → 14, 카운트 chip radius 999 → 8 px8py4 fs10 Medium */}
              <div style={{padding:"12px 0",
                display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14,fontWeight:600,color:"#111",lineHeight:1.5}}>오늘 예약 현황</span>
                <span style={{fontSize:10,color:"#fff",fontWeight:500,background:"#111",
                  borderRadius:8,padding:"4px 8px",lineHeight:1}}>{todayBks.length}건</span>
              </div>
              {todayBks.length===0
                ? <div style={{background:"#F8FAFC",borderRadius:10,padding:"20px",
                    textAlign:"center",fontSize:12,color:"#A2A7B2"}}>
                    오늘 예약이 없습니다
                  </div>
                : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {todayBks.map(b => {
                      const bNow     = nowMinutes();
                      const startMin = tsMin(b.start_at);
                      const endMin   = tsMin(b.end_at);

                      // ← [v2.1 자연 배타성] 노쇼/기한초과 판정
                      const isExpired  = !!r.is_admin_only && b.status === 'pending' && b.autoCancelled && startMin < bNow
                      const isNoshow   = (b.status === 'confirmed' || b.status === 'cancelled')
                                         && b.autoCancelled && b.cancelledBy === 'system' && !b.checkedIn
                      const isPending  = !b.autoCancelled && b.status === 'pending';
                      const isEarlyEnd = !b.autoCancelled && b.earlyEnded;
                      const isActive   = !b.autoCancelled && !b.earlyEnded && startMin <= bNow && bNow < endMin;
                      const isDone     = !b.autoCancelled && !b.earlyEnded && endMin <= bNow;
                      const dimmed     = isNoshow || isExpired || isDone;

                      return (
                        <div key={b.id} style={{
                          background: "#F6F9FF",             // ← [피그마] 상태별 배경색 → 통일 #F6F9FF
                          borderRadius:10,
                          padding:"10px 12px",                // ← [피그마] 10px 14px → 10px 12px
                          display:"flex", flexDirection:"column", gap:8,
                          cursor:"pointer",
                          opacity: dimmed ? 0.5 : 1,
                          transition: "background 0.1s",
                        }}
                          onClick={()=>onDetail&&onDetail(b)}
                          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="#EEF2FF"}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="#F6F9FF"}}
                        >
                          {/* 1행: 상태칩 + 제목 | 시간 */}
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                              {/* ← [피그마 StatusBadge-XS] fs:9 Medium, padding:1px 4px, radius:4, lineHeight:1.5
                                    색상은 각 상태 토큰(chip-pending/expired/noshow 등)이 제공 */}
                              {isActive   && <span style={{width:7,height:7,borderRadius:"50%",background:"#E11D48",display:"inline-block",flexShrink:0}}/>}
                              {isPending  && <span className="chip-pending" style={{flexShrink:0,fontSize:9,fontWeight:500,padding:"1px 4px",borderRadius:4,lineHeight:1.5}}>승인대기</span>}
                              {isExpired  && <span className="chip-expired" style={{flexShrink:0,fontSize:9,fontWeight:500,padding:"1px 4px",borderRadius:4,lineHeight:1.5}}>승인기한초과 취소</span>}
                              {isNoshow   && <span className="chip-noshow"  style={{flexShrink:0,fontSize:9,fontWeight:500,padding:"1px 4px",borderRadius:4,lineHeight:1.5}}>노쇼</span>}
                              {isEarlyEnd && <span className="chip-earlyend" style={{flexShrink:0,fontSize:9,fontWeight:500,padding:"1px 4px",borderRadius:4,lineHeight:1.5}}>조기반납</span>}
                              {isDone     && <span className="chip-done"    style={{flexShrink:0,fontSize:9,fontWeight:500,padding:"1px 4px",borderRadius:4,lineHeight:1.5}}>종료</span>}
                              <span style={{fontSize:12,color:"#111",fontWeight:600,
                                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.5}}>{b.title}</span>
                            </div>
                            {/* ← [피그마] 시간 color #64748B → #5E636D Regular */}
                            <div style={{fontSize:12,color:"#5E636D",fontWeight:400,flexShrink:0,lineHeight:1.5,whiteSpace:"nowrap"}}>
                              {fmtTSFull(b.start_at)} - {fmtTSFull(b.end_at)}
                            </div>
                          </div>
                          {/* 2행: 예약자 이름 · 부서 — ← [피그마] 별도 span, 이름 Medium #3A3F4A, 부서 Regular #A2A7B2, gap 4, 중앙점 없음 */}
                          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,lineHeight:1.5}}>
                            <span style={{color:"#3A3F4A",fontWeight:500}}>{b.user}</span>
                            <span style={{color:"#A2A7B2",fontWeight:400}}>{b.dept}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── 버튼 footer ── */}
      {/* ← [피그마] padding 12px 28px 20px → 8, gap 8 → 16, borderTop 제거
          버튼 h:56 radius:16, 닫기 #F1F5F9/#64748B, primary #111/#fff */}
      <div style={{padding:8, flexShrink:0, display:"flex", gap:16}}>
        <button className="btn" onClick={onClose}
          style={{flex:1,height:56,borderRadius:16,background:"#F1F5F9",
            color:"#64748B",fontSize:14,fontWeight:600,border:"none",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          닫기
        </button>
        <button className="btn" onClick={()=>onBook(status)}
          style={{flex:1,height:56,borderRadius:16,background:"#111",
            color:"#fff",fontSize:14,fontWeight:600,border:"none",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          이 회의실 예약하기
        </button>
      </div>
    </div>
    </>
  );
}
