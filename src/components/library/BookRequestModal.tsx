/**
 * BookRequestModal.tsx — [일반 사용자] 도서 대여 신청
 *
 * [2026-07-22] 신규
 * Figma: 1336:1079
 *
 * Admin 등록 모달과의 차이:
 *   · 타이틀 "도서 대여 신청" / 확인 버튼 "대여 신청"
 *   · 책: 카드에서 진입한 1권 prefilled (검색 없음)
 *   · 대여자: 로그인 사용자 본인 고정 (아바타 chip, 변경 불가)
 *   · 대여일/반납일: 예상값 — 실제 값은 관리자 승인 시점에 확정된다
 *     (승인이 늦어지면 대여기간이 줄어드는 문제를 막기 위해 서버가 승인 시각 기준으로 재계산)
 *
 * 저장: request_book_checkout RPC → status='pending' 생성
 */

import { useState } from 'react'
import type { AppUser, Book } from '../../types'
import {
  OVERLAY, SHEET, ModalHeader, Field, ModalFooter, MemoField,
  DateRows, UserChipRow, MEMO_MAX,
} from './bookModalShared'

interface Props {
  book:       Book
  me:         AppUser | null      // 로그인 사용자 (users 에서 authUserId 로 조회)
  /** 본인의 현재 보유 권수 (active + pending) */
  heldCount:  number
  maxBorrow:  number
  borrowDays: number
  loading:    boolean
  onClose:    () => void
  onSubmit:   (bookIds: number[], notes: string) => void
}

export function BookRequestModal({
  book, me, heldCount, maxBorrow, borrowDays, loading, onClose, onSubmit,
}: Props) {
  const [memo, setMemo] = useState('')

  const remain    = Math.max(0, maxBorrow - heldCount)
  const overLimit = remain < 1
  const canSubmit = !overLimit && !loading

  const hint = overLimit
    ? `대여·신청 합계 ${maxBorrow}권까지 가능합니다 (현재 ${heldCount}권)`
    : null

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>
        <ModalHeader title="도서 대여 신청" onClose={onClose} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>

          {/* ── 책 (prefilled, 변경 불가) ──────────────────────────────── */}
          <Field label="책">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {book.cover_url && (
                <div style={{ width: 28, height: 38, borderRadius: 4, overflow: 'hidden',
                  background: '#E2E8F0', flexShrink: 0 }}>
                  <img src={book.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <span style={{
                fontSize: 20, fontWeight: 500, color: '#111', lineHeight: 1.5,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{book.title}</span>
            </div>
          </Field>

          {/* ── 대여자 (본인 고정) ─────────────────────────────────────── */}
          <Field label="대여자" required>
            {me
              ? <UserChipRow
                  name={me.name}
                  dept={me.dept}
                  avatarUrl={(me as any).avatar_url ?? null}
                />
              : <span style={{ fontSize: 14, color: '#94A3B8' }}>사용자 정보를 불러오는 중입니다…</span>}
          </Field>

          {/* ── 대여일 / 반납일 (예상값) ───────────────────────────────── */}
          <DateRows
            borrowDays={borrowDays}
            noteText="관리자 승인 시점을 기준으로 확정됩니다"
          />

          {/* ── 메모 ───────────────────────────────────────────────────── */}
          <MemoField value={memo} onChange={setMemo} />

          {/* 안내 */}
          <div style={{
            marginTop: 12, padding: '10px 12px', background: '#FFFBEB',
            border: '1px solid #FDE68A', borderRadius: 8,
            fontSize: 12, color: '#92400E', lineHeight: 1.6,
          }}>
            신청 후 관리자 승인이 완료되면 대여가 확정됩니다.
            같은 도서를 여러 명이 신청한 경우 먼저 승인된 신청이 확정됩니다.
          </div>
        </div>

        <ModalFooter
          confirmLabel="대여 신청"
          onCancel={onClose}
          onConfirm={() => onSubmit([book.id], memo.slice(0, MEMO_MAX))}
          disabled={!canSubmit || !me}
          loading={loading}
          hint={hint}
        />
      </div>
    </div>
  )
}
