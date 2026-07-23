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
import { UserAvatar } from '../common/UserAvatar'
import { DashboardRangeRow } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import { aggregateUsers, type UserAggRow } from '../../utils/dashboardAgg'
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

// ─── 공통 이름 셀 (아바타 16 + gap 4 + 이름) ────────────────────────────────
function NameCell({ row, flex }: { row: UserAggRow; flex: number }) {
  return (
    <div style={{ flex, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
      <UserAvatar name={row.name} size={16} fontSize={8} fontWeight={500} />
      <span style={{
        fontFamily: FONT, fontWeight: 400, fontSize: 13, lineHeight: 1.4, color: '#111',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{row.name}</span>
    </div>
  )
}

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
          <Th label="이름" flex={1} />
          <Th label="부서" flex={1} />
          <Th label="누적 예약 건 수" flex={1} />
        </div>

        {rows.length === 0 ? <EmptyRow height={RANK_ROWS * 34} /> : rows.map(row => (
          <div key={row.user_id ?? row.name}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: 34 }}>
            <NameCell row={row} flex={1} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontFamily: FONT, fontWeight: 400, fontSize: 13, lineHeight: 1.4, color: '#6366F1',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
              }}>{row.dept || '—'}</span>
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
const NOSHOW_ROWS = 5

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
          <Th label="이름" flex={1} />
          <Th label="부서" flex={1} />
          <Th label="누적 노쇼" flex={1} color="#DC2626" />
        </div>

        {rows.length === 0 ? <EmptyRow height={NOSHOW_ROWS * 35} /> : rows.map(row => (
          <div key={row.user_id ?? row.name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 35 }}>
            <NameCell row={row} flex={1} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontFamily: FONT, fontWeight: 400, fontSize: 13, lineHeight: 1.4, color: '#6366F1',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
              }}>{row.dept || '—'}</span>
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
