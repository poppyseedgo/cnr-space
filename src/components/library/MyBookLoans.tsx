/**
 * MyBookLoans.tsx — 마이페이지 '내 대여' (조회 + 연장신청)
 *
 * [2026-07-18] 신규
 *
 * 스코프 (확정):
 *   · 조회: 본인 대여 현황 / 반납예정일 / D-day / 대여 이력
 *   · 연장: 1회 +7일, 서버 RPC(extend_book_checkout) 경유
 *   · 반납/분실 전이는 관리자 전용 → 사용자 화면엔 안내 문구만 (버튼 없음)
 *
 * 설계 메모:
 *   · 연체 판정은 DB status가 아닌 due_at 기준 (utils/bookLoan.ts SSOT).
 *     active→overdue 자동 전환 배치가 없어 DB status만 믿으면 연체가 안 잡힌다.
 *   · 연장은 낙관적 갱신하지 않고 RPC 성공 응답의 due_at/extension_count로 반영.
 *     서버가 계산한 값이 유일한 정답이므로 클라 추정값을 쓰지 않는다.
 *   · 애니메이션은 transform 기반 spin(index.css) 재사용 — iPad Safari 성능 고려.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
// ← [2026-07-20 fix] 연장 완료 알림(send-notification invoke)에 supabase 클라이언트 필요.
//   경로는 components/library/ 기준 두 단계 상위 (LibraryPage는 '../lib/supabase')
import { supabase } from '../../lib/supabase'
import { fetchMyBookLoans, extendBookCheckout, extendErrorMessage } from '../../lib/api'
import {
  loanDisplayStatus, loanStatusStyle, canExtend, extendBlockedReason,
  ddayLabel, fmtLoanDate, previewExtendedDue, EXTEND_DAYS,
} from '../../utils/bookLoan'
import type { MyBookLoan } from '../../types'

interface Props {
  authUserId: string
  showToast:  (msg: string) => void
  isMobile?:  boolean
}

export function MyBookLoans({ authUserId, showToast, isMobile = false }: Props) {
  const [loans,     setLoans]     = useState<MyBookLoan[]>([])
  const [loading,   setLoading]   = useState(false)
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)
  const [extendingId, setExtendingId] = useState<string | null>(null)   // 연장 진행중 카드
  const [confirmTarget, setConfirmTarget] = useState<MyBookLoan | null>(null)

  // ── 내 대여 목록 로드 ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!authUserId) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const rows = await fetchMyBookLoans(authUserId)
      setLoans(rows)
    } catch (e: any) {
      setErrorMsg(e?.message ?? '대여 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [authUserId])

  useEffect(() => { load() }, [load])

  // ── 그룹 분리: 현재 대여중(active) / 이력(returned·lost) ───────────────────
  const { activeLoans, historyLoans, summary } = useMemo(() => {
    const act:  MyBookLoan[] = []
    const hist: MyBookLoan[] = []
    let dueSoon = 0, overdue = 0

    for (const l of loans) {
      const s = loanDisplayStatus(l)
      if (s === 'returned' || s === 'lost') { hist.push(l); continue }
      act.push(l)
      if (s === 'due_soon') dueSoon++
      if (s === 'overdue')  overdue++
    }
    return {
      activeLoans:  act,
      historyLoans: hist,
      summary: { total: act.length, dueSoon, overdue },
    }
  }, [loans])

  // ── 연장 실행 ──────────────────────────────────────────────────────────────
  const doExtend = async (loan: MyBookLoan) => {
    setConfirmTarget(null)
    setExtendingId(loan.id)
    try {
      const res = await extendBookCheckout(loan.id)
      // ← [2026-07-20 fix] strict=false 환경에서는 판별 유니온 좁히기가
      //   동작하지 않으므로, res.row / res.code 를 옵셔널로 직접 확인한다.
      if (!res.ok || !res.row) {
        showToast(extendErrorMessage(res.code ?? 'UNKNOWN'))
        // 서버가 거절한 경우 실제 상태와 어긋났을 수 있으므로 재조회
        await load()
        return
      }
      const updated = res.row
      // 서버가 계산한 due_at / extension_count 로 반영 (book 정보는 기존 것 유지)
      setLoans(prev => prev.map(p =>
        p.id === updated.id ? { ...updated, book: p.book } : p
      ))

      // ── [2026-07-20] 연장 완료 알림 (이메일 + 인앱) ──────────────────────
      //   · 수신자: 본인 1명 (POLICIES.book_extended → recipients='book_borrower')
      //   · 알림 실패가 연장 자체를 되돌리면 안 되므로 catch로 흡수
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'book_extended',
          booking: {
            id:         updated.id,
            title:      loan.book?.title ?? '',
            user_id:    authUserId,
            book_title: loan.book?.title ?? '',
            due_at:     updated.due_at,
          },
        },
      }).catch(err => console.warn('[myloans] 연장 알림 발송 실패:', err))

      showToast(`연장되었습니다 (반납예정 ${fmtLoanDate(updated.due_at)})`)
    } catch (e: any) {
      showToast(e?.message ?? '연장에 실패했습니다')
    } finally {
      setExtendingId(null)
    }
  }

  // ── 로딩 ──────────────────────────────────────────────────────────────────
  if (loading && loans.length === 0) {
    return (
      <div style={{ padding: '40px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 10 }}>
        <span style={{ width: 16, height: 16, borderRadius: '50%',
          border: '2px solid #CBD5E1', borderTopColor: '#334155',
          display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ fontSize: 13, color: '#475569' }}>대여 정보를 불러오는 중입니다...</span>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div style={{ padding: '24px 0' }}>
        <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 8, color: '#DC2626', fontSize: 13 }}>
          {errorMsg}
        </div>
        <button onClick={load} style={{ marginTop: 10, padding: '8px 14px', fontSize: 13,
          border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── 요약 카드 (F1) ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <SummaryCard label="대여중"   value={summary.total}   color="#1D4ED8" />
        <SummaryCard label="반납임박" value={summary.dueSoon} color="#C2410C" />
        <SummaryCard label="연체"     value={summary.overdue} color="#DC2626" />
      </div>

      {/* ── 현재 대여중 (F2/F3/F4) ─────────────────────────────────────── */}
      <section>
        <SectionTitle>현재 대여중 <Count n={activeLoans.length} /></SectionTitle>

        {activeLoans.length === 0 ? (
          <EmptyBox text="대여 중인 도서가 없습니다" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeLoans.map(loan => (
              <ActiveLoanCard
                key={loan.id}
                loan={loan}
                isMobile={isMobile}
                extending={extendingId === loan.id}
                onExtendClick={() => setConfirmTarget(loan)}
              />
            ))}
          </div>
        )}

        {/* 반납 안내 (F6) — 사용자는 앱에서 반납 처리 불가 */}
        {activeLoans.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#F8FAFC',
            border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#64748B',
            lineHeight: 1.6 }}>
            반납은 도서를 관리자에게 전달하면 처리됩니다. 연장은 1회({EXTEND_DAYS}일)만 가능합니다.
          </div>
        )}
      </section>

      {/* ── 대여 이력 (F5) ─────────────────────────────────────────────── */}
      <section>
        <SectionTitle>대여 이력 <Count n={historyLoans.length} /></SectionTitle>
        {historyLoans.length === 0 ? (
          <EmptyBox text="대여 이력이 없습니다" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historyLoans.map(l => <LoanHistoryRow key={l.id} loan={l} isMobile={isMobile} />)}
          </div>
        )}
      </section>

      {/* ── 연장 확인 모달 (F3) ────────────────────────────────────────── */}
      {confirmTarget && (
        <ExtendConfirmModal
          loan={confirmTarget}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => doExtend(confirmTarget)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 하위 컴포넌트
// ═══════════════════════════════════════════════════════════════════════════

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 10,
      display: 'flex', alignItems: 'center', gap: 6 }}>
      {children}
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span style={{ fontSize: 13, fontWeight: 500, color: '#94A3B8' }}>{n}권</span>
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8',
      background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 10 }}>
      {text}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 96, padding: '14px 16px', background: '#fff',
      border: '1px solid #EEF1F5', borderRadius: 14 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/** 현재 대여중 카드 — 표지 + 정보 + 연장 버튼 */
function ActiveLoanCard({ loan, isMobile, extending, onExtendClick }: {
  loan: MyBookLoan; isMobile: boolean; extending: boolean; onExtendClick: () => void
}) {
  const ds      = loanDisplayStatus(loan)
  const style   = loanStatusStyle(ds)
  const ok      = canExtend(loan)
  const blocked = extendBlockedReason(loan)

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, background: '#fff',
      border: '1px solid #EEF1F5', borderRadius: 14,
      alignItems: isMobile ? 'flex-start' : 'center' }}>

      {/* 표지 */}
      <div style={{ width: 48, height: 66, flexShrink: 0, borderRadius: 6, overflow: 'hidden',
        background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loan.book?.cover_url
          ? <img src={loan.book.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 10, color: '#CBD5E1' }}>표지</span>}
      </div>

      {/* 정보 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: style.bg, color: style.color }}>{style.label}</span>
          <span style={{ fontSize: 11, fontWeight: 600,
            color: ds === 'overdue' ? '#DC2626' : '#64748B' }}>
            {ddayLabel(loan.due_at)}
          </span>
          {loan.extension_count > 0 && (
            <span style={{ fontSize: 11, color: '#94A3B8' }}>연장 1회</span>
          )}
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loan.book?.title ?? '(제목 없음)'}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
          {[loan.book?.author, loan.book?.publisher].filter(Boolean).join(' · ') || '—'}
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
          대여 {fmtLoanDate(loan.checkout_at)} · 반납예정 {fmtLoanDate(loan.due_at)}
        </div>
      </div>

      {/* 연장 버튼 (F3/F4) */}
      <button
        onClick={onExtendClick}
        disabled={!ok || extending}
        style={{
          flexShrink: 0, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          border: ok ? 'none' : '1px solid #E2E8F0',
          background: ok ? '#111' : '#F8FAFC',
          color:      ok ? '#fff' : (ds === 'overdue' ? '#DC2626' : '#94A3B8'),
          cursor:     ok && !extending ? 'pointer' : 'default',
          minWidth: 92,
        }}
      >
        {extending ? '처리중...' : (ok ? '연장' : (blocked ?? '연장 불가'))}
      </button>
    </div>
  )
}

/** 대여 이력 행 */
function LoanHistoryRow({ loan, isMobile }: { loan: MyBookLoan; isMobile: boolean }) {
  const style = loanStatusStyle(loanDisplayStatus(loan))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      background: '#fff', border: '1px solid #F1F5F9', borderRadius: 10 }}>
      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: style.bg, color: style.color, flexShrink: 0 }}>{style.label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#334155',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {loan.book?.title ?? '(제목 없음)'}
      </span>
      {!isMobile && (
        <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>
          {fmtLoanDate(loan.checkout_at)} ~ {loan.returned_at ? fmtLoanDate(loan.returned_at) : '—'}
        </span>
      )}
    </div>
  )
}

/** 연장 확인 모달 */
function ExtendConfirmModal({ loan, onCancel, onConfirm }: {
  loan: MyBookLoan; onCancel: () => void; onConfirm: () => void
}) {
  const newDue = previewExtendedDue(loan.due_at)
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: 20 }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>대여 연장</div>
        <div style={{ fontSize: 13, color: '#475569', marginTop: 10, lineHeight: 1.7 }}>
          <b style={{ color: '#111' }}>{loan.book?.title ?? '이 도서'}</b>의 반납예정일이<br />
          <b>{fmtLoanDate(loan.due_at)}</b> → <b style={{ color: '#1D4ED8' }}>{fmtLoanDate(newDue)}</b> 로 연장됩니다.
          <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8' }}>
            연장은 1회만 가능하며, 이후에는 반납해야 합니다.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '11px 0', borderRadius: 10,
            border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}>
            취소
          </button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '11px 0', borderRadius: 10,
            border: 'none', background: '#111', color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: 'pointer' }}>
            연장하기
          </button>
        </div>
      </div>
    </div>
  )
}
