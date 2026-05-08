/**
 * DateRangeFilter — 날짜 범위 + 퀵버튼 그룹 + (옵션) 조회 기준 토글 (controlled)
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase B] 신규 — MyBookingTable에서 추출
 *  - [2026-05-06 Admin Phase C] QuickBtn h 47→42, padding 14×24→12×20, fw 500
 *  - [2026-05-06 Admin Phase 4] Figma 451:3205 / 468:2589 1:1
 *      · 조회 기준 토글 통합 (좌측 안쪽) — modeToggle props 옵션
 *      · QuickBtn padding 12×20 → 12×16 (Figma 정확)
 *      · 좌측 그룹 gap 12 → 8 (토글-DateDisplay 간격)
 *      · 좌측 내부 (DateDisplay×2 + ⎯) gap 12 유지
 *
 * 📌 사용 정책
 *  · controlled 컴포넌트 — from/to/activeQuick은 부모가 관리
 *  · modeToggle prop으로 토글 표시 여부 + 모드 라벨 컨트롤 (Admin 승인관리 전용)
 *  · 퀵버튼 정의는 props로 (도메인별 다름):
 *    - MyPage:  [{ id:'month', label:'이번 달' }, { id:'3months', label:'지난 3개월' }]
 *    - Admin:   [{ id:'month' }, { id:'3months' }, { id:'all' }] — 모드별 동적 라벨
 *
 * 📌 Figma 사양 (node 451:3205 / 468:2589)
 *  · Filter Row 1: justify-content space-between, w 1180
 *    - 좌측: [토글 (옵션)] + DateDisplay×2 + ⎯ separator (gap 8 / 토글-DateDisplay 사이)
 *    - 우측: 퀵버튼 그룹 (gap 8)
 *  · 토글: bg #fff p 2 / rounded 1000 / 활성: bg #111 text #fff h 42 px 16 py 12 / 비활성: text #657487 / 14 Medium
 *  · DateDisplay: h 52 / rounded 12 / padding 12×20 좌·12×24 우
 *  · ⎯: 12 Medium #111
 *  · QuickBtn: h 42 / padding 12×16 / rounded 12 / 14 Medium
 *    - 활성: bg #111 / text #fff
 *    - 비활성: bg #fff / text #64748B
 */

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'  // ← [2026-05-07 v2] useLayoutEffect 추가
import { DateDisplay } from './DateDisplay'

// ─── Quick Button 정의 ───────────────────────────────────────────────────────
export interface QuickButtonDef<TQuickId extends string = string> {
  id:    TQuickId
  label: string
}

// ─── 조회 기준 토글 정의 (옵션) ─────────────────────────────────────────────
// ← [2026-05-06 Phase 4] Figma 1:1 — '요청 날짜' / '회의 날짜' 같은 모드 전환
export interface ModeToggleDef<TModeId extends string = string> {
  /** 모드 옵션 정의 (배열 순서대로 표시) */
  options: Array<{ id: TModeId; label: string }>
  /** 현재 활성 모드 id */
  activeMode: TModeId
  /** 모드 변경 콜백 */
  onModeChange: (id: TModeId) => void
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface DateRangeFilterProps<
  TQuickId extends string = string,
  TModeId  extends string = string,
> {
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
  /**
   * 조회 기준 토글 (옵션). 지정 시 좌측 가장 안쪽에 토글 표시.
   * Admin 승인관리 — 요청 날짜 / 회의 날짜 모드 전환용
   */
  modeToggle?:    ModeToggleDef<TModeId>
}

// ─── Component ───────────────────────────────────────────────────────────────
export function DateRangeFilter<
  TQuickId extends string = string,
  TModeId  extends string = string,
>({
  from, to,
  onFromChange, onToChange,
  activeQuick, onQuickClick,
  quickButtons,
  modeToggle,                                     // ← [Phase 4] 신규 옵션
}: DateRangeFilterProps<TQuickId, TModeId>) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      {/* 좌측 그룹: [토글] + DateDisplay×2 + ⎯ */}
      {/* ← Figma: 토글-DateDisplay 그룹 사이 gap 8 (또는 16) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 조회 기준 토글 (옵션) */}
        {modeToggle && (
          <ModeToggle
            options={modeToggle.options}
            activeMode={modeToggle.activeMode}
            onModeChange={modeToggle.onModeChange}
          />
        )}
        {/* DateDisplay×2 + ⎯ — 자체 gap 8 (Figma 468:3244 1:1) */}
        {/* ← [2026-05-06 Phase 4] gap 12 → 8 (Figma `gap-[8px]` 정확) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DateDisplay
            value={from}
            onChange={d => onFromChange(d)}
            max={to}
          />
          <span style={{
            // ← [2026-05-06 Admin Phase C] fontSize 16 → 12 (Figma node 468:1329)
            fontSize: 12, fontWeight: 500, color: '#111',
            lineHeight: 1, whiteSpace: 'nowrap',
          }}>⎯</span>
          <DateDisplay
            value={to}
            onChange={d => onToChange(d)}
            min={from}
          />
        </div>
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

// ─── 조회 기준 토글 (내부 헬퍼) ──────────────────────────────────────────────
// ← [2026-05-06 Phase 4] Figma 451:3205 / 468:2589 1:1
//   외곽: bg #fff / padding 2 / rounded 1000 / pill 형태
//   내부: 활성 bg #111 text #fff / 비활성 text #657487 (transparent)
//         h 42 / px 16 py 12 / 14 Medium / rounded 1000
function ModeToggle<TModeId extends string>({
  options, activeMode, onModeChange,
}: {
  options: Array<{ id: TModeId; label: string }>
  activeMode: TModeId
  onModeChange: (id: TModeId) => void
}) {
  // ── [2026-05-07] Sliding pill ─────────────────────────────────────────────
  const btnRefs      = useRef<(HTMLButtonElement | null)[]>([])  // ← [2026-05-07] 각 버튼 ref
  const containerRef = useRef<HTMLDivElement | null>(null)        // ← [2026-05-07] 컨테이너 ref
  const [pill, setPill]   = useState({ left: 0, width: 0 })      // ← [2026-05-07] pill 위치/크기
  const [ready, setReady] = useState(false)                       // ← [2026-05-07] 첫 측정 완료 여부
  const measure = useCallback(() => {
    const i = options.findIndex(o => o.id === activeMode)
    const btn = btnRefs.current[i]
    if (!btn) return
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth })     // ← [2026-05-07] offsetLeft 기준
    setReady(true)
  }, [activeMode])  // eslint-disable-line react-hooks/exhaustive-deps  ← [2026-05-07 v2] options 제외: 매 렌더 새 배열이지만 내용 stable → 매번 ResizeObserver 재attach 방지
  useLayoutEffect(() => { measure() }, [measure])  // ← [2026-05-07 v2] useEffect→useLayoutEffect: 깜빡임 제거
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)                        // ← [2026-05-07] 반응형 재측정
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div
      ref={containerRef}                                           // ← [2026-05-07] ResizeObserver 대상
      style={{
        position: 'relative',                                      // ← [2026-05-07] pill absolute 기준점
        display: 'flex', alignItems: 'center', gap: 0,
        background: '#fff',
        padding: 2,
        borderRadius: 1000,
        flexShrink: 0,
        overflow: 'hidden',
      }}>
      {/* Sliding pill */}
      {ready && (
        <div style={{
          position: 'absolute', top: 2, bottom: 2,                // ← [2026-05-07 v2] padding 2와 일치
          left: 0,                                                  // ← [2026-05-07 v3] translate3d 사용
          width: pill.width,
          transform: `translate3d(${pill.left}px, 0, 0)`,           // ← [2026-05-07 v3] GPU 가속
          background: '#111', borderRadius: 1000,
          transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
          willChange: 'transform, width',                           // ← [2026-05-07 v3] composite layer 힌트
          zIndex: 0, pointerEvents: 'none',
        }} />
      )}
      {options.map((opt, i) => (
        <button
          key={opt.id}
          ref={el => { btnRefs.current[i] = el }}                 // ← [2026-05-07] 버튼 ref 등록
          type="button"
          onClick={() => onModeChange(opt.id)}
          style={{
            position: 'relative', zIndex: 1,                      // ← [2026-05-07] pill 위에 텍스트
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 42, padding: '12px 16px',
            borderRadius: 1000, border: 'none', cursor: 'pointer',
            background: 'transparent',                             // ← [2026-05-07] pill이 배경 담당
            color: activeMode === opt.id ? '#fff' : '#657487',
            fontFamily: 'inherit',
            fontSize: 14, fontWeight: 500, lineHeight: 'normal',
            whiteSpace: 'nowrap',
            transition: 'color 0.22s cubic-bezier(0.4,0,0.2,1)',
            WebkitTapHighlightColor: 'transparent',                  // ← [2026-05-07 v3] iOS 회색 박스 제거
            touchAction: 'manipulation',                              // ← [2026-05-07 v3] 300ms tap delay 제거
            userSelect: 'none',                                        // ← [2026-05-07 v3] 텍스트 선택 차단
          }}>
          {opt.label}
        </button>
      ))}
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
        // ← [2026-05-06 Phase 4] Figma 451:3205 / 468:2589 1:1
        // h 42, padding 12×16 (이전 12×20에서 변경), rounded 12
        // 활성: bg #111 / text #fff / 14 Medium
        // 비활성: bg #fff / text #64748B / 14 Medium
        height: 42, padding: '12px 16px', borderRadius: 12,
        border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 14, lineHeight: 'normal',
        whiteSpace: 'nowrap',
        background: active ? '#111' : '#fff',
        color:      active ? '#fff' : '#64748B',
        fontWeight: 500,
        transition: 'background 0.15s, color 0.15s',
      }}>
      {children}
    </button>
  )
}
