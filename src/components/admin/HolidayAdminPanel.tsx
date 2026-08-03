/**
 * HolidayAdminPanel — 공휴일·회사 이벤트 관리 (어드민 '회의실 관리' 탭 하위 섹션)
 *
 * ✅ 변경 이력
 *  - [2026-08-03] 신규 — 공휴일 기능 Phase C (고지 확정: 회사 경조사 어드민 등록·변경)
 *
 * 📌 배치 근거: 새 탭을 만들지 않고 room 탭 하위 섹션 — 역할=탭 1:1(11종 고정)
 *    원칙을 깨지 않으며, RPC 게이트(has_admin_role('room'))와 정확히 일치.
 *
 * 📌 동작
 *  - 연도 필터 + 구분(전체/공휴일/회사 이벤트) 필터 목록
 *  - 추가/수정: admin_upsert_holiday (같은 날짜+구분이면 덮어씀 — 잠정 시드 교정 겸용)
 *  - 삭제: ConfirmDialog (전수검사 표준 — 사용자 노출 아님이지만 신규 화면 규칙 적용)
 *  - Family Day 연간 생성: admin_generate_family_days(연도) — 1·3주 금요일 자동, 멱등
 *  - 모든 변경 후 invalidateHolidayCache() — 달력·캘린더 뷰 즉시 반영
 */

import { useEffect, useMemo, useState } from 'react'
import {
  loadHolidaysAdmin, adminUpsertHoliday, adminDeleteHoliday, adminGenerateFamilyDays,
  type AdminHoliday,
} from '../../lib/api'
import { invalidateHolidayCache } from '../../utils/holidays'
import { fmtDateShortKo } from '../../utils/bookLoan'
import { DateField } from '../common/DateField'
import { ConfirmDialog } from '../common/ConfirmDialog'

const KIND_LABEL: Record<'holiday' | 'company', string> = { holiday: '공휴일', company: '회사 이벤트' }
const SRC_LABEL:  Record<string, string> = { seed: '시드', api: 'API', manual: '수동' }

export function HolidayAdminPanel({ showToast }: { showToast: (m: string, t?: string) => void }) {
  const nowYear = new Date().getFullYear()
  const [rows, setRows]       = useState<AdminHoliday[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear]       = useState(nowYear)
  const [kindF, setKindF]     = useState<'all' | 'holiday' | 'company'>('all')
  const [busy, setBusy]       = useState(false)
  const [delTarget, setDelTarget] = useState<AdminHoliday | null>(null)
  // 추가 폼
  const [fDate, setFDate] = useState('')
  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<'holiday' | 'company'>('company')

  async function load() {
    setLoading(true)
    try { setRows(await loadHolidaysAdmin()) }
    catch { showToast('공휴일 목록을 불러오지 못했습니다', 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() =>
    rows
      .filter(r => Number(r.holiday_date.slice(0, 4)) === year)
      .filter(r => kindF === 'all' || r.kind === kindF)
      .sort((a, z) => a.holiday_date.localeCompare(z.holiday_date)),
    [rows, year, kindF])

  async function refreshAfterChange() {
    invalidateHolidayCache()   // 달력·캘린더 뷰 캐시 무효화 — 다음 마운트에서 재조회
    await load()
  }

  async function handleAdd() {
    if (!fDate || !fName.trim()) { showToast('날짜와 이름을 입력해주세요', 'error'); return }
    setBusy(true)
    try {
      const res = await adminUpsertHoliday(fDate, fName.trim(), fKind)
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      showToast(`${fmtDateShortKo(fDate)} · ${fName.trim()} 저장됨`)
      setFDate(''); setFName('')
      await refreshAfterChange()
    } finally { setBusy(false) }
  }

  async function handleDelete(row: AdminHoliday) {
    setBusy(true)
    try {
      const res = await adminDeleteHoliday(row.holiday_date, row.kind)
      if (!res.ok) { showToast(res.message ?? '삭제 실패', 'error'); return }
      showToast(`${fmtDateShortKo(row.holiday_date)} · ${row.name} 삭제됨`)
      setDelTarget(null)
      await refreshAfterChange()
    } finally { setBusy(false) }
  }

  async function handleGenerate() {
    // 관리자 저빈도 액션 — native confirm(L1, 전수검사 기준)
    if (!window.confirm(`${year}년 Family Day(매월 1·3번째 금요일)를 일괄 생성할까요?\n이미 등록된 날짜는 건드리지 않습니다.`)) return
    setBusy(true)
    try {
      const res = await adminGenerateFamilyDays(year)
      if (!res.ok) { showToast(res.message ?? '생성 실패', 'error'); return }
      showToast(res.count === 0 ? `${year}년은 이미 전부 등록되어 있습니다` : `Family Day ${res.count}건 생성됨`)
      await refreshAfterChange()
    } finally { setBusy(false) }
  }

  const selStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid #E2E8F0',
    fontSize: 12, background: '#F8FAFC', outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ marginTop: 28, background: '#fff', borderRadius: 16, padding: '18px 20px', border: '1px solid #F1F5F9' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>공휴일 · 회사 이벤트 관리</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, lineHeight: 1.6 }}>
            달력·캘린더 뷰 표기에 반영됩니다 (표기 전용 — 예약 차단 없음).
            임시공휴일·창립기념일은 여기서 직접 등록하세요.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
            {[nowYear - 1, nowYear, nowYear + 1, nowYear + 2].map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={kindF} onChange={e => setKindF(e.target.value as any)} style={selStyle}>
            <option value="all">전체</option>
            <option value="holiday">공휴일</option>
            <option value="company">회사 이벤트</option>
          </select>
          <button className="btn" disabled={busy} onClick={handleGenerate}
            style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: '#F5F3FF', border: '1px solid #DDD6FE', color: '#7C3AED', cursor: 'pointer' }}>
            Family Day 연간 생성
          </button>
        </div>
      </div>

      {/* 추가 폼 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
        <DateField value={fDate} onChange={setFDate} placeholder="날짜"
          style={{ height: 34, fontSize: 12, minWidth: 130 }} />
        <input value={fName} onChange={e => setFName(e.target.value)} placeholder="이름 (예: 창립기념일)"
          maxLength={40}
          style={{ ...selStyle, height: 34, minWidth: 180, background: '#fff' }} />
        <select value={fKind} onChange={e => setFKind(e.target.value as any)} style={{ ...selStyle, height: 34 }}>
          <option value="company">회사 이벤트</option>
          <option value="holiday">공휴일</option>
        </select>
        <button className="btn" disabled={busy} onClick={handleAdd}
          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: '#111', border: 'none', color: '#fff', cursor: 'pointer' }}>
          추가
        </button>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>같은 날짜·구분이 있으면 이름을 덮어씁니다 (시드 교정)</span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div style={{ padding: 20, fontSize: 12, color: '#94A3B8' }}>불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 20, fontSize: 12, color: '#94A3B8' }}>{year}년 등록 항목이 없습니다</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
          {filtered.map(r => (
            <div key={`${r.holiday_date}-${r.kind}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 10, border: '1px solid #F1F5F9', background: '#FAFAFA', fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: r.kind === 'holiday' ? '#DC2626' : '#7C3AED', flexShrink: 0 }}>
                {fmtDateShortKo(r.holiday_date)}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#111' }}
                title={r.name}>{r.name}</span>
              <span style={{ fontSize: 10, color: '#94A3B8', flexShrink: 0 }}>
                {KIND_LABEL[r.kind]} · {SRC_LABEL[r.source] ?? r.source}
              </span>
              <button className="btn" onClick={() => setDelTarget(r)} aria-label="삭제"
                style={{ background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {delTarget && (
        <ConfirmDialog
          title="항목 삭제"
          variant="danger"
          confirmLabel="삭제"
          loading={busy}
          message={<>
            {fmtDateShortKo(delTarget.holiday_date)} · 『{delTarget.name}』({KIND_LABEL[delTarget.kind]})을(를) 삭제할까요?
            <div style={{ marginTop: 8, color: '#94A3B8' }}>달력·캘린더 뷰 표기에서 즉시 사라집니다.</div>
          </>}
          onConfirm={() => handleDelete(delTarget)}
          onClose={() => setDelTarget(null)}
        />
      )}
    </div>
  )
}
