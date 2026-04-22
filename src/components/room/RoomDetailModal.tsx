import { useState } from 'react'
import { Circle, X } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsMin, fmtTimeFull, fmtTSFull, getRoomStatus } from '../../utils/time'
import { getFloor } from '../../data/floors'
import { Button } from '../common/Button'
import { RoomStatusBadge } from '../common/RoomStatusBadge'  // ← [신규] 공통 상태 뱃지 사용
import { ModalCloseButton } from '../common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화

/**
 * RoomDetailModal
 *
 * ✅ 변경 이력
 *  - [2026-04-22 피그마 전면 재적용] Figma node 177:346 절대 기준 적용 (로직 무수정)
 *    · 피그마 수치 그대로 적용: Modal rounded 24, Header padding 16/20, 타이틀 24px, 서브 14px #6A7282,
 *      썸네일 rounded 16, 정보 리스트 0.5px 구분선형, 승인안내박스 rounded 12/bg #E6FFB0,
 *      예약카드 bg #F6F9FF/padding 10·12/rounded 10, 카드 상태칩 XS 9px/rounded 4,
 *      Footer padding 8/gap 16/버튼 height 56 rounded 16.
 *    · 공통 컴포넌트도 피그마 기준으로 동시 수정: Button lg(height 56/radius 16), .chip--xs(9px/radius 4).
 *    · 로직 완전 보존: todayBks 필터/상태 판정(isActive/isPending/isExpired/isNoshow/isEarlyEnd/isDone)/
 *      BUSY·SOON·AVAILABLE 분기/lightbox/props 시그니처 전부 원본 그대로.
 *  - [2026-04-18 스타일 정리] 헤더 상태 chip을 인라인 하드코딩 → RoomStatusBadge로 교체
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
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [피그마] 24
      width:"100%", maxWidth: isMobile ? "100%" : 760, // ← [피그마] 760
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── 헤더 바 ── [피그마] padding 16/20, align-items flex-start, border-bottom 제거 */}
      <div style={{padding: isMobile ? "20px 20px 14px" : "16px 20px",
        display:"flex", justifyContent:"space-between",
        alignItems:"flex-start", flexShrink:0}}>
        <div style={{flex:1,minWidth:0, display:"flex", flexDirection:"column", gap:4 /* ← [피그마] 타이틀↔서브 gap 4 */}}>
          <div style={{display:"flex",alignItems:"center",gap:8 /* ← [피그마] 타이틀↔칩 gap 8 */,flexWrap:"wrap"}}>
            {/* ← [피그마] 타이틀 24px SemiBold #111 */}
            <div style={{fontSize: isMobile ? 20 : 24, fontWeight:600, color:"#111", lineHeight:1.5}}>{r.room_name}</div>
            <RoomStatusBadge status={status} isAdminRoom={!!r.is_admin_only} />
          </div>
          {/* ← [피그마] 서브타이틀 14px Regular #6A7282 — room_name_ko 한글명만 표시 (층은 정보 리스트에 있음) */}
          <div style={{fontSize:14, fontWeight:400, color:"#6A7282", lineHeight:1.5}}>
            {r.room_name_ko ?? ''}
          </div>
        </div>
        {/* ← [피그마 2026-04-22] Close 공통 컴포넌트로 교체 (ModalCloseButton md = 32×32 / 아이콘 20) */}
        <ModalCloseButton onClick={onClose} />
      </div>

      {/* ── 본문: 데스크톱 2컬럼 / 모바일 1컬럼 ── */}
      <div style={{flex:1, overflowY:"auto"}}>
        <div style={{
          display: isMobile ? "flex" : "grid",
          gridTemplateColumns: isMobile ? undefined : "1fr 1fr",
          flexDirection: isMobile ? "column" : undefined,
          gap: 0,
        }}>

          {/* ── LEFT: 썸네일 + 기본 정보 ── [피그마] padding 16, gap 16 */}
          <div style={{
            padding: isMobile ? "16px 20px" : 16,
            borderRight: isMobile ? "none" : "1px solid #F1F5F9",
            display:"flex", flexDirection:"column", gap:16,
          }}>
            {/* 썸네일 ← [피그마] rounded 16 */}
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

            {/* 기본 정보 ← [피그마] 카드형 폐기, 0.5px #F1F5F9 구분선 리스트형 / padding 4·8 */}
            <div style={{display:"flex",flexDirection:"column",padding:"8px 4px"}}>
              {[
                ["위치", floor?.floor_name ?? ""],
                ["수용인원", `${r.capacity}명`],
              ].map(([label,val],i)=>(
                <div key={i} style={{
                  padding:"10px 0",
                  borderBottom:"0.5px solid #F1F5F9",
                  display:"flex", alignItems:"center", width:"100%",
                }}>
                  {/* ← [피그마] 라벨 14px SemiBold #96A0B3 / width 64 고정 */}
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,lineHeight:1.5}}>{label}</div>
                  {/* ← [피그마] 값 14px Regular #111 */}
                  <div style={{fontSize:14,color:"#111",fontWeight:400,lineHeight:1.5}}>{val}</div>
                </div>
              ))}
              {r.notes && (
                <div style={{
                  padding:"10px 0",
                  borderBottom:"0.5px solid #F1F5F9",
                  display:"flex", alignItems:"flex-start", width:"100%",
                }}>
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,lineHeight:1.5}}>설명</div>
                  <div style={{fontSize:14,color:"#111",fontWeight:400,wordBreak:"break-word",flex:1,lineHeight:1.5}}>{r.notes}</div>
                </div>
              )}
              {features.length>0 && (
                <div style={{
                  padding:"10px 0",
                  borderBottom:"0.5px solid #F1F5F9",
                  display:"flex", alignItems:"center", width:"100%",
                }}>
                  <div style={{fontSize:14,color:"#96A0B3",width:64,fontWeight:600,flexShrink:0,lineHeight:1.5}}>설비</div>
                  <div style={{fontSize:14,color:"#111",fontWeight:400,lineHeight:1.5}}>
                    {features.map(f=>f.value_text||f.feature_name).join(", ")}
                  </div>
                </div>
              )}
              {/* ← [피그마 재배치] 관리자 전용 안내는 Hero Right 최상단 알림박스로 이전 (hero.right 참고) */}
            </div>
          </div>

          {/* ── RIGHT: 상태 + 오늘 예약 현황 ── [피그마] padding 16, gap 24 */}
          <div style={{
            padding: isMobile ? "0 20px 16px" : 16,
            display:"flex", flexDirection:"column", gap:24,
          }}>
            {/* ← [피그마 196:1077 신규] 에메랄드(관리자 전용) 룸 알림박스: bg #E6FFB0, rounded 12, padding 8·12, min-height 62, 12px Medium #000 */}
            {r.is_admin_only && (
              <div style={{background:"#E6FFB0", borderRadius:12, padding:"8px 12px", minHeight:62,
                display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"flex-start"}}>
                <p style={{fontSize:12, fontWeight:500, color:"#000", lineHeight:1.5, margin:0}}>
                  관리자 승인 후 예약이 확정됩니다
                </p>
              </div>
            )}

            {/* ← [피그마] 상단 상태박스: padding 8·12, rounded 12 / 폰트 12px (색상은 상태별 유지) */}
            {status.type==="BUSY" && (
              <div style={{background:"#FEF2F2",borderRadius:12,padding:"8px 12px"}}>
                <div style={{fontSize:11,color:"#DC2626",fontWeight:600,marginBottom:4,lineHeight:1.5}}>현재 사용 중</div>
                <div style={{fontSize:12,color:"#111",fontWeight:600,lineHeight:1.5}}>{status.booking?.title}</div>
                <div style={{fontSize:11,color:"#64748B",marginTop:2,lineHeight:1.5}}>{fmtTimeFull(status.endTime)}까지 · {status.minsLeft}분 남음</div>
              </div>
            )}
            {status.type==="SOON" && (
              <div style={{background:"#FFFBEB",borderRadius:12,padding:"8px 12px"}}>
                <div style={{fontSize:11,color:"#D97706",fontWeight:600,marginBottom:4,lineHeight:1.5}}>사용 예정</div>
                <div style={{fontSize:12,color:"#111",fontWeight:600,lineHeight:1.5}}>{status.minsUntil}분 후 사용 시작</div>
                <div style={{fontSize:11,color:"#64748B",marginTop:2,lineHeight:1.5}}>{fmtTimeFull(status.nextStart)} 부터</div>
              </div>
            )}
            {status.type==="AVAILABLE" && (
              <div style={{background:"#E8F4FF",borderRadius:12,padding:"8px 12px"}}>
                <div style={{fontSize:11,color:"#0369A1",fontWeight:600,marginBottom:2,lineHeight:1.5}}>예약 가능</div>
                <div style={{fontSize:12,color:"#111",fontWeight:500,lineHeight:1.5}}>지금 바로 이용 가능합니다</div>
              </div>
            )}

            {/* 오늘 예약 현황 */}
            <div>
              {/* ← [피그마] 섹션 타이틀 래퍼 padding 12 0, gap 8 / 타이틀 14px SemiBold #000 */}
              <div style={{padding:"12px 0", display:"flex",alignItems:"center",gap:8, marginBottom:0}}>
                <span style={{fontSize:14,fontWeight:600,color:"#000",lineHeight:1.5}}>오늘 예약 현황</span>
                {/* ← [피그마] 카운트 뱃지: bg #000, rounded 8, padding 4·8, 10px Medium #FFF */}
                <span style={{fontSize:10,color:"#fff",fontWeight:500,background:"#000",
                  borderRadius:8,padding:"4px 8px",lineHeight:1}}>{todayBks.length}건</span>
              </div>
              {todayBks.length===0
                ? <div style={{background:"#F8FAFC",borderRadius:10,padding:"20px",
                    textAlign:"center",fontSize:12,color:"#CBD5E1"}}>
                    오늘 예약이 없습니다
                  </div>
                : <div style={{display:"flex",flexDirection:"column",gap:8 /* ← [피그마] gap 8 */}}>
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
                      const dimmed     = isNoshow || isExpired || isDone; // ← 흐리게 표시

                      // ← 상태별 카드 배경색 (로직 유지) — 기본(none)만 피그마 #F6F9FF로 교체
                      const cardBg = isActive   ? "#FFF1F2"
                                   : isPending  ? "#FFFBEB"
                                   : isEarlyEnd ? "#F0F9FF"
                                   : "#F6F9FF"; // ← [피그마] 기본 카드 bg
                      const cardBorder = isActive   ? "1px solid #FECDD3"
                                       : isPending  ? "1px solid #FEF3C7"
                                       : isEarlyEnd ? "1px solid #BAE6FD"
                                       : "1px solid transparent";
                      const hoverBg   = isActive   ? "#FFE4E6"
                                      : isPending  ? "#FEF9C3"
                                      : isEarlyEnd ? "#E0F2FE"
                                      : "#EEF3FF";

                      return (
                        <div key={b.id} style={{
                          background: cardBg,
                          border: cardBorder,
                          borderRadius:10, padding:"10px 12px", // ← [피그마] padding 10·12
                          display:"flex", flexDirection:"column", gap:8, // ← [피그마] 카드 내부 세로 gap 8
                          cursor:"pointer",
                          opacity: dimmed ? 0.5 : 1,
                        }}
                          onClick={()=>onDetail&&onDetail(b)}
                          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=hoverBg}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=cardBg}}
                        >
                          {/* ── Line1: 상태칩 + 제목  |  시간 ── [피그마] space-between */}
                          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", gap:8}}>
                            <div style={{display:"flex", alignItems:"center", gap:8 /* ← [피그마] 칩↔제목 gap 8 */, flex:1, minWidth:0}}>
                              {/* ← 상태칩 XS (tokens.css .chip--xs 피그마 반영분 자동 적용) */}
                              {isActive   && <span style={{width:7,height:7,borderRadius:"50%",background:"#E11D48",display:"inline-block",flexShrink:0}}/>}
                              {isPending  && <span className="chip chip--xs chip-pending"  style={{flexShrink:0}}>승인대기</span>}
                              {isExpired  && <span className="chip chip--xs chip-expired"  style={{flexShrink:0}}>기한초과</span>}
                              {isNoshow   && <span className="chip chip--xs chip-noshow"   style={{flexShrink:0}}>노쇼</span>}
                              {isEarlyEnd && <span className="chip chip--xs chip-earlyend" style={{flexShrink:0}}>조기반납</span>}
                              {isDone     && <span className="chip chip--xs chip-done"     style={{flexShrink:0}}>사용완료</span>}
                              {/* ← [피그마] 제목 12px SemiBold #111 */}
                              <span style={{fontSize:12, fontWeight:600, color:"#111", lineHeight:1.5,
                                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{b.title}</span>
                            </div>
                            {/* ← [피그마] 시간 12px Regular #5E636D */}
                            <div style={{fontSize:12, fontWeight:400, color:"#5E636D", lineHeight:1.5, flexShrink:0, whiteSpace:"nowrap"}}>
                              {fmtTSFull(b.start_at)} - {fmtTSFull(b.end_at)}
                            </div>
                          </div>

                          {/* ── Line2: 이름 · 부서 ── [피그마] gap 4 */}
                          <div style={{display:"flex", alignItems:"center", gap:4, lineHeight:1.5}}>
                            {/* ← [피그마] 이름 11px Medium #3A3F4A */}
                            <span style={{fontSize:11, fontWeight:500, color:"#3A3F4A"}}>{b.user}</span>
                            {/* ← [피그마] 부서 11px Regular #A2A7B2 */}
                            <span style={{fontSize:11, fontWeight:400, color:"#A2A7B2"}}>{b.dept}</span>
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

      {/* ── 버튼 footer ── [피그마] padding 8, gap 16, border-top 제거
              · Button 공통 컴포넌트의 lg 사이즈가 이미 피그마 스펙(height 56 / radius 16 / padding 16 0)으로 반영됨 */}
      <div style={{padding: isMobile ? "8px 20px 24px" : 8,
        flexShrink:0, display:"flex", gap:16}}>
        <Button variant="ghost"   flex onClick={onClose}>닫기</Button>
        <Button variant="primary" flex onClick={()=>onBook(status)}>이 회의실 예약하기</Button>
      </div>
    </div>
    </>
  );
}
