/**
 * DateRangeFilter — 날짜 범위 + 퀵버튼 그룹 (controlled)
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase B] 신규 — MyBookingTable에서 추출
 *
 * 📌 사용 정책
 *  · controlled 컴포넌트 — from/to/activeQuick은 부모가 관리
 *  · 퀵버튼 정의는 props로 (도메인별 다름):
 *    - MyPage:  [{ id:'month', label:'이번 달' }, { id:'3months', label:'지난 3개월' }]
 *    - Admin:   [{ id:'today', label:'오늘' }, { id:'15days', label:'지난 15일' }, { id:'3months', label:'지난 3개월' }]
 *
 * 📌 Figma 사양 (node 449:1734 / 451:3537)
 *  · Filter Row 1: justify-content space-between
 *    - 좌측: DateDisplay×2 + ⎯ separator (gap 12)
 *    - 우측: 퀵버튼 그룹 (gap 8)
 *  · DateDisplay: h 52 / rounded 12 / padding 14×16 (좌)·14×24 (우)
 *  · ⎯: 16 Medium #111
 *  · QuickBtn: h 47 / padding 14×24 / rounded 12
 *    - 활성: bg #111 / text #fff / SemiBold
 *    - 비활성: bg #fff / text #64748B / Medium
 */

import { DateDisplay } from './DateDisplay'

// ─── Quick Button 정의 ───────────────────────────────────────────────────────
export interface QuickButtonDef<TQuickId extends string = string> {
  id:    TQuickId
  label: string
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface DateRangeFilterProps<TQuickId extends string = string> {
  from:           string
  to:             string
  /** 변경 시 호출 — from/to 둘 다 같이 변경 (퀵버튼 클릭 시 양쪽 동시 set) */
  onFromChange:   (d: string) => void
  onToChange:     (d: string) => void
  /** 활성 퀵버튼 id — null이면 비활성 (사용자 직접 날짜 변경 시 null) */
  activeQuick:    TQuickId | null
  onQuickClick:   (id: TQuickId) => void
  /** 퀵버튼 정의 (도메인별 다름) */
  quickButtons:   QuickButtonDef<TQuickId>[]
}

// ─── Component ───────────────────────────────────────────────────────────────
export function DateRangeFilter<TQuickId extends string = string>({
  from, to,
  onFromChange, onToChange,
  activeQuick, onQuickClick,
  quickButtons,
}: DateRangeFilterProps<TQuickId>) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8,                                          // ← Figma: 좌측 그룹과 우측 그룹 사이 8
      flexWrap: 'wrap',
    }}>
      {/* 좌측: DateDisplay×2 + ⎯ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{/* ← Figma: gap 12 */}
        <DateDisplay
          value={from}
          onChange={d => onFromChange(d)}
          max={to}
        />
        <span style={{
          fontSize: 16, fontWeight: 500, color: '#111',
          lineHeight: 1, whiteSpace: 'nowrap',
        }}>⎯</span>
        <DateDisplay
          value={to}
          onChange={d => onToChange(d)}
          min={from}
        />
      </div>

      {/* 우측: 퀵버튼 그룹 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{/* ← Figma: gap 8 */}
        {quickButtons.map(qb => (
          <QuickBtn
            key={qb.id}
            active={activeQuick === qb.id}
            onClick={() => onQuickClick(qb.id)}>
            {qb.label}
          </QuickBtn>
        ))}
      </div>
    </div>
  )
}

// ─── 퀵버튼 (내부 헬퍼) ──────────────────────────────────────────────────────
function QuickBtn({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        // Figma node 449:1877 / 451:3019:
        // h 47, padding px 24 py 14, rounded 12
        // 활성: bg #111 / text #fff / SemiBold
        // 비활성: bg #fff / text #64748B / Medium
        height: 47, padding: '14px 24px', borderRadius: 12,
        border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 14, lineHeight: 'normal',
        whiteSpace: 'nowrap',
        background: active ? '#111' : '#fff',
        color:      active ? '#fff' : '#64748B',
        fontWeight: active ? 600   : 500,
        transition: 'background 0.15s, color 0.15s',
      }}>
      {children}
    </button>
  )
}
