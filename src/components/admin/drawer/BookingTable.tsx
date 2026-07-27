/**
 * BookingTable.tsx — 회의실 예약 목록 표 (Figma 2669:10396)
 *
 * [2026-07-24] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★ 컬럼 순서는 고정이다 — 고지 지시 [2026-07-24]
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     회의 · 회의실 · 회의 날짜(요일 포함) · 시간 · 예약자 · 상태
 *
 *   이 순서는 화면마다 달라지면 안 된다. 예약 목록이 드로어·승인 관리·마이페이지
 *   여러 곳에 나오는데 순서가 제각각이면 같은 표를 매번 다시 읽어야 한다.
 *   그래서 순서를 컴포넌트 밖에서 조립하지 않고 **여기 BOOKING_COLUMNS 배열 하나**로
 *   못 박는다. 호출부는 어떤 컬럼을 켤지만 고르고, 순서에는 관여하지 못한다.
 *
 *   생성일은 Figma(2669:10397) 배치대로 **'회의 날짜'와 '시간' 사이**에 둔다.
 *   [2026-07-24 고지 확정] 처음엔 6개 순서를 깨지 않으려 맨 뒤로 뺐었는데,
 *   날짜 두 개(회의 날짜·생성일)가 표 양 끝으로 갈라져 비교가 안 되는 배치였다.
 *   날짜끼리 붙어 있어야 "언제 잡았고 언제 하는 회의인지"가 한눈에 읽힌다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 1:1 사양
 * ═══════════════════════════════════════════════════════════════════════════
 *   표          bg #fff · 상단 radius 16
 *   헤더 행     h60 · border-bottom 1px #D9E4F7 · 글자 SemiBold 14 #92A0BC
 *               정렬 가능 컬럼은 라벨 뒤 sync_alt 20 (rotate 90)
 *   데이터 행   h60 · border-bottom 1px #F6F9FE
 *   컬럼 폭     회의 320 / 회의실 200 / 회의 날짜 164 / 시간 160 / 예약자 124 / 상태 200
 *               (+ 생성일 164 — 선택)
 *   좌우 padding 회의·회의실·예약자 14 / 회의 날짜·시간 16 / 상태 32
 */

import type { Booking, Room, AppUser } from '../../../types'
import { PurposeChip } from '../../common/PurposeChip'  // ← [2026-07-27 목적 Phase 3]
import { fmtTSDateFull, fmtTSRangeFull, tsDate } from '../../../utils/time'
import { BookingStatusBadge } from '../../common/BookingStatusBadge'
import { DT } from './DrawerShell'
import { IcoSortAlt } from './DrawerIcons'

/** 컬럼 식별자 — 정렬 키로도 쓴다 */
export type BookingColKey = 'purpose' | 'title' | 'room' | 'date' | 'time' | 'user' | 'status' | 'created'  // ← [2026-07-27 목적 Phase 3] purpose 추가

interface ColDef {
  key:      BookingColKey
  label:    string
  width:    number
  padX:     number
  /** 정렬 가능 여부 (Figma: 회의·회의실·회의 날짜·생성일만 sync_alt 표시) */
  sortable: boolean
  /** 실제 정렬에 쓰는 Booking 필드 */
  sortField?: string
}

/**
 * ★ 순서 SSOT — 이 배열의 순서가 곧 화면 순서다.
 *   'created'(생성일)만 맨 뒤에 있고 나머지 6개는 고지가 지정한 순서 그대로다.
 */
export const BOOKING_COLUMNS: ColDef[] = [
  // ← [2026-07-27 목적 Phase 3] 목적 컬럼 신설 (고지 확정 스코프) — 캘린더 카드와 동일하게 회의 앞 배치
  { key: 'purpose', label: '목적',      width: 110, padX: 14, sortable: true,  sortField: 'purpose'   },
  { key: 'title',   label: '회의',      width: 320, padX: 14, sortable: true,  sortField: 'title'     },
  { key: 'room',    label: '회의실',    width: 200, padX: 14, sortable: true,  sortField: 'room_id'   },
  { key: 'date',    label: '회의 날짜', width: 164, padX: 16, sortable: true,  sortField: 'start_at'  },
  { key: 'created', label: '생성일',    width: 164, padX: 16, sortable: true,  sortField: 'createdAt' },
  { key: 'time',    label: '시간',      width: 160, padX: 16, sortable: false                          },
  { key: 'user',    label: '예약자',    width: 124, padX: 14, sortable: false                          },
  { key: 'status',  label: '상태',      width: 200, padX: 32, sortable: false                          },
]

const CELL_H = 60

const cellBase = (c: ColDef): React.CSSProperties => ({
  width: c.width, flexShrink: 0, height: CELL_H,
  padding: `10px ${c.padX}px`,
  display: 'flex', alignItems: 'center',
})

const txt = (weight: number, color: string): React.CSSProperties => ({
  fontFamily: DT.font, fontWeight: weight, fontSize: 14, lineHeight: 1.5, color,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
})

interface Props {
  rows:   Booking[]
  rooms:  Room[]
  users:  AppUser[]
  sortKey:   string
  sortAsc:   boolean
  onSort:    (field: string) => void
  onRowClick?: (b: Booking) => void
  currentUserId?:    string
  currentUserEmail?: string
}

export function BookingTable({
  rows, rooms, users,
  sortKey, sortAsc, onSort, onRowClick,
  currentUserId = '', currentUserEmail = '',
}: Props) {
  // ← [2026-07-24] 컬럼은 Figma 원본 7개 전부 상시 노출. 조건부로 숨기면
  //   같은 표가 진입 경로에 따라 열 수가 달라져 "왜 열이 다르지" 가 된다.
  const cols = BOOKING_COLUMNS
  const minW = cols.reduce((s, c) => s + c.width, 0)

  return (
    <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 16 }}>
      <div style={{ minWidth: minW }}>
        {/* ── 헤더 행 ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', background: '#fff',
          borderBottom: `1px solid ${DT.tableBorder}`,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
        }}>
          {cols.map(c => {
            const active = !!c.sortField && sortKey === c.sortField
            return (
              <div key={c.key}
                onClick={c.sortField ? () => onSort(c.sortField!) : undefined}
                style={{ ...cellBase(c), gap: 8, cursor: c.sortField ? 'pointer' : 'default', userSelect: 'none' }}>
                <span style={txt(600, active ? '#111' : DT.headText)}>{c.label}</span>
                {c.sortable && (
                  <span style={{ display: 'flex', alignItems: 'center', opacity: active ? 1 : 0.55 }}>
                    <IcoSortAlt color={active ? '#111' : DT.headText} />
                  </span>
                )}
                {/* 활성 컬럼의 방향 — 아이콘만으로는 오름/내림을 알 수 없다 */}
                {active && (
                  <span style={{ fontFamily: DT.font, fontSize: 10, color: '#111' }}>{sortAsc ? '▲' : '▼'}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* ── 데이터 행 ── */}
        {rows.length === 0 ? (
          <div style={{
            padding: '48px 0', textAlign: 'center',
            fontFamily: DT.font, fontSize: 13, color: '#CBD5E1',
          }}>조건에 맞는 예약이 없습니다</div>
        ) : rows.map(b => {
          const room  = rooms.find(r => r.room_id === b.room_id)
          // 예약자 표시는 users 배열 live 우선, 스냅샷 fallback (프로젝트 live-first 원칙)
          const owner = users.find(u => u.user_id === b.user_id)
          const name  = owner?.name ?? b.user ?? '—'
          const avatar = (owner as any)?.avatar_url ?? null
          return (
            <div key={b.id}
              onClick={() => onRowClick?.(b)}
              style={{
                display: 'flex', alignItems: 'flex-start', background: '#fff',
                borderBottom: `1px solid ${DT.rowBorder}`,
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = '#FAFBFD' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}>
              {cols.map(c => {
                const cs = cellBase(c)
                switch (c.key) {
                  case 'purpose':   // ← [2026-07-27 목적 Phase 3] 칩 표시, NULL(도입 전 예약)은 '—'
                    return <div key={c.key} style={cs}>{b.purpose ? <PurposeChip purpose={b.purpose} size="row" /> : <span style={txt(400, '#C3CBD9')}>—</span>}</div>
                  case 'title':
                    return <div key={c.key} style={cs}><span style={txt(500, '#111')}>{b.title || '—'}</span></div>
                  case 'room':
                    return <div key={c.key} style={cs}><span style={txt(400, '#111')}>{room?.room_name ?? '—'}</span></div>
                  case 'date':
                    return <div key={c.key} style={cs}><span style={txt(500, DT.subText)}>{fmtTSDateFull(b.start_at)}</span></div>
                  case 'time':
                    return <div key={c.key} style={{ ...cs, gap: 4 }}>
                      <span style={txt(400, DT.subText)}>{fmtTSRangeFull(b.start_at, b.end_at)}</span>
                    </div>
                  case 'user':
                    return (
                      <div key={c.key} style={cs}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          {/* Figma: 20px 원형 · 검정 배경 · 이니셜 10px #E7E7E7 */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 1000, flexShrink: 0,
                            background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden',
                          }}>
                            {avatar
                              ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <span style={{ fontFamily: DT.font, fontWeight: 400, fontSize: 10, lineHeight: 1.3, color: '#E7E7E7' }}>
                                  {name.charAt(0)}
                                </span>}
                          </div>
                          <span style={{ ...txt(400, '#111'), lineHeight: 1.3 }}>{name}</span>
                        </div>
                      </div>
                    )
                  case 'status':
                    return (
                      <div key={c.key} style={cs}>
                        <BookingStatusBadge
                          booking={b} room={room} isAdminRoom={!!room?.is_admin_only} size="sm"
                          currentUserId={currentUserId} currentUserEmail={currentUserEmail}
                        />
                      </div>
                    )
                  case 'created':
                    return (
                      <div key={c.key} style={cs}>
                        <span style={txt(400, DT.subText)}>
                          {b.createdAt ? tsDate(new Date(b.createdAt).toISOString()) : '—'}
                        </span>
                      </div>
                    )
                  default:
                    return null
                }
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
