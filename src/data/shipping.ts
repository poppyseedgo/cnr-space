/**
 * shipping.ts — 운송내역서 임시 등록 페이지(#shipping) 판정·라벨 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-11-19 주소 검색] 우편번호 칸 라벨(sender_zip · receiver_zip) 추가 — 저장 전용(20261024). 엑셀·라벨·관리자 목록 정의는 그대로(우편번호 미노출)
 *  - [2026-11-19] 신규 — 그룹웨어 이관 기간(2026-11-23~) 대체 페이지 (고지 확정 "SPACE 내 단독 페이지로 구현")
 *
 * 📌 원칙
 *    · 코드값(item_type 등)은 DB CHECK(20261023_shipping_temp.sql)와 정확히 같아야 한다.
 *    · 화면 라벨·엑셀 값·기본값·오류 문구는 이 파일에서만 정의한다.
 *    · 수발신번호(접두어·순번)는 DB 가 만든다 — 화면은 번호를 조립하지 않는다(shipping_no_prefix 가 접두어 SSOT).
 */

export interface ShippingOption<T extends string = string> { code: T; label: string }

export type ShippingItemType  = 'parcel' | 'post' | 'quick'
export type ShippingDirection = 'send' | 'receive' | 'external'
export type ShippingUnit      = 'document' | 'box' | 'vinyl'
export type ShippingRegion    = 'seoul' | 'other'

/** 항목 — 수발신번호 접두어를 정한다(택배/우편/퀵) */
export const SHIPPING_ITEM_TYPES: ShippingOption<ShippingItemType>[] = [
  { code: 'parcel', label: '택배운송비' },
  { code: 'post',   label: '우체국 등기우편' },
  { code: 'quick',  label: '퀵서비스' },
]
export const SHIPPING_DIRECTIONS: ShippingOption<ShippingDirection>[] = [
  { code: 'send',     label: '발송' },
  { code: 'receive',  label: '수령' },
  { code: 'external', label: '외부' },
]
export const SHIPPING_UNITS: ShippingOption<ShippingUnit>[] = [
  { code: 'document', label: '서류' },
  { code: 'box',      label: '박스' },
  { code: 'vinyl',    label: '택배비닐' },
]
export const SHIPPING_REGIONS: ShippingOption<ShippingRegion>[] = [
  { code: 'seoul', label: '서울' },
  { code: 'other', label: '그 외 지역' },
]

/** 기본값 — 그룹웨어 신청 화면과 동일(발송·서류). 청구여부·지역은 기본값 없음(기획안: 직원이 직접 선택) */
export const SHIPPING_DEFAULT_DIRECTION: ShippingDirection = 'send'
export const SHIPPING_DEFAULT_UNIT: ShippingUnit = 'document'

const labelOf = (list: ShippingOption[], code: string | null | undefined) =>
  list.find(o => o.code === code)?.label ?? ''
export const itemTypeLabel  = (c: string | null | undefined) => labelOf(SHIPPING_ITEM_TYPES, c)
export const directionLabel = (c: string | null | undefined) => labelOf(SHIPPING_DIRECTIONS, c)
export const unitLabel      = (c: string | null | undefined) => labelOf(SHIPPING_UNITS, c)
export const regionLabel    = (c: string | null | undefined) => labelOf(SHIPPING_REGIONS, c)
/** 청구여부 — 화면 Yes/No, 엑셀·목록 Y/N */
export const billableMark   = (b: boolean) => (b ? 'Y' : 'N')

/** 주소 표기 — 기본주소 + 띄어쓰기 + 상세주소 (그룹웨어 엑셀과 동일: 상세가 비어도 띄어쓰기는 남는다) */
export const joinAddress = (addr1: string, addr2: string) => `${addr1 ?? ''} ${addr2 ?? ''}`

/**
 * 발신처 회사 선택지 — 그룹웨어의 본사/부산지사 선택 + 직접 입력.
 * 선택 시 회사명·주소를 채운다(채운 뒤 수정 가능).
 */
export interface ShippingSenderPreset { key: string; company: string; zip: string; addr1: string; addr2: string }   // ← [2026-11-19 주소 검색] zip
export const SHIPPING_SENDER_PRESETS: ShippingSenderPreset[] = [
  // ← [2026-11-19 주소 검색] zip 추가 — 카카오 우편번호 서비스에서 두 주소를 직접 검색해 확인한 값(2026-11-19)
  { key: 'hq',    company: '씨엔알리서치(본사)',     zip: '06199', addr1: '서울특별시 강남구 역삼로 412',   addr2: '' },
  { key: 'busan', company: '씨엔알리서치(부산지사)', zip: '48733', addr1: '부산광역시 동구 중앙대로 216',   addr2: '교원빌딩 17층' },   // 2026-11-19 고지 제공값
]
export const SHIPPING_SENDER_CUSTOM = 'custom'
export const SHIPPING_DEFAULT_SENDER = 'hq'

/** 화면 칸 이름 — 오류 문구·필수 표시에 쓴다. 키는 DB 컬럼명(= RPC 오류 코드의 칸 이름) */
export const SHIPPING_FIELD_LABELS: Record<string, string> = {
  project_no: '프로젝트명', billable: '청구여부', item_type: '항목', requested_on: '신청일자',
  direction: '수발형태', unit: '단위', quantity: '수량', contents: '내용물', tracking_no: '운송장번호',
  region: '지역', note: '비고',
  sender_company: '발신처 회사', sender_name: '발신처 담당자', sender_phone: '발신처 전화번호',
  sender_addr1: '발신처 주소', sender_addr2: '발신처 상세주소',
  receiver_company: '수신처 회사', receiver_name: '수신처 담당자', receiver_phone: '수신처 전화번호',
  receiver_addr1: '수신처 주소', receiver_addr2: '수신처 상세주소',
  sender_zip: '발신처 우편번호', receiver_zip: '수신처 우편번호',   // ← [2026-11-19 주소 검색]
}

/** 필수 칸 — DB shipping_fill 과 같은 목록(서버가 최종 판정, 화면은 안내용) */
export const SHIPPING_REQUIRED_FIELDS = [
  'project_no', 'billable', 'item_type', 'direction', 'quantity', 'region',
  'sender_name', 'sender_phone', 'receiver_name', 'receiver_phone',
] as const

/** 수량 형식 — DB 와 같은 식(숫자만 · 1 이상) */
export const SHIPPING_QUANTITY_RE = /^[1-9][0-9]{0,5}$/

/** RPC 오류 코드 → 안내 문구 */
export function shippingErrorMessage(raw: string): string {
  const code = (raw || '').trim()
  const m = code.match(/^(REQUIRED|INVALID):([a-z0-9_]+)/)
  if (m) {
    const label = SHIPPING_FIELD_LABELS[m[2]] ?? m[2]
    if (m[1] === 'REQUIRED') return `${label}은(는) 필수 항목입니다.`
    if (m[2] === 'quantity') return '수량은 1 이상의 숫자만 입력할 수 있습니다.'
    return `${label} 값이 올바르지 않습니다.`
  }
  if (code.startsWith('NOT_AUTHENTICATED'))  return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  if (code.startsWith('PROFILE_NOT_FOUND'))  return '직원 정보를 찾을 수 없습니다. 관리자에게 문의해 주세요.'
  if (code.startsWith('NOT_FOUND'))          return '이미 삭제되었거나 없는 건입니다.'
  if (code.startsWith('NOT_OWNER'))          return '본인이 등록한 건만 수정·삭제할 수 있습니다.'
  if (code.startsWith('EDIT_WINDOW_CLOSED')) return '등록한 당일에만 수정·삭제할 수 있습니다.'
  if (code.startsWith('ITEM_TYPE_LOCKED'))   return '항목은 수발신번호와 묶여 있어 바꿀 수 없습니다. 삭제 후 다시 등록해 주세요.'
  return code || '처리 중 오류가 발생했습니다.'
}

/**
 * 라벨 인쇄 배치 — 그룹웨어 '운송내역서 인쇄' 출력물(A4 가로 PDF)의 글자 좌표 실측값을 mm 로 옮긴 것.
 *   실측(pt): 글자 6.3 · 줄 간격 7.35 · 보내는 사람 x=0, 첫 줄 위 23.47 · 수발신번호/받는 사람 x=262.5 · 받는 사람은 보내는 사람보다 36.75 아래
 *   보내는 사람: 왼쪽 위 / 수발신번호: 둘째 단 맨 위 / 받는 사람: 둘째 단, 보내는 사람보다 한 단(5줄) 아래.
 *   원본은 글자가 종이 왼쪽 끝(0mm)에서 시작하지만 프린터 여백에 잘리지 않도록 senderLeft 만 5mm 띄웠다.
 */
export const SHIPPING_LABEL_LAYOUT = {
  pageWidthMm: 297, pageHeightMm: 209,     // A4 가로 (높이는 다음 장 넘김 방지로 1mm 줄임)
  senderLeftMm: 5,    senderTopMm: 8.1,
  numberLeftMm: 92.6, numberTopMm: 8.1,
  receiverLeftMm: 92.6, receiverTopMm: 21.06,
  fontPt: 6.3, linePitchMm: 2.593,
} as const

/** 엑셀 서식 — '5. 일양택배 운송내역서 다운로드용 서식.xlsx' 실측값 */
export const SHIPPING_EXCEL = {
  sheetName: '운송 내역서',
  title: '운송 내역서',
  headers: ['사원명', '사원ID', '수신처', '수신인', '수신인 전화번호', '수신인 주소', '수발신번호', '수발 형태', '항목', '단위',
            '내용물', '수량', '발신처', '발신인', '발신인 전화번호', '발신인 주소', '신청 일자', '지역', '사용 금액', '무게(g)',
            '운송장 번호', '프로젝트 번호', '청구여부', '비고'],
  widths: [11.5, 13.0, 24.4, 10.4, 18.4, 110.5, 21.2, 12.9, 14.1, 8.6, 34.9, 8.6, 20.7, 10.4, 18.4, 65.9, 14.5, 13.6, 12.9, 10.8, 15.0, 16.6, 12.3, 8.6],
  /** 0-based 열 번호 — 왼쪽 정렬(주소) / 오른쪽 정렬(수량·사용금액·무게). 나머지는 가운데 */
  leftCols: [5, 15],
  rightCols: [11, 18, 19],
} as const

/** 관리자 화면 목록 열 순서 — 그룹웨어 '운송내역서(관리자)' 화면과 동일(수발신번호가 사원ID 다음. 엑셀 열 순서와 다르다) */
export const SHIPPING_ADMIN_COLUMNS = [
  '순번', '사원명', '사원ID', '수발신번호', '수신처', '수신인', '수신인 전화번호', '수신인 주소', '수발형태', '항목', '단위',
  '내용물', '수량', '발신처', '발신인', '발신인 전화번호', '발신인 주소', '신청일자', '지역', '사용금액', '무게(g)',
  '운송장번호', '프로젝트 번호', '청구여부',
] as const

/** 신청 화면 하단 참고사항 — 그룹웨어 '운송내역서신청' 화면 안내문 그대로. strong=굵게, warn=빨강 */
export interface ShippingGuideLine { text: string; strong?: boolean; warn?: boolean }
export const SHIPPING_GUIDE: { title: string; lines: ShippingGuideLine[] }[] = [
  { title: '<공통사항>', lines: [
    { text: '수량 : 숫자로 기입 ex) 1, 2' },
    { text: '담당자 : 직책을 제외하고 성함만 기입 ex) 홍길동(○), 홍길동 과장님(×)' },
    { text: '수신처 주소는 자세하고 정확하게 입력 예) **시 **구 **로(**동 / **로) **층' },
    { text: '내용물 입력 시, 상세내역으로 작성' },
    { text: '운송정보 등록하신 당일만 본인이 직접 내용 수정 가능' },
    { text: '문서수발실로 발송 물품 전달 후 내용 수정 건은 MS팀 송보람에게 메일로 수정 요청' },
    { text: "운송정보등록 후, 운송내역서 조회에서 발송 정보 인쇄하여 발송 물품에 부착 후 1층 '문서수발실'로 전달" },
    { text: '모든 문서 및 물품 수·발신은 1층 문서수발실에서만 가능' },
    { text: '운송장 번호 및 사용금액은 본인이 직접 확인 가능', strong: true },
  ] },
  { title: '<일양택배> - 택배운송비', lines: [
    { text: '수발형태 수령/외부일 경우는 입력 후 일양택배(1588-0002)로 픽업 요청 (고객번호: 101463003)' },
    { text: '오후2시 택배운송장 일괄 인쇄', strong: true },
    { text: '오후2시까지 1층 문서수발실에 있는 건에 한하여 발송 / 오후2시 이후 건은 다음 날(평일 기준) 발송', warn: true },
    { text: '모든 수·발신내역 입력', strong: true },
  ] },
  { title: '<퀵서비스> - 퀵', lines: [
    { text: '바나나퀵(1588-0775)으로 퀵서비스 신청' },
    { text: '퀵서비스 전화 신청 후, 배송기사 도착 전 1층으로 발송 물품 전달' },
  ] },
  { title: '<등기우편> - 우편', lines: [
    { text: 'MS팀 송보람에게 개별 문의' },
  ] },
]
