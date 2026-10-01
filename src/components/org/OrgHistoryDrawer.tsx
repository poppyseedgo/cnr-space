/**
 * OrgHistoryDrawer.tsx — 화면 D: 히스토리 (변경 로그 타임라인 / Active diff) + CSV
 *  - [2026-10-01 ORG Phase 4-A] 신규 — 설계서 §6.4. 전체 폭 드로어, 기간 프리셋(오늘/7일/30일/전체)·행위자·동작 필터
 *  로그 문장화: 단위·카드·직무·파일·상태 대상별 describe* (카드는 OrgCardDrawer.describeLog 재사용)
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { AppUser, OrgFile, OrgJob, OrgRank, OrgStatusType, OrgUnit } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { UserAvatar } from '../common/UserAvatar'
import { exportCSV } from '../../utils/csv'
import { loadOrgChangeLog, loadOrgActivationDiffs, type OrgChangeLogRow, type OrgDiffRow } from '../../lib/orgApi'
import { describeLog } from './OrgCardDrawer'
import { OG, Tag, btn, fmtWhen } from './orgShared'

interface Props {
  file:        OrgFile | null          // null = 파일 밖(상태·코드) 로그
  files:       { id: string; name: string }[]
  units:       OrgUnit[]
  users:       AppUser[]
  ranks:       OrgRank[]
  jobs:        OrgJob[]
  statusTypes: OrgStatusType[]
  cardName:    (cardId: string) => string
  initialTab?: 'log' | 'diff'
  onClose:     () => void
}
type Preset = 'today' | '7d' | '30d' | 'all'
const ACTION_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  insert: { label: '생성', bg: '#DCFCE7', color: '#166534' }, update: { label: '변경', bg: '#EEF2FF', color: '#3730A3' }, delete: { label: '삭제', bg: '#FEE2E2', color: '#991B1B' },
}
const TARGET_LABEL: Record<string, string> = { org_files: '파일', org_units: '단위', org_cards: '카드', org_card_jobs: '직무', org_person_status: '상태', org_offboarding_items: '반납', org_persons: '입사예정자', org_status_types: '상태코드', org_ranks: '직급', org_jobs: '직무코드', org_offboarding_templates: '반납템플릿' }
const KIND_LABEL: Record<string, string> = { hired: '입사·신규 배치', departed: '제외·퇴사', moved: '소속 이동', promoted: '직급 변경', job_changed: '직무 변경', head_changed: '단위장 변경', unit_created: '단위 신설', unit_removed: '단위 폐지', unit_renamed: '단위 이름', unit_moved: '단위 이동', reassigned: '재배치', concurrent_added: '겸직 추가', concurrent_removed: '겸직 해제' }

export function OrgHistoryDrawer({ file, files, units, users, ranks, jobs, statusTypes, cardName, initialTab = 'log', onClose }: Props) {
  const [entered, setEntered] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  const [tab, setTab] = useState<'log' | 'diff'>(initialTab)
  const [logs, setLogs] = useState<OrgChangeLogRow[] | null>(null)
  const [diffs, setDiffs] = useState<OrgDiffRow[] | null>(null)
  const [preset, setPreset] = useState<Preset>('30d')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  useEffect(() => { loadOrgChangeLog(file?.id ?? null, 500).then(setLogs).catch(() => setLogs([])) }, [file?.id])
  useEffect(() => { if (file && tab === 'diff' && diffs === null) loadOrgActivationDiffs(file.id).then(setDiffs).catch(() => setDiffs([])) }, [file, tab, diffs])

  const nameOf = (id: string | null) => users.find(u => u.user_id === id)?.name ?? (id ? '(퇴사자)' : '시스템')
  const typeMap = useMemo(() => new Map(statusTypes.map(t => [t.code, t])), [statusTypes])
  const since = useMemo(() => { const d = new Date(); if (preset === 'today') d.setHours(0, 0, 0, 0); else if (preset === '7d') d.setDate(d.getDate() - 7); else if (preset === '30d') d.setDate(d.getDate() - 30); else return null; return d.toISOString() }, [preset])
  const actors = useMemo(() => Array.from(new Set((logs ?? []).map(l => l.actor ?? ''))).map(id => ({ id, name: nameOf(id || null) })), [logs])  // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => (logs ?? []).filter(l => (!since || l.created_at >= since) && (!actor || (l.actor ?? '') === actor) && (!action || l.action === action)), [logs, since, actor, action])

  const describe = (l: OrgChangeLogRow): string => {
    const b = l.before ?? {}, a = l.after ?? {}
    switch (l.target_table) {
      case 'org_cards': case 'org_card_jobs': return describeLog(l, units, ranks, jobs)
      case 'org_units': {
        if (l.action === 'insert') return `단위 생성 '${a.name}'${a.parent_unit_id ? ` (상위: ${units.find(u => u.id === a.parent_unit_id)?.name ?? '?'})` : ''}`
        if (l.action === 'delete') return `단위 삭제 '${b.name}'`
        const d: string[] = []
        if (b.name !== a.name) d.push(`이름 '${b.name}' → '${a.name}'`)
        if (b.code !== a.code) d.push(`약칭 ${b.code ?? '-'} → ${a.code ?? '-'}`)
        if (b.parent_unit_id !== a.parent_unit_id) d.push(`상위 ${units.find(u => u.id === b.parent_unit_id)?.name ?? '최상위'} → ${units.find(u => u.id === a.parent_unit_id)?.name ?? '최상위'}`)
        if (b.sort_order !== a.sort_order) d.push('순서 변경')
        if (b.azure_division !== a.azure_division) d.push(`Division 매핑 ${b.azure_division ?? '-'} → ${a.azure_division ?? '-'}`)
        if (b.head_card_id !== a.head_card_id) d.push('단위장 카드 변경')
        return `'${a.name}' ${d.join(', ') || '변경'}`
      }
      case 'org_files': {
        if (l.action === 'insert') return `파일 생성 '${a.name}'`
        if (l.action === 'delete') return `파일 삭제 '${b.name}'`
        const d: string[] = []
        if (b.status !== a.status) d.push(`상태 ${b.status} → ${a.status}`)
        if (b.name !== a.name) d.push(`이름 '${b.name}' → '${a.name}'`)
        if (b.effective_on !== a.effective_on) d.push(`적용일 ${b.effective_on ?? '-'} → ${a.effective_on ?? '-'}`)
        if (b.memo !== a.memo) d.push('메모 변경')
        return d.join(', ') || '파일 변경'
      }
      case 'org_person_status': {
        const who = a.profile_id ?? b.profile_id ? nameOf(a.profile_id ?? b.profile_id) : '(입사예정자)'
        const t = typeMap.get(a.status_code ?? b.status_code)?.label ?? a.status_code ?? b.status_code
        if (l.action === 'insert') return `${who} 상태 등록 '${t}'`
        if (b.ended_at == null && a.ended_at != null) return `${who} 상태 종료 '${t}' (${a.ended_reason})`
        return `${who} 상태 '${t}' 변경`
      }
      case 'org_offboarding_items': return `반납 항목 '${a.label ?? b.label}' ${a.checked ? '확인' : a.applicable === false ? '해당 없음' : '변경'}`
      case 'org_persons': return l.action === 'insert' ? `입사예정자 등록 '${a.name}'` : a.linked_profile_id && !b.linked_profile_id ? `입사예정자 '${a.name}' 프로필 연결` : `입사예정자 '${a.name ?? b.name}' 변경`
      default: return `${TARGET_LABEL[l.target_table] ?? l.target_table} ${l.action} ${a.code ?? a.label ?? a.name ?? b.code ?? b.label ?? b.name ?? ''}`
    }
  }

  const csvLog = () => exportCSV(filtered.map(l => ({ 시각: fmtWhen(l.created_at), 행위자: nameOf(l.actor), 동작: ACTION_LABEL[l.action]?.label ?? l.action, 대상: TARGET_LABEL[l.target_table] ?? l.target_table, 내용: describe(l) })), `org-changelog-${file?.name ?? 'global'}-${new Date().toISOString().slice(0, 10)}.csv`)
  const csvDiff = () => exportCSV((diffs ?? []).map(d => ({ 구분: KIND_LABEL[d.kind] ?? d.kind, 대상: d.label ?? d.card_ref ?? '', 이전: JSON.stringify(d.before ?? {}), 이후: JSON.stringify(d.after ?? {}) })), `org-activediff-${file?.name ?? ''}-${new Date().toISOString().slice(0, 10)}.csv`)

  const chip = (on: boolean): CSSProperties => ({ fontSize: 11.5, padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? OG.ink : OG.line}`, background: on ? OG.ink : '#fff', color: on ? '#fff' : OG.quiet, cursor: 'pointer' })
  const sel: CSSProperties = { fontSize: 11.5, padding: '5px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.quiet, fontFamily: OG.font }
  const grouped = useMemo(() => { const m = new Map<string, OrgDiffRow[]>(); for (const d of diffs ?? []) { if (!m.has(d.kind)) m.set(d.kind, []); m.get(d.kind)!.push(d) } return m }, [diffs])
  const prevName = diffs?.[0]?.prev_file_id ? files.find(f => f.id === diffs![0].prev_file_id)?.name ?? '(삭제된 파일)' : null

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="히스토리"
             style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(880px, 100vw)', background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)', padding: '20px 24px 32px', overflowY: 'auto', fontFamily: OG.font, fontSize: 13, color: OG.ink, transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>히스토리 — {file ? file.name : '파일 밖 (상태·코드·입사예정자)'}</h3>
            {file && <Tag kind={file.status}>{file.status}</Tag>}
            <span style={{ flex: 1 }} />
            <button style={btn} onClick={tab === 'log' ? csvLog : csvDiff}>CSV</button>
            <button onClick={onClose} aria-label="닫기" style={{ ...btn, padding: '5px 7px' }}><X size={14} /></button>
          </div>
          <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${OG.line}`, marginBottom: 12 }}>
            {(['log', 'diff'] as const).filter(t => t === 'log' || file).map(t => <div key={t} onClick={() => setTab(t)} style={{ padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: tab === t ? OG.ink : OG.quiet, fontWeight: tab === t ? 600 : 400, boxShadow: tab === t ? `inset 0 -2px ${OG.ink}` : 'none' }}>{t === 'log' ? '변경 로그' : 'Active diff'}</div>)}
          </div>

          {tab === 'log' && <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              {(['today', '7d', '30d', 'all'] as Preset[]).map(pz => <span key={pz} style={chip(preset === pz)} onClick={() => setPreset(pz)}>{{ today: '오늘', '7d': '7일', '30d': '30일', all: '전체' }[pz]}</span>)}
              <select value={actor} onChange={e => setActor(e.target.value)} style={sel}><option value="">행위자 전체</option>{actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select value={action} onChange={e => setAction(e.target.value)} style={sel}><option value="">동작 전체</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: OG.quiet }}>{filtered.length}건{logs && logs.length >= 500 ? ' (최근 500건)' : ''}</span>
            </div>
            {!logs && <div style={{ color: OG.faint }}>불러오는 중…</div>}
            {logs && filtered.length === 0 && <div style={{ color: OG.faint, padding: 20, textAlign: 'center' }}>해당 기간 변경 없음</div>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filtered.map(l => {
                const u = users.find(x => x.user_id === l.actor); const al = ACTION_LABEL[l.action]
                return (
                  <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '92px 130px 44px 56px 1fr', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${OG.lineSoft}`, fontSize: 12.5 }}>
                    <span style={{ color: OG.quiet, fontSize: 11.5 }}>{fmtWhen(l.created_at)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>{u ? <UserAvatar name={u.name} avatarUrl={u.avatar_url} size={20} fontSize={9} /> : null}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(l.actor)}</span></span>
                    <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: al?.bg, color: al?.color, textAlign: 'center' }}>{al?.label ?? l.action}</span>
                    <span style={{ fontSize: 11, color: OG.quiet }}>{TARGET_LABEL[l.target_table] ?? l.target_table}</span>
                    <span title={JSON.stringify({ before: l.before, after: l.after })}>{l.target_table === 'org_cards' || l.target_table === 'org_card_jobs' ? <b style={{ fontWeight: 600 }}>{cardName(l.target_table === 'org_cards' ? l.target_id : (l.after?.card_id ?? l.before?.card_id))} </b> : null}{describe(l)}</span>
                  </div>)
              })}
            </div>
          </>}

          {tab === 'diff' && file && <>
            {!diffs && <div style={{ color: OG.faint }}>불러오는 중…</div>}
            {diffs && diffs.length === 0 && <div style={{ color: OG.faint, padding: 20, textAlign: 'center' }}>{file.status === 'draft' ? '초안은 Active 전환 후 diff 가 생성됩니다.' : '이전 Active 가 없거나 변경이 없습니다.'}</div>}
            {diffs && diffs.length > 0 && <div style={{ fontSize: 12, color: OG.quiet, marginBottom: 10 }}>이전 Active '{prevName}' 대비 {diffs.length}건 — 인사발령 목록·IT 변경요청서 원본</div>}
            {Array.from(grouped.entries()).map(([kind, rows]) => (
              <div key={kind} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px' }}>{KIND_LABEL[kind] ?? kind} <Tag>{rows.length}</Tag></div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <tbody>{rows.map(d => <tr key={d.id}><td style={{ padding: '5px 8px', borderTop: `1px solid ${OG.lineSoft}`, width: 180, fontWeight: 600 }}>{d.label ?? d.card_ref}</td><td style={{ padding: '5px 8px', borderTop: `1px solid ${OG.lineSoft}`, color: OG.quiet }}>{fmtDiff(d.before)}</td><td style={{ padding: '5px 8px', borderTop: `1px solid ${OG.lineSoft}`, width: 20, color: OG.faint }}>→</td><td style={{ padding: '5px 8px', borderTop: `1px solid ${OG.lineSoft}` }}>{fmtDiff(d.after)}</td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </>}
        </div>
      </div>
    </ModalPortal>
  )
}
function fmtDiff(v: any): string { if (!v) return '—'; return Object.entries(v).map(([k, x]) => `${k === 'unit' ? '' : k + ' '}${x ?? '-'}`).join(' · ') }
