/**
 * AggregateTable.tsx — 드로어 집계 표 (회의실·부서·시간대·사용자·목적)
 *
 * [2026-07-24 #8] AdminPage.tsx 안의 AggTable 을 여기로 이동 + 시각 문법 통일
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 옮기고 다시 그렸나
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ① 배경이 비어 있었다
 *      드로어 본문 배경은 회색(#F1F5F9)인데 이 표는 **자기 배경이 없었다.**
 *      흰 카드 위에서 그린다는 전제로 만들어진 스타일(투명 행 + #F8FAFC 헤더)이라,
 *      회색 위에 얹히자 행 구분선이 배경에 묻히고 표 전체가 "떠 있는 글자 덩어리"로 보였다.
 *      → 표는 항상 자기 흰 카드를 갖는다. 바깥 div 에 색이 깔려 있어도 표 안쪽은 흰색이다.
 *
 *   ② 같은 드로어 안에서 두 가지 표 디자인이 섞였다
 *      예약 목록(BookingTable)은 Figma 2669:10396 문법(행 h60 · 헤더 #92A0BC ·
 *      구분선 #F6F9FE)인데, 집계 표는 예전 스타일(11px 헤더 · lucide 아이콘 · radius 10)
 *      이었다. 드릴다운으로 두 표를 오가는 화면이라 문법이 갈리면 다른 시스템처럼 보인다.
 *      → 헤더·행·구분선·정렬 아이콘을 BookingTable 과 동일하게 맞췄다.
 *
 *   ③ 도구 줄이 표 밖에 떠 있었다
 *      '총 N개'·CSV 가 회색 배경 위 맨몸으로 있어 표와 한 덩어리로 안 읽혔다.
 *      → 흰 카드 안 상단 스트립으로 넣는다.
 */

import { DT } from './DrawerShell'
import { IcoSortAlt, IcoDownload, IcoChevronForward } from './DrawerIcons'

export interface AggCol {
  k: string
  l: string
  fmt?: (v: any) => string
}

interface Props {
  rows: any[]
  cols: AggCol[]
  onExport: () => void
  /** 표 위 산정 기준 문구 (지표 단위가 섞인 표에서만) */
  note?: string
  onRowClick?: (row: any) => void
  onHeaderClick?: (key: string) => void
  activeSortKey?: string
  activeSortAsc?: boolean
}

const HEAD_H = 48
const ROW_H  = 56

export function AggregateTable({
  rows, cols, onExport, note, onRowClick, onHeaderClick, activeSortKey, activeSortAsc,
}: Props) {
  const canDrill = !!onRowClick
  const canSort  = !!onHeaderClick

  // 데이터가 없어도 흰 카드는 유지한다 — 빈 상태만 회색 위에 텍스트로 떨어지면
  // "로딩 중인지 없는 건지" 구분이 안 되고, 위 도구 줄과도 분리돼 보인다.
  return (
    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
      {/* ── 산정 기준 ── */}
      {note && (
        <div style={{
          fontFamily: DT.font, fontSize: 12, lineHeight: 1.6, color: DT.subText,
          background: '#F8FAFC', borderBottom: `1px solid ${DT.rowBorder}`,
          padding: '12px 16px',
        }}>{note}</div>
      )}

      {/* ── 도구 줄 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 16px', borderBottom: `1px solid ${DT.rowBorder}`, flexWrap: 'wrap',
      }}>
        <div style={{ fontFamily: DT.font, fontSize: 13, color: DT.subText }}>
          총 <b style={{ color: '#111' }}>{rows.length}</b>개
          {canDrill && (
            <span style={{ marginLeft: 8, fontSize: 12, color: DT.navLink }}>행 클릭 → 예약 목록</span>
          )}
        </div>
        <button className="btn" onClick={onExport}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, height: 32,
            padding: '0 10px 0 12px', borderRadius: 999, border: 'none',
            background: '#E2E2E2', cursor: 'pointer',
          }}>
          <span style={{
            fontFamily: DT.font, fontSize: 13, letterSpacing: '0.13px', color: '#787878', whiteSpace: 'nowrap',
          }}>CSV download</span>
          <IcoDownload size={18} />
        </button>
      </div>

      {/* ── 표 ── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr>
              {cols.map(c => {
                const active = canSort && activeSortKey === c.k
                return (
                  <th key={c.k}
                    onClick={canSort ? () => onHeaderClick!(c.k) : undefined}
                    style={{
                      height: HEAD_H, padding: '0 16px', textAlign: 'left', whiteSpace: 'nowrap',
                      borderBottom: `1px solid ${DT.tableBorder}`,
                      fontFamily: DT.font, fontWeight: 600, fontSize: 14,
                      color: active ? '#111' : DT.headText,
                      cursor: canSort ? 'pointer' : 'default', userSelect: 'none',
                    }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {c.l}
                      {canSort && (
                        <span style={{ display: 'inline-flex', opacity: active ? 1 : 0.55 }}>
                          <IcoSortAlt color={active ? '#111' : DT.headText} />
                        </span>
                      )}
                      {active && <span style={{ fontSize: 10, color: '#111' }}>{activeSortAsc ? '▲' : '▼'}</span>}
                    </span>
                  </th>
                )
              })}
              {canDrill && <th style={{ width: 40, borderBottom: `1px solid ${DT.tableBorder}` }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length + (canDrill ? 1 : 0)}
                  style={{
                    padding: '48px 0', textAlign: 'center',
                    fontFamily: DT.font, fontSize: 13, color: '#CBD5E1',
                  }}>데이터 없음</td>
              </tr>
            ) : rows.map((r, i) => (
              <tr key={i}
                onClick={() => onRowClick?.(r)}
                style={{
                  height: ROW_H, borderBottom: `1px solid ${DT.rowBorder}`,
                  cursor: canDrill ? 'pointer' : 'default', background: '#fff',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = canDrill ? '#F6F9FE' : '#FAFBFD' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}>
                {cols.map((c, ci) => (
                  <td key={c.k}
                    style={{
                      padding: '0 16px', whiteSpace: 'nowrap',
                      fontFamily: DT.font, fontSize: 14, lineHeight: 1.5,
                      // 첫 컬럼(이름·회의실·부서)은 식별자라 조금 더 강하게
                      fontWeight: ci === 0 ? 500 : 400,
                      color:      ci === 0 ? '#111' : DT.subText,
                    }}>{c.fmt ? c.fmt(r[c.k]) : r[c.k]}</td>
                ))}
                {canDrill && (
                  <td style={{ padding: '0 12px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex' }}><IcoChevronForward size={18} color="#C3C9D6" /></span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
