/**
 * EmploymentStatusModal — 재직 상태 변경 + 즉시 퇴사 모달 (AdminUsers 전용)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 퇴사자 정책 개편 Phase 3 묶음②
 *      · 상태 변경: 재직/휴직/복직/퇴사예정(예정일 필수) — admin_set_employment_status RPC
 *      · 즉시 퇴사: depart-user Edge Function — 실행 전 프리뷰(미래 예약 N건 취소,
 *        진행 대여 M건 강제 반납) + 체크박스 확인 2단계. 복구 불가(확정 정책)
 *      · 퇴사 예정 자동화 안내: 예정일 익일 00시 자동 퇴사 (마지막 근무일 보장)
 *      · 낙관적 갱신 금지 — RPC 응답값을 SSOT 로 반영 (연장 RPC 관례 동일)
 *
 * 📌 확정 정책 반영
 *    · 복구 기능 없음 — 즉시 퇴사에 되돌리기 경로를 만들지 않는다
 *    · 알림 미발송 — 이 모달은 send-notification 을 호출하지 않는다
 *    · 복직 라벨은 30일 후 서버 cron 이 자동 소멸 (클라 관여 없음)
 */

import { useEffect, useState } from 'react'
import { DateField } from '../common/DateField' // ← [2026-08-03] 공통 날짜 필드
import { ModalPortal } from '../common/ModalPortal'
import { ModalCloseButton } from '../common/ModalCloseButton'
import { UserAvatar } from '../common/UserAvatar'
import { EmploymentBadge } from '../common/EmploymentBadge'
import {
  setEmploymentStatus, departUser, countFutureBookings, countActiveBookLoans,
} from '../../lib/api'
import {
  employmentStatusErrorMessage, departUserErrorMessage,
} from '../../utils/employment'
import type { AppUser, EmploymentStatus } from '../../types'

interface Props {
  user:            AppUser
  showToast:       (msg: string, type?: string) => void
  onClose:         () => void
  /** 상태 변경 성공 — RPC 응답값 전달 (호출측이 users state 패치) */
  onStatusChanged: (userId: string, patch: Partial<AppUser>) => void
  /** 즉시 퇴사 완료 — 호출측이 users/departed 재로드 */
  onDeparted:      () => void
}

const STATUS_OPTIONS: { id: EmploymentStatus; label: string; desc: string }[] = [
  { id: 'active',    label: '재직',      desc: '기본 상태 — 라벨 없음' },
  { id: 'leave',     label: '휴직',      desc: '로그인·조회 가능, 예약·대여 생성 차단' },
  { id: 'returned',  label: '복직',      desc: '복직 라벨 표시 — 30일 후 자동으로 재직 전환' },
  { id: 'departing', label: '퇴사 예정', desc: '예정일(마지막 근무일)까지 사용 가능, 익일 00시 자동 퇴사' },
]

export function EmploymentStatusModal({ user, showToast, onClose, onStatusChanged, onDeparted }: Props) {
  const [status,      setStatus]      = useState<EmploymentStatus>(user.employment_status ?? 'active')
  const [departureOn, setDepartureOn] = useState<string>(user.departure_scheduled_on ?? '')
  const [saving,      setSaving]      = useState(false)

  // ── 즉시 퇴사 확인 단계 ──
  const [confirmDepart, setConfirmDepart] = useState(false)
  const [ack,           setAck]           = useState(false)
  const [departing,     setDeparting]     = useState(false)
  const [preview, setPreview] = useState<{ bookings: number; loans: number } | null>(null)

  // 확인 단계 진입 시 프리뷰 조회 (미래 예약 / 진행 대여)
  useEffect(() => {
    if (!confirmDepart) return
    let cancelled = false
    Promise.all([countFutureBookings(user.user_id), countActiveBookLoans(user.user_id)])
      .then(([bookings, loans]) => { if (!cancelled) setPreview({ bookings, loans }) })
      .catch(() => { if (!cancelled) setPreview({ bookings: 0, loans: 0 }) })
    return () => { cancelled = true }
  }, [confirmDepart, user.user_id])

  const dirty = status !== (user.employment_status ?? 'active')
             || (status === 'departing' && departureOn !== (user.departure_scheduled_on ?? ''))

  const saveStatus = async () => {
    if (status === 'departing' && !departureOn) { showToast('퇴사 예정일을 지정해 주세요.', 'error'); return }
    setSaving(true)
    try {
      // 서버 응답값이 SSOT — 낙관적 갱신 금지 (전이 검증·날짜 정합을 서버가 확정)
      const res = await setEmploymentStatus(user.user_id, status, status === 'departing' ? departureOn : undefined)
      onStatusChanged(user.user_id, {
        employment_status:      res.employment_status as EmploymentStatus,
        departure_scheduled_on: res.departure_scheduled_on,
        returned_on:            res.returned_on,
      })
      showToast('재직 상태를 변경했습니다.', 'success')
      onClose()
    } catch (e) {
      showToast(employmentStatusErrorMessage(e), 'error')
    } finally { setSaving(false) }
  }

  const runDepart = async () => {
    setDeparting(true)
    try {
      const res = await departUser(user.user_id)
      showToast(`퇴사 처리 완료 — 예약 ${res.cancelledBookings}건 취소`, 'success')
      onDeparted()
      onClose()
    } catch (e) {
      showToast(departUserErrorMessage(e), 'error')
    } finally { setDeparting(false) }
  }

  const inputStyle: React.CSSProperties = {
    width:'100%', padding:'9px 12px', borderRadius:10, border:'1px solid #E2E8F0',
    fontSize:13, background:'#fff', outline:'none', boxSizing:'border-box',
  }

  return (
    <ModalPortal>
      <div onClick={onClose}
        style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100, padding:16 }}>
        <div className="anm" onClick={e => e.stopPropagation()}
          style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:440, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.15)', position:'relative' }}>
          <ModalCloseButton onClick={onClose} size="sm" style={{ position:'absolute', top:14, right:14 }} />

          {/* ── 헤더: 라벨(아바타 앞) + 아바타 + 이름 — 확정 요구사항 배치 ── */}
          <div style={{ padding:'20px 24px 14px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:10 }}>
            <EmploymentBadge user={user} />
            <UserAvatar name={user.name} avatarUrl={user.avatar_url ?? null} size={36} />
            <div>
              <div style={{ fontSize:14, fontWeight:600, color:'#111' }}>{user.name}</div>
              <div style={{ fontSize:11, color:'#94A3B8' }}>{user.dept || '-'} · {user.email}</div>
            </div>
          </div>

          {!confirmDepart ? (
            <>
              {/* ── 상태 선택 ── */}
              <div style={{ padding:'16px 24px' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#94A3B8', marginBottom:8 }}>재직 상태</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {STATUS_OPTIONS.map(o => {
                    const on = status === o.id
                    return (
                      <label key={o.id}
                        style={{ display:'flex', alignItems:'flex-start', gap:9, padding:'10px 12px', borderRadius:10,
                          border:`1px solid ${on ? '#111' : '#E2E8F0'}`, background: on ? '#F8FAFC' : '#fff', cursor:'pointer' }}>
                        <input type="radio" name="empStatus" checked={on} onChange={() => setStatus(o.id)} style={{ marginTop:2 }}/>
                        <span>
                          <span style={{ fontSize:13, fontWeight:600, color:'#111' }}>{o.label}</span>
                          <span style={{ display:'block', fontSize:11, color:'#94A3B8', marginTop:2 }}>{o.desc}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>

                {/* 퇴사 예정일 — departing 선택 시에만 */}
                {status === 'departing' && (
                  <div style={{ marginTop:12 }}>
                    <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>
                      퇴사 예정일 (마지막 근무일) *
                    </label>
                    {/* ← [2026-08-03] native date → 공통 DateField (공휴일 표기·UI 통일) */}
                    <DateField value={departureOn}
                      min={new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}  /* KST 오늘 — 서버 검증과 동일 기준 */
                      onChange={setDepartureOn} style={{ ...inputStyle, display: 'inline-flex' }}/>
                    <div style={{ fontSize:11, color:'#B45309', marginTop:6, lineHeight:1.5 }}>
                      예정일 당일까지 정상 사용 가능하며, <b>익일 00시</b>에 자동 퇴사 처리됩니다.
                      예정일 이후 시작 예약은 지금부터 생성이 차단되고, 기존 예약은 퇴사 시점에 일괄 취소됩니다.
                    </div>
                  </div>
                )}

                <button className="btn" onClick={saveStatus} disabled={saving || !dirty}
                  style={{ width:'100%', marginTop:14, padding:'11px 0', borderRadius:10, fontSize:13, fontWeight:600,
                    background: (saving || !dirty) ? '#F1F5F9' : '#111',
                    color:      (saving || !dirty) ? '#94A3B8' : '#fff',
                    cursor:     (saving || !dirty) ? 'not-allowed' : 'pointer', border:'none' }}>
                  {saving ? '저장 중...' : '상태 저장'}
                </button>
              </div>

              {/* ── 즉시 퇴사 진입 ── */}
              <div style={{ padding:'14px 24px 20px', borderTop:'1px solid #F1F5F9' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#DC2626', marginBottom:6 }}>즉시 퇴사 처리</div>
                <div style={{ fontSize:11, color:'#94A3B8', lineHeight:1.5, marginBottom:10 }}>
                  미래 예약 취소 · 도서/자원 강제 반납 · 권한 회수 · 계정 삭제가 즉시 실행됩니다. 복구할 수 없습니다.
                </div>
                <button className="btn" onClick={() => { setAck(false); setPreview(null); setConfirmDepart(true) }}
                  style={{ width:'100%', padding:'10px 0', borderRadius:10, fontSize:13, fontWeight:600,
                    background:'#FFF5F5', border:'1px solid #FECACA', color:'#DC2626', cursor:'pointer' }}>
                  퇴사 처리...
                </button>
              </div>
            </>
          ) : (
            /* ── 즉시 퇴사 확인 단계 ── */
            <div style={{ padding:'18px 24px 20px' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#DC2626', marginBottom:10 }}>
                {user.name} 님을 퇴사 처리합니다
              </div>
              <div style={{ background:'#FFF5F5', border:'1px solid #FECACA', borderRadius:10, padding:'12px 14px', fontSize:12, color:'#7F1D1D', lineHeight:1.7, marginBottom:12 }}>
                {preview === null ? (
                  <span style={{ color:'#B91C1C' }}>영향 범위 조회 중...</span>
                ) : (
                  <>
                    미래 회의실 예약 <b>{preview.bookings}건</b> 취소<br/>
                    진행 중 도서 대여 <b>{preview.loans}건</b> 강제 반납 (이력 보존)<br/>
                    관리자 권한 회수 · 로그인 계정 삭제
                  </>
                )}
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#374151', marginBottom:14, cursor:'pointer' }}>
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>
                되돌릴 수 없음을 확인했습니다
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn" onClick={() => setConfirmDepart(false)} disabled={departing}
                  style={{ flex:1, padding:'11px 0', borderRadius:10, fontSize:13, fontWeight:600, background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#374151', cursor:'pointer' }}>
                  뒤로
                </button>
                <button className="btn" onClick={runDepart} disabled={!ack || departing || preview === null}
                  style={{ flex:2, padding:'11px 0', borderRadius:10, fontSize:13, fontWeight:700, border:'none',
                    background: (!ack || departing || preview === null) ? '#FCA5A5' : '#DC2626',
                    color:'#fff', cursor: (!ack || departing || preview === null) ? 'not-allowed' : 'pointer' }}>
                  {departing ? '처리 중...' : '퇴사 처리 실행'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
