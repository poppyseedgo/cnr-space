/**
 * BookRequestPanel.tsx — [Admin] 도서 대여 신청 승인/거절 패널
 *
 * [2026-07-22] 신규
 *
 * 정책:
 *   · 선착순 정렬(requested_at 오름차순) — idx_book_checkouts_pending 사용
 *   · 승인: admin_approve_book_request RPC
 *     - 승인 시점 기준으로 checkout_at/due_at 재계산 (대여기간 보장)
 *     - 같은 책을 여러 명이 신청했다면 먼저 승인된 건만 확정,
 *       나머지는 승인 시도 시 BOOK_NOT_AVAILABLE 로 거절됨
 *   · 거절: admin_reject_book_request RPC (사유 최대 200자, 에메랄드 거절 패턴 준용)
 */

import { useState } from 'react'
import type { BookRequest, AppUser } from '../../types'

const REASON_MAX = 200

interface Props {
  requests:  BookRequest[]
  users:     AppUser[]
  loading:   boolean
  busyId:    string | null
  onApprove: (req: BookRequest) => void
  onReject:  (req: BookRequest, reason: string) => void
  onRefresh: () => void
}

export function BookRequestPanel({
  requests, users, loading, busyId, onApprove, onReject, onRefresh,
}: Props) {
  const [rejectTarget, setRejectTarget] = useState<BookRequest | null>(null)
  const [reason, setReason] = useState('')

  const nameOf = (uid: string) => {
    const u = users.find(x => x.user_id === uid)
    return { name: u?.name ?? '(알 수 없음)', dept: u?.dept ?? '' }
  }

  const fmtWhen = (iso?: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #FDE68A', borderRadius: 14,
      padding: 16, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>대여 신청 승인 대기</span>
          <span style={{
            padding: '2px 8px', borderRadius: 999, background: '#FEF3C7',
            color: '#B45309', fontSize: 12, fontWeight: 700,
          }}>{requests.length}</span>
        </div>
        <button
          onClick={onRefresh}
          style={{ border: '1px solid #E2E8F0', background: '#fff', borderRadius: 8,
            padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: '#475569' }}
        >새로고침</button>
      </div>

      {loading && requests.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>
          불러오는 중입니다...
        </div>
      ) : requests.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>
          승인 대기중인 신청이 없습니다
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map(r => {
            const who  = nameOf(r.user_id as any)
            const busy = busyId === r.id
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                border: '1px solid #F1F5F9', borderRadius: 10, background: '#FFFDF7',
              }}>
                {/* 표지 */}
                <div style={{ width: 36, height: 48, borderRadius: 4, overflow: 'hidden',
                  background: '#F1F5F9', flexShrink: 0 }}>
                  {r.book?.cover_url && (
                    <img src={r.book.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>

                {/* 정보 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: '#111',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.book?.title ?? '(제목 없음)'}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {who.name}{who.dept ? ` · ${who.dept}` : ''} · 신청 {fmtWhen(r.requested_at)}
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>메모: {r.notes}</div>
                  )}
                </div>

                {/* 액션 */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    disabled={busy}
                    onClick={() => { setRejectTarget(r); setReason('') }}
                    style={{
                      padding: '8px 12px', borderRadius: 8, fontSize: 13,
                      border: '1px solid #FECACA', background: '#fff', color: '#DC2626',
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >거절</button>
                  <button
                    disabled={busy}
                    onClick={() => onApprove(r)}
                    style={{
                      padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: 'none', background: busy ? '#CBD5E1' : '#111', color: '#fff',
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >{busy ? '처리중...' : '승인'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 거절 사유 모달 ─────────────────────────────────────────────── */}
      {rejectTarget && (
        <div
          onClick={() => setRejectTarget(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: 20,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>대여 신청 거절</div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 8, lineHeight: 1.6 }}>
              <b>{rejectTarget.book?.title}</b> 신청을 거절합니다.<br />
              사유는 신청자에게 알림으로 전달됩니다.
            </div>
            <textarea
              autoFocus
              value={reason}
              maxLength={REASON_MAX}
              onChange={e => setReason(e.target.value)}
              placeholder="거절 사유를 입력해주세요"
              style={{
                width: '100%', minHeight: 84, marginTop: 12, padding: 10,
                border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13,
                resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'right' }}>
              {reason.length}/{REASON_MAX}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setRejectTarget(null)}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid #E2E8F0',
                  background: '#F8FAFC', fontSize: 14, cursor: 'pointer' }}
              >취소</button>
              <button
                disabled={!reason.trim()}
                onClick={() => {
                  const t = rejectTarget
                  setRejectTarget(null)
                  onReject(t, reason.trim())
                }}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
                  background: reason.trim() ? '#DC2626' : '#CBD5E1', color: '#fff',
                  fontSize: 14, fontWeight: 600,
                  cursor: reason.trim() ? 'pointer' : 'not-allowed',
                }}
              >거절하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
