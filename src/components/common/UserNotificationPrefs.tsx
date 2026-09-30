/**
 * UserNotificationPrefs.tsx — 사용자 상세 모달 › '알림 수신 (개인 설정)' 섹션 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 5-A] 신규 — 그 사용자가 **자격 있는 관리자 알림만** 권한 그룹별로 나열, 이메일·인앱 개인 토글(즉시 저장 · 토스트)
 *      · 자격 판정은 DB(admin_list_user_notification_prefs → notification_recipient_entitled) — 화면은 계산하지 않는다
 *      · 알림 설정 탭에서 종류가 OFF 면 회색 잠금(여기서 못 켬) — 우선순위 전역 > 개인 (isChannelEnabled SSOT 재사용)
 *      · 당사자 알림(내 예약·내 대여·내 업무)은 대상 아님 — 목록에 없음
 *      · 낙관적 갱신 금지 — RPC 성공 후에만 반영 (알림 설정은 실패를 즉시 못 알아채는 자리)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadUserNotificationPrefs, setUserNotificationPref, loadNotificationSettings, isChannelEnabled, type UserNotificationPref, type NotificationChannelSetting } from '../../lib/api'
import { NOTIFICATION_CATALOG } from '../../data/notificationCatalog'

interface Props {
  userId:    string
  /** 저장된 역할이 바뀌면(권한 저장 후) 다시 조회하도록 상위가 키를 올린다 */
  refreshKey?: number
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
}

/** 그룹 → 자격 권한 라벨 (목록 소제목) */
const GROUP_ROLE_LABEL: Record<string, string> = {
  '회의실 예약': '관리자 전원',
  '도서관':      '도서관리 권한',
  '자원예약':    '자원관리 권한',
  'Work Space':  'Work Space 권한',
}

export function UserNotificationPrefs({ userId, refreshKey = 0, showToast }: Props) {
  const [prefs, setPrefs]       = useState<UserNotificationPref[] | null>(null)
  const [settings, setSettings] = useState<NotificationChannelSetting[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [p, s] = await Promise.all([loadUserNotificationPrefs(userId), loadNotificationSettings()])
      setPrefs(p); setSettings(s)
    } catch (e: any) { setPrefs([]); setError(e?.message ?? '불러오지 못했습니다') }
  }, [userId])
  useEffect(() => { setPrefs(null); void load() }, [load, refreshKey])

  const rows = useMemo(() => {
    if (!prefs) return []
    return prefs.map(p => ({ ...p, item: NOTIFICATION_CATALOG.find(c => c.type === p.type) }))
      .filter(r => r.item && !r.item.retired)
      .sort((a, b) => NOTIFICATION_CATALOG.findIndex(c => c.type === a.type) - NOTIFICATION_CATALOG.findIndex(c => c.type === b.type))
  }, [prefs])
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const r of rows) { const g = r.item!.group; if (!m.has(g)) m.set(g, []); m.get(g)!.push(r) }
    return [...m.entries()]
  }, [rows])

  const toggle = async (type: string, channel: 'email' | 'inapp', next: boolean) => {
    const key = `${type}:${channel}`; setBusy(key)
    try {
      const res = await setUserNotificationPref(userId, type, channel, next)
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      setPrefs(prev => (prev ?? []).map(p => p.type === type ? { ...p, [channel === 'email' ? 'email_enabled' : 'inapp_enabled']: next } : p))
      const label = NOTIFICATION_CATALOG.find(c => c.type === type)?.label ?? type
      showToast(`${label} · ${channel === 'email' ? '이메일' : '인앱'} ${next ? '켜짐' : '꺼짐 (이 사용자만)'}`, 'success')
    } finally { setBusy(null) }
  }

  const Tg = ({ on, locked, k, onClick }: { on: boolean; locked: boolean; k: string; onClick: () => void }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={k} disabled={locked || busy === k} onClick={onClick}
      title={locked ? '알림 설정 탭에서 이 종류가 꺼져 있습니다 — 여기서는 켤 수 없음' : on ? '끄기 (이 사용자만)' : '켜기'}
      style={{ width: 30, height: 18, borderRadius: 999, border: 'none', position: 'relative', padding: 0, justifySelf: 'center',
        background: locked ? '#E2E8F0' : on ? '#111' : '#CBD5E1', opacity: locked ? .6 : busy === k ? .5 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>
      <span style={{ position: 'absolute', top: 2, left: (on && !locked) ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
    </button>
  )

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>알림 수신 (개인 설정)</label>
        <span style={{ fontSize: 10, color: '#1E6FE8', background: '#EAF2FF', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>즉시 저장</span>
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5, marginBottom: 10 }}>
        이 사용자가 <b style={{ color: '#64748B' }}>자격 있는 알림만</b> 표시됩니다 (자격 = 저장된 관리자 권한 · 당사자 알림은 항상 수신). 여기서 끄면 이 사람만 빠지고, 알림 설정 탭에서 종류 자체를 끄면 개인 설정과 무관하게 아무도 받지 않습니다.
      </div>

      {prefs === null && <div style={{ fontSize: 11, color: '#CBD5E1', padding: 8 }}>불러오는 중…</div>}
      {error && <div style={{ fontSize: 11, color: '#B91C1C', padding: 8 }}>{error}</div>}
      {prefs !== null && !error && rows.length === 0 && (
        <div style={{ fontSize: 11, color: '#CBD5E1', border: '1px dashed #E2E8F0', borderRadius: 8, padding: 10 }}>자격 있는 관리자 알림이 없습니다 — 관리자 권한을 부여·저장하면 여기 나타납니다</div>
      )}
      {rows.length > 0 && (
        <div style={{ border: '1px solid #F1F5F9', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 84px 84px', padding: '6px 10px', background: '#F8FAFC', fontSize: 10.5, color: '#94A3B8', fontWeight: 600 }}>
            <span>알림</span><span style={{ textAlign: 'center' }}>이메일</span><span style={{ textAlign: 'center' }}>인앱</span>
          </div>
          {groups.map(([g, list]) => (
            <div key={g}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', padding: '8px 10px 4px', letterSpacing: '.3px' }}>{g} · {GROUP_ROLE_LABEL[g] ?? ''}</div>
              {list.map(r => {
                const emailGlobal = isChannelEnabled(settings, r.type, 'email'), inappGlobal = isChannelEnabled(settings, r.type, 'inapp')
                const hasEmail = r.item!.channels.includes('email'), hasInapp = r.item!.channels.includes('inapp')
                return (
                  <div key={r.type} data-pref-row={r.type} style={{ display: 'grid', gridTemplateColumns: '1fr 84px 84px', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #F8FAFC', fontSize: 12 }}>
                    <span style={{ color: '#374151', fontWeight: 600 }}>{r.item!.label}
                      <small style={{ display: 'block', fontWeight: 400, color: '#94A3B8', fontSize: 10.5, marginTop: 1 }}>
                        {r.item!.trigger}{(!emailGlobal || !inappGlobal) && <span style={{ color: '#B45309' }}> · 현재 종류 OFF({[!emailGlobal && '이메일', !inappGlobal && '인앱'].filter(Boolean).join('·')})</span>}
                      </small>
                    </span>
                    {hasEmail ? <Tg on={r.email_enabled} locked={!emailGlobal} k={`${r.type}:email`} onClick={() => void toggle(r.type, 'email', !r.email_enabled)} /> : <span style={{ textAlign: 'center', color: '#CBD5E1' }}>—</span>}
                    {hasInapp ? <Tg on={r.inapp_enabled} locked={!inappGlobal} k={`${r.type}:inapp`} onClick={() => void toggle(r.type, 'inapp', !r.inapp_enabled)} /> : <span style={{ textAlign: 'center', color: '#CBD5E1' }}>—</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.6, marginTop: 8 }}>■ 켜짐 · <span style={{ color: '#CBD5E1' }}>■</span> 개인 OFF · <span style={{ color: '#E2E8F0' }}>■</span> 종류 OFF(알림 설정 탭에서 꺼짐 — 여기서 못 켬)</div>
      <div style={{ fontSize: 11, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px', marginTop: 10, lineHeight: 1.5 }}>
        권한을 체크만 하고 아직 저장하지 않은 항목은 여기 반영되지 않습니다 — 아래 '저장' 후 목록이 갱신됩니다. 권한을 빼면 해당 알림은 자동으로 끊깁니다.
      </div>
    </div>
  )
}
