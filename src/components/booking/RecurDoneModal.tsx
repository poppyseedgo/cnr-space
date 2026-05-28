/**
 * RecurDoneModal — 반복 예약 생성 완료 모달
 *
 * 반복(매일/매주) 예약 생성 직후 나오는 완료 확인 화면.
 * 방금 생성한 반복 예약들의 요약(회의제목·회의실·위치·시간·생성날짜 전체·메모·예약자·참석자)을 표시.
 *
 * ✅ 변경 이력
 *  - [2026-05-28 피그마 922:1895 전면 재적용] UI 디자인 Figma 절대 기준 일치
 *    · 무수정: 모든 로직/표시조건 — data 구조({bookings, skipped, recur, room, floor}),
 *              skipped 분기, 메모/참석자 조건부 렌더링. onClose 시그니처 불변.
 *    · 신규 의존(표시 전용): users prop 추가 — 예약자/참석자 live 이름·아바타 조회용
 *      (App.tsx에서 이미 보유한 users 배열 전달. BookingDoneModal과 동일 패턴.)
 *    · 헤더: 일러스트 이미지(140x140 jpg) → 텍스트 only
 *      ("반복 예약 완료" 32px SemiBold + 서브 14px Regular, gap 4 / 피그마 922:1897)
 *    · Spacer: 헤더와 정보영역 사이 40px 흰 영역 신규 (피그마 922:1904)
 *    · 정보영역: 회색카드(#F8FAFC)+아이콘 라벨 → 0.5px #F1F5F9 구분선 리스트 (피그마 922:1905)
 *      └ 라벨: 100px width / 16px SemiBold #99A1AF (이 피그마 기준 — BookingDoneModal의 #BCC2CD와 다름)
 *      └ 값: 16px Regular #111 / 회의제목만 SemiBold (피그마 922:1912)
 *    · 행 순서(피그마): 회의제목 → 회의실 → 위치 → 시간(+소요 StatusBadge-XS) → 생성 날짜(여러 줄)
 *                       → 메모(조건부) → 예약자(UserChip) → 참석자(AttendeeChip 조건부)
 *    · 시간: bks[0] 공통 (반복은 날짜만 다름) / 소요시간 칩 border 0.5px #AFAFAF radius 4 11px Medium
 *    · 생성 날짜: 생성된 전체 날짜를 fmtTSDateFullWithDayFull로 "YYYY년 M월 D일 X요일" 한 줄씩 (피그마 922:9203)
 *    · 예약자/참석자: live 조회(users) + snapshot fallback (BookingDoneModal P4-A-2 패턴 동일)
 *    · 충돌 제외(skipped): 피그마엔 별도 박스 없음 → 서브텍스트 하단에 보존 표기(정보 유실 방지)
 *    · 모달 rounded 16 → 24 / Footer: border-top → rounded-bl-br 24, Button primary lg (피그마 922:2007)
 *    · ⚠️ 미반영: 참석자 영역 하단 그라데이션 스크롤힌트(922:9210) — 본문 전체 스크롤 구조와 상이하여 생략
 *               (필요 시 별도 협의)
 */

import { useBreakpoint } from '../../hooks/useBreakpoint'
// ← [2026-05-28] lucide 아이콘 제거 (피그마 922 디자인은 라벨 옆 아이콘 없음)
// ← [2026-05-28] time.ts import 정리 — 신규 디자인에서 실제 사용하는 함수만
import { tsMin, fmtTSRangeFull, fmtTSDateFullWithDayFull } from '../../utils/time'
import { UserChip } from '../common/UserChip'
import { AttendeeChip } from '../common/AttendeeChip'
import { Button } from '../common/Button'

// ← [2026-05-28] users prop 추가 (표시 전용 — 예약자/참석자 live 조회). data 구조/onClose 불변.
export function RecurDoneModal({data, onClose, users:up=[]}) {
  const { isMobile } = useBreakpoint();
  const { bookings: bks, skipped, room: r, floor } = data;
  const first = bks[0];

  // ← [2026-05-28] duration 분 → "N시간 M분" 텍스트 (피그마 922:1941 StatusBadge-XS chip 표시용)
  //   bks는 모두 같은 시간대 (반복은 날짜만 다름) → 첫 건 기준
  const durMin = tsMin(first.end_at) - tsMin(first.start_at)
  const durHours = Math.floor(durMin / 60)
  const durMins = durMin % 60
  const durText = durHours > 0
    ? (durMins > 0 ? `${durHours}시간 ${durMins}분` : `${durHours}시간`)
    : `${durMins}분`

  // ← [2026-05-28 피그마 922:1907 외] 0.5px #F1F5F9 구분선 row 공통 스타일
  const rowStyle = {
    padding: '10px 0',
    borderBottom: '0.5px solid #F1F5F9',
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
  } as const
  // ← 라벨 100px 고정 / 16px SemiBold #99A1AF (피그마 922:1910)
  const labelStyle = {
    width: 100,
    flexShrink: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#99A1AF',
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
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [2026-05-28 피그마] 16 → 24
      width:"100%", maxWidth: isMobile?"100%":460,    // ← row w-420 + px-20*2 = 460 (피그마)
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column", overflow:"hidden",
      maxHeight: isMobile ? "92vh" : "85vh",          // ← 생성 날짜 多건 대비 모달 높이 캡 (본문 스크롤)
      alignSelf: isMobile?"flex-end":"center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── 헤더 ──   ← [2026-05-28 피그마 922:1896]
            padding 16/20, gap 4, 32px SemiBold "반복 예약 완료" + 14px Regular 서브 */}
      <div style={{
        padding: isMobile ? "24px 20px 16px" : "16px 20px",
        background: "#fff",
        flexShrink: 0,
      }}>
        <div style={{display:"flex", flexDirection:"column", gap:4}}>
          <div style={{
            fontSize: isMobile ? 24 : 32, // ← 모바일은 가독성 위해 24
            fontWeight: 600, color: "#111", lineHeight: 1.5,
          }}>
            반복 예약 완료
          </div>
          <div style={{fontSize:14, fontWeight:400, color:"#111", lineHeight:1.5}}>
            총 {bks.length}건의 반복예약이 생성되었습니다.
          </div>
          {/* ← [2026-05-28] 충돌 제외 보존 표기 (피그마엔 별도 박스 없음 → 서브텍스트 하단 정보 유지) */}
          {skipped > 0 && (
            <div style={{fontSize:12, fontWeight:400, color:"#DC2626", lineHeight:1.5}}>
              기존 예약과 겹치는 {skipped}건은 제외되었습니다.
            </div>
          )}
        </div>
      </div>

      {/* ── Spacer ──   ← [2026-05-28 피그마 922:1904] 헤더와 정보영역 사이 40px 흰 영역 */}
      <div style={{height: isMobile ? 20 : 40, background:"#fff", flexShrink:0}}/>

      {/* ── Hero: 정보 리스트 ──   ← [2026-05-28 피그마 922:1905]
            0.5px #F1F5F9 구분선 row 리스트. 생성 날짜 多건 대비 본문 스크롤 */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto",
        padding: "0 20px",
        display: "flex", flexDirection: "column",
      }}>
        {/* 회의제목   ← 값만 SemiBold (피그마 922:1912) */}
        <div style={rowStyle}>
          <div style={labelStyle}>회의제목</div>
          <div style={{...valueStyle, fontWeight:600}}>{first.title}</div>
        </div>

        {/* 회의실   ← 피그마 #111 일반 텍스트 (색상 토큰 미사용) */}
        <div style={rowStyle}>
          <div style={labelStyle}>회의실</div>
          <div style={valueStyle}>{r?.room_name}</div>
        </div>

        {/* 위치 */}
        <div style={rowStyle}>
          <div style={labelStyle}>위치</div>
          <div style={valueStyle}>{floor?.floor_name ?? ''}</div>
        </div>

        {/* 시간 + duration chip   ← [피그마 922:1941 StatusBadge-XS]
              border 0.5px #AFAFAF / rounded 4 / padding 4·7 / 11px Medium #AFAFAF
              (반복 예약은 모두 동일 시간대 → 첫 건 기준 표시) */}
        <div style={rowStyle}>
          <div style={labelStyle}>시간</div>
          <div style={{...valueStyle, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
            <span>{fmtTSRangeFull(first.start_at, first.end_at)}</span>
            <span style={{
              border: "0.5px solid #AFAFAF", borderRadius: 4,
              padding: "4px 7px",
              fontSize: 11, fontWeight: 500, color: "#AFAFAF",
              lineHeight: 1, whiteSpace: "nowrap",
            }}>{durText}</span>
          </div>
        </div>

        {/* 생성 날짜   ← [피그마 922:9203] 생성된 전체 날짜를 한 줄씩 ("YYYY년 M월 D일 X요일") */}
        <div style={{...rowStyle, alignItems:"flex-start"}}>
          <div style={labelStyle}>생성 날짜</div>
          <div style={{...valueStyle, display:"flex", flexDirection:"column", gap:2}}>
            {bks.map((b, i) => (
              <span key={b.id ?? i}>{fmtTSDateFullWithDayFull(b.start_at)}</span>
            ))}
          </div>
        </div>

        {/* 메모 (조건부)   ← [무수정 보존] first.memo && 조건 / alignItems flex-start (긴 메모 줄바꿈 대응) */}
        {first.memo && (
          <div style={{...rowStyle, alignItems:"flex-start"}}>
            <div style={labelStyle}>메모</div>
            <div style={{...valueStyle, whiteSpace:"pre-wrap"}}>{first.memo}</div>
          </div>
        )}

        {/* 예약자   ← [BookingDoneModal P4-A-2 동일] live 패턴 — users.find(user_id), snapshot fallback
              (반복 nb 스냅샷엔 user_id 없음 → owner undefined → first.user/first.dept fallback. 방금 생성자라 최신) */}
        {(()=>{
          const owner = (up as any[]).find(u => u.user_id === first.user_id)
          return (
            <div style={rowStyle}>
              <div style={labelStyle}>예약자</div>
              <div style={{...valueStyle, display:"flex", alignItems:"center"}}>
                <UserChip
                  name={owner?.name ?? first.user}
                  avatarUrl={owner?.avatar_url ?? null}
                  variant="md"
                  userInfo={owner}
                  dept={owner?.dept ?? first.dept}
                />
              </div>
            </div>
          )
        })()}

        {/* 참석자 (조건부)   ← [BookingDoneModal P4-A-2 동일] live 패턴 — users.find(email)
              ← 마지막 row이므로 borderBottom: 'none', alignItems flex-start */}
        {first.attendees && first.attendees.length > 0 && (
          <div style={{...rowStyle, alignItems:"flex-start", borderBottom:"none"}}>
            <div style={labelStyle}>참석자</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:"8px 14px", flex:1, minWidth:0}}>
              {first.attendees.map((a, idx) => {
                const u = (up as any[]).find(u => u.email === a.email)
                return (
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

      {/* ── Footer ──   ← [2026-05-28 피그마 922:2006]
            padding 8, 모달 하단 corner rounded 24, Button primary lg(bg #111 / py16 / radius16 / 14 SemiBold) */}
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
