/**
 * MyResourceBookings.tsx — 마이페이지 '자원 예약' 탭 (Phase 4)
 *
 * MyBookLoans 패턴: 자체 fetch, 본인 이력(최근 90일 + 미반납 전체).
 * 시작 전 예약은 취소 가능(ConfirmDialog danger). 연체 행은 빨간 보더 + 안내.
 * 표시 상태는 utils/resourceStatus.ts 파생 (DB 저장 없음).
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 4 — 미리보기 승인분)
 *  - [2026-08-26] 행 클릭 → 상세 모달(ResourceBookingDetailModal) → [예약 변경] edit 모달 / [예약 취소]
 *      (취소 버튼은 행에서 제거 — 상세 모달로 단일화, 고지 지시)
 */

import { useCallback, useEffect, useState } from 'react'
import type { ResourceBooking } from '../../types/resource'

type MyRow = ResourceBooking & { resource_items?: { label: string; category?: { icon: string | null } | null } | null }  // ← [2026-08-21] 아이콘 조인
import type { ResourceCategory, ResourceItem } from '../../types/resource'
import { cancelResourceBooking, loadMyResourceBookings, loadResourceCategories, loadResourceItems } from '../../lib/resourceApi'
import { bookingDisplayStatus, fmtDueShort, fmtTimeShort, type ResourceBookingDisplayStatus } from '../../utils/resourceStatus'   // ← [2026-08-27] 판정식 SSOT
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ResourceName } from './ResourceIcon'  // ← [2026-08-21] 카테고리 SVG 아이콘 공통 표기
import { ResourceBookingDetailModal, RESOURCE_BOOKING_BADGE } from './ResourceBookingDetailModal'   // ← [2026-08-26] / [2026-08-27] 뱃지 SSOT
import { ResourceBookingModal } from './ResourceBookingModal'               // ← [2026-08-26] edit 모드

const FONT = "'Pretendard', -apple-system, sans-serif"

/** ← [2026-08-27] 판정·뱃지 SSOT: utils/resourceStatus + ResourceBookingDetailModal.RESOURCE_BOOKING_BADGE ('done' 폐지) */
type St = ResourceBookingDisplayStatus
const BADGE = RESOURCE_BOOKING_BADGE
const stOf = bookingDisplayStatus

interface Props {
  authUserId: string
  showToast:  (m: string) => void
  isMobile:   boolean
}

export function MyResourceBookings({ authUserId, showToast, isMobile }: Props) {
  const [rows, setRows] = useState<MyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelTarget, setCancelTarget] = useState<ResourceBooking | null>(null)
  const [busy, setBusy] = useState(false)
  // ← [2026-08-26] 상세·변경 — 카테고리(slot_step 등)·개체는 edit 모달용으로 별도 로드
  const [detail, setDetail]   = useState<ResourceBooking | null>(null)
  const [editing, setEditing] = useState<ResourceBooking | null>(null)
  const [categories, setCategories] = useState<ResourceCategory[]>([])
  const [items, setItems] = useState<ResourceItem[]>([])
  useEffect(() => {
    Promise.all([loadResourceCategories(), loadResourceItems()])
      .then(([cs, is]) => { setCategories(cs); setItems(is) })
      .catch(e => showToast(e instanceof Error ? e.message : '자원 정보를 불러오지 못했습니다.'))
  }, [showToast])

  const reload = useCallback(() => {
    loadMyResourceBookings(authUserId)
      .then(setRows)
      .catch(e => showToast(e instanceof Error ? e.message : '자원 예약을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [authUserId, showToast])
  useEffect(() => { reload() }, [reload])

  const now = new Date()
  // 진행형(연체·사용중·예약중) 먼저, 그 안에서는 최근순 유지
  const order: Record<St, number> = { overdue: 0, inuse: 1, upcoming: 2, returned: 3, cancelled: 4 }
  const sorted: MyRow[] = [...rows].sort((a, b) => order[stOf(a, now)] - order[stOf(b, now)])

  if (loading) return <p style={{ fontFamily: FONT, fontSize: 13, color: '#64748B' }}>불러오는 중…</p>
  if (rows.length === 0)
    return <p style={{ fontFamily: FONT, fontSize: 13, color: '#64748B' }}>자원 예약 이력이 없습니다.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: FONT }}>
      {sorted.map(b => {
        const st = stOf(b, now)
        const badge = BADGE[st]
        const dim = st === 'returned' || st === 'cancelled'
        const useDay = b.start_at.slice(0, 10)
        return (
          <div key={b.id} role="button" onClick={() => setDetail(b)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                     background: '#fff', borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                     border: st === 'overdue' ? '1px solid #FECACA' : '1px solid #E2E8F0',
                     opacity: dim ? 0.7 : 1, fontSize: isMobile ? 12 : 13, color: '#111' }}>{/* ← [2026-08-26] 행 클릭 = 상세 */}
            <span style={{ background: badge.bg, color: badge.fg, borderRadius: 6,
                           fontSize: 11, padding: '2px 7px' }}>{badge.label}</span>
            <ResourceName icon={(b as MyRow).resource_items?.category?.icon} size={14} gap={5}
              style={{ fontWeight: 500 }}>{(b as MyRow).resource_items?.label ?? `자원 #${b.item_id}`}</ResourceName>{/* ← [2026-08-21] 아이콘 */}
            <span style={{ color: st === 'overdue' ? '#B91C1C' : '#64748B' }}>
              {st === 'overdue'
                ? `${fmtDueShort(b.return_due)} 반납 예정이었습니다 — 관리자에게 반납해 주세요`
                : st === 'inuse' && now >= new Date(b.end_at)   /* ← [2026-08-27] 사용시간 종료 후: 반납 확인 전까지 점유 — 반납 안내 */
                ? `${fmtDueShort(useDay)} ${fmtTimeShort(b.start_at)}~${fmtTimeShort(b.end_at)} · ${fmtDueShort(b.return_due)} 반납 예정 — 관리자에게 반납해 주세요`
                : <>
                    {fmtDueShort(useDay)} {fmtTimeShort(b.start_at)}~{fmtTimeShort(b.end_at)}
                    {b.return_due !== useDay && ` · ${fmtDueShort(b.return_due)} 반납`}
                    {st === 'returned' && b.returned_at && ` · ${fmtDueShort(b.returned_at.slice(0, 10))} 반납 확인`}
                    {st === 'cancelled' && b.memo?.startsWith('[관리자취소]') && ` · ${b.memo}`}
                  </>}
            </span>
            <span style={{ flex: 1 }} />
            {(st === 'upcoming' || st === 'inuse' || st === 'overdue') && (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>상세 · 변경 ›</span>
            )}
          </div>
        )
      })}

      {/* ← [2026-08-26] 상세 모달 */}
      {detail && !editing && (() => {
        const item = items.find(i => i.id === detail.item_id)
        const cat  = categories.find(c => c.id === item?.category_id)
        const row  = detail as MyRow
        return (
          <ResourceBookingDetailModal
            booking={detail}
            itemLabel={row.resource_items?.label ?? item?.label ?? `자원 #${detail.item_id}`}
            categoryName={cat?.name ?? '자원'} categoryIcon={row.resource_items?.category?.icon ?? cat?.icon}
            holderLabel={detail.user_dept ? `${detail.user_name} · ${detail.user_dept}` : (detail.user_name ?? detail.user_email)}
            isMine isAdmin={false}
            onEdit={() => setEditing(detail)}
            onCancel={() => setCancelTarget(detail)}
            onClose={() => setDetail(null)}
          />
        )
      })()}
      {editing && (() => {
        const item = items.find(i => i.id === editing.item_id)
        const cat  = categories.find(c => c.id === item?.category_id)
        if (!cat) return null
        return (
          <ResourceBookingModal
            category={cat} items={items.filter(i => i.category_id === cat.id && i.status !== 'retired')}
            editBooking={editing}
            snapshot={{ user_name: editing.user_name ?? '', user_dept: editing.user_dept ?? '' }}
            showToast={showToast}
            onDone={() => { setEditing(null); setDetail(null); reload() }}
            onClose={() => setEditing(null)}
          />
        )
      })()}

      {cancelTarget && (
        <ConfirmDialog
          title="예약을 취소할까요?"
          message={`${fmtDueShort(cancelTarget.start_at.slice(0, 10))} ${fmtTimeShort(cancelTarget.start_at)}~${fmtTimeShort(cancelTarget.end_at)} 예약이 취소됩니다.`}
          confirmLabel="예약 취소" variant="danger" loading={busy}
          onConfirm={async () => {
            setBusy(true)
            try {
              await cancelResourceBooking(cancelTarget.id)
              showToast('예약이 취소되었습니다.')
              setCancelTarget(null); setDetail(null); reload()
            } catch (e) { showToast(e instanceof Error ? e.message : '취소에 실패했습니다.') }
            finally { setBusy(false) }
          }}
          onClose={() => { if (!busy) setCancelTarget(null) }}
        />
      )}
    </div>
  )
}
