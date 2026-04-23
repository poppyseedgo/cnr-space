import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { todayStr, nowMinutes, tsDate, tsMin, fmtTSFull, fmtTSDateFull, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'

import { AttendeeChip } from '../common/AttendeeChip'
import { UserChip } from '../common/UserChip'
import { BookingStatusBadge } from '../common/BookingStatusBadge'
import { MetaBadge } from '../common/MetaBadge'
import { Button } from '../common/Button'
import { ModalCloseButton } from '../common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화

/**
 * BookingDetailModal (export name: DetailModal)
 *
 * ✅ 변경 이력
 *  - [2026-04-22 피그마 UI 재구성] Figma node 180:534 절대 기준 적용 (로직 무수정)
 *    · 헤더: 사각 상태칩(chip--square, radius 8) + 제목 21px SemiBold
 *    · 정보 리스트: 카드형(#F8FAFC) → 0.5px #F1F5F9 구분선형
 *        회의실(room_name만) / 위치(floor) / 날짜 / 시간(+소요시간 칩) / 메모(있을 때만)
 *        / 예약자(아바타+이름+부서) / 참석자(2-grid 아바타+이름)
 *    · 에메랄드룸 전용 알림박스(bg #E6FFB0, rounded 12, padding 8·12, min-h 62) Hero 하단 배치
 *    · 모달 radius 16→24, Footer padding 8·gap 16·버튼 height 56·radius 16 (Button lg 공통 반영분 활용)
 *    · 공통 컴포넌트 수정: chip-mine 피그마화(0.5px 검정 테두리),
 *      chip--square modifier 신설, UserAvatar 기본값(#000/#E7E7E7/fw 500),
 *      UserChip md(24/gap 7, dept prop 지원), AttendeeChip 평문화(조회 모드)
 *    · 로직 완전 보존: 버튼 분기 전체(isAdmin/isOwner/showRejectInput/adminCanApprove 등)
 *      /메모 표시 조건/props 시그니처 전부 원본 그대로
 */

// ── 시간 소요 포맷터 (피그마 180:534 '1시간 15분' 칩) ─────────────────────────
// 순수 표시 유틸 — 기능 로직 아님. utils에 의존하지 않도록 파일 로컬 함수로 정의.
function fmtDuration(startISO: string, endISO: string): string {
  const diffMin = tsMin(endISO) - tsMin(startISO)
  if (diffMin <= 0) return ''
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  if (h > 0 && m > 0) return `${h}시간 ${m}분`
  if (h > 0)          return `${h}시간`
  return `${m}분`
}

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
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [피그마] 16 → 24
      width:"100%", maxWidth: isMobile ? "100%" : 460,
      minHeight: isMobile ? undefined : 460, // ← [2026-04-24] 500 → 460 (요청 반영)
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── Header [피그마] padding 16/20, gap 8(배지↔제목), border-bottom 제거 ── */}
      <div style={{padding: isMobile ? "20px 20px 14px" : "16px 20px", flexShrink:0}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12}}>
          <div style={{flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:8 /* ← [피그마] 배지↔제목 gap 8 */}}>
            {/* ← [피그마] 사각 상태칩: shape='square' 로 BookingStatusBadge 전체에 chip--square 적용 */}
            <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} currentUser={currentUser} shape="square" />
            {/* ← [피그마] 제목 21px SemiBold #111 */}
            <div style={{fontSize: isMobile ? 18 : 21, fontWeight:600, color:"#111", lineHeight:1.5, wordBreak:"break-word"}}>{b.title}</div>
            {/* ← [P2 v7] 반복/참석자 메타 뱃지 — 피그마엔 없지만 기능(정보성) 유지. 스크린샷에 노출 안 되더라도 로직 보존 */}
            {b.recurGroupId && (
              <div><MetaBadge type="recurring" size="sm" /></div>
            )}
            {b.user !== currentUser && b.attendees?.some((a: any) => a.name === currentUser) && (
              <div><MetaBadge type="guest" size="sm" /></div>
            )}
          </div>
          {/* ← [피그마 2026-04-22] Close 공통 컴포넌트로 교체 */}
          <ModalCloseButton onClick={onClose} />
        </div>
      </div>

      {/* ── Body (Hero) [피그마] padding 20, gap 16 ──
          ← [2026-04-24] padding-bottom 16 → 60 (본문-버튼 사이 여유 공간 확대) */}
      <div style={{padding: isMobile ? "0 20px 60px" : "0 20px 60px", overflowY:"auto", flex:1,
        display:"flex", flexDirection:"column", gap:16}}>

        {/* ── 정보 리스트: 0.5px #F1F5F9 구분선형 (피그마) ── */}
        <div style={{display:"flex", flexDirection:"column"}}>
          {/* 회의실 — room_name만 (capacity 제거) */}
          <InfoRow label="회의실" value={r?.room_name ?? '-'} />
          {/* 위치 — floor */}
          <InfoRow label="위치" value={floor?.floor_name ?? '-'} />
          {/* 날짜 ← [2026-04-22 HOTFIX] fmtDateFull(b.start_at)은 'YYYY-MM-DD' 문자열을 기대하는데
                 b.start_at은 timestamp ISO라 파싱 실패 → 'NaN년 NaN월 NaN일' 표시.
                 fmtTSDateFull(내부에서 tsDate로 KST 날짜 추출 후 포맷) 사용. */}
          <InfoRow label="날짜" value={fmtTSDateFull(b.start_at)} />
          {/* 시간 + 소요시간 칩 */}
          <InfoRow
            label="시간"
            value={
              b.earlyEnded && b.originalEndAt ? (
                <span style={{display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
                  <span style={{color:"#94A3B8", textDecoration:"line-through"}}>
                    {fmtTSFull(b.start_at)} – {fmtTSFull(b.originalEndAt)}
                  </span>
                  <span>{fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}</span>
                  <span className="chip chip--xs" style={{border:"0.5px solid #7C3AED", color:"#7C3AED", background:"transparent", fontWeight:500}}>조기반납</span>
                </span>
              ) : (
                <span style={{display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
                  <span>{fmtTSFull(b.start_at)} – {fmtTSFull(b.end_at)}</span>
                  {/* ← [피그마 191:375] 소요시간 칩: border 0.5px #AFAFAF, text 9px Medium #AFAFAF, radius 4 */}
                  <span className="chip chip--xs" style={{border:"0.5px solid #AFAFAF", color:"#AFAFAF", background:"transparent", fontWeight:500}}>
                    {fmtDuration(b.start_at, b.end_at)}
                  </span>
                </span>
              )
            }
          />
          {/* 메모 — 있을 때만 (피그마 스크린샷 지시) */}
          {b.memo && (
            <InfoRow label="메모" value={b.memo} alignTop />
          )}
          {/* 예약자 — 아바타+이름+부서 (UserChip dept prop) */}
          {(()=>{
            const owner = (up as any[]).find((u:any) => u.user_id === b.user_id)
            return (
              <InfoRow
                label="예약자"
                value={
                  <UserChip
                    name={b.user}
                    avatarUrl={owner?.avatar_url ?? null}
                    variant="md"
                    userInfo={owner}
                    dept={owner?.dept ?? b.dept}
                  />
                }
              />
            )
          })()}
          {/* 참석자 — 2-grid (피그마 repeat(2, fit-content), gap 10)
              ← [2026-04-23] 1열 무너짐 버그 수정 (근본 원인):
                 · 기존: `flex: 1` 이 grid 컨테이너에 있어 부모가 flex가 아닌데도
                   flex-basis 0% 해석 + minmax(0, 1fr) 조합으로 cell이 0까지 축소돼
                   2열이 시각적으로 무너짐
                 · 변경: flex 제거 + width 100% 명시 → grid가 부모 전체 폭을 사용
                 · 효과: 일반 짧은 이름은 2열로 정상 배치
                         긴 이름(셀 폭 초과) 시에만 ellipsis 처리
                         필요 시 auto-fit으로 추가 반응형 전환 가능 */}
          {b.attendees && b.attendees.length > 0 && (
            <InfoRow
              label="참석자"
              alignTop
              value={
                <div style={{
                  display:"grid",
                  gridTemplateColumns:"repeat(2, minmax(0, 1fr))",
                  columnGap:10, rowGap:10,
                  width:"100%",     // ← [2026-04-23] flex:1 제거 + width 100% 명시
                }}>
                  {b.attendees.map((a:any, idx:number) => {
                    const u = (up as any[]).find((u:any) => u.email === a.email)
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
              }
            />
          )}
          {/* 거절 사유 — 있을 때만 (기능 유지) */}
          {(b as any).reject_reason && (
            <InfoRow
              label="거절 사유"
              alignTop
              value={<span style={{color:"#DC2626", wordBreak:"break-word"}}>{(b as any).reject_reason}</span>}
            />
          )}
        </div>

        {/* ── 에메랄드룸 알림박스 [피그마 189:346] bg #E6FFB0, rounded 12, padding 8·12, min-h 62 ──
            ← [2026-04-23] 노출 조건 타이트닝 (근본 원인 해결)
            기존: r?.is_admin_only (에메랄드룸이면 승인 완료/취소/거절된 건에도 계속 노출됨)
            변경: 에메랄드룸 AND status='pending' AND !autoCancelled
                  · 승인완료(confirmed) → 숨김 ✅
                  · 거절(rejected)      → 숨김 ✅
                  · 관리자 취소(admin cancel) → 숨김 ✅
                  · 기한초과 만료(pending+autoCancelled) → 숨김 ✅
                  · 승인 대기 중인 pending만 노출 */}
        {r?.is_admin_only && b.status === 'pending' && !b.autoCancelled && (
          <div style={{background:"#E6FFB0", borderRadius:12, padding:"8px 12px", minHeight:62,
            display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"flex-start"}}>
            <p style={{fontSize:12, fontWeight:500, color:"#000", lineHeight:1.5, margin:0}}>
              관리자 승인 후 예약이 확정됩니다
            </p>
          </div>
        )}

        {/* ── 미체크인 경고 (기능 유지) ── */}
        {nci && (
          <div style={{background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, padding:"10px 14px",
            fontSize:12, color:"#92400E", display:"flex", alignItems:"flex-start", gap:6}}>
            <AlertTriangle size={14} strokeWidth={1.8} style={{flexShrink:0, marginTop:1}}/>
            <span>회의 시작 후 <strong>{CHECKIN_WINDOW_MIN}분 이내</strong> 체크인 필요</span>
          </div>
        )}
      </div>
      {/* 버튼 영역 - 항상 하단 고정 */}
      {(()=>{
        const btnWrap = (children: React.ReactNode) => (
          // ← [2026-04-24] 버튼 간격 gap 16 → 8 (요청: 간격 축소)
          <div style={{padding: isMobile?"8px 20px 24px":8, display:"flex", gap:8, flexShrink:0}}>
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
              <div style={{padding: isMobile?"8px 20px 0":"8px 20px 0"}}>
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

// ─── InfoRow 헬퍼 ──────────────────────────────────────────────────────────────
// 피그마 180:534 정보 리스트 1행 (0.5px #F1F5F9 구분선, padding 10 0)
//   · 라벨: 16px SemiBold #96A0B3, width 100px 고정 (모바일은 auto)
//   · 값:   16px Regular #111 (line-height 1.5)
//   · alignTop: true → align-items flex-start (참석자/메모 처럼 여러 줄)
interface InfoRowProps {
  label:     string
  value:     React.ReactNode
  alignTop?: boolean
}
function InfoRow({ label, value, alignTop = false }: InfoRowProps) {
  return (
    <div style={{
      padding:      "10px 0",
      borderBottom: "0.5px solid #F1F5F9",
      display:      "flex",
      alignItems:   alignTop ? "flex-start" : "center",
      width:        "100%",
    }}>
      <div style={{
        fontSize:   16,
        fontWeight: 600,
        color:      "#96A0B3",
        width:      100,
        flexShrink: 0,
        lineHeight: 1.5,
      }}>{label}</div>
      <div style={{
        fontSize:   16,
        fontWeight: 400,
        color:      "#111",
        lineHeight: 1.5,
        flex:       1,
        minWidth:   0,
        wordBreak:  "break-word",
      }}>{value}</div>
    </div>
  )
}

// ─── Booking Done Modal ────────────────────────────────────────────────────────
