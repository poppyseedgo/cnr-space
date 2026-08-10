// @ts-nocheck
/**
 * ============================================================
 * /api/noshow-notice — 노쇼 공지 동적 SVG/PNG (Cloudflare Pages Function)
 * ============================================================
 *
 * ✅ [2026-08-05] 신규 — Figma 2802:55 "C&R SPACE 0805_노쇼공지" 1:1 구현
 * ✅ [2026-08-05 v2] SVG no-store 실시간 / ?format=png (Outlook, resvg-wasm+서브셋폰트)
 * ✅ [2026-08-07 v2.1] env 폴백(VITE_*) / wasm 상대경로 / package-lock 짝 전달
 * ✅ [2026-08-07 v3] 고지 피드백 반영 — 레이아웃·폰트 재작성
 *    ① 줄바꿈을 피그마와 동일하게: 노드에서 nowrap 인 줄(정의 3문장·월별 캡션·
 *       스탯·바 라벨 등)은 줄바꿈 금지. 섹션 본문·푸터 문단만 칼럼(560) 줄바꿈.
 *    ② 폭 추정 휴리스틱 폐기 → **실제 폰트 파일에서 추출한 글자별 폭 테이블**
 *       (METRICS, advance/upm)로 픽셀 정확 측정. 줄바꿈 위치가 디자인과 일치하고
 *       nowrap 줄의 안전(≤ 캔버스 595) 여부를 서버가 확정할 수 있다.
 *    ③ 영문+숫자 = Instrument Sans (고지 확정): 텍스트를 한/영 런으로 분해해
 *       영문·숫자 런에만 Instrument 체인 적용. PNG 렌더용 Instrument 서브셋
 *       (wght 400 인스턴스, ASCII 95자, 20KB) 추가.
 *
 * 📌 데이터: get_noshow_notice_stats() RPC (20260742, anon 공개 집계 — PII 없음)
 * 📌 사용: 그룹웨어 <img src=".../api/noshow-notice"> (no-store 실시간)
 *          Outlook 메일 <img src=".../api/noshow-notice?format=png"> (s-maxage=300)
 * 📌 폰트: SVG(그룹웨어)는 뷰어 시스템 폰트(Instrument 없으면 Pretendard 폴백),
 *          PNG(메일)는 서브셋 4종을 임베드해 렌더 — 픽셀 확정.
 * 📌 문구 수정 시: 새 글자가 서브셋에 없을 수 있음 → scripts/subset-noshow-fonts.md
 *    로 재서브셋 + 아래 METRICS 재추출 필요 (숫자 변동은 무관)
 */

// ── PNG 래스터 (Outlook 메일용) ─────────────────────────────────────────────
//   wasm 은 반드시 모듈 import — Workers 는 바이트로부터의 wasm 컴파일을 차단.
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from './resvg_bg.wasm'

// ⭐서브셋 폰트 (public/fonts/noshow/) — 풀 OTF(1.5MB×3)는 렌더당 파싱 4초+
const FONT_PATHS = [
  '/fonts/noshow/Pretendard-Regular.subset.otf',
  '/fonts/noshow/Pretendard-Medium.subset.otf',
  '/fonts/noshow/Pretendard-Bold.subset.otf',
  '/fonts/noshow/InstrumentSans-Regular.subset.ttf',
]
const PNG_SCALE = 1.5                  // 893px — 메일 레티나 대비, CPU 절충

let _wasmReady = null
let _fontBuffers = null
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

// ── ⭐폰트 임베드 (그룹웨어 SVG 용, v4) ─────────────────────────────────────
//   <img> SVG 는 외부 리소스 로드가 차단되지만 data: URI 는 네트워크가 없어 허용
//   (ESG roster 배경사진 base64 인라인과 동일 원리). 서브셋 4종(~138KB)을
//   @font-face data URI 로 넣으면 뷰어 PC 에 폰트가 없어도 항상 동일하게 렌더.
//   PNG 경로에는 넣지 않는다 — resvg 는 fontBuffers 를 쓰므로 불필요·미지원.
function u8ToBase64(u8) {
  let bin = ''
  const CHUNK = 0x8000                 // fromCharCode 인자 한도 회피
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

let _fontCss = null                    // 모듈 스코프 캐시 — 요청마다 재인코딩 방지
export async function embedFontCss(origin) {
  if (_fontCss) return _fontCss
  const bufs = await ensureRaster(origin)          // FONT_PATHS 순서와 동일한 버퍼 재사용
  const spec = [
    { fam: 'Pretendard',      weight: 400, fmt: 'opentype', mime: 'font/otf' },
    { fam: 'Pretendard',      weight: 500, fmt: 'opentype', mime: 'font/otf' },
    { fam: 'Pretendard',      weight: 700, fmt: 'opentype', mime: 'font/otf' },
    { fam: 'Instrument Sans', weight: 400, fmt: 'truetype', mime: 'font/ttf' },
  ]
  _fontCss = spec.map((f, i) =>
    `@font-face{font-family:'${f.fam}';font-weight:${f.weight};font-style:normal;` +
    `src:url(data:${f.mime};base64,${u8ToBase64(bufs[i])}) format('${f.fmt}');}`
  ).join('\n')
  return _fontCss
}

// ── Figma 2802:55 실측 토큰 ─────────────────────────────────────────────────
const W        = 595
const CX       = 17.5           // 본문 좌측 (595−560)/2
const CW       = 560            // 본문 폭
const MAXX     = W - CX         // nowrap 허용 한계 577.5 — 피그마도 정의부가 칼럼을 넘음
const FONT_KR  = `Pretendard, 'Pretendard Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`
const FONT_EN  = `'Instrument Sans', ${FONT_KR}`   // 영문+숫자 (고지 확정)
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
  line1:  '#5f5f5f',
  line2:  '#3c3c3c',
}
const MONTH_EN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

// ── 글자 폭 테이블 (advance/em) — 서브셋 폰트에서 추출, 재추출 절차는 scripts/ ──
//   kr=Pretendard Regular, krb=Pretendard Bold, en=Instrument Sans 400
const METRICS = {"kr":{" ":0.251,"%":0.8623,"&":0.6094,"(":0.3408,")":0.3408,",":0.2578,"-":0.4326,".":0.2539,"/":0.334,"0":0.5957,"1":0.4385,"2":0.5869,"3":0.6172,"4":0.624,"5":0.5967,"6":0.6133,"7":0.5518,"8":0.6064,"9":0.6133,":":0.2539,"?":0.4795,"A":0.6455,"B":0.6191,"C":0.6934,"D":0.6855,"E":0.5674,"F":0.5566,"G":0.709,"H":0.7061,"I":0.2441,"J":0.5156,"K":0.6211,"L":0.5332,"M":0.8525,"N":0.7178,"O":0.7266,"P":0.6045,"Q":0.7266,"R":0.6084,"S":0.6074,"T":0.6113,"U":0.707,"V":0.6455,"W":0.915,"X":0.6123,"Y":0.6338,"Z":0.5947,"a":0.5352,"b":0.5908,"c":0.5293,"d":0.5908,"e":0.5527,"f":0.3369,"g":0.5791,"h":0.5625,"i":0.2178,"j":0.2178,"k":0.5166,"l":0.2178,"m":0.834,"n":0.5566,"o":0.5674,"p":0.5791,"q":0.5791,"r":0.3496,"s":0.4961,"t":0.3398,"u":0.5527,"v":0.5293,"w":0.7773,"x":0.5127,"y":0.5293,"z":0.5127,"~":0.627,"·":0.2539,"→":0.9131,"가":0.8643,"간":0.8643,"감":0.8643,"개":0.8643,"건":0.8643,"게":0.8643,"경":0.8643,"고":0.8643,"곧":0.8643,"공":0.8643,"과":0.8643,"관":0.8643,"기":0.8643,"까":0.8643,"께":0.8643,"꼭":0.8643,"뀌":0.8643,"나":0.8643,"내":0.8643,"년":0.8643,"노":0.8643,"눌":0.8643,"는":0.8643,"능":0.8643,"니":0.8643,"닙":0.8643,"다":0.8643,"대":0.8643,"더":0.8643,"도":0.8643,"동":0.8643,"되":0.8643,"된":0.8643,"될":0.8643,"됩":0.8643,"두":0.8643,"드":0.8643,"든":0.8643,"들":0.8643,"등":0.8643,"때":0.8643,"러":0.8643,"로":0.8643,"록":0.8643,"른":0.8643,"를":0.8643,"리":0.8643,"립":0.8643,"링":0.8643,"마":0.8643,"며":0.8643,"면":0.8643,"명":0.8643,"모":0.8643,"및":0.8643,"바":0.8643,"반":0.8643,"변":0.8643,"별":0.8643,"보":0.8643,"복":0.8643,"부":0.8643,"분":0.8643,"불":0.8643,"비":0.8643,"사":0.8643,"상":0.8643,"서":0.8643,"세":0.8643,"소":0.8643,"속":0.8643,"쇼":0.8643,"수":0.8643,"스":0.8643,"습":0.8643,"시":0.8643,"식":0.8643,"실":0.8643,"쓸":0.8643,"씁":0.8643,"아":0.8643,"안":0.8643,"않":0.8643,"약":0.8643,"언":0.8643,"없":0.8643,"에":0.8643,"영":0.8643,"예":0.8643,"오":0.8643,"요":0.8643,"용":0.8643,"우":0.8643,"운":0.8643,"워":0.8643,"원":0.8643,"월":0.8643,"율":0.8643,"으":0.8643,"은":0.8643,"을":0.8643,"의":0.8643,"이":0.8643,"익":0.8643,"인":0.8643,"일":0.8643,"임":0.8643,"입":0.8643,"있":0.8643,"자":0.8643,"작":0.8643,"전":0.8643,"정":0.8643,"제":0.8643,"조":0.8643,"주":0.8643,"중":0.8643,"즉":0.8643,"지":0.8643,"직":0.8643,"진":0.8643,"착":0.8643,"처":0.8643,"청":0.8643,"체":0.8643,"추":0.8643,"취":0.8643,"치":0.8643,"크":0.8643,"키":0.8643,"탁":0.8643,"터":0.8643,"템":0.8643,"통":0.8643,"팀":0.8643,"판":0.8643,"편":0.8643,"픈":0.8643,"하":0.8643,"한":0.8643,"할":0.8643,"함":0.8643,"합":0.8643,"해":0.8643,"현":0.8643,"협":0.8643,"확":0.8643,"황":0.8643,"회":0.8643,"후":0.8643},"krb":{" ":0.2305,"%":0.96,"&":0.6484,"(":0.3896,")":0.3896,",":0.2871,"-":0.4492,".":0.2822,"/":0.3711,"0":0.6602,"1":0.4688,"2":0.6104,"3":0.6387,"4":0.6572,"5":0.627,"6":0.6426,"7":0.5752,"8":0.6436,"9":0.6426,":":0.2822,"?":0.5381,"A":0.7178,"B":0.6367,"C":0.7236,"D":0.7012,"E":0.5889,"F":0.5625,"G":0.7324,"H":0.7197,"I":0.2656,"J":0.5469,"K":0.6631,"L":0.5459,"M":0.8828,"N":0.709,"O":0.7529,"P":0.623,"Q":0.7539,"R":0.6318,"S":0.6299,"T":0.6426,"U":0.7041,"V":0.7178,"W":0.999,"X":0.6855,"Y":0.6953,"Z":0.6406,"a":0.5576,"b":0.6113,"c":0.5635,"d":0.6113,"e":0.5742,"f":0.3672,"g":0.6084,"h":0.5996,"i":0.2568,"j":0.2568,"k":0.5576,"l":0.2568,"m":0.8789,"n":0.5977,"o":0.5898,"p":0.6084,"q":0.6084,"r":0.3896,"s":0.5391,"t":0.3701,"u":0.5967,"v":0.5625,"w":0.8193,"x":0.5508,"y":0.5625,"z":0.5488,"~":0.6533,"·":0.2822,"→":0.9219,"가":0.8643,"간":0.8643,"감":0.8643,"개":0.8643,"건":0.8643,"게":0.8643,"경":0.8643,"고":0.8643,"곧":0.8643,"공":0.8643,"과":0.8643,"관":0.8643,"기":0.8643,"까":0.8643,"께":0.8643,"꼭":0.8643,"뀌":0.8643,"나":0.8643,"내":0.8643,"년":0.8643,"노":0.8643,"눌":0.8643,"는":0.8643,"능":0.8643,"니":0.8643,"닙":0.8643,"다":0.8643,"대":0.8643,"더":0.8643,"도":0.8643,"동":0.8643,"되":0.8643,"된":0.8643,"될":0.8643,"됩":0.8643,"두":0.8643,"드":0.8643,"든":0.8643,"들":0.8643,"등":0.8643,"때":0.8643,"러":0.8643,"로":0.8643,"록":0.8643,"른":0.8643,"를":0.8643,"리":0.8643,"립":0.8643,"링":0.8643,"마":0.8643,"며":0.8643,"면":0.8643,"명":0.8643,"모":0.8643,"및":0.8643,"바":0.8643,"반":0.8643,"변":0.8643,"별":0.8643,"보":0.8643,"복":0.8643,"부":0.8643,"분":0.8643,"불":0.8643,"비":0.8643,"사":0.8643,"상":0.8643,"서":0.8643,"세":0.8643,"소":0.8643,"속":0.8643,"쇼":0.8643,"수":0.8643,"스":0.8643,"습":0.8643,"시":0.8643,"식":0.8643,"실":0.8643,"쓸":0.8643,"씁":0.8643,"아":0.8643,"안":0.8643,"않":0.8643,"약":0.8643,"언":0.8643,"없":0.8643,"에":0.8643,"영":0.8643,"예":0.8643,"오":0.8643,"요":0.8643,"용":0.8643,"우":0.8643,"운":0.8643,"워":0.8643,"원":0.8643,"월":0.8643,"율":0.8643,"으":0.8643,"은":0.8643,"을":0.8643,"의":0.8643,"이":0.8643,"익":0.8643,"인":0.8643,"일":0.8643,"임":0.8643,"입":0.8643,"있":0.8643,"자":0.8643,"작":0.8643,"전":0.8643,"정":0.8643,"제":0.8643,"조":0.8643,"주":0.8643,"중":0.8643,"즉":0.8643,"지":0.8643,"직":0.8643,"진":0.8643,"착":0.8643,"처":0.8643,"청":0.8643,"체":0.8643,"추":0.8643,"취":0.8643,"치":0.8643,"크":0.8643,"키":0.8643,"탁":0.8643,"터":0.8643,"템":0.8643,"통":0.8643,"팀":0.8643,"판":0.8643,"편":0.8643,"픈":0.8643,"하":0.8643,"한":0.8643,"할":0.8643,"함":0.8643,"합":0.8643,"해":0.8643,"현":0.8643,"협":0.8643,"확":0.8643,"황":0.8643,"회":0.8643,"후":0.8643},"en":{" ":0.2,"!":0.273,"\"":0.384,"#":0.716,"$":0.608,"%":0.786,"&":0.755,"'":0.232,"(":0.406,")":0.406,"*":0.408,"+":0.531,",":0.255,"-":0.506,".":0.255,"/":0.443,"0":0.666,"1":0.391,"2":0.545,"3":0.574,"4":0.6,"5":0.574,"6":0.599,"7":0.532,"8":0.582,"9":0.61,":":0.255,";":0.255,"<":0.531,"=":0.531,">":0.531,"?":0.567,"@":0.853,"A":0.728,"B":0.636,"C":0.741,"D":0.752,"E":0.638,"F":0.602,"G":0.765,"H":0.736,"I":0.254,"J":0.455,"K":0.692,"L":0.588,"M":0.906,"N":0.736,"O":0.786,"P":0.656,"Q":0.787,"R":0.656,"S":0.608,"T":0.648,"U":0.712,"V":0.728,"W":1.089,"X":0.688,"Y":0.676,"Z":0.623,"[":0.406,"\\":0.443,"]":0.406,"^":0.531,"_":0.426,"`":0.354,"a":0.533,"b":0.606,"c":0.533,"d":0.606,"e":0.564,"f":0.354,"g":0.606,"h":0.599,"i":0.24,"j":0.24,"k":0.535,"l":0.24,"m":0.922,"n":0.599,"o":0.584,"p":0.606,"q":0.606,"r":0.375,"s":0.473,"t":0.377,"u":0.589,"v":0.523,"w":0.767,"x":0.551,"y":0.523,"z":0.496,"{":0.406,"|":0.242,"}":0.406,"~":0.531}}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function nf(n) { return Number(n ?? 0).toLocaleString('en-US') }

// ── 텍스트 엔진: 한/영 런 분해 · 실측 폭 · 줄바꿈 ──────────────────────────
const isEnCh = ch => ch >= '\x21' && ch <= '\x7e'   // 인쇄 ASCII (공백 제외)

/** 폭(em) — 영문 런은 Instrument, 그 외 Pretendard(굵기별) 테이블 */
function adv(ch, en, bold) {
  if (en) { const v = METRICS.en[ch]; if (v !== undefined) return v }
  const t = bold ? METRICS.krb : METRICS.kr
  const v = t[ch]
  if (v !== undefined) return v
  return /[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1.0 : 0.62
}

/** 문자 스트림 [{ch,bold,en}] — 공백은 앞 런의 소속을 따른다 */
function toChars(segs) {
  const out = []
  for (const seg of segs) {
    let prevEn = false
    for (const ch of seg.t) {
      const en = ch === ' ' ? prevEn : isEnCh(ch)
      out.push({ ch, bold: !!seg.bold, en })
      if (ch !== ' ') prevEn = isEnCh(ch)
    }
  }
  return out
}

function measure(segs, fs) {
  return toChars(segs).reduce((w, c) => w + adv(c.ch, c.en, c.bold) * fs, 0)
}

/** 문자 스트림 → tspan 마크업 (bold·영문 런 경계마다 tspan 전환) */
function charsToMarkup(chars) {
  let out = '', buf = '', cur = null
  const flush = () => {
    if (!buf) return
    let piece = esc(buf)
    if (cur.en)  piece = `<tspan font-family="${FONT_EN}">${piece}</tspan>`
    if (cur.bold) piece = `<tspan font-weight="700">${piece}</tspan>`
    out += piece; buf = ''
  }
  for (const c of chars) {
    if (!cur || c.bold !== cur.bold || c.en !== cur.en) { flush(); cur = { bold: c.bold, en: c.en } }
    buf += c.ch
  }
  flush()
  return out
}

function rich(segs) { return charsToMarkup(toChars(segs)) }

/** 칼럼 폭 줄바꿈 — 공백 우선 분절 (피그마 min-content 폭 560 과 동일 규칙) */
function wrapChars(segs, fs, maxW) {
  const chars = toChars(segs)
  const lines = []
  let line = [], width = 0, lastSpace = -1
  const push = () => { if (line.length) lines.push(line); line = []; width = 0; lastSpace = -1 }
  for (const c of chars) {
    const w = adv(c.ch, c.en, c.bold) * fs
    if (width + w > maxW && line.length) {
      if (c.ch === ' ') { push(); continue }
      if (lastSpace >= 0) {
        const tail = line.splice(lastSpace + 1)
        line.splice(lastSpace, 1)          // 분절점 공백 제거
        push()
        line = tail
        width = tail.reduce((s, x) => s + adv(x.ch, x.en, x.bold) * fs, 0)
        lastSpace = -1
      } else push()
    }
    if (c.ch === ' ') lastSpace = line.length
    line.push(c)
    width += w
  }
  push()
  return lines
}

/** lineTop + lineHeight 기준 baseline y (시각 중앙 정렬 근사) */
function base(top, lh, fs) { return top + lh / 2 + fs * 0.35 }

function textEl(x, y, fs, fill, markup, opt = {}) {
  const w  = opt.weight ? ` font-weight="${opt.weight}"` : ''
  const a  = opt.anchor ? ` text-anchor="${opt.anchor}"` : ''
  const ls = opt.ls ? ` letter-spacing="${opt.ls}"` : ''
  const ff = opt.en ? FONT_EN : FONT_KR
  return `<text x="${x}" y="${y}" font-family="${ff}" font-size="${fs}" fill="${fill}"${w}${a}${ls}>${markup}</text>`
}

/** 한 줄(nowrap) — 피그마 whitespace-nowrap 요소용. 폭 검증은 checkLines 로 수행 */
function oneLine(el, x, top, segs, fs, lh, fill, opt = {}) {
  el.push(textEl(x, base(top, lh, fs), fs, fill, rich(segs), opt))
  return lh
}

/** 문단(칼럼 폭 줄바꿈) — 섹션 본문·푸터 문단용 */
function para(el, x, top, segs, fs, lh, fill) {
  const lines = wrapChars(segs, fs, CW)
  let y = top
  for (const ln of lines) {
    el.push(textEl(x, base(y, lh, fs), fs, fill, charsToMarkup(ln)))
    y += lh
  }
  return y - top
}

// (시뮬용) nowrap 줄 폭 검증 — 캔버스 초과분 목록 반환
export function checkNowrapWidths() {
  const rows = [
    ['정의1', [{t:'예약이 확정된 회의실에 '},{t:'예약 시간이 지나도록 체크인 하지 않은 예약',bold:true},{t:'입니다.'}], 16],
    ['정의2', [{t:'예약 시작 후 '},{t:'10분이 경과할 때까지 체크인하지 않으면',bold:true},{t:' 시스템이 자동으로 노쇼 처리합니다.'}], 16],
    ['정의3', [{t:'사전에 취소한 예약은 노쇼가 아닙니다. ',bold:true},{t:'일정이 바뀌면 언제든 취소해 주시면 됩니다.'}], 16],
    ['캡션',  [{t:'노쇼 판정 → 확정된 예약 중 시작 후 10분까지 체크인하지 않아, 시스템이 자동 취소 처리한 건'}], 10],
    ['섹션3제목', [{t:'노쇼로 다른 팀의 회의 기회를 상실시키지 마세요'}], 24],
  ]
  return rows.map(([name, segs, fs]) => ({ name, w: Math.round(measure(segs, fs) * 10) / 10, budget: MAXX - CX }))
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG 빌더
// ═══════════════════════════════════════════════════════════════════════════
export function buildNoshowNoticeSvg(stats, fontCss = '') {
  const asOf = stats.as_of_kst
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
  el.push(`<defs>${fontCss ? `<style><![CDATA[\n${fontCss}\n]]></style>` : ''}<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="35.577%" stop-color="${C.barA}"/><stop offset="100%" stop-color="${C.barB}"/>
  </linearGradient></defs>`)

  // ── 헤더 (x=18, top=49) — 날짜·브랜드는 Instrument (피그마 실측) ──
  let y = 49
  el.push(textEl(18, base(y, 21, 14), 14, C.faint, esc(dateEN), { en: true }))
  y += 21 + 4
  el.push(textEl(18, base(y, 26.4, 24), 24, C.black, 'C&amp;R SPACE', { en: true }))
  y += 26.4 + 4
  el.push(textEl(18, base(y, 31.2, 24), 24, C.black, '운영공지'))
  y += 31.2 + 26

  // 타이틀 40px lh1.2 — 영문 괄호부는 런 분해로 Instrument 적용
  const TL = 48
  y += oneLine(el, 18, y, [{ t: '회의실 예약' }], 40, TL, C.black)
  el.push(textEl(18, base(y, TL, 40), 40, C.black,
    `<tspan fill="${C.orange}">${rich([{ t: '노쇼(No-Show) 현황' }])}</tspan> 안내`))
  y += TL
  y += oneLine(el, 18, y, [{ t: '및 체크인(Check-In) 협조 요청' }], 40, TL, C.black)

  y += 160

  // ── B1. 노쇼 정의 — ⭐피그마 nowrap: 각 문장 한 줄 유지 (v3) ──
  y += 14
  y += oneLine(el, CX, y, [{ t: '노쇼(No-Show)?' }], 24, 31.2, C.black)
  y += 16
  const defParas = [
    [{ t: '예약이 확정된 회의실에 ' }, { t: '예약 시간이 지나도록 체크인 하지 않은 예약', bold: true }, { t: '입니다.' }],
    [{ t: '예약 시작 후 ' }, { t: '10분이 경과할 때까지 체크인하지 않으면', bold: true }, { t: ' 시스템이 자동으로 노쇼 처리합니다.' }],
    [{ t: '사전에 취소한 예약은 노쇼가 아닙니다. ', bold: true }, { t: '일정이 바뀌면 언제든 취소해 주시면 됩니다.' }],
  ]
  for (const p of defParas) {
    y += oneLine(el, CX, y, p, 16, 20.8, C.body) + 4
  }
  y += -4 + 14 + 60

  // ── B2. 구분선 + 섹션 헤딩 ──
  el.push(`<line x1="${CX}" y1="${y}" x2="${CX + CW}" y2="${y}" stroke="${C.black}" stroke-width="1"/>`)
  y += 1 + 14
  y += oneLine(el, CX, y, [{ t: '4월 22일 서비스 정식 오픈 이후' }], 24, 31.2, C.black)
  y += oneLine(el, CX, y, [{ t: '운영기간 내 노쇼 현황' }], 24, 31.2, C.orange)
  y += 60

  // ── B3-a. 월별 추이 ──
  y += 14
  y += oneLine(el, CX, y, [{ t: '월별 추이' }], 16, 20.8, C.navy) + 4
  y += oneLine(el, CX, y,
    [{ t: '노쇼 판정 → 확정된 예약 중 시작 후 10분까지 체크인하지 않아, 시스템이 자동 취소 처리한 건' }],
    10, 13, C.orange) + 14

  const BAR_H = 30.222, BAR_GAP = 1, LABEL_W = 150, TRACK_W = CW - 16 - LABEL_W, BAR_MIN = 52
  for (const m of monthly) {
    const ns = Number(m.noshow ?? 0)
    const fw = Math.max(BAR_MIN, Math.round(TRACK_W * ns / maxNs))
    el.push(`<rect x="${CX}" y="${y}" width="${TRACK_W}" height="${BAR_H}" rx="1" fill="${C.track}"/>`)
    el.push(`<rect x="${CX}" y="${y}" width="${fw}" height="${BAR_H}" fill="url(#bar)"/>`)
    el.push(textEl(CX + 12, base(y, BAR_H, 14), 14, '#ffffff', rich([{ t: `${m.month}월` }]), { ls: '0.14px' }))
    el.push(textEl(CX + CW, base(y, BAR_H, 11), 11, C.gray,
      rich([{ t: `예약 ${nf(m.total)} 건 중 노쇼 ${nf(ns)} 건` }]), { anchor: 'end', ls: '0.11px' }))
    y += BAR_H + BAR_GAP
  }
  y += -BAR_GAP + 30

  // ── B3-b. 3열 통계 ──
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
    el.push(textEl(x, base(cy, 20.8, 16), 16, C.navy, rich([{ t: c.label }])))
    cy += 20.8 + 4
    el.push(textEl(x, base(cy, 10.4, 8), 8, C.faint, rich([{ t: c.sub }])))
    cy += 10.4 + 16 + 15
    // 값(숫자)=Instrument [v3], 단위(한글)=Pretendard
    el.push(textEl(x, base(cy, 39, 30), 30, C.body,
      `<tspan font-family="${FONT_EN}">${esc(c.value)}</tspan><tspan dx="4" font-size="24" fill="${C.unit}">${esc(c.unit)}</tspan>`))
    cy += 39
    colBottom = Math.max(colBottom, cy)
  })
  y = colBottom + 30

  // ── B3-c. 노쇼율 — 숫자·% Instrument [v3] ──
  y += 14
  y += oneLine(el, CX, y, [{ t: '노쇼율' }], 24, 31.2, C.orange)
  y += 4
  y += oneLine(el, CX, y, [{ t: '전체 예약 대비 노쇼 비율' }], 16, 20.8, C.orange)
  y += 4
  el.push(textEl(CX, base(y, 78, 60), 60, C.orange,
    `${rate.toFixed(1)}<tspan dx="8">%</tspan>`, { en: true }))
  y += 78 + 14 + 60

  // ── B4~B6. 안내 섹션 (본문은 칼럼 560 줄바꿈 — 피그마 min-content 동일) ──
  const sections = [
    { h: '회의실 도착하면 체크인', body: [
      { t: '회의실에 도착하시면 체크인을 꼭 눌러 주세요. 시작 5분 전부터 가능하고, 시작 후 10분 이내에 하지 않으면 자동으로 노쇼 처리됩니다.' },
    ]},
    { h: '일정이 바뀌면 사전 취소', body: [
      { t: '회의가 취소·변경되면 시작 전에 예약을 취소해 주세요. 사전 취소는 불이익이 없고, 비워진 시간은 즉시 다른 직원이 예약할 수 있습니다.' },
    ]},
    { h: '노쇼로 다른 팀의 회의 기회를 상실시키지 마세요', body: [
      { t: '임직원들은 9개 회의실을 함께 사용합니다. ' }, { t: '노쇼 1건이 곧 다른팀의 회의 1건 입니다.', bold: true },
    ]},
  ]
  for (const s of sections) {
    el.push(`<line x1="${CX}" y1="${y}" x2="${CX + CW}" y2="${y}" stroke="${C.line2}" stroke-width="1"/>`)
    y += 14
    el.push(textEl(CX, base(y, 31.2, 24), 24, C.black, rich([{ t: s.h }]), { weight: 500 }))
    y += 31.2 + 16
    y += para(el, CX, y, s.body, 16, 24, C.body)
    y += 24 + 36
  }

  // ── B7. 푸터 ──
  y += 14 - 36
  y += para(el, CX, y, [
    { t: '노쇼 현황은 관리자 대시보드를 통해 상시 모니터링되며, 반복 노쇼가 지속될 경우 개별 안내 등 추가 조치 중 입니다.' },
  ], 16, 24, C.body)
  y += oneLine(el, CX, y, [{ t: '작은 습관 하나로 모두가 회의실을 더 편하게 사용할 수 있습니다.' }], 16, 24, C.body)
  y += oneLine(el, CX, y, [{ t: '회의실 사용시 체크인과 사전 취소에 협조 부탁드립니다. 감사합니다.' }], 16, 24, C.body)
  y += 100
  el.push(textEl(CX, base(y, 24, 16), 16, C.black, 'C&amp;R SPACE', { en: true }))
  y += 24
  el.push(textEl(CX, base(y, 18, 12), 12, C.black, 'Management Support', { en: true }))
  y += 18 + 49

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
  // ← [2026-08-07] ESG /api/roster 동일 해법 — 대시보드의 빌드용 VITE_* 를 폴백으로 수용.
  //   URL 은 공개 고정값이라 하드코딩 폴백까지 둠 (anon key 는 env 전용 — 회전 대비).
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
    const reqUrl = new URL(context.request.url)

    if (reqUrl.searchParams.get('format') === 'png') {
      const png = await renderPng(buildNoshowNoticeSvg(stats), reqUrl.origin)
      return new Response(png, {
        headers: {
          'Content-Type':  'image/png',
          'Cache-Control': 'public, s-maxage=300, max-age=120',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // 그룹웨어용 SVG — 열 때마다 최신 (roster 동일, 고지 확정)
    // ⭐폰트 임베드 [v4]: 뷰어 PC 폰트 설치 여부와 무관하게 항상 동일 렌더
    const svg = buildNoshowNoticeSvg(stats, await embedFontCss(reqUrl.origin))
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
