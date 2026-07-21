/**
 * csv.ts — CSV 내보내기 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규. AdminPage.tsx 내부 지역 함수 exportCSV 를 그대로 추출.
 *
 * 📌 추출 이유
 *   도서 관리 탭에서도 동일한 CSV 내보내기가 필요한데, AdminPage 안의 지역
 *   함수라 import 가 불가능했다. 복사하면 BOM 처리·escape 규칙이 두 벌이 되어
 *   한쪽만 고쳐지는 상황이 반드시 생긴다(과거 뱃지 라벨/날짜 포맷에서 겪음).
 *   구현은 한 글자도 바꾸지 않고 위치만 옮긴다.
 *
 * 📌 규칙
 *  · BOM('\uFEFF') 선행 — Excel 이 UTF-8 로 인식하게 함. 빼면 한글이 깨진다.
 *  · 모든 셀을 큰따옴표로 감싸고 내부 따옴표는 "" 로 이스케이프 —
 *    쉼표/줄바꿈이 포함된 값(메모, 도서명)이 컬럼을 밀어내는 것을 방지.
 *  · 줄바꿈은 CRLF('\r\n') — Excel 호환.
 *  · 컬럼 순서는 rows[0] 의 key 순서. 호출부가 한글 key 로 객체를 만들면
 *    그대로 헤더가 된다.
 */

import { todayStr } from './time'

/**
 * 객체 배열을 CSV 파일로 내려받는다.
 * @param rows     한 행 = 한 객체. key 가 헤더가 된다. 빈 배열이면 아무것도 안 함.
 * @param filename 확장자·날짜 제외한 이름. 실제 파일명은 `{filename}_{YYYY-MM-DD}.csv`
 */
export function exportCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return
  const BOM = '\uFEFF'
  const cols = Object.keys(rows[0])
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = BOM + [cols.join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = `${filename}_${todayStr()}.csv`
  a.click(); URL.revokeObjectURL(a.href)
}
