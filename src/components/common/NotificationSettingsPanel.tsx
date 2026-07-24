/**
 * NotificationSettingsPanel.tsx — 어드민 '알림 설정'
 *
 * [2026-07-23] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 화면이 하는 일
 * ═══════════════════════════════════════════════════════════════════════════
 *   ① 알림 전수 목록을 채널(메일/인앱/Teams)별로 끄고 켠다
 *   ② 관리자에게 가는 알림에 한해 '수신자'를 명시 지정한다
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 판단
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * · 미설정 = 켜짐(fail-open)을 화면도 그대로 따른다.
 *   서버 loadChannelFlags 와 해석이 다르면 "화면은 꺼짐인데 메일은 오는" 상태가 된다.
 *   판정은 api.isChannelEnabled 한 곳에서만 한다.
 *
 * · 낙관적 갱신을 하지 않는다.
 *   토글 → RPC → 성공 시에만 상태 반영. 알림 설정은 실패를 사용자가 알아채기
 *   어려운 자리(다음 이벤트가 나야 드러난다)라, 화면이 먼저 바뀌면 꺼진 줄 알고
 *   넘어간다. 저장 중에는 해당 토글만 비활성한다.
 *
 * · 지원하지 않는 채널은 토글을 그리지 않고 '—' 로 표시한다.
 *   도서 알림에 Teams 토글을 그리면 켜도 아무 일이 일어나지 않는다 —
 *   "켰는데 안 온다"는 문의를 만드는 UI 다.
 *
 * · 수신자 '지정 없음'은 끄기가 아니다.
 *   비우면 기존 규칙(관리자 전원 / 도서 담당)으로 되돌아간다는 것을 문구로 명시한다.
 *
 * Figma 노드 없음 — 기존 어드민 공통 토큰(카드 #fff/16px, 보더 #EEF1F6)을 따랐다.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  loadNotificationSettings, setNotificationChannel, isChannelEnabled,
  loadNotificationRecipients, setNotificationRecipients,
  type NotificationChannelSetting, type NotificationRecipientRow,
} from '../../lib/api'
import {
  NOTIFICATION_CATALOG, NOTIF_GROUP_ORDER, AUDIENCE_LABEL, CHANNEL_LABEL,
  type NotifChannel, type NotifCatalogItem,
} from '../../data/notificationCatalog'
import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

// ─── 스타일 ──────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #EEF1F6', borderRadius: 16, padding: 18,
}
const TH: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#64748B', textAlign: 'left',
  padding: '10px 12px', borderBottom: '1px solid #EEF1F6', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  fontSize: 13, color: '#1E1E1E', padding: '12px', borderBottom: '1px solid #F5F7FA',
  verticalAlign: 'middle',
}
const BTN_MINI: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
  border: 'none', cursor: 'pointer',
}

interface Props {
  users:     AppUser[]
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  isMobile?: boolean
}

const CHANNELS: NotifChannel[] = ['email', 'inapp', 'teams']

// ─── 스위치 ──────────────────────────────────────────────────────────────────

function Toggle({ on, busy, onChange }: {
  on: boolean; busy: boolean; onChange: (next: boolean) => void
}) {
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0,
        position: 'relative', cursor: busy ? 'wait' : 'pointer',
        background: busy ? '#CBD5E1' : on ? '#4F46E5' : '#D8DEE9',
        transition: 'background .15s',
      }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left .15s', boxShadow: '0 1px 2px rgba(15,23,42,.2)',
      }} />
    </button>
  )
}

// ─── 수신자 편집 ─────────────────────────────────────────────────────────────

function RecipientEditor({ item, current, users, onSave, busy }: {
  item:    NotifCatalogItem
  current: NotificationRecipientRow[]
  users:   AppUser[]
  busy:    boolean
  onSave:  (type: string, userIds: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>(current.map(r => r.user_id))
  const [q,     setQ]     = useState('')

  // 서버 값이 갱신되면(저장 성공/재조회) 편집안을 맞춘다.
  useEffect(() => { setDraft(current.map(r => r.user_id)) }, [current])

  const dirty = useMemo(() => {
    const a = [...draft].sort().join(',')
    const b = [...current.map(r => r.user_id)].sort().join(',')
    return a !== b
  }, [draft, current])

  const candidates = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return []
    return users
      .filter(u => !draft.includes(u.user_id))
      .filter(u =>
        (u.name ?? '').toLowerCase().includes(kw) ||
        (u.email ?? '').toLowerCase().includes(kw) ||
        (u.dept ?? '').toLowerCase().includes(kw))
      .slice(0, 6)
  }, [q, users, draft])

  const byId = useMemo(() => {
    const m: Record<string, AppUser> = {}
    users.forEach(u => { m[u.user_id] = u })
    return m
  }, [users])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {draft.length === 0 && (
          <span style={{ fontSize: 12, color: '#A5AEC0' }}>
            지정 없음 — {AUDIENCE_LABEL[item.audience]} 전원에게 발송됩니다
          </span>
        )}
        {draft.map(id => {
          const u = byId[id]
          const row = current.find(r => r.user_id === id)
          const name = u?.name ?? row?.name ?? '(알 수 없음)'
          return (
            <span key={id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#F1F5F9', borderRadius: 999, padding: '4px 6px 4px 4px',
            }}>
              <UserChip name={name} avatarUrl={u?.avatar_url ?? null} dept={u?.dept ?? row?.dept ?? ''} variant="sm" />
              <button
                className="btn"
                onClick={() => setDraft(d => d.filter(x => x !== id))}
                style={{ ...BTN_MINI, background: 'transparent', color: '#94A3B8', padding: '0 4px' }}>
                ✕
              </button>
            </span>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="이름 · 부서 · 이메일로 검색해 추가"
          style={{
            flex: '1 1 220px', minWidth: 200, fontSize: 13, padding: '7px 10px',
            border: '1px solid #E2E8F0', borderRadius: 8, outline: 'none',
          }} />
        <button
          className="btn"
          disabled={!dirty || busy}
          onClick={() => onSave(item.type, draft)}
          style={{
            ...BTN_MINI, padding: '7px 14px', fontSize: 12,
            background: dirty && !busy ? '#111' : '#E2E8F0',
            color:      dirty && !busy ? '#fff' : '#94A3B8',
            cursor:     dirty && !busy ? 'pointer' : 'default',
          }}>
          {busy ? '저장 중…' : '수신자 저장'}
        </button>
      </div>

      {candidates.length > 0 && (
        <div style={{
          border: '1px solid #EEF1F6', borderRadius: 10, overflow: 'hidden',
        }}>
          {candidates.map(u => (
            <button
              key={u.user_id}
              className="btn"
              onClick={() => { setDraft(d => [...d, u.user_id]); setQ('') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                background: '#fff', padding: '8px 12px', cursor: 'pointer',
                fontSize: 13, color: '#1E1E1E', borderBottom: '1px solid #F8FAFC',
              }}>
              {u.name}
              <span style={{ color: '#A5AEC0', fontSize: 12 }}>
                {u.dept ? ` · ${u.dept}` : ''}{u.email ? ` · ${u.email}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 본체 ────────────────────────────────────────────────────────────────────

export function NotificationSettingsPanel({ users, showToast, isMobile }: Props) {
  const [settings,   setSettings]   = useState<NotificationChannelSetting[]>([])
  const [recipients, setRecipients] = useState<NotificationRecipientRow[]>([])
  const [loading,    setLoading]    = useState(true)
  /** 저장 중인 셀 키 ('type:channel' 또는 'type:recipients') */
  const [busyKey,    setBusyKey]    = useState<string | null>(null)
  const [showRetired, setShowRetired] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r] = await Promise.all([
        loadNotificationSettings(), loadNotificationRecipients(),
      ])
      setSettings(s); setRecipients(r)
    } catch (e: any) {
      showToast(`알림 설정을 불러오지 못했습니다: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { load() }, [load])

  /** 채널 토글 — 낙관적 갱신 금지(설계 판단 참조) */
  async function handleToggle(type: string, channel: NotifChannel, next: boolean) {
    const key = `${type}:${channel}`
    setBusyKey(key)
    try {
      const res = await setNotificationChannel(type, channel, next)
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      setSettings(prev => {
        const rest = prev.filter(s => !(s.type === type && s.channel === channel))
        return [...rest, { type, channel, enabled: next }]
      })
    } finally {
      setBusyKey(null)
    }
  }

  async function handleSaveRecipients(type: string, userIds: string[]) {
    const key = `${type}:recipients`
    setBusyKey(key)
    try {
      const res = await setNotificationRecipients(type, userIds)
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      showToast(
        userIds.length === 0
          ? '수신자 지정을 해제했습니다 (기본 규칙으로 발송)'
          : `수신자 ${res.saved ?? userIds.length}명을 저장했습니다`,
        'success',
      )
      // 저장 후 서버 값을 다시 읽는다 — 퇴사자 제외 등 서버가 거른 결과가
      // 화면과 달라질 수 있으므로, 화면이 추측하지 않고 사실을 다시 받는다.
      setRecipients(await loadNotificationRecipients())
    } catch (e: any) {
      showToast(`수신자 저장 실패: ${e.message}`, 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const recipientsByType = useMemo(() => {
    const m: Record<string, NotificationRecipientRow[]> = {}
    recipients.forEach(r => { (m[r.type] ??= []).push(r) })
    return m
  }, [recipients])

  const visible = useMemo(
    () => NOTIFICATION_CATALOG.filter(i => showRetired || !i.retired),
    [showRetired],
  )

  const offCount = useMemo(
    () => visible.reduce((n, i) =>
      n + i.channels.filter(c => !isChannelEnabled(settings, i.type, c)).length, 0),
    [visible, settings],
  )

  if (loading) {
    return <div style={{ ...CARD, color: '#A5AEC0', fontSize: 13 }}>알림 설정을 불러오는 중…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── 안내 ─────────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#1E1E1E' }}>알림 설정</div>
        <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
          알림 종류별로 <b>메일 · 인앱 · Teams</b> 발송을 끄고 켤 수 있습니다.
          설정하지 않은 항목은 <b>켜짐</b>으로 동작합니다 — 설정이 비어 있다고 알림이 멈추지 않습니다.
          <br />
          관리자에게 가는 알림은 <b>수신자를 직접 지정</b>할 수 있습니다.
          지정하지 않으면 해당 알림의 기본 대상(관리자 전원 또는 도서 담당자)에게 발송됩니다.
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: '#A5AEC0' }}>
            표시 중 {visible.length}종 · 꺼진 채널 {offCount}개
          </span>
          <label style={{ fontSize: 12, color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
            폐지된 알림도 표시
          </label>
        </div>
      </div>

      {/* ── 그룹별 표 ────────────────────────────────────────────────────── */}
      {NOTIF_GROUP_ORDER.map(group => {
        const items = visible.filter(i => i.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} style={CARD}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1E1E1E', marginBottom: 10 }}>
              {group}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 620 : 860 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, width: '38%' }}>알림</th>
                    <th style={{ ...TH, width: '22%' }}>수신 대상</th>
                    {CHANNELS.map(c => (
                      <th key={c} style={{ ...TH, width: 76, textAlign: 'center' }}>
                        {CHANNEL_LABEL[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.type}>
                      <td style={TD}>
                        <div style={{ fontWeight: 700, color: item.retired ? '#A5AEC0' : '#1E1E1E' }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 11, color: '#A5AEC0', marginTop: 2 }}>
                          {item.trigger}
                        </div>
                        {item.note && (
                          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, lineHeight: 1.5 }}>
                            {item.note}
                          </div>
                        )}
                      </td>
                      <td style={TD}>
                        <span style={{ fontSize: 12, color: '#64748B' }}>
                          {AUDIENCE_LABEL[item.audience]}
                        </span>
                        {item.toAdmins && (
                          <span style={{
                            marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#4F46E5',
                            background: '#EEF2FF', borderRadius: 4, padding: '2px 5px',
                          }}>
                            수신자 지정 가능
                          </span>
                        )}
                      </td>
                      {CHANNELS.map(c => (
                        <td key={c} style={{ ...TD, textAlign: 'center' }}>
                          {item.channels.includes(c) ? (
                            <Toggle
                              on={isChannelEnabled(settings, item.type, c)}
                              busy={busyKey === `${item.type}:${c}`}
                              onChange={next => handleToggle(item.type, c, next)}
                            />
                          ) : (
                            <span style={{ color: '#D8DEE9' }}>—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* ── 관리자 수신자 지정 ───────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1E1E1E', marginBottom: 4 }}>
          관리자 수신자 지정
        </div>
        <div style={{ fontSize: 12, color: '#A5AEC0', marginBottom: 14, lineHeight: 1.6 }}>
          지정한 사람에게만 발송됩니다. 비워 두면 기본 대상 전원에게 발송됩니다 —
          완전히 멈추려면 위 표에서 채널을 끄세요.
          퇴사 처리된 계정은 저장 시 자동으로 제외됩니다.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {visible.filter(i => i.toAdmins).map(item => (
            <div key={item.type} style={{
              borderTop: '1px solid #F5F7FA', paddingTop: 14,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1E1E' }}>
                {item.label}
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: '#A5AEC0' }}>
                  기본 대상: {AUDIENCE_LABEL[item.audience]}
                </span>
              </div>
              <RecipientEditor
                item={item}
                current={recipientsByType[item.type] ?? []}
                users={users}
                busy={busyKey === `${item.type}:recipients`}
                onSave={handleSaveRecipients}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
