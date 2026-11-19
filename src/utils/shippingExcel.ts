/**
 * shippingExcel.ts — 운송내역서(관리자) 엑셀 다운로드
 *
 * ✅ 변경 이력
 *  - [2026-11-19] 신규 — '5. 일양택배 운송내역서 다운로드용 서식.xlsx' 와 같은 모양으로 만든다.
 *
 * 서식(실측):
 *   시트명 '운송 내역서' · 1행 제목(A1:X1 병합, Calibri 16 굵게, 가운데, 높이 21)
 *   2행 헤더(맑은 고딕 11, 가운데, 회색 바탕, 가는 테두리) · 3행부터 데이터
 *   데이터는 전부 문자(수량 '1', 사용금액 '0', 사번·날짜 포함) — 숫자로 넣으면 원본 서식과 달라진다
 *   정렬: 주소(F·P) 왼쪽 / 수량·사용금액·무게(L·S·T) 오른쪽 / 나머지 가운데
 *
 *  exceljs 는 동적 import (orgExcel · VisitorLogPanel 과 동일 패턴 — 메인 번들 비대 방지)
 */
import type { ShippingRecord } from '../types/shipping'
import {
  SHIPPING_EXCEL, joinAddress, directionLabel, itemTypeLabel, unitLabel, regionLabel, billableMark,
} from '../data/shipping'

/** 한 건 → 엑셀 24칸 (A~X). 전부 문자열 */
export function shippingExcelRow(r: ShippingRecord): string[] {
  return [
    r.user_name,                                        // A 사원명
    r.employee_no,                                      // B 사원ID (사번)
    r.receiver_company,                                 // C 수신처
    r.receiver_name,                                    // D 수신인
    r.receiver_phone,                                   // E 수신인 전화번호
    joinAddress(r.receiver_addr1, r.receiver_addr2),    // F 수신인 주소
    r.shipping_no,                                      // G 수발신번호
    directionLabel(r.direction),                        // H 수발 형태
    itemTypeLabel(r.item_type),                         // I 항목
    unitLabel(r.unit),                                  // J 단위
    r.contents,                                         // K 내용물
    String(r.quantity),                                 // L 수량
    r.sender_company,                                   // M 발신처
    r.sender_name,                                      // N 발신인
    r.sender_phone,                                     // O 발신인 전화번호
    joinAddress(r.sender_addr1, r.sender_addr2),        // P 발신인 주소
    r.requested_on,                                     // Q 신청 일자
    regionLabel(r.region),                              // R 지역
    String(r.amount),                                   // S 사용 금액 (0)
    String(r.weight_g),                                 // T 무게(g) (0)
    r.tracking_no,                                      // U 운송장 번호
    r.project_no,                                       // V 프로젝트 번호
    billableMark(r.billable),                           // W 청구여부
    r.note,                                             // X 비고
  ]
}

/** 워크북 생성 (다운로드 없음 — 테스트에서도 사용) */
export async function buildShippingWorkbook(rows: ShippingRecord[]): Promise<any> {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'C&R Space'
  const ws = wb.addWorksheet(SHIPPING_EXCEL.sheetName)
  const cols = SHIPPING_EXCEL.headers.length   // 24
  const thin = { style: 'thin' }
  const border = { top: thin, left: thin, bottom: thin, right: thin }
  const bodyFont = { name: '맑은 고딕', size: 11 }

  SHIPPING_EXCEL.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // 1행 제목
  ws.mergeCells(1, 1, 1, cols)
  const title = ws.getCell(1, 1)
  title.value = SHIPPING_EXCEL.title
  title.font = { name: 'Calibri', size: 16, bold: true }
  title.alignment = { horizontal: 'center' }
  const medium = { style: 'medium' }
  for (let c = 1; c <= cols; c++) ws.getCell(1, c).border = { top: medium, left: medium, bottom: medium, right: medium }
  ws.getRow(1).height = 21

  // 2행 헤더
  SHIPPING_EXCEL.headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = h
    cell.font = bodyFont
    cell.alignment = { horizontal: 'center' }
    cell.border = border
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C0C0' } }
  })

  // 3행~ 데이터 (전부 문자)
  const left = SHIPPING_EXCEL.leftCols as readonly number[]
  const right = SHIPPING_EXCEL.rightCols as readonly number[]
  rows.forEach((r, ri) => {
    shippingExcelRow(r).forEach((v, ci) => {
      const cell = ws.getCell(ri + 3, ci + 1)
      cell.value = v ?? ''
      cell.numFmt = '@'
      cell.font = bodyFont
      cell.alignment = { horizontal: left.includes(ci) ? 'left' : right.includes(ci) ? 'right' : 'center' }
      cell.border = border
    })
  })
  return wb
}

/** 브라우저 다운로드 */
export async function downloadShippingExcel(rows: ShippingRecord[], fileLabel: string): Promise<void> {
  const wb = await buildShippingWorkbook(rows)
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `운송내역서_${fileLabel.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`
  a.click(); URL.revokeObjectURL(a.href)
}
