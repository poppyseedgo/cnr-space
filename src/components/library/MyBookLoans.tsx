/**
 * MyBookLoans.tsx — 마이페이지 '내 대여' (조회 + 연장신청)
 *
 * [2026-07-18] 신규
 *
 * 스코프 (확정):
 *   · 조회: 본인 대여 현황 / 반납기한 / D-day / 대여 이력
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
// ← [2026-07-30] 알림 invoke 는 api.extendBookCheckoutWithNotify 로 이동 —
//   이 파일에서 supabase 직접 사용처가 사라져 import 제거.
import { fetchMyBookLoans, extendBookCheckoutWithNotify, extendErrorMessage,
  cancelBookCheckout, checkoutErrorMessage,
  fetchMyPenaltyState } from '../../lib/api'  // ← [2026-07-21] 예약 취소 / 연체 제재
import { ConfirmDialog } from '../common/ConfirmDialog' // ← [2026-07-30] 예약 취소 확인 (CTA 전수검사 P2)
import {
  loanDisplayStatus, loanStatusStyle, canExtend, extendBlockedReason,
  ddayLabel, fmtLoanDate, previewExtendedDue, EXTEND_DAYS, daysUntilDue,
  dueNoticeShort, fmtDueFullKo, fmtDueShortKo,   // ← [2026-07-20] 반납기한 표기 SSOT
  canCancelReservation,                          // ← [2026-07-21] 시작 전 예약 취소 판정
  penaltyTierLabel, daysUntilPenalty, penaltyOverdueDays, PENALTY_TIER_DAYS,
} from '../../utils/bookLoan'
import type { MyBookLoan, BookPenaltyState } from '../../types'
import { BookLoanDetailModal } from './BookLoanDetailModal'   // ← [2026-07-21] 상세

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
  // ← [2026-07-30 CTA 전수검사 P2] 예약 취소 확인 — 취소 즉시 그 기간을 타인이 선점할 수
  //   있는 불가역 액션인데 원클릭이었다 (같은 카드의 '연장'은 확인 모달이 있어 불일치)
  const [cancelTarget, setCancelTarget] = useState<MyBookLoan | null>(null)
  // ← [2026-07-21] 대여 상세. 지금까지 카드에 onClick 이 아예 없어
  //   "클릭이 안 된다" 는 인상을 줬다 (열 화면이 없었기 때문).
  const [detailLoan, setDetailLoan] = useState<MyBookLoan | null>(null)
  // ← [2026-07-21] 연체 제재 상태
  const [penalty, setPenalty] = useState<BookPenaltyState>({
    blocked: false, tier: null, blockedUntil: null, overdueDays: 0, reason: null,
  })

  // ── 내 대여 목록 로드 ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!authUserId) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const rows = await fetchMyBookLoans(authUserId)
      setLoans(rows)
      // 제재 조회는 실패해도 목록을 막지 않는다 (api 래퍼가 안전값 반환)
      setPenalty(await fetchMyPenaltyState())
    } catch (e: any) {
      setErrorMsg(e?.message ?? '대여 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [authUserId])

  useEffect(() => { load() }, [load])

  // ── 그룹 분리: 현재 대여중(active) / 이력(returned·lost) ───────────────────
  const { activeLoans, scheduledLoans, historyLoans, summary } = useMemo(() => {
    const act:   MyBookLoan[] = []
    const sched: MyBookLoan[] = []  // ← [2026-07-21] 대여 예정(시작 전 예약)
    const hist:  MyBookLoan[] = []
    let dueSoon = 0, overdue = 0

    for (const l of loans) {
      const s = loanDisplayStatus(l)
      // ← [2026-07-21] 승인 폐지. 'scheduled'(예약)가 pending 자리를 대체한다.
      //   pending/rejected 분기는 지우지 않는다 — 신규 생성은 없지만 과거 이력
      //   행이 남아 있고, 지우면 그 행들이 어느 그룹에도 안 잡혀 화면에서 사라진다.
      if (s === 'scheduled') { sched.push(l); continue }
      if (s === 'returned' || s === 'lost' ||
          s === 'rejected' || s === 'cancelled' || s === 'pending') {
        hist.push(l); continue
      }
      act.push(l)
      if (s === 'due_soon') dueSoon++
      if (s === 'overdue')  overdue++
    }
    return {
      activeLoans:    act,
      scheduledLoans: sched,
      historyLoans:   hist,
      summary: { total: act.length, dueSoon, overdue, scheduled: sched.length },
    }
  }, [loans])

  // ── 예약 취소 (← [2026-07-21]) ────────────────────────────────────────────
  //   시작 전 예약만 취소 가능. 서버 RPC(cancel_book_checkout)가 본인·상태·
  //   시작 여부(ALREADY_STARTED)를 재검증한다. 화면 판정은 UX 용이다.
  const doCancelReservation = async (loan: MyBookLoan) => {
    setExtendingId(loan.id)
    try {
      const res = await cancelBookCheckout(loan.id)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail))
        await load()
        return
      }
      showToast('예약을 취소했습니다')
      await load()
    } catch (e: any) {
      showToast(e?.message ?? '예약 취소에 실패했습니다')
    } finally {
      setExtendingId(null)
    }
  }

  // ── 연장 실행 ──────────────────────────────────────────────────────────────
  const doExtend = async (loan: MyBookLoan) => {
    setConfirmTarget(null)
    setExtendingId(loan.id)
    try {
      // ← [2026-07-30] RPC + book_extended 알림을 api 래퍼로 일원화.
      //   도서관 화면(카드/상세모달)의 연장 버튼과 같은 경로를 쓴다 —
      //   여기 인라인으로 두면 payload/문구가 두 갈래로 갈라진다.
      const res = await extendBookCheckoutWithNotify(loan.id, {
        userId: authUserId, bookTitle: loan.book?.title ?? '',
      })
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

      showToast(`연장되었습니다 · ${dueNoticeShort(updated.due_at)}`)
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

      {/* ← [2026-07-21] 대여 상세 */}
      {detailLoan && (
        <BookLoanDetailModal
          loan={detailLoan}
          onClose={() => setDetailLoan(null)}
        />
      )}

      {/* ── 연체 제재 배너 (← [2026-07-21]) ──────────────────────────────
          가장 위에 둔다. 대여가 막힌 상태에서 목록만 보면 이유를 알 수 없다. */}
      {penalty.blocked && (
        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: penalty.tier === 'permanent' ? '#FEF2F2' : '#FFFBEB',
          border: `1px solid ${penalty.tier === 'permanent' ? '#FECACA' : '#FDE68A'}`,
        }}>
          <div style={{
            fontSize: 14, fontWeight: 700,
            color: penalty.tier === 'permanent' ? '#B91C1C' : '#B45309',
          }}>
            {penaltyTierLabel(penalty.tier)}
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 6, lineHeight: 1.6 }}>
            {penalty.reason ?? '연체로 인해 대여가 제한되었습니다.'}
          </div>
          {penalty.blockedUntil && (
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
              해제 예정 {fmtDueShortKo(penalty.blockedUntil)}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, lineHeight: 1.6 }}>
            사정이 있는 경우 도서 관리자에게 문의하시면 해제할 수 있습니다.
          </div>
        </div>
      )}

      {/* ── 요약 카드 (F1) ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <SummaryCard label="대여중"   value={summary.total}   color="#1D4ED8" />
        <SummaryCard label="대여 예정" value={summary.scheduled} color="#4338CA" />{/* ← [2026-07-21] */}
        <SummaryCard label="반납임박" value={summary.dueSoon} color="#C2410C" />
        <SummaryCard label="연체"     value={summary.overdue} color="#DC2626" />
      </div>

      {/* ── 대여 예정 (← [2026-07-21] 예약) ─────────────────────────────── */}
      {scheduledLoans.length > 0 && (
        <section>
          <SectionTitle>대여 예정 <Count n={scheduledLoans.length} /></SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scheduledLoans.map(loan => (
              <ScheduledLoanCard
                key={loan.id}
                loan={loan}
                isMobile={isMobile}
                busy={extendingId === loan.id}
                canCancel={canCancelReservation(loan)}
                onCancel={() => setCancelTarget(loan)}  /* ← [2026-07-30] 확인 선행 */
              />
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8', lineHeight: 1.6 }}>
            대여 시작일 아침에 알림을 보내드립니다. 시작 전까지는 취소할 수 있습니다.
          </div>
        </section>
      )}

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
                onOpenDetail={() => setDetailLoan(loan)}
              />
            ))}
          </div>
        )}

        {/* 반납 안내 (F6) — 사용자는 앱에서 반납 처리 불가 */}
        {activeLoans.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#F8FAFC',
            border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#64748B',
            lineHeight: 1.6 }}>
            반납기한 이내에 도서를 관리자에게 전달하면 반납 처리됩니다. 연장은 1회({EXTEND_DAYS}일)만 가능합니다.
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
      {/* ← [2026-07-30 CTA 전수검사 P2] 예약 취소 확인 */}
      {cancelTarget && (
        <ConfirmDialog
          title="예약 취소"
          variant="danger"
          confirmLabel="예약 취소"
          loading={extendingId === cancelTarget.id}
          message={
            <>
              『{cancelTarget.book?.title ?? '이 도서'}』 예약을 취소할까요?
              <div style={{ marginTop: 8, color: '#94A3B8' }}>
                취소한 기간은 다른 직원이 예약할 수 있으며, 되돌리려면 다시 예약해야 합니다.
              </div>
            </>
          }
          onConfirm={async () => {
            await doCancelReservation(cancelTarget)
            setCancelTarget(null)
          }}
          onClose={() => setCancelTarget(null)}
        />
      )}

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
function ActiveLoanCard({ loan, isMobile, extending, onExtendClick, onOpenDetail }: {
  loan: MyBookLoan; isMobile: boolean; extending: boolean
  onExtendClick: () => void
  /** ← [2026-07-21] 카드 클릭 → 대여 상세 */
  onOpenDetail: () => void
}) {
  const ds      = loanDisplayStatus(loan)
  const style   = loanStatusStyle(ds)
  const ok      = canExtend(loan)
  const blocked = extendBlockedReason(loan)

  return (
    // ← [2026-07-21] 카드 전체를 클릭 가능하게. 연장 버튼은 아래에서
    //   stopPropagation 으로 분리한다 — 연장하려다 상세가 열리면 안 된다.
    <div
      onClick={onOpenDetail}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail() } }}
      style={{ display: 'flex', gap: 12, padding: 12, background: '#fff',
        border: '1px solid #EEF1F5', borderRadius: 14, cursor: 'pointer',
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
          대여 {fmtLoanDate(loan.checkout_at)} · {dueNoticeShort(loan.due_at)}
        </div>

        {/* ── 제재 예고 (← [2026-07-21]) ──────────────────────────────────
            반납기한(7일)이 지나도 제재는 14일부터 시작한다. 그 사이 구간에서
            사용자는 "연체라는데 왜 아직 빌려지지?" / "언제부터 막히지?" 를
            알 수 없다. 남은 일수를 명시해 반납을 유도한다. */}
        {(() => {
          // ← [2026-07-21] 면제 건은 제재 계산에서 완전히 빠진다.
          //   정책 시행 전에 빌린 책이 대부분 여기 해당하는데, 이 가드가 없으면
          //   "곧 대여가 제한됩니다" 라는 사실이 아닌 경고를 보게 된다.
          //   서버 book_penalty_state 도 penalty_exempt=false 만 계산하므로
          //   화면만 겁을 주고 실제로는 아무 일도 일어나지 않는 상태가 된다.
          if (loan.penalty_exempt) return null

          const over  = penaltyOverdueDays(loan.due_at, loan.extension_count)
          const left  = daysUntilPenalty(loan.due_at, loan.extension_count)
          if (over >= PENALTY_TIER_DAYS.warn) {
            return (
              <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4, fontWeight: 600 }}>
                대여 제한 적용 중 · 반납 시 제재 확정
              </div>
            )
          }
          // 예고는 '연체중' 뱃지가 뜨는 구간과 정확히 같이 나타나야 한다.
          //   뱃지는 due_at 기준(7일), 제재는 effective_due 기준(14일)이라
          //   그 사이에 "연체라는데 왜 빌려지지?" 구간이 생긴다.
          //   바로 그 구간에서만 남은 일수를 알려주는 것이 목적이므로
          //   임의의 임계값(D-3 등)이 아니라 연체 판정을 그대로 따른다.
          if (daysUntilDue(loan.due_at) < 0) {
            return (
              <div style={{ fontSize: 12, color: '#B45309', marginTop: 4, fontWeight: 600 }}>
                {left}일 뒤부터 대여가 제한됩니다
              </div>
            )
          }
          return null
        })()}
      </div>

      {/* 연장 버튼 (F3/F4) */}
      <button
        onClick={e => { e.stopPropagation(); onExtendClick() }}
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

/** 대여 예정(시작 전 예약) 카드 (← [2026-07-21]) */
function ScheduledLoanCard({ loan, isMobile, busy, canCancel, onCancel }: {
  loan: MyBookLoan; isMobile: boolean; busy: boolean
  canCancel: boolean; onCancel: () => void
}) {
  const style   = loanStatusStyle('scheduled')
  const startAt = loan.checkout_at ? fmtDueShortKo(loan.checkout_at) : null
  const dueAt   = loan.due_at      ? fmtDueShortKo(loan.due_at)      : null
  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, background: '#F8FAFF',
      border: '1px solid #C7D2FE', borderRadius: 14,
      alignItems: isMobile ? 'flex-start' : 'center' }}>
      <div style={{ width: 48, height: 66, flexShrink: 0, borderRadius: 6, overflow: 'hidden',
        background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loan.book?.cover_url
          ? <img src={loan.book.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 10, color: '#CBD5E1' }}>표지</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          background: style.bg, color: style.color }}>{style.label}</span>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loan.book?.title ?? '(제목 없음)'}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
          {[loan.book?.author, loan.book?.publisher].filter(Boolean).join(' · ') || '—'}
        </div>
        {startAt && (
          <div style={{ fontSize: 12, color: '#4338CA', marginTop: 4, fontWeight: 600 }}>
            {startAt} 대여 시작{dueAt ? ` · ${dueAt} 반납` : ''}
          </div>
        )}
      </div>
      {/* 시작일이 지나면 취소가 아니라 반납 경로다. 서버도 ALREADY_STARTED 로 막는다. */}
      {canCancel && (
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: '1px solid #E2E8F0', background: '#fff', color: '#64748B',
            cursor: busy ? 'default' : 'pointer', minWidth: 92,
          }}
        >{busy ? '처리중...' : '예약 취소'}</button>
      )}
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
          <b style={{ color: '#111' }}>{loan.book?.title ?? '이 도서'}</b>의 반납기한이<br />
          <b>{fmtDueShortKo(loan.due_at)}</b> → <b style={{ color: '#1D4ED8' }}>{fmtDueShortKo(newDue)}</b> 로 연장됩니다.
          <div style={{ marginTop: 8, fontSize: 12, color: '#111', fontWeight: 600 }}>
            {fmtDueFullKo(newDue)} 이내 반납하세요
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#94A3B8' }}>
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
