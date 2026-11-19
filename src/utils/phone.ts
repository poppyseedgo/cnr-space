/**
 * phone.ts — 대한민국 전화번호 하이픈 표기 (입력 보조)
 *
 * ✅ 변경 이력
 *  - [2026-11-19] 신규 — 운송내역서 발신처·수신처 전화번호 칸 (GA 요청: 번호만 쳐도 하이픈이 들어가게).
 *
 * 📌 기준
 *    · 전화번호의 국제 기준은 ISO 가 아니라 ITU-T 권고다 — E.164(번호 체계) · E.123(표기법).
 *      E.123 의 국내 표기는 "국가가 쓰는 관례대로 묶는다" 이고, 한국 관례는 지역번호-국번-가입자번호 를 하이픈으로 잇는다.
 *    · 묶는 자리는 국내 번호 체계(앞자리로 식별번호 길이가 정해진다)를 따른다:
 *        02            서울                    02-XXX-XXXX · 02-XXXX-XXXX
 *        0NN           지역(031~064) · 이동전화(010·011·016~019) · 인터넷전화(070) · 080 등
 *                                              0NN-XXX-XXXX · 0NN-XXXX-XXXX
 *        050N          안심번호(0502~0508)      050N-XXX-XXXX · 050N-XXXX-XXXX
 *        15XX·16XX·18XX 전국대표번호            XXXX-XXXX
 *    · 가입자번호(식별번호 뒤)가 7자리면 3-4, 8자리면 4-4 로 묶는다. 입력 도중에는 친 만큼만 묶는다.
 *
 * 📌 손대지 않는 경우 (입력한 그대로 둔다)
 *    · 숫자·하이픈·공백 외 글자가 섞인 값 — 국제번호(+82 …), 내선 표기(… 내선 123) 등
 *    · 위 체계에 없는 앞자리, 자릿수가 체계보다 긴 값
 *    완성 여부(자릿수 부족)는 판정하지 않는다 — 표기만 돕는다.
 */

/** 숫자열 → 묶음 배열. 체계에 맞지 않으면 null */
export function splitKoreanPhone(digits: string): string[] | null {
  const d = digits
  if (!/^[0-9]+$/.test(d)) return null

  // 전국대표번호 15XX·16XX·18XX — 4-4
  if (/^1[568]/.test(d)) {
    if (d.length <= 4) return [d]
    if (d.length <= 8) return [d.slice(0, 4), d.slice(4)]
    return null
  }
  if (d[0] !== '0') return null

  // 식별번호 길이
  let p: number
  if (d.startsWith('02')) p = 2
  else if (d.length < 3) return [d]            // 0, 01 — 아직 식별번호를 다 치지 않음
  else if (d === '050') return [d]             // 4번째 자리를 봐야 안심번호(050N)인지 알 수 있다
  else if (/^050[2-8]/.test(d)) p = 4
  else if (/^0[1-9][0-9]/.test(d)) p = 3
  else return null                             // 00X(국제전화 식별번호) 등 — 손대지 않는다

  const head = d.slice(0, p)
  const rest = d.slice(p)
  if (rest.length === 0) return [head]
  if (rest.length <= 3) return [head, rest]
  if (rest.length <= 7) return [head, rest.slice(0, 3), rest.slice(3)]
  if (rest.length === 8) return [head, rest.slice(0, 4), rest.slice(4)]
  return null                                   // 체계보다 긴 값 — 손대지 않는다
}

/** 입력값 → 하이픈 표기. 규칙 밖의 값은 그대로 돌려준다 */
export function formatKoreanPhone(raw: string): string {
  const s = (raw ?? '').trim()
  if (s === '') return ''
  if (!/^[0-9\-\s]+$/.test(s)) return raw      // 국제번호·내선 표기 등 — 손대지 않는다
  const digits = s.replace(/[^0-9]/g, '')
  if (digits === '') return raw
  const parts = splitKoreanPhone(digits)
  return parts ? parts.join('-') : raw
}
