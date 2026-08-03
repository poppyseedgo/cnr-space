// ============================================================
// ReleaseNotesPage.tsx — Release Note + Hotfix 페이지
// ------------------------------------------------------------
// [2026-08-03 신규] 4/22 오픈 이후 전체 변경점 타임라인.
//   데이터 SSOT: src/data/releaseNotes.ts (새 배포 시 그 파일만 수정)
//   스타일: 도서관 리스트 톤 재사용 (#F6F6F6 배경 · 흰 카드 r16 · #111 액티브)
// ============================================================

import { useMemo, useState } from 'react'
import {
  RELEASE_NOTES,
  RELEASE_MODULES,
  type ReleaseModule,
  type ReleaseType,
} from '../data/releaseNotes'

// ── 토큰 (도서관 리스트 팔레트 준용) ─────────────────────────
const T = {
  pageBg: '#F6F6F6',
  card: '#FFFFFF',
  ink: '#111111',
  sub: '#6A7282',
  faint: '#AEB5C4',
  line: '#EBEEF4',
  hotfix: '#DC2626',
  hotfixBg: '#FEF2F2',
  releaseBg: '#F1F5F9',
} as const

type TypeFilter = 'all' | ReleaseType

const TYPE_TABS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'release', label: 'Release' },
  { id: 'hotfix', label: 'Hotfix' },
]

// 날짜 표기: dateLabel 우선, 없으면 YYYY.MM.DD (요일 병기)
function fmtDate(n: { date: string; dateLabel?: string }): string {
  if (n.dateLabel) return n.dateLabel
  const d = new Date(n.date + 'T00:00:00') // 로컬 파싱 (TZ 밀림 방지 — utils/time 관례)
  const yoil = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  const [y, m, day] = n.date.split('-')
  return `${y}.${m}.${day} (${yoil})`
}

// 타입 뱃지
function TypeBadge({ type }: { type: ReleaseType }) {
  const isHotfix = type === 'hotfix'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: 24,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: isHotfix ? T.hotfixBg : T.ink,
        color: isHotfix ? T.hotfix : '#FFFFFF',
        flexShrink: 0,
      }}
    >
      {isHotfix ? 'Hotfix' : 'Release'}
    </span>
  )
}

// 필터 pill (대시보드 프리셋 pill 문법 준용)
function FilterPill({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 24,
        border: '1px solid ' + (active ? '#000000' : T.line),
        background: active ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)',
        color: active ? '#FFFFFF' : '#1E1E1E',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.11px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

export function ReleaseNotesPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [moduleFilter, setModuleFilter] = useState<ReleaseModule | null>(null)

  // date desc 정렬 (동일 날짜는 데이터 배열 순서 유지 — 배열이 이미 최신 우선)
  const sorted = useMemo(
    () => [...RELEASE_NOTES].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [],
  )

  const filtered = useMemo(
    () =>
      sorted.filter(
        n =>
          (typeFilter === 'all' || n.type === typeFilter) &&
          (moduleFilter === null || n.module === moduleFilter),
      ),
    [sorted, typeFilter, moduleFilter],
  )

  // 건수는 항상 필터 전 전체 기준 (필터된 목록을 분모로 쓰지 않음 — 대시보드 규칙 동일)
  const counts = useMemo(() => {
    const release = sorted.filter(n => n.type === 'release').length
    const hotfix = sorted.filter(n => n.type === 'hotfix').length
    return { total: sorted.length, release, hotfix }
  }, [sorted])

  return (
    <div style={{ background: T.pageBg, minHeight: '100%', padding: '32px 20px 80px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* ── 헤더 ── */}
        <div style={{ marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: T.ink }}>
            Release Note + Hotfix
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
            2026년 4월 22일 정식 오픈 이후의 모든 기능 추가·개선(Release)과 긴급 수정(Hotfix) 내역입니다.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: T.faint }}>
            전체 {counts.total}건 · Release {counts.release} · Hotfix {counts.hotfix}
          </p>
        </div>

        {/* ── 필터 ── */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            margin: '20px 0 28px',
          }}
        >
          {TYPE_TABS.map(t => (
            <FilterPill
              key={t.id}
              label={t.label}
              active={typeFilter === t.id}
              onClick={() => setTypeFilter(t.id)}
            />
          ))}
          <span style={{ width: 1, height: 16, background: T.line, margin: '0 4px', flexShrink: 0 }} />
          {RELEASE_MODULES.map(m => (
            <FilterPill
              key={m}
              label={m}
              active={moduleFilter === m}
              onClick={() => setModuleFilter(prev => (prev === m ? null : m))}
            />
          ))}
        </div>

        {/* ── 타임라인 ── */}
        {filtered.length === 0 ? (
          <div
            style={{
              background: T.card,
              borderRadius: 16,
              padding: '48px 24px',
              textAlign: 'center',
              fontSize: 13,
              color: T.faint,
            }}
          >
            선택한 조건에 해당하는 내역이 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(n => (
              <article
                key={n.id}
                style={{
                  background: T.card,
                  borderRadius: 16,
                  padding: '20px 24px',
                }}
              >
                {/* 카드 헤더: 뱃지 · 날짜 · 모듈 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <TypeBadge type={n.type} />
                  <span style={{ fontSize: 12, color: T.sub, fontWeight: 500 }}>{fmtDate(n)}</span>
                  <span style={{ fontSize: 12, color: T.faint }}>·</span>
                  <span style={{ fontSize: 12, color: T.faint }}>{n.module}</span>
                </div>

                <h2
                  style={{
                    margin: '10px 0 0',
                    fontSize: 16,
                    fontWeight: 600,
                    color: T.ink,
                    lineHeight: 1.4,
                  }}
                >
                  {n.title}
                </h2>

                <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
                  {n.items.map((item, i) => (
                    <li
                      key={i}
                      style={{
                        position: 'relative',
                        paddingLeft: 14,
                        fontSize: 13,
                        lineHeight: 1.65,
                        color: '#374151',
                        marginTop: i === 0 ? 0 : 6,
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 8,
                          width: 4,
                          height: 4,
                          borderRadius: '50%',
                          background: n.type === 'hotfix' ? T.hotfix : '#9CA3AF',
                        }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
