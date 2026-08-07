// @ts-nocheck
/**
 * ============================================================
 * /api/noshow-notice — 노쇼 공지 동적 SVG (Cloudflare Pages Function)
 * ============================================================
 *
 * ✅ [2026-08-05] 신규 — Figma 2802:55 "C&R SPACE 0805_노쇼공지" 1:1 구현
 *    ESG /api/roster 와 동일 패턴: Pages Function 이 Supabase RPC 를 조회해
 *    SVG 를 즉석에서 그린다. 그룹웨어에 <img src="https://space.cnrres.com/api/noshow-notice">
 *    로 삽입하면 열 때마다 당일 날짜·최신 노쇼 수치가 반영된다.
 *
 * 📌 데이터: get_noshow_notice_stats() RPC (20260742, anon 공개 집계 — PII 없음)
 * 📌 좌표계: Figma 원본 595 × (동적 높이). 월 행이 늘어나면(9월~) 높이가 함께 자란다.
 * 📌 폰트: SVG <img> 컨텍스트에선 외부 폰트 로드가 안 되므로 시스템 폰트 폴백
 *    (Pretendard → Malgun Gothic → sans-serif). Figma 의 Instrument Sans 부분도
 *    동일 폴백 체인을 쓴다 — 미세한 자간 차이는 허용 오차.
 * 📌 막대 폭: 해당 월 노쇼 건수 / 최대 월 노쇼 건수 비율 (전부 0 이면 최소폭).
 *    최소폭 52px — 월 라벨("4월")이 잘리지 않는 하한.
 * 📌 캐시 [2026-08-05 v2]: SVG 는 no-store — ESG /api/roster 와 동일하게 열 때마다
 *    항상 최신 (고지 확정). PNG(?format=png, Outlook 메일용)는 s-maxage=300 —
 *    래스터는 CPU 비용이 커서 엣지 캐시로 보호(메일 특성상 5분이면 충분).
 * 📌 PNG 버전 [2026-08-05 v2]: Outlook/Gmail 은 SVG 를 차단(2026-06-16 확정) →
 *    같은 데이터를 @resvg/resvg-wasm 으로 서버 래스터. Workers 엔 시스템 폰트가
 *    없어 Pretendard OTF(Regular/Medium/Bold)를 jsdelivr 에서 런타임 로드 후
 *    모듈 스코프에 캐시(콜드스타트당 1회, 총 ~4.7MB).
 *
 * ⚠ Cloudflare Pages 환경변수 필요 (대시보드 → Settings → Variables):
 *    SUPABASE_URL, SUPABASE_ANON_KEY  (VITE_* 는 빌드타임 전용이라 Functions 에선 안 보임)
 */

// ── PNG 래스터 (Outlook 메일용) ─────────────────────────────────────────────
//   wasm 은 패키지 서브패스 import — Cloudflare Pages 빌드가 .wasm 을 모듈로 번들.
//   (빌드 실패 시 폴백: index_bg.wasm 을 functions/api/ 로 복사해 상대경로 import)
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'

// ⭐서브셋 폰트 (public/fonts/noshow/ — 이 공지의 사용 글리프 226자만, 각 ~39KB)
//   풀 OTF(1.5MB×3)를 렌더마다 파싱하면 4초+ 로 Workers CPU 한도 초과 —
//   서브셋으로 파싱 비용을 근본 제거. ⚠공지 "문구"를 바꾸면 새 글자가 폰트에
//   없을 수 있음: scripts/subset-noshow-fonts.md 절차로 재서브셋 필요
//   (숫자·ASCII·단위는 전부 포함돼 있어 수치 변동은 영향 없음)
const FONT_PATHS = [
  '/fonts/noshow/Pretendard-Regular.subset.otf',
  '/fonts/noshow/Pretendard-Medium.subset.otf',
  '/fonts/noshow/Pretendard-Bold.subset.otf',
]
const PNG_SCALE = 1.5                  // 893px — 메일 리타디스플레이 대비, CPU 상한 절충

let _wasmReady = null                  // 모듈 스코프 1회 초기화
let _fontBuffers = null                // 모듈 스코프 폰트 캐시
async function ensureRaster(origin) {
  if (!_wasmReady) _wasmReady = initWasm(resvgWasm)
  await _wasmReady
  if (!_fontBuffers) {
    const bufs = await Promise.all(FONT_PATHS.map(async p => {
      const r = await fetch(origin + p)
      if (!r.ok) throw new Error(`font fetch 실패 [${r.status}] ${p}`)
      return new Uint8Array(await r.arrayBuffer())
    }))
    _fontBuffers = bufs
  }
  return _fontBuffers
}

export async function renderPng(svg, origin) {
  const fontBuffers = await ensureRaster(origin)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(W * PNG_SCALE) },
    font: { loadSystemFonts: false, fontBuffers, defaultFontFamily: 'Pretendard' },
    background: '#ffffff',
  })
  return resvg.render().asPng()
}

// ── Figma 2802:55 실측 토큰 ─────────────────────────────────────────────────
const W        = 595
const CX       = 17.5           // 본문 좌측 (595−560)/2
const CW       = 560            // 본문 폭
const FONT     = `Pretendard, 'Pretendard Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`
const C = {
  black:  '#111111',
  body:   '#3c3c3c',
  navy:   '#2f394a',
  gray:   '#4a4a4a',
  faint:  '#b9b9b9',
  unit:   '#96a0b3',
  orange: '#ff542e',
  barA:   '#ff5b2e',
  barB:   '#ff6b46',
  track:  '#f4f5fb',
  line1:  '#5f5f5f',            // 통계 3열 상단선
  line2:  '#3c3c3c',            // 섹션 상단선
}

const MONTH_EN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function nf(n) { return Number(n ?? 0).toLocaleString('en-US') }

/** lineTop + lineHeight 기준 baseline y (시각 중앙 정렬 근사) */
function base(top, lh, fs) { return top + lh / 2 + fs * 0.35 }

/** 대략적 렌더 폭 추정 — 한글·전각 1.0em, 그 외 0.55em (마크업 태그 제외) */
function estWidth(content, fs) {
  const plain = String(content).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, 'x')
  let u = 0
  for (const ch of plain) u += /[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1.0 : 0.55
  return u * fs
}

function text(x, y, size, fill, content, opt = {}) {
  const w = opt.weight ? ` font-weight="${opt.weight}"` : ''
  const a = opt.anchor ? ` text-anchor="${opt.anchor}"` : ''
  const ls = opt.ls ? ` letter-spacing="${opt.ls}"` : ''
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}"${w}${a}${ls}>${content}</text>`
}

// ── ⭐자동 줄바꿈 (넘침 방지의 근본 해법) ────────────────────────────────
//   textLength 압축은 볼드 tspan 혼합 줄에서 엔진별 글리프 붕괴(resvg 재현) →
//   폐기. 대신 서버가 보수적 폭 추정(한글 1.0em / 그 외 0.62em)으로 줄을
//   나눈다. 실제 뷰어 폰트(Pretendard·Malgun)가 추정보다 좁으므로 절대 안 잘림.
//   공백 우선 분절, 공백 없으면 글자 단위 분절.
function chW(ch, fs) {
  return (/[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1.0 : 0.62) * fs
}
/** segs: [{t, bold?}] → 줄 배열 [[{t,bold}]] */
function wrapSegs(segs, fs, maxW) {
  const lines = []
  let line = [], width = 0
  let cur = null                       // 현재 줄에 쌓는 중인 seg
  const flushSeg = () => { if (cur && cur.t) line.push(cur); cur = null }
  const flushLine = () => { flushSeg(); if (line.length) lines.push(line); line = []; width = 0 }
  for (const seg of segs) {
    cur = { t: '', bold: !!seg.bold }
    let lastSpace = -1                 // 현재 seg 내 마지막 공백 위치 (분절 우선점)
    for (const ch of seg.t) {
      const w = chW(ch, fs)
      if (width + w > maxW) {
        if (ch === ' ') { flushLine(); cur = { t: '', bold: !!seg.bold }; lastSpace = -1; continue }
        if (lastSpace >= 0) {          // 공백에서 되감아 분절
          const head = cur.t.slice(0, lastSpace), tail = cur.t.slice(lastSpace + 1)
          cur.t = head; flushLine()
          cur = { t: tail, bold: !!seg.bold }
          width = 0; for (const c of tail) width += chW(c, fs)
          lastSpace = -1
        } else { flushLine(); cur = { t: '', bold: !!seg.bold } }
      }
      if (ch === ' ') lastSpace = cur.t.length
      cur.t += ch
      width += w
    }
    flushSeg()
  }
  flushLine()
  return lines
}
/** 문단 렌더 — 줄바꿈 적용, 볼드 tspan 유지. 반환: 사용한 높이 */
function para(el, x, top, segs, fs, lh, fill, extra = {}) {
  const lines = wrapSegs(segs, fs, CW)
  let y = top
  for (const ln of lines) {
    const content = ln.map(sg =>
      sg.bold ? `<tspan font-weight="700">${esc(sg.t)}</tspan>` : esc(sg.t)
    ).join('')
    el.push(text(x, base(y, lh, fs), fs, fill, content, extra))
    y += lh
  }
  return y - top
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG 빌더 (순수 함수 — 노드 시뮬 대상)
// ═══════════════════════════════════════════════════════════════════════════
export function buildNoshowNoticeSvg(stats) {
  const asOf   = stats.as_of_kst                              // 'YYYY-MM-DD' (KST)
  const [Y, M, D] = asOf.split('-').map(Number)
  const dateEN = `${Y}.${MONTH_EN[M - 1]}.${String(D).padStart(2, '0')}`
  const asOfKo = `${M}월 ${D}일`
  const total  = Number(stats.total ?? 0)
  const noshow = Number(stats.noshow ?? 0)
  const rep3   = Number(stats.repeat3 ?? 0)
  const rate   = total > 0 ? Math.round(noshow / total * 1000) / 10 : 0
  const monthly = Array.isArray(stats.monthly) ? stats.monthly : []
  const maxNs  = Math.max(1, ...monthly.map(m => Number(m.noshow ?? 0)))

  const el = []
  el.push(`<defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="35.577%" stop-color="${C.barA}"/><stop offset="100%" stop-color="${C.barB}"/>
  </linearGradient></defs>`)

  // ── 헤더 (x=18, top=49) ──
  let y = 49
  el.push(text(18, base(y, 21, 14), 14, C.faint, esc(dateEN)))
  y += 21 + 4
  el.push(text(18, base(y, 26.4, 24), 24, C.black, 'C&amp;R SPACE'))
  y += 26.4 + 4
  el.push(text(18, base(y, 31.2, 24), 24, C.black, '운영공지'))
  y += 31.2 + 26

  // 타이틀 40px lh1.2
  const TL = 48
  el.push(text(18, base(y, TL, 40), 40, C.black, '회의실 예약'))
  y += TL
  el.push(text(18, base(y, TL, 40), 40, C.black,
    `<tspan fill="${C.orange}">노쇼(No-Show) 현황</tspan> 안내`))
  y += TL
  el.push(text(18, base(y, TL, 40), 40, C.black, '및 체크인(Check-in) 협조 요청'))
  y += TL

  // 타이틀 ↔ 본문 사이 여백 (원본 실측 근사)
  y += 160

  // ── B1. 노쇼 정의 (py14 / 제목 24 / gap16 / 본문 16 lh1.3 gap4) ──
  y += 14
  el.push(text(CX, base(y, 31.2, 24), 24, C.black, '노쇼(No-Show)?'))
  y += 31.2 + 16
  const defParas = [
    [{ t: '예약이 확정된 회의실에 ' }, { t: '예약 시간이 지나도록 체크인 하지 않은 예약', bold: true }, { t: '입니다.' }],
    [{ t: '예약 시작 후 ' }, { t: '10분이 경과할 때까지 체크인하지 않으면', bold: true }, { t: ' 시스템이 자동으로 노쇼 처리합니다.' }],
    [{ t: '사전에 취소한 예약은 노쇼가 아닙니다. ', bold: true }, { t: '일정이 바뀌면 언제든 취소해 주시면 됩니다.' }],
  ]
  for (const p of defParas) {
    y += para(el, CX, y, p, 16, 20.8, C.body) + 4
  }
  y += -4 + 14 + 60

  // ── B2. 구분선 + 섹션 헤딩 ──
  el.push(`<line x1="${CX}" y1="${y}" x2="${CX + CW}" y2="${y}" stroke="${C.black}" stroke-width="1"/>`)
  y += 1 + 14
  el.push(text(CX, base(y, 31.2, 24), 24, C.black, '4월 22일 서비스 정식 오픈 이후'))
  y += 31.2
  el.push(text(CX, base(y, 31.2, 24), 24, C.orange, '운영기간 내 노쇼 현황'))
  y += 31.2 + 60

  // ── B3-a. 월별 추이 ──
  y += 14
  el.push(text(CX, base(y, 20.8, 16), 16, C.navy, '월별 추이'))
  y += 20.8 + 4
  el.push(text(CX, base(y, 13, 10), 10, C.orange,
    '노쇼 판정 → 확정된 예약 중 시작 후 10분까지 체크인하지 않아, 시스템이 자동 취소 처리한 건'))
  y += 13 + 14

  const BAR_H = 30.222, BAR_GAP = 1, LABEL_W = 150, TRACK_W = CW - 16 - LABEL_W, BAR_MIN = 52
  for (const m of monthly) {
    const ns  = Number(m.noshow ?? 0)
    const fw  = Math.max(BAR_MIN, Math.round(TRACK_W * ns / maxNs))
    el.push(`<rect x="${CX}" y="${y}" width="${TRACK_W}" height="${BAR_H}" rx="1" fill="${C.track}"/>`)
    el.push(`<rect x="${CX}" y="${y}" width="${fw}" height="${BAR_H}" fill="url(#bar)"/>`)
    el.push(text(CX + 12, base(y, BAR_H, 14), 14, '#ffffff', `${m.month}월`, { ls: '0.14px' }))
    el.push(text(CX + CW, base(y, BAR_H, 11), 11, C.gray,
      `예약 ${nf(m.total)} 건 중 노쇼 ${nf(ns)} 건`, { anchor: 'end', ls: '0.11px' }))
    y += BAR_H + BAR_GAP
  }
  y += -BAR_GAP + 30

  // ── B3-b. 3열 통계 (전체예약 / 노쇼 / 3회 이상 노쇼) ──
  const COL_GAP = 16, COL_W = (CW - COL_GAP * 2) / 3
  const cols = [
    { label: '전체예약',      sub: `2026년 4월 22일 ~ ${asOfKo}`, value: nf(total),  unit: '건' },
    { label: '노쇼',          sub: `2026년 4월 ~ ${asOfKo}`,      value: nf(noshow), unit: '건' },
    { label: '3회 이상 노쇼', sub: `2026년 4월 ~ ${asOfKo}`,      value: nf(rep3),   unit: '명' },
  ]
  const colTop = y
  let colBottom = y
  cols.forEach((c, i) => {
    const x = CX + i * (COL_W + COL_GAP)
    let cy = colTop
    el.push(`<line x1="${x}" y1="${cy}" x2="${x + COL_W}" y2="${cy}" stroke="${C.line1}" stroke-width="1"/>`)
    cy += 16
    el.push(text(x, base(cy, 20.8, 16), 16, C.navy, esc(c.label)))
    cy += 20.8 + 4
    el.push(text(x, base(cy, 10.4, 8), 8, C.faint, esc(c.sub)))
    cy += 10.4 + 16 + 15
    el.push(text(x, base(cy, 39, 30), 30, C.body,
      `${esc(c.value)}<tspan dx="4" font-size="24" fill="${C.unit}">${esc(c.unit)}</tspan>`))
    cy += 39
    colBottom = Math.max(colBottom, cy)
  })
  y = colBottom + 30

  // ── B3-c. 노쇼율 ──
  y += 14
  el.push(text(CX, base(y, 31.2, 24), 24, C.orange, '노쇼율'))
  y += 31.2 + 4
  el.push(text(CX, base(y, 20.8, 16), 16, C.orange, '전체 예약 대비 노쇼 비율'))
  y += 20.8 + 4
  el.push(text(CX, base(y, 78, 60), 60, C.orange,
    `${rate.toFixed(1)}<tspan dx="8">%</tspan>`))
  y += 78 + 14 + 60

  // ── B4~B6. 안내 섹션 3개 (border-t #3c3c3c / pt14 pb24) ──
  const sections = [
    { h: '회의실 도착하면 체크인', body: [
      { t: '회의실에 도착하시면 체크인을 꼭 눌러 주세요. 시작 5분 전부터 가능하고, 시작 후 10분 이내에 하지 않으면 자동으로 노쇼 처리됩니다.' },
    ]},
    { h: '일정이 바뀌면 사전 취소', body: [
      { t: '회의가 취소·변경되면 시작 전에 예약을 취소해 주세요. 사전 취소는 불이익이 없고, 비워진 시간은 즉시 다른 직원이 예약할 수 있습니다.' },
    ]},
    { h: '노쇼로 다른 팀의 회의 기회를 상실시키지 마세요', body: [
      { t: '임직원들은 9개 회의실을 함께 씁니다. ' }, { t: '노쇼 1건이 곧 다른 팀의 회의 1건입니다.', bold: true },
    ]},
  ]
  for (const s of sections) {
    el.push(`<line x1="${CX}" y1="${y}" x2="${CX + CW}" y2="${y}" stroke="${C.line2}" stroke-width="1"/>`)
    y += 14
    el.push(text(CX, base(y, 31.2, 24), 24, C.black, esc(s.h), { weight: 500 }))
    y += 31.2 + 16
    y += para(el, CX, y, s.body, 16, 24, C.body)
    y += 24 + 36                       // pb24 + 블록 간 여백(gap60−pt14−border 근사)
  }

  // ── B7. 푸터 문단 + 브랜드 ──
  y += 14 - 36
  y += para(el, CX, y, [
    { t: '노쇼 현황은 관리자 대시보드를 통해 상시 모니터링되며, 반복 노쇼가 지속될 경우 개별 안내 등 추가 조치 중 입니다.' },
  ], 16, 24, C.body)
  y += para(el, CX, y, [
    { t: '작은 습관 하나로 모두가 회의실을 더 편하게 쓸 수 있습니다.' },
  ], 16, 24, C.body)
  y += para(el, CX, y, [
    { t: '회의실 사용시 체크인과 사전 취소에 협조 부탁드립니다. 감사합니다.' },
  ], 16, 24, C.body)
  y += 100
  el.push(text(CX, base(y, 24, 16), 16, C.black, 'C&amp;R SPACE'))
  y += 24
  el.push(text(CX, base(y, 18, 12), 12, C.black, 'Management Support'))
  y += 18 + 49                          // 하단 여백 = 상단 여백 대칭

  const H = Math.ceil(y)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${el.join('\n')}
</svg>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Pages Function 핸들러
// ═══════════════════════════════════════════════════════════════════════════
export async function onRequestGet(context) {
  const env = context.env ?? {}
  // ← [2026-08-07 핫픽스] ESG /api/roster 와 동일 이슈·동일 해법 — CF Pages 대시보드엔
  //   빌드용 VITE_* 가 이미 있고 Functions 도 그대로 읽을 수 있으므로 폴백 체인으로 수용.
  //   URL 은 공개 고정값이라 최종 하드코딩 폴백까지 둔다 (anon key 는 env 전용 — 회전 대비).
  const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    ?? 'https://jjzcqpbwkkujttwxksvy.supabase.co'
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!SUPABASE_ANON_KEY) {
    return new Response(
      'SUPABASE_ANON_KEY (또는 VITE_SUPABASE_ANON_KEY) 환경변수 미설정 — Pages Production 환경에 설정 후 재배포 필요',
      { status: 500 })
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_noshow_notice_stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: '{}',
    })
    if (!res.ok) {
      return new Response(`stats RPC 실패 [${res.status}]`, { status: 502 })
    }
    const stats = await res.json()
    const svg = buildNoshowNoticeSvg(stats)

    // ── Outlook 메일용 PNG (?format=png) ──
    const reqUrl = new URL(context.request.url)
    if (reqUrl.searchParams.get('format') === 'png') {
      const png = await renderPng(svg, reqUrl.origin)
      return new Response(png, {
        headers: {
          'Content-Type':  'image/png',
          'Cache-Control': 'public, s-maxage=300, max-age=120',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // ── 그룹웨어용 SVG — 열 때마다 최신 (roster 와 동일, 고지 확정) ──
    return new Response(svg, {
      headers: {
        'Content-Type':  'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return new Response(`렌더 실패: ${e?.message ?? String(e)}`, { status: 500 })
  }
}
