/**
 * ResourceAdminPanel.tsx — 어드민 '자원 관리' 탭 (Phase 3)
 *
 * 구성 (미리보기 승인분):
 *  - 서브탭 3: 예약 현황 / 개체 관리 / 카테고리 관리
 *  - 대리예약 = 현황 우상단 버튼 (별도 탭 아님) — 예약자·개체 선택 후
 *    ResourceBookingModal(booker override) 재사용
 *  - 반납 확인 = 사용중·연체 행 핵심 액션 (ConfirmDialog, 실물 수령 확인)
 *  - 관리자 취소 = 시작 전 '예약중' 건만, 사유 입력 → memo '[관리자취소]' 기록
 *  - 개체 삭제 없음 — '폐기(retired)' 단일화 (고지 확정, 도서관 lost 패턴)
 *  - 카테고리 삭제 없음 — 비활성으로 숨김 (예약 이력 보존)
 *
 * 권한: RLS has_admin_role('resource') — 이 화면 진입 자체가 adminRoles 게이트 통과
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 3)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser } from '../../types'
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../../types/resource'
import {
  adminCancelResourceBooking, adminConfirmResourceReturn,
  loadResourceBookingsAdmin, loadResourceCategoriesAll, loadResourceItems,
  upsertResourceCategory, upsertResourceItem,
  type ResourceCategoryDraft, type ResourceItemDraft,
} from '../../lib/resourceApi'
import { fmtDueShort, fmtTimeShort, isOccupying, isResourceOverdue } from '../../utils/resourceStatus'
import { ResourceBookingModal } from '../resource/ResourceBookingModal'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { ResourceIcon, ResourceName, isSvgIcon } from '../resource/ResourceIcon'  // ← [2026-08-21] 카테고리 SVG 아이콘
import { ModalPortal } from '../common/ModalPortal'

const FONT = "'Pretendard', -apple-system, sans-serif"

type SubTab = 'bookings' | 'items' | 'categories'

/** 현황 행 파생 상태 */
type RowStatus = 'upcoming' | 'inuse' | 'overdue' | 'returned' | 'cancelled'
function rowStatus(b: ResourceBooking, now: Date): RowStatus {
  if (b.status === 'cancelled') return 'cancelled'
  if (b.returned_at)            return 'returned'
  if (isResourceOverdue(b, now)) return 'overdue'
  if (isOccupying(b, now))      return 'inuse'
  return 'upcoming'
}
const ROW_BADGE: Record<RowStatus, { label: string; bg: string; fg: string }> = {
  upcoming:  { label: '예약중',   bg: '#CBECFF', fg: '#111' },
  inuse:     { label: '사용중',   bg: '#FCE7F3', fg: '#BE185D' },
  overdue:   { label: '연체',     bg: '#FEE2E2', fg: '#B91C1C' },
  returned:  { label: '반납완료', bg: '#DCFCE7', fg: '#16A34A' },
  cancelled: { label: '취소',     bg: '#E2E8F0', fg: '#64748B' },
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10 }
const selS: React.CSSProperties = { background: '#fff', border: '1px solid #D1D7E1', borderRadius: 8,
  padding: '6px 10px', fontSize: 12, fontFamily: FONT, color: '#111' }
const inputS: React.CSSProperties = { ...selS, padding: '6px 8px' }
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', color: '#64748B',
  fontWeight: 400, fontSize: 12, background: '#F8FAFC' }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12, borderTop: '1px solid #F1F5F9' }
const btnDark: React.CSSProperties = { background: '#111', color: '#fff', border: 'none',
  borderRadius: 8, padding: '7px 14px', fontSize: 12, fontFamily: FONT, cursor: 'pointer' }
const btnLine: React.CSSProperties = { background: '#fff', color: '#111', border: '1px solid #111',
  borderRadius: 7, padding: '4px 10px', fontSize: 11, fontFamily: FONT, cursor: 'pointer' }
const btnDanger: React.CSSProperties = { ...btnLine, color: '#DC2626', border: '1px solid #FECACA' }

interface Props {
  users:         AppUser[]
  currentUserId: string
  showToast:     (msg: string) => void
  isMobile:      boolean
}

export function ResourceAdminPanel({ users, currentUserId, showToast, isMobile }: Props) {
  const [sub, setSub]               = useState<SubTab>('bookings')
  const [categories, setCategories] = useState<ResourceCategory[]>([])
  const [items, setItems]           = useState<ResourceItem[]>([])
  const [bookings, setBookings]     = useState<ResourceBooking[]>([])
  const [loading, setLoading]       = useState(true)

  // 현황 필터
  const [fCat, setFCat]       = useState<number | 0>(0)
  const [fDays, setFDays]     = useState(30)
  const [fStatus, setFStatus] = useState<RowStatus | 'all'>('all')

  // 액션 상태
  const [returnTarget, setReturnTarget] = useState<ResourceBooking | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ResourceBooking | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy]                 = useState(false)
  const [proxyOpen, setProxyOpen]       = useState(false)
  const [proxyUser, setProxyUser]       = useState<AppUser | null>(null)
  const [proxyItem, setProxyItem]       = useState<ResourceItem | null>(null)
  const [proxySearch, setProxySearch]   = useState('')
  const [proxyBooking, setProxyBooking] = useState<{ item: ResourceItem; cat: ResourceCategory; user: AppUser } | null>(null)
  const [editing, setEditing]           = useState<ResourceBooking | null>(null)   // ← [2026-08-26] 관리자 기한 변경

  const reload = useCallback(async (days = fDays) => {
    try {
      const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
      const [cs, is, bs] = await Promise.all([
        loadResourceCategoriesAll(), loadResourceItems(), loadResourceBookingsAdmin(from),
      ])
      setCategories(cs); setItems(is); setBookings(bs)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '자원 데이터를 불러오지 못했습니다.')
    } finally { setLoading(false) }
  }, [fDays, showToast])

  useEffect(() => { void reload() }, [reload])

  const now = new Date()
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const userName = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    const name = live?.name ?? b.user_name ?? b.user_email
    const dept = live?.dept ?? b.user_dept
    return dept ? `${name} · ${dept}` : name
  }

  const rows = useMemo(() => bookings
    .filter(b => fCat === 0 || itemById.get(b.item_id)?.category_id === fCat)
    .map(b => ({ b, st: rowStatus(b, now) }))
    .filter(r => fStatus === 'all' || r.st === fStatus),
    [bookings, fCat, fStatus, itemById, now])

  const exportCsv = () => {
    const head = '자원,예약자,사용시작,사용종료,반납일,상태,반납확인,메모'
    const body = rows.map(({ b, st }) => [
      itemById.get(b.item_id)?.label ?? b.item_id, userName(b),
      b.start_at, b.end_at, b.return_due, ROW_BADGE[st].label,
      b.returned_at ?? '', (b.memo ?? '').replace(/,/g, ' '),
    ].join(',')).join('\n')
    const blob = new Blob([`\uFEFF${head}\n${body}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `resource_bookings_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const subTabBtn = (id: SubTab, label: string) => (
    <button key={id} onClick={() => setSub(id)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT,
               padding: '8px 14px', fontSize: 13, color: sub === id ? '#111' : '#64748B',
               fontWeight: sub === id ? 500 : 400,
               borderBottom: sub === id ? '2px solid #111' : '2px solid transparent' }}>
      {label}
    </button>
  )

  return (
    <div style={{ fontFamily: FONT, color: '#111' }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0', marginBottom: 14 }}>
        {subTabBtn('bookings', '예약 현황')}
        {subTabBtn('items', '개체 관리')}
        {subTabBtn('categories', '카테고리 관리')}
      </div>

      {loading ? <p style={{ fontSize: 13, color: '#64748B' }}>불러오는 중…</p> : (
        <>
          {/* ── 예약 현황 ── */}
          {sub === 'bookings' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <select style={selS} value={fCat} onChange={e => setFCat(Number(e.target.value))} aria-label="카테고리 필터">
                  <option value={0}>전체 카테고리</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select style={selS} value={fDays} onChange={e => setFDays(Number(e.target.value))} aria-label="기간 필터">
                  <option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option>
                </select>
                <select style={selS} value={fStatus} onChange={e => setFStatus(e.target.value as RowStatus | 'all')} aria-label="상태 필터">
                  <option value="all">상태: 전체</option>
                  {(Object.keys(ROW_BADGE) as RowStatus[]).map(k =>
                    <option key={k} value={k}>{ROW_BADGE[k].label}</option>)}
                </select>
                <span style={{ flex: 1 }} />
                <button style={btnDark} onClick={() => { setProxyUser(null); setProxyItem(null); setProxySearch(''); setProxyOpen(true) }}>+ 대리예약</button>
                <button style={{ ...selS, cursor: 'pointer' }} onClick={exportCsv}>CSV</button>
              </div>

              <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 640 : undefined }}>
                  <thead><tr>
                    <th style={th}>자원</th><th style={th}>예약자</th><th style={th}>사용시간</th>
                    <th style={th}>반납일</th><th style={th}>상태</th>
                    <th style={{ ...th, textAlign: 'right' }}>액션</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(({ b, st }) => (
                      <tr key={b.id}>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {/* ← [2026-08-21] 소속 카테고리 아이콘 상속 (CSV 는 텍스트 유지) */}
                          <ResourceName icon={categories.find(c => c.id === itemById.get(b.item_id)?.category_id)?.icon} size={13} gap={5}>
                            {itemById.get(b.item_id)?.label ?? `#${b.item_id}`}
                          </ResourceName>
                        </td>
                        <td style={td}>{userName(b)}</td>
                        <td style={td}>{fmtDueShort(b.start_at.slice(0, 10))} {fmtTimeShort(b.start_at)}~{fmtTimeShort(b.end_at)}</td>
                        <td style={{ ...td, color: st === 'overdue' ? '#B91C1C' : undefined }}>{fmtDueShort(b.return_due)}</td>
                        <td style={td}>
                          <span style={{ background: ROW_BADGE[st].bg, color: ROW_BADGE[st].fg,
                                         borderRadius: 6, fontSize: 11, padding: '2px 6px' }}>{ROW_BADGE[st].label}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {(st === 'upcoming' || st === 'inuse' || st === 'overdue') && (
                            <button style={{ ...btnLine, marginRight: 6 }} onClick={() => setEditing(b)}>기한 변경</button>)}{/* ← [2026-08-26] */}
                          {(st === 'inuse' || st === 'overdue') && (
                            <button style={btnLine} onClick={() => setReturnTarget(b)}>반납 확인</button>)}
                          {st === 'upcoming' && (
                            <button style={{ ...btnDanger, marginLeft: 6 }} onClick={() => { setCancelReason(''); setCancelTarget(b) }}>취소</button>)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td style={{ ...td, color: '#64748B' }} colSpan={6}>조건에 맞는 예약이 없습니다.</td></tr>)}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── 개체 관리 ── */}
          {sub === 'items' && (
            <ItemsTab categories={categories} items={items} showToast={showToast} onSaved={() => void reload()} />
          )}

          {/* ── 카테고리 관리 ── */}
          {sub === 'categories' && (
            <CategoriesTab categories={categories} showToast={showToast} onSaved={() => void reload()} />
          )}
        </>
      )}

      {/* 반납 확인 — 실물 수령 (고지 확정: 물건을 받아야 종결) */}
      {returnTarget && (
        <ConfirmDialog
          title="반납을 확인할까요?"
          message={`${itemById.get(returnTarget.item_id)?.label} · ${userName(returnTarget)}\n실물을 수령하셨습니까? 확인 즉시 이 자원이 예약 가능 상태가 됩니다.`}
          confirmLabel="반납 확인" variant="neutral" loading={busy}
          onConfirm={async () => {
            setBusy(true)
            try {
              await adminConfirmResourceReturn(returnTarget.id, currentUserId)
              showToast('반납이 확인되었습니다.')
              setReturnTarget(null); void reload()
            } catch (e) { showToast(e instanceof Error ? e.message : '반납 확인에 실패했습니다.') }
            finally { setBusy(false) }
          }}
          onClose={() => { if (!busy) setReturnTarget(null) }}
        />
      )}

      {/* 관리자 취소 — 사유 입력 미니 모달 */}
      {cancelTarget && (
        <ModalPortal>
          <div onClick={() => { if (!busy) setCancelTarget(null) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} className="anm"
              style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 380,
                       padding: '22px 24px 20px', fontFamily: FONT }}>
              <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>예약을 취소할까요?</p>
              <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 12px' }}>
                {itemById.get(cancelTarget.item_id)?.label} · {userName(cancelTarget)} — 예약자에게 사유가 함께 표시됩니다.
              </p>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                maxLength={90} rows={2} placeholder="취소 사유 (필수)"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #D1D7E1', borderRadius: 8,
                         padding: 8, fontSize: 13, fontFamily: FONT, resize: 'none' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button style={{ ...btnLine, flex: 1, padding: '10px 0' }} disabled={busy}
                  onClick={() => setCancelTarget(null)}>닫기</button>
                <button
                  style={{ ...btnDark, flex: 1, padding: '10px 0', background: '#DC2626',
                           opacity: cancelReason.trim() && !busy ? 1 : 0.5 }}
                  disabled={!cancelReason.trim() || busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await adminCancelResourceBooking(cancelTarget.id, cancelReason)
                      showToast('예약이 취소되었습니다.')
                      setCancelTarget(null); void reload()
                    } catch (e) { showToast(e instanceof Error ? e.message : '취소에 실패했습니다.') }
                    finally { setBusy(false) }
                  }}>예약 취소</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* 대리예약 1단계 — 예약자·개체 선택 */}
      {proxyOpen && (
        <ModalPortal>
          <div onClick={() => setProxyOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} className="anm"
              style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 400,
                       padding: '22px 24px 20px', fontFamily: FONT }}>
              <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>대리예약</p>

              <p style={{ fontSize: 12, color: '#6B7684', margin: '0 0 6px' }}>예약자</p>
              {proxyUser ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ background: '#F2F4F6', borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
                    {proxyUser.name} · {proxyUser.dept}
                  </span>
                  <button style={{ ...btnLine, border: 'none', color: '#8B95A1' }} onClick={() => setProxyUser(null)}>변경</button>
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <input style={{ ...inputS, width: '100%', boxSizing: 'border-box' }} value={proxySearch}
                    onChange={e => setProxySearch(e.target.value)} placeholder="이름·부서·이메일 검색" />
                  {proxySearch.trim() && (
                    <div style={{ ...card, marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                      {users
                        .filter(u => (u.employment_status ?? 'active') === 'active')
                        .filter(u => [u.name, u.dept, u.email].join(' ').toLowerCase().includes(proxySearch.trim().toLowerCase()))
                        .slice(0, 8)
                        .map(u => (
                          <button key={u.user_id} onClick={() => setProxyUser(u)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
                                     border: 'none', borderBottom: '1px solid #F1F5F9', padding: '8px 10px',
                                     fontSize: 13, fontFamily: FONT, cursor: 'pointer' }}>
                            {u.name} <span style={{ color: '#64748B' }}>· {u.dept}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <p style={{ fontSize: 12, color: '#6B7684', margin: '0 0 6px' }}>자원</p>
              <select style={{ ...selS, width: '100%', marginBottom: 16 }}
                value={proxyItem?.id ?? ''} aria-label="자원 선택"
                onChange={e => setProxyItem(items.find(i => i.id === Number(e.target.value)) ?? null)}>
                <option value="">자원을 선택해 주세요</option>
                {categories.filter(c => c.is_active).map(c => (
                  <optgroup key={c.id} label={c.name}>
                    {items.filter(i => i.category_id === c.id && i.status === 'available')
                      .map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
                  </optgroup>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...btnLine, flex: 1, padding: '10px 0' }} onClick={() => setProxyOpen(false)}>닫기</button>
                <button style={{ ...btnDark, flex: 1, padding: '10px 0', opacity: proxyUser && proxyItem ? 1 : 0.5 }}
                  disabled={!proxyUser || !proxyItem}
                  onClick={() => {
                    const cat = categories.find(c => c.id === proxyItem!.category_id)
                    if (!cat) return
                    setProxyOpen(false)
                    setProxyBooking({ item: proxyItem!, cat, user: proxyUser! })
                  }}>다음 — 일정 선택</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* ← [2026-08-26] 관리자 기한 변경 — edit 모드 (30일 제한 면제, 알림 라벨 '(관리자 변경)') */}
      {editing && (() => {
        const cat = categories.find(c => c.id === itemById.get(editing.item_id)?.category_id)
        if (!cat) return null
        return (
          <ResourceBookingModal
            category={cat} items={items.filter(i => i.category_id === cat.id && i.status !== 'retired')}
            editBooking={editing} isAdmin
            snapshot={{ user_name: editing.user_name ?? '', user_dept: editing.user_dept ?? '' }}
            showToast={showToast}
            onDone={() => { setEditing(null); void reload() }}
            onClose={() => setEditing(null)}
          />
        )
      })()}

      {/* 대리예약 2단계 — Figma 예약 모달 재사용 (booker override) */}
      {proxyBooking && (
        <ResourceBookingModal
          initialItem={proxyBooking.item} category={proxyBooking.cat} isAdmin
          items={items.filter(i => i.category_id === proxyBooking.cat.id && i.status !== 'retired')}
          snapshot={{ user_name: proxyBooking.user.name, user_dept: proxyBooking.user.dept }}
          booker={{ user_id: proxyBooking.user.user_id, email: proxyBooking.user.email }}
          showToast={showToast}
          onDone={() => { setProxyBooking(null); void reload() }}
          onClose={() => setProxyBooking(null)}
        />
      )}
    </div>
  )
}

/* ── 개체 관리 서브탭 ─────────────────────────────────────────────────────── */

function ItemsTab({ categories, items, showToast, onSaved }: {
  categories: ResourceCategory[]; items: ResourceItem[]
  showToast: (m: string) => void; onSaved: () => void
}) {
  const [catId, setCatId] = useState<number | 0>(categories.find(c => c.is_active)?.id ?? 0)
  const [drafts, setDrafts] = useState<Record<number, ResourceItemDraft>>({})
  const [adding, setAdding] = useState<ResourceItemDraft | null>(null)
  const [retireTarget, setRetireTarget] = useState<ResourceItem | null>(null)
  const [busy, setBusy] = useState(false)

  const visible = items.filter(i => (catId === 0 || i.category_id === catId) && i.status !== 'retired')
  const draftOf = (i: ResourceItem): ResourceItemDraft =>
    drafts[i.id] ?? { id: i.id, category_id: i.category_id, label: i.label, asset_code: i.asset_code, status: i.status }
  const setDraft = (id: number, d: ResourceItemDraft) => setDrafts(prev => ({ ...prev, [id]: d }))

  const save = async (d: ResourceItemDraft) => {
    if (!d.label.trim()) { showToast('라벨을 입력해 주세요.'); return }
    setBusy(true)
    try {
      await upsertResourceItem(d)
      showToast('저장되었습니다.')
      setAdding(null); setDrafts(prev => { const n = { ...prev }; if (d.id) delete n[d.id]; return n })
      onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <select style={selS} value={catId} onChange={e => setCatId(Number(e.target.value))} aria-label="카테고리 선택">
          <option value={0}>전체 카테고리</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (비활성)'}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button style={btnDark}
          onClick={() => setAdding({ category_id: catId || (categories[0]?.id ?? 0), label: '', asset_code: null, status: 'available' })}
          disabled={categories.length === 0}>+ 개체 추가</button>
      </div>
      {categories.length === 0 && (
        <p style={{ fontSize: 13, color: '#64748B' }}>먼저 카테고리 관리에서 카테고리를 등록해 주세요.</p>)}
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>라벨</th><th style={th}>자산번호</th><th style={th}>카테고리</th>
            <th style={th}>상태</th><th style={{ ...th, textAlign: 'right' }}>액션</th>
          </tr></thead>
          <tbody>
            {adding && (
              <tr>
                <td style={td}><input style={inputS} value={adding.label} placeholder="P-01" autoFocus
                  onChange={e => setAdding({ ...adding, label: e.target.value })} /></td>
                <td style={td}><input style={inputS} value={adding.asset_code ?? ''} placeholder="CNR-PT-001"
                  onChange={e => setAdding({ ...adding, asset_code: e.target.value || null })} /></td>
                <td style={td}>
                  <select style={selS} value={adding.category_id} aria-label="카테고리"
                    onChange={e => setAdding({ ...adding, category_id: Number(e.target.value) })}>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td style={td}>사용 가능</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button style={btnLine} disabled={busy} onClick={() => void save(adding)}>저장</button>{' '}
                  <button style={{ ...btnLine, border: '1px solid #D1D7E1', color: '#64748B' }}
                    onClick={() => setAdding(null)}>취소</button>
                </td>
              </tr>
            )}
            {visible.map(i => {
              const d = draftOf(i)
              const dirty = d.label !== i.label || (d.asset_code ?? '') !== (i.asset_code ?? '') || d.status !== i.status
              return (
                <tr key={i.id}>
                  <td style={td}><input style={inputS} value={d.label}
                    onChange={e => setDraft(i.id, { ...d, label: e.target.value })} /></td>
                  <td style={td}><input style={inputS} value={d.asset_code ?? ''}
                    onChange={e => setDraft(i.id, { ...d, asset_code: e.target.value || null })} /></td>
                  <td style={td}>{categories.find(c => c.id === i.category_id)?.name ?? '-'}</td>
                  <td style={td}>
                    <select style={selS} value={d.status} aria-label="상태"
                      onChange={e => setDraft(i.id, { ...d, status: e.target.value as ResourceItemDraft['status'] })}>
                      <option value="available">사용 가능</option>
                      <option value="maintenance">점검중</option>
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={{ ...btnLine, opacity: dirty ? 1 : 0.4 }} disabled={!dirty || busy}
                      onClick={() => void save(d)}>저장</button>{' '}
                    <button style={btnDanger} disabled={busy} onClick={() => setRetireTarget(i)}>폐기</button>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && !adding && (
              <tr><td style={{ ...td, color: '#64748B' }} colSpan={5}>등록된 개체가 없습니다.</td></tr>)}
          </tbody>
        </table>
      </div>

      {retireTarget && (
        <ConfirmDialog
          title={`${retireTarget.label}을(를) 폐기할까요?`}
          message="폐기하면 예약 화면에서 사라지며 예약 이력은 보존됩니다. 삭제 대신 폐기로만 정리합니다 — 되돌리려면 관리자에게 문의가 필요합니다."
          confirmLabel="폐기" variant="danger" loading={busy}
          onConfirm={() => void save({ id: retireTarget.id, category_id: retireTarget.category_id,
            label: retireTarget.label, asset_code: retireTarget.asset_code, status: 'retired' })
            .then(() => setRetireTarget(null))}
          onClose={() => { if (!busy) setRetireTarget(null) }}
        />
      )}
    </>
  )
}

/* ── 카테고리 관리 서브탭 ────────────────────────────────────────────────── */

function CategoriesTab({ categories, showToast, onSaved }: {
  categories: ResourceCategory[]; showToast: (m: string) => void; onSaved: () => void
}) {
  const empty: ResourceCategoryDraft = { name: '', slot_step_minutes: 60, allow_multi_day: true,
    open_time: '07:00', close_time: '19:00', is_active: true, icon: null }  // ← [2026-08-21] icon
  const [drafts, setDrafts] = useState<Record<number, ResourceCategoryDraft>>({})
  const [adding, setAdding] = useState<ResourceCategoryDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const draftOf = (c: ResourceCategory): ResourceCategoryDraft =>
    drafts[c.id] ?? { id: c.id, name: c.name, slot_step_minutes: c.slot_step_minutes,
      allow_multi_day: c.allow_multi_day, open_time: c.open_time.slice(0, 5),
      close_time: c.close_time.slice(0, 5), is_active: c.is_active, icon: c.icon ?? null }  // ← [2026-08-21] icon 동반 — 없으면 저장 시 NULL 로 소실
  const setDraft = (id: number, d: ResourceCategoryDraft) => setDrafts(prev => ({ ...prev, [id]: d }))

  const save = async (d: ResourceCategoryDraft) => {
    if (!d.name.trim()) { showToast('카테고리 이름을 입력해 주세요.'); return }
    if (d.open_time >= d.close_time) { showToast('운영 종료는 시작보다 늦어야 합니다.'); return }
    // ← [2026-08-21] 아이콘 검증 — SVG 원문만 허용(<svg 시작) · 10KB 이하 (data-URI img 렌더 전제)
    if (d.icon && !isSvgIcon(d.icon)) { showToast('아이콘은 <svg 로 시작하는 SVG 코드여야 합니다.'); return }
    if (d.icon && d.icon.length > 10240) { showToast('아이콘 SVG 는 10KB 이하여야 합니다.'); return }
    setBusy(true)
    try {
      await upsertResourceCategory(d)
      showToast('저장되었습니다.')
      setAdding(null); setDrafts(prev => { const n = { ...prev }; if (d.id) delete n[d.id]; return n })
      onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }

  const rowInputs = (d: ResourceCategoryDraft, set: (d: ResourceCategoryDraft) => void, actions: React.ReactNode) => (
    <>
      {/* ← [2026-08-21] SVG 아이콘 — 미리보기 + .svg 파일 선택 + 코드 붙여넣기 겸용 (미리보기 승인 UI) */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 30, height: 30, border: '1px solid #E2E8F0', borderRadius: 8,
                         display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                         background: '#fff', flexShrink: 0 }}>
            {isSvgIcon(d.icon) ? <ResourceIcon icon={d.icon} size={16} /> : <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>}
          </span>
          <label style={{ border: '1px dashed #CBD5E1', borderRadius: 8, padding: '5px 8px', fontSize: 11,
                          color: '#64748B', background: '#F8FAFC', cursor: 'pointer', flexShrink: 0 }}>
            .svg 파일
            <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} aria-label="SVG 아이콘 파일"
              onChange={e => {
                const f = e.target.files?.[0]; e.target.value = ''   // 같은 파일 재선택 허용
                if (!f) return
                const r = new FileReader()
                r.onload = () => set({ ...d, icon: String(r.result ?? '') })
                r.readAsText(f)
              }} />
          </label>
          <input style={{ ...inputS, width: 110 }} value={d.icon ?? ''} placeholder="<svg …> 붙여넣기"
            aria-label="SVG 아이콘 코드"
            onChange={e => set({ ...d, icon: e.target.value || null })} />
          {d.icon && <button style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 12, padding: 0 }}
            aria-label="아이콘 제거" onClick={() => set({ ...d, icon: null })}>✕</button>}
        </span>
      </td>
      <td style={td}><input style={inputS} value={d.name} placeholder="레이저 포인터"
        onChange={e => set({ ...d, name: e.target.value })} /></td>
      <td style={td}>
        <select style={selS} value={d.slot_step_minutes} aria-label="시간 단위"
          onChange={e => set({ ...d, slot_step_minutes: Number(e.target.value) })}>
          <option value={15}>15분</option><option value={30}>30분</option><option value={60}>1시간</option>
        </select>
      </td>
      <td style={td}>
        <select style={selS} value={d.allow_multi_day ? '1' : '0'} aria-label="복수일 반납"
          onChange={e => set({ ...d, allow_multi_day: e.target.value === '1' })}>
          <option value="1">허용</option><option value="0">당일 반납</option>
        </select>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <input type="time" style={{ ...inputS, width: 90 }} value={d.open_time} aria-label="운영 시작"
          onChange={e => set({ ...d, open_time: e.target.value })} />
        {' ~ '}
        <input type="time" style={{ ...inputS, width: 90 }} value={d.close_time} aria-label="운영 종료"
          onChange={e => set({ ...d, close_time: e.target.value })} />
      </td>
      <td style={td}>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={d.is_active}
            onChange={e => set({ ...d, is_active: e.target.checked })} /> 활성
        </label>
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{actions}</td>
    </>
  )

  return (
    <>
      <div style={{ display: 'flex', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#64748B', alignSelf: 'center' }}>
          삭제 없음 — 비활성으로 숨기면 예약 화면에서 사라지고 이력은 보존됩니다.
        </span>
        <span style={{ flex: 1 }} />
        <button style={btnDark} onClick={() => setAdding({ ...empty })}>+ 카테고리 추가</button>
      </div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>{/* ← [2026-08-21] 아이콘 컬럼 추가 680→880 */}
          <thead><tr>
            <th style={th}>아이콘</th><th style={th}>이름</th><th style={th}>시간 단위</th><th style={th}>복수일 반납</th>{/* ← [2026-08-21] 아이콘 컬럼 */}
            <th style={th}>운영시간</th><th style={th}>노출</th><th style={{ ...th, textAlign: 'right' }}>액션</th>
          </tr></thead>
          <tbody>
            {adding && (
              <tr>{rowInputs(adding, setAdding, <>
                <button style={btnLine} disabled={busy} onClick={() => void save(adding)}>저장</button>{' '}
                <button style={{ ...btnLine, border: '1px solid #D1D7E1', color: '#64748B' }}
                  onClick={() => setAdding(null)}>취소</button>
              </>)}</tr>
            )}
            {categories.map(c => {
              const d = draftOf(c)
              return <tr key={c.id} style={{ opacity: d.is_active ? 1 : 0.6 }}>
                {rowInputs(d, nd => setDraft(c.id, nd),
                  <button style={btnLine} disabled={busy} onClick={() => void save(d)}>저장</button>)}
              </tr>
            })}
            {categories.length === 0 && !adding && (
              <tr><td style={{ ...td, color: '#64748B' }} colSpan={7}>{/* ← [2026-08-21] 아이콘 컬럼 추가로 6→7 */}
                등록된 카테고리가 없습니다. 첫 카테고리를 추가해 주세요.</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  )
}
