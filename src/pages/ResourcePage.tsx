/**
 * ResourcePage.tsx — 자원예약 사용자 화면
 *
 * 구성 (2026-08-26 미리보기 승인 — 세로 스택)
 *  - sticky 헤더: 제목 · [나의 자원 예약] · [＋ 자원예약](데스크톱) — 모바일은 우하단 FAB
 *  - 카테고리 칩 1곳(3뷰 공통, 2개 이상일 때만)
 *  - ① 개체 카드 그리드 → ② 타임라인 → ③ 캘린더 순서로 한 페이지에 전부 펼침(모바일 포함)
 *  - 카드 클릭: 예약가능 = 개체 프리필 생성 / 내가 홀더(사용중·연체) = 상세 모달
 *  - 타임라인 빈 슬롯 = 개체·날짜·시작 프리필 / 예약 블록 = 상세
 *  - 캘린더(B안): 날짜 클릭 = 리스트 패널, 패널 [이 날짜에 예약] = 날짜 프리필, 항목 클릭 = 상세
 *  - 상세 모달 [예약 변경] → ResourceBookingModal edit / [예약 취소] → ConfirmDialog (시작 전·본인)
 *
 * 데이터 원칙
 *  - 예약은 페이지가 1회 로드해 3뷰가 공유: 현재성 버퍼(loadResourceBookings — 카드·연체) ∪ 표시 범위
 *    (loadResourceBookingsRange — 캘린더 월-14일 ~ 익월 + 타임라인 날짜 ±) 를 id 로 병합
 *  - 상태는 저장하지 않고 파생 (utils/resourceStatus.ts SSOT)
 *  - 대여자 live 정보는 users 풀 lookup, 스냅샷(user_name/dept)은 퇴사자 폴백
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A) / 2B 세그먼트 뷰 / Phase 4 내 예약 섹션 이관
 *  - [2026-08-26] 세로 스택 + 고정 예약 버튼 + 상세 모달 + 기한 변경 + 단일 로드 (미리보기 승인)
 *  - [2026-08-26] 헤더 배경 흰색 → 투명 (하단 hairline 제거, blur 로 스크롤 겹침 방지)
 *  - [2026-08-27] '오늘 예약 있음' 날짜 비교 UTC slice → KST (kstDay)
 *  - [2026-09-02] 생성 모달 me/users 전달 — 관리자 예약자 지정(대리예약)을 모달 내부로 (snapshot prop 제거)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppUser } from '../types'
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../types/resource'
import { adminConfirmResourceReturn, cancelResourceBooking, loadResourceBookings, loadResourceBookingsRange, loadResourceCategories,
         loadResourceItems } from '../lib/resourceApi'
import { loadMyAdminRoles } from '../lib/api'   // ← [2026-08-26] 자원 관리자 판정 (30일 제한 면제·타인 예약 변경)
import { currentHolderBooking, deriveItemStatus, fmtDueShort, fmtTimeShort, isResourceOverdue, kstDay, nextBooking, type ResourceDisplayStatus } from '../utils/resourceStatus'   // ← [2026-08-27] kstDay
import { ResourceBookingModal, bookerOfBooking } from '../components/resource/ResourceBookingModal'
import { ResourceBookingDetailModal } from '../components/resource/ResourceBookingDetailModal'   // ← [2026-08-26]
import { ResourceName } from '../components/resource/ResourceIcon'
import { ResourceTimelineView } from '../components/resource/ResourceTimelineView'
import { ResourceCalendarView } from '../components/resource/ResourceCalendarView'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { todayStr } from '../utils/time'

const FONT = "'Pretendard', -apple-system, sans-serif"

const BADGE: Record<ResourceDisplayStatus, { label: string; bg: string; fg: string }> = {
  available:   { label: '예약가능', bg: '#D5F0FF', fg: '#111' },
  inuse:       { label: '사용중',   bg: '#FCE7F3', fg: '#BE185D' },
  overdue:     { label: '연체',     bg: '#FEE2E2', fg: '#B91C1C' },
  maintenance: { label: '점검중',   bg: '#E2E8F0', fg: '#64748B' },
  retired:     { label: '폐기',     bg: '#E2E8F0', fg: '#64748B' },
}

interface Props {
  users:      AppUser[]
  authUserId: string
  showToast:  (msg: string) => void
  isMobile:   boolean
  onGoMyResources: () => void
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function atLocal(ymd: string): Date { return new Date(`${ymd}T00:00:00`) }

/** 생성 모달 프리필 — 진입점별로 채워지는 필드가 다르다 */
type Prefill = { item?: ResourceItem | null; date?: string; startHM?: string }

export function ResourcePage({ users, authUserId, showToast, isMobile, onGoMyResources }: Props) {
  const [categories, setCategories] = useState<ResourceCategory[]>([])
  const [items, setItems]           = useState<ResourceItem[]>([])
  const [bookings, setBookings]     = useState<ResourceBooking[]>([])
  const [loading, setLoading]       = useState(true)
  const [catId, setCatId]           = useState<number | null>(null)
  const [isAdmin, setIsAdmin]       = useState(false)
  // ← [2026-09-02] 로그인 사용자 → 모달 기본 예약자(본인). users 미로드/부재 시 빈 스냅샷(기존 동작 동일)
  const me = useMemo(() => {
    const u = users.find(x => x.user_id === authUserId)
    return { user_id: authUserId, email: u?.email ?? '', name: u?.name ?? '', dept: u?.dept ?? '', avatar_url: u?.avatar_url ?? null }
  }, [users, authUserId])
  const todayYmd = todayStr()
  const [tlDate, setTlDate] = useState(todayYmd)
  const [calYM, setCalYM]   = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  // 모달 상태 — 생성 프리필 / 상세 / 변경 / 취소
  const [prefill, setPrefill]   = useState<Prefill | null>(null)
  const [detail, setDetail]     = useState<ResourceBooking | null>(null)
  const [editing, setEditing]   = useState<ResourceBooking | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ResourceBooking | null>(null)
  const [returnTarget, setReturnTarget] = useState<ResourceBooking | null>(null)   // ← [2026-08-26] 관리자 반납 확인
  const [busy, setBusy]         = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadMyAdminRoles(authUserId).then(r => setIsAdmin(r.includes('resource') || r.includes('super'))).catch(() => {})
  }, [authUserId])

  /** 3뷰 공유 범위 — 캘린더 월(-14일~익월 1일) ∪ 타임라인 날짜(-14일~+1일) */
  const range = useMemo(() => {
    const mFrom = new Date(calYM.y, calYM.m, -14), mTo = new Date(calYM.y, calYM.m + 1, 1)
    const tFrom = atLocal(shiftDate(tlDate, -14)), tTo = atLocal(shiftDate(tlDate, 1))
    return { from: new Date(Math.min(mFrom.getTime(), tFrom.getTime())).toISOString(),
             to:   new Date(Math.max(mTo.getTime(), tTo.getTime())).toISOString() }
  }, [calYM, tlDate])

  const reload = useCallback(async () => {
    try {
      const [cs, is, cur, rng] = await Promise.all([
        loadResourceCategories(), loadResourceItems(), loadResourceBookings(),
        loadResourceBookingsRange(range.from, range.to),
      ])
      setCategories(cs)
      setItems(is)
      const merged = new Map<string, ResourceBooking>()
      for (const b of [...cur, ...rng]) merged.set(b.id, b)
      setBookings([...merged.values()].sort((a, b) => a.start_at.localeCompare(b.start_at)))
      setCatId(prev => prev ?? cs[0]?.id ?? null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '자원 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [showToast, range])

  useEffect(() => { void reload() }, [reload])

  const now = new Date()
  const holderLabel = (b: ResourceBooking): string => {
    const live = users.find(u => u.user_id === b.user_id)
    const name = live?.name ?? b.user_name ?? b.user_email
    const dept = live?.dept ?? b.user_dept
    return dept ? `${name} · ${dept}` : name
  }

  const visibleItems = useMemo(
    () => items.filter(i => i.status !== 'retired' && (catId == null || i.category_id === catId)),
    [items, catId],
  )
  const activeCat = categories.find(c => c.id === catId) ?? null
  const itemById  = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const catOf     = (b: ResourceBooking) => categories.find(c => c.id === itemById.get(b.item_id)?.category_id) ?? activeCat

  const summary = (item: ResourceItem, st: ResourceDisplayStatus): { who?: string; line: string } => {
    if (st === 'maintenance') return { line: '선택 불가' }
    const holder = currentHolderBooking(bookings, item.id, now)
    if (holder) {
      const due = fmtDueShort(holder.return_due)
      return isResourceOverdue(holder, now)
        ? { who: holderLabel(holder), line: `${due} 반납 예정이었음` }
        : { who: holderLabel(holder), line: `~${due} 반납 예정` }   // ← [2026-08-27] 당일 건도 반납 확인 전까지 점유 — 문구 통일
    }
    const next = nextBooking(bookings, item.id, now)
    if (next && kstDay(new Date(next.start_at)) === kstDay(now))   // ← [2026-08-27] UTC slice → KST 날짜 (00~09시 오판 수정)
      return { line: `오늘 ${fmtTimeShort(next.start_at)}~${fmtTimeShort(next.end_at)} 예약 있음` }
    return { line: '오늘 예약 없음' }
  }

  const afterChange = () => { setPrefill(null); setEditing(null); setDetail(null); void reload() }
  const openDetail  = (b: ResourceBooking) => setDetail(b)
  const primaryBtn: React.CSSProperties = { background: '#111', color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 12, padding: '7px 14px', fontFamily: FONT, cursor: 'pointer', fontWeight: 500 }
  const sectionHead = (label: string, hint: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '26px 0 10px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{label}</h2>
      <span style={{ fontSize: 11, color: '#94A3B8' }}>{hint}</span>
    </div>
  )

  return (
    <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto', padding: '0 16px 80px', fontFamily: FONT, color: '#111' }}>
      {/* sticky 헤더 — 고정 [자원예약] 버튼 (미리보기 승인) */}
      {/* ← [2026-08-26] 배경 흰색 제거(투명) — 페이지 배경과 이질감(고지 지시). sticky 스크롤 시 겹침 방지는 backdrop-filter 로 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'transparent', backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
                    gap: 12, padding: '20px 0 12px', marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>자원예약</h1>
        <span style={{ flex: 1 }} />
        <button onClick={onGoMyResources}
          style={{ background: '#fff', color: '#111', border: '1px solid #D1D7E1', borderRadius: 8,
                   fontSize: 12, padding: '6px 12px', fontFamily: FONT, cursor: 'pointer' }}>
          나의 자원 예약
        </button>
        {!isMobile && activeCat && (
          <button style={primaryBtn} onClick={() => setPrefill({})}>＋ 자원예약</button>
        )}
      </div>

      {/* 카테고리 칩 — 2개 이상일 때만 (3뷰 공통) */}
      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {categories.map(c => {
            const active = c.id === catId
            return (
              <button key={c.id} onClick={() => setCatId(c.id)}
                style={{ background: active ? '#111' : '#fff', color: active ? '#fff' : '#111',
                         border: active ? '1px solid #111' : '1px solid #D1D7E1',
                         borderRadius: 999, padding: '6px 14px', fontSize: 13,
                         fontFamily: FONT, cursor: 'pointer' }}>
                <ResourceName icon={c.icon} size={14} invert={active} gap={6}>{c.name}</ResourceName>
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748B', fontSize: 14 }}>불러오는 중…</p>
      ) : categories.length === 0 || !activeCat ? (
        <p style={{ color: '#64748B', fontSize: 14 }}>
          등록된 자원이 아직 없습니다. 관리자에게 문의해 주세요.
        </p>
      ) : (
        <>
          {/* ── ① 개체 카드 ── */}
          {sectionHead('개체 현황', '예약가능 카드 클릭 = 예약 · 내 사용중 카드 클릭 = 상세')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {visibleItems.map(item => {
              const st = deriveItemStatus(item, bookings, now)
              const badge = BADGE[st]
              const s = summary(item, st)
              const holder = (st === 'inuse' || st === 'overdue') ? currentHolderBooking(bookings, item.id, now) : null
              const mineHolder = holder != null && (holder.user_id === authUserId || isAdmin)
              const clickable = st === 'available' || mineHolder
              return (
                <div key={item.id}
                  onClick={() => {
                    if (st === 'available') setPrefill({ item })
                    else if (mineHolder && holder) openDetail(holder)
                  }}
                  role={clickable ? 'button' : undefined}
                  style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                           padding: 12, cursor: clickable ? 'pointer' : 'default',
                           opacity: st === 'maintenance' ? 0.65 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <ResourceName icon={activeCat.icon} size={20} gap={6}
                      style={{ fontWeight: 500, fontSize: 15 }}>{item.label}</ResourceName>
                    <span style={{ background: badge.bg, color: badge.fg, borderRadius: 6,
                                   fontSize: 11, padding: '2px 6px' }}>{badge.label}</span>
                  </div>
                  {s.who && <p style={{ fontSize: 12, margin: '0 0 2px' }}>{s.who}</p>}
                  <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>{s.line}</p>
                </div>
              )
            })}
            {visibleItems.length === 0 && (
              <p style={{ color: '#64748B', fontSize: 14, gridColumn: '1 / -1' }}>이 카테고리에 등록된 개체가 없습니다.</p>
            )}
          </div>

          {/* ── ② 타임라인 ── */}
          <div ref={timelineRef}>
            {sectionHead('타임라인', '빈 슬롯 클릭 = 그 시간으로 예약')}
            <ResourceTimelineView
              category={activeCat}
              items={visibleItems}
              users={users} date={tlDate} bookings={bookings} isMobile={isMobile}
              onDateChange={setTlDate}
              onSlotClick={(item, startHM) => setPrefill({ item, date: tlDate, startHM })}
              onBookingClick={openDetail}
            />
          </div>

          {/* ── ③ 캘린더 (B안) ── */}
          {sectionHead('캘린더', '날짜 클릭 = 그 날의 예약 · [이 날짜에 예약]')}
          <ResourceCalendarView
            categoryItems={visibleItems}
            categoryIcon={activeCat.icon}
            users={users} authUserId={authUserId} isMobile={isMobile}
            bookings={bookings}
            onMonthChange={(y, m) => setCalYM({ y, m })}
            onGoTimeline={d => { setTlDate(d); timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
            onBookAt={d => setPrefill({ date: d })}
            onBookingClick={openDetail}
          />
        </>
      )}

      {/* 모바일 FAB — 고정 [자원예약] */}
      {isMobile && activeCat && !loading && (
        <button onClick={() => setPrefill({})} aria-label="자원예약"
          style={{ position: 'fixed', right: 16, bottom: 24, zIndex: 50, background: '#111', color: '#fff',
                   border: 'none', borderRadius: 999, padding: '12px 18px', fontSize: 14, fontWeight: 500,
                   fontFamily: FONT, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          ＋ 자원예약
        </button>
      )}

      {/* 생성 모달 */}
      {prefill && activeCat && (
        <ResourceBookingModal
          category={activeCat} items={visibleItems} initialItem={prefill.item ?? null} isAdmin={isAdmin}
          me={me} users={users}   // ← [2026-09-02] 예약자 Row — 관리자는 모달 안에서 타인 지정(대리예약), 스냅샷은 모달이 파생
          initialDate={prefill.date} initialStartHM={prefill.startHM}
          showToast={showToast}
          onDone={afterChange}
          onClose={() => setPrefill(null)}
        />
      )}

      {/* 상세 모달 */}
      {detail && !editing && (() => {
        const cat = catOf(detail)
        return (
          <ResourceBookingDetailModal
            booking={detail}
            itemLabel={itemById.get(detail.item_id)?.label ?? `#${detail.item_id}`}
            categoryName={cat?.name ?? '자원'} categoryIcon={cat?.icon}
            holderLabel={holderLabel(detail)}
            isMine={detail.user_id === authUserId} isAdmin={isAdmin}
            onEdit={() => setEditing(detail)}
            onCancel={() => setCancelTarget(detail)}
            onReturn={() => setReturnTarget(detail)}
            onClose={() => setDetail(null)}
          />
        )
      })()}

      {/* 변경 모달 — edit 모드 */}
      {editing && (() => {
        const cat = catOf(editing)
        if (!cat) return null
        return (
          <ResourceBookingModal
            category={cat} items={items.filter(i => i.category_id === cat.id && i.status !== 'retired')}
            editBooking={editing} isAdmin={isAdmin}
            me={bookerOfBooking(editing)}   // ← [2026-09-02] edit 은 예약자 잠금 — 예약 소유자
            showToast={showToast}
            onDone={afterChange}
            onClose={() => setEditing(null)}
          />
        )
      })()}

      {/* ← [2026-08-26] 관리자 반납 확인 — 어드민 패널과 동일 ConfirmDialog("실물 수령"), 트리거 RETURN_CONFIRM_ADMIN_ONLY 최종 방어 */}
      {returnTarget && (
        <ConfirmDialog
          title="반납을 확인할까요?"
          message={`${itemById.get(returnTarget.item_id)?.label ?? ''} · ${holderLabel(returnTarget)}\n실물을 수령하셨습니까? 확인 즉시 이 자원이 예약 가능 상태가 됩니다.`}
          confirmLabel="반납 확인" variant="neutral" loading={busy}
          onConfirm={async () => {
            setBusy(true)
            try {
              await adminConfirmResourceReturn(returnTarget.id, authUserId)
              showToast('반납이 확인되었습니다.')
              setReturnTarget(null); afterChange()
            } catch (e) { showToast(e instanceof Error ? e.message : '반납 확인에 실패했습니다.') }
            finally { setBusy(false) }
          }}
          onClose={() => { if (!busy) setReturnTarget(null) }}
        />
      )}

      {/* 취소 확인 — 시작 전·본인 (마이페이지와 동일 ConfirmDialog) */}
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
              setCancelTarget(null); afterChange()
            } catch (e) { showToast(e instanceof Error ? e.message : '취소에 실패했습니다.') }
            finally { setBusy(false) }
          }}
          onClose={() => { if (!busy) setCancelTarget(null) }}
        />
      )}
    </div>
  )
}
