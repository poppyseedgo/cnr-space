/**
 * ResourcePage.tsx — 자원예약 사용자 화면 (Phase 2A)
 *
 * 구성 (미리보기 승인분 / 메인 레이아웃 확정 전 최소 단위):
 *  - 카테고리 칩 (활성만, 1개 이하면 숨김)
 *  - 개체 카드 그리드: 파생 상태 뱃지(예약가능/사용중/연체/점검중) +
 *    대여자 이름·부서(고지 확정 — 회의실 예약자 노출 관례) + 점유 요약 1줄
 *  - 내 예약 섹션: 시작 전 예약 취소 (ConfirmDialog — window.confirm 금지 관례)
 *  - 예약가능 카드 클릭 → ResourceBookingModal (Figma 3108:7512)
 *
 * 데이터 원칙
 *  - 상태는 저장하지 않고 파생 (utils/resourceStatus.ts SSOT)
 *  - 대여자 live 정보는 users 풀 lookup, 스냅샷(user_name/dept)은 퇴사자 폴백
 *
 * Phase 2B 예정: 타임라인뷰·캘린더뷰 (레이아웃 미정 — 별도 시안 후)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser } from '../types'
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../types/resource'
import { loadResourceBookings, loadResourceCategories, loadResourceItems } from '../lib/resourceApi'  // ← [Phase 4] cancel 은 마이페이지로 이관
import { currentHolderBooking, deriveItemStatus, fmtDueShort, fmtTimeShort, isResourceOverdue, nextBooking, type ResourceDisplayStatus } from '../utils/resourceStatus'
import { ResourceBookingModal } from '../components/resource/ResourceBookingModal'
import { ResourceTimelineView } from '../components/resource/ResourceTimelineView'  // ← [2026-08-19 Phase 2B]
import { ResourceCalendarView } from '../components/resource/ResourceCalendarView'  // ← [2026-08-19 Phase 2B]

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
  isMobile:   boolean   // ← [Phase 2B] 타임라인 열 폭·캘린더 점 표시 분기
  onGoMyResources: () => void   // ← [Phase 4] 마이페이지 자원 탭으로 이동 (도서관 onGoMyLoans 패턴)
}

export function ResourcePage({ users, authUserId, showToast, isMobile, onGoMyResources }: Props) {
  const [categories, setCategories] = useState<ResourceCategory[]>([])
  const [items, setItems]           = useState<ResourceItem[]>([])
  const [bookings, setBookings]     = useState<ResourceBooking[]>([])
  const [loading, setLoading]       = useState(true)
  const [catId, setCatId]           = useState<number | null>(null)
  const [target, setTarget]         = useState<ResourceItem | null>(null)   // 예약 모달 대상
  // ── [Phase 2B] 뷰 전환 — 기본 카드 (시안 확정: 예약까지 클릭 수 최소)
  const [viewMode, setViewMode] = useState<'cards' | 'timeline' | 'calendar'>('cards')
  const todayYmd = (() => { const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const [tlDate, setTlDate] = useState(todayYmd)
  const [prefill, setPrefill] = useState<{ date: string; startHM: string } | null>(null)  // 타임라인 슬롯 → 모달
  const [reloadKey, setReloadKey] = useState(0)   // 생성 후 타임라인·캘린더 자체 재조회 트리거

  const reload = useCallback(async () => {
    try {
      const [cs, is, bs] = await Promise.all([
        loadResourceCategories(), loadResourceItems(), loadResourceBookings(),
      ])
      setCategories(cs)
      setItems(is)
      setBookings(bs)
      setCatId(prev => prev ?? cs[0]?.id ?? null)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '자원 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void reload() }, [reload])

  const now = new Date()

  /** 대여자 표시명 — live 우선, 퇴사자는 스냅샷 폴백 */
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

  // ← [Phase 4] '내 예약' 섹션은 마이페이지 자원 탭으로 이관 — 중복 UI 제거

  const activeCat = categories.find(c => c.id === catId) ?? null

  /** 카드 요약 1줄 */
  const summary = (item: ResourceItem, st: ResourceDisplayStatus): { who?: string; line: string } => {
    if (st === 'maintenance') return { line: '선택 불가' }
    const holder = currentHolderBooking(bookings, item.id, now)
    if (holder) {
      const due = fmtDueShort(holder.return_due)
      return isResourceOverdue(holder, now)
        ? { who: holderLabel(holder), line: `${due} 반납 예정이었음` }
        : { who: holderLabel(holder),
            line: holder.return_due === holder.start_at.slice(0, 10)
              ? `${fmtTimeShort(holder.end_at)}까지 사용 중`
              : `~${due} 반납 예정` }
    }
    const next = nextBooking(bookings, item.id, now)
    if (next && next.start_at.slice(0, 10) === now.toISOString().slice(0, 10))
      return { line: `오늘 ${fmtTimeShort(next.start_at)}~${fmtTimeShort(next.end_at)} 예약 있음` }
    return { line: '오늘 예약 없음' }
  }

  return (
    <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto', padding: '24px 16px 60px', fontFamily: FONT, color: '#111' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>자원예약</h1>
        {/* ← [Phase 2B] 뷰 세그먼트 — 3뷰 공통 카테고리 칩은 아래 그대로 */}
        <span style={{ display: 'inline-flex', background: '#fff', border: '1px solid #D1D7E1',
                       borderRadius: 10, overflow: 'hidden' }}>
          {([['cards', '카드'], ['timeline', '타임라인'], ['calendar', '캘린더']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ border: 'none', padding: '6px 14px', fontSize: 12, fontFamily: FONT, cursor: 'pointer',
                       background: viewMode === v ? '#111' : 'transparent',
                       color: viewMode === v ? '#fff' : '#111' }}>{label}</button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onGoMyResources}
          style={{ background: '#fff', color: '#111', border: '1px solid #D1D7E1', borderRadius: 8,
                   fontSize: 12, padding: '6px 12px', fontFamily: FONT, cursor: 'pointer' }}>
          나의 자원 예약
        </button>{/* ← [Phase 4] 마이페이지 자원 탭 이동 */}
      </div>

      {/* 카테고리 칩 — 2개 이상일 때만 */}
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
                {c.name}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748B', fontSize: 14 }}>불러오는 중…</p>
      ) : categories.length === 0 ? (
        <p style={{ color: '#64748B', fontSize: 14 }}>
          등록된 자원이 아직 없습니다. 관리자에게 문의해 주세요.
        </p>
      ) : (
        <>
          {viewMode === 'cards' && <>
          {/* 개체 카드 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {visibleItems.map(item => {
              const st = deriveItemStatus(item, bookings, now)
              const badge = BADGE[st]
              const s = summary(item, st)
              const clickable = st === 'available'
              return (
                <div key={item.id}
                  onClick={() => { if (clickable && activeCat) setTarget(item) }}
                  role={clickable ? 'button' : undefined}
                  style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                           padding: 12, cursor: clickable ? 'pointer' : 'default',
                           opacity: st === 'maintenance' ? 0.65 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 500, fontSize: 15 }}>{item.label}</span>
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

          </>}

          {/* ── [Phase 2B] 타임라인뷰 ── */}
          {viewMode === 'timeline' && activeCat && (
            <ResourceTimelineView
              category={activeCat}
              items={visibleItems}
              users={users} date={tlDate} isMobile={isMobile}
              onDateChange={setTlDate}
              onSlotClick={(item, startHM) => { setPrefill({ date: tlDate, startHM }); setTarget(item) }}
              showToast={showToast} reloadKey={reloadKey}
            />
          )}

          {/* ── [Phase 2B] 캘린더뷰 — 조회 중심, 생성은 타임라인·카드에 위임 ── */}
          {viewMode === 'calendar' && (
            <ResourceCalendarView
              categoryItems={visibleItems}
              users={users} authUserId={authUserId} isMobile={isMobile}
              onGoTimeline={d => { setTlDate(d); setViewMode('timeline') }}
              showToast={showToast} reloadKey={reloadKey}
            />
          )}
        </>
      )}

      {/* 예약 모달 */}
      {target && activeCat && (
        <ResourceBookingModal
          item={target} category={activeCat}
          snapshot={{
            user_name: users.find(u => u.user_id === authUserId)?.name ?? '',
            user_dept: users.find(u => u.user_id === authUserId)?.dept ?? '',
          }}
          initialDate={prefill?.date} initialStartHM={prefill?.startHM}
          showToast={showToast}
          onDone={() => { setTarget(null); setPrefill(null); setReloadKey(k => k + 1); void reload() }}
          onClose={() => { setTarget(null); setPrefill(null) }}
        />
      )}

    </div>
  )
}
