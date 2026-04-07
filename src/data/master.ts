import type { Floor, Feature, Room, RoomFeature, RoomRule, AppUser } from '../types'

/**
 * master.ts — 마이그레이션 진행 중
 *
 * ✅ rooms 데이터  → Supabase rooms 테이블 (api.ts loadRooms)
 * ✅ users 데이터  → Supabase profiles 테이블 (api.ts loadUsers)
 * ⚠️ 아래 하드코딩 데이터는 Supabase 미연결 시 fallback 용도로만 사용
 * ✅ 헬퍼 함수들은 계속 사용 (rooms props 기반으로 동작)
 */

// ─── floor 테이블 ────────────────────────────────────────────────────────────
export const FLOORS: Floor[] = [
  { floor_id: 1, floor_no: 1, floor_name: "1층" },
  { floor_id: 2, floor_no: 2, floor_name: "2층" },
  { floor_id: 3, floor_no: 3, floor_name: "3층" },
  { floor_id: 4, floor_no: 4, floor_name: "4층" },
  { floor_id: 5, floor_no: 5, floor_name: "5층" },
  { floor_id: 6, floor_no: 6, floor_name: "6층" },
];

// ─── feature 테이블 ─────────────────────────────────────────────────────────
export const FEATURES: Feature[] = [
  { feature_id: 1, feature_key: "TRAINING_LAYOUT", feature_name: "교육장 대형 배치" },
  { feature_id: 2, feature_key: "ZOOM_DEVICE",     feature_name: "ZOOM 전용 장비"  },
  { feature_id: 3, feature_key: "ZOOM_MIC",        feature_name: "ZOOM 마이크"      },
  { feature_id: 4, feature_key: "ZOOM_SPEAKER",    feature_name: "ZOOM 스피커"      },
];

// ─── room 테이블 ────────────────────────────────────────────────────────────
export const ROOMS_DB: Room[] = [
  // 1층
  { room_id:1, floor_id:1, room_code:"CONF_ROOM_1", room_name:"1F Conference Room 1", room_name_ko:"1층 컨퍼런스 룸 1", capacity:4,  notes:"외부 MEETING 우선 회의실", is_active:true, color:"#111111", thumbnail:"" },
  { room_id:2, floor_id:1, room_code:"CONF_ROOM_2", room_name:"1F Conference Room 2", room_name_ko:"1층 컨퍼런스 룸 2", capacity:8,  notes:"외부 MEETING 우선 회의실", is_active:true, color:"#111111", thumbnail:"" },
  // 2층
  { room_id:3, floor_id:2, room_code:"EMERALD",     room_name:"2F Emerald",            room_name_ko:"2층 에메랄드", capacity:20, notes:"교육장 대형 배치, HR 예약 문의", is_active:true, color:"#111111", thumbnail:"" },
  { room_id:4, floor_id:2, room_code:"DIAMOND",     room_name:"2F Diamond",            room_name_ko:"2층 다이아몬드", capacity:12, notes:"ZOOM 전용 장비 설치",          is_active:true, color:"#111111", thumbnail:"" },
  { room_id:5, floor_id:2, room_code:"RUBY",        room_name:"2F Ruby",               room_name_ko:"2층 루비",     capacity:8,  notes:"ZOOM 마이크, 스피커 설치",      is_active:true, color:"#111111", thumbnail:"" },
  // 3~6층
  { room_id:6, floor_id:3, room_code:"CONF_ROOM",   room_name:"3F Conference Room",    room_name_ko:"3층 컨퍼런스 룸",   capacity:10, notes:"ZOOM 마이크, 스피커 설치",      is_active:true, color:"#111111", thumbnail:"" },
  { room_id:7, floor_id:4, room_code:"CONF_ROOM",   room_name:"4F Conference Room",    room_name_ko:"4층 컨퍼런스 룸",   capacity:12, notes:"ZOOM 마이크, 스피커 설치",      is_active:true, color:"#111111", thumbnail:"" },
  { room_id:8, floor_id:5, room_code:"CONF_ROOM",   room_name:"5F Conference Room",    room_name_ko:"5층 컨퍼런스 룸",   capacity:8,  notes:"ZOOM 마이크, 스피커 설치",      is_active:true, color:"#111111", thumbnail:"" },
  { room_id:9, floor_id:6, room_code:"CONF_ROOM",   room_name:"6F Conference Room",    room_name_ko:"6층 컨퍼런스 룸",   capacity:8,  notes:"ZOOM 마이크, 스피커 설치",      is_active:true, color:"#111111", thumbnail:"" },
];

// ─── room_feature 매핑 ──────────────────────────────────────────────────────
export const ROOM_FEATURES: RoomFeature[] = [
  // 1층 두 방: 외부 미팅 우선 → room_rule로 처리, feature 없음
  // 2층 EMERALD(3): 교육장 배치
  { room_id:3, feature_id:1, value_text:null },
  // 2층 DIAMOND(4): ZOOM 전용 장비
  { room_id:4, feature_id:2, value_text:"전용 장비 설치" },
  // 2층 RUBY(5): ZOOM 마이크 + 스피커
  { room_id:5, feature_id:3, value_text:null },
  { room_id:5, feature_id:4, value_text:null },
  // 3층 CONF_ROOM(6): ZOOM 마이크 + 스피커
  { room_id:6, feature_id:3, value_text:null },
  { room_id:6, feature_id:4, value_text:null },
  // 4층 CONF_ROOM(7): ZOOM 마이크 + 스피커
  { room_id:7, feature_id:3, value_text:null },
  { room_id:7, feature_id:4, value_text:null },
  // 5층 CONF_ROOM(8): ZOOM 마이크 + 스피커
  { room_id:8, feature_id:3, value_text:null },
  { room_id:8, feature_id:4, value_text:null },
  // 6층 CONF_ROOM(9): ZOOM 마이크 + 스피커
  { room_id:9, feature_id:3, value_text:null },
  { room_id:9, feature_id:4, value_text:null },
];

// ─── room_rule 테이블 ────────────────────────────────────────────────────────
export const ROOM_RULES: RoomRule[] = [
  { rule_id:1, room_id:3, rule_type:"ADMIN_ONLY", rule_text:"관리자(Admin) 전용 예약 회의실입니다." },
];

// Admin 전용 회의실 id 집합
// ⚠️ Supabase 전환 후엔 rooms.is_admin_only 컬럼이 source of truth
// 아래는 fallback 용도 (Supabase 미연결 시)
export const ADMIN_ONLY_ROOMS = new Set(
  ROOM_RULES.filter(r => r.rule_type === "ADMIN_ONLY").map(r => r.room_id)
);

/** Supabase에서 로드된 rooms 배열 기준으로 Admin 전용 Set 생성 */
export function getAdminOnlyRooms(rooms: Room[]): Set<number> {
  return new Set(rooms.filter(r => r.is_admin_only).map(r => r.room_id))
}

// ─── app_user 테이블 ─────────────────────────────────────────────────────────
export const APP_USERS: AppUser[] = [
  { user_id:"u001", employee_id:"CNR0001", name:"고현정",  dept:"MS",        role:"USER",  email:"gohyunjung@cnrres.com",       is_active:true },
  { user_id:"u002", employee_id:"CNR0002", name:"어드민",  dept:"MS",        role:"ADMIN", email:"gohyunjung@me.com",           is_active:true },
  { user_id:"u003", employee_id:"CNR0003", name:"박찬희",  dept:"MS",        role:"USER",  email:"chpark@cnrres.com",           is_active:true },
  { user_id:"u004", employee_id:"CNR0004", name:"송보람",  dept:"MS",        role:"USER",  email:"song.boram@cnrres.com",       is_active:true },
  { user_id:"u005", employee_id:"CNR0005", name:"김기남",  dept:"파트장",     role:"USER",  email:"knkim@cnrres.com",            is_active:true },
  { user_id:"u006", employee_id:"CNR0006", name:"임지영",  dept:"HR",        role:"USER",  email:"jyim@cnrres.com",             is_active:true },
  { user_id:"u007", employee_id:"CNR0007", name:"강동원",  dept:"Platform",  role:"USER",  email:"kangdw@cnrresearch.com",      is_active:true },
  { user_id:"u008", employee_id:"CNR0008", name:"윤하은",  dept:"RWO",       role:"USER",  email:"yoonhe@cnrresearch.com",      is_active:true },
  { user_id:"u009", employee_id:"CNR0009", name:"오세훈",  dept:"BD",        role:"USER",  email:"ohsh@cnrresearch.com",        is_active:true },
  { user_id:"u010", employee_id:"CNR0010", name:"임채원",  dept:"CTM",       role:"USER",  email:"limcw@cnrresearch.com",       is_active:true },
  { user_id:"u011", employee_id:"CNR0011", name:"송지원",  dept:"CO",        role:"USER",  email:"songjw@cnrresearch.com",      is_active:true },
  { user_id:"u012", employee_id:"CNR0012", name:"황민서",  dept:"Platform",  role:"USER",  email:"hwangms@cnrresearch.com",     is_active:true },
  { user_id:"u013", employee_id:"CNR0013", name:"조성현",  dept:"임원",       role:"ADMIN", email:"joshh@cnrresearch.com",       is_active:true },
  { user_id:"u014", employee_id:"CNR0014", name:"나지은",  dept:"RWO",       role:"USER",  email:"naje@cnrresearch.com",        is_active:true },
  { user_id:"u015", employee_id:"CNR0015", name:"류승민",  dept:"BD",        role:"USER",  email:"ryusm@cnrresearch.com",       is_active:true },
  { user_id:"u016", employee_id:"CNR0016", name:"홍길동",  dept:"CTM",       role:"ADMIN", email:"gohyunjung@cnrres.com",       is_active:true },
];

// ─── 헬퍼 함수 ──────────────────────────────────────────────────────────────

export function getRoomFeatures(roomId: number) {
  return ROOM_FEATURES
    .filter(rf => rf.room_id === roomId)
    .map(rf => {
      const f = FEATURES.find(f => f.feature_id === rf.feature_id)
      return { ...f, value_text: rf.value_text }
    })
}

export function getFloor(floorId: number | undefined): Floor {
  return FLOORS.find(f => f.floor_id === floorId) ?? { floor_id: 0, floor_name: '', floor_no: 0 } as Floor
}

export function getRoomById(roomId: number): Room | undefined {
  return ROOMS_DB.find(r => r.room_id === roomId)
}

export function getUserByName(name: string): AppUser | undefined {
  return APP_USERS.find(u => u.name === name)
}

export function getRoomThumbnail(roomId: number): string | null {
  const room = ROOMS_DB.find(r => r.room_id === roomId)
  return room?.thumbnail || null
}

export function getRoomGallery(roomId: number): string[] {
  const room = ROOMS_DB.find(r => r.room_id === roomId)
  return room?.gallery || []
}
