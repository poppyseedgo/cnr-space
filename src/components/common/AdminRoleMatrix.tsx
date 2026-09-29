/**
 * AdminRoleMatrix.tsx — 관리자 × 역할 매트릭스
 *
 * [2026-09-29 WORKBOARD P2] 열 수 하드코딩(11) → NORMAL_ROLES.length / 범례 '(화면 없음)' 을 일반 뷰 역할과 구분
 * [2026-07-24] Phase 4 · 역할 정리용
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 만들었나
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Phase 1 백필로 관리자 11명이 일반 역할 10종을 전부 갖고 있다. 이걸 담당별로
 *   줄여야 세분화가 실제 효과를 갖는데, 지금은 사용자 상세 모달에서 **한 명씩
 *   열고 닫으며 체크를 빼야** 한다. 11번 반복이고, 그 사이 "누가 뭘 담당하는지"를
 *   한눈에 볼 수단이 없다. 그 상태로는 정리가 시작되지 않는다.
 *
 *   그래서 사용자 × 역할을 한 화면에 펼친다. 11행 × 11열이면 스크롤 없이 들어간다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 판단
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · 셀 클릭은 **초안만** 바꾸고 저장은 명시적으로 한다
 *    즉시 저장이 편하긴 한데, 매트릭스는 오클릭이 쉽고 한 번의 실수가
 *    그 사람의 메뉴를 없앤다. 변경된 행에만 저장 버튼을 띄운다.
 *
 *  · 저장은 **행 단위**(사용자 한 명)로 한다
 *    RPC 가 "한 사람의 역할 전체 교체"라 행 단위가 그 경계와 정확히 맞는다.
 *    전체 일괄 저장은 중간 실패 시 어디까지 반영됐는지 알 수 없다.
 *
 *  · super 열은 편집하지 않는다
 *    부여·회수 자체가 위험한 행위라 상세 모달의 빨간 영역에서만 다룬다.
 *    여기서는 보이기만 하고, 잘못 눌릴 자리를 아예 만들지 않는다.
 *
 *  · 역할 0개가 되는 변경은 경고한다
 *    profiles.role 이 USER 로 바뀌어 **어드민 진입 자체가 막힌다.**
 *    의도한 것일 수 있으므로 막지는 않되, 저장 전에 한 번 확인한다.
 */

import { useState, useMemo } from 'react'
import { setUserAdminRoles } from '../../lib/api'
import { NORMAL_ROLES, SUPER_ROLE, ADMIN_ROLES } from '../../data/adminRoles'
import type { AppUser } from '../../types'

const FONT = "'Pretendard', -apple-system, sans-serif"

interface Props {
  users:     AppUser[]
  /** user_id → 역할 배열 */
  roleMap:   Record<string, string[]>
  /** 최고 관리자만 편집 가능 */
  canEdit:   boolean
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  /** 저장 후 상위에서 목록 재조회 */
  onSaved:   () => void | Promise<void>
}

export function AdminRoleMatrix({ users, roleMap, canEdit, showToast, onSaved }: Props) {
  /** 사용자별 편집 초안. 손대지 않은 행은 여기 없다 */
  const [draft, setDraft]   = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // 역할이 하나라도 있는 사람 = 관리자. 이름순으로 고정해 클릭 중 행이 튀지 않게 한다
  const admins = useMemo(
    () => users
      .filter(u => (roleMap[u.user_id] ?? []).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, roleMap]
  )

  const rolesOf  = (uid: string) => draft[uid] ?? roleMap[uid] ?? []
  const isDirty  = (uid: string) => {
    const d = draft[uid]; if (!d) return false
    const o = roleMap[uid] ?? []
    return [...d].sort().join() !== [...o].sort().join()
  }
  const dirtyCount = admins.filter(u => isDirty(u.user_id)).length

  function toggle(uid: string, role: string) {
    if (!canEdit) return
    const cur = rolesOf(uid)
    setDraft(d => ({
      ...d,
      [uid]: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role],
    }))
  }

  async function saveRow(u: AppUser) {
    const next = rolesOf(u.user_id)
    const normalCount = next.filter(r => r !== SUPER_ROLE).length
    if (normalCount === 0 && !next.includes(SUPER_ROLE)) {
      if (!window.confirm(
        `${u.name} 님의 역할이 모두 사라집니다.\n` +
        `어드민 페이지에 더 이상 들어올 수 없게 됩니다. 진행할까요?`
      )) return
    }
    setSaving(u.user_id)
    try {
      const res = await setUserAdminRoles(u.user_id, next)
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      showToast(`${u.name} 님의 권한을 저장했습니다`, 'success')
      setDraft(d => { const { [u.user_id]: _, ...rest } = d; return rest })
      await onSaved()
    } finally { setSaving(null) }
  }

  if (admins.length === 0) {
    return (
      <div style={{ background:'#fff', borderRadius:16, padding:'48px 0', textAlign:'center',
                    fontFamily:FONT, fontSize:13, color:'#CBD5E1' }}>
        관리자 역할을 가진 사용자가 없습니다
      </div>
    )
  }

  const NAME_W = 150

  return (
    <div style={{ background:'#fff', borderRadius:16, overflow:'hidden' }}>
      {/* ── 안내 ── */}
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'12px 16px',
        borderBottom:'1px solid #F1F5F9', flexWrap:'wrap',
      }}>
        <span style={{ fontFamily:FONT, fontSize:13, fontWeight:700, color:'#1E1E1E' }}>
          권한 매트릭스
        </span>
        <span style={{ fontFamily:FONT, fontSize:12, color:'#94A3B8' }}>
          {canEdit
            ? '체크를 바꾸면 그 행에 저장 버튼이 나타납니다. 저장은 사용자 단위로 반영됩니다.'
            : '최고 관리자만 변경할 수 있습니다.'}
        </span>
        {dirtyCount > 0 && (
          <span style={{
            marginLeft:'auto', padding:'3px 10px', borderRadius:999,
            background:'#FFFBEB', border:'1px solid #FDE68A',
            fontFamily:FONT, fontSize:11, fontWeight:700, color:'#92400E',
          }}>저장 대기 {dirtyCount}명</span>
        )}
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', fontFamily:FONT, minWidth: NAME_W + NORMAL_ROLES.length * 64 + 90 /* ← [2026-09-29] 열 수 SSOT */ }}>
          <thead>
            <tr>
              <th style={{
                position:'sticky', left:0, zIndex:2, background:'#fff',
                width:NAME_W, minWidth:NAME_W, textAlign:'left', padding:'10px 12px',
                fontSize:12, fontWeight:600, color:'#92A0BC', borderBottom:'1px solid #D9E4F7',
              }}>사용자</th>
              {NORMAL_ROLES.map(r => (
                <th key={r.id} title={r.desc}
                  style={{
                    width:64, padding:'10px 4px', fontSize:11, fontWeight:600, color:'#92A0BC',
                    borderBottom:'1px solid #D9E4F7', whiteSpace:'nowrap',
                    // 열이 좁아 라벨을 세로로 세운다 — 가로로 두면 열 폭이 3배가 된다
                    writingMode:'vertical-rl', textOrientation:'mixed', height:86,
                  }}>{r.label}</th>
              ))}
              <th style={{
                width:70, padding:'10px 4px', fontSize:11, fontWeight:600, color:'#B91C1C',
                borderBottom:'1px solid #D9E4F7', whiteSpace:'nowrap',
                writingMode:'vertical-rl', textOrientation:'mixed', height:86,
              }}>최고 관리자</th>
              <th style={{ width:90, borderBottom:'1px solid #D9E4F7' }} />
            </tr>
          </thead>
          <tbody>
            {admins.map(u => {
              const cur   = rolesOf(u.user_id)
              const dirty = isDirty(u.user_id)
              const isSuper = cur.includes(SUPER_ROLE)
              return (
                <tr key={u.user_id} style={{ background: dirty ? '#FFFBEB' : '#fff' }}>
                  <td style={{
                    position:'sticky', left:0, zIndex:1,
                    background: dirty ? '#FFFBEB' : '#fff',
                    padding:'8px 12px', borderBottom:'1px solid #F6F9FE',
                    fontSize:13, fontWeight:500, color:'#111', whiteSpace:'nowrap',
                  }}>
                    {u.name}
                    <span style={{ marginLeft:6, fontSize:11, fontWeight:400, color:'#A5AEC0' }}>
                      {u.dept || ''}
                    </span>
                  </td>

                  {NORMAL_ROLES.map(r => {
                    const on = cur.includes(r.id)
                    return (
                      <td key={r.id}
                        onClick={() => toggle(u.user_id, r.id)}
                        style={{
                          textAlign:'center', padding:'8px 4px', borderBottom:'1px solid #F6F9FE',
                          cursor: canEdit ? 'pointer' : 'default',
                          background: on ? '#F8FAFC' : 'transparent',
                        }}>
                        <input type="checkbox" checked={on} disabled={!canEdit} readOnly
                          style={{ pointerEvents:'none' }} />
                      </td>
                    )
                  })}

                  {/* super — 표시 전용. 편집은 상세 모달에서만 */}
                  <td title="변경은 사용자 상세에서만 가능합니다"
                    style={{
                      textAlign:'center', padding:'8px 4px', borderBottom:'1px solid #F6F9FE',
                      background: isSuper ? '#FEF2F2' : 'transparent',
                    }}>
                    <span style={{ fontSize:13, color: isSuper ? '#B91C1C' : '#E2E8F0' }}>
                      {isSuper ? '●' : '○'}
                    </span>
                  </td>

                  <td style={{ padding:'8px 8px', borderBottom:'1px solid #F6F9FE', textAlign:'right' }}>
                    {dirty && canEdit && (
                      <button className="btn" onClick={() => saveRow(u)} disabled={saving === u.user_id}
                        style={{
                          padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer',
                          background:'#111', color:'#fff', fontFamily:FONT, fontSize:12, fontWeight:700,
                          whiteSpace:'nowrap',
                        }}>{saving === u.user_id ? '저장 중…' : '저장'}</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── 역할 설명 ── */}
      <div style={{ padding:'10px 16px', borderTop:'1px solid #F1F5F9',
                    display:'flex', gap:10, flexWrap:'wrap' }}>
        {ADMIN_ROLES.filter(r => !r.deprecated).map(r => (
          <span key={r.id} style={{ fontFamily:FONT, fontSize:11, color:'#94A3B8' }}>
            <b style={{ color:'#64748B' }}>{r.label}</b> {r.tab === null ? (r.view ? '(일반 뷰)' : '(화면 없음)') : ''}{/* ← [2026-09-29 WORKBOARD P2] */}
          </span>
        ))}
      </div>
    </div>
  )
}
