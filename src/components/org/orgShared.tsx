/**
 * orgShared.tsx — 조직도 공용 토큰·아톰
 *  - [2026-10-01 ORG Phase 3] 신규 — 와이어프레임(docs/orgchart-wireframe-*.html) 확정 토큰. Figma 확정 시 여기만 교체
 */
import type { CSSProperties, ReactNode } from 'react'
import { ORG_FONT } from '../../utils/orgStatus'

export const OG = {
  font:     ORG_FONT,
  ink:      '#1A1A1A',
  quiet:    '#6B7280',
  faint:    '#9CA3AF',
  line:     '#D9DCE3',
  lineSoft: '#E5E7EB',
  pageBg:   '#F6F6F6',
  card:     '#FFFFFF',
  drop:     '#2563EB',
  green:    '#16A34A',
  amber:    '#D97706',
  red:      '#DC2626',
  cardW:    212,
  panelW:   280,
} as const

/** [8-A] 단위 유형 라벨 — 엑셀 실측 계층 기준(설계서 §15.5 Q5). org_units.unit_type 은 자유 텍스트라 여기만 바꾸면 선택지가 바뀐다 */
export const ORG_UNIT_TYPES = ['회사', '본부', '실', 'Division', '팀', '파트'] as const

export const btn: CSSProperties = { fontFamily: OG.font, fontSize: 12, padding: '6px 10px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.ink, cursor: 'pointer', whiteSpace: 'nowrap' }
export const btnPri: CSSProperties = { ...btn, background: OG.ink, color: '#fff', borderColor: OG.ink }
export const btnDanger: CSSProperties = { ...btn, color: OG.red, borderColor: '#FECACA' }
export const btnDisabled: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' }

export function Tag({ children, kind = 'neutral', style }: { children: ReactNode; kind?: 'neutral' | 'active' | 'draft' | 'archived'; style?: CSSProperties }) {
  const k = kind === 'active'   ? { background: '#DCFCE7', borderColor: '#86EFAC', color: '#166534', fontWeight: 600 }
          : kind === 'draft'    ? { background: '#EEF2FF', borderColor: '#C7D2FE', color: '#3730A3' }
          : kind === 'archived' ? { background: '#F3F4F6', borderColor: OG.line, color: OG.quiet }
          : { background: '#fff', borderColor: OG.line, color: OG.quiet }
  return <span style={{ fontFamily: OG.font, fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid', display: 'inline-block', lineHeight: 1.4, ...k, ...style }}>{children}</span>
}

export function fileStatusLabel(s: 'draft' | 'active' | 'archived') {
  return s === 'active' ? '● ACTIVE' : s === 'draft' ? '초안' : 'Archived'
}

/** 'YYYY-MM-DD' / ISO → 'M/D HH:MM' (KST 표시) */
export function fmtWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const k = new Date(d.getTime() + 9 * 3600_000)
  return `${k.getUTCMonth() + 1}/${String(k.getUTCDate()).padStart(2, '0')} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
}
