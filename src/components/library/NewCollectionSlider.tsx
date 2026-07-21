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
// 2. 아이콘 — Figma 1366:2286 arrow_back_ios_new (20×20)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ← [2026-07-21] 원본 SVG 적용 — 이전의 stroke 재현본을 교체했다.
 *
 *   원본은 fill path 이고 색은 #1C1B1F (Material 기본). stroke 로 흉내 낸
 *   이전 버전은 굵기·꺾임 각도가 달라 Figma 와 눈으로 구분됐다.
 *
 *   원본에 있던 <mask> 는 20×20 전체를 덮는 사각형이라 시각적 효과가 없다
 *   (클리핑되는 영역이 없음). DOM 노드만 늘어나므로 제거했다.
 *
 *   next 는 별도 에셋 대신 scaleX(-1) 로 좌우 반전한다. 같은 도형이므로
 *   path 를 두 벌 두면 한쪽만 수정되는 사고가 난다.
 */
function ArrowIcon({ dir, size = NC.arrow, color = '#1C1B1F' }: {
  dir: 'prev' | 'next'; size?: number; color?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <path
        d="M13.3333 17.5832L5.75 9.99984L13.3333 2.4165L14.0417 3.12484L7.16667 9.99984L14.0417 16.8748L13.3333 17.5832Z"
        fill={color}
        transform={dir === 'next' ? 'translate(20, 0) scale(-1, 1)' : undefined}
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

/**
 * 요소의 실제 폭(px). 슬라이드가 필요한지(항목이 넘치는지) 판단하는 데 쓴다.
 *
 * ← [2026-07-21] 근본 수정 — RefObject + useEffect([ref]) → **callback ref**
 *
 *   [증상] 자동 슬라이드 미작동 / 카운터·화살표 미표시 (셋 다 loop === false)
 *
 *   [원인] 이전 구현은 useEffect(deps: [ref]) 라 **마운트 시 1회만** 실행됐다.
 *          그런데 LibraryPage 의 load() 는 비동기라 첫 렌더에서 books = [] 이고,
 *          이 컴포넌트는 len === 0 이면 return null 한다 → 뷰포트 div 가 DOM 에
 *          없다 → effect 가 ref.current === null 로 즉시 반환하고
 *          **ResizeObserver 가 끝내 부착되지 않는다.**
 *          이후 도서가 도착해 카드가 렌더돼도 effect 는 다시 돌지 않으므로
 *          viewW 가 영원히 0 → loop = (viewW > 0 && ...) = false 로 고착.
 *          카운터/화살표는 {loop && ...}, 자동 이동은 autoOn = loop && ... 이라
 *          세 증상이 한 원인에서 나왔다.
 *
 *   [해법] 측정 시점을 "요소가 DOM 에 붙는 순간"에 결속한다.
 *          callback ref 는 요소가 부착·해제될 때마다 React 가 호출하므로
 *          조건부 렌더·비동기 데이터 도착 순서와 무관하게 항상 정확히 실행된다.
 *          (len === 0 일 때 null 반환을 없애는 식의 우회는 원인을 안 없앤다 —
 *           나중에 다른 조건부 렌더가 붙으면 같은 버그가 재발한다)
 */
function useMeasuredWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = useState(0)
  const roRef = useRef<ResizeObserver | null>(null)

  const setRef = useCallback((el: T | null) => {
    // 이전 요소에 붙어 있던 관찰자는 반드시 끊는다(요소 교체 시 누수 방지)
    roRef.current?.disconnect()
    roRef.current = null

    if (!el) return   // 언마운트 — 폭은 마지막 값을 유지한다(재부착 시 즉시 갱신됨)

    setW(el.clientWidth)

    // ResizeObserver 는 창 크기뿐 아니라 사이드바 개폐 등 레이아웃 변화도 잡는다.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setW(e.contentRect.width)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // 컴포넌트가 사라질 때의 최종 정리
  useEffect(() => () => { roRef.current?.disconnect() }, [])

  return [setRef, w]
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

  const trackRef = useRef<HTMLDivElement | null>(null)
  //  ← [2026-07-21] callback ref — 뷰포트 div 가 DOM 에 붙는 즉시 폭을 잰다.
  //     (len === 0 인 첫 렌더에서 null 을 반환해도 이후 부착 시점에 정상 측정)
  const [setViewportRef, viewW] = useMeasuredWidth<HTMLDivElement>()

  const reduceMotion = usePrefersReducedMotion()
  const pageVisible  = usePageVisible()
  const [hovered, setHovered] = useState(false)

  const [idx,  setIdx]  = useState(0)
  const [anim, setAnim] = useState(true)

  // ── 드래그(grab) 상태 ─────────────────────────────────────────────────────
  //   [2026-07-21] 마우스·터치·펜을 Pointer Events 하나로 처리한다.
  //   mouse/touch 핸들러를 따로 달면 하이브리드 기기(터치 노트북)에서 두 번
  //   발생해 이동량이 두 배가 된다.
  const [dragPx,   setDragPx]   = useState(0)   // 손가락을 따라가는 실시간 오프셋
  const [dragging, setDragging] = useState(false)
  //   커밋 판정용 원본값 — 렌더와 무관하므로 ref 에 둔다(리렌더 유발 방지)
  const dragRef = useRef<{ id: number; x0: number; y0: number; axis: 'none' | 'x' | 'y' } | null>(null)
  //   드래그로 끝난 제스처인지 — 카드 onClick(상세 모달)이 같이 터지는 것을 막는다
  const draggedRef = useRef(false)

  // ── 슬라이드가 필요한가 ───────────────────────────────────────────────────
  //   뷰포트에 전부 들어가면 움직일 이유가 없다(빈 공간이 흘러가는 것처럼 보인다).
  //   viewW 는 초기 렌더에서 0 이므로, 측정 전에는 이동하지 않는다.
  const loop = viewW > 0 && len * step - gap > viewW + 1

  // 자동 이동 활성 조건
  const autoOn = loop && !hovered && pageVisible && !reduceMotion && anim && !dragging

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
    // ← [2026-07-21] setIdx(0) → 모듈러. 화살표는 항상 1칸씩이라 idx 가 정확히
    //   len 일 때만 도달했지만, 드래그는 한 번에 여러 칸을 넘길 수 있어
    //   len+2 같은 값이 나온다. 그때 0 으로 되돌리면 위치가 튄다.
    //   트랙이 2벌이므로 i 와 i%len 은 화면상 같은 카드다.
    setIdx(i => i % len)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true)))
  }

  // ── 드래그(grab) 핸들러 ───────────────────────────────────────────────────
  //
  //   커밋 규칙: 이동 거리가 임계값을 넘으면 넘긴 칸 수만큼 이동하고,
  //   못 넘기면 제자리로 되돌린다(스냅백).
  //
  //   임계값을 카드 폭의 1/3 로 두되 60px 을 상한으로 둔다. 데스크톱 카드는
  //   폭이 커서 1/3 만 해도 100px 이 넘어 "끌었는데 안 넘어간다"는 느낌이 든다.
  const DRAG_THRESHOLD = Math.min(step / 3, 60)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!loop || !anim) return
    // 마우스는 주 버튼만 (우클릭·가운데클릭 제외)
    if (e.pointerType === 'mouse' && e.button !== 0) return

    // idx 가 0 이면 왼쪽에 카드가 없어 오른쪽으로 끌 때 빈 여백이 드러난다.
    // 트랙이 2벌이므로 len 위치는 0 위치와 화면상 완전히 동일하다.
    // 시작 시점에 무애니메이션으로 옮겨두면 뒤로 끌기가 자연스럽게 성립한다.
    if (idx === 0) {
      setAnim(false)
      setIdx(len)
      requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true)))
    }

    dragRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: 'none' }
    draggedRef.current = false
    setDragging(true)
    setDragPx(0)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return

    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0

    // 축 잠금 — 세로로 시작한 제스처는 페이지 스크롤로 넘긴다.
    //   touch-action: pan-y 로 브라우저가 세로 스크롤을 처리하지만,
    //   대각선 제스처까지 가로로 가로채면 모바일에서 스크롤이 뻑뻑해진다.
    if (d.axis === 'none') {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return   // 아직 방향 미확정
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'y') { endDrag(e, true); return }
    }

    if (Math.abs(dx) > 4) draggedRef.current = true
    setDragPx(dx)
  }

  /** 제스처 종료 — cancel=true 면 이동 없이 되돌린다 */
  function endDrag(e: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    dragRef.current = null

    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 이미 해제됨 */ }

    const dx = cancel ? 0 : (e.clientX - d.x0)
    let n = 0
    if (dx <= -DRAG_THRESHOLD)      n =  Math.max(1, Math.round(-dx / step))   // 왼쪽으로 끌기 = 다음
    else if (dx >= DRAG_THRESHOLD)  n = -Math.max(1, Math.round( dx / step))   // 오른쪽으로 끌기 = 이전

    // 한 제스처가 전체 목록을 넘지 않게 막는다(트랙은 2벌뿐이라 넘으면 빈칸).
    if (n >  len) n =  len
    if (n < -len) n = -len

    // dragging=false / dragPx=0 / idx 변경이 한 배치로 커밋된다.
    // 이때 transition 이 다시 켜지므로 브라우저가 "현재 그려진 위치(드래그된
    // 상태)"에서 목적지까지 애니메이션한다 — 별도 보간 코드가 필요 없다.
    setDragging(false)
    setDragPx(0)
    if (n !== 0) setIdx(i => Math.max(0, i + n))
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
        ref={setViewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => endDrag(e)}
        onPointerCancel={e => endDrag(e, true)}
        // 드래그로 끝난 제스처는 카드 클릭(상세 모달)으로 이어지면 안 된다.
        // 캡처 단계에서 한 번만 삼키고 플래그를 내린다.
        onClickCapture={e => {
          if (!draggedRef.current) return
          e.preventDefault(); e.stopPropagation()
          draggedRef.current = false
        }}
        style={{
          flex: 1, minWidth: 0, overflow: 'hidden',
          // 세로 스크롤은 브라우저에 맡기고 가로만 우리가 처리한다.
          // 'none' 으로 두면 모바일에서 슬라이더 위를 지나갈 때 페이지가 안 움직인다.
          touchAction: loop ? 'pan-y' : 'auto',
          cursor: loop ? (dragging ? 'grabbing' : 'grab') : 'default',
          // 끌 때 카드 제목이 파랗게 선택되는 것을 막는다
          userSelect: dragging ? 'none' : undefined,
        }}>
        <div
          ref={trackRef}
          onTransitionEnd={handleTransitionEnd}
          style={{
            display: 'flex', gap, alignItems: 'flex-start',
            // translate3d = GPU 합성 레이어. left/margin 애니메이션은 쓰지 않는다.
            // ← [2026-07-21] 드래그 오프셋(dragPx)을 더해 손가락을 그대로 따라간다.
            transform: `translate3d(${-idx * step + dragPx}px, 0, 0)`,
            transition: anim && !reduceMotion && !dragging
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
