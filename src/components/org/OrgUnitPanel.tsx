/**
 * OrgUnitPanel.tsx — 캔버스 좌측 패널: 단위 트리(접기/펼치기·추가·이름변경·삭제·순서) / 미배치(로스터에 있는데 카드 없는 사람 → 드래그 배치)
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.2 좌측 패널
 */
import { useMemo, useState, type DragEvent } from 'react'
import type { AppUser, OrgCard, OrgUnit } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { subtreeHeadcount, type OrgUnitNode } from '../../utils/orgStatus'
import { DND } from './OrgTree'
import { OG, btn, btnDisabled } from './orgShared'

interface Props {
  roots:        OrgUnitNode[]
  cardsByUnit:  Map<string, OrgCard[]>
  expanded:     Set<string>
  editable:     boolean
  focusUnit:    string | null
  onFocusUnit:  (id: string) => void
  onAddUnit:    (parentId: string | null) => void
  onRenameUnit: (u: OrgUnit) => void
  onDeleteUnit: (u: OrgUnit) => void
  onMoveUnit:   (u: OrgUnit, dir: -1 | 1) => void
  onAddVacancy?: (unitId: string) => void   // ← [Phase 4-A]
  onAddPerson?:  (unitId: string) => void   // ← [Phase 4-A]
  unassigned:   AppUser[]
  mismatchByUnit: Map<string, number>
  ghostByUnit:    Map<string, number>
}

export function OrgUnitPanel({ roots, cardsByUnit, expanded, editable, focusUnit, onFocusUnit, onAddUnit, onRenameUnit, onDeleteUnit, onMoveUnit, onAddVacancy, onAddPerson, unassigned, mismatchByUnit, ghostByUnit }: Props) {
  const [tab, setTab] = useState<'tree' | 'unassigned'>('tree')
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? unassigned.filter(u => u.name.toLowerCase().includes(s) || (u.dept ?? '').toLowerCase().includes(s)) : unassigned
  }, [unassigned, q])

  const onProfileDrag = (e: DragEvent, u: AppUser) => { e.dataTransfer.setData(DND.profile, u.user_id); e.dataTransfer.effectAllowed = 'copy' }

  const row = (n: OrgUnitNode, siblings: OrgUnitNode[], idx: number) => {
    const u = n.unit, open = expanded.has(u.id), isFocus = focusUnit === u.id
    const mm = mismatchByUnit.get(u.id) ?? 0, gh = ghostByUnit.get(u.id) ?? 0
    return (
      <div key={u.id}>
        <div onClick={() => onFocusUnit(u.id)}
             style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `5px 6px 5px ${8 + n.depth * 14}px`, fontSize: 12.5, cursor: 'pointer', borderRadius: 6, background: isFocus ? '#EEF2FF' : 'transparent', fontWeight: isFocus ? 600 : 400 }}>
          <span style={{ width: 10, color: OG.quiet, fontSize: 10 }}>{n.children.length > 0 ? (open ? '▾' : '▸') : ''}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
          {(mm > 0 || gh > 0) && <small style={{ color: OG.red, fontSize: 10.5 }}>{gh > 0 ? `유령 ${gh}` : ''}{gh > 0 && mm > 0 ? ' · ' : ''}{mm > 0 ? `불일치 ${mm}` : ''}</small>}
          <small style={{ color: OG.quiet }}>{subtreeHeadcount(n, cardsByUnit)}</small>
        </div>
        {isFocus && editable && (
          <div style={{ display: 'flex', gap: 4, padding: `2px 6px 6px ${8 + n.depth * 14}px`, flexWrap: 'wrap' }}>
            <MiniBtn onClick={() => onAddUnit(u.id)}>+ 하위</MiniBtn>
            <MiniBtn onClick={() => onRenameUnit(u)}>이름·약칭</MiniBtn>
            <MiniBtn onClick={() => onMoveUnit(u, -1)} disabled={idx === 0}>↑</MiniBtn>
            <MiniBtn onClick={() => onMoveUnit(u, 1)} disabled={idx === siblings.length - 1}>↓</MiniBtn>
            {onAddVacancy && <MiniBtn onClick={() => onAddVacancy(u.id)}>+ 공석</MiniBtn>}
            {onAddPerson && <MiniBtn onClick={() => onAddPerson(u.id)}>+ 입사예정</MiniBtn>}
            <MiniBtn onClick={() => onDeleteUnit(u)} danger disabled={n.children.length > 0 || (cardsByUnit.get(u.id)?.length ?? 0) > 0} title={n.children.length > 0 ? '하위 단위가 있어 삭제 불가' : (cardsByUnit.get(u.id)?.length ?? 0) > 0 ? '카드가 있어 삭제 불가' : ''}>삭제</MiniBtn>
          </div>
        )}
        {open && n.children.map((ch, i) => row(ch, n.children, i))}
      </div>
    )
  }

  return (
    <div style={{ width: OG.panelW, background: '#fff', borderRight: `1px solid ${OG.line}`, display: 'flex', flexDirection: 'column', fontFamily: OG.font, flexShrink: 0 }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${OG.line}` }}>
        {(['tree', 'unassigned'] as const).map(t => (
          <div key={t} onClick={() => setTab(t)} style={{ flex: 1, textAlign: 'center', padding: '10px 0', fontSize: 12.5, cursor: 'pointer', color: tab === t ? OG.ink : OG.quiet, fontWeight: tab === t ? 600 : 400, boxShadow: tab === t ? `inset 0 -2px ${OG.ink}` : 'none' }}>
            {t === 'tree' ? '단위 트리' : <>미배치 {unassigned.length > 0 && <span style={{ color: OG.red }}>{unassigned.length}</span>}</>}
          </div>
        ))}
      </div>
      {tab === 'tree' ? (
        <div style={{ padding: '10px 8px', overflow: 'auto', flex: 1 }}>
          {roots.map((r, i) => row(r, roots, i))}
          {editable && <div style={{ paddingTop: 10 }}><button style={{ ...btn, fontSize: 11.5, width: '100%' }} onClick={() => onAddUnit(null)}>+ 최상위 단위 추가</button></div>}
          <div style={{ paddingTop: 12, color: OG.quiet, fontSize: 11 }}>클릭 = 캔버스 해당 노드로 이동 · 더블클릭(캔버스 헤더) = 이름 편집</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: `1px solid ${OG.line}` }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·부서 검색" style={{ width: '100%', padding: '6px 9px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 12, fontFamily: OG.font, boxSizing: 'border-box' }} />
            <div style={{ fontSize: 11, color: OG.quiet, marginTop: 6 }}>profiles 에 있는데 이 조직도에 카드가 없는 사람. {editable ? '단위 노드로 드래그해 배치' : '초안에서만 배치 가능'}</div>
          </div>
          <div style={{ overflow: 'auto', flex: 1, padding: 8 }}>
            {filtered.length === 0 && <div style={{ color: OG.faint, fontSize: 12, padding: 12, textAlign: 'center' }}>미배치 인원 없음</div>}
            {filtered.map(u => (
              <div key={u.user_id} draggable={editable} onDragStart={e => onProfileDrag(e, u)}
                   style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: editable ? 'grab' : 'default', fontSize: 12.5 }}>
                <UserAvatar name={u.name} avatarUrl={u.avatar_url} size={24} fontSize={10} />
                <span style={{ fontWeight: 600 }}>{u.name}</span>
                <small style={{ color: OG.quiet, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{u.dept || '-'}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
function MiniBtn({ children, onClick, disabled, danger, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; title?: string }) {
  return <button title={title} disabled={disabled} onClick={e => { e.stopPropagation(); onClick() }} style={{ ...btn, fontSize: 10.5, padding: '2px 6px', color: danger ? OG.red : OG.ink, ...(disabled ? btnDisabled : {}) }}>{children}</button>
}
