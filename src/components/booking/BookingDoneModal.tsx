/**
 * BookingDoneModal — 예약 완료 확인 모달
 *
 * 예약 생성 직후 나오는 "예약이 완료되었습니다" 확인 화면.
 * 방금 생성한 예약의 요약 정보를 표시 (회의실, 시간, 예약자, 참석자 등).
 *
 * ✅ 변경 이력
 *  - [2026-04-25 피그마 272:769 전면 재적용] UI 디자인 Figma 절대 기준 일치
 *    · 무수정: 모든 로직/props/시그니처 — isPending 분기, P4-A-2 live 조회 패턴 B/C,
 *              체크인 안내 조건(tsDate===todayStr), 메모/참석자 조건부 렌더링
 *    · 헤더: 일러스트 이미지 → 텍스트 only ("예약 완료!" 32px SemiBold + 서브 14px Regular)
 *    · Spacer: 헤더와 정보 영역 사이 60px 흰 영역 신규
 *    · 정보 영역: 회색카드(#F8FAFC) → 0.5px #F1F5F9 구분선 리스트
 *      └ 라벨: 100px width / 16px SemiBold #BCC2CD (기존 11px #94A3B8 + 아이콘에서 변경)
 *      └ 값: 16px Regular #111 (기존 13px SemiBold) — 회의제목만 SemiBold 유지
 *    · 시간 row: duration을 sub 텍스트 → StatusBadge-XS 칩 형태 (border 0.5px #AFAFAF, 11px Medium)
 *    · 회의실 색상: r.color → #111 일반 텍스트 (피그마 스펙)
 *    · 체크인 안내: #FFF7ED+border+Clock → #F0FFCF rounded 10, no icon (피그마 273:891)
 *    · 모달 rounded: 16 → 24 / Footer: border-top → rounded-bl-br 24
 *    · 신규 의존성 없음 — fmtDateFull / fmtTSRangeFull은 이미 utils/time에 존재
 *    · ⚠️ 미반영: "중요분류" 항목 — Booking 타입에 해당 필드 없음 (별도 협의 필요)
 *
 *  - [2026-04-24 P4-A-2] 예약자·참석자 이름을 snapshot → live 데이터로 전환
 *    · 배경: 팀즈/Azure AD 이름 변경 후 이 모달에 옛 이름이 표시되는 이슈
 *            (예약은 새로 만든 건이지만 방금 저장된 user_name은 이미 snapshot)
 *    · 원인: UserChip/AttendeeChip에 b.user / a.name (snapshot) 직접 전달
 *    · 해결: P4-A-1 DetailModal과 동일 패턴 — users 배열에서 live 조회
 *            · 예약자: users.find(user_id === b.user_id)?.name ?? b.user
 *            · 참석자: users.find(email === a.email)?.name ?? a.name ?? a.email
 *    · Fallback 유지: users 배열에 없는 외부인은 snapshot 표시 (정보 보존)
 *    · 영향: 표시만 변경, 기능 로직 무수정
 */

import { useBreakpoint } from '../../hooks/useBreakpoint'
// ← [2026-04-25] lucide 아이콘 제거 (피그마 디자인은 라벨 옆 아이콘 없음)
// ← [2026-04-25] time.ts import 정리 — 신규 디자인에서 실제 사용하는 함수만
import { todayStr, tsDate, tsMin, fmtDateFull, fmtTSRangeFull, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
import { UserChip } from '../common/UserChip'
import { AttendeeChip } from '../common/AttendeeChip'
import { Button } from '../common/Button' 

export function BookingDoneModal({booking:b, onClose, rooms:rp=[], users:up=[]}) {
  const { isMobile } = useBreakpoint();
  const r = rp.find(r=>r.room_id===b.room_id);
  const floor = getFloor(r?.floor_id);
  const isPending = b.status === 'pending' || r?.is_admin_only

  // ← [2026-04-25] duration 분 → "N시간 M분" 텍스트 (피그마 272:810 StatusBadge-XS chip 표시용)
  //   엣지: 0시간일 때 "M분", M=0일 때 "N시간", 둘 다일 때 "N시간 M분"
  const durMin = tsMin(b.end_at) - tsMin(b.start_at)
  const durHours = Math.floor(durMin / 60)
  const durMins = durMin % 60
  const durText = durHours > 0
    ? (durMins > 0 ? `${durHours}시간 ${durMins}분` : `${durHours}시간`)
    : `${durMins}분`

  // ← [2026-04-25 피그마 272:876 외] 0.5px #F1F5F9 구분선 row 공통 스타일
  //   `as const`로 literal 타입 고정 → React.CSSProperties union과 정확히 매칭
  const rowStyle = {
    padding: '10px 0',
    borderBottom: '0.5px solid #F1F5F9',
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
  } as const
  // ← 라벨 100px 고정 / 16px SemiBold #BCC2CD (피그마)
  const labelStyle = {
    width: 100,
    flexShrink: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#BCC2CD',
    lineHeight: 1.5,
  } as const
  // ← 값 16px Regular #111 / flex로 남은 공간 채움 (회의제목만 SemiBold override)
  const valueStyle = {
    fontSize: 16,
    fontWeight: 400,
    color: '#111',
    lineHeight: 1.5,
    flex: 1,
    minWidth: 0,
    wordBreak: 'break-word',
  } as const

  return (
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [2026-04-25 피그마] 16 → 24
      width:"100%", maxWidth: isMobile?"100%":460,
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column", overflow:"hidden",
      alignSelf: isMobile?"flex-end":"center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── 헤더 ──   ← [2026-04-25 피그마 272:770]
            padding 16/20, gap 8, 32px SemiBold "예약 완료!" + 14px Regular 서브 */}
      <div style={{
        padding: isMobile ? "24px 20px 16px" : "16px 20px",
        background: "#fff",
        flexShrink: 0,
      }}>
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          <div style={{
            fontSize: isMobile ? 24 : 32, // ← 모바일은 가독성 위해 24
            fontWeight: 600, color: "#111", lineHeight: 1.5,
          }}>
            {/* ← [무수정 보존] isPending 분기 (status==='pending' || is_admin_only) */}
            {isPending ? '승인 요청 완료!' : '예약 완료!'}
          </div>
          <div style={{fontSize:14, fontWeight:400, color:"#111", lineHeight:1.5}}>
            {isPending ? '승인이 요청되었습니다. 관리자 승인 후 확정됩니다.' : '예약이 성공적으로 등록되었습니다.'}
          </div>
        </div>
      </div>

      {/* ── Spacer ──   ← [2026-04-25 피그마 273:900] 헤더와 정보영역 사이 60px 흰 영역 */}
      <div style={{height: isMobile ? 24 : 60, background:"#fff", flexShrink:0}}/>

      {/* ── Hero: 정보 리스트 ──   ← [2026-04-25 피그마 272:785]
            0.5px #F1F5F9 구분선 row 리스트 (기존 회색 카드 #F8FAFC + 아이콘 라벨 폐기) */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "0 20px",
        display: "flex", flexDirection: "column",
      }}>
        {/* 회의제목   ← 값만 SemiBold (피그마 272:881) */}
        <div style={rowStyle}>
          <div style={labelStyle}>회의제목</div>
          <div style={{...valueStyle, fontWeight:600}}>{b.title}</div>
        </div>

        {/* 회의실   ← [2026-04-25] 색상 토큰 r.color 제거 → 피그마 #111 일반 텍스트로 통일 */}
        <div style={rowStyle}>
          <div style={labelStyle}>회의실</div>
          <div style={valueStyle}>{r?.room_name}</div>
        </div>

        {/* 위치 */}
        <div style={rowStyle}>
          <div style={labelStyle}>위치</div>
          <div style={valueStyle}>{floor?.floor_name ?? ''}</div>
        </div>

        {/* 날짜   ← [2026-04-25] tsDate 슬라이스("YYYY-MM-DD") → fmtDateFull로 "YYYY년 M월 D일" 표기 */}
        <div style={rowStyle}>
          <div style={labelStyle}>날짜</div>
          <div style={valueStyle}>{fmtDateFull(tsDate(b.start_at))}</div>
        </div>

        {/* 시간 + duration chip   ← [2026-04-25 피그마 272:810 StatusBadge-XS]
              border 0.5px #AFAFAF / rounded 4 / padding 4·7 / 11px Medium #AFAFAF */}
        <div style={rowStyle}>
          <div style={labelStyle}>시간</div>
          <div style={{...valueStyle, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
            <span>{fmtTSRangeFull(b.start_at, b.end_at)}</span>
            <span style={{
              border: "0.5px solid #AFAFAF", borderRadius: 4,
              padding: "4px 7px",
              fontSize: 11, fontWeight: 500, color: "#AFAFAF",
              lineHeight: 1, whiteSpace: "nowrap",
            }}>{durText}</span>
          </div>
        </div>

        {/* 메모 (조건부)   ← [무수정 보존] b.memo && 조건 / alignItems flex-start (긴 메모 줄바꿈 대응) */}
        {b.memo && (
          <div style={{...rowStyle, alignItems:"flex-start"}}>
            <div style={labelStyle}>메모</div>
            <div style={{...valueStyle, whiteSpace:"pre-wrap"}}>{b.memo}</div>
          </div>
        )}

        {/* 예약자   ← [2026-04-24 P4-A-2 무수정 보존] live 패턴 C — users.find(user_id) */}
        {(()=>{
          const owner = (up as any[]).find(u => u.user_id === b.user_id)
          return (
            <div style={rowStyle}>
              <div style={labelStyle}>예약자</div>
              <div style={{...valueStyle, display:"flex", alignItems:"center"}}>
                {/* ← [P4-A-2] name={owner?.name ?? b.user} — profiles.name 라이브 우선, snapshot fallback
                       ← [2026-04-25] dept prop 추가 — 피그마 272:826 "Management Support" 부서 표시 */}
                <UserChip
                  name={owner?.name ?? b.user}
                  avatarUrl={owner?.avatar_url ?? null}
                  variant="md"
                  userInfo={owner}
                  dept={owner?.dept ?? b.dept}
                />
              </div>
            </div>
          )
        })()}

        {/* 참석자 (조건부)   ← [2026-04-24 P4-A-2 무수정 보존] live 패턴 B — users.find(email)
              ← [2026-04-25] 마지막 row이므로 borderBottom: 'none' 처리, alignItems flex-start */}
        {b.attendees && b.attendees.length > 0 && (
          <div style={{...rowStyle, alignItems:"flex-start", borderBottom:"none"}}>
            <div style={labelStyle}>참석자</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:"8px 14px", flex:1, minWidth:0}}>
              {b.attendees.map((a, idx) => {
                const u = (up as any[]).find(u => u.email === a.email)
                return (
                  // ← [P4-A-2] name={u?.name ?? a.name ?? a.email} — 1순위 live, 2순위 snapshot, 3순위 email
                  <AttendeeChip
                    key={a.email || idx}
                    name={u?.name ?? a.name ?? a.email}
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

      {/* ── 체크인 안내 ──   ← [2026-04-25 피그마 273:891]
            #F0FFCF rounded 10 padding 12, no icon, no border (기존 #FFF7ED + Clock 폐기)
            ← [무수정 보존] tsDate(b.start_at)===todayStr() 조건 — 오늘 시작 예약에만 표시 */}
      {tsDate(b.start_at)===todayStr() && (
        <div style={{padding: 10, background:"#fff", flexShrink:0}}>
          <div style={{
            background: "#F0FFCF", borderRadius: 10, padding: 12,
            display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
            gap: 4,
            fontSize: 12, color: "#000", lineHeight: 1.5,
          }}>
            <div style={{display:"flex", alignItems:"center", gap:4}}>
              <span style={{fontWeight:500}}>회의 시작 후</span>
              <span style={{fontWeight:700}}>{CHECKIN_WINDOW_MIN}분 이내</span>
              <span style={{fontWeight:500}}>체크인이 필요합니다.</span>
            </div>
            <span style={{fontWeight:500}}>체크인 하지 않으면 자동취소 됩니다.</span>
          </div>
        </div>
      )}

      {/* ── Footer ──   ← [2026-04-25 피그마 272:869]
            border-top 제거 → 모달 하단 corner rounded 24 적용, padding 8 (모바일은 safe area) */}
      <div style={{
        padding: isMobile ? "8px 20px 24px" : 8,
        background: "#fff",
        borderRadius: isMobile ? 0 : "0 0 24px 24px",
        flexShrink: 0,
      }}>
        <Button variant="primary" size="lg" fullWidth onClick={onClose}>확인</Button>
      </div>
    </div>
  );
}


// ─── Recur Done Modal ─────────────────────────────────────────────────────────
