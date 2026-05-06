/**
 * DataTable — 헤더 + 행 + Empty State + 페이지네이션 (제네릭 controlled)
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase B] 신규 — MyBookingTable에서 추출
 *
 * 📌 사용 정책
 *  · controlled: page는 부모가 관리, totalPages는 외부에서 계산해서 주입
 *  · 컬럼 정의는 columns prop (제네릭 T), 행 렌더는 각 column.render(item)
 *  · loading / empty 상태 자동 처리
 *  · 행 클릭 콜백 (옵션)
 *
 * 📌 Figma 사양 (node 449:801 / 451:3562 etc.)
 *  · 컨테이너: rounded 16 / overflow hidden / gap 1px (구분선) / bg #FAFCFF
 *  · 헤더: h 60 / 14 SemiBold #92A0BC / padding 10·14 (첫 셀 10·16)
 *  · 행: h 60 / hover bg #FAFBFD
 *  · Empty State: •_• EmptyFaceIcon 82 + 안내문 14 Medium #D9E0EE / gap 16
 *  · 페이지네이션: 중앙 정렬 / h 60 / 32×30 버튼 / 활성 #000 / 비활성 #F8FAFC
 */

import { useMemo, type ReactNode } from 'react'
import { ChevronBackwardIcon, ChevronForwardIcon, EmptyFaceIcon } from './Icons'

// ─── Column 정의 ─────────────────────────────────────────────────────────────
export interface Column<T> {
  /** key (React key 용) */
  key:      string
  /** 헤더 라벨 */
  label:    string
  /** 고정 width (flex와 배타) */
  width?:   number
  /** flex:1 (가용 공간 모두 차지) */
  flex?:    boolean
  /** padding "y x" 형식 (기본 '10 14', 첫 셀은 보통 '10 16') */
  pad?:     string
  /** 행 셀 렌더 함수 */
  render:   (item: T) => ReactNode
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface DataTableProps<T> {
  /** 표시할 데이터 (이미 정렬·필터된 — 페이징도 처리됨) */
  data:           T[]
  columns:        Column<T>[]
  /** 행 key 추출 함수 */
  getRowKey:      (item: T) => string | number
  /** 행 클릭 콜백 (옵션) */
  onRowClick?:    (item: T) => void

  /** 로딩 중 여부 */
  loading?:       boolean
  /** Empty State 메시지 (기본 '내역이 없습니다.') */
  emptyMessage?:  string

  // ─── 페이지네이션 ──────────────────────────────────────────────────────────
  page:           number       // 1-indexed
  totalPages:     number
  onPageChange:   (p: number) => void

  /** 컨테이너 minHeight (기본 426 — Figma 사양) */
  minHeight?:     number
  /**
   * 테이블 최소 너비 (px). 컬럼 width 합계가 부모를 초과할 때 가로 스크롤 발생.
   * ← [2026-05-06 Phase 4] 사용자 보고 "table width 가 잘려서 컨텐츠가 안보이는데 스크롤이 안됨"
   *    근본 원인: DataTable 외곽 `overflow:hidden`이 자식 row의 가로 확장을 막아
   *               부모 wrapper의 `overflowX:auto`가 작동 안 함
   *    해결: minWidth로 자식 row가 부모를 명시적으로 초과하도록 강제 → 부모 wrapper 스크롤 활성화
   *    미지정 시 width:100% (기존 동작 보존)
   */
  minWidth?:      number
}

// ─── Component ───────────────────────────────────────────────────────────────
export function DataTable<T>({
  data, columns, getRowKey, onRowClick,
  loading = false, emptyMessage = '내역이 없습니다.',
  page, totalPages, onPageChange,
  minHeight = 426,
  minWidth,                                    // ← [Phase 4] 신규 prop
}: DataTableProps<T>) {
  // ─── 페이지 번호 배열 (7-slot 고정 패턴 — 위치 흔들림 제거) ─────────────
  // ← [2026-05-06 사용자 보고] 페이지 이동 시 숫자 위치가 변동되는 문제
  //   기존: filter(n === 1 || n === totalPages || Math.abs(n - page) <= 2)
  //         → page=1: [1,2,3,...,last] (5 slots) / page=5+: 7 slots / 변동 심함
  //   해결: 항상 7개 슬롯 고정 패턴 — 활성 페이지 위치만 슬롯 내에서 이동
  //         · totalPages <= 7: 모든 페이지 그대로 표시 (변동 없음)
  //         · page <= 4:        [1, 2, 3, 4, 5, …, last]      ← 활성 좌측 1~4
  //         · page >= last-3:   [1, …, last-4, …, last]       ← 활성 우측 1~4
  //         · 가운데:           [1, …, page-1, page, page+1, …, last]  ← 활성 가운데
  const pageNumbers = useMemo<(number | '...')[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    if (page <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages]
    }
    if (page >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }
    return [1, '...', page - 1, page, page + 1, '...', totalPages]
  }, [totalPages, page])

  return (
    <div style={{
      borderRadius: 16,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      gap: 1,                                            // ← 행 사이 1px 구분선 (gap 노출)
      minHeight,
      background: '#FAFCFF',                              // ← 구분선 색상 = 배경
      // ← [2026-05-06 Phase 4 사용자 보고 fix] width 정책 변경
      //    이전: width = minWidth → 컬럼 합계까지만 차지 → 부모 컨테이너가 더 넓으면 우측 빈 공간
      //    변경: width: 100% + minWidth만 별도
      //    · 부모 ≥ minWidth: width 100%로 채움 (우측 빈 공간 제거)
      //    · 부모 < minWidth:  minWidth가 부모 초과 → 외부 wrapper의 overflowX:auto 작동
      width: '100%',
      ...(minWidth ? { minWidth } : {}),
    }}>
      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', height: 60, background: '#fff', flexShrink: 0,
        borderRadius: '16px 16px 0 0',
      }}>
        {columns.map((c, i) => (
          <Th key={c.key} width={c.width} flex={c.flex} pad={c.pad ?? (i === 0 ? '10 16' : '10 14')}>
            {c.label}
          </Th>
        ))}
      </div>

      {/* ── 본문 wrapper (flex:1) — 페이지네이션 항상 하단 고정 보장 ──── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        gap: 1,
        background: '#FAFCFF',
      }}>
        {loading ? (
          <div style={emptyContainerStyle}>
            <span style={{ fontSize: 14, color: '#CBD5E1' }}>불러오는 중…</span>
          </div>
        ) : data.length === 0 ? (
          <div style={emptyContainerStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <EmptyFaceIcon size={82} color="#D9E0EE"/>
              <span style={{
                fontSize: 14, fontWeight: 500, color: '#D9E0EE',
                lineHeight: 1.5,
              }}>{emptyMessage}</span>
            </div>
          </div>
        ) : (
          data.map(item => (
            <div
              key={getRowKey(item)}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              style={{
                display: 'flex', height: 60,
                background: '#fff',
                cursor: onRowClick ? 'pointer' : 'default',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
              onMouseEnter={onRowClick ? (e) => (e.currentTarget as HTMLDivElement).style.background = '#FAFBFD' : undefined}
              onMouseLeave={onRowClick ? (e) => (e.currentTarget as HTMLDivElement).style.background = '#fff' : undefined}>
              {columns.map((c, i) => (
                <Td key={c.key} width={c.width} flex={c.flex} pad={c.pad ?? (i === 0 ? '10 16' : '10 14')}>
                  {c.render(item)}
                </Td>
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── 페이지네이션 (Figma node 449:1341 / 466:1001) ──────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 4,
        padding: 16,
        height: 60,
        background: '#fff',
        flexShrink: 0,
        borderRadius: '0 0 16px 16px',
      }}>
        <PageBtn onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>
          <ChevronBackwardIcon size={24}/>
        </PageBtn>
        {pageNumbers.map((n, i) =>
          n === '...' ? (
            <span key={`d${i}`} style={{
              width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, color: '#CBD5E1',
            }}>…</span>
          ) : (
            <PageBtn key={n} onClick={() => onPageChange(n as number)} active={page === n}>
              {n}
            </PageBtn>
          )
        )}
        <PageBtn onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          <ChevronForwardIcon size={24}/>
        </PageBtn>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── 페이지네이션 버튼 ──────────────────────────────────────────────────
function PageBtn({ onClick, disabled, active, children }:
  { onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        // Figma node 449:1362(active) / 449:1363(inactive) / 449:1375(chevron):
        // w 32 h 30, rounded 8, padding px 10 py 6
        // 활성: bg #000 white 12 Medium / 비활성: bg #F8FAFC #64748B 12 Regular
        width: 32, height: 30, borderRadius: 8,
        padding: '6px 10px',
        border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? '#000' : '#F8FAFC',
        color:      active ? '#fff' : disabled ? '#CBD5E1' : '#64748B',
        opacity:    disabled ? 0.5 : 1,
        fontSize: 12, fontWeight: active ? 500 : 400,
        fontFamily: 'inherit',
        transition: 'background 0.15s, color 0.15s',
      }}>
      {children}
    </button>
  )
}

// ─── 테이블 헤더 셀 ─────────────────────────────────────────────────────
function Th({ width, flex, pad = '10 14', children }:
  { width?: number; flex?: boolean; pad?: string; children: ReactNode }) {
  // Figma node 449:764 등: padding 10 16(첫셀) / 10 14(나머지), 14 SemiBold #92A0BC
  const [py, px] = pad.split(' ').map(Number)
  return (
    <div style={{
      ...(flex ? { flex: 1, minWidth: 0 } : { width, flexShrink: 0 }),
      height: 60,
      padding: `${py}px ${px}px`,
      display: 'flex', alignItems: 'center',
    }}>
      <span style={{
        fontSize: 14, fontWeight: 600, color: '#92A0BC',
        lineHeight: 1.5,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{children}</span>
    </div>
  )
}

// ─── 테이블 본문 셀 ─────────────────────────────────────────────────────
function Td({ width, flex, pad = '10 14', children }:
  { width?: number; flex?: boolean; pad?: string; children: ReactNode }) {
  const [py, px] = pad.split(' ').map(Number)
  return (
    <div style={{
      // ← [2026-05-06 Phase 4 사용자 보고 fix] flex 컬럼도 width를 minWidth로 활용
      //    이전: flex 시 minWidth: 0 → 부모 좁을 때 컬럼이 너무 작아짐 (텍스트 가독성 저하)
      //    변경: flex 시 minWidth: width ?? 0 → 최소 폭 보장 + 남은 공간 차지
      ...(flex ? { flex: 1, minWidth: width ?? 0 } : { width, flexShrink: 0 }),
      height: 60,
      padding: `${py}px ${px}px`,
      display: 'flex', alignItems: 'center',
      overflow: 'hidden',
    }}>{children}</div>
  )
}

// ─── 빈 상태 / 로딩 컨테이너 공통 스타일 ─────────────────────────────────
const emptyContainerStyle: React.CSSProperties = {
  flex: 1, minHeight: 306,                    // ← 426(전체) - 60(헤더) - 60(페이지네이션) = 306
  background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
