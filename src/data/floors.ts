// 층 정적 설정 — floors 테이블이 Supabase에 없으므로 여기서 관리
import type { Floor } from '../types'

export const FLOORS: Floor[] = [
  { floor_id: 1, floor_no: 1, floor_name: "1층" },
  { floor_id: 2, floor_no: 2, floor_name: "2층" },
  { floor_id: 3, floor_no: 3, floor_name: "3층" },
  { floor_id: 4, floor_no: 4, floor_name: "4층" },
  { floor_id: 5, floor_no: 5, floor_name: "5층" },
  { floor_id: 6, floor_no: 6, floor_name: "6층" },
]

export function getFloor(floorId: number | undefined): Floor {
  return FLOORS.find(f => f.floor_id === floorId) ?? { floor_id: 0, floor_name: '', floor_no: 0 } as Floor
}
