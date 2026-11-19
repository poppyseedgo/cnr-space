/**
 * phone.ts — 대한민국 전화번호 하이픈 표기 (규칙 SSOT)
 *
 * ✅ 변경 이력
 *  - [2026-11-19 설계 반영] 「운송내역서 전화번호 하이픈 표기 설계」(고지 확정 2026-11-19, 권장안 3건) 대로 다시 작성.
 *      · 식별번호를 목록(KOREAN_PHONE_PREFIXES)으로 판정 — 이전에는 0 으로 시작하는 세 자리면 모두 묶었다(없는 지역번호 034 도 묶임).
 *      · 010·070 은 11자리만 완성, 처음부터 4자리씩 끊는다 — 이전에는 10자리도 010-XXX-XXXX 로 완성처럼 묶었다.
 *      · 14XX-XX(수신자부담 대표번호) 추가, 050 + 숫자 전부를 앞 묶음 4자리로(이전: 0502~0508 만).
 *      · 점·괄호·전각 숫자·+82 로 적은 값도 정리한 뒤 규칙 적용 — 이전에는 손대지 않았다.
 *      · 결과에 상태(완성 / 입력 중 / 규칙 밖)를 함께 돌려준다 — analyzeKoreanPhone.
 *      · 출력 화면용 displayKoreanPhone 추가 — 완성 번호만 하이픈, 그 외는 저장된 그대로.
 *      · 내선은 다루지 않는다(2026-11-19 제외 결정) — 글자가 섞인 값은 규칙 밖.
 *  - [2026-11-19] 신규 — 운송내역서 발신처·수신처 전화번호 칸 (GA 요청: 번호만 쳐도 하이픈이 들어가게).
 *
 * 📌 기준
 *    · 전화번호 표기의 국제 기준은 ITU-T E.123(표기) · E.164(번호 체계). 하이픈으로 묶는 방식은 한국 관례.
 *    · 하이픈 위치는 「앞 묶음(식별번호) 길이」 + 「남은 숫자 수」 두 가지로만 정한다.
 *        서울 02            → 2자리        지역·휴대폰·070·080 → 3자리        050N → 4자리
 *        남은 숫자 7자리 → 3-4,  8자리 → 4-4.  뒤 묶음은 항상 4자리.
 *        전국대표번호 15XX·16XX·18XX → 4-4,  수신자부담 대표번호 14XX → 4-2.
 *    · 목록에 없는 앞자리(없는 지역번호, 060, 012·015, 119·1330 같은 특수번호)는 묶지 않는다.
 *    · 원칙: 틀리게 묶느니 묶지 않는다 — 판정할 수 없는 값은 입력한 그대로 돌려준다(숫자·하이픈뿐이면 숫자만).
 */

/** 가운데 묶음 규칙: var = 남은 숫자 7자리(3-4) 또는 8자리(4-4), fix8 = 항상 8자리(4-4) */
type Mid = 'var' | 'fix8'

/** 세 자리 식별번호 목록 — 여기 있는 번호만 규칙을 적용한다 (SSOT) */
export const KOREAN_PHONE_PREFIXES: Record<string, Mid> = {
  // 지역번호 16곳 (서울 02 는 두 자리라 따로 판정)
  '031': 'var', '032': 'var', '033': 'var',
  '041': 'var', '042': 'var', '043': 'var', '044': 'var',
  '051': 'var', '052': 'var', '053': 'var', '054': 'var', '055': 'var',
  '061': 'var', '062': 'var', '063': 'var', '064': 'var',
  // 휴대폰
  '010': 'fix8',
  '011': 'var', '016': 'var', '017': 'var', '018': 'var', '019': 'var',   // 예전 휴대폰
  // 인터넷전화 · 수신자부담
  '070': 'fix8',
  '080': 'var',
}

export type KoreanPhoneStatus = 'empty' | 'complete' | 'partial' | 'outside'
/** 규칙 밖인 이유 — 입력 칸 안내 문구를 고를 때 쓴다 */
export type KoreanPhoneOutside = 'too_long' | 'unknown_prefix' | 'no_area_code' | 'foreign' | 'text'

export interface KoreanPhoneResult {
  /** 표기. 완성·입력 중이면 하이픈으로 묶은 값, 규칙 밖이면 입력한 그대로 */
  text: string
  status: KoreanPhoneStatus
  reason?: KoreanPhoneOutside
}

const ZENKAKU = /[０-９]/g                      // 전각 숫자 ０~９
const SEPARATORS = /[\s\-‐-―－.()]/g      // 하이픈류 · 공백 · 점 · 괄호
const PLUS82 = /^\+\s*82[\s\-.]*(?:\(0\)|0)?[\s\-.]*/   // +82, +82 (0), +82 0 → 0

/** 정리: 전각→반각, +82→0, 구분 기호 제거. 숫자만 남지 않으면 null */
function normalizeDigits(raw: string): { digits: string } | { reason: KoreanPhoneOutside } {
  let s = raw.trim().replace(ZENKAKU, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/＋/g, '+')
  if (PLUS82.test(s)) s = s.replace(PLUS82, '0')
  else if (s.startsWith('+')) return { reason: 'foreign' }
  const digits = s.replace(SEPARATORS, '')
  if (digits === '' || !/^[0-9]+$/.test(digits)) return { reason: 'text' }
  return { digits }
}

/** 앞 묶음을 떼고 남은 숫자를 묶는다 */
function groupRest(head: string, rest: string, mid: Mid): { parts: string[]; status: 'complete' | 'partial' } | null {
  if (rest.length > 8) return null
  if (rest.length === 0) return { parts: [head], status: 'partial' }
  if (mid === 'fix8') {
    if (rest.length <= 4) return { parts: [head, rest], status: 'partial' }
    return { parts: [head, rest.slice(0, 4), rest.slice(4)], status: rest.length === 8 ? 'complete' : 'partial' }
  }
  if (rest.length <= 3) return { parts: [head, rest], status: 'partial' }
  if (rest.length <= 7) return { parts: [head, rest.slice(0, 3), rest.slice(3)], status: rest.length === 7 ? 'complete' : 'partial' }
  return { parts: [head, rest.slice(0, 4), rest.slice(4)], status: 'complete' }
}

/** 앞 4자리 + 나머지 (대표번호). total = 완성 자릿수 */
function groupLeading4(d: string, total: number): { parts: string[]; status: 'complete' | 'partial' } | null {
  if (d.length > total) return null
  if (d.length <= 4) return { parts: [d], status: 'partial' }
  return { parts: [d.slice(0, 4), d.slice(4)], status: d.length === total ? 'complete' : 'partial' }
}

/** 입력값 → 표기 + 상태. 판정 순서는 설계 문서 「판정 순서」 그대로 */
export function analyzeKoreanPhone(raw: string | null | undefined): KoreanPhoneResult {
  const src = raw ?? ''
  if (src.trim() === '') return { text: '', status: 'empty' }

  const n = normalizeDigits(src)
  if ('reason' in n) return { text: src, status: 'outside', reason: n.reason }
  const d = n.digits
  // 규칙 밖 — 입력한 그대로. 다만 숫자와 하이픈뿐인 값(= 치는 동안 이 함수가 넣은 하이픈이 섞인 값)은 숫자만 남긴다.
  // 예: 02-1234-5678 뒤에 한 글자 더 치면 02123456789 (반쯤 묶인 02-1234-56789 로 남지 않게). 괄호·글자가 있는 값은 건드리지 않는다.
  const outside = (reason: KoreanPhoneOutside): KoreanPhoneResult => ({ text: /^[0-9-]+$/.test(src.trim()) ? d : src, status: 'outside', reason })
  const done = (g: { parts: string[]; status: 'complete' | 'partial' } | null): KoreanPhoneResult =>
    g ? { text: g.parts.join('-'), status: g.status } : outside('too_long')

  if (d[0] === '0') {
    // ① 서울 — 세 자리 식별번호 중 02 로 시작하는 것이 없어 두 글자로 확정된다
    if (d.startsWith('02')) return done(groupRest('02', d.slice(2), 'var'))
    // 아직 앞 묶음을 다 치지 않음 (0, 01, 03 …)
    if (d.length < 3) {
      const reachable = d === '0' || d === '05' || Object.keys(KOREAN_PHONE_PREFIXES).some(p => p.startsWith(d))
      return reachable ? { text: d, status: 'partial' } : outside('unknown_prefix')
    }
    // ② 안심·평생번호 050N — 네 번째 숫자까지가 앞 묶음
    if (d.startsWith('050')) return d.length === 3 ? { text: d, status: 'partial' } : done(groupRest(d.slice(0, 4), d.slice(4), 'var'))
    // ③ 세 자리 식별번호 (지역 · 휴대폰 · 070 · 080)
    const mid = KOREAN_PHONE_PREFIXES[d.slice(0, 3)]
    return mid ? done(groupRest(d.slice(0, 3), d.slice(3), mid)) : outside('unknown_prefix')
  }

  if (d[0] === '1') {
    if (d.length === 1) return { text: d, status: 'partial' }
    if (/^1[568]/.test(d)) return done(groupLeading4(d, 8))     // ④ 전국대표번호 15XX·16XX·18XX — 4-4
    if (d.startsWith('14')) return done(groupLeading4(d, 6))    // ⑤ 수신자부담 대표번호 14XX — 4-2
    return outside('unknown_prefix')                            // 119 · 1330 등 특수번호
  }

  // 2~9 로 시작 — 지역번호 없이 가입자번호만 적은 값. 묶지 않는다(확정 2-가: 라벨만 보고는 전화할 수 없는 번호)
  return outside('no_area_code')
}

/** 입력 칸용 — 치는 동안 보이는 값. 규칙 밖이면 입력한 그대로 */
export function formatKoreanPhone(raw: string | null | undefined): string {
  return analyzeKoreanPhone(raw).text
}

/** 출력 화면용(라벨 · 목록 · 상세 · 엑셀) — 완성 번호만 하이픈, 그 외는 저장된 그대로(반쯤 묶인 번호가 정상처럼 보이지 않게) */
export function displayKoreanPhone(stored: string | null | undefined): string {
  const r = analyzeKoreanPhone(stored)
  return r.status === 'complete' ? r.text : (stored ?? '')
}
