/**
 * NewCollectionSlider.tsx — 메인 상단 "New Collection" 가로 자동 슬라이드
 *
 * [2026-07-21] 신규
 *
 * Figma: fMv9JLNlNybDBYUnJDCTrq
 *   1347:1991  컨테이너   — flex / gap 40 / items-start / pb 32 (Hero 내부 전폭 1352)
 *   1347:2089  라벨 블록  — w170 / col gap 16
 *     1347:2015  "New Collection"  36px / lh 1.1 / #000
 *     1347:2093  카운터 행         gap 8 / "1/10" 16px #2E2E2E / 화살표 20×20 gap 10
 *   1347:1948  카드       — col gap 12 / w223
 *     1347:1949  표지      223×325 (비율 1 : 1.457)
 *     1347:1997  제목      20px #1E1E1E / lh 1.25
 *     1347:1998  저자      14px #A1A4AF / lh 1.25
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 대상 도서 선정 — 왜 new_until 이 아니라 acquired_at 인가
 * ═══════════════════════════════════════════════════════════════════════════
 * "3개월치 신규 도서"는 시간 창(rolling window)이다. new_until(수동 종료일)로
 * 표현하면 매월 구입분 3권을 사람이 켜고, 3개월이 지나면 다시 꺼야 한다.
 * 자동 롤링이 요구사항이므로 판정 SSOT 는 libraryListShared.isRecentAcquisition()
 * (acquired_at 기준) 이다. 기존 ⭐NEW⭐(isNewBook/new_until)는 손대지 않았고,
 * 한 도서가 양쪽에 동시에 속할 수 있다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 마퀴(연속 흐름)가 아니라 스텝 이동인가
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 가 "1/10" 카운터와 ‹ › 화살표를 함께 그려 두었다. 연속 흐름이면
 * 현재 인덱스라는 개념이 없어 카운터·화살표가 의미를 잃는다.
 * → N초마다 한 칸씩 이동. 화살표는 같은 이동을 수동으로 호출할 뿐이라
 *   자동/수동이 같은 코드 경로를 쓴다(동작 불일치가 생길 여지 없음).
 *
 * 무한 순환: 트랙을 2벌 렌더하고 idx 가 원본 길이에 도달하면
 *   transitionend 시점에 transition 을 끄고 0 으로 되돌린다.
 *   (사용자에게는 같은 카드라 점프가 보이지 않는다)
 *
 * 성능: translate3d 로 GPU 합성 레이어 승격. left/width 애니메이션은 쓰지 않는다
 *       (iPad Safari 성능 이슈로 프로젝트 전반에서 금지된 패턴).
 *
 * 자동 이동 정지 조건 — 하나라도 참이면 타이머를 걸지 않는다
 *   · 항목이 뷰포트에 전부 들어감(슬라이드 불필요)
 *   · 마우스 호버 / 키보드 포커스
 *   · 탭 비활성(document.hidden) — 백그라운드에서 인덱스가 폭주하지 않도록
 *   · prefers-reduced-motion: reduce
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 대비 의도적 차이
 * ═══════════════════════════════════════════════════════════════════════════
 * 1) 폰트 — Figma 는 "New Collection"에 Instrument Sans, "1/10"에 ABC Favorit
 *    (둘 다 프로젝트 미탑재, 후자는 Unlicensed Trial)을 썼다. 폰트를 새로
 *    추가하지 않고 Pretendard 로 렌더하되 크기/행간/자간은 Figma 값을 그대로 쓴다.
 * 2) "N월 신규 도서" 라벨 — Figma 슬라이더 카드에는 없다. 요구사항이라
 *    그리드 카드와 동일 규격(ListBadge, #78FF4F, 좌상단 8/7)으로 얹었다.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  LT, ListBadge, pickCoverFit, acquiredMonthLabel, isRecentAcquisition,
  NEW_COLLECTION_MONTHS,
} from './libraryListShared'

// ═══════════════════════════════════════════════════════════════════════════
// 0. 입력 계약
// ═══════════════════════════════════════════════════════════════════════════
//
// libraryListShared.CardBook 과 같은 이유로 "이 컴포넌트가 실제로 읽는 필드만"
// 구조적 타입으로 선언한다. LibraryPage 의 로컬 Book 과 전역 types/index.ts 의
// Book 양쪽 모두와 호환된다.

export interface SlideBook {
  id:          number
  title:       string
  author:      string | null
  cover_url:   string | null
  acquired_at: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 치수 토큰 — Figma 1347:1991
// ═══════════════════════════════════════════════════════════════════════════

const NC = {
  gap:          40,      // 라벨↔카드, 카드↔카드 공통 (Figma 210-170=40, 473-223-210=40)
  padBottom:    32,      // 컨테이너 pb
  labelW:       170,     // 라벨 블록 폭
  labelGap:     16,      // "New Collection" ↔ 카운터 행
  cardW:        223,
  cardGap:      12,      // 표지 ↔ 텍스트
  coverRatio:   '223 / 325',
  coverRatioNum: 223 / 325,
  titleSize:    20,
  authorSize:   14,
  headSize:     36,      // "New Collection"
  counterSize:  16,
  arrow:        20,
  arrowGap:     10,

  // 모바일 축소값 (Figma 는 1400 데스크톱만 존재)
  mCardW:       150,
  mGap:         16,
  mHeadSize:    24,
} as const

/** 자동 이동 간격(ms). 카드 1장이 눈에 들어오는 시간 + 읽는 시간. */
const AUTO_MS = 3500
/** 슬라이드 전환 시간(ms). 아래 transition 문자열과 반드시 같은 값이어야 한다. */
const ANIM_MS = 600
const EASING  = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

const FONT_R = 400

// ═══════════════════════════════════════════════════════════════════════════
// 2. 아이콘 — Figma 1347:2082 / 1347:2085 (Material arrow_back_ios_new, 20×20)
// ═══════════════════════════════════════════════════════════════════════════

function ArrowIcon({ dir, size = NC.arrow }: { dir: 'prev' | 'next'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <path
        d={dir === 'prev' ? 'M12.5 3.5L6 10l6.5 6.5' : 'M7.5 3.5L14 10l-6.5 6.5'}
        stroke={LT.black} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 환경 감지 훅
// ═══════════════════════════════════════════════════════════════════════════

/** 사용자가 OS 수준에서 애니메이션 축소를 요청했는가 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduce
}

/**
 * 탭이 보이는 상태인가.
 *
 * 백그라운드 탭에서는 브라우저가 타이머를 묶어서 몰아 실행한다. 그대로 두면
 * 탭에 돌아왔을 때 인덱스가 몇 칸씩 튄 상태로 보인다. 숨김 동안 아예 멈춘다.
 */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/** 요소의 실제 폭(px). 슬라이드가 필요한지(항목이 넘치는지) 판단하는 데 쓴다. */
function useElementWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // ResizeObserver 는 창 크기 변화뿐 아니라 사이드바 개폐 등 레이아웃 변화도 잡는다.
    if (typeof ResizeObserver === 'undefined') {
      setW(el.clientWidth)
      return
    }
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setW(e.contentRect.width)
    })
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 표지 — 그리드 카드와 같은 맞춤 규칙(pickCoverFit) 재사용
// ═══════════════════════════════════════════════════════════════════════════

function SlideCover({ book, w }: { book: SlideBook; w: number }) {
  const [err, setErr] = useState(false)
  const [fit, setFit] = useState<'cover' | 'contain'>('contain')

  const label = acquiredMonthLabel(book.acquired_at)

  return (
    <div style={{
      position: 'relative', width: w, aspectRatio: NC.coverRatio,
      background: LT.coverBg, overflow: 'hidden', flexShrink: 0,
    }}>
      {book.cover_url && !err ? (
        <img
          src={book.cover_url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setErr(true)}
          onLoad={e => {
            const el = e.currentTarget
            if (el.naturalWidth && el.naturalHeight) {
              setFit(pickCoverFit(el.naturalWidth / el.naturalHeight))
            }
          }}
          style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 16px', boxSizing: 'border-box',
        }}>
          <span style={{
            fontSize: 14, fontWeight: FONT_R, color: '#A1A4AF',
            textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.5,
          }}>
            {book.title}
          </span>
        </div>
      )}

      {/* "N월 신규 도서" — 그리드 카드 뱃지와 동일 규격/색 */}
      {label && (
        <div style={{ position: 'absolute', top: 7, left: 8 }}>
          <ListBadge bg={LT.badgeNew}>{label}</ListBadge>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 본체
// ═══════════════════════════════════════════════════════════════════════════

export interface NewCollectionSliderProps {
  books:    SlideBook[]
  isMobile: boolean
  /** 카드 클릭 — 호출부에서 검색어로 좁히는 등 기존 동작에 연결한다 */
  onSelect?: (book: SlideBook) => void
  /** 표시 기간(개월). 기본 3 = 사내 규칙(매월 3권 × 3개월 = 최대 9권) */
  months?:  number
}

export function NewCollectionSlider({
  books, isMobile, onSelect, months = NEW_COLLECTION_MONTHS,
}: NewCollectionSliderProps) {
  const cardW = isMobile ? NC.mCardW : NC.cardW
  const gap   = isMobile ? NC.mGap   : NC.gap
  const step  = cardW + gap

  // ── 대상 도서: 최근 N개월 입고분, 최신 입고순 ────────────────────────────
  //   같은 날 입고분은 제목순 — 정렬이 매 렌더 흔들리지 않도록 2차 키를 둔다.
  const items = useMemo(() => {
    return books
      .filter(b => isRecentAcquisition(b, months))
      .sort((a, b) => {
        const da = a.acquired_at ?? ''
        const db = b.acquired_at ?? ''
        if (da !== db) return db.localeCompare(da)      // 최신 우선
        return a.title.localeCompare(b.title, 'ko')
      })
  }, [books, months])

  const len = items.length

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const trackRef    = useRef<HTMLDivElement | null>(null)
  const viewW       = useElementWidth(viewportRef)

  const reduceMotion = usePrefersReducedMotion()
  const pageVisible  = usePageVisible()
  const [hovered, setHovered] = useState(false)

  const [idx,  setIdx]  = useState(0)
  const [anim, setAnim] = useState(true)

  // ── 슬라이드가 필요한가 ───────────────────────────────────────────────────
  //   뷰포트에 전부 들어가면 움직일 이유가 없다(빈 공간이 흘러가는 것처럼 보인다).
  //   viewW 는 초기 렌더에서 0 이므로, 측정 전에는 이동하지 않는다.
  const loop = viewW > 0 && len * step - gap > viewW + 1

  // 자동 이동 활성 조건
  const autoOn = loop && !hovered && pageVisible && !reduceMotion && anim

  // ── 이동 ──────────────────────────────────────────────────────────────────
  //   자동/수동이 같은 함수를 쓴다. anim=false(리셋 중)일 땐 입력을 무시해
  //   되돌리는 중간에 인덱스가 덧씌워지는 상태 꼬임을 막는다.
  const goNext = useCallback(() => {
    if (!loop || !anim) return
    setIdx(i => i + 1)            // len 에 도달하면 onTransitionEnd 가 0 으로 되돌린다
  }, [loop, anim])

  const goPrev = useCallback(() => {
    if (!loop || !anim) return
    if (idx === 0) {
      // 0 에서 왼쪽 = 복제 블록의 마지막으로 순간이동 후 한 칸 되감기.
      // rAF 2번: 첫 번째로 "transition 없는 위치 변경"이 페인트되고,
      //          두 번째에서 transition 을 다시 켠 뒤 목적지를 준다.
      //          한 번만 쓰면 브라우저가 두 변경을 합쳐 애니메이션이 튄다.
      setAnim(false)
      setIdx(len)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setAnim(true)
        setIdx(len - 1)
      }))
      return
    }
    setIdx(i => i - 1)
  }, [loop, anim, idx, len])

  // ── 자동 타이머 ───────────────────────────────────────────────────────────
  //   idx 가 바뀔 때마다 타이머가 재설정된다 = 화살표를 누르면 대기시간도 리셋.
  useEffect(() => {
    if (!autoOn) return
    const t = setTimeout(goNext, AUTO_MS)
    return () => clearTimeout(t)
  }, [autoOn, idx, goNext])

  // ── 목록이 바뀌면 인덱스 초기화 ───────────────────────────────────────────
  //   도서 추가/삭제로 len 이 줄었는데 idx 가 남아 있으면 빈 칸을 가리킨다.
  useEffect(() => { setIdx(0); setAnim(true) }, [len])

  // ── 끝 도달 시 무애니메이션 되돌리기 ──────────────────────────────────────
  function handleTransitionEnd(e: React.TransitionEvent<HTMLDivElement>) {
    // 자식(표지 이미지 등)의 transition 이 버블링돼 들어오는 것을 걸러낸다
    if (e.target !== trackRef.current || e.propertyName !== 'transform') return
    if (idx < len) return
    setAnim(false)
    setIdx(0)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true)))
  }

  // ── 렌더 목록 ─────────────────────────────────────────────────────────────
  //   순환할 때만 2벌. 아니면 원본 1벌(중복 DOM/이미지 요청을 만들지 않는다).
  const rendered = loop ? [...items, ...items] : items

  // 3개월 내 입고분이 없으면 섹션 자체를 그리지 않는다(빈 여백만 남는 것 방지)
  if (len === 0) return null

  const counterNow = (idx % len) + 1

  return (
    <section
      aria-label="New Collection"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'flex-start',
        gap: isMobile ? 20 : NC.gap,
        paddingBottom: isMobile ? 8 : NC.padBottom,
        width: '100%',
        minWidth: 0,
      }}>

      {/* ── 라벨 블록 (Figma 1347:2089) ─────────────────────────────────── */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        gap: isMobile ? 8 : NC.labelGap,
        width: isMobile ? '100%' : NC.labelW,
        flexShrink: 0,
      }}>
        <h2 style={{
          margin: 0,
          fontSize: isMobile ? NC.mHeadSize : NC.headSize,
          fontWeight: FONT_R, lineHeight: 1.1, color: LT.black,
          letterSpacing: '-0.02em', whiteSpace: 'nowrap',
        }}>
          New<br />Collection
        </h2>

        {/* 카운터 + 화살표 (Figma 1347:2093) — 슬라이드가 필요할 때만 노출 */}
        {loop && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              aria-live="off"
              style={{
                fontSize: NC.counterSize, fontWeight: 300, lineHeight: 1.25,
                color: '#2E2E2E', whiteSpace: 'nowrap',
                // 자릿수가 바뀔 때 화살표가 흔들리지 않도록 등폭 숫자
                fontVariantNumeric: 'tabular-nums',
              }}>
              {counterNow}/{len}
            </span>
            <div style={{ display: 'flex', gap: NC.arrowGap, alignItems: 'center' }}>
              <button
                type="button" onClick={goPrev} aria-label="이전 도서"
                style={NC_ARROW_BTN}>
                <ArrowIcon dir="prev" />
              </button>
              <button
                type="button" onClick={goNext} aria-label="다음 도서"
                style={NC_ARROW_BTN}>
                <ArrowIcon dir="next" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 뷰포트 / 트랙 ───────────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div
          ref={trackRef}
          onTransitionEnd={handleTransitionEnd}
          style={{
            display: 'flex', gap, alignItems: 'flex-start',
            // translate3d = GPU 합성 레이어. left/margin 애니메이션은 쓰지 않는다.
            transform: `translate3d(${-idx * step}px, 0, 0)`,
            transition: anim && !reduceMotion
              ? `transform ${ANIM_MS}ms ${EASING}`
              : 'none',
            willChange: 'transform',
          }}>
          {rendered.map((b, i) => (
            <div
              key={`${b.id}-${i}`}
              // 복제본은 보조기기가 두 번 읽지 않도록 숨긴다
              aria-hidden={loop && i >= len ? true : undefined}
              onClick={() => onSelect?.(b)}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect && i < len ? 0 : -1}
              onKeyDown={e => {
                if (!onSelect) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b) }
              }}
              style={{
                display: 'flex', flexDirection: 'column', gap: NC.cardGap,
                width: cardW, flexShrink: 0,
                cursor: onSelect ? 'pointer' : 'default',
                outlineOffset: 2,
              }}>
              <SlideCover book={b} w={cardW} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                <span style={{
                  fontSize: isMobile ? 15 : NC.titleSize, fontWeight: FONT_R,
                  lineHeight: 1.25, color: LT.ink, wordBreak: 'keep-all',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {b.title}
                </span>
                <span style={{
                  fontSize: isMobile ? 12 : NC.authorSize, fontWeight: FONT_R,
                  lineHeight: 1.25, color: LT.metaDept,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {b.author ?? ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** 화살표 버튼 — 아이콘만 노출, 클릭 영역은 20×20 유지(Figma 규격) */
const NC_ARROW_BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: NC.arrow, height: NC.arrow, padding: 0,
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'inherit', flexShrink: 0,
}
