/**
 * orgExcel.ts — 조직도 Excel 내보내기 (설계서 §12 · Phase 5-B)
 *  - [2026-10-01 ORG Phase 5-B] 신규. 기존 '2026.10.01 조직도.xlsx' 와 같은 모양: 단위 박스(4열 병합, 이름 + 단위장) 를 트리로 배치,
 *    박스 아래에 구성원 1줄씩, 부모-자식은 셀 테두리 선으로 연결. 시트2 '명단' = orgExportRows 평면 표.
 *
 *  레이아웃 규칙
 *   · 박스 폭 W=4열, 형제 사이 간격 1열. 잎 단위 폭 = W, 부모 폭 = 자식 폭 합 + 간격 (최소 W). 부모 박스는 자식 범위 중앙.
 *   · 박스 = 2행(단위명 / 단위장), 그 아래 구성원 행(단위장 제외, 겸직 카드는 '(겸)'), 자식은 구성원 끝 + 2행 아래(연결선 공간).
 *   · 연결선: 부모 중앙열 아래 세로선 → 가로선(첫 자식 중앙 ~ 끝 자식 중앙) → 각 자식 위 세로 1칸. 셀 테두리로 그린다.
 *   · 숨김 카드는 호출부에서 제외하고 넘긴다. 공석은 '(공석) 표기' 로 표시.
 *  exceljs 는 동적 import (VisitorLogPanel 과 동일 패턴 — 메인 번들 비대 방지)
 */
import type { OrgCard, OrgFile, OrgJob, OrgRank, OrgUnit } from '../types'
import { buildUnitTree, primaryJob, sortCards, type OrgPersonView, type OrgUnitNode } from './orgStatus'

const W = 4          // 박스 폭(열)
const GAP = 1        // 형제 간격(열)
const TOP = 3        // 트리 시작 행 (1행 제목, 2행 여백)
const COL_W = 4.2    // 열 너비 (4열 ≈ 17자)

export interface OrgExcelInput {
  file:   Pick<OrgFile, 'name' | 'effective_on' | 'status'>
  units:  OrgUnit[]
  cards:  OrgCard[]          // 숨김 제외 후
  ranks:  Map<string, OrgRank>
  jobs:   Map<string, OrgJob>
  person: (c: OrgCard) => OrgPersonView
  rows:   Record<string, string>[]   // 시트2 '명단'
}

interface Box { node: OrgUnitNode; col: number; width: number; row: number; height: number; members: string[]; head: string | null }

export async function exportOrgExcel(input: OrgExcelInput): Promise<{ units: number }> {
  const { wb, units } = await buildOrgWorkbook(input)
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `조직도_${input.file.name.replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click(); URL.revokeObjectURL(a.href)
  return { units }
}

/** 워크북 생성 (다운로드 없음 — 테스트·서버에서도 사용) */
export async function buildOrgWorkbook(input: OrgExcelInput): Promise<{ wb: any; units: number }> {
  const { file, units, cards, ranks, jobs, person, rows } = input
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'C&R Space'

  // ── 시트1 조직도 ──
  const ws = wb.addWorksheet('조직도', { views: [{ showGridLines: false, zoomScale: 70 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 6, fitToHeight: 1, paperSize: 8 } })   // A3 가로 · 세로 1장
  const byUnit = new Map<string, OrgCard[]>()
  for (const c of cards) { if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []); byUnit.get(c.unit_id)!.push(c) }
  const cardText = (c: OrgCard) => {
    if (c.is_vacancy) return `(공석) ${c.display_name || ''}`.trim()
    const pj = primaryJob(c, jobs)
    const r = c.rank_id ? ranks.get(c.rank_id) : null
    return `${pj ? pj.code + ' ' : ''}${person(c).name}${r ? `(${r.label})` : ''}${c.is_primary === false ? '(겸)' : ''}${c.fte < 1 ? `(${c.fte})` : ''}${c.work_location ? `(${c.work_location})` : ''}`
  }

  // 1) 폭 계산 (후위)
  const widthOf = new Map<string, number>()
  const calcW = (n: OrgUnitNode): number => {
    const kids = n.children.map(calcW)
    const w = kids.length ? Math.max(W, kids.reduce((s, x) => s + x, 0) + GAP * (kids.length - 1)) : W
    widthOf.set(n.unit.id, w); return w
  }
  const roots = buildUnitTree(units)
  roots.forEach(calcW)

  // 2) 배치 (전위) — col/row 는 1-based
  const boxes: Box[] = []
  const place = (n: OrgUnitNode, col: number, row: number): number => {
    const sorted = sortCards(byUnit.get(n.unit.id) ?? [], ranks, jobs, c => person(c).name)
    const headCard = sorted.find(c => c.is_unit_head)
    const members = sorted.filter(c => c !== headCard).map(cardText)
    const width = widthOf.get(n.unit.id)!
    const boxCol = col + Math.floor((width - W) / 2)
    const box: Box = { node: n, col: boxCol, width, row, height: 2 + members.length, members, head: headCard ? cardText(headCard) : null }
    boxes.push(box)
    if (n.children.length === 0) return row + box.height
    let childCol = col
    const childRow = row + box.height + 2
    let bottom = childRow
    for (const ch of n.children) {
      const b = place(ch, childCol, childRow)
      bottom = Math.max(bottom, b)
      childCol += widthOf.get(ch.unit.id)! + GAP
    }
    return bottom
  }
  let col = 1
  for (const r of roots) { place(r, col, TOP); col += widthOf.get(r.unit.id)! + GAP * 3 }
  const totalCols = col

  // 3) 쓰기
  const thin = { style: 'thin', color: { argb: 'FF9CA3AF' } }
  const line = { style: 'medium', color: { argb: 'FF6B7280' } }
  for (let c = 1; c <= totalCols; c++) ws.getColumn(c).width = COL_W
  ws.mergeCells(1, 1, 1, Math.min(totalCols, 24))
  ws.getCell(1, 1).value = `${file.name}  ·  적용일 ${file.effective_on ?? '미정'}  ·  ${file.status.toUpperCase()}  ·  내보내기 ${new Date().toISOString().slice(0, 10)}`
  ws.getCell(1, 1).font = { bold: true, size: 13 }

  const boxById = new Map(boxes.map(b => [b.node.unit.id, b]))
  for (const b of boxes) {
    const depth = b.node.depth
    // 단위명
    ws.mergeCells(b.row, b.col, b.row, b.col + W - 1)
    const nameCell = ws.getCell(b.row, b.col)
    nameCell.value = b.node.unit.name
    nameCell.font = { bold: true, size: depth <= 1 ? 11 : 10, color: { argb: depth === 0 ? 'FFFFFFFF' : 'FF111827' } }
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: depth === 0 ? 'FF111827' : depth === 1 ? 'FFD1D5DB' : depth === 2 ? 'FFE5E7EB' : 'FFF3F4F6' } }
    nameCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    // 단위장
    ws.mergeCells(b.row + 1, b.col, b.row + 1, b.col + W - 1)
    const headCell = ws.getCell(b.row + 1, b.col)
    headCell.value = b.head ?? ''
    headCell.font = { size: 9.5, bold: !!b.head }
    headCell.alignment = { horizontal: 'center', vertical: 'middle' }
    // 박스 테두리
    for (let r = b.row; r <= b.row + 1; r++) for (let c = b.col; c < b.col + W; c++) {
      const cell = ws.getCell(r, c)
      cell.border = { top: r === b.row ? line : undefined, bottom: r === b.row + 1 ? line : undefined, left: c === b.col ? line : undefined, right: c === b.col + W - 1 ? line : undefined }
    }
    // 구성원
    b.members.forEach((m, i) => {
      const r = b.row + 2 + i
      ws.mergeCells(r, b.col, r, b.col + W - 1)
      const cell = ws.getCell(r, b.col)
      cell.value = m
      cell.font = { size: 9 }
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
      for (let c = b.col; c < b.col + W; c++) ws.getCell(r, c).border = { left: c === b.col ? thin : undefined, right: c === b.col + W - 1 ? thin : undefined, bottom: i === b.members.length - 1 ? thin : undefined }
    })
    // 연결선
    if (b.node.children.length > 0) {
      const center = b.col + Math.floor(W / 2)          // 부모 중앙(열)
      const bottom = b.row + b.height                   // 박스+구성원 바로 아래 행
      const busRow = bottom + 1                         // 가로선 행
      // 부모 → 버스: 세로선 (왼쪽 테두리)
      for (let r = bottom; r <= busRow; r++) addBorder(ws, r, center, 'left', line)
      const kids = b.node.children.map(ch => boxById.get(ch.unit.id)!)
      const centers = kids.map(k => k.col + Math.floor(W / 2))
      const c1 = Math.min(...centers), c2 = Math.max(...centers)
      for (let c = c1; c < c2; c++) addBorder(ws, busRow, c, 'bottom', line)   // 가로선: busRow 아래 테두리
      for (const kc of centers) addBorder(ws, busRow + 1, kc, 'left', line)   // 자식 위 세로 1칸
    }
  }
  ws.getRow(1).height = 22

  // ── 시트2 명단 ──
  if (rows.length) {
    const ws2 = wb.addWorksheet('명단', { views: [{ state: 'frozen', ySplit: 1 }] })
    const cols = Object.keys(rows[0])
    ws2.columns = cols.map(k => ({ header: k, key: k, width: k === '단위 경로' ? 44 : k === '메모' ? 30 : k.length > 4 ? 14 : 10 }))
    ws2.getRow(1).font = { bold: true }
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
    for (const r of rows) ws2.addRow(r)
    ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  }

  return { wb, units: boxes.length }
}

function addBorder(ws: any, row: number, col: number, side: 'left' | 'bottom', style: any) {
  const cell = ws.getCell(row, col)
  cell.border = { ...(cell.border ?? {}), [side]: style }
}
