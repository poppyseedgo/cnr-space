/**
 * DrawerShell.tsx — DetailDrawer 외곽 셸 (Figma 2669:10902)
 *
 * [2026-07-24] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 셸을 분리했나 — 기존 드로어의 UX 문제
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ① 브레드크럼이 스크롤 영역 안에 있었다
 *      드릴다운(목적 → 부서 → 예약)으로 3단까지 들어가는 화면인데, "지금 어디"를
 *      알려주는 브레드크럼이 본문 첫 줄에 있어 **스크롤하면 사라졌다**.
 *      20행짜리 표를 내려보는 순간 현재 위치와 '전체 보기' 복귀 수단이 동시에 없어진다.
 *      → 헤더에 고정한다. Figma 도 헤더(184px) 안에 네비게이션 바를 두고 있다.
 *
 *   ② 제목이 무엇을 보고 있는지 말해주지 않았다
 *      '회의 목적별 통계' 만 있고, 지금 걸린 필터(부서별 회의 · Management Support)는
 *      본문 파란 박스에만 있었다. 제목과 필터가 떨어져 있으면 캡처·공유 시 맥락이 사라진다.
 *      → 제목 아래 네비게이션 바에 필터 경로를 붙여 한 덩어리로 읽히게 한다.
 *
 *   ③ 닫기 버튼이 제목과 같은 줄에 있었지만 히트 영역이 32px 미만이었다
 *      → Figma 사양대로 32×32 원형 히트 영역 + 24px 아이콘.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 1:1 사양
 * ═══════════════════════════════════════════════════════════════════════════
 *   패널          w1400 (화면이 좁으면 96vw)
 *   헤더          p32 / gap24 / border-bottom 1px #CED6E7
 *     타이틀      Pretendard SemiBold 19 / #111
 *     닫기        32×32 원형, 아이콘 24
 *     네비 바     bg rgba(207,228,255,0.5) / radius 20 / p8 / gap16
 *       뒤로 버튼 흰 배경 / border #C9D9FF / radius 12 / pl12 pr20 py12 / gap8
 *                 아이콘 24 + 라벨 Medium 16 #111
 *       브레드크럼 Medium 16 #0F6BFF / gap8
 *   본문          p32
 */

import { IcoClose, IcoArrowLeftAlt, IcoChevronForward } from './DrawerIcons'

/** 드로어 공통 토큰 — 색·치수를 문자열로 흩뿌리지 않기 위한 SSOT */
export const DT = {
  font:        "'Pretendard', -apple-system, sans-serif",
  panelMaxW:   1400,          // ← Figma 프레임 폭
  pad:         32,            // ← 헤더·본문 공통 좌우 여백
  headerGap:   24,
  border:      '#CED6E7',     // 헤더 하단 구분선
  title:       '#111',
  navBg:       'rgba(207,228,255,0.5)',
  navBorder:   '#C9D9FF',
  navLink:     '#0F6BFF',     // 브레드크럼 텍스트
  tableBorder: '#D9E4F7',     // 표 헤더 하단
  rowBorder:   '#F6F9FE',     // 행 구분선
  headText:    '#92A0BC',     // 표 헤더 글자
  subText:     '#64748B',
  muted:       '#A9B9D5',
  pageBg:      '#F1F5F9',     // 본문 배경(카드가 흰색이라 한 톤 낮춘다)
} as const

/** 브레드크럼 한 조각 — onClick 이 있으면 되돌아갈 수 있는 지점 */
export interface Crumb {
  label:    string
  onClick?: () => void
}

interface Props {
  title:      string
  /** 제목 옆 보조 설명 (선택) — 지표 정의처럼 짧게 */
  subtitle?:  string
  /**
   * 브레드크럼. 비어 있으면 네비게이션 바 자체를 그리지 않는다.
   * 빈 바를 남겨두면 "누를 게 있나?" 하고 시선을 뺏는다.
   */
  crumbs?:    Crumb[]
  /** '전체 보기' 버튼 — 드릴다운 상태에서만 넘긴다 */
  onReset?:   () => void
  resetLabel?: string
  onClose:    () => void
  children:   React.ReactNode
}

export function DrawerShell({
  title, subtitle, crumbs = [], onReset, resetLabel = '전체 보기', onClose, children,
}: Props) {
  const hasNav = !!onReset || crumbs.length > 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', justifyContent: 'flex-end' }}>
      {/* 배경 dim — 클릭 시 닫기 */}
      <div onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} />

      <div className="anm" style={{
        position: 'relative',
        width:    `min(${DT.panelMaxW}px, 96vw)`,
        height:   '100%',
        background: DT.pageBg,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
      }}>
        {/* ── 헤더 (고정) ────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0, background: '#fff',
          borderBottom: `1px solid ${DT.border}`,
          padding: DT.pad, display: 'flex', flexDirection: 'column', gap: DT.headerGap,
        }}>
          {/* 타이틀 행 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <p style={{
                fontFamily: DT.font, fontWeight: 600, fontSize: 19, lineHeight: 1.5, color: DT.title,
                margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{title}</p>
              {/* 서브타이틀 — Figma 에는 없지만 지표 정의를 담을 자리가 필요하다.
                  없으면 '가동률' 같은 파생 지표의 산정 기준을 표 위 주석으로 밀어넣게 되고,
                  그러면 제목과 정의가 스크롤로 갈라진다. */}
              {subtitle && (
                <p style={{
                  fontFamily: DT.font, fontWeight: 400, fontSize: 13, lineHeight: 1.5,
                  color: DT.subText, margin: 0,
                }}>{subtitle}</p>
              )}
            </div>
            <button className="btn" onClick={onClose} aria-label="닫기"
              style={{
                width: 32, height: 32, borderRadius: 10000, border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}>
              <IcoClose />
            </button>
          </div>

          {/* 네비게이션 바 — 브레드크럼 겸 복귀 수단 */}
          {hasNav && (
            <div style={{
              background: DT.navBg, borderRadius: 20, padding: 8,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              {onReset && (
                <button className="btn" onClick={onReset}
                  style={{
                    background: '#fff', border: `1px solid ${DT.navBorder}`, borderRadius: 12,
                    padding: '12px 20px 12px 12px', display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer', flexShrink: 0,
                  }}>
                  <IcoArrowLeftAlt />
                  <span style={{ fontFamily: DT.font, fontWeight: 500, fontSize: 16, lineHeight: '16px', color: DT.title }}>
                    {resetLabel}
                  </span>
                </button>
              )}
              {/* ── 경로 ─────────────────────────────────────────────────
                    ★ [2026-07-24 #10] 마지막 조각(현재 위치)을 강조한다.

                      전부 같은 파란색이면 "어디까지 들어왔는지"가 안 읽힌다.
                      지금 보고 있는 표가 무엇인지가 이 화면에서 가장 중요한 정보이므로,
                      마지막 조각만 **진한 검정 + SemiBold**로 두고 앞 조각은 파란 링크로 남긴다.
                      색만으로 링크/현재를 구분할 수 있어 밑줄도 링크에만 붙인다.
                      조각 사이에는 chevron_forward(Figma 아이콘)로 방향을 준다. */}
              {crumbs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                  {crumbs.map((c, i) => {
                    const isLast = i === crumbs.length - 1
                    return (
                      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        {i > 0 && <IcoChevronForward size={16} color="#A9B9D5" />}
                        <button className="btn"
                          onClick={c.onClick}
                          disabled={!c.onClick}
                          style={{
                            fontFamily: DT.font,
                            fontWeight: isLast ? 600 : 500,
                            fontSize: 16, lineHeight: '16px',
                            color: isLast ? DT.title : DT.navLink,
                            background: 'transparent', border: 'none', padding: 0,
                            cursor: c.onClick ? 'pointer' : 'default',
                            textDecoration: c.onClick ? 'underline' : 'none',
                            textUnderlineOffset: 3,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320,
                          }}>{c.label}</button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 본문 (스크롤) ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', padding: DT.pad }}>
          {children}
        </div>
      </div>
    </div>
  )
}
