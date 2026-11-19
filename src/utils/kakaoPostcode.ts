/**
 * kakaoPostcode.ts — 카카오(다음) 우편번호 서비스 연결 (대한민국 주소 검색)
 *
 * ✅ 변경 이력
 *  - [2026-11-19] 신규 — 운송내역서 발신처·수신처 주소 검색 (고지 확정).
 *
 * 📌 서비스 (공식 가이드 postcode.map.daum.net/guide 기준)
 *    · 키 발급·서버 없이 스크립트만 불러 쓴다. 무료·무제한(가이드 FAQ).
 *    · 검색 화면은 카카오가 제공하는 iframe — 배치·문구 변경 불가, 로고 유지 필수.
 *      embed() 의 최소 크기는 폭 300 · 높이 400 (그보다 작으면 무시된다).
 *    · 스크립트는 운송내역서 화면에서 [주소 검색]을 처음 누를 때 1회만 불러온다
 *      (index.html 에 넣지 않는다 — SPACE 다른 화면은 이 스크립트가 필요 없다).
 *    · 외부 인터넷이 막힌 PC 에서는 스크립트를 받지 못한다 → 호출부가 '직접 입력' 으로 안내한다.
 *    · ⚠ 스크립트 주소는 t1.kakaocdn.net 을 쓴다. 예전 주소 t1.daumcdn.net 은 2026-11-30 종료 예정 —
 *      그 주소로 불러오면 검색 창 위에 카카오의 "도메인 종료 안내" 공지가 뜬다(스크립트 VERSION:261109 의 _legacyCdn_ 분기로 확인).
 *      두 주소의 파일은 동일하다(2026-11-19 md5 일치 확인).
 */

export const KAKAO_POSTCODE_SCRIPT = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'   // ← [2026-11-19] daumcdn 종료 예정 → kakaocdn

/** 스크립트가 만든 전역 객체 — kakao · daum 은 같은 객체를 가리킨다(스크립트가 서로 별칭으로 건다) */
const postcodeNs = (): any => { const w = window as any; return w.kakao?.Postcode ? w.kakao : w.daum }

/** oncomplete 로 받는 값 중 이 화면이 쓰는 칸 */
export interface KakaoPostcodeData {
  zonecode: string            // 우편번호 5자리
  address: string             // 기본 주소 (검색 결과 첫 줄)
  userSelectedType: 'R' | 'J' // 사용자가 고른 주소 종류 — R 도로명 · J 지번
  roadAddress: string
  jibunAddress: string
  autoRoadAddress?: string
  autoJibunAddress?: string
  buildingName: string
}

let loader: Promise<void> | null = null

/** 스크립트 1회 로드. 실패하면 다음 호출에서 다시 시도한다 */
export function loadKakaoPostcode(): Promise<void> {
  if (postcodeNs()?.Postcode) return Promise.resolve()
  if (loader) return loader
  loader = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = KAKAO_POSTCODE_SCRIPT
    s.async = true
    const fail = () => { loader = null; s.remove(); reject(new Error('KAKAO_POSTCODE_LOAD_FAILED')) }
    s.onload = () => {
      const d = postcodeNs()
      if (d?.Postcode) resolve()
      else if (d?.postcode?.load) d.postcode.load(() => resolve())
      else fail()
    }
    s.onerror = fail
    document.head.appendChild(s)
  })
  return loader
}

/**
 * 고른 결과 → 기본주소 칸에 넣을 문자열 (조합 규칙 SSOT).
 *   · 사용자가 고른 종류(도로명/지번)의 주소를 쓴다. 비어 있으면 자동 매핑값 → 기본 주소 순으로 대체.
 *   · 도로명주소이고 건물명이 있으면 뒤에 "(건물명)" 을 붙인다 — 공식 가이드 예제의 참고항목 표기.
 */
export function kakaoBaseAddress(d: KakaoPostcodeData): string {
  const road = d.userSelectedType !== 'J'
  const base = road
    ? (d.roadAddress || d.autoRoadAddress || d.address || '')
    : (d.jibunAddress || d.autoJibunAddress || d.address || '')
  const building = road && d.buildingName ? ` (${d.buildingName})` : ''
  return `${base}${building}`.trim()
}

/** 검색 화면을 el 안에 넣는다. shorthand:false — 시도를 '서울' 이 아니라 '서울특별시' 로 받는다(기존 주소 표기와 통일) */
export function embedKakaoPostcode(el: HTMLElement, onComplete: (d: KakaoPostcodeData) => void): void {
  const Postcode = postcodeNs().Postcode
  new Postcode({
    shorthand: false,
    width: '100%',
    height: '100%',
    oncomplete: (d: KakaoPostcodeData) => onComplete(d),
  }).embed(el, { autoClose: false })
}
