/**
 * OrgStepHeader.tsx — 단계 화면(① 구조 설계 · ② 단위 바인드 · …) 공용 헤더 — OrgCanvas 헤더와 같은 구성 + 스텝퍼
 *  - [2026-10-02 ORG 8-B] OrgStructureEditor 에서 분리. 되돌리기·검증·히스토리·내보내기·복사·Active 지정
 */
import type { ReactNode } from 'react'
import type { OrgFile, OrgRosterCheck } from '../../types'
import type { OrgUndoPeek } from '../../lib/orgApi'
import { OG, Tag, btn, btnPri, btnDisabled, fileStatusLabel, fmtWhen } from './orgShared'

export interface StepHeaderProps {
  file:       OrgFile
  editable:   boolean
  isSuper:    boolean
  lockHolder: string | null
  savedAt:    string | null
  undo:       OrgUndoPeek | null
  roster:     OrgRosterCheck | null
  stepper:    ReactNode
  /** [8-D] 스텝퍼 오른쪽 추가 컨트롤(③ 보드·표 전환 등) */
  extra?:     ReactNode
  onBack: () => void; onEditMeta: () => void; onRoster: () => void; onHistory: () => void; onExport: () => void; onCopy: () => void; onActivate: () => void; onUndo: () => void
}

export function OrgStepHeader(p: StepHeaderProps) {
  const { file, editable } = p
  const rosterTotal = p.roster ? p.roster.missing_count + p.roster.ghost_count + p.roster.division_mismatch_count : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, background: '#fff', borderBottom: `1px solid ${OG.line}`, flexShrink: 0 }}>
      <button style={btn} onClick={p.onBack}>← 목록</button>
      <h3 style={{ fontSize: 15, margin: 0, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={p.onEditMeta} title="이름·적용일·메모 편집">{file.name}</h3>
      <Tag kind={file.status}>{fileStatusLabel(file.status)}</Tag>
      {p.stepper}
      {p.extra}
      {p.lockHolder && <span style={{ fontSize: 11.5, color: OG.amber, whiteSpace: 'nowrap' }}>● {p.lockHolder} 편집 중</span>}
      <span style={{ flex: 1 }} />
      {editable && <span style={{ fontSize: 11.5, color: OG.quiet, whiteSpace: 'nowrap' }}>{p.savedAt ? `자동 저장됨 ${fmtWhen(p.savedAt)}` : ''}</span>}
      {!editable && <span style={{ fontSize: 11.5, color: OG.quiet }}>읽기 전용{p.lockHolder ? ' — 잠금 해제 대기 또는 복사' : ''}</span>}
      {editable && <button style={{ ...btn, ...(p.undo?.available ? {} : btnDisabled) }} disabled={!p.undo?.available} onClick={p.onUndo}
               title={p.undo?.available ? `내 마지막 동작 되돌리기 (${p.undo.rows ?? 0}건 · ${p.undo.at ? fmtWhen(p.undo.at) : ''})` : p.undo?.conflict ? '그 뒤에 다른 사용자의 변경이 있어 되돌릴 수 없습니다' : '되돌릴 내 변경이 없습니다'}>↶ 되돌리기{p.undo?.available && p.undo.rows ? ` (${p.undo.rows})` : ''}</button>}
      <button style={{ ...btn, ...(rosterTotal > 0 ? { borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' } : {}) }} onClick={p.onRoster}>검증{p.roster ? ` (${rosterTotal})` : ''}</button>
      <button style={btn} onClick={p.onHistory}>히스토리</button>
      <button style={btn} onClick={p.onExport}>내보내기</button>
      <button style={btn} onClick={p.onCopy}>복사</button>
      {file.status === 'draft' && <button style={{ ...btnPri, ...(p.isSuper ? {} : btnDisabled) }} disabled={!p.isSuper} title={p.isSuper ? '' : '최고 관리자만 Active 지정'} onClick={p.onActivate}>Active 지정</button>}
    </div>
  )
}

/** 단계 화면 공용 바깥 틀(캔버스와 같은 높이·테두리) */
export const stepShell: React.CSSProperties = { fontFamily: OG.font, color: OG.ink, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 640, background: OG.pageBg, border: `1px solid ${OG.line}`, borderRadius: 12, overflow: 'hidden' }
