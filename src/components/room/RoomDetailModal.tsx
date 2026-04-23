import { useState } from 'react'
import { Circle, X } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsMin, fmtTimeFull, fmtTSFull, getRoomStatus } from '../../utils/time'
import { getFloor } from '../../data/floors'
import { Button } from '../common/Button'
import { RoomStatusBadge } from '../common/RoomStatusBadge'  // ← [신규] 공통 상태 뱃지 사용

/**
 * RoomDetailModal
 *
 * ✅ 변경 이력
 *  - [2026-04-18 스타일 정리] 헤더 상태 chip을 인라인 하드코딩 → RoomStatusBadge로 교체
 *    · 이유: tokens.css 색상과 불일치 (예약가능 text #111 vs 토큰 #0369A1),
 *            공통 컴포넌트 있는데 재구현한 분산 구조 해소
 *    · 효과: HomeView와 RoomDetailModal 간 상태 뱃지 시각·정보 일관성 확보
 *            (체크인 대기/완료, 남은시간 등 풍부한 정보 자동 노출)
 */

export function RoomDetailModal({room:r, bookings, onClose, onBook, onDetail}: {room:any,bookings:any[],onClose:any,onBook:any,onDetail?:any}) {
  const { isMobile } = useBreakpoint();
  const floor    = getFloor(r.floor_id);
  const features = r.features ?? [];
  const today    = todayStr();
  // ← [2026-04-23 HOTFIX] '오늘 예약 현황' 필터 기준을 status 기반으로 변경
  //   기존: cancelledBy !== 'user' && cancelledBy !== 'admin'
  //         → DB의 cancelled_by=NULL 4건이 통과되어 취소건 표시됨
  //   변경: status='cancelled' 또는 'rejected'를 완전 제외
  //   정책: 오늘 해당 룸의 모든 예약 (노쇼/조기반납/사용완료/pending 포함), 취소/거절만 숨김
  const todayBks = bookings
    .filter(b =>
      b.room_id === r.room_id &&
      tsDate(b.start_at) === today &&
      b.status !== 'cancelled' &&
      b.status !== 'rejected'
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
      borderRadius: isMobile ? "20px 20px 0 0" : 16,
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
      <div style={{padding: isMobile ? "20px 20px 14px" : "18px 28px 14px",
        borderBottom:"1px solid #F1F5F9", display:"flex", justifyContent:"space-between",
        alignItems:"center", flexShrink:0}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
            <div style={{fontSize: isMobile ? 17 : 20, fontWeight:600, color:"#111111"}}>{r.room_name}</div>
            {/* ← [변경] 인라인 chip 3종 → RoomStatusBadge 공통 컴포넌트
                 HomeView와 시각·정보 일관성 확보 (체크인 상태·남은시간 자동 표기) */}
            <RoomStatusBadge status={status} />
          </div>
          <div style={{fontSize:12,color:"#64748B"}}>{r.room_name_ko} · {floor?.floor_name} · {r.capacity}인 수용</div>
        </div>
        <button className="btn" onClick={onClose}
          style={{width:32,height:32,borderRadius:"50%",background:"#F1F5F9",
            color:"#64748B",flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"center"}}><X size={14} strokeWidth={1.8}/></button>
      </div>

      {/* ── 본문: 데스크톱 2컬럼 / 모바일 1컬럼 ── */}
      <div style={{flex:1, overflowY:"auto"}}>
        <div style={{
          display: isMobile ? "flex" : "grid",
          gridTemplateColumns: isMobile ? undefined : "1fr 1fr",
          flexDirection: isMobile ? "column" : undefined,
          gap: 0,
        }}>

          {/* ── LEFT: 썸네일 + 기본 정보 ── */}
          <div style={{
            padding: isMobile ? "16px 20px" : "20px 24px",
            borderRight: isMobile ? "none" : "1px solid #F1F5F9",
            display:"flex", flexDirection:"column", gap:12,
          }}>
            {/* 썸네일 */}
            <div style={{width:"100%", height: isMobile ? 180 : 200, borderRadius:12, overflow:"hidden",
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

            {/* 기본 정보 */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[
                ["수용인원", `${r.capacity}명`],
                ["위치", floor?.floor_name ?? ""],
              ].map(([label,val],i)=>(
                <div key={i} style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>{label}</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600}}>{val}</div>
                </div>
              ))}
              {r.notes && (
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>설명</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600,wordBreak:"break-word"}}>{r.notes}</div>
                </div>
              )}
              {features.length>0 && (
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>설비</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600}}>
                    {features.map(f=>f.value_text||f.feature_name).join(", ")}
                  </div>
                </div>
              )}
              {(r.is_admin_only) && (
                <div style={{background:"#EEF2FF",borderRadius:10,padding:"10px 14px",
                  display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#4338CA",fontWeight:600}}>
                  관리자(Admin) 전용 예약 회의실
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: 상태 + 오늘 예약 현황 ── */}
          <div style={{
            padding: isMobile ? "0 20px 16px" : "20px 24px",
            display:"flex", flexDirection:"column", gap:12,
          }}>
            {status.type==="BUSY" && (
              <div style={{background:"#FEF2F2",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#DC2626",fontWeight:600,marginBottom:6}}>현재 사용 중</div>
                <div style={{fontSize:14,color:"#111111",fontWeight:600}}>{status.booking?.title}</div>
                <div style={{fontSize:12,color:"#64748B",marginTop:4}}>{fmtTimeFull(status.endTime)}까지 · {status.minsLeft}분 남음</div>
              </div>
            )}
            {status.type==="SOON" && (
              <div style={{background:"#FFFBEB",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#D97706",fontWeight:600,marginBottom:6}}>사용 예정</div>
                <div style={{fontSize:14,color:"#111111",fontWeight:600}}>{status.minsUntil}분 후 사용 시작</div>
                <div style={{fontSize:12,color:"#64748B",marginTop:4}}>{fmtTimeFull(status.nextStart)} 부터</div>
              </div>
            )}
            {status.type==="AVAILABLE" && (
              <div style={{background:"#E8F4FF",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#0369A1",fontWeight:600,marginBottom:4}}>예약 가능</div>
                <div style={{fontSize:13,color:"#111111",fontWeight:600}}>지금 바로 이용 가능합니다</div>
              </div>
            )}

            {/* 오늘 예약 현황 */}
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#111111",marginBottom:10,
                display:"flex",alignItems:"center",gap:6}}>
                <span>오늘 예약 현황</span>
                <span style={{fontSize:11,color:"#fff",fontWeight:600,background:"#111",
                  borderRadius:999,padding:"1px 7px"}}>{todayBks.length}건</span>
              </div>
              {todayBks.length===0
                ? <div style={{background:"#F8FAFC",borderRadius:10,padding:"20px",
                    textAlign:"center",fontSize:12,color:"#CBD5E1"}}>
                    오늘 예약이 없습니다
                  </div>
                : <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {todayBks.map(b => {
                      const bNow     = nowMinutes();
                      const startMin = tsMin(b.start_at);
                      const endMin   = tsMin(b.end_at);

                      // ← [P2 v7] 상태 분기 재정리
                      //   기존: isNoshow 판별이 `cancelledBy='system' && !checkedIn`으로
                      //         시간축 없음 → pending_expired도 노쇼로 오분류
                      //   변경: pending_expired 제외하고 '진짜 노쇼'만 isNoshow로 분류
                      //         시각적 뱃지 표시는 BookingStatusBadge 단일 소스 사용
                      const isSystemCancel = b.autoCancelled && b.cancelledBy === 'system'
                                             && b.status !== 'rejected'
                      // 기한초과: status='pending' 유지 OR cancelled지만 시작 후 10분 이내
                      const isExpired  = isSystemCancel
                                         && (b.status === 'pending' || bNow < startMin + 10)
                      const isNoshow   = isSystemCancel && !isExpired
                      const isPending  = !b.autoCancelled && b.status === 'pending';
                      const isEarlyEnd = !b.autoCancelled && b.earlyEnded;
                      const isActive   = !b.autoCancelled && !b.earlyEnded && startMin <= bNow && bNow < endMin;
                      const isDone     = !b.autoCancelled && !b.earlyEnded && endMin <= bNow;
                      // ← [2026-04-23 HOTFIX] dimmed에서 isDone 제외 — 사용완료는 opacity 1로 표시
                      //   기존: isDone도 dimmed 처리되어 사용완료 예약이 흐릿하게 표시됨
                      //   변경: 사용완료도 정상 예약과 동일하게 명확히 보여줌 (기록 가치)
                      const dimmed     = isNoshow || isExpired; // ← 흐리게 표시 (노쇼/기한초과만)

                      // ← 상태별 카드 배경색
                      const cardBg = isActive   ? "#FFF1F2"
                                   : isPending  ? "#FFFBEB"
                                   : isEarlyEnd ? "#F0F9FF"
                                   : "#F8FAFC";
                      const cardBorder = isActive   ? "1px solid #FECDD3"
                                       : isPending  ? "1px solid #FEF3C7"
                                       : isEarlyEnd ? "1px solid #BAE6FD"
                                       : "1px solid transparent";
                      const hoverBg   = isActive   ? "#FFE4E6"
                                      : isPending  ? "#FEF9C3"
                                      : isEarlyEnd ? "#E0F2FE"
                                      : "#F1F5F9";

                      return (
                        <div key={b.id} style={{
                          background: cardBg,
                          border: cardBorder,
                          borderRadius:10, padding:"10px 14px",
                          display:"flex", justifyContent:"space-between", alignItems:"center",
                          cursor:"pointer",
                          opacity: dimmed ? 0.5 : 1,
                        }}
                          onClick={()=>onDetail&&onDetail(b)}
                          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=hoverBg}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=cardBg}}
                        >
                          <div style={{flex:1,minWidth:0,marginRight:10}}>
                            <div style={{fontSize:13,color:"#111111",fontWeight:600,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              display:"flex",alignItems:"center",gap:5}}>
                              {/* ← [P2 v7] 인라인 하드코딩 뱃지 4개 → chip 클래스 통일
                                    · tokens.css 색상 토큰 자동 적용 (노쇼 색상 변경 시 여기도 반영)
                                    · pending_expired와 noshow가 명확히 구분됨 */}
                              {isActive   && <span style={{width:7,height:7,borderRadius:"50%",background:"#E11D48",display:"inline-block",flexShrink:0}}/>}
                              {isPending  && <span className="chip chip--xs chip-pending"  style={{flexShrink:0}}>승인대기</span>}
                              {isExpired  && <span className="chip chip--xs chip-expired"  style={{flexShrink:0}}>기한초과</span>}
                              {isNoshow   && <span className="chip chip--xs chip-noshow"   style={{flexShrink:0}}>노쇼</span>}
                              {isEarlyEnd && <span className="chip chip--xs chip-earlyend" style={{flexShrink:0}}>조기반납</span>}
                              {isDone     && <span className="chip chip--xs chip-done"     style={{flexShrink:0}}>종료</span>}
                              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</span>
                            </div>
                            <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{b.user} · {b.dept}</div>
                          </div>
                          <div style={{fontSize:12,color:"#64748B",fontWeight:600,flexShrink:0,textAlign:"right"}}>
                            {fmtTSFull(b.start_at)}<br/>
                            <span style={{color:"#94A3B8",fontWeight:400}}>~ {fmtTSFull(b.end_at)}</span>
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
      <div style={{padding: isMobile ? "12px 20px 24px" : "12px 28px 20px",
        flexShrink:0, borderTop:"1px solid #F1F5F9", display:"flex", gap:8}}>
        <Button variant="ghost"   flex onClick={onClose}>닫기</Button>
        <Button variant="primary" flex onClick={()=>onBook(status)}>이 회의실 예약하기</Button>
      </div>
    </div>
    </>
  );
}
