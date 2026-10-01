/**
 * OrgCardView.tsx — 인사 카드 (트리 노드 안 스택용)
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.2 카드. 아바타 앞 상태 점(기존 EmploymentBadge 규칙) · 이름 · 직급·직무 · 상태 라벨 1줄
 *    공석 = 점선, 퇴사 = 취소선 + 빨강 라벨, Azure Division 불일치 = 우상단 앰버 점
 */
import type { CSSProperties, DragEvent } from 'react'
import type { OrgCard, OrgJob, OrgRank } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { ORG_DEPARTED_STYLE, ORG_VACANCY_STYLE, ORG_EMPLOYMENT_TYPE_LABEL, type OrgBadgeSpec, type OrgPersonView } from '../../utils/orgStatus'
import { OG } from './orgShared'

export interface OrgCardViewProps {
  card:       OrgCard
  person:     OrgPersonView
  rank:       OrgRank | null
  jobs:       OrgJob[]           // 대표 먼저
  badge:      OrgBadgeSpec | null
  mismatch?:  boolean
  dim?:       boolean
  selected?:  boolean
  draggable?: boolean
  onClick?:   (card: OrgCard) => void
  onDragStart?: (e: DragEvent, card: OrgCard) => void
  onDragEnd?:   () => void
}

export function OrgCardView({ card, person, rank, jobs, badge, mismatch, dim, selected, draggable, onClick, onDragStart, onDragEnd }: OrgCardViewProps) {
  const lead = card.is_unit_head
  const style: CSSProperties = {
    border: `1px solid ${selected ? OG.drop : lead ? OG.ink : OG.line}`,
    borderStyle: card.is_vacancy ? 'dashed' : 'solid',
    borderRadius: 7, background: card.is_vacancy ? 'transparent' : lead ? '#FAFAFA' : OG.card,
    padding: '7px 8px', display: 'grid', gridTemplateColumns: '28px 1fr', columnGap: 8, alignItems: 'center',
    position: 'relative', opacity: dim ? 0.35 : 1, cursor: onClick ? 'pointer' : 'default', fontFamily: OG.font,
    boxShadow: selected ? `0 0 0 2px ${OG.drop}22` : 'none',
  }
  const jobText = jobs.map(j => j.code).join(' / ')
  const sub = [rank?.label, jobText].filter(Boolean).join(' · ') || (card.is_vacancy ? '직급/직무 미지정' : '')
  const label: OrgBadgeSpec | null = person.departed
    ? { label: '퇴사 완료', ...ORG_DEPARTED_STYLE }
    : card.is_vacancy ? { label: 'TO · 공석', ...ORG_VACANCY_STYLE } : badge

  return (
    <div style={style} draggable={draggable} onClick={onClick ? () => onClick(card) : undefined}
         onDragStart={onDragStart ? e => onDragStart(e, card) : undefined} onDragEnd={onDragEnd} title={person.email || undefined}>
      <div style={{ position: 'relative', width: 28, height: 28 }}>
        {card.is_vacancy
          ? <div style={{ width: 28, height: 28, borderRadius: '50%', border: `1px dashed ${OG.faint}` }} />
          : <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size={28} fontSize={11} />}
        {label && !card.is_vacancy && <i style={{ position: 'absolute', left: -3, top: -3, width: 10, height: 10, borderRadius: '50%', background: label.dot, border: '2px solid #fff' }} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ textDecoration: person.departed ? 'line-through' : 'none', color: person.departed ? OG.faint : card.is_vacancy ? OG.quiet : OG.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.name}</span>
          {lead && <span style={{ fontSize: 9.5, border: `1px solid ${OG.ink}`, borderRadius: 3, padding: '0 3px', fontWeight: 500, flexShrink: 0 }}>단위장</span>}
          {card.employment_type !== 'regular' && <span style={{ fontSize: 9.5, color: OG.quiet, border: `1px solid ${OG.line}`, borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>{ORG_EMPLOYMENT_TYPE_LABEL[card.employment_type]}</span>}
          {card.fte < 1 && <span style={{ fontSize: 9.5, color: OG.quiet, flexShrink: 0 }}>({card.fte})</span>}
        </div>
        <div style={{ fontSize: 11, color: OG.quiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}{card.work_location ? ` · ${card.work_location}` : ''}</div>
      </div>
      {label && <span style={{ gridColumn: '1 / -1', fontSize: 10, padding: '1px 6px', borderRadius: 4, width: 'fit-content', marginTop: 2, background: label.bg, color: label.color }}>{label.label}</span>}
      {mismatch && <span title="Azure Division 불일치" style={{ position: 'absolute', right: 8, top: 8, width: 8, height: 8, borderRadius: '50%', background: OG.amber }} />}
    </div>
  )
}
