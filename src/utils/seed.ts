import { nowMinutes, todayStr, fmt2, makeTZ, timeToMin, objToStr, dateToObj } from './time'
import type { Booking } from '../types'
import { ROOMS_DB, APP_USERS, getFloor } from '../data/master'

// ─── localStorage 헬퍼 (Supabase 전환 전) ────────────────────────────────
function localGet(key: string): { value: string } | null {
  try {
    const v = localStorage.getItem(key)
    return v ? { value: v } : null
  } catch { return null }
}
function localSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch {}
}


// ─── Seed Data ────────────────────────────────────────────────────────────────
export function seedDemoBookings() {
  const now = nowMinutes();
  const today = todayStr();

  // 오늘 현재 시각 기준 실시간 예약 (시연용)
  // curE가 curS보다 항상 크도록 보정 (엣지케이스: 특정 시각대에 역방향 예약 생성 방지)
  const rawCurEH = Math.min(19, Math.floor((now + 50) / 60));
  const rawCurSH = Math.max(7,  Math.floor((now - 40) / 60));
  const safeCurSH = Math.min(rawCurSH, rawCurEH - 1);  // curS는 항상 curE보다 최소 1시간 이전
  const curS = fmt2(Math.max(7, safeCurSH)) + ":00";
  const curE = fmt2(rawCurEH) + ":00";
  const nxtS = fmt2(Math.min(18,Math.floor((now+25)/60)))+":30";
  const nxtE = fmt2(Math.min(19,Math.floor((now+85)/60)))+":30";

  // ── 3월 전체 더미 데이터 ─────────────────────────────────────────────────
  // 주말(토=6, 일=0) 제외 평일만 생성
  const USERS = [
    {user:"고현정", dept:"MS"},      {user:"어드민", dept:"MS"},
    {user:"박찬희", dept:"MS"},      {user:"송보람", dept:"MS"},
    {user:"김기남", dept:"파트장"},   {user:"임지영", dept:"HR"},
    {user:"강동원", dept:"Platform"},{user:"윤하은", dept:"RWO"},
    {user:"오세훈", dept:"BD"},     {user:"임채원", dept:"CTM"},
    {user:"송지원", dept:"CO"},     {user:"황민서", dept:"Platform"},
    {user:"조성현", dept:"임원"},   {user:"나지은", dept:"RWO"},
    {user:"류승민", dept:"BD"},
  ];
  const TITLES = [
    "Q1 전략 보고", "주간 팀 스탠드업", "임원 미팅", "파트너사 PT", "디자인 리뷰",
    "스프린트 회고", "1:1 면담", "전사 OKR 점검", "반기 성과 공유", "신규 프로젝트 킥오프",
    "채용 인터뷰", "제품 로드맵 리뷰", "외부 클라이언트 미팅", "월간 보고", "마케팅 전략 논의",
    "개발 아키텍처 리뷰", "HR 운영 회의", "계약 검토", "BD 파이프라인 공유", "예산 집행 점검",
    "CS 개선 논의", "온보딩 오리엔테이션", "전략 워크숍", "리스크 관리 회의", "파트너십 논의",
    "플랫폼 운영 점검", "UX 리서치 공유", "분기 목표 설정", "주간 리더십 싱크", "기술 세미나",
  ];
  const SLOTS = [
    // ── 30분 미팅 ──
    ["10:00","10:30"],["10:15","10:45"],["10:30","11:00"],["10:45","11:15"],
    ["11:00","11:30"],["11:15","11:45"],["11:30","12:00"],["11:45","12:15"],
    ["12:00","12:30"],["12:15","12:45"],["12:30","13:00"],
    // ── 45분 미팅 ──
    ["10:00","10:45"],["10:15","11:00"],["10:30","11:15"],["10:45","11:30"],
    ["11:00","11:45"],["11:15","12:00"],["11:30","12:15"],["12:00","12:45"],
    // ── 1시간 미팅 ──
    ["10:00","11:00"],["10:15","11:15"],["10:30","11:30"],["10:45","11:45"],
    ["11:00","12:00"],["11:15","12:15"],["11:30","12:30"],["12:00","13:00"],
    // ── 1시간 15분 미팅 ──
    ["10:00","11:15"],["10:30","11:45"],["11:00","12:15"],["11:30","12:45"],
    // ── 1시간 30분 미팅 ──
    ["10:00","11:30"],["10:30","12:00"],["11:00","12:30"],["11:30","13:00"],
    // ── 2시간 미팅 ──
    ["10:00","12:00"],["10:30","12:30"],["11:00","13:00"],
  ];

  const bookings = [];
  let idx = 1;

  for (let day = 1; day <= 31; day++) {
    const dateStr = `2026-03-${fmt2(day)}`;
    const dow = new Date(2026, 2, day).getDay(); // 0=일,6=토
    if (dow === 0 || dow === 6) continue; // 주말 제외

    const isPast   = dateStr < today;
    const isToday  = dateStr === today;

    // 하루 예약 수: 평일 5~9건 랜덤
    const seed = day * 37 + dow * 13;
    const count = 5 + (seed % 5);

    // 회의실별 슬롯 충돌 방지
    const roomSlots = {}; // room_id -> [[startMin, endMin]]

    const overlaps = (rid, s, e) => {
      if (!roomSlots[rid]) return false;
      const sm = timeToMin(s), em = timeToMin(e);
      return roomSlots[rid].some(([a,b]) => sm < b && em > a);
    };
    const addSlot = (rid, s, e) => {
      if (!roomSlots[rid]) roomSlots[rid] = [];
      roomSlots[rid].push([timeToMin(s), timeToMin(e)]);
    };

    // 오늘이면 현재 진행중/곧 시작 예약 먼저 고정
    if (isToday) {
      // 현재 진행중
      bookings.push({id:`m${idx++}`, room_id:2, start_at:makeTZ(today,curS), end_at:makeTZ(today,curE),
        title:"Q1 전략 보고", user:"고현정", dept:"MS", checkedIn:true, autoCancelled:false, createdAt:Date.now()-7200000});
      addSlot(2, curS, curE);
      bookings.push({id:`m${idx++}`, room_id:3, start_at:makeTZ(today,curS), end_at:makeTZ(today,curE),
        title:"임원 미팅", user:"어드민", dept:"MS", checkedIn:true, autoCancelled:false, createdAt:Date.now()-3600000});
      addSlot(3, curS, curE);
      // 곧 시작
      if (!overlaps(5, nxtS, nxtE)) {
        bookings.push({id:`m${idx++}`, room_id:5, start_at:makeTZ(today,nxtS), end_at:makeTZ(today,nxtE),
          title:"주간 팀 스탠드업", user:"송보람", dept:"MS", checkedIn:false, autoCancelled:false, createdAt:Date.now()});
        addSlot(5, nxtS, nxtE);
      }
      // ── 15:00 테스트용: 9개 회의실 전부 동시 예약 ──────────────────────
      const TEST15 = [
        {room_id:1, title:"파트너사 PT",       user:"박찬희", dept:"MS"},
        {room_id:2, title:"Q2 전략 워크숍",    user:"고현정", dept:"MS"},
        {room_id:3, title:"전사 OKR 점검",     user:"김기남", dept:"파트장"},
        {room_id:4, title:"플랫폼 아키텍처",   user:"강동원", dept:"Platform"},
        {room_id:5, title:"채용 인터뷰",        user:"임지영", dept:"HR"},
        {room_id:6, title:"월간 리더십 싱크",   user:"조성현", dept:"임원"},
        {room_id:7, title:"BD 파이프라인 공유", user:"류승민", dept:"BD"},
        {room_id:8, title:"CS 개선 논의",       user:"임채원", dept:"CTM"},
        {room_id:9, title:"HR 운영 회의",       user:"나지은", dept:"RWO"},
      ];
      for (const t of TEST15) {
        if (!overlaps(t.room_id, "15:00", "16:00")) {
          bookings.push({id:`t15_${t.room_id}`, room_id:t.room_id, start_at:makeTZ(today,"15:00"), end_at:makeTZ(today,"16:00"), title:t.title, user:t.user, dept:t.dept,
            checkedIn:false, autoCancelled:false, createdAt:Date.now()});
          addSlot(t.room_id, "15:00", "16:00");
        }
      }
    }

    let placed = 0;
    let attempt = 0;
    while (placed < count && attempt < 80) {
      attempt++;
      const si = (seed * attempt * 7 + day * 3) % SLOTS.length;
      const ui = (seed * attempt * 11 + day * 5) % USERS.length;
      const ti = (seed * attempt * 13 + day * 7) % TITLES.length;
      const ri = (seed * attempt * 17 + placed * 3) % 9 + 1;
      const [s, e] = SLOTS[si];

      if (overlaps(ri, s, e)) continue;

      // 과거: 노쇼율 약 15%, 체크인율 약 75%
      // 미래: 모두 checkedIn:false, autoCancelled:false
      let checkedIn = false, autoCancelled = false;
      if (isPast) {
        const r = (seed * attempt + day) % 100;
        autoCancelled = r < 15;
        checkedIn = !autoCancelled && r < 90;
      }

      bookings.push({
        id: `m${idx++}`,
        room_id: ri,
        start_at: makeTZ(dateStr, s), end_at: makeTZ(dateStr, e),
        title: TITLES[ti],
        user: USERS[ui].user,
        dept: USERS[ui].dept,
        checkedIn,
        autoCancelled,
        createdAt: Date.now() - (isPast ? (today.localeCompare(dateStr)) * 86400000 : 0),
        _seed: true,
      });
      addSlot(ri, s, e);
      placed++;
    }
  }

  return bookings;
}

export async function loadBookings() {
  // seed 데이터(실시간 시각 기반)는 항상 새로 생성.
  // 사용자가 직접 만든 예약(_seed:false)만 storage에서 복원해 합친다.
  const todayKey = "room-bk-v8-" + todayStr();
  const freshSeed = seedDemoBookings();
  try {
    const r = localGet(todayKey);
    if (r && r.value) {
      const parsed = JSON.parse(r.value);
      // 사용자 예약만 추출 (seed가 아닌 것)
      const userBookings = parsed.filter(b => b._seed === false);
      if (userBookings.length > 0) {
        const merged = [...freshSeed, ...userBookings];
        return merged;
      }
    }
  } catch(_){}
  // 사용자 예약 없으면 fresh seed만 저장/반환
  await saveBookings(freshSeed);
  return freshSeed;
}
export async function saveBookings(b) {
  const todayKey = "room-bk-v8-" + todayStr();
  // 사용자 예약만 저장 (seed는 매번 재생성하므로 저장 불필요)
  const toStore = b.filter(bk => bk._seed === false);
  try { localSet(todayKey, JSON.stringify(toStore)); } catch(_){}
}

// Admin에서 저장한 회의실 데이터 로드 (이미지 포함) — 없으면 기본값 사용
export async function loadRooms() {
  try { const r=localGet("admin-rooms-v10"); if(r&&r.value) return JSON.parse(r.value); } catch(_){}
  return ROOMS_DB;
}
export async function saveRooms(r) { try { localSet("admin-rooms-v10",JSON.stringify(r)); } catch(_){} }

// 사용자 데이터 로드/저장
export async function loadUsers() {
  try { const r=localGet("admin-users-v2"); if(r&&r.value) return JSON.parse(r.value); } catch(_){}
  return APP_USERS;
}
export async function saveUsers(u) { try { localSet("admin-users-v2",JSON.stringify(u)); } catch(_){} }