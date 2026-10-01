/**
 * OrgGallery.tsx — 화면 A: 조직도 파일 갤러리 (Active 히어로 + 초안 카드 그리드 + Archived 접힘 테이블)
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.1 · 와이어프레임 docs/orgchart-wireframe-gallery.html 확정 구조
 *  표시 전용: 데이터·액션은 OrgAdminPanel 이 소유
 */
import { useState, type ReactNode } from 'react'
import type { AppUser, OrgCard, OrgFileSummary, OrgPersonStatus, OrgStatusType, OrgUnit } from '../../types'
import { OrgThumbnail } from './OrgThumbnail'
import { OG, Tag, btn, btnPri, btnDanger, btnDisabled, fmtWhen } from './orgShared'

export interface GalleryActions {
  onOpen:     (f: OrgFileSummary) => void
  onCopy:     (f: OrgFileSummary) => void
  onActivate: (f: OrgFileSummary) => void
  onDelete:   (f: OrgFileSummary) => void
  onNew:      () => void
  onExport?:  (f: OrgFileSummary) => void
  onDiff?:    (f: OrgFileSummary) => void
  onHistory?: () => void
  onCodes?:   () => void
}
interface Props extends GalleryActions {
  files:        OrgFileSummary[]
  users:        AppUser[]
  isSuper:      boolean
  /** Active 파일 썸네일·요약용 */
  activeBundle: { units: OrgUnit[]; cards: OrgCard[] } | null
  statuses:     OrgPersonStatus[]
  statusTypes:  OrgStatusType[]
  roster:       { missing_count: number; ghost_count: number; division_mismatch_count: number } | null
  onRoster?:    () => void
  loading:      boolean
}

const nameOf = (users: AppUser[], id: string | null) => users.find(u => u.user_id === id)?.name ?? ''

export function OrgGallery({ files, users, isSuper, activeBundle, statuses, statusTypes, roster, onRoster, loading, onOpen, onCopy, onActivate, onDelete, onNew, onExport, onDiff, onHistory, onCodes }: Props) {
  const active   = files.find(f => f.status === 'active') ?? null
  const drafts   = files.filter(f => f.status === 'draft').sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const archived = files.filter(f => f.status === 'archived').sort((a, b) => (b.effective_on ?? '').localeCompare(a.effective_on ?? ''))
  const [archOpen, setArchOpen] = useState(false)

  // Active 상태 요약 (카드 profile_id/person_id ↔ 활성 상태)
  const catCount = (cat: OrgStatusType['category']) => {
    if (!activeBundle) return 0
    const codes = new Set(statusTypes.filter(t => t.category === cat).map(t => t.code))
    const subj = new Set(statuses.filter(s => codes.has(s.status_code)).map(s => s.profile_id ?? `p:${s.person_id}`))
    return activeBundle.cards.filter(c => subj.has(c.profile_id ?? `p:${c.person_id}`)).length
  }
  const vacancies = activeBundle?.cards.filter(c => c.is_vacancy).length ?? 0
  const rosterTotal = roster ? roster.missing_count + roster.ghost_count + roster.division_mismatch_count : 0

  return (
    <div style={{ fontFamily: OG.font, color: OG.ink, maxWidth: 1180, margin: '0 auto' }}>
      {/* 상단 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>조직도</h2>
        <Tag>org</Tag>
        <span style={{ flex: 1 }} />
        {onCodes   && <button style={btn} onClick={onCodes}>코드 관리 (직급·직무·상태)</button>}
        {onHistory && <button style={btn} onClick={onHistory}>히스토리</button>}
        <button style={btnPri} onClick={onNew}>+ 새 조직도</button>
      </div>

      {roster && rosterTotal > 0 && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12.5, color: '#92400E' }}>
          <b>검증</b> Active 기준 로스터 누락 <b>{roster.missing_count}</b> · 유령 카드 <b>{roster.ghost_count}</b> · Division 불일치 <b>{roster.division_mismatch_count}</b>
          {onRoster && <a href="#" onClick={e => { e.preventDefault(); onRoster() }} style={{ marginLeft: 'auto', color: '#92400E' }}>리포트 보기 →</a>}
        </div>
      )}

      {/* Active hero */}
      {active ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 28, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ background: '#FAFAFA', borderRight: `1px solid ${OG.line}`, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
            {activeBundle ? <OrgThumbnail units={activeBundle.units} cards={activeBundle.cards} /> : <span style={{ color: OG.faint, fontSize: 12 }}>{loading ? '불러오는 중…' : ''}</span>}
          </div>
          <div style={{ padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><Tag kind="active">● ACTIVE</Tag> {active.effective_on && <Tag>적용일 {active.effective_on}</Tag>}</div>
            <h3 style={{ margin: 0, fontSize: 20 }}>{active.name}</h3>
            <div style={{ color: OG.quiet, fontSize: 12.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>단위 {active.unit_count} · 인원 {active.card_count}</span>
              <span>마지막 변경 {fmtWhen(active.updated_at)} · {nameOf(users, active.updated_by)}</span>
              {active.parent_file_id && <span>원본: {files.find(f => f.id === active.parent_file_id)?.name ?? '(삭제됨)'}</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Stat n={active.card_count} label="재직 카드" />
              <Stat n={catCount('departing')} label="퇴사예정" />
              <Stat n={catCount('hire_planned')} label="입사예정" />
              <Stat n={catCount('leave') + catCount('leave_planned') + catCount('return_planned')} label="휴직" />
              <Stat n={vacancies} label="공석" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
              <button style={btnPri} onClick={() => onOpen(active)}>열기</button>
              <button style={btn} onClick={() => onCopy(active)}>복사해서 편집</button>
              {onDiff   && <button style={btn} onClick={() => onDiff(active)}>Active diff</button>}
              {onExport && <button style={btn} onClick={() => onExport(active)}>내보내기</button>}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ border: `1px dashed ${OG.line}`, borderRadius: 14, padding: '36px 24px', textAlign: 'center', color: OG.quiet, fontSize: 13, marginBottom: 28 }}>
          Active 조직도가 없습니다. 초안을 만들고 최고 관리자가 Active 로 지정하면 여기에 표시됩니다.
        </div>
      )}

      {/* 초안 */}
      <h4 style={{ fontSize: 13.5, margin: '0 0 12px', color: OG.quiet, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>초안 <Tag>{drafts.length}</Tag></h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 28 }}>
        {drafts.map(f => (
          <DraftCard key={f.id} f={f} users={users} isSuper={isSuper} onOpen={onOpen} onCopy={onCopy} onActivate={onActivate} onDelete={onDelete} />
        ))}
        <div onClick={onNew} style={{ border: `1px dashed ${OG.line}`, borderRadius: 12, minHeight: 190, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: OG.quiet, fontSize: 12.5, cursor: 'pointer', gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 300 }}>+</span>새 조직도<span style={{ fontSize: 11 }}>빈 파일 또는 Active 복사</span>
        </div>
      </div>

      {/* Archived */}
      <div style={{ background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 12 }}>
        <div onClick={() => setArchOpen(o => !o)} style={{ padding: '12px 16px', cursor: 'pointer', color: OG.quiet, fontSize: 12.5 }}>
          {archOpen ? '▾' : '▸'} 지난 조직도 <b>{archived.length}</b>개 (Archived · 삭제 불가)
        </div>
        {archOpen && archived.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ color: OG.quiet, fontSize: 11.5 }}>{['이름', '적용일', '인원', 'Active 해제', ''].map(h => <th key={h} style={{ padding: '9px 16px', borderTop: `1px solid ${OG.line}`, textAlign: 'left', fontWeight: 500 }}>{h}</th>)}</tr></thead>
            <tbody>{archived.map(f => (
              <tr key={f.id}>
                <td style={td}>{f.name}</td>
                <td style={td}>{f.effective_on ?? '-'}</td>
                <td style={td}>{f.card_count}</td>
                <td style={td}>{fmtWhen(f.archived_at)} · {nameOf(users, f.updated_by)}</td>
                <td style={td}><button style={btn} onClick={() => onOpen(f)}>열기</button> <button style={btn} onClick={() => onCopy(f)}>복사</button> {onDiff && <button style={btn} onClick={() => onDiff(f)}>diff</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
const td: React.CSSProperties = { padding: '9px 16px', borderTop: `1px solid ${OG.line}` }

function Stat({ n, label }: { n: number; label: string }) {
  return <div style={{ border: `1px solid ${OG.line}`, borderRadius: 8, padding: '8px 12px', minWidth: 92 }}><b style={{ display: 'block', fontSize: 17 }}>{n}</b><span style={{ fontSize: 11, color: OG.quiet }}>{label}</span></div>
}

function DraftCard({ f, users, isSuper, onOpen, onCopy, onActivate, onDelete }: { f: OrgFileSummary; users: AppUser[]; isSuper: boolean } & Pick<GalleryActions, 'onOpen' | 'onCopy' | 'onActivate' | 'onDelete'>) {
  const [hover, setHover] = useState(false)
  const locked = f.lock_by && f.lock_at && (Date.now() - new Date(f.lock_at).getTime()) < 30 * 60_000
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  return (
    <div onClick={() => onOpen(f)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
         style={{ background: '#fff', border: `1px solid ${hover ? '#B8BEC9' : OG.line}`, borderRadius: 12, overflow: 'hidden', position: 'relative', cursor: 'pointer', boxShadow: hover ? '0 4px 14px rgba(0,0,0,.08)' : 'none' }}>
      <div style={{ background: '#FAFAFA', borderBottom: `1px solid ${OG.line}`, padding: 12, minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ThumbSlot f={f} />
      </div>
      {hover && (
        <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 4 }}>
          <HoverBtn onClick={stop(() => onCopy(f))}>복사</HoverBtn>
          <HoverBtn onClick={stop(() => onActivate(f))} disabled={!isSuper} title={isSuper ? '' : '최고 관리자만'}>Active 지정</HoverBtn>
          <HoverBtn onClick={stop(() => onDelete(f))} danger>삭제</HoverBtn>
        </div>
      )}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>{f.name} <Tag kind="draft">초안</Tag></div>
        <div style={{ fontSize: 11.5, color: OG.quiet, marginTop: 4 }}>적용일 {f.effective_on ?? '미정'} · 단위 {f.unit_count} · 인원 {f.card_count}</div>
        <div style={{ fontSize: 11.5, color: OG.quiet }}>{fmtWhen(f.updated_at)} · {nameOf(users, f.updated_by)} {locked && <span style={{ color: OG.amber }}>● {nameOf(users, f.lock_by)} 편집 중</span>}</div>
      </div>
    </div>
  )
}
/** 초안 썸네일은 갤러리 로딩 비용 때문에 요약 숫자만 (상세 진입 시 트리) */
function ThumbSlot({ f }: { f: OrgFileSummary }) {
  return <svg width={200} height={86} viewBox="0 0 200 86" fontFamily={OG.font} fontSize={9}>
    <rect x={70} y={6} width={60} height={18} rx={3} fill="#fff" stroke="#C7CDD8" /><text x={100} y={18} textAnchor="middle" fill={OG.ink}>{f.unit_count}단위</text>
    <line x1={100} y1={24} x2={100} y2={34} stroke="#9CA3AF" /><line x1={30} y1={34} x2={170} y2={34} stroke="#9CA3AF" />
    {[6, 56, 106, 156].map((x, i) => <rect key={i} x={x} y={38} width={40} height={16} rx={2} fill="#fff" stroke="#C7CDD8" />)}
    <text x={100} y={74} textAnchor="middle" fill={OG.quiet}>{f.card_count}명</text>
  </svg>
}
function HoverBtn({ children, onClick, danger, disabled, title }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; disabled?: boolean; title?: string }) {
  return <button title={title} onClick={disabled ? e => e.stopPropagation() : onClick} style={{ ...(danger ? btnDanger : btn), fontSize: 10.5, padding: '2px 6px', ...(disabled ? btnDisabled : {}) }}>{children}</button>
}
