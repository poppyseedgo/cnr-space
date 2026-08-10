/**
 * NoshowAdminPanel — 노쇼 관리 (어드민 '예약 관리' 탭 하위 뷰)
 *
 * ✅ 변경 이력
 *  - [2026-08-05] 신규 — 고지 지시: 오늘/일주일/14일/한 달/전체/직접설정으로 노쇼 소팅,
 *      노쇼 해제(사용 완료) / DB 영구 삭제 관리
 *  - [2026-08-10] 이용 제재 섹션 추가 — 8월 시행: 1개월 내 노쇼 3회 → 7일 예약 생성 차단.
 *      제재 이력 표시 + 수동 해제(admin_revoke_noshow_penalty). 판정·차단·자동해제는
 *      전부 DB(20260743) 몫 — 패널은 조회/해제 통로만. 노쇼 해제/삭제가 근거를 무너뜨리면
 *      서버가 제재를 자동 해제하므로 runAction 후 제재 목록도 재조회한다.
 *
 * 📌 배치 근거: 새 탭을 만들지 않고 bookings 탭 하위 뷰 — 역할=탭 1:1(11종 고정)
 *    원칙을 깨지 않으며, RPC 게이트(has_admin_role('booking'))와 정확히 일치.
 *    (HolidayAdminPanel 이 room 탭 하위인 것과 같은 원칙)
 *
 * 📌 자체 fetch 인 이유: 전역 bookings state 는 −3개월 창(loadBookings)이라
 *    오픈일(2026-04-22)~오늘 "전체" 조회가 구조적으로 불가능.
 *    RecentBookingsCard 와 동일하게 loadBookingsByRange 로 직접 조회한다.
 *
 * 📌 노쇼 판정: utils/noshow.ts isNoshow SSOT 단독 사용 — 자체 규칙 금지.
 *
 * 📌 액션 2종 (둘 다 RPC 경유, 서버가 노쇼 확정룰 재검증)
 *  - 노쇼 해제: checked_in=true 전환 → 라벨 '사용완료', 노쇼 통계에서 제외(분모 유지)
 *  - 영구 삭제: 참석자 포함 DB 삭제 → 분자·분모 모두 제거. 감사 로그에 스냅샷 보존
 *
 * 📌 확인 UX: ConfirmDialog (2026-07-30 전수검사 — 신규 화면은 native confirm 금지)
 *    해제 = warn / 삭제 = danger + 복구 불가 명시
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Inbox, Download, AlertTriangle, ShieldAlert } from 'lucide-react'
import { loadBookingsByRange, resolveNoshowBooking, deleteNoshowBooking, fetchNoshowPenalties, revokeNoshowPenalty } from '../../lib/api'  // ← [2026-08-10] 이용 제재
import { isNoshow } from '../../utils/noshow'
import { penaltyDisplayStatus, type NoshowPenaltyRow } from '../../utils/noshowPenalty'  // ← [2026-08-10] 이용 제재
import { todayStr, fmt2, tsDate, tsTime, fmtTSDateFull, fmtTSRangeFull } from '../../utils/time'  // ← [2026-08-10] tsTime 추가 (제재 기간 표시)
import { exportCSV } from '../../utils/csv'
import { DateField } from '../common/DateField'
import { ConfirmDialog } from '../common/ConfirmDialog'
import type { Booking } from '../../types'

// ── 기간 프리셋 ──────────────────────────────────────────────────────────────
// C&R Space 실제 오픈일 — '전체' 프리셋의 시작일 (대시보드 ALL_TIME_FROM 과 별개 상수:
// 대시보드는 이관 대비 2026-01-01, 여기는 "운영기간" 정의라 오픈일이 정확한 값)
const OPEN_DATE = '2026-04-22'

type PresetId = 'today' | 'week' | 'd14' | 'month' | 'all'
const PRESETS: { id: PresetId; label: string; days: number | null }[] = [
  { id: 'today', label: '오늘',   days: 1 },
  { id: 'week',  label: '일주일', days: 7 },
  { id: 'd14',   label: '14일',   days: 14 },
  { id: 'month', label: '한 달',  days: 30 },
  { id: 'all',   label: '전체',   days: null },   // OPEN_DATE ~ 오늘
]

function presetFrom(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - (days - 1))
  return `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`
}

/** 활성 pill 은 state 로 저장하지 않고 from/to 에서 파생 — 이중 진실 방지 (대시보드 규칙 동일).
 *  'all' 을 먼저 판정 — 프리셋 시작일이 우연히 겹칠 때 오판 방지 (presetIdOf 교훈) */
function presetIdOf(from: string, to: string): PresetId | null {
  const today = todayStr()
  if (to !== today) return null
  if (from === OPEN_DATE) return 'all'
  for (const p of PRESETS) {
    if (p.days !== null && from === presetFrom(p.days)) return p.id
  }
  return null
}

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  rooms:     any[]
  users:     any[]
  showToast: (m: string, t?: string) => void
  isMobile:  boolean
  PER_PAGE:  number
  onDetail?: (b: Booking) => void
}

type ConfirmState = { action: 'resolve' | 'delete'; ids: string[] } | null
// ← [2026-08-10] 제재 수동 해제 확인 상태 (기존 ConfirmState 와 분리 — 서로 다른 액션 계열)
type RevokeState = NoshowPenaltyRow | null

export function NoshowAdminPanel({ rooms, users, showToast, isMobile, PER_PAGE, onDetail }: Props) {
  const today = todayStr()
  const [dateFrom, setDateFrom] = useState(() => presetFrom(30))   // 기본: 한 달
  const [dateTo,   setDateTo]   = useState(today)
  const [rows, setRows]         = useState<Booking[]>([])
  const [loading, setLoading]   = useState(true)
  const [filterRoom, setFilterRoom] = useState('ALL')
  const [filterUser, setFilterUser] = useState('')
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm]   = useState<ConfirmState>(null)
  const [busy, setBusy]         = useState(false)
  // ← [2026-08-10] 이용 제재 — 자체 fetch (기간 필터와 무관하게 전체 이력 표시)
  const [penalties, setPenalties]         = useState<NoshowPenaltyRow[]>([])
  const [penaltyLoading, setPenaltyLoading] = useState(true)
  const [revokeTarget, setRevokeTarget]     = useState<RevokeState>(null)

  // ← [2026-08-10] 제재 목록 재조회 — 낙관적 갱신 금지 (액션 후 서버 상태가 진실)
  async function loadPenalties() {
    setPenaltyLoading(true)
    try {
      setPenalties(await fetchNoshowPenalties())
    } catch {
      showToast('제재 목록을 불러오지 못했습니다', 'error')
    } finally {
      setPenaltyLoading(false)
    }
  }
  useEffect(() => { loadPenalties() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ← [2026-08-10] 제재 수동 해제 실행
  async function runRevoke(p: NoshowPenaltyRow) {
    setBusy(true)
    try {
      await revokeNoshowPenalty(p.id, '노쇼 관리 패널 수동 해제')
      showToast('제재를 해제했습니다', 'success')
    } catch (e: any) {
      showToast(e?.message ?? '제재 해제에 실패했습니다', 'error')
    } finally {
      setBusy(false)
      setRevokeTarget(null)
      await loadPenalties()
    }
  }

  // ── 자체 fetch — 기간 변경 시 재조회 ───────────────────────────────────
  async function load() {
    setLoading(true)
    try {
      const data = await loadBookingsByRange(dateFrom, dateTo, 'start_at')
      setRows(data)
    } catch {
      showToast('노쇼 목록을 불러오지 못했습니다', 'error')
    } finally {
      setLoading(false)
      setSelected(new Set())   // 기간이 바뀌면 이전 선택은 무의미 — 초기화
      setPage(1)
    }
  }
  useEffect(() => { load() }, [dateFrom, dateTo])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 집계 (분모 = 기간 내 전체 예약, 2026-07-23 확정 기준) ──────────────
  const totalInRange = rows.length
  const noshowAll    = useMemo(() => rows.filter(isNoshow), [rows])
  const noshowRate   = totalInRange > 0 ? Math.round(noshowAll.length / totalInRange * 1000) / 10 : 0

  // ── 화면 필터 (회의실/예약자 — 집계 분모에는 영향 없음, 목록만 좁힘) ──
  const filtered = useMemo(() =>
    noshowAll
      .filter(b => filterRoom === 'ALL' || b.room_id === Number(filterRoom))
      .filter(b => !filterUser || (b.user ?? '').toLowerCase().includes(filterUser.toLowerCase()))
      .sort((a, z) => z.start_at.localeCompare(a.start_at)),
    [noshowAll, filterRoom, filterUser])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const activePreset = presetIdOf(dateFrom, dateTo)

  // ── 선택 ────────────────────────────────────────────────────────────────
  const allChecked = filtered.length > 0 && filtered.every(b => selected.has(b.id))
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(filtered.map(b => b.id)))
  }
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── 액션 실행 (순차 루프 — RPC 는 건별 검증, 부분 실패 집계) ────────────
  async function runAction(action: 'resolve' | 'delete', ids: string[]) {
    setBusy(true)
    let ok = 0, fail = 0, lastErr = ''
    for (const id of ids) {
      try {
        if (action === 'resolve') await resolveNoshowBooking(id)
        else await deleteNoshowBooking(id)
        ok++
      } catch (e: any) {
        fail++
        lastErr = e?.message ?? ''
      }
    }
    setBusy(false)
    setConfirm(null)
    const verb = action === 'resolve' ? '해제' : '삭제'
    if (fail === 0) showToast(`노쇼 ${ok}건을 ${verb}했습니다`, 'success')
    else showToast(`${verb} ${ok}건 성공, ${fail}건 실패${lastErr ? ` — ${lastErr}` : ''}`, 'error')
    await load()   // RPC 후 서버 상태 재조회 — 낙관적 갱신 금지 (프로젝트 규칙)
    await loadPenalties()  // ← [2026-08-10] 근거 노쇼 해제/삭제 시 서버가 제재를 자동 해제하므로 함께 재조회
  }

  // ── CSV ─────────────────────────────────────────────────────────────────
  const onCsv = () => {
    const csvRows = filtered.map(b => {
      const r = rooms.find(rm => rm.room_id === b.room_id)
      const owner = users.find((u: any) => u.user_id === b.user_id)
      return {
        회의명: b.title,
        회의실: r?.room_name ?? '',
        날짜: tsDate(b.start_at),
        시작: b.start_at.slice(11, 16),
        종료: b.end_at.slice(11, 16),
        예약자: owner?.name ?? b.user ?? '',
        부서: owner?.dept ?? b.dept ?? '',
        상태: '노쇼',
      }
    })
    exportCSV(csvRows, `노쇼목록_${dateFrom}_${dateTo}`)
  }

  // ── 스타일 토큰 ─────────────────────────────────────────────────────────
  const pillStyle = (active: boolean): CSSProperties => ({
    padding: '5px 12px', fontSize: 11, borderRadius: 999, fontWeight: 600,
    background: active ? '#111' : '#F8FAFC',
    color: active ? '#fff' : '#64748B',
    border: active ? 'none' : '1px solid #E2E8F0',
  })

  return (
    <div className="anm">
      {/* ── 필터 카드 ─────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? '16px' : '20px 24px', marginBottom: 16 }}>
        {/* 기간 프리셋 + 직접 설정 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', display: 'block', marginBottom: 6 }}>기간</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button key={p.id} className="btn" style={pillStyle(activePreset === p.id)}
                  onClick={() => {
                    setDateFrom(p.days === null ? OPEN_DATE : presetFrom(p.days))
                    setDateTo(todayStr())
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {[{ l: '시작일', v: dateFrom, s: setDateFrom }, { l: '종료일', v: dateTo, s: setDateTo }].map(f => (
            <div key={f.l} style={{ flex: '1 1 130px', minWidth: 120, maxWidth: 180 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', display: 'block', marginBottom: 4 }}>{f.l}</label>
              <DateField value={f.v} onChange={d => f.s(d)} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, fontSize: 13, background: '#F8FAFC' }} />
            </div>
          ))}
          <div style={{ flex: '1 1 130px', minWidth: 120, maxWidth: 180 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', display: 'block', marginBottom: 4 }}>회의실</label>
            <select value={filterRoom} onChange={e => { setFilterRoom(e.target.value); setPage(1) }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 13, background: '#F8FAFC', outline: 'none' }}>
              <option value="ALL">전체</option>
              {rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 130px', minWidth: 120, maxWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', display: 'block', marginBottom: 4 }}>예약자</label>
            <input placeholder="이름 검색..." value={filterUser} onChange={e => { setFilterUser(e.target.value); setPage(1) }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 13, background: '#F8FAFC', outline: 'none' }} />
          </div>
        </div>

        {/* 요약 지표 — 분모는 화면 필터 이전의 기간 전체 (필터 목록을 분모로 쓰면 왜곡, 2026-07-23 교훈) */}
        <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { l: '기간 내 전체 예약', v: `${totalInRange}건`, c: '#111' },
            { l: '노쇼', v: `${noshowAll.length}건`, c: '#D97706' },
            { l: '노쇼율', v: `${noshowRate}%`, c: '#DC2626' },
          ].map(s => (
            <div key={s.l} style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{s.l}</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: s.c }}>{loading ? '—' : s.v}</span>
            </div>
          ))}
          <button className="btn" onClick={onCsv}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, borderRadius: 999, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#374151', fontWeight: 600 }}>
            <Download size={10} strokeWidth={1.8} /> CSV
          </button>
        </div>
      </div>

      {/* ── 이용 제재 (2026-08-10, 8월 시행: 1개월 내 3회 → 7일 예약 생성 차단) ── */}
      <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? '16px' : '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <ShieldAlert size={15} strokeWidth={2} color="#DC2626" />
          <span style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>이용 제재</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
            노쇼 최초 발생일부터 1개월 내 3회 누적 시 1주일 예약 생성 제한 (2026-08-01 시행)
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 12 }}>
          판정·차단·자동 해제는 서버가 강제합니다. 위 목록에서 근거 노쇼를 해제/삭제하면 해당 제재는 자동 해제됩니다.
        </div>
        {penaltyLoading ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#CBD5E1', fontSize: 13 }}>제재 목록을 불러오는 중...</div>
        ) : penalties.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#CBD5E1', fontSize: 13 }}>제재 이력이 없습니다</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['대상자', '제재 기간', '근거 노쇼', '상태', '사유', '관리'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {penalties.map(p => {
                  // 예약자 이름 live — profiles.name 우선, snapshot fallback (프로젝트 표준 패턴)
                  const owner = users.find((u: any) => u.user_id === p.user_id)
                  const displayName = owner?.name ?? p.user_name ?? '—'
                  const displayDept = owner?.dept ?? ''
                  const st = penaltyDisplayStatus(p)
                  const stMeta = st === 'active'
                    ? { label: '진행 중', bg: '#FEF2F2', fg: '#DC2626' }
                    : st === 'expired'
                    ? { label: '기간 만료', bg: '#F8FAFC', fg: '#94A3B8' }
                    : { label: '해제됨', bg: '#F0FDF4', fg: '#059669' }
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #F8FAFC' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, flexShrink: 0, background: '#F1EFE8', color: '#444441' }}>{(displayName ?? '?')[0]}</div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName}</span>
                          {displayDept && <span style={{ fontSize: 11, color: '#94A3B8' }}>{displayDept}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>
                        {fmtTSDateFull(p.starts_at)} {tsTime(p.starts_at)} ~ {fmtTSDateFull(p.ends_at)} {tsTime(p.ends_at)}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>
                        {p.counted_booking_ids.length}건 ({fmtTSDateFull(p.anchor_at)} ~)
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: stMeta.bg, color: stMeta.fg }}>{stMeta.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#94A3B8', fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.revoked_reason ?? ''}>
                        {p.revoked_reason ?? (st === 'active' ? '노쇼 3회 누적' : '')}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        {st === 'active' && (
                          <button className="btn" disabled={busy}
                            onClick={() => setRevokeTarget(p)}
                            style={{ padding: '5px 11px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: '#fff', border: '1px solid #059669', color: '#059669' }}>
                            제재 해제
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 일괄 액션 바 (선택 시 노출) ───────────────────────────────── */}
      {selected.size > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>{selected.size}건 선택됨</span>
          <button className="btn" disabled={busy}
            onClick={() => setConfirm({ action: 'resolve', ids: [...selected] })}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 999, background: '#B45309', color: '#fff', border: 'none' }}>
            선택 노쇼 해제
          </button>
          <button className="btn" disabled={busy}
            onClick={() => setConfirm({ action: 'delete', ids: [...selected] })}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 999, background: '#DC2626', color: '#fff', border: 'none' }}>
            선택 영구 삭제
          </button>
          <button className="btn" onClick={() => setSelected(new Set())}
            style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12, borderRadius: 999, background: '#fff', border: '1px solid #E2E8F0', color: '#64748B' }}>
            선택 해제
          </button>
        </div>
      )}

      {/* ── 목록 ──────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#CBD5E1', fontSize: 13 }}>노쇼 목록을 불러오는 중...</div>
        ) : paged.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#CBD5E1' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><Inbox size={40} strokeWidth={1.8} color="#CBD5E1" /></div>
            <div style={{ fontSize: 13 }}>기간 내 노쇼 예약이 없습니다</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={{ padding: '10px 14px', borderBottom: '1px solid #F1F5F9', width: 36 }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                  </th>
                  {['회의명', '회의실', '날짜', '시간', '예약자', '부서', '관리'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap', borderBottom: '1px solid #F1F5F9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(b => {
                  const r = rooms.find(rm => rm.room_id === b.room_id)
                  // 예약자 이름 live — profiles.name 우선, snapshot fallback (프로젝트 표준 패턴)
                  const owner = users.find((u: any) => u.user_id === b.user_id)
                  const displayName = owner?.name ?? b.user ?? '—'
                  const displayDept = owner?.dept ?? b.dept ?? ''
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid #F8FAFC', cursor: onDetail ? 'pointer' : 'default' }}
                      onClick={() => onDetail && onDetail(b)}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAFBFD'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleOne(b.id)} style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>{r?.room_name ?? '?'}</td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>{fmtTSDateFull(b.start_at)}</td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>{fmtTSRangeFull(b.start_at, b.end_at)}</td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, flexShrink: 0, background: '#F1EFE8', color: '#444441' }}>{(displayName ?? '?')[0]}</div>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{displayName}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B', whiteSpace: 'nowrap' }}>{displayDept}</td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn" disabled={busy}
                            onClick={() => setConfirm({ action: 'resolve', ids: [b.id] })}
                            style={{ padding: '5px 11px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: '#fff', border: '1px solid #B45309', color: '#B45309' }}>
                            노쇼 해제
                          </button>
                          <button className="btn" disabled={busy}
                            onClick={() => setConfirm({ action: 'delete', ids: [b.id] })}
                            style={{ padding: '5px 11px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: '#fff', border: '1px solid #DC2626', color: '#DC2626' }}>
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: 16, borderTop: '1px solid #F1F5F9' }}>
            <button className="btn" disabled={page === 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: '#F1F5F9', color: page === 1 ? '#CBD5E1' : '#64748B' }}>‹</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => { const p = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= totalPages - 3 ? totalPages - 6 + i : page - 3 + i; return <button key={p} className="btn" onClick={() => setPage(p)} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, minWidth: 32, background: page === p ? '#111' : '#F8FAFC', color: page === p ? '#fff' : '#64748B', fontWeight: page === p ? 700 : 400 }}>{p}</button> })}
            <button className="btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: '#F1F5F9', color: page === totalPages ? '#CBD5E1' : '#64748B' }}>›</button>
          </div>
        )}
      </div>

      {/* ── 확인 다이얼로그 ───────────────────────────────────────────── */}
      {confirm && confirm.action === 'resolve' && (
        <ConfirmDialog
          title="노쇼 해제 (사용 완료 처리)"
          message={<>
            선택한 <b>{confirm.ids.length}건</b>의 노쇼를 해제하고 <b>'사용완료'</b>로 전환합니다.<br />
            노쇼 통계·대시보드 집계에서 즉시 제외되며(전체 예약 수는 유지),
            처리 내역은 감사 로그(noshow_admin_actions)에 기록됩니다.
          </>}
          confirmLabel={`${confirm.ids.length}건 해제`}
          variant="warn"
          loading={busy}
          onConfirm={() => runAction('resolve', confirm.ids)}
          onClose={() => { if (!busy) setConfirm(null) }}
        />
      )}
      {confirm && confirm.action === 'delete' && (
        <ConfirmDialog
          title="노쇼 예약 영구 삭제"
          message={<>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#DC2626', fontWeight: 700 }}>
              <AlertTriangle size={13} strokeWidth={2} /> 복구할 수 없습니다.
            </span><br />
            선택한 <b>{confirm.ids.length}건</b>의 노쇼 예약을 참석자 정보와 함께 DB에서 <b>영구 삭제</b>합니다.<br />
            노쇼 건수와 전체 예약 수(분모)가 모두 줄어 통계 수치가 변동됩니다.
            삭제 전 스냅샷은 감사 로그에 보존됩니다.
          </>}
          confirmLabel={`${confirm.ids.length}건 영구 삭제`}
          variant="danger"
          loading={busy}
          onConfirm={() => runAction('delete', confirm.ids)}
          onClose={() => { if (!busy) setConfirm(null) }}
        />
      )}
      {/* ← [2026-08-10] 이용 제재 수동 해제 확인 */}
      {revokeTarget && (
        <ConfirmDialog
          title="이용 제재 해제"
          message={<>
            <b>{users.find((u: any) => u.user_id === revokeTarget.user_id)?.name ?? revokeTarget.user_name ?? '대상자'}</b>님의
            예약 생성 제한(~{fmtTSDateFull(revokeTarget.ends_at)} {tsTime(revokeTarget.ends_at)})을 <b>즉시 해제</b>합니다.<br />
            해제 즉시 새 예약을 생성할 수 있으며, 해제 이력(해제자·시각·사유)은 제재 테이블에 보존됩니다.
          </>}
          confirmLabel="제재 해제"
          variant="warn"
          loading={busy}
          onConfirm={() => runRevoke(revokeTarget)}
          onClose={() => { if (!busy) setRevokeTarget(null) }}
        />
      )}
    </div>
  )
}
