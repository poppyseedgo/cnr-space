/**
 * DashboardUserCards.tsx — 대시보드 신규 위젯 2종 (Figma node 551:3316)
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 2] 신규 생성
 *    · ③ 사용자 예약 순위   (Figma 2646:7305) — Row2 Col1, 389.33×400, 8행
 *    · ⑦ 사용자 누적 노쇼   (Figma 2632:8276) — Row3 Col2, 389.33×400, 5행
 *
 * 📌 설계 원칙
 *  1) 두 카드 모두 집계를 자체 구현하지 않고 utils/dashboardAgg.aggregateUsers()를 호출한다.
 *     DetailDrawer(type='users')도 같은 함수를 쓰므로, 카드 숫자와 드로어 숫자가 구조적으로 일치한다.
 *  2) 노쇼 판정은 utils/noshow.ts의 isNoshow 한 곳에서만 이뤄진다(aggregateUsers 내부).
 *     이 파일에는 노쇼 조건식이 존재하지 않는다.
 *  3) 이름/부서는 users 배열의 live 값 우선 — 스냅샷은 fallback (aggregateUsers가 처리).
 *  4) 기간은 위젯 자체 dateFrom/dateTo state + DashboardRangeRow (Phase 3.5 위젯 독립 필터 구조 유지).
 */
import { useState, useMemo } from 'react'
import { DashboardUserCell, DashboardDeptText } from './DashboardUserCell'  // ← [2026-07-23] 사용자 표시·부서 표기 공통화
import { DashboardRangeRow } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import { aggregateUsers } from '../../utils/dashboardAgg'
import { todayStr } from '../../utils/time'
import type { AppUser } from '../../types'

const FONT = "'Pretendard', -apple-system, sans-serif"

// 기본 기간 = 오늘 포함 30일 (기존 위젯 전부와 동일 — DashboardRangeFilter '한 달' 프리셋과 일치)
function defaultFrom(): string {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

// ─── 공통 카드 셸 (Figma: bg #fff / radius 24 / pt12 px16 pb16) ─────────────
function CardShell({ height, title, from, to, onRange, children }: {
  height:   number
  title:    string
  from:     string
  to:       string
  onRange:  (r: { from: string; to: string }) => void
  children: React.ReactNode
}) {
  return (
    <div style={{
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      height,
      width:         '100%',
    }}>
      {/* ── 헤더 블록 (Figma Frame 48096362: 타이틀 22 + gap 8 + 날짜행 21 = 51) ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
        <p style={{
          fontFamily: FONT,
          fontWeight: 500, fontSize: 16, lineHeight: 1.4, color: '#111', margin: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</p>
        <DashboardRangeRow from={from} to={to} onChange={onRange} />
      </div>
      {children}
    </div>
  )
}

// ─── 랭크 서클 (Figma 2665:8433 — '순위'가 들어가는 카드 공통) ──────────────
//   [2026-07-23] 부서 예약 순위에만 있던 랭크 숫자를 사용자 예약 순위 / 사용자 누적 노쇼에도 적용.
//   순위 카드인데 번호가 없으면 몇 위인지 세어야 한다.
function RankBadge({ rank }: { rank: number }) {
  return (
    <div style={{
      width:16, height:16, flexShrink:0,
      border:'1px solid #000', borderRadius:999,
      display:'flex', alignItems:'center', justifyContent:'center',
    }}>
      <span style={{ fontFamily:FONT, fontWeight:400, fontSize:8, lineHeight:1.5, color:'#000' }}>{rank}</span>
    </div>
  )
}

// ─── 공통 테이블 헤더 셀 ─────────────────────────────────────────────────────
function Th({ label, flex, align = 'left', color = '#AEB5C4' }: {
  label: string; flex: number; align?: 'left' | 'right'; color?: string
}) {
  return (
    <div style={{ flex, minWidth: 0, textAlign: align }}>
      <span style={{
        fontFamily: FONT, fontWeight: 400, fontSize: 12, lineHeight: 1.4, color,
      }}>{label}</span>
    </div>
  )
}

// ─── [2026-07-23] 지역 NameCell 삭제 → components/admin/DashboardUserCell 공통 컴포넌트 사용
//     사유: '최근 생성된 예약'만 프로필 사진이 뜨고 이 카드는 이니셜만 떠서 같은 사람이 달라 보였다.

// 데이터 없음 표시 — 기존 위젯들과 동일 톤
function EmptyRow({ height }: { height: number }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, fontSize: 12, color: '#CBD5E1',
    }}>데이터 없음</div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  위젯 ③ 사용자 예약 순위 (Figma 2646:7305 — 389.33×400)
//    테이블: 헤더행 33 + 데이터행 34 × 8 = 305
//    컬럼:   이름 / 부서 / 누적 예약 건 수  (Figma 각 111.11 = 3등분)
// ════════════════════════════════════════════════════════════════════════════
const RANK_ROWS = 8

export function UserRankingCard({ users }: { users: AppUser[] }) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  const { data } = useBookingsByRange(dateFrom, dateTo)

  // count desc — aggregateUsers 기본 정렬이 이미 count desc이므로 그대로 상위 N개만 사용
  const rows = useMemo(() => aggregateUsers(data, users).slice(0, RANK_ROWS), [data, users])

  return (
    <CardShell
      height={400}
      title="사용자 예약 순위"
      from={dateFrom} to={dateTo}
      onRange={r => { setDateFrom(r.from); setDateTo(r.to) }}>

      {/* Figma: 헤더 블록(y12+51=63) ↔ 테이블(y79) 사이 간격 16 */}
      <div style={{ height: 16, flexShrink: 0 }} />

      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {/* 헤더행 h33 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 33 }}>
          <div style={{ width: 16, flexShrink: 0 }} />{/* ← [2026-07-23] 랭크 서클 자리 */}
          <Th label="이름" flex={1} />
          <Th label="부서" flex={1} />
          <Th label="누적 예약 건 수" flex={1} />
        </div>

        {rows.length === 0 ? <EmptyRow height={RANK_ROWS * 34} /> : rows.map((row, i) => (
          <div key={row.user_id ?? row.name}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: 34 }}>
            <RankBadge rank={i + 1} />{/* ← [2026-07-23] 순위 숫자 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <DashboardUserCell name={row.name} avatarUrl={row.avatarUrl} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DashboardDeptText dept={row.dept} />{/* ← [2026-07-23] 인디고 → 회색 */}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontFamily: FONT, fontWeight: 400, fontSize: 13, lineHeight: 1.4, color: '#111',
              }}>{row.count}</span>
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  위젯 ⑦ 사용자 누적 노쇼 (Figma 2632:8276 — 389.33×400)
//    Figma 좌표: 헤더 블록 y12~63, 테이블 y176~384
//      → 헤더와 테이블 사이 113px 공백이 Figma 사양 그대로 존재한다(빈 영역).
//        임의로 메우지 않고 1:1 재현한다. 채울 콘텐츠가 정해지면 이 spacer만 교체하면 된다.
//    테이블: 헤더행 33 + 데이터행 35 × 5 = 208
//    컬럼:   이름 / 부서 / 누적 노쇼(StatusBadge-XS 32×19)
// ════════════════════════════════════════════════════════════════════════════
const NOSHOW_ROWS = 8   // ← [2026-07-23] 5 → 8 (고지 지시)

export function UserNoshowCard({ users }: { users: AppUser[] }) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  const { data } = useBookingsByRange(dateFrom, dateTo)

  // 노쇼 0건인 사용자는 순위에 의미가 없으므로 제외 후 noshow desc 정렬
  const rows = useMemo(() => (
    aggregateUsers(data, users)
      .filter(r => r.noshow > 0)
      .sort((a, b) => b.noshow - a.noshow)
      .slice(0, NOSHOW_ROWS)
  ), [data, users])

  return (
    <CardShell
      height={400}
      title="사용자 누적 노쇼"
      from={dateFrom} to={dateTo}
      onRange={r => { setDateFrom(r.from); setDateTo(r.to) }}>

      {/* Figma 사양 그대로의 빈 영역 (헤더 63 → 테이블 176) */}
      <div style={{ flex: 1, minHeight: 0 }} />

      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {/* 헤더행 h33 — '누적 노쇼'만 경고색 (Figma/스크린샷 1:1) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 33 }}>
          <div style={{ width: 16, flexShrink: 0 }} />{/* ← [2026-07-23] 랭크 서클 자리 */}
          <Th label="이름" flex={1} />
          <Th label="부서" flex={1} />
          <Th label="누적 노쇼" flex={1} color="#DC2626" />
        </div>

        {rows.length === 0 ? <EmptyRow height={NOSHOW_ROWS * 35} /> : rows.map((row, i) => (
          <div key={row.user_id ?? row.name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 35 }}>
            <RankBadge rank={i + 1} />{/* ← [2026-07-23] 순위 숫자 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <DashboardUserCell name={row.name} avatarUrl={row.avatarUrl} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DashboardDeptText dept={row.dept} />{/* ← [2026-07-23] 인디고 → 회색 */}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Figma StatusBadge-XS 32×19 */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 32, height: 19, padding: '0 8px', borderRadius: 999,
                background: '#FEE2E2', color: '#DC2626',
                fontFamily: FONT, fontWeight: 400, fontSize: 12, lineHeight: 1.4,
              }}>{row.noshow}</span>
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  )
}
