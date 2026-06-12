import { useState, useEffect, useRef, useMemo } from 'react'
import { UserCog } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { fmtTSDateFull, fmtTSRangeFull } from '../../utils/time'
import type { Booking, Room, AppUser } from '../../types'
import { Button } from '../common/Button'
import { ModalCloseButton } from '../common/ModalCloseButton'
import { UserAvatar } from '../common/UserAvatar'

/**
 * ChangeOwnerModal — 관리자 전용 "예약자 변경" 다이얼로그
 *
 * ✅ 변경 이력
 *  - [2026-06-12 신규] 예약자(소유권) 변경 기능
 *      · DetailModal 관리자 분기 "예약자 변경" 버튼에서 호출
 *      · 사용자 피커: BookingModal 참석자 검색의 메모리 필터 패턴 재사용 (DB 호출 0회)
 *      · 모달 스타일: ConfirmForceCancelModal 통일 (아이콘 헤더 + 요약 카드 + ModalCloseButton)
 *
 * 설계 원칙 (고지 확정 정책 2026-06-12):
 *  · 변경 가능 범위: 미래 + confirmed (DetailModal 버튼 노출 조건 + RPC 가드 이중 차단)
 *  · 피커 제외 대상: 현재 예약자(user_id) + 퇴사자(is_active=false)
 *      - 참석자는 제외하지 않음 → 선택 시 RPC가 참석자 목록에서 자동 제거 후 승격
 *      - 참석자인 사용자에는 "현재 참석자" 뱃지 표시 + 자동 승격 안내문 노출
 *  · 이름 비교 금지: 식별은 전적으로 user_id (RPC도 user_id 기준)
 *  · 파괴적/중요 액션이므로 선택 전 버튼 비활성 + 처리 중 중복 클릭 방지
 */

interface ChangeOwnerModalProps {
  booking:   Booking
  room?:     Room
  users:     AppUser[]
  /** 새 예약자 user_id 전달 — async (App.tsx에서 RPC + 알림 2종 발사) */
  onConfirm: (newUserId: string) => Promise<void> | void
  onClose:   () => void
}

export function ChangeOwnerModal({ booking: b, room: r, users, onConfirm, onClose }: ChangeOwnerModalProps) {
  const { isMobile } = useBreakpoint()
  const [query,    setQuery]    = useState('')
  const [focused,  setFocused]  = useState(false)
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [loading,  setLoading]  = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 현재 예약자 live 표시 (user_id 매칭 → 없으면 스냅샷 fallback)
  const currentOwner = useMemo(
    () => users.find(u => u.user_id === b.user_id),
    [users, b.user_id],
  )
  const ownerName = currentOwner?.name ?? b.user
  const ownerDept = currentOwner?.dept ?? b.dept

  // 현재 참석자 email 집합 (소문자 정규화) — "현재 참석자" 뱃지/안내용
  const attendeeEmails = useMemo(
    () => new Set((b.attendees ?? []).map(a => (a.email ?? '').trim().toLowerCase())),
    [b.attendees],
  )

  // ── 검색 결과 (메모리 필터링, DB 호출 0회 — BookingModal 패턴) ──────────────
  //   제외: 현재 예약자(no-op 방지) + 퇴사자. 참석자는 포함(선택 시 자동 승격).
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 1) return []
    return users
      .filter(u => {
        if (u.user_id === b.user_id) return false   // 현재 예약자 제외
        if (u.is_active === false)   return false   // 퇴사자 제외
        const name  = (u.name  ?? '').toLowerCase()
        const email = (u.email ?? '').toLowerCase()
        const dept  = (u.dept  ?? '').toLowerCase()
        return name.includes(q) || email.includes(q) || dept.includes(q)
      })
      .slice(0, 8)
  }, [query, users, b.user_id])

  // 선택된 사용자가 현재 참석자인지 (자동 승격 안내문 표시용)
  const selectedIsAttendee = !!selected
    && attendeeEmails.has((selected.email ?? '').trim().toLowerCase())

  // ESC 닫기 (처리 중이 아닐 때만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (u: AppUser) => {            // ← 사용자 선택
    setSelected(u)
    setQuery('')
    setFocused(false)
  }

  const handleConfirm = async () => {       // ← 예약자 변경 확정 (async RPC + 알림)
    if (loading || !selected) return
    setLoading(true)
    try {
      await onConfirm(selected.user_id)
    } catch {
      setLoading(false)                     // 실패 시 다이얼로그 유지 (성공 시 App.tsx가 setModal(null))
    }
  }

  return (
    <div className="anm" style={{
      background: '#fff',
      borderRadius: isMobile ? '20px 20px 0 0' : 16,
      width: '100%',
      maxWidth: isMobile ? '100%' : 420,
      boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignSelf: isMobile ? 'flex-end' : 'center',
      position: 'relative',
    }}>
      {/* 모바일 drag handle */}
      {isMobile && (
        <div style={{
          width: 36, height: 4, background: '#E2E8F0', borderRadius: 2,
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1,
        }} />
      )}

      <div style={{ padding: isMobile ? '28px 20px 16px' : '24px 24px 16px' }}>
        {/* 헤더: 아이콘 + 제목 + 닫기 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <UserCog size={18} strokeWidth={2} color="#4F46E5" />
            </div>
            <div style={{ fontSize: isMobile ? 16 : 17, fontWeight: 600, color: '#111111', lineHeight: 1.4 }}>
              예약자 변경
            </div>
          </div>
          <ModalCloseButton onClick={onClose} disabled={loading} style={{ marginLeft: 8 }} />
        </div>

        {/* 예약 요약 카드 (현재 예약자 포함) */}
        <div style={{ background: '#F8FAFC', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111111', wordBreak: 'break-word', marginBottom: 6, lineHeight: 1.35 }}>
            {b.title}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
            <div>
              <span style={{ color: r?.color ?? '#64748B', fontWeight: 600 }}>{r?.room_name ?? '-'}</span>
            </div>
            <div>{fmtTSDateFull(b.start_at)}</div>
            <div>{fmtTSRangeFull(b.start_at, b.end_at)}</div>
            <div style={{ marginTop: 4, color: '#94A3B8' }}>
              현재 예약자: <span style={{ color: '#475569', fontWeight: 600 }}>{ownerName}</span>
              {ownerDept ? ` · ${ownerDept}` : ''}
            </div>
          </div>
        </div>

        {/* 새 예약자 선택 */}
        <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', display: 'block', marginBottom: 6, letterSpacing: '0.4px' }}>
          새 예약자 선택
        </label>

        {/* 선택 완료 칩 (선택 후 표시) */}
        {selected ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 10,
            padding: '10px 12px', marginBottom: selectedIsAttendee ? 8 : 12,
          }}>
            <UserAvatar name={selected.name} avatarUrl={selected.avatar_url ?? null} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{selected.name}</div>
              <div style={{ fontSize: 11, color: '#6366F1' }}>{selected.dept}{selected.dept && selected.email ? ' · ' : ''}{selected.email}</div>
            </div>
            <button
              onClick={() => { setSelected(null); setFocused(true) }}
              disabled={loading}
              style={{
                fontSize: 12, fontWeight: 600, color: '#4F46E5',
                background: 'transparent', border: 0, cursor: loading ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}>
              변경
            </button>
          </div>
        ) : (
          /* 검색 인풋 + 드롭다운 */
          <div ref={boxRef} style={{ position: 'relative', marginBottom: 12 }}>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setFocused(true) }}
              onFocus={() => setFocused(true)}
              disabled={loading}
              placeholder="이름 또는 부서로 검색..."
              style={{
                width: '100%', background: '#F8FAFC',
                border: `1px solid ${focused ? '#6366F1' : '#E2E8F0'}`,
                borderRadius: 10, color: '#111111', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }} />
            {/* 결과 드롭다운 */}
            {focused && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
                background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.10)', overflow: 'hidden',
              }}>
                {suggestions.map(u => {
                  const isAtt = attendeeEmails.has((u.email ?? '').trim().toLowerCase())  // 현재 참석자 여부
                  return (
                    <div key={u.user_id} onClick={() => pick(u)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                        cursor: 'pointer', borderBottom: '1px solid #F8FAFC',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <UserAvatar name={u.name} avatarUrl={u.avatar_url ?? null} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>{u.dept} · {u.email}</div>
                      </div>
                      {isAtt && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#0891B2', background: '#E0F2FE', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>
                          현재 참석자
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {/* 결과 없음 */}
            {focused && query.trim().length > 0 && suggestions.length === 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
                background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                padding: '12px 14px', fontSize: 12, color: '#94A3B8', boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
              }}>
                검색 결과가 없습니다
              </div>
            )}
          </div>
        )}

        {/* 참석자 자동 승격 안내 (선택된 사용자가 현재 참석자일 때만) */}
        {selectedIsAttendee && (
          <div style={{
            background: '#E0F2FE', border: '1px solid #BAE6FD', borderRadius: 10,
            padding: '10px 12px', fontSize: 12, color: '#0369A1', lineHeight: 1.5, marginBottom: 12,
          }}>
            이 사용자는 현재 <b>참석자</b>입니다. 예약자로 지정되면 참석자 목록에서 자동으로 제거됩니다.
          </div>
        )}

        {/* 발송 안내 문구 */}
        <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
          변경 시 새 예약자와 참석자에게 변경 알림이, 기존 예약자에게는 예약자에서 변경되었다는 알림이 발송됩니다.
        </div>
      </div>

      {/* 버튼 영역 — 기본 focus = "돌아가기" (실수 방지) */}
      <div style={{ display: 'flex', gap: 8, padding: isMobile ? '8px 20px 20px' : '8px 24px 20px' }}>
        <Button variant="ghost" flex onClick={onClose} disabled={loading} autoFocus>
          돌아가기
        </Button>
        <Button variant="primary" flex onClick={handleConfirm} loading={loading} disabled={!selected}>
          {loading ? '처리 중' : '예약자 변경'}
        </Button>
      </div>
    </div>
  )
}
