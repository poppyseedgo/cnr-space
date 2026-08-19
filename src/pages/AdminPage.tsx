/**
 * AdminPage.tsx — 어드민 페이지 (대시보드 / 예약 / 승인 관리 / 회의실 / 사용자)
 *
 * ✅ 변경 이력
 *  - [2026-06-10] 대시보드 '승인 대기' 카드(위젯 ①) 클릭 동작 변경
 *    · 기존: setCardDrawer({ type: 'pending' }) → DetailDrawer 'pending' 오픈
 *      문제: 드로어 기본 진입 기간(최근 30일) + 날짜모드 필터에 대기 예약이 걸려 목록이 비어 보임
 *    · 변경: onGoApprovals() 호출 → setTab('approvals')로 '승인 관리' 메뉴 페이지로 즉시 이동
 *      (AdminApprovalTable이 대기 건을 정상 표시 — 드로어 우회)
 *    · 영향 파일 내: AdminView(onGoApprovals prop 전달) / AdminDashboard(시그니처 + 카드 onClick)
 *    · 다른 카드(②노쇼 ③최근예약 ④~⑧ 등)의 DetailDrawer 동작은 그대로 보존
 */
import { useState, useEffect, useRef, useMemo, useCallback, memo, useLayoutEffect } from 'react'
import { DateField } from '../components/common/DateField' // ← [2026-08-03] 공통 날짜 필드
import { HolidayAdminPanel } from '../components/admin/HolidayAdminPanel' // ← [2026-08-03] 공휴일·이벤트 관리 (Phase C)
import { createPortal } from 'react-dom'  // ← [2026-05-06 사이드 sticky 핫픽스] 사이드 네비를 body 직접 mount하기 위함
import { AlertCircle, AlertTriangle, ArrowUpDown, Ban, BarChart2, Building2, Calendar, CheckCircle2, ChevronDown, Clock, Download, ImagePlus, Inbox, RefreshCw, RotateCw, Search, Trash2, Upload, Users, X } from 'lucide-react'
import { Button } from '../components/common/Button'
import { ModalCloseButton } from '../components/common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화
import {
  todayStr, tsDate, tsMin, tsTime, fmtTime, fmtTSDateFull, fmtTSRangeFull,
  fmt2, objToStr, addDays,
} from '../utils/time'
import { FLOORS, getFloor } from '../data/floors'
import {
  uploadRoomImage, deleteRoomImage, saveRoomImages, loadRoomImages,
  cancelBooking as apiCancelBooking, insertAuditLog, upsertRoom,
  toggleRoomActive, saveRoomFeatures, loadFeatures, updateProfile,
  loadAllRooms, loadBookingsByRange, expirePendingBooking,
  syncAllUsers, loadUsers, loadDepartedUsers, type SyncResult,
  // ← [2026-07-30] countFutureBookings/manualDepartUser import 제거 —
  //   수동 퇴사는 EmploymentStatusModal → depart-user Edge Function 경로로 이관.
  //   (manualDepartUser 는 api.ts 에서 제거 — 비원자적·노쇼 오염 구방식)
} from '../lib/api'
import type { Booking, Room, AppUser, DepartedUser } from '../types'
import { EmploymentStatusModal } from '../components/admin/EmploymentStatusModal' // ← [2026-07-30] 상태 변경·즉시 퇴사 모달
import { EmploymentBadge, departedNameStyle } from '../components/common/EmploymentBadge' // ← [2026-07-30] 재직 라벨 + 퇴사 취소선
import { ModalPortal } from '../components/common/ModalPortal'
// ← [2026-04-18 P0 fix] 파일 중간에 있던 import 3개를 최상단으로 이동
//   원인: ES 모듈 사양상 import는 파일 최상단만 허용. Vite dev는 관대하지만
//   Rollup 프로덕션 빌드에서 청크 분할 시 로드 순서가 꼬여 lazy export가
//   undefined로 평가되는 현상 발생 (배포 직후 뷰 전환 시 흰 화면)
import { UserAvatar } from '../components/common/UserAvatar'
import { UserChip } from '../components/common/UserChip'
import { BookingListTable } from '../components/common/BookingListTable'
import { PurposeChip } from '../components/common/PurposeChip'  // ← [2026-07-27 목적 Phase 3] 예약 목록 목적 컬럼
import { purposeExportText } from '../data/bookingPurpose'      // ← [2026-07-27 목적 Phase 3] CSV 목적 표기 SSOT
import { BookingStatusBadge } from '../components/common/BookingStatusBadge'  // ← [2026-05-28] DetailDrawer 테이블 인라인 status 판정 → 공통 컴포넌트 교체용
// ← [2026-05-06 Admin Phase A] 좌측 사이드 네비게이션 컴포넌트 신설 (Figma node 451:3522)
import { useBreakpoint } from '../hooks/useBreakpoint'   // ← [2026-07-24] 대시보드 반응형 컬럼 계산
import { AdminSideNav, type AdminTabId } from '../components/layout/AdminSideNav'
// ← [2026-07-23] 알림 설정 패널 — 알림 종류×채널 on/off + 관리자 수신자 지정
import { NotificationSettingsPanel } from '../components/common/NotificationSettingsPanel'
// ← [2026-07-24] 공지 배너 관리 패널
import { AnnouncementPanel } from '../components/common/AnnouncementPanel'
// ← [2026-07-27] KB 관리 패널 — GA 챗봇 지식베이스(kb_chunks) 편집
import { KBAdminPanel } from '../components/common/KBAdminPanel'
// ← [2026-07-24 Phase 4] 역할 정리용 매트릭스 (사용자 × 역할)
import { AdminRoleMatrix } from '../components/common/AdminRoleMatrix'
// ← [2026-07-24] 관리자 권한 Phase 1 — 역할 카탈로그 + 부여 API
import { ADMIN_ROLES, GRANTABLE_ROLES, NORMAL_ROLES, SUPER_ROLE,
         visibleTabs, roleSummary } from '../data/adminRoles'
import { loadMyAdminRoles, loadAllUserRoles, setUserAdminRoles, loadRoleGrantLog, type RoleGrantLog } from '../lib/api'
// ← [2026-08-05] 노쇼 관리 패널 — bookings 탭 하위 뷰 (기간 프리셋 + 해제/영구삭제)
import { NoshowAdminPanel } from '../components/admin/NoshowAdminPanel'
import { ResourceAdminPanel } from '../components/admin/ResourceAdminPanel'  // ← [2026-08-19] 자원 관리 (Phase 3)
// ← [2026-05-06 Admin Phase C] 승인 관리 테이블 컴포넌트 신설 (Figma node 451:3534, Phase B 공통 컴포넌트 사용)
import { AdminApprovalTable } from '../components/common/AdminApprovalTable'
import { VisitorLogPanel } from '../components/common/VisitorLogPanel'  // ← [2026-07-10] 방문로그 관리 패널
import { BookAdminPanel } from '../components/library/BookAdminPanel'  // ← [2026-07-23] 도서 관리 패널
import { exportCSV } from '../utils/csv'  // ← [2026-07-23] 지역 함수에서 공용 유틸로 이동
// ← [2026-05-11 Phase 2] isNoshow 통일 — utils/noshow.ts SSOT 사용
//   기존 분산: L186 / L783 / L1073 (모두 옛 autoCancelled 룰)
//   변경 사유: cron ②③ 비활성화 후 markNoshow API가 status='confirmed' 유지 → 확정 룰이 더 정확
//   영향: contaminated 데이터(status='cancelled' 시절) 제외 + 강제취소 자동 분리
import { isNoshow } from '../utils/noshow'
// ← [2026-07-23 버그수정] 승인 대기 판정 SSOT — 기한 초과 pending을 첫 렌더부터 제외
import { isAwaitingApproval, isExpiredPending, countAwaitingApproval } from '../utils/pendingStatus'
// ← [2026-07-23 버그수정] 기간 길이별 자동 롤업 — 막대 수 폭발/그래프 소실 방지
import { buildSeries, BUCKET_LABEL } from '../utils/timeSeries'
import { getBookingStatusLabel, getBookingStatusGroup } from '../utils/bookingStatusLabel'  // ← [2026-07-23] 집계용 그룹 매핑 추가  // ← [2026-05-28] CSV 내보내기 단일 라벨 SSOT — 옛 룰 인라인 분기 대체
// ← [2026-07-23 대시보드 개편 Phase 1] 카드 헤더 날짜행 공통화
//   기존: DatePickerPopup을 직접 import + SmallDateTrigger를 이 파일에 정의 + 6개 위젯이 인라인 조립
//   변경: DashboardRangeFilter.tsx로 이동 — SmallDateTrigger·프리셋 pill·⎯ 를 DashboardRangeRow 하나로 캡슐화
//   ※ DatePickerPopup의 유일한 사용처가 SmallDateTrigger였으므로 이 파일에서 import 제거
import { DashboardRangeRow, SmallDateTrigger, RANGE_PRESETS_RECENT,
         useReportRange, type CardRangeReporter, type CardRange } from '../components/admin/DashboardRangeFilter'
// ← [2026-07-23 Phase 2] 신규 위젯 2종 + 집계 SSOT + 기간조회 훅 분리
//   aggregateUsers: DetailDrawer userAgg 본문을 utils로 추출 — 카드와 드로어가 같은 집계를 쓰도록 강제
//   useBookingsByRange: AdminPage에 있던 훅을 이동 (신규 카드 파일이 import하면 순환참조가 되므로)
import { UserRankingCard, UserNoshowCard } from '../components/admin/DashboardUserCards'
import { MeetingPurposeCard } from '../components/admin/MeetingPurposeCard'      // ← [2026-07-23 Phase 3] 위젯 ⑨
import { DashboardUserCell } from '../components/admin/DashboardUserCell'         // ← [2026-07-23] 사용자 표시 공통 셀
import { RoomUtilizationCard, RoomUtilizationByRoomCard } from '../components/admin/RoomUtilizationCard'  // ← [2026-07-23] 요일별 가동률 + 회의실별 가동률
import { aggregatePurposes, aggregatePurposeByDept, classifyPurpose, PURPOSE_DEFS, type PurposeCode } from '../utils/meetingPurpose'  // ← [2026-07-23] 분류·집계 SSOT (DetailDrawer 공용) + 드릴다운 판정
import { useBookingsByRange } from '../components/admin/useBookingsByRange'
import { aggregateUsers } from '../utils/dashboardAgg'
// ← [2026-07-24] 회의실 드로어에 '가동률' 컬럼 추가 — 카드와 같은 calcUtilization 을 쓴다.
//   집계를 새로 짜면 카드는 86%, 드로어는 다른 값이 되는 이중 진실이 생긴다.
import { calcUtilization } from '../utils/roomUtilization'
// ← [2026-07-24] 드로어 공통 컴포넌트 (Figma 2669:10902)
//   셸·조작부·표를 각각 파일로 분리했다. 드로어 안에서만 쓰는 마크업을
//   AdminPage(4000줄)에 인라인으로 두면 Figma 개정 때마다 이 파일을 헤집게 된다.
import { DrawerShell, type Crumb } from '../components/admin/drawer/DrawerShell'
import { DrawerRangeFilter, DrawerStatChips, DrawerCsvButton, DrawerPagination,
         type DrawerChip } from '../components/admin/drawer/DrawerControls'
import { BookingTable } from '../components/admin/drawer/BookingTable'
// ← [2026-07-24 #8] 집계 표를 드로어 공통 컴포넌트로 이동.
//   AggTable 이라는 이름으로 6개 호출부가 쓰고 있어 별칭으로 받는다(호출부 무변경).
import { AggregateTable as AggTable } from '../components/admin/drawer/AggregateTable'

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────
// ⚠ [2026-07-24 #4] utils/time.addDays 위임 — 날짜 계산 SSOT 통일.
//   기존은 `new Date(base)`(UTC 파싱) + objToStr(로컬 포맷) 조합이라
//   KST 에서는 우연히 맞았지만 UTC−오프셋 지역에서는 하루가 밀린다.
//   대시보드 전 카드가 같은 함수를 쓰도록 한 곳으로 모은다.
function addDaysStr(base: string, days: number): string {
  return addDays(base, days)
}
function getMonthStart(offset = 0): string {
  const d = new Date(); d.setMonth(d.getMonth() + offset, 1)
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`
}
function getMonthEnd(offset = 0): string {
  const d = new Date(); d.setMonth(d.getMonth() + offset + 1, 0)
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`
}
function getYearStart(): string {
  return `${new Date().getFullYear()}-01-01`
}

// ─── 기간 프리셋 ──────────────────────────────────────────────────────────────
const today = todayStr()
const PRESETS = [
  { id: 'today',     label: '오늘',    fn: (): [string,string] => [today, today] },
  { id: 'yesterday', label: '어제',    fn: (): [string,string] => { const y=addDaysStr(today,-1); return [y,y] } },
  { id: '7d',        label: '7일',     fn: (): [string,string] => [addDaysStr(today,-6), today] },
  { id: '30d',       label: '30일',    fn: (): [string,string] => [addDaysStr(today,-29), today] },
  { id: '90d',       label: '90일',    fn: (): [string,string] => [addDaysStr(today,-89), today] },
  { id: 'thisMonth', label: '이번 달', fn: (): [string,string] => [getMonthStart(0), today] },
  { id: 'lastMonth', label: '지난 달', fn: (): [string,string] => [getMonthStart(-1), getMonthEnd(-1)] },
  { id: 'thisYear',  label: '올해',    fn: (): [string,string] => [getYearStart(), today] },
  { id: 'custom',    label: '기간 지정', fn: (): [string,string] => [addDaysStr(today,-29), today] },
]

// ─── 차트 공통 ────────────────────────────────────────────────────────────────
const PIE_COLORS  = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#06B6D4','#3B82F6','#F97316']

// ─── DateRangePicker ──────────────────────────────────────────────────────────
function DateRangePicker({ from, to, onChangeFn, presetId, onPreset, compact = false }:
  { from:string; to:string; onChangeFn:(from:string,to:string)=>void; presetId:string; onPreset:(id:string,from:string,to:string)=>void; compact?:boolean }) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo,   setCustomTo]   = useState(to)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e:MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const curPreset = PRESETS.find(p => p.id === presetId)
  const label = presetId === 'custom' ? `${from} ~ ${to}` : curPreset?.label ?? '기간 선택'

  const applyPreset = (p: typeof PRESETS[0]) => {
    const [f,t] = p.fn()
    onPreset(p.id, f, t)
    if (p.id !== 'custom') setOpen(false)
    else { setCustomFrom(f); setCustomTo(t) }
  }
  const applyCustom = () => { onPreset('custom', customFrom, customTo); setOpen(false) }

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button className="btn" onClick={() => setOpen(v => !v)}
        style={{ display:'flex', alignItems:'center', gap:6, padding: compact ? '6px 10px' : '8px 14px',
          borderRadius:10, border:'1px solid #E2E8F0', background:'#fff', fontSize:compact?11:12,
          fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>
        <Calendar size={12} strokeWidth={1.8}/>
        {label}
        <ChevronDown size={12} strokeWidth={1.8} style={{opacity:0.5,transform: open ? 'rotate(180deg)' : 'none',transition:'transform 0.2s'}}/>
      </button>
      {open && (
        <div className="anm" style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:300,
          background:'#fff', border:'1px solid #E2E8F0', borderRadius:14,
          boxShadow:'0 8px 32px rgba(0,0,0,0.12)', minWidth:280, overflow:'hidden' }}>
          <div style={{ padding:'10px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
            {PRESETS.filter(p => p.id !== 'custom').map(p => (
              <button key={p.id} className="btn" onClick={() => applyPreset(p)}
                style={{ padding:'7px 10px', fontSize:12, borderRadius:8, textAlign:'left',
                  fontWeight: presetId===p.id ? 700 : 400,
                  background: presetId===p.id ? '#111' : '#F8FAFC',
                  color: presetId===p.id ? '#fff' : '#374151' }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ borderTop:'1px solid #F1F5F9', padding:'10px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#94A3B8', marginBottom:8 }}>직접 입력</div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
              {/* ← [2026-08-03] native date → 공통 DateField */}
              <DateField value={customFrom} onChange={setCustomFrom}
                style={{ flex:1, padding:'7px 10px', borderRadius:8, fontSize:12, background:'#F8FAFC' }}/>
              <span style={{ color:'#CBD5E1', fontSize:11 }}>~</span>
              <DateField value={customTo} onChange={setCustomTo}
                style={{ flex:1, padding:'7px 10px', borderRadius:8, fontSize:12, background:'#F8FAFC' }}/>
            </div>
            <button className="btn" onClick={applyCustom}
              style={{ width:'100%', padding:'8px', borderRadius:8, background:'#111', color:'#fff', fontSize:12, fontWeight:600 }}>
              조회
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CSV Export 유틸 ──────────────────────────────────────────────────────────
//   ← [2026-07-23] 구현을 src/utils/csv.ts 로 이동했다.
//     도서 관리 탭에서도 같은 함수가 필요한데 이 파일의 지역 함수라 import 가
//     불가능했다. 복사하면 BOM/escape 규칙이 두 벌이 되어 한쪽만 고쳐진다.
//     동작은 동일하다 — 위치만 옮기고 여기서는 import 해서 쓴다.

// ─── Detail Drawer ─────────────────────────────────────────────────────────────
type DetailType = 'bookings'|'noshow'|'rooms'|'dept'|'hours'|'pending'|'users'|'purpose'  // ← [2026-07-23 Phase 3] 'purpose' 추가 — 위젯 ⑨ 전체 10분류 드릴다운
interface DetailConfig { type: DetailType; title: string; icon: React.ReactNode }

const DETAIL_META: Record<DetailType, { title: string; icon: React.ReactNode }> = {
  bookings: { title: '예약 전체 목록',     icon: <Calendar size={16} strokeWidth={1.8}/> },
  noshow:   { title: '노쇼 목록',          icon: <AlertCircle size={16} strokeWidth={1.8}/> },
  rooms:    { title: '회의실별 예약 통계', icon: <Building2 size={16} strokeWidth={1.8}/> },
  dept:     { title: '부서별 예약 통계',   icon: <Users size={16} strokeWidth={1.8}/> },
  hours:    { title: '시간대별 분포',      icon: <Clock size={16} strokeWidth={1.8}/> },
  pending:  { title: '승인 대기 목록',     icon: <Inbox size={16} strokeWidth={1.8}/> },
  users:    { title: '사용자 예약 현황',   icon: <Users size={16} strokeWidth={1.8}/> },
  purpose:  { title: '회의 목적별 통계',   icon: <BarChart2 size={16} strokeWidth={1.8}/> },  // ← [2026-07-23 Phase 3]
}

/**
 * 드로어 서브타이틀 (← [2026-07-24])
 *
 * 제목만으로는 "이 표의 숫자가 무엇인지" 를 알 수 없다. 특히 가동률처럼 분모가 있는
 * 지표는 정의가 제목 옆에 붙어 있어야 하고, 표 위 주석으로 밀어넣으면 스크롤로 갈라진다.
 */
const DETAIL_SUBTITLE: Record<DetailType, string> = {
  bookings: '선택한 기간에 등록된 예약 전체입니다.',
  noshow:   '체크인 없이 자동 취소된 예약입니다. 승인 기한이 지나 취소된 건은 포함하지 않습니다.',
  rooms:    '예약 = 건수(취소·거절 제외) · 가동률 = 확정 예약 점유 시간 ÷ (워킹데이 × 8시간, 09–18시 점심 제외).',
  dept:     '예약자의 소속 부서 기준으로 집계합니다.',
  hours:    '회의 시작 시각 기준 분포입니다.',
  pending:  '승인 대기 중인 예약입니다.',
  users:    '예약자별 누적 건수와 노쇼입니다.',
  purpose:  '예약 제목에서 회의 목적을 자동 분류한 결과입니다. 노쇼·사용자 취소는 각각 분리해 표시합니다.',
}

/**
 * 드로어 기간 프리셋 (Figma 2669:11492 — 이번 달 / 3개월 / 6개월 / 1년)
 *
 * 대시보드 카드의 프리셋(한 달·3개월·전체)과 세트가 다르다. 카드는 "최근 N일" 을 보는
 * 도구이고, 드로어는 목록을 파고드는 화면이라 달·년 단위가 더 자연스럽다는 Figma 판단.
 */
const DRAWER_PRESETS = [
  { id: 'thisMonth', label: '이번 달' },
  { id: '3m',        label: '3개월'  },
  { id: '6m',        label: '6개월'  },
  { id: '1y',        label: '1년'    },
]

function drawerPresetRange(id: string): { from: string; to: string } {
  const to = todayStr()
  switch (id) {
    case 'thisMonth': return { from: getMonthStart(0),        to }
    case '3m':        return { from: addDaysStr(to, -89),     to }
    case '6m':        return { from: addDaysStr(to, -179),    to }
    case '1y':        return { from: addDaysStr(to, -364),    to }
    default:          return { from: addDaysStr(to, -29),     to }
  }
}

/**
 * 현재 from/to 가 어느 프리셋인지 역산 — 활성 상태를 state 로 따로 들지 않는다.
 * 들고 있으면 날짜 직접 지정과 이중 진실이 된다(DashboardRangeFilter 와 같은 원칙).
 * 어느 것에도 안 맞으면 null = 직접 지정 상태.
 */
function drawerPresetIdOf(from: string, to: string): string | null {
  for (const p of DRAWER_PRESETS) {
    const r = drawerPresetRange(p.id)
    if (r.from === from && r.to === to) return p.id
  }
  return null
}

// ─── DetailDrawer ──────────────────────────────────────────────────────────────
// ✅ 변경 이력
//  - [2026-05-28 사용자 요청] 'bookings' 타입 날짜 필터 모드 토글 + 생성일 컬럼 분리
//    · 배경: '최근 생성된 예약' 카드 클릭 시 회의 시작일 기준 조회/정렬되어 사용자 혼란
//            ("최근 생성"인데 회의 시작 날짜로 정렬되어 진짜 최근 생성된 게 위로 안 옴)
//    · 해결:
//        ① initialDateMode prop 추가 — 카드별 진입 모드 결정 (최근 생성 카드는 'createdAt')
//        ② dateMode state + 토글 UI — 생성일/회의 날짜 자유 전환 (AdminApprovalTable 패턴 일관)
//        ③ loadBookingsByRange(from, to, dateField) 동적 호출 — 백엔드도 모드별 fetch
//        ④ 테이블 컬럼 분리 — '생성일'(b.createdAt) + '회의 날짜'(b.start_at) 양립
//        ⑤ CSV에도 두 날짜 컬럼 분리
//    · 정렬: initialSortKey도 모드와 함께 결정 (최근 생성 카드는 'createdAt' desc)
//      모드 변경 시 정렬은 자동 변경 X — 사용자가 헤더 클릭으로 자유 정렬 가능
function DetailDrawer({ type, rooms, users, initFrom, initTo, initialSortKey, initialSortAsc, initialDateMode, initialPurpose, onDetail, onClose, currentUserId = '', currentUserEmail = '' }:
  { type: DetailType; rooms: Room[]; users: AppUser[]; initFrom: string; initTo: string;
    // ← [2026-05-26 카드 클릭 활성화] 진입 시 정렬 옵션 (RoomRanking vs RoomNoshow 분기용)
    initialSortKey?: string; initialSortAsc?: boolean;
    // ← [2026-05-28] 진입 시 날짜 조회 모드 ('createdAt'=생성일 기준 / 'startAt'=회의 날짜 기준, default 'startAt')
    initialDateMode?: 'createdAt' | 'startAt';
  initialPurpose?: PurposeCode        // ← [2026-07-23] 목적 카드에서 분류 선택 후 진입 시 초기 드릴다운
    onDetail?: (b:Booking)=>void; onClose: ()=>void;
    // ← [2026-05-28 P4-B 패턴 일관성] BookingStatusBadge 'mine' 칩 판정용 (어드민 본인 예약 표시)
    currentUserId?: string; currentUserEmail?: string }) {
  const [presetId, setPresetId] = useState('custom')
  const [dateFrom, setDateFrom] = useState(initFrom)
  const [dateTo,   setDateTo]   = useState(initTo)
  const [data,     setData]     = useState<Booking[]>([])
  const [loading,  setLoading]  = useState(false)
  const [page,     setPage]     = useState(1)
  // ← [2026-05-26] initialSortKey/Asc 적용 — 카드 클릭 진입 시 시각적 일관성 보장
  const [sortKey,  setSortKey]  = useState(initialSortKey ?? 'start_at')
  const [sortAsc,  setSortAsc]  = useState(initialSortAsc ?? false)
  // ← [2026-05-28] 날짜 조회 모드 — 'bookings' 타입에서 토글 가능 (생성일 vs 회의 날짜)
  //   · 'createdAt' = b.createdAt 기준 fetch + 클라 필터 (loadBookingsByRange dateField='created_at')
  //   · 'startAt'   = b.start_at  기준 fetch + 클라 필터 (loadBookingsByRange dateField='start_at')
  //   · AdminApprovalTable의 dateFilterMode 패턴과 동일 — 백엔드/프론트 단일 진실 원천
  const [dateMode, setDateMode] = useState<'createdAt' | 'startAt'>(initialDateMode ?? 'startAt')
  // 드릴다운: 집계 행 클릭 → 해당 필터로 예약 목록 표시
  // ← [2026-07-23] initialPurpose가 있으면 드릴다운 상태로 시작한다.
  //   드로어를 연 뒤 useEffect로 setDrill 하면 "전체 목록 → 깜빡 → 필터된 목록" 이 보인다.
  //   초기값으로 넣으면 첫 렌더부터 올바른 화면이다.
  // ← [2026-07-23] 목적 진입은 개별 예약이 아니라 '부서별 집계'(2단 드릴다운 1단계)로 시작한다.
  //   개별 예약 목록은 부서까지 고른 뒤 2단계에서 나온다 → purposeDrill state가 담당.
  const [drill, setDrill] = useState<{ label: string; fn: (b:Booking)=>boolean } | null>(null)

  // ← [2026-07-23] 예약 목록의 '상태' 선택 필터.
  //   null이면 전체. 칩을 누르면 그 상태만 남고, 각 칩에 건수와 비율이 자동 계산돼 표시된다.
  //   ※ 라벨은 getBookingStatusLabel(우선순위 SSOT)을 그대로 쓴다 — 새 상태 정의를 만들지 않는다.
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const PER = 30

  // ← [2026-05-28] fetchData에 dateField 동적 적용 + dateMode 의존성 추가
  //   기존: loadBookingsByRange(dateFrom, dateTo) — start_at 기준 고정
  //   변경: dateMode에 따라 'created_at' 또는 'start_at' 기준 fetch
  //   AdminApprovalTable.fetchRange와 동일 패턴 (DB 페이징 + dateField 동적)
  const fetchData = useCallback(async () => {
    setLoading(true); setPage(1)
    try {
      const dateField = dateMode === 'createdAt' ? 'created_at' : 'start_at'  // ← [2026-05-28] DB 컬럼 매핑 (snake_case)
      setData(await loadBookingsByRange(dateFrom, dateTo, dateField))         // ← [2026-05-28] dateField 동적 전달
    }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo, dateMode])   // ← [2026-05-28] dateMode deps 추가 → 모드 변경 시 자동 refetch

  useEffect(() => { fetchData() }, [fetchData])

  // ← [2026-05-11 Phase 2] 로컬 isNoshow 정의 제거 — utils/noshow.ts SSOT 사용
  //   옛 룰: autoCancelled && !checkedIn && !earlyEnded → 통일 룰: status==='confirmed' && cancelledBy==='system' && !checkedIn

  // 타입별 필터
  const filtered = useMemo(() => {
    let d = data
    if (type === 'noshow')  d = d.filter(isNoshow)
    if (type === 'pending') d = d.filter(b => b.status === 'pending')
    return d
  }, [data, type])

  // 집계 데이터
  const roomAgg = useMemo(() => {
    const map = new Map<number, { confirmed:number; noshow:number; checkin:number }>()
    filtered.forEach(b => {
      if (!map.has(b.room_id)) map.set(b.room_id, { confirmed:0, noshow:0, checkin:0 })
      const s = map.get(b.room_id)!
      if (!b.autoCancelled && b.status !== 'rejected') s.confirmed++
      if (isNoshow(b)) s.noshow++
      if (b.checkedIn) s.checkin++
    })
    // ← [2026-07-24] 가동률 병합.
    //   '예약 많은 회의실'(건수)과 '회의실별 가동률'(시간 점유율)이 같은 드로어를 여는데
    //   표에는 건수만 있어서 "두 카드가 같은 지표 아니냐"는 혼동이 있었다.
    //   두 값을 한 표에 나란히 놓으면 서로 다른 질문이라는 게 드러난다.
    //   ※ 행 집합은 그대로 둔다(예약이 1건이라도 있는 방만). byRoom 은 예약 0건 방도
    //     포함하지만, 여기서 행을 늘리면 기존 '예약 많은 회의실' 드릴다운 모수가 바뀐다.
    const utilByRoom = new Map<number, number>()
    calcUtilization(filtered, rooms, dateFrom, dateTo).byRoom.forEach(({ room, util }) => {
      utilByRoom.set(room.room_id, Math.round(util.rate * 100))
    })
    return Array.from(map.entries()).map(([rid, s]) => {
      const r = rooms.find(rm => rm.room_id === rid)
      return { room_id: rid, room_name: r?.room_name || String(rid), ...s,
        noshow_rate: s.confirmed + s.noshow > 0 ? Math.round(s.noshow / (s.confirmed + s.noshow) * 100) : 0,
        util: utilByRoom.get(rid) ?? 0 }
    }).sort((a,b) => b.confirmed - a.confirmed)
  }, [filtered, rooms, dateFrom, dateTo])

  // ← [2026-07-24] 진입 정렬 적용.
  //   기존에는 roomAgg 가 항상 건수 desc 고정이라, 노쇼·가동률 카드에서 들어와도
  //   "예약 많은 순"으로만 보였다(카드가 넘긴 sortKey 가 rooms 타입에서 무시됨).
  //   이제 카드별 sortKey 로 진입하고, 헤더 클릭으로 재정렬할 수 있다.
  const ROOM_SORT_KEYS = ['room_name','confirmed','checkin','noshow','noshow_rate','util']
  const sortedRoomAgg = useMemo(() => {
    const key = ROOM_SORT_KEYS.includes(sortKey) ? sortKey : 'confirmed'
    return [...roomAgg].sort((a: any, b: any) => {
      const av = a[key], bv = b[key]
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [roomAgg, sortKey, sortAsc])

  const deptAgg = useMemo(() => {
    const map = new Map<string, { confirmed:number; noshow:number }>()
    filtered.filter(b => b.dept).forEach(b => {
      if (!map.has(b.dept)) map.set(b.dept, { confirmed:0, noshow:0 })
      const s = map.get(b.dept)!
      if (!b.autoCancelled && b.status !== 'rejected') s.confirmed++
      if (isNoshow(b)) s.noshow++
    })
    return Array.from(map.entries()).map(([dept, s]) => ({ dept, ...s })).sort((a,b) => b.confirmed - a.confirmed)
  }, [filtered])

  const hourAgg = useMemo(() => Array.from({ length: 13 }, (_, i) => {
    const h = 7 + i
    const count = filtered.filter(b => !b.autoCancelled && b.status !== 'rejected' && Math.floor(tsMin(b.start_at)/60) === h).length
    return { hour: `${h}:00`, count }
  }), [filtered])

  // ← [2026-05-26] userAgg 확장 — lastNoshowAt 추가
  //   사유: "노쇼 현황 상세" 진입 시 "노쇼한 사람 최신순"(사용자 결정) 정렬 위해 마지막 노쇼 시점 필요
  //   매핑 키 변경: b.user(이름) → b.user_id (UUID 우선, 없으면 b.user fallback)
  //     · 동명이인 안전 — 이름이 같아도 user_id가 다르면 별도 행
  //     · user_id 없는 외부 게스트는 b.user 키로 fallback (기존 동작 보존)
  // ← [2026-07-23 Phase 3] 목적별 집계 — 카드(위젯 ⑨)와 동일한 aggregatePurposes 사용
  //   카드는 Figma 사양상 상위 5개만 노출하므로, 전체 10분류는 여기서 확인한다.
  const purposeAgg = useMemo(() => aggregatePurposes(filtered).map(r => ({
    code:  r.code,
    label: r.label,
    count: r.count,
    ratio: `${(r.ratio * 100).toFixed(1)}%`,
    // ← [2026-07-23] 임원 요청 — 노쇼(사용자 귀책) / 사용자 취소(귀책 아님) 분리 표기
    noshow:     `${r.noshow}건 (${(r.noshowRate * 100).toFixed(1)}%)`,
    userCancel: `${r.userCancel}건 (${(r.userCancelRate * 100).toFixed(1)}%)`,
  })), [filtered])

  // ← [2026-07-23] 2단 드릴다운 1단계 — 목적을 고르면 그 목적 안의 부서별 집계를 보여준다.
  //   (목적 → 부서 → 개별 예약). purposeDrill이 null이면 목적 목록 화면이다.
  const [purposeDrill, setPurposeDrill] = useState<PurposeCode | null>(initialPurpose ?? null)
  const purposeDeptAgg = useMemo(() => (
    purposeDrill ? aggregatePurposeByDept(filtered, purposeDrill).map(r => ({
      dept:  r.dept,
      count: r.count,
      ratio: `${(r.ratio * 100).toFixed(1)}%`,
      noshow:     `${r.noshow}건 (${(r.noshowRate * 100).toFixed(1)}%)`,
      userCancel: `${r.userCancel}건 (${(r.userCancelRate * 100).toFixed(1)}%)`,
    })) : []
  ), [filtered, purposeDrill])

  // ← [2026-07-23 Phase 2] 본문을 utils/dashboardAgg.aggregateUsers()로 추출 (로직 1:1 무변경)
  //   사유: 신규 카드 '사용자 예약 순위'/'사용자 누적 노쇼'가 같은 값을 표시한다.
  //         집계를 두 벌 두면 조건이 한쪽만 바뀌는 순간 카드와 드로어 숫자가 어긋난다.
  const userAgg = useMemo(() => aggregateUsers(filtered, users), [filtered, users])

  // 테이블 렌더
  // 공통 예약 목록 렌더 (drill-down 시에도 재사용)
  /**
   * 예약 목록 렌더 (← [2026-07-24] Figma 2669:10396 로 전면 교체)
   *
   *   구조: [상태 칩 + CSV] → [표] → [페이지네이션]
   *   · 브레드크럼은 여기서 그리지 않는다 — DrawerShell 헤더로 올라갔다(스크롤 고정).
   *   · '총 N건' 별도 표기도 없앴다. '전체 N건' 칩이 같은 값을 이미 말하고 있어
   *     같은 숫자가 한 화면에 두 번 나오던 자리였다.
   *   · 표 마크업은 BookingTable 이 소유한다. 컬럼 순서를 호출부가 조립하면
   *     화면마다 순서가 갈라지므로, 여기서는 '생성일을 켤지'만 정한다.
   */
  /** CSV 파일명용 경로 라벨 — 브레드크럼과 같은 조립 규칙 */
  const csvScopeLabel = [
    type === 'purpose' && purposeDrill ? PURPOSE_DEFS.find(d => d.code === purposeDrill)?.label : null,
    drill?.label,
  ].filter(Boolean).join('_') || DETAIL_META[type].title

  const renderBookingList = (source: Booking[]) => {
    // ── 상태 분포 ────────────────────────────────────────────────────────
    //   비율의 분모는 반드시 '필터 전 전체'다. 필터된 목록을 분모로 쓰면
    //   어떤 상태를 골라도 항상 100%가 나와 지표가 무의미해진다.
    //   집계 기준은 getBookingStatusGroup — '조기반납'은 실제 사용한 건이므로 '사용완료'에 합산.
    const statusCounts = new Map<string, number>()
    source.forEach(b => {
      const l = getBookingStatusGroup(b)
      statusCounts.set(l, (statusCounts.get(l) ?? 0) + 1)
    })
    // Figma 색: 사용완료 #067EFF / 노쇼 #FF1010 / 그 외 #000
    const pctColor = (label: string) =>
      label === '사용완료' ? '#067EFF' : label === '노쇼' ? '#FF1010' : '#000'

    const chips: DrawerChip[] = [
      { key: null, label: '전체', count: source.length },
      ...Array.from(statusCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => ({
          key: label, label, count: n,
          pct: source.length > 0 ? (n / source.length) * 100 : 0,
          pctColor: pctColor(label),
        })),
    ]

    const scoped = statusFilter ? source.filter(b => getBookingStatusGroup(b) === statusFilter) : source

    // ── 정렬 ─────────────────────────────────────────────────────────────
    //   createdAt(number)과 start_at(ISO string)이 섞이므로 타입별 fallback 을 구분한다.
    //   createdAt 누락(과거 데이터)은 0 → 항상 후순위.
    const sorted = [...scoped].sort((a, b) => {
      const av = (a as any)[sortKey] ?? (sortKey === 'createdAt' ? 0 : '')
      const bv = (b as any)[sortKey] ?? (sortKey === 'createdAt' ? 0 : '')
      return sortAsc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
    })
    const total = sorted.length
    const pages = Math.max(1, Math.ceil(total / PER))
    const paged = sorted.slice((page - 1) * PER, page * PER)

    const csvRows = sorted.map(b => {
      const r = rooms.find(rm => rm.room_id === b.room_id)
      // CSV 컬럼 순서 = 화면 순서 (회의 → 회의실 → 회의 날짜 → 생성일 → 시간 → 예약자 → 상태)
      return {
        목적: purposeExportText(b.purpose, b.purposeDetail),  // ← [2026-07-27 목적 Phase 3] 화면 컬럼 순서와 동일(목적→회의)
        회의: b.title, 회의실: r?.room_name ?? '',
        '회의 날짜': tsDate(b.start_at),
        생성일: b.createdAt ? tsDate(new Date(b.createdAt).toISOString()) : '',
        시간: `${b.start_at.slice(11,16)}–${b.end_at.slice(11,16)}`,
        예약자: b.user, 부서: b.dept,
        상태: getBookingStatusLabel(b),
      }
    })

    return (
      <>
        {/* ── 상태 칩 + CSV (Figma 2669:11326) ── */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                      gap:12, flexWrap:'wrap', marginBottom:16 }}>
          <DrawerStatChips chips={chips} activeKey={statusFilter}
            onPick={k => { setStatusFilter(k); setPage(1) }} />
          {/* ← [2026-07-24 #10] 파일명은 경로 전체(목적_부서). drill.label 만 쓰면
                '부서'만 남아 어떤 목적의 부서인지 알 수 없는 파일이 된다 */}
          <DrawerCsvButton onClick={() => exportCSV(csvRows, `${csvScopeLabel}_${dateFrom}_${dateTo}`)} />
        </div>

        <BookingTable
          rows={paged} rooms={rooms} users={users}
          sortKey={sortKey} sortAsc={sortAsc}
          onSort={f => { if (sortKey === f) setSortAsc(v => !v); else { setSortKey(f); setSortAsc(false) } }}
          onRowClick={onDetail}
          currentUserId={currentUserId} currentUserEmail={currentUserEmail}
        />

        {/* ← [2026-07-24 #8] 페이지네이션도 흰 배경.
              Figma(2669:10835)는 표 카드 **안쪽** 요소인데 여기서는 별도 블록이라,
              회색 배경 위에 버튼만 떠 있으면 표와 무관한 컨트롤처럼 보인다. */}
        {pages > 1 && (
          <div style={{ background:'#fff', borderRadius:16, marginTop:8 }}>
            <DrawerPagination page={page} pages={pages} onChange={setPage} />
          </div>
        )}
      </>
    )
  }

  const renderTable = () => {
    // ← [2026-07-24 #8] 로딩 상태도 흰 카드 안에서. 회색 배경 위 맨 텍스트로 두면
    //   "표가 있는데 비었다" 와 "아직 안 왔다" 가 시각적으로 구분되지 않는다.
    if (loading) return (
      <div style={{ background:'#fff', borderRadius:16, padding:'48px 0', textAlign:'center',
                    color:'#94A3B8', fontSize:13, display:'flex', alignItems:'center',
                    justifyContent:'center', gap:8 }}>
        <RefreshCw size={16} strokeWidth={1.8}/> 불러오는 중...
      </div>
    )

    // drill-down 활성화 시 → 예약 목록 표시
    if (drill) {
      const drillData = filtered.filter(drill.fn)
      return renderBookingList(drillData)   // ← [2026-07-24] 라벨은 DrawerShell 브레드크럼이 표시
    }

    // 집계 테이블 타입 (드릴다운 콜백 포함)
    if (type === 'rooms') return <AggTable rows={sortedRoomAgg}
      cols={[{k:'room_name',l:'회의실'},{k:'confirmed',l:'예약'},{k:'checkin',l:'체크인'},{k:'noshow',l:'노쇼'},{k:'noshow_rate',l:'노쇼율(%)',fmt:v=>`${v}%`},{k:'util',l:'가동률(%)',fmt:v=>`${v}%`}]}
      /* ← [2026-07-24] 두 지표의 단위·모수가 다르다는 것을 표 위에 명시한다.
            문구가 없으면 '예약'과 '가동률'이 같은 걸 다르게 센 값으로 읽힌다. */
      note={'예약 = 건수(취소·거절 제외) · 가동률 = 확정 예약 점유 시간 ÷ (워킹데이 × 8시간, 09–18시 점심 제외). '
          + '건수가 많아도 회의가 짧으면 가동률은 낮다.'}
      onHeaderClick={(k) => {
        if (!ROOM_SORT_KEYS.includes(k)) return
        if (sortKey === k) setSortAsc(v => !v)
        else { setSortKey(k); setSortAsc(false) }
      }}
      activeSortKey={ROOM_SORT_KEYS.includes(sortKey) ? sortKey : 'confirmed'}
      activeSortAsc={sortAsc}
      onExport={() => exportCSV(sortedRoomAgg.map(r=>({회의실:r.room_name,예약:r.confirmed,체크인:r.checkin,노쇼:r.noshow,'노쇼율(%)':r.noshow_rate,'가동률(%)':r.util})), `회의실별통계_${dateFrom}_${dateTo}`)}
      onRowClick={row => { const rm = rooms.find(r=>r.room_id===row.room_id); if(rm) { setDrill({ label:row.room_name, fn:(b)=>b.room_id===rm.room_id }); setPage(1) } }}/>

    if (type === 'dept') return <AggTable rows={deptAgg}
      cols={[{k:'dept',l:'부서'},{k:'confirmed',l:'예약'},{k:'noshow',l:'노쇼'}]}
      onExport={() => exportCSV(deptAgg.map(r=>({부서:r.dept,예약:r.confirmed,노쇼:r.noshow})), `부서별통계_${dateFrom}_${dateTo}`)}
      onRowClick={row => { setDrill({ label:row.dept, fn:(b)=>b.dept===row.dept }); setPage(1) }}/>

    if (type === 'purpose') {
      // ── 2단 드릴다운 (고지 확정 2026-07-23): 목적 → 부서 → 개별 예약 ──
      if (purposeDrill) {
        const def = PURPOSE_DEFS.find(d => d.code === purposeDrill)!
        return (
          <>
            {/* ← [2026-07-24] 인라인 브레드크럼 제거 — DrawerShell 헤더가 담당.
                  안내 문구만 남긴다(행을 눌러 더 들어갈 수 있다는 사실은 표 근처에 있어야 한다) */}
            {/* ← [2026-07-24 #10] 앞의 '{def.label} ·' 제거 — 목적명은 헤더 브레드크럼이 말한다 */}
            <div style={{ fontSize:13, color:'#64748B', marginBottom:12 }}>
              부서별 · 행 클릭 시 개별 예약
            </div>
            <AggTable rows={purposeDeptAgg}
              cols={[{k:'dept',l:'부서'},{k:'count',l:'건 수'},{k:'ratio',l:'비중'},{k:'noshow',l:'노쇼 (율)'},{k:'userCancel',l:'사용자 취소 (율)'}]}
              onRowClick={row => {
                setDrill({
                  // ← [2026-07-24 #10] '목적 · 부서' → '부서'.
                  //   상위 목적은 이미 브레드크럼 첫 조각이 말하고 있어서,
                  //   여기에도 붙이면 헤더에 "부서별 회의  부서별 회의 · Medical" 로 겹친다.
                  //   drill.label 은 **그 단계의 이름만** 담는다(경로 조립은 크럼이 담당).
                  label: row.dept,
                  fn: (b) => classifyPurpose(b.title).code === purposeDrill
                          && (b.dept?.trim() || '(부서 미상)') === row.dept,
                })
                setPage(1)
              }}
              onExport={() => exportCSV(purposeDeptAgg.map(r=>({'부서':r.dept,'건 수':r.count,'비중':r.ratio,'노쇼':r.noshow,'사용자 취소':r.userCancel})), `${def.label}_부서별_${dateFrom}_${dateTo}`)} />
          </>
        )
      }
      return <AggTable rows={purposeAgg}
        cols={[{k:'label',l:'회의 목적'},{k:'count',l:'건 수'},{k:'ratio',l:'비율'},{k:'noshow',l:'노쇼 (율)'},{k:'userCancel',l:'사용자 취소 (율)'}]}
        onRowClick={row => { setPurposeDrill(row.code); setPage(1) }}
        onExport={() => exportCSV(purposeAgg.map(r=>({'회의 목적':r.label,'건 수':r.count,'비율':r.ratio,'노쇼':r.noshow,'사용자 취소':r.userCancel})), `회의목적별통계_${dateFrom}_${dateTo}`)} />
    }
    if (type === 'hours') return <AggTable rows={hourAgg}
      cols={[{k:'hour',l:'시간대'},{k:'count',l:'예약 건수'}]}
      onExport={() => exportCSV(hourAgg.map(r=>({시간대:r.hour,예약건수:r.count})), `시간대별분포_${dateFrom}_${dateTo}`)}
      onRowClick={row => { const h = parseInt(row.hour); setDrill({ label:row.hour, fn:(b)=>Math.floor(tsMin(b.start_at)/60)===h }); setPage(1) }}/>

    if (type === 'users') {
      // ← [2026-05-26] 정렬 적용 — 카드 클릭 진입 시 initialSortKey/Asc 반영 (사용자 결정: 노쇼한 사람 최신순)
      //   기본 정렬: count desc (기존). sortKey가 변경되면 그 키 기준 정렬.
      //   특히 'lastNoshowAt' 정렬은 "노쇼한 사람 최신순" 진입용 (count=0인 사용자는 lastNoshowAt=0이라 자연스럽게 후순위)
      const sortedUsers = [...userAgg].sort((a, b) => {
        const av = (a as any)[sortKey] ?? 0
        const bv = (b as any)[sortKey] ?? 0
        if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
        return sortAsc ? av - bv : bv - av
      })
      return <AggTable rows={sortedUsers}
        cols={[
          {k:'name',l:'이름'},
          {k:'dept',l:'부서'},
          {k:'count',l:'예약'},
          {k:'noshow',l:'노쇼'},
          // ← [2026-05-26 신규] 마지막 노쇼 시점 — "노쇼한 사람 최신순" 정렬 진입 시 시각적 검증
          {k:'lastNoshowAt',l:'최근 노쇼',fmt:(v:number) => v > 0 ? new Date(v).toISOString().slice(0,10) : '-'},
        ]}
        // ← [2026-05-26] 헤더 클릭 정렬 — 같은 키 다시 클릭 시 방향 토글, 다른 키 클릭 시 desc 시작
        onHeaderClick={(k) => {
          if (sortKey === k) setSortAsc(s => !s)
          else { setSortKey(k); setSortAsc(false) }
        }}
        activeSortKey={sortKey}
        activeSortAsc={sortAsc}
        // ← [2026-05-26] CSV에 조회기간 + 최근 노쇼 일자 포함 (사용자 결정: 기간 정보 명확히)
        onExport={() => exportCSV(
          sortedUsers.map(r => ({
            이름: r.name,
            부서: r.dept,
            예약: r.count,
            누적노쇼: r.noshow,
            최근노쇼: r.lastNoshowAt > 0 ? new Date(r.lastNoshowAt).toISOString().slice(0,10) : '-',
            조회기간: `${dateFrom} ~ ${dateTo}`,
          })),
          `사용자별통계_${dateFrom}_${dateTo}`
        )}
        // ← [2026-05-26] 드릴다운 — user_id 우선 매칭 (동명이인 안전), 없으면 b.user fallback
        onRowClick={row => {
          const targetUid = row.user_id
          const targetName = row.name
          setDrill({
            label: row.name,
            fn: (b: Booking) => targetUid ? (b.user_id === targetUid) : (b.user === targetName),
          })
          setPage(1)
        }}/>
    }

    // bookings / noshow / pending → 개별 예약 목록
    return renderBookingList(filtered)
  }


  const meta = DETAIL_META[type]

  // ── 브레드크럼 (← [2026-07-24]) ──────────────────────────────────────────
  //   기존에는 본문 첫 줄에 파란 박스로 있어서 스크롤하면 사라졌다.
  //   드릴다운이 최대 3단(목적 → 부서 → 개별 예약)까지 들어가는 화면에서
  //   "지금 어디"와 "되돌아가기"가 동시에 사라지는 건 치명적이라 헤더로 올린다.
  const crumbs: Crumb[] = []
  if (type === 'purpose' && purposeDrill) {
    const def = PURPOSE_DEFS.find(d => d.code === purposeDrill)
    // 마지막 조각이 아니면(= 개별 예약까지 들어갔으면) 눌러서 부서 목록으로 되돌아간다
    crumbs.push({ label: def?.label ?? '목적', onClick: drill ? () => { setDrill(null); setPage(1) } : undefined })
  }
  if (drill) crumbs.push({ label: drill.label })

  const resetDrill = (drill || purposeDrill)
    ? () => { setDrill(null); setPurposeDrill(null); setPage(1) }
    : undefined

  return (
    <ModalPortal>
      <DrawerShell
        title={meta.title}
        subtitle={DETAIL_SUBTITLE[type]}
        crumbs={crumbs}
        onReset={resetDrill}
        onClose={onClose}>

        {/* ── 조회 조건 ──────────────────────────────────────────────────
              Figma 2669:11478 — 날짜(요일 포함) + 프리셋을 한 줄로.
              기존에는 프리셋 라벨·기간 텍스트·모드 토글이 세 군데 흩어져 있었다. */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <DrawerRangeFilter
            from={dateFrom} to={dateTo}
            onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
            presets={DRAWER_PRESETS}
            activeId={drawerPresetIdOf(dateFrom, dateTo)}
            onPreset={id => { const r = drawerPresetRange(id); setDateFrom(r.from); setDateTo(r.to) }}
          />
          {/* 조회 기준 전환 — 'bookings' 타입에서만.
              생성일 기준으로 보면 표에 생성일 컬럼이 따라 붙는다(BookingTable showCreated) */}
          {type === 'bookings' && (
            <div style={{ display:'inline-flex', background:'#fff', borderRadius:12, padding:4, gap:2 }}>
              {([['createdAt','생성일'],['startAt','회의 날짜']] as const).map(([id, label]) => {
                const on = dateMode === id
                return (
                  <button key={id} className="btn" onClick={() => setDateMode(id)}
                    style={{
                      padding:'8px 14px', borderRadius:8, border:'none', cursor:'pointer',
                      background: on ? '#111' : 'transparent', color: on ? '#fff' : '#64748B',
                      fontFamily:"'Pretendard', -apple-system, sans-serif", fontWeight:500, fontSize:13,
                    }}>{label}</button>
                )
              })}
            </div>
          )}
          {loading && (
            <span style={{ fontSize:12, color:'#94A3B8', display:'flex', alignItems:'center', gap:5 }}>
              <RefreshCw size={12} strokeWidth={1.8}/> 조회 중…
            </span>
          )}
        </div>

        {renderTable()}
      </DrawerShell>
    </ModalPortal>
  )
}

// 집계 테이블 컴포넌트
// ← [2026-05-26] onHeaderClick 옵션 추가 — 사용자별 노쇼 테이블에서 헤더 클릭 정렬 지원


// ─── AdminView ─────────────────────────────────────────────────────────────────
// ← [2026-05-06 Admin Phase C] currentUserId/currentUserEmail 추가 — AdminApprovalTable 내 BookingStatusBadge 판정용
// ← [2026-05-06 사이드 sticky 핫픽스] headerHeight 추가 — 사이드 네비 fixed top 위치 계산용
export function AdminView({ bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet, onApprove, onReject, onForceCancel, onDetail, currentUserId = '', currentUserEmail = '', headerHeight = 0 }) {
  // ── 내 역할 (← [2026-07-24] Phase 1) ────────────────────────────────────
  //   역할이 없는 탭은 사이드 네비에서 숨기고, 해시 딥링크로도 못 들어가게 막는다.
  //   숨기기만 하고 라우팅을 안 막으면 #admin-tab-books 로 우회된다.
  const [myRoles, setMyRoles] = useState<string[] | null>(null)   // null = 아직 로딩 중
  useEffect(() => {
    let cancelled = false
    loadMyAdminRoles(currentUserId)
      .then(r => { if (!cancelled) setMyRoles(r) })
      .catch(() => { if (!cancelled) setMyRoles([]) })
    return () => { cancelled = true }
  }, [currentUserId])

  // 로딩 중에는 기존 전체 탭을 유지한다. 빈 배열로 시작하면 진입 직후 한 프레임 동안
  // 메뉴가 통째로 사라졌다가 다시 나타나 깜빡인다.
  const ALL_TABS = ['dashboard','bookings','approvals','rooms','users','visitors','books','notifications','notices','kb','resources']  // ← [2026-08-19] resources(자원 관리) 추가
  const TABS = myRoles === null ? ALL_TABS : (visibleTabs(myRoles) as string[])  // ← [2026-07-10] visitors / [2026-07-23] books(도서 관리) + notifications(알림 설정) 추가
  const getTabFromHash = () => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('admin-booking-')) return 'approvals'  // 딥링크: 승인 관리 탭으로
    const t = hash.replace('admin-tab-','')
    return TABS.includes(t) ? t : 'dashboard'
  }
  const [activeTab, setActiveTab] = useState(getTabFromHash)
  const setTab = (t: string) => {
    setActiveTab(t)
    window.location.hash = `admin-tab-${t}`
  }

  // ← [2026-07-24] 권한 없는 탭에 있으면 내가 가진 첫 탭으로 이동.
  //   기본 탭이 'dashboard' 인데 dashboard 역할이 없으면 빈 화면을 보게 된다.
  //   해시 딥링크로 직접 들어온 경우도 여기서 걸린다.
  useEffect(() => {
    if (myRoles === null) return
    if (TABS.length === 0) return           // 역할 0개 — 아래에서 안내 화면
    if (!TABS.includes(activeTab)) setTab(TABS[0])
  }, [myRoles, activeTab])   // eslint-disable-line react-hooks/exhaustive-deps

  // 딥링크 처리: #admin-booking-{id} 또는 sessionStorage(OAuth 후 복원) 로 진입 시 예약 모달 자동 오픈
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    // 해시에서 먼저 확인, 없으면 sessionStorage에서 복원
    const raw = hash.startsWith('admin-booking-')
      ? hash
      : (sessionStorage.getItem('cnr_deeplink') ?? '')
    if (!raw.startsWith('admin-booking-')) return
    const bookingId = raw.replace('admin-booking-', '')
    const target = bookings.find((b: any) => b.id === bookingId)
    if (target) {
      setActiveTab('approvals')
      onDetail(target)
      // 딥링크 소비 후 정리
      window.location.hash = 'admin-tab-approvals'
      sessionStorage.removeItem('cnr_deeplink')
    }
  }, [bookings])
  const PER_PAGE = 15
  // ← [2026-08-05] 예약 관리 탭 하위 뷰 — '예약 목록' | '노쇼 관리'
  //   새 탭(=새 역할)을 만들지 않고 booking 권한 안에서 뷰만 전환 (역할=탭 1:1 원칙 유지)
  const [bookingsView, setBookingsView] = useState<'list' | 'noshow'>('list')
  // ← [2026-05-06 Admin Phase A] 가로 탭바 제거 — 좌측 사이드 네비 (AdminSideNav)로 이동
  //   기존: tabs 배열 + 가로 button 그룹 (lucide 아이콘 + 라벨)
  //   변경: AdminSideNav 컴포넌트가 5개 메뉴를 수직 표시 (Figma node 451:3522)
  //   영향: lucide BarChart2/Inbox/Calendar/Users/Building2 imports는 다른 곳에서도
  //         사용 중이라 일단 보존 (Phase B/C에서 정리)

  // 승인 대기 건수 — 사이드 네비 dot 표시용
  // ← [2026-07-23 버그수정] 기한 초과 pending 제외.
  //   기존 공식은 마감이 지난 건까지 대기로 세어, App.tsx tick이 마킹하기 전까지
  //   "대기 2건"이 잘못 표시됐다가 몇 초 뒤 사라지는 현상을 만들었다.
  const pendingCount = useMemo(() => countAwaitingApproval(bookings as Booking[]), [bookings])

  /**
   * 탭별 최대 폭 (← [2026-07-24 #10] 고지 지시)
   *
   *   대시보드만 1920, 나머지 탭은 1400.
   *   대시보드는 카드가 3열까지 늘어나므로 넓을수록 이득이지만, 예약·승인·사용자 탭은
   *   컬럼 수가 고정된 표라 폭을 늘리면 셀만 늘어나 시선 이동 거리가 길어진다.
   *
   *   ★ 사이드 네비의 left 계산과 **반드시 같은 값**이어야 한다.
   *     둘이 다르면 네비와 본문의 좌측 정렬이 어긋난다(이전에 1400/1920 이 갈렸던 자리).
   */
  const shellMaxW = activeTab === 'dashboard' ? 1920 : 1400

  // ── 사이드 네비 배치 (← [2026-07-24 #4] iPad 세로 대응) ──────────────────
  //
  //   데스크톱은 사이드를 body 에 fixed 로 띄우고 본문에 paddingLeft 244 를 준다.
  //   그런데 iPad 세로(820~834)에서도 그 244px 를 그대로 떼가는 바람에
  //   본문이 576px 밖에 안 남아, 2열로 줄여도 카드가 270px 로 찌그러졌다.
  //   1024 미만에서는 모바일과 같이 사이드를 본문 위 인라인으로 흘려보낸다.
  //   → 같은 iPad 세로에서 카드 폭 268px → 382px (Figma 389 에 근접)
  const navInline = isMobile || isTablet

  // ── 사이드 네비 ↔ 푸터 겹침 방지 (← [2026-08-11] 고지 스크린샷 신고) ──────
  //
  //   fixed 사이드는 문서 흐름 밖이라 두 경로로 푸터(<footer>, AppFooter)와 겹친다:
  //     ① 콘텐츠가 짧은 탭(방문 기록 등): 페이지가 사이드보다 짧아 푸터가 바로 겹침
  //     ② 콘텐츠가 긴 탭: 최하단까지 스크롤하면 푸터가 뷰포트로 올라와 하단 교차
  //   sticky 회귀는 불가 — html/body overflow-x:hidden 이 sticky 를 깨서 fixed 로
  //   전환한 이력(2026-05-06)이 있다. fixed 를 유지한 채:
  //     (a) 본문 wrapper minHeight ≥ 사이드 실높이 → ①을 구조적으로 차단
  //     (b) 스크롤 시 푸터 교차량만큼 translateY(-overlap) → ② 표준 UX(밀려 올라감)
  //   사이드 높이는 allowedTabs(권한별 탭 수)에 따라 가변이라 측정 기반으로 간다.
  const sideRef = useRef<HTMLElement | null>(null)
  const [sideH, setSideH] = useState(0)
  useLayoutEffect(() => {
    if (navInline) { setSideH(0); return }
    const el = sideRef.current
    if (!el) return
    const measure = () => setSideH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [navInline, activeTab])
  useEffect(() => {
    if (navInline) return
    let raf = 0
    const tick = () => {
      raf = 0
      const el = sideRef.current
      const footer = document.querySelector('footer')
      if (!el || !footer) return
      const sideTop = headerHeight + 32
      const footRect = footer.getBoundingClientRect()
      // 사이드 하단(자연 위치)과 푸터 상단의 교차량 — 48px 완충 (← [2026-08-11] 고지: 하단 여백 넉넉하게)
      const overlap = Math.max(0, sideTop + el.offsetHeight + 48 - footRect.top)
      el.style.transform = overlap > 0 ? `translateY(${-overlap}px)` : ''
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick) }
    tick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [navInline, headerHeight, sideH])

  return (
    /* ═══════════════════════════════════════════════════════════════════
       ↓ Admin 외곽 wrapper — Figma node 451:3521 1:1
       · max-width 1400 (사이드 160 + gap 60 + 콘텐츠 1180)
       · 데스크톱: 사이드는 createPortal로 body에 fixed mount (sticky 우회)
       · 모바일: 사이드가 콘텐츠 위에 일반 흐름으로 표시
       ─────────────────────────────────────────────────────────────────
       [2026-05-06 사이드 sticky 핫픽스] sticky → fixed (createPortal 패턴)
       · 증상: 사이드 네비가 스크롤 시 같이 딸려 올라가는 문제
       · 근본 원인: html/body의 overflow-x:hidden이 sticky의 컨테이닝 블록을
                  가로채어 sticky 작동 안 함 (userMemories 명시 룰)
       · 해결: 헤더와 동일한 패턴 사용 — createPortal로 body 직접 mount + fixed
                · 부모 체인의 어떤 css(overflow/transform/filter 등)도 영향 0
                · top: headerHeight + 32 (헤더 아래 + 여유)
                · left: viewport 너비 기반 동적 계산 (1400 wrapper 좌측 padding과 정렬)
                · 콘텐츠 영역은 paddingLeft로 사이드 자리 확보 (244 = 24+160+60)
       ═══════════════════════════════════════════════════════════════════ */
    <>
      {/* ── 데스크톱: 사이드 네비를 body에 portal mount + fixed 위치 ──── */}
      {!navInline && createPortal(
        <aside ref={sideRef} style={{
          position: 'fixed',
          top:      headerHeight + 32,                    // ← 헤더 높이 + 여유 32
          // viewport 1400 이상: (vw - 1400)/2 + 24 padding / 1400 미만: 24
          // → max((100vw - {shellMaxW}px) / 2, 0px) + 24px (CSS calc + max)
          //   ← [2026-07-24 #10] 고정 1920 → 탭별 폭(shellMaxW)에 연동.
          //     대시보드 1920 / 그 외 1400. 본문 maxWidth 와 같은 값을 써야 정렬이 맞는다.
          left:     `calc(max((100vw - ${shellMaxW}px) / 2, 0px) + 24px)`,
          width:    160,                                   // ← Figma: 160
          zIndex:   50,                                    // ← 콘텐츠 위에 표시 (헤더 100보다 낮게)
        }}>
          <AdminSideNav
            activeTab={activeTab as AdminTabId}
            onTabChange={(id) => setTab(id)}
            pendingCount={pendingCount}
            allowedTabs={myRoles === null ? undefined : TABS}   /* ← [2026-07-24] 역할 없는 탭 숨김 */
          />
        </aside>,
        document.body
      )}

      {/* ── 본문 wrapper ─────────────────────────────────────────────
          · 데스크톱: paddingLeft 244 = 24(좌) + 160(사이드) + 60(gap) — 사이드 자리 확보
          · 모바일: 일반 padding 12, 사이드는 콘텐츠 위 인라인 */}
      <div style={{
        maxWidth: shellMaxW,   // ← [2026-07-24 #10] 대시보드 1920 / 그 외 1400 (네비 left 와 동일 값)
        margin:   '0 auto',
        // ← [2026-07-24] 태블릿은 사이드가 인라인이므로 좌측 244 여백이 필요 없다
        padding:  isMobile ? '16px 12px' : navInline ? '24px 20px' : '32px 24px 32px 244px',
        // ← [2026-08-11] (a) 짧은 탭에서도 푸터가 fixed 사이드 아래로 밀리도록 최소 높이 보장
        //   sideH(실측) + 32(사이드 top 여유) + 48(하단 여유 — 고지: 넉넉하게). 인라인 배치에선 불필요.
        minHeight: !navInline && sideH > 0 ? sideH + 80 : undefined,
      }}>
        {/* 모바일·태블릿: 사이드 인라인 표시 (자연 흐름) */}
        {navInline && (
          <div style={{ marginBottom: 16 }}>
            <AdminSideNav
              activeTab={activeTab as AdminTabId}
              onTabChange={(id) => setTab(id)}
              pendingCount={pendingCount}
              allowedTabs={myRoles === null ? undefined : TABS}   /* ← [2026-07-24] 역할 없는 탭 숨김 */
            />
          </div>
        )}

        {/* ── 콘텐츠 영역 ──────────────────────────────────────────── */}
        <div style={{ minWidth: 0 /* ← overflow 안전장치 */ }}>
      {activeTab==='dashboard' && <AdminDashboard bookings={bookings} rooms={rooms} users={users} isMobile={isMobile} onDetail={onDetail} onGoApprovals={() => setTab('approvals')} currentUserId={currentUserId} currentUserEmail={currentUserEmail}/>/* ← [2026-05-28] currentUserId/Email 전달 — DetailDrawer 내 BookingStatusBadge 'mine' 칩 판정용  ← [2026-06-10] onGoApprovals 추가 — 승인 대기 카드 클릭 시 '승인 관리' 탭으로 이동 */}
      {activeTab==='bookings'  && <>
        {/* ← [2026-08-05] 하위 뷰 토글 — 예약 목록 / 노쇼 관리 */}
        <div style={{display:'flex',gap:6,marginBottom:16}}>
          {([{id:'list',l:'예약 목록'},{id:'noshow',l:'노쇼 관리'}] as const).map(v=>(
            <button key={v.id} className="btn" onClick={()=>setBookingsView(v.id)}
              style={{padding:'7px 16px',fontSize:12,fontWeight:700,borderRadius:999,
                background:bookingsView===v.id?'#111':'#fff',
                color:bookingsView===v.id?'#fff':'#64748B',
                border:bookingsView===v.id?'none':'1px solid #E2E8F0'}}>{v.l}</button>
          ))}
        </div>
        {bookingsView==='list'
          ? <AdminBookings  bookings={bookings} setBookings={setBookings} rooms={rooms} users={users} onForceCancel={onForceCancel} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail}/>
          : <NoshowAdminPanel rooms={rooms} users={users} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail}/>}
      </>}{/* ← [2026-04-24 P6-B] users 추가 — 예약자 이름 live · [2026-08-05] 노쇼 관리 하위 뷰 */}
      {/* ← [2026-05-06 Admin Phase C] AdminApprovals → AdminApprovalTable 교체
            · Phase B 공통 컴포넌트(DateRangeFilter / SegmentTabBar / DataTable) 사용
            · Figma node 451:3534 1:1 — 7개 컬럼 / 5개 탭 / 3개 퀵버튼 / 검색 활성화
            · 처리 컬럼 분기 — 승인대기=버튼 / 처리완료=처리자
            · 기존 AdminApprovals 데이터 로직(classify/loadBookingsByRange/canApprove) 그대로 보존
            · 기존 AdminApprovals 함수 자체는 보존 (혹시 다른 곳에서 import 시 안전) */}
      {activeTab==='approvals' && <AdminApprovalTable bookings={bookings} rooms={rooms} users={users} currentUserId={currentUserId} currentUserEmail={currentUserEmail} onApprove={onApprove} onReject={onReject} onDetail={onDetail} onCsvClick={() => showToast('CSV 다운로드 기능은 추후 구현 예정입니다.', 'info')}/>}
      {activeTab==='rooms'     && <>
        <AdminRooms showToast={showToast} isMobile={isMobile}/>
        {/* ← [2026-08-03] 공휴일·회사 이벤트 관리 (Phase C) — room 권한과 1:1 이라 이 탭 하위 섹션 */}
        <HolidayAdminPanel showToast={showToast}/>
      </>}
      {activeTab==='users'     && <AdminUsers     users={users} setUsers={setUsers} rooms={rooms} showToast={showToast} isMobile={isMobile} currentUserId={currentUserId}/>}{/* ← [2026-05-26] rooms prop 추가 — 노쇼 현황 DetailDrawer 드릴다운에서 회의실 이름 표시용 */}
      {activeTab==='visitors'  && <VisitorLogPanel showToast={showToast} isMobile={isMobile}/>}{/* ← [2026-07-10] 방문로그 관리 (2차 비번 잠금 → 조회/반납/삭제/Excel) */}
      {/* ← [2026-07-23] 도서 관리 — 개요/도서/대여이력/연체/승인 5개 서브탭.
            LibraryPage(사용자 화면)의 관리 기능은 그대로 두고, 여기서는 같은
            모달·API·판정 기준을 재사용해 운영자 관점의 테이블/통계를 제공한다. */}
      {activeTab==='books'     && <BookAdminPanel users={users} currentUserId={currentUserId} showToast={showToast} isMobile={isMobile}/>}
      {/* ← [2026-07-23] 알림 설정 — 알림 29종 × 채널(메일/인앱/Teams) on/off + 관리자 수신자 지정.
            발송 '정의'(문구·수신자 규칙·CTA)는 Edge Function 의 POLICIES 가 그대로 SSOT 이고,
            이 화면은 "보낼지 / 누구에게" 라는 운영 데이터(notification_settings·
            notification_recipients)만 다룬다. 문구를 여기서 고치는 화면이 아니다. */}
      {activeTab==='notifications' && <NotificationSettingsPanel users={users} showToast={showToast} isMobile={isMobile}/>}
      {/* ← [2026-07-24] 공지 배너 — 헤더 상단 한 줄 배너의 내용·색·게시기간 관리.
            데이터가 App.tsx 하드코딩(MOCK_ANNOUNCEMENT)이라 공지를 바꾸려면 배포가 필요했고,
            게시 기간이 없어 5/12 핫픽스 안내가 두 달 넘게 떠 있던 자리다. */}
      {activeTab==='notices' && <AnnouncementPanel showToast={showToast} isMobile={isMobile}/>}
      {/* ← [2026-07-27] KB 관리 — GA 챗봇 지식베이스(kb_chunks) 청크 편집·JSON 내보내기.
            Notion 가이드를 정제·시드(20260733)한 뒤로는 이 화면이 지식의 원본이다.
            챗봇 런타임은 service_role 로 같은 테이블을 읽는다(어드민은 쓰기, 봇은 읽기). */}
      {activeTab==='kb' && <KBAdminPanel showToast={showToast} isMobile={isMobile}/>}
      {/* ← [2026-08-19] 자원 관리 (Phase 3) — 예약 현황(반납확인·대리예약·취소) / 개체 / 카테고리.
            시드는 DB 가 아닌 이 화면에서 등록한다 (설계서 §10). 반납확인 admin 전용은
            트리거가 최종 방어, 화면은 접근성만 담당. */}
      {activeTab==='resources' && <ResourceAdminPanel users={users} currentUserId={currentUserId} showToast={showToast} isMobile={isMobile}/>}
        </div>
      </div>
    </>
  )
}

// ─── 순수 SVG 차트 컴포넌트 ──────────────────────────────────────────────────

// ① AreaChart
function AreaChartSVG({ data }: { data:{label:string;count:number;isToday:boolean}[] }) {
  const [hov, setHov] = useState<number|null>(null)
  if (!data.length) return null
  const W=700, H=160, pl=28, pr=8, pt=12, pb=24
  const iW=W-pl-pr, iH=H-pt-pb
  const max=Math.max(...data.map(d=>d.count),1)
  const n=data.length
  const px=(i:number)=>pl+i*(iW/Math.max(n-1,1))
  const py=(v:number)=>pt+iH-(v/max*iH)
  const lineStr=data.map((d,i)=>`${px(i)},${py(d.count)}`).join(' ')
  const area=`M${px(0)},${py(data[0].count)}`+data.slice(1).map((d,i)=>`L${px(i+1)},${py(d.count)}`).join('')
    +` L${px(n-1)},${pt+iH} L${px(0)},${pt+iH} Z`
  const step=Math.max(1,Math.ceil(n/8))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:'block',overflow:'visible'}}>
      <defs>
        <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,.25,.5,.75,1].map((v,i)=><line key={i} x1={pl} y1={pt+iH*(1-v)} x2={W-pr} y2={pt+iH*(1-v)} stroke="#F1F5F9" strokeWidth="1"/>)}
      <path d={area} fill="url(#ag2)"/>
      <polyline points={lineStr} fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {data.map((d,i)=>(i%step===0||i===n-1)&&<text key={i} x={px(i)} y={H-4} textAnchor="middle" fontSize="10" fill="#94A3B8">{d.label}</text>)}
      {data.map((d,i)=>d.isToday&&<circle key={i} cx={px(i)} cy={py(d.count)} r="4" fill="#7C3AED" stroke="#fff" strokeWidth="2"/>)}
      {hov!==null&&(
        <>
          <line x1={px(hov)} y1={pt} x2={px(hov)} y2={pt+iH} stroke="#7C3AED" strokeWidth="1" strokeDasharray="4 2" opacity="0.5"/>
          <circle cx={px(hov)} cy={py(data[hov].count)} r="5" fill="#7C3AED" stroke="#fff" strokeWidth="2"/>
          <rect x={px(hov)-26} y={py(data[hov].count)-28} width={52} height={22} rx={5} fill="#1E1B4B"/>
          <text x={px(hov)} y={py(data[hov].count)-13} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="600">{data[hov].count}건</text>
        </>
      )}
      {data.map((_,i)=>(
        <rect key={i} x={px(i)-(iW/n)/2} y={pt} width={iW/n} height={iH} fill="transparent"
          onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}/>
      ))}
    </svg>
  )
}

// ② HourBar
function HourBarChart({ data }: { data:{hour:number;label:string;count:number}[] }) {
  const max=Math.max(...data.map(d=>d.count),1)
  const col=(v:number)=>v===max&&max>0?'#0E7490':v>max*.6?'#0891B2':v>max*.3?'#22D3EE':v>0?'#A5F3FC':'#F0FDFF'
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height:200,paddingBottom:28,position:'relative'}}>
      {data.map((h,i)=>{
        const pct=h.count>0?Math.max(h.count/max*100,3):0
        return (
          <div key={i} title={`${h.label}: ${h.count}건`}
            style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',height:'100%',gap:3,position:'relative'}}>
            {h.count===max&&max>0&&<span style={{fontSize:10,color:'#0E7490',fontWeight:700,marginBottom:1}}>{h.count}</span>}
            <div style={{width:'100%',background:col(h.count),borderRadius:'4px 4px 0 0',height:`${pct}%`,transition:'height .4s ease',minHeight:h.count>0?3:0}}/>
            <span style={{position:'absolute',bottom:0,fontSize:10,color:'#94A3B8',whiteSpace:'nowrap'}}>{h.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ③ DonutChart
function DonutSVG({ data, colors }: { data:{name:string;value:number}[]; colors:string[] }) {
  const total=data.reduce((s,d)=>s+d.value,0)
  if(!total) return null
  const cx=70,cy=70,or=62,ir=42
  let angle=-Math.PI/2
  const slices=data.map((d,i)=>{
    const sw=(d.value/total)*Math.PI*2
    const x1=cx+or*Math.cos(angle),y1=cy+or*Math.sin(angle)
    const x2=cx+or*Math.cos(angle+sw),y2=cy+or*Math.sin(angle+sw)
    const xi1=cx+ir*Math.cos(angle),yi1=cy+ir*Math.sin(angle)
    const xi2=cx+ir*Math.cos(angle+sw),yi2=cy+ir*Math.sin(angle+sw)
    const p=`M${xi1},${yi1} A${or},${or} 0 ${sw>Math.PI?1:0} 1 ${x2},${y2} L${xi2},${yi2} A${ir},${ir} 0 ${sw>Math.PI?1:0} 0 ${xi1},${yi1} Z`
    angle+=sw
    return {...d,path:p,color:colors[i%colors.length]}
  })
  return (
    <div style={{display:'flex',alignItems:'center',gap:16}}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{flexShrink:0}}>
        {slices.map((s,i)=>(
          <path key={i} d={s.path} fill={s.color} opacity="0.92" strokeWidth="1.5" stroke="#fff">
            <title>{s.name}: {s.value}건</title>
          </path>
        ))}
      </svg>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:7}}>
        {slices.map((s,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0,display:'inline-block'}}/>
            <span style={{fontSize:11,color:'#374151',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
            <span style={{fontSize:11,fontWeight:600,color:'#111',flexShrink:0}}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ④ Treemap (자체 레이아웃 알고리즘)
const TREE_COLORS = ['#1E1B4B','#3730A3','#4F46E5','#7C3AED','#9333EA','#A855F7','#C084FC','#DDD6FE','#EDE9FE']
interface TmItem { name:string; size:number; noshow:number; idx:number }
interface TmRect extends TmItem { x:number; y:number; w:number; h:number }

function tmLayout(items:TmItem[], x:number, y:number, w:number, h:number, total:number): TmRect[] {
  if(!items.length) return []
  if(items.length===1) return [{...items[0],x,y,w,h}]
  let sum=0; let split=1; const half=total/2
  for(let i=0;i<items.length;i++){ sum+=items[i].size; if(sum>=half){ split=i+1; break } }
  split=Math.max(1,Math.min(split,items.length-1))
  const a=items.slice(0,split), b=items.slice(split)
  const aSum=a.reduce((s,i)=>s+i.size,0), bSum=b.reduce((s,i)=>s+i.size,0)
  if(w>=h){
    const aw=w*aSum/total
    return [...tmLayout(a,x,y,aw,h,aSum),...tmLayout(b,x+aw,y,w-aw,h,bSum)]
  } else {
    const ah=h*aSum/total
    return [...tmLayout(a,x,y,w,ah,aSum),...tmLayout(b,x,y+ah,w,h-ah,bSum)]
  }
}

function TreemapSVG({ data, colors }: { data:{name:string;size:number;noshow:number}[]; colors:string[] }) {
  const W=500, H=260, GAP=2
  const sorted=data.filter(d=>d.size>0).map((d,i)=>({...d,idx:i})).sort((a,b)=>b.size-a.size)
  const total=sorted.reduce((s,d)=>s+d.size,0)
  if(!total) return <div style={{textAlign:'center',padding:'32px 0',color:'#CBD5E1',fontSize:12}}>예약 없음</div>
  const rects=tmLayout(sorted,0,0,W,H,total)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:'block'}}>
      {rects.map((r,i)=>{
        const fill=colors[Math.min(r.idx,colors.length-1)]
        const light=r.idx>=6
        const tc=light?'rgba(30,27,75,0.9)':'rgba(255,255,255,0.95)'
        const sc=light?'rgba(30,27,75,0.5)':'rgba(255,255,255,0.6)'
        const rx=r.x+GAP/2, ry=r.y+GAP/2, rw=r.w-GAP, rh=r.h-GAP
        if(rw<4||rh<4) return null
        const showName=rw>52&&rh>26
        const showCount=rw>44&&rh>46
        const lx=rx+10, ly=showCount?ry+rh/2-6:ry+rh/2+5
        const maxCh=Math.floor((rw-16)/7)
        const label=r.name?r.name.length>maxCh?r.name.slice(0,maxCh-1)+'…':r.name:''
        return (
          <g key={i}>
            <rect x={rx} y={ry} width={rw} height={rh} fill={fill} rx={4}/>
            <rect x={rx} y={ry} width={rw} height={rh} fill="transparent" rx={4} stroke="#fff" strokeWidth={GAP}/>
            {showName&&<text x={lx} y={ly} fill={tc} fontSize="12" fontWeight="600"
              fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" dominantBaseline="central">{label}</text>}
            {showCount&&<text x={lx} y={ry+rh/2+13} fill={sc} fontSize="11"
              fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" dominantBaseline="central">
              {r.size}건{r.noshow>0?` · 노쇼 ${r.noshow}`:''}
            </text>}
            <title>{r.name}: {r.size}건{r.noshow>0?` (노쇼 ${r.noshow})`:''}</title>
          </g>
        )
      })}
    </svg>
  )
}

// ─── CardShell: AdminDashboard 카드 래퍼 (외부 정의 → re-render 시 unmount 방지) ──
// 내부 정의 시 AdminDashboard re-render마다 새 컴포넌트 참조 → anm 애니메이션 재실행 → 깜빡거림
const CardShell = memo(function CardShell({ children, type: ct, onClick }: {
  children: React.ReactNode; type: DetailType; onClick: (type: DetailType) => void
}) {
  return (
    <div onClick={() => onClick(ct)} style={{
      background: '#fff', borderRadius: 16, padding: 24, cursor: 'pointer',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
      {children}
    </div>
  )
})

// ─── [2026-05-11 Phase 3] Dashboard 카드 컴포넌트 ───────────────────────────
//   · Figma node 489:393 1:1 — 위젯 ① 승인 대기 + 7개 위젯 placeholder
//   · 각 카드 공통 스타일: bg #fff / radius 24 / padding pt12 px16 pb16
//   · 위젯 ②~⑧은 Phase 4~10에서 PlaceholderCard 자리에 진짜 구현 컴포넌트로 교체

// ─── 위젯 ① 승인 대기 (Figma node 489:406) ──────────────────────────────────
//   사용처: Row 1 Col 1 (356×268, 3-col grid)
//   데이터: pendingCount (props로 전달)
//   동작: 정적 카드 (클릭 액션 없음 — Q5 결정: DetailDrawer 제거)
function ApprovalPendingCard({ count }: { count: number }) {
  return (
    <div style={{
      // ── Figma outer 1:1 ───────────────────────────────
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',      // ← Figma: pt 12 / px 16 / pb 16
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          4,                            // ← Figma: gap 4 (title block ↔ number)
      height:       367,                          // ← [2026-07-23] Figma 갱신: Row1 592×367 (Phase1의 342에서 재조정)
      width:        '100%',                       // ← grid cell 폭 채움 (3-col)
      // Figma는 box-shadow 없음
    }}>
      {/* ── 타이틀 블록 (gap 2) ───────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 500,                        // ← Figma: Medium
          fontSize:   16,                         // ← Figma: 16
          lineHeight: 1.4,                        // ← Figma: 1.4
          color:      '#111',                     // ← Figma: #111
          margin:     0,
          whiteSpace: 'nowrap',
          overflow:   'hidden',
          textOverflow: 'ellipsis',
        }}>승인 대기</p>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 400,                        // ← Figma: Regular
          fontSize:   12,                         // ← Figma: 12
          lineHeight: 1.5,                        // ← Figma: 1.5
          color:      '#AEB5C4',                  // ← Figma: #AEB5C4
          margin:     0,
        }}>즉시 처리 필요</p>
      </div>

      {/* ── 숫자 블록 ──────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', width:'100%' }}>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 400,                        // ← Figma: Regular
          fontSize:   38,                         // ← Figma: 38
          lineHeight: 1.5,                        // ← Figma: 1.5
          color:      '#111',                     // ← Figma: #111
          margin:     0,
        }}>{count}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//   [2026-05-11 Phase 4] 카드별 날짜 필터 인프라 + 위젯 ② 노쇼 현황
// ═══════════════════════════════════════════════════════════════════════════════

// ─── [2026-07-23 Phase 2] fetchBookingsRangeCached / useBookingsByRange 는
//     components/admin/useBookingsByRange.ts 로 이동 (로직 1:1 무변경).
//     사유: 신규 카드 파일이 이 훅을 필요로 하는데 AdminPage에서 export하면 순환참조가 됨.

// ─── SmallDateTrigger — [2026-07-23 Phase 1] components/admin/DashboardRangeFilter.tsx 로 이동 ──
//   사유: 6개 위젯이 각자 인라인으로 날짜행을 조립하던 구조 → 프리셋 pill 추가 시 6곳 중복 수정 필요.
//   DatePickerPopup import도 함께 이동 (이 파일 내 유일한 사용처였음).

// ─── 위젯 ② 노쇼 현황 (Figma node 490:704) ──────────────────────────────────
//   사용처: Row 1 Col 2 (356×268, 3-col grid)
//   데이터: 외곽 봉(총예약 100%) + 내부 봉(노쇼/총예약 비율) 이중 구조
//   동작: 자체 dateFrom/dateTo + useBookingsByRange + 봉 hover/click 시 툴팁
//   ※ Figma 1:1 사양 (gap 48 헤더↔차트, 외곽/내부 봉 gradient, StatusBadge 툴팁)
//   ※ [Phase 4 v3] 라벨 표시: peak 자동 → 인터랙티브 툴팁 (사용자 의도)
// ← [2026-07-23] 노쇼 차트 Y축(노쇼율 %) 라벨 폭 — 고지 지시로 신설
const NOSHOW_Y_AXIS_W = 24

function NoshowChartCard({ onRangeChange }: CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (dedupe cache 통해) ────────────────────────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 일자별 stats (총예약 + 노쇼 + 비율) ──────────────────────────
  //   ← [2026-05-11 Phase 4 v5] total = 그 날 등록된 모든 예약 (사용자 정정)
  //      · 사유: 사용자/관리자/시스템 취소 등 status 무관 — "등록된 모든 예약"이 분모
  //      · 노쇼 ⊆ total (그 날 booking) 보장 → rate ∈ [0, 1] 안전
  //      · 이전 v4 (옵션 A: confirmed + system cancelled): 일부 케이스 여전히 100% → 폐기
  //   isNoshow는 Phase 2 SSOT 그대로 (status='confirmed' + cancelledBy='system' + !checkedIn)
  // ← [2026-07-23 버그수정] 일 단위 고정 → 기간별 자동 롤업 (utils/timeSeries)
  //   기존: 90일 선택 시 막대 90개(폭 2.5px), 365일 초과 시 빈 배열 → 그래프 소실.
  //   변경: ~31일 일별 / ~120일 주별 / 그 이상 월별 → 막대 수가 항상 판독 가능 범위.
  //   ※ 노쇼 판정(isNoshow)과 rate 공식은 1:1 그대로다. 묶는 단위만 바뀐다.
  const { bucket, points: dailyStats } = useMemo(() => {
    // 날짜별 사전 집계 — buildSeries가 버킷마다 다시 순회하지 않도록 O(n) 1회로 끝낸다
    const byDate = new Map<string, { total: number; noshow: number }>()
    bookings.forEach(b => {
      const d = tsDate(b.start_at)
      if (!byDate.has(d)) byDate.set(d, { total: 0, noshow: 0 })
      const s2 = byDate.get(d)!
      s2.total++
      if (isNoshow(b)) s2.noshow++
    })
    const r = buildSeries(dateFrom, dateTo, dates => {
      let total = 0, noshow = 0
      dates.forEach(d => { const v = byDate.get(d); if (v) { total += v.total; noshow += v.noshow } })
      return { total, noshow, rate: total > 0 ? noshow / total : 0 }
    })
    return {
      bucket: r.bucket,
      points: r.points.map(p => ({
        date: p.key, label: p.label,
        total: p.value.total, noshow: p.value.noshow, rate: p.value.rate,
      })),
    }
  }, [bookings, dateFrom, dateTo])

  // ── 4. 활성 봉(hover/click) 상태 ─────────────────────────────────────
  //   ← [2026-05-11 Phase 4 v3] peak 자동 표시 → hover/click 툴팁으로 변경
  //   · 사용자 의도: 평소엔 라벨 없음, 사용자 인터랙션 시에만 그 봉 위에 표시
  //   · activeDate가 set된 봉에만 라벨 렌더링 (각 봉별 그 날 노쇼 건수)
  //   · 데스크탑: bar onMouseEnter → set, container onMouseLeave → null
  //   · 모바일/터치: bar onClick → toggle (같은 봉 재클릭 시 해제)
  const [activeDate, setActiveDate] = useState<string | null>(null)

  // ── 활성 봉의 라벨 내용 ("5월 7일 5건") ──────────────────────────────
  //   activeDate 없거나 dailyStats에 없으면 null → 라벨 안 그림
  const activeLabel = useMemo(() => {
    if (!activeDate) return null
    const active = dailyStats.find(d => d.date === activeDate)
    if (!active) return null
    // ← [2026-07-23] 버킷 라벨 사용 (일별 "7/23" / 주별 "7/20~" / 월별 "7월")
    return `${active.label} ${active.noshow}건`
  }, [activeDate, dailyStats])

  // ── Date 라벨 (차트 아래) — dateFrom 표시 ─────────────────────────────
  // ← [2026-07-23] 좌하단 라벨을 집계 단위 표기로 교체.
  //   기간에 따라 막대 1개가 뜻하는 단위가 달라지므로 반드시 화면에 밝혀야 오독이 없다.
  const dateLabel = useMemo(() => BUCKET_LABEL[bucket], [bucket])

  // ── 일 평균 노쇼율 (Figma 2645:7209 — 라벨 '일 평균 노쇼율' + 큰 숫자) ──
  //   ← [2026-07-23] 기획 의도 복원. Figma 헤더 블록 h144 = 타이틀22 + 날짜행21 + 이 블록 85.
  //
  //   ⚠ 정의: "일별 노쇼율의 평균"이다. 기간 전체 노쇼율(총노쇼/총예약)이 아니다.
  //     라벨이 '일 평균'이므로 문자 그대로 일 단위 평균을 낸다.
  //     단 예약이 0건인 날(주말·공휴일)은 분모에서 제외한다.
  //     포함시키면 rate=0인 날이 평균을 끌어내려 실제보다 낮게 나와 지표가 왜곡된다.
  const avgDailyRate = useMemo(() => {
    const active = dailyStats.filter(d => d.total > 0)     // ← 예약 있는 날만
    if (active.length === 0) return 0
    return active.reduce((sum, d) => sum + d.rate, 0) / active.length
  }, [dailyStats])

  // ── 차트 영역 높이 상수 (Figma) ───────────────────────────────────────
  const CHART_HEIGHT = 111

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      justifyContent:'space-between',                // ← [2026-07-23] gap 48 → space-between
                                                     //   Figma: 헤더블록 y12~156(h144) / 차트블록 y252~384 → 간격이 자동 산출됨
      height:       400,                          // ← [2026-07-23 Phase 1] Figma Row3 389.33×400 (기존 268 — Row1 3-col 시절 값)
      width:        '100%',
      // ← Peak label이 차트 위로 absolute 위치하므로 overflow visible 필요 없음
      //   (gap 48 안에서 자연스럽게 들어감)
    }}>
      {/* ── 헤더 (Figma 2645:7105 h144: 타이틀22 + gap8 + 날짜행21 + gap8 + 노쇼율블록85) ──
            ← [2026-07-23] gap 2 → 8. 이 카드만 Figma가 8이다(다른 카드는 2 또는 4). */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:8, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>노쇼 현황</p>{/* ← [2026-07-23] Figma 문구: '일일' 제거 */}
        {/* ── 날짜 범위 (SmallDateTrigger × 2 + ⎯) — Figma 1:1 ── */}
        {/* ← [2026-07-23 Phase 1] SmallDateTrigger×2 인라인 조립 → DashboardRangeRow 공통 행 (프리셋 pill 한 달/3개월/전체 포함) */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />

        {/* ── 일 평균 노쇼율 (Figma 2645:7209 — 라벨 18 + 숫자 57, 블록 h85) ──
              ← [2026-07-23] 기획 의도 복원: 이 카드는 "기간별 일자 분포 + 일 평균 노쇼율" 두 축이다.
                분포 차트만 있으면 "그래서 평균이 몇 %인가"를 읽을 수 없다. */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', justifyContent:'center', height:85 }}>{/* ← [2026-07-23] Figma 2645:7209 블록 h85 명시 */}
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>일 평균 노쇼율</span>
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:38, lineHeight:1.5, color:'#111',
          }}>{loading ? '—' : `${Math.round(avgDailyRate * 100)}%`}</span>
        </div>
      </div>

      {/* ── 차트 영역 (flex column gap 6) ────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:6, width:'100%', position:'relative' }}>
        {/* ── [2026-07-23] Y축 = 노쇼율 눈금 (고지 지시로 신설) ──
              외곽 봉이 그 날 전체 예약(=100%)이고 내부 봉이 노쇼 비율이므로 Y축 단위는 %다.
              축 폭 24px를 확보하고 봉 영역을 그만큼 오른쪽으로 민다. */}
        <div style={{ display:'flex', alignItems:'stretch', gap:6, width:'100%' }}>
          <div style={{
            width:NOSHOW_Y_AXIS_W, height:CHART_HEIGHT, flexShrink:0,
            display:'flex', flexDirection:'column', justifyContent:'space-between',
            pointerEvents:'none',
          }}>
            {['100%','50%','0%'].map(t => (
              <span key={t} style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif", fontWeight:500, fontSize:9, lineHeight:1,
                letterSpacing:'0.1px', color:'#DDE1E6',
              }}>{t}</span>
            ))}
          </div>
        {/* ── Bar 컨테이너 (h 111, flex row gap 4, items-end) ── */}
        {/*    ← [Phase 4 v3] onMouseLeave로 컨테이너 벗어나면 라벨 해제 (hover 추적) */}
        <div
          onMouseLeave={() => setActiveDate(null)}
          style={{
            display:    'flex',
            alignItems: 'flex-end',
            gap:        4,                              // ← Figma: gap 4 (bar 간격)
            height:     CHART_HEIGHT,
            width:      '100%',
            position:   'relative',
          }}>
          {dailyStats.length === 0 ? (
            <div style={{ flex:1, height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
              {loading ? '로딩 중…' : '데이터 없음'}
            </div>
          ) : (
            dailyStats.map(d => {
              const isActive = d.date === activeDate     // ← [Phase 4 v3] peak → activeDate
              // ── 외곽 봉 + 내부 봉 이중 구조 (사용자 설명 1:1) ──
              //   · 외곽: 총예약 100% 기준 → 모두 동일 111px (Q1)
              //   · 내부: 111 × 노쇼율 만큼 하단 채움 (Q3)
              const innerH = CHART_HEIGHT * d.rate       // ← 0~111 (rate는 0~1 보장)
              return (
                <div
                  key={d.date}
                  // ── [Phase 4 v3] 인터랙티브 툴팁 이벤트 ──
                  //   · 데스크탑: hover로 즉시 표시 (mouseEnter)
                  //   · 모바일/터치: 탭으로 toggle (같은 봉 재탭 시 해제)
                  // ← [2026-05-26 Dashboard 카드 클릭 활성화] e.stopPropagation — 봉 클릭이 카드 wrapper onClick으로 bubble-up 차단
                  onMouseEnter={() => setActiveDate(d.date)}
                  onClick={(e) => { e.stopPropagation(); setActiveDate(prev => prev === d.date ? null : d.date) }}
                  style={{
                    flex:     1,
                    height:   CHART_HEIGHT,
                    position: 'relative',
                    minWidth: 0,                         // ← grid overflow 안전장치
                    cursor:   'pointer',                 // ← 인터랙션 가능 명시
                  }}>
                  {/* ── 외곽 봉 (희미, 총예약 100% 기준) ── */}
                  <div style={{
                    position:     'absolute',
                    inset:        0,
                    borderRadius: 24,
                    background:   'linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)',
                  }}/>
                  {/* ── 내부 봉 (진함, 노쇼/총예약 비율) ── */}
                  {innerH > 0 && (
                    <div style={{
                      position:     'absolute',
                      bottom:       0,
                      left:         0,
                      right:        0,
                      height:       innerH,
                      borderRadius: 24,
                      background:   'linear-gradient(to bottom, #000 0%, #7E7F80 100%)',
                      transition:   'height 0.4s ease',
                    }}/>
                  )}
                  {/* ── 툴팁 라벨 (활성 봉에만 표시) ── */}
                  {/*   Figma StatusBadge-XS 사양 (bg rgba(255,255,255,0.9), border 1px #000) */}
                  {isActive && activeLabel && (
                    <div style={{
                      position:     'absolute',
                      // 내부 봉 top 위쪽 6px (rate=0이면 봉 바닥 = 차트 바닥 위)
                      bottom:       innerH + 6,
                      left:         '50%',
                      transform:    'translateX(-50%)',
                      background:   'rgba(255,255,255,0.9)',
                      border:       '1px solid #000',
                      borderRadius: 24,
                      padding:      '2px 8px',
                      display:      'flex',
                      gap:          10,
                      alignItems:   'center',
                      justifyContent:'center',
                      fontFamily:   "'Pretendard', -apple-system, sans-serif",
                      fontWeight:   400,
                      fontSize:     10,
                      lineHeight:   1.5,
                      letterSpacing:'0.1px',
                      color:        '#1E1E1E',
                      whiteSpace:   'nowrap',
                      pointerEvents:'none',              // ← 라벨이 hover/click 방해 X
                      zIndex:       1,                   // ← 인접 봉 위에 표시
                    }}>
                      {activeLabel}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
        </div>{/* ← [2026-07-23] Y축 + 봉 영역 래퍼 닫기 */}

        {/* ── X·Y축 단위 라벨 (차트 아래) ──────────────────────
              ← [2026-07-23] 기존엔 시작일 하나만 있었다. 기간에 따라 봉 1개의 단위가
                바뀌므로(일/주/월) 반드시 명시해야 오독이 없다. */}
        <div style={{
          display:'flex', justifyContent:'space-between', width:'100%',
          paddingLeft: NOSHOW_Y_AXIS_W + 6,
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:400, fontSize:10, lineHeight:1.5, color:'#AEB5C4',
          whiteSpace:'nowrap',
        }}>
          <span>x · {dateLabel}</span>
          <span>y · 노쇼율</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ③ 최근 생성된 예약 (Figma node 551:3458) ──────────────────────────
//   사용처: Row 1 Col 3 (356×268, 3-col grid)
//   데이터: bookings prop top 5 sorted by createdAt desc (옵션 A — 자체 fetch 안 함)
//   동작: row 클릭 → onDetail(booking) → BookingModal 열기
//   ※ Figma 1:1 사양: 헤더(타이틀만, 날짜 범위 없음) + 5 rows (각 h 34)
function RecentBookingsCard({
  users,
  rooms,
  onDetail,
  onRangeChange,
}: {
  users:    AppUser[]
  rooms:    Room[]
  onDetail?: (b: Booking) => void
} & CardRangeReporter) {
  // ── [2026-07-23 Figma 갱신 반영] 카드 전면 재설계 ─────────────────────────
  //   변경 전: bookings prop(대시보드 전역 목록)에서 createdAt desc top5만 뽑아 표시.
  //            헤더는 타이틀 한 줄, 건수 블록·컬럼 헤더·기간 필터가 모두 없었다.
  //   변경 후: Figma 2646:7239 1:1 —
  //            타이틀 + 기간 pill(오늘/일주일/한 달) + "예약 건 수" 큰 숫자 + 컬럼헤더 + 5행
  //   ※ 기간 필터가 생겼으므로 bookings prop이 아니라 자체 fetch로 전환한다.
  //      prop은 대시보드 전역 로딩 범위(−3개월)에 묶여 있어 '오늘'만 세는 것이 불가능하고,
  //      "한 달" 선택 시 prop 범위와 카드 표기가 어긋나는 이중 진실이 된다.
  //   ※ 기준 날짜는 start_at이 아니라 created_at(생성일)이다 — 카드 이름이 '생성된 예약'이다.
  const [dateFrom, setDateFrom] = useState<string>(() => todayStr())   // ← 기본 '오늘' (Figma 첫 pill)
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  const [rows,    setRows]    = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // dateField='created_at' — DetailDrawer의 '생성일 모드'와 동일한 조회 경로
    loadBookingsByRange(dateFrom, dateTo, 'created_at')
      .then(d => { if (!cancelled) setRows(d) })
      .catch(e => console.error('[RecentBookingsCard] fetch failed', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  // 전체 건수(큰 숫자)는 기간 내 생성된 예약 전부, 목록은 최신 5건
  const totalCount = rows.length
  const recent = useMemo(() => (
    [...rows]
      .filter(b => b.createdAt != null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
  ), [rows])

  const COLS = [1, 1, 1]   // ← Figma: 178.67 × 3 균등 3분할

  return (
    <div style={{
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      height:       367,                          // ← [2026-07-23] Figma 갱신: Row1 592×367 (기존 342)
      width:        '100%',
    }}>
      {/* ── 헤더 블록 (Figma 2646:7240 — h136) ────────────────────────────
            타이틀 22 + gap4 + 날짜행 21 + gap4 + [라벨 18 + 숫자 57] */}
      <div style={{ display:'flex', flexDirection:'column', gap:4, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>최근 생성된 예약</p>

        {/* ← [2026-07-23] Figma 2646:7652 — 이 카드만 오늘/일주일/한 달 프리셋 */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
          presets={RANGE_PRESETS_RECENT}
        />

        {/* 예약 건 수 (Figma 2646:7243 — 라벨 '예약 건 수' + 숫자 57) */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', justifyContent:'center', height:85 }}>{/* ← [2026-07-23] Figma 2646:7243 블록 h85 명시 */}
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>예약 건 수</span>
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:38, lineHeight:1.5, color:'#111',
          }}>{loading ? '—' : totalCount}</span>
        </div>
      </div>

      {/* ── 표 (Figma 2646:7246 — 헤더행 33 + 데이터행 34 × 5 = 203) ────── */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {/* 컬럼 헤더 — ← [2026-07-23] Figma 2646:7247 신규 추가 */}
        <div style={{ display:'flex', alignItems:'center', height:33, gap:12 }}>
          {['회의','회의실','예약자'].map((l, i2) => (
            <div key={l} style={{ flex:COLS[i2], minWidth:0 }}>
              <span style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif",
                fontWeight:400, fontSize:12, lineHeight:1.4, color:'#AEB5C4',
              }}>{l}</span>
            </div>
          ))}
        </div>

        {recent.length === 0 ? (
          <div style={{
            height: 34 * 5, display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:"'Pretendard', -apple-system, sans-serif", fontSize:12, color:'#CBD5E1',
          }}>{loading ? '로딩 중…' : '해당 기간에 생성된 예약이 없습니다'}</div>
        ) : (
          <>
            {recent.map(b => {
              // 표시명·프로필: users 배열 live 우선, 스냅샷 fallback (프로젝트 live-first 원칙)
              const user        = users.find(u => u.user_id === b.user_id)
              const ownerName   = user?.name ?? b.user ?? '—'
              const ownerAvatar = user?.avatar_url ?? null
              const roomName    = rooms.find(r => r.room_id === b.room_id)?.room_name ?? '—'
              return (
                <div
                  key={b.id}
                  // ← [2026-05-26] 행 클릭은 onDetail(개별 예약), 카드 wrapper 클릭은 DetailDrawer
                  onClick={(e) => { e.stopPropagation(); onDetail?.(b) }}
                  style={{
                    display:'flex', alignItems:'center', height:34, gap:12,
                    width:'100%', cursor:'pointer',
                  }}>
                  <div style={{ flex:COLS[0], minWidth:0 }}>
                    <span style={{
                      fontFamily:"'Pretendard', -apple-system, sans-serif",
                      fontWeight:400, fontSize:13, lineHeight:1.4, color:'#111',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'block',
                    }}>{b.title || '—'}</span>
                  </div>
                  <div style={{ flex:COLS[1], minWidth:0 }}>
                    <span style={{
                      fontFamily:"'Pretendard', -apple-system, sans-serif",
                      fontWeight:400, fontSize:12, lineHeight:1.5, color:'#697077',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'block',
                    }}>{roomName}</span>
                  </div>
                  <div style={{ flex:COLS[2], minWidth:0 }}>
                    {/* ← [2026-07-23] 공통 셀로 교체 — 사용자 예약 순위/누적 노쇼와 동일 표시 */}
                    <DashboardUserCell name={ownerName} avatarUrl={ownerAvatar} />
                  </div>
                </div>
              )
            })}
            {/* 5행 미만이면 빈 행으로 채워 카드 높이 고정 */}
            {Array.from({ length: Math.max(0, 5 - recent.length) }).map((_, i2) => (
              <div key={`empty-${i2}`} style={{ height:34 }} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ─── 위젯 ④ 예약 많은 회의실 (Figma node 551:3513) ──────────────────────────
//   사용처: Row 2 Col 1 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + rooms prop
//   동작: 9 회의실 모두 표시, count desc 정렬, count 0도 마지막에 표시 (Q2)
//   ※ Figma 1:1: 9-row 점진적 height + 점진적 색상 그라데이션 (rank 시각화)

// ─── ROOM_RANK_COLORS — 순위 명도 (Figma 551:3513 팔레트 유지) ──────────
//
//  🔧 [2026-07-24 #3] 그래프 문법 변경 — 고지 승인 (코드 선반영, Figma 미반영)
//
//  ★ 왜 바꾸는가
//    기존 행은 **막대 폭이 전부 100% 고정**이었다. 값을 담은 건 우측 숫자뿐이고,
//    그래프가 표현하던 것은 순위(회색 명도)와 계단식 높이(52/46/29)뿐이었다.
//    그 높이조차 값 비례가 아니라 임의 단계라, 실측 1위 123건 vs 9위 47건(0.38배)
//    차이가 그림에 전혀 드러나지 않았다. 차트가 아니라 순위표였던 셈이다.
//
//  ★ 무엇을 바꿨나
//    · 막대 **폭 = 건수 비율**(1위 기준 100%)  ← 값 인코딩 신설
//    · 행 높이는 균일(계단 폐기) — 폭이 값을 맡았는데 높이까지 값처럼 보이면
//      서로 다른 두 인코딩이 충돌한다
//    · 회색 명도는 **순위 표시로 그대로 유지**(Figma 팔레트 보존)
//    · 라벨·건수는 막대 **바깥**에 둔다 — 옆 '회의실별 가동률'은 막대 안에
//      mixBlendMode 로 얹지만, 그건 채움색이 #111 단색이라 가능한 방식이다.
//      여기는 중간 회색(#8D8D8D 등)이 섞여 difference 블렌드가 중간톤 위에서
//      대비를 잃는다. 바깥 배치가 어떤 명도에서도 안전하고, 덤으로 옆 카드와
//      시각적으로도 구분된다.
const ROOM_RANK_COLORS: string[] = [
  '#393939',   // 1위 — 가장 진함
  '#525252',
  '#6F6F6F',
  '#8D8D8D',
  '#A8A8A8',
  '#C6C6C6',
  '#E0E0E0',
  '#F4F4F4',
  '#F4F4F4',   // 9위 — 가장 밝음
]

/**
 * 막대 위 라벨 색 (← [2026-07-24 #7])
 *
 * ⚠ Figma(2680:11555 등)는 9행 **전부 흰색 글자**로 지정돼 있다. 그런데 8·9위 막대는
 *   #F4F4F4 라서 흰 글자가 배경에 묻혀 사실상 안 보인다(실제 화면에서 확인됨).
 *   명도 대비를 지키기 위해 밝은 막대에서만 어두운 글자로 바꾼다.
 *   — 색 값은 Figma 팔레트 그대로, 글자색만 대비 기준으로 보정.
 */
const rankLabelColor = (rank: number) => (rank <= 4 ? '#fff' : '#4A4A4A')

/** Graph 블록 최소 높이 — Figma 2680:11523 h280 (9행 × 30.22 + 8 × 1px gap) */
const ROOM_RANK_GRAPH_MIN_H = 280
/** 우측 값 칸 폭 + 막대와의 간격 — Figma: 값칸 35 + 여백 19.33 ≒ 54 */
const ROOM_RANK_VALUE_RESERVE = 54

function RoomRankingCard({ rooms, onRangeChange }: { rooms: Room[] } & CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (Phase 4 cache 재사용, 위젯 ②와 dedupe) ────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 회의실별 카운트 + desc 정렬 (Q1: 모든 booking, Q2: 9개 모두) ──
  const roomStats = useMemo(() => {
    return [...rooms]
      .map(r => ({
        room:  r,
        count: bookings.filter(b => b.room_id === r.room_id).length,  // Q1: 그 날짜 범위 모든 booking
      }))
      .sort((a, b) => b.count - a.count)                              // Q2: count desc, 0도 마지막에 표시
  }, [bookings, rooms])

  /** 막대 폭 기준값 = 1위 건수 (← [2026-07-24 #3]) */
  const maxRoomCount = useMemo(
    () => roomStats.reduce((m, s) => Math.max(m, s.count), 0),
    [roomStats]
  )

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',                // ← Figma: 헤더↔리스트 양 끝 분배
      // ← [2026-07-24 #2] 헤더(기간 버튼) ↔ 리스트 최소 간격 32px.
      //   space-between 은 '남는 공간'을 나눠줄 뿐이라, 카드 높이가 내용과 같아지는
      //   순간 간격이 0이 된다. 고정 504 를 걷어내면서 실제로 그렇게 됐다.
      //   gap 은 남는 공간과 무관한 **하한**이므로 space-between 과 같이 써야
      //   "붙지도 않고, 남으면 벌어지는" 동작이 된다.
      gap:           32,
      // ← [2026-07-24 #7] 하한 364 → 457 (Figma 2680:11508 카드 높이).
      //   헤더 51 + gap 32 + Graph 280 + padding 28 = 391 이 물리적 최소인데,
      //   그 값으로 두면 행이 30px 로 눌려 라벨(11px)이 답답해진다. Figma 높이를 하한으로 쓴다.
      minHeight:     457,
      width:         '100%',
    }}>
      {/* ── 헤더 (Figma 2680:11509 — gap 8) ─────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:8, width:'100%', flexShrink:0 }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>예약 많은 회의실</p>
        {/* ── 날짜 범위 picker (SmallDateTrigger × 2 + ⎯) — Q3: 위젯 ②와 동일 ── */}
        {/* ← [2026-07-23 Phase 1] SmallDateTrigger×2 인라인 조립 → DashboardRangeRow 공통 행 (프리셋 pill 한 달/3개월/전체 포함) */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── Graph (Figma 2680:11523) ───────────────────────────────────────
            행 구성: [트랙 #F4F5FB [채움막대 + 라벨]] ……… [건수]

            ★ [2026-07-24 #7] 간격·크기 재설계
              · 행 높이를 고정하지 않는다. Figma 는 Graph 블록을 h280 으로 잡고
                9행에 flex:1 을 줘 균등 분배한다. 여기서는 블록을 **flex:1 + minHeight 280**
                으로 두어, 카드가 그리드 셀 높이만큼 늘어나면 행도 같이 늘어난다.
                고정 높이로 두면 늘어난 만큼이 그대로 빈 공간이 되어(지금 화면의 그 여백)
                "그래프는 작은데 카드만 큰" 상태가 된다.
              · 행 사이 간격은 Figma 대로 1px. 2px 이상 벌리면 9행이 리스트처럼 끊겨 보이고
                막대 길이 비교가 어려워진다.
              · 라벨을 막대 **안**으로 되돌렸다(Figma 2680:11554). 폭이 곧 값이므로
                막대 밖에 라벨을 두면 그만큼 막대에 쓸 폭이 줄어든다.

            1위 대비 비율로 폭을 잡는다. 절대 기준(예: 200건=100%)을 쓰면
            한산한 기간에는 모든 막대가 뭉개져 비교가 안 된다. */}
      <div style={{
        display:'flex', flexDirection:'column', gap:1, width:'100%',
        flex:1, minHeight:ROOM_RANK_GRAPH_MIN_H,
      }}>
        {roomStats.length === 0 ? (
          <div style={{ padding:'40px 0', textAlign:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '회의실 데이터 없음'}
          </div>
        ) : (
          roomStats.slice(0, ROOM_RANK_COLORS.length).map((s, i) => {
            // 0으로 나누기 방지 — 전 회의실 0건이면 막대는 전부 0폭
            const ratio = maxRoomCount > 0 ? s.count / maxRoomCount : 0
            return (
              <div
                key={s.room.room_id}
                title={`${s.room.room_name} · ${s.count}건`}
                style={{
                  // Figma 2680:11553 — 행 자체가 트랙. flex:1 로 블록 높이를 균등 분배
                  flex:          '1 0 0',
                  minHeight:     0,
                  display:       'flex',
                  alignItems:    'center',
                  justifyContent:'space-between',
                  width:         '100%',
                  background:    '#F4F5FB',
                  borderRadius:  1,
                  overflow:      'hidden',
                  fontFamily:    "'Pretendard', -apple-system, sans-serif",
                  fontWeight:    400,
                  fontSize:      11,
                  lineHeight:    1.25,
                  letterSpacing: '0.11px',
                }}>
                {/* 채움막대 — 폭이 곧 값. 우측 값 칸(54px)을 뺀 폭에 비율을 곱한다 */}
                <div style={{
                  width:      `calc((100% - ${ROOM_RANK_VALUE_RESERVE}px) * ${ratio})`,
                  height:     '100%',
                  minWidth:   s.count > 0 ? 2 : 0,   // 1건이라도 있으면 존재는 보이게
                  background: ROOM_RANK_COLORS[i],
                  display:    'flex', alignItems:'center',
                  padding:    '0 12px',
                  transition: 'width 0.4s ease',
                  boxSizing:  'border-box',
                }}>
                  <span style={{
                    color: rankLabelColor(i),
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{s.room.room_name}</span>
                </div>

                {/* 건수 — Figma 2680:11556 (px8 · #4A4A4A) */}
                <span style={{ padding:'0 8px', color:'#4A4A4A', flexShrink:0 }}>{s.count}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── RankListRow — 랭크 서클 + 라벨 + 우측 카운트 (Figma Frame 48096263 행) ──
//   [2026-07-23 Phase 2-B] 신설.
//   사유: Figma 551:3316에서 '회의실 노쇼 현황' Top5 행과 '부서 예약 순위' 8행이
//         완전히 동일한 행 컴포넌트다. 각 위젯이 따로 마크업을 들고 있으면
//         한쪽만 Figma 수정이 반영되어 두 카드가 미세하게 어긋난다.
//   ※ RoomNoshowCard가 쓰던 현행 마크업을 그대로 승격한 것 — 치수·색상 변경 없음.
function RankListRow({ rank, label, count, first, empty = false }: {
  rank:   number
  label:  string
  count:  number | string
  first:  boolean        // ← 첫 행만 borderTop (Figma 1:1)
  empty?: boolean        // ← 데이터 부족분 placeholder 행 (회색 처리)
}) {
  const fg = empty ? '#CBD5E1' : '#000'
  return (
    <div style={{
      // ── Figma row 1:1: py 8, border-top(첫 행만) + border-bottom #FAFBFF ──
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      padding:       '8px 0',
      borderTop:     first && !empty ? '1px solid #FAFBFF' : 'none',
      borderBottom:  '1px solid #FAFBFF',
      width:         '100%',
    }}>
      {/* ── 좌측: rank circle + 라벨 (gap 10) ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:1, minWidth:0, paddingRight:8 }}>
        {/* ── Rank circle (Figma: 16×16, border 1px, radius 999) ── */}
        <div style={{
          width:16, height:16,
          border: empty ? '1px solid #CBD5E1' : '1px solid #000',
          borderRadius:999,
          display:'flex', alignItems:'center', justifyContent:'center',
          flexShrink:0,
        }}>
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:8, lineHeight:1.5, color:fg,
          }}>{rank}</span>
        </div>
        <span style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:400, fontSize:12, lineHeight:1.5, color:fg,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{label}</span>
      </div>
      {/* ── 우측: count ── */}
      <span style={{
        fontFamily:"'Pretendard', -apple-system, sans-serif",
        fontWeight:400, fontSize:12, lineHeight:1.5, color:fg,
        flexShrink:0,
      }}>{count}</span>
    </div>
  )
}

// ─── 위젯 ⑤ 회의실 노쇼 현황 (Figma node 551:3548) ──────────────────────────
//   사용처: Row 2 Col 2 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + isNoshow SSOT
//   동작: 9 회의실 모두 차트 + Top 5 ranked list + bar hover/click 시 label
//   ※ Figma 1:1: 3-section (헤더 + 세로 bar 차트 + ranked list)
function RoomNoshowCard({ rooms, onRangeChange }: { rooms: Room[] } & CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④와 dedupe) ────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 회의실별 노쇼 카운트 + desc 정렬 (Q1, Q2: 9개 모두) ──────────
  const roomNoshow = useMemo(() => {
    return [...rooms]
      .map(r => ({
        room:   r,
        noshow: bookings.filter(b => b.room_id === r.room_id && isNoshow(b)).length,
      }))
      .sort((a, b) => b.noshow - a.noshow)                         // Q1: noshow desc
  }, [bookings, rooms])

  // ── 4. 차트 max 값 (bar height 비례 계산) ──────────────────────────
  //   maxNoshow=0이면 모든 bar 내부 미표시 (외곽만 보임)
  const maxNoshow = useMemo(
    () => roomNoshow.reduce((m, s) => Math.max(m, s.noshow), 0),
    [roomNoshow]
  )

  // ── 5. Top 5 ranked list (Q3: 항상 5, count 0이어도 채움) ──────────
  const top5 = useMemo(() => roomNoshow.slice(0, 5), [roomNoshow])

  // ── 6. 인터랙티브 hover/click state (Q4: 위젯 ② v3 패턴) ───────────
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const activeRoom = useMemo(
    () => roomNoshow.find(s => s.room.room_id === activeRoomId) ?? null,
    [activeRoomId, roomNoshow]
  )

  // ── 차트 상수 (Figma 사양) ──────────────────────────────────────────
  const CHART_HEIGHT     = 126    // ← [2026-07-23 Phase 2-B] Figma 2646:7433 h126 (기존 172 — 542×504 시절 값)
  const CHART_INNER_MAX  = 109    // ← Figma: 내부 bar max (Bar 1 = max noshow)

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 24px 16px',           // ← Figma: pt12 px16 pb24 (위젯 ④의 pb16과 다름)
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',
      height:        400,                         // ← [2026-07-23 Phase 1] Figma Row3 389.33×400 (기존 542×504)
      width:         '100%',
    }}>
      {/* ── 헤더 (gap 2) ────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>회의실 노쇼 현황</p>
        {/* ── 날짜 범위 picker (위젯 ②④와 동일) ── */}
        {/* ← [2026-07-23 Phase 1] SmallDateTrigger×2 인라인 조립 → DashboardRangeRow 공통 행 (프리셋 pill 한 달/3개월/전체 포함) */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 세로 bar 차트 (h 172, gap 2, 9 bars flex 1) ────── */}
      <div
        onMouseLeave={() => setActiveRoomId(null)}
        style={{
          display:    'flex',
          alignItems: 'flex-start',
          gap:        2,                                // ← Figma: gap 2 (bar 간격)
          height:     CHART_HEIGHT,
          width:      '100%',
          position:   'relative',
        }}>
        {roomNoshow.length === 0 ? (
          <div style={{ flex:1, height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '회의실 데이터 없음'}
          </div>
        ) : (
          roomNoshow.map(s => {
            const isActive = s.room.room_id === activeRoomId
            // ── 내부 bar height: 노쇼 비례, max 109px (Figma 사양) ──
            //   · maxNoshow=0이면 모든 bar 내부 h=0 → 외곽만 표시
            //   · noshow>0이면 최소 8px 보장 (가시성)
            const innerH = maxNoshow > 0 && s.noshow > 0
              ? Math.max(8, (s.noshow / maxNoshow) * CHART_INNER_MAX)
              : 0
            return (
              <div
                key={s.room.room_id}
                // ← [2026-05-26 Dashboard 카드 클릭 활성화] e.stopPropagation
                onMouseEnter={() => setActiveRoomId(s.room.room_id)}
                onClick={(e) => { e.stopPropagation(); setActiveRoomId(prev => prev === s.room.room_id ? null : s.room.room_id) }}
                style={{
                  flex:     1,
                  height:   CHART_HEIGHT,
                  position: 'relative',
                  // ── Figma: 외곽 bg #F6F7FA, items-end (bottom 정렬) ──
                  background:'#F6F7FA',
                  display:    'flex',
                  flexDirection:'column',
                  justifyContent:'flex-end',          // ← Figma: justify-end (내부 bar 하단 정렬)
                  alignItems:'stretch',
                  minWidth:0,                          // ← grid overflow 안전
                  cursor:   'pointer',
                }}>
                {/* ── 내부 bar (활성 시 진한 색상 — Q4) ── */}
                {innerH > 0 && (
                  <div style={{
                    width:'100%',
                    height: innerH,
                    // ── Figma rotate-180 + bg-gradient-to-b 시각 효과 = to top 사용 ──
                    //   · 기본: 위 #DDD(진함) → 아래 #F1F1F1(밝음)
                    //   · 활성: 위 #424242(더 진함) → 아래 #747474(밝음)
                    background: isActive
                      ? 'linear-gradient(to top, #747474 0.481%, #424242 58.173%)'
                      : 'linear-gradient(to top, #F1F1F1 0.481%, #DDD 58.173%)',
                    transition:'height 0.4s ease, background 0.15s ease',
                  }}/>
                )}
              </div>
            )
          })
        )}
        {/* ── 활성 bar에 label 표시 (Q4: 위젯 ② v3 패턴) ── */}
        {activeRoom && (() => {
          const idx       = roomNoshow.findIndex(s => s.room.room_id === activeRoom.room.room_id)
          if (idx < 0) return null
          const barCount  = roomNoshow.length
          // bar 폭: flex 1 균등분할 = (100% - gaps) / count
          const totalGap  = (barCount - 1) * 2
          const barW      = `calc((100% - ${totalGap}px) / ${barCount})`
          const innerH    = maxNoshow > 0 && activeRoom.noshow > 0
            ? Math.max(8, (activeRoom.noshow / maxNoshow) * CHART_INNER_MAX)
            : 0
          return (
            <div style={{
              position:    'absolute',
              // label 위치: bar 중앙 위쪽
              bottom:      innerH + 6,
              left:        `calc(${idx} * (${barW} + 2px) + ${barW} / 2)`,
              transform:   'translateX(-50%)',
              // ── Figma StatusBadge-XS 사양 (위젯 ② 동일) ──
              background:  'rgba(255,255,255,0.9)',
              border:      '1px solid #000',
              borderRadius:24,
              padding:     '2px 8px',
              display:     'flex',
              gap:         10,
              alignItems:  'center',
              fontFamily:  "'Pretendard', -apple-system, sans-serif",
              fontWeight:  400,
              fontSize:    10,
              lineHeight:  1.5,
              letterSpacing:'0.1px',
              color:       '#1E1E1E',
              whiteSpace:  'nowrap',
              pointerEvents:'none',
              zIndex:      1,
            }}>
              {activeRoom.room.room_name} {activeRoom.noshow}건
            </div>
          )
        })()}
      </div>

      {/* ── Top 5 ranked list (h 34 × 5 rows = 170) — Figma 2646:7452 ──
            ← [2026-07-23 Phase 2-B] 인라인 마크업 → 공통 RankListRow (부서 예약 순위와 동일 컴포넌트) */}
      <div style={{
        display:'flex', flexDirection:'column', width:'100%',
      }}>
        {top5.map((s2, i2) => (
          <RankListRow
            key={s2.room.room_id}
            rank={i2 + 1}
            label={s2.room?.room_name ?? '—'}
            count={s2.room ? s2.noshow : '—'}
            first={i2 === 0}
          />
        ))}
        {/* ── Q3: rooms.length < 5인 경우 placeholder row로 5개 채움 (count 0 표시) ── */}
        {Array.from({ length: Math.max(0, 5 - top5.length) }).map((_, i2) => (
          <RankListRow
            key={`empty-${i2}`}
            rank={top5.length + i2 + 1}
            label="—"
            count={0}
            first={false}
            empty
          />
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑥ 예약추이 (Figma node 565:21848) — Mountain/Spline Area Chart ────
//   사용처: Row 3 Col 1 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange
//   동작: Catmull-Rom 스플라인 보간으로 부드러운 곡선 영역 차트 (Mountain Chart)
//   ※ Figma 1:1: SVG path + 그라데이션 fill (회색 진함 → 흰색 fade-out) + 외곽선
//   ※ 옛 BookingTrendsBarCard (이중 봉) 폐기 — 사용자 정정 (추세 표현이 본질)
//   ※ 결정사항 (사용자 확정):
//     · Q1 Catmull-Rom 곡선 (자연스러움, 표준 tension=1)
//     · Q2 Figma 1:1 그라데이션 (회색 진함 → 흰색 fade-out)
//     · Q3 영역 + 외곽선 (line stroke)
//     · Q4 Active 데이터 포인트 작은 원 (Figma 1:1, size 6)
//     · Q5 column별 hit area (위젯 ⑥ 패턴 - hover detection)

// ─── catmullRomPath — Catmull-Rom 스플라인을 SVG cubic Bezier path로 변환 ─
//   · Q1 결정: Catmull-Rom (peak sharp + 자연스러운 보간)
//   · tension=1: 표준 Catmull-Rom (Monotone은 단조성 강제로 작위적,
//     B-spline은 너무 부드러워 peak 손실)
//   · 알고리즘: N개 점 → N-1개 cubic Bezier segment 생성
//     각 segment의 control point는 인접한 4개 점 (P[i-1], P[i], P[i+1], P[i+2])로 계산
//   · 양 끝 점은 인접 점이 없으므로 자기 자신을 복제 (mirror)
function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`

  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]            // ← 첫 segment는 P[i] 복제 (mirror)
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? points[i + 1]        // ← 마지막은 P[i+1] 복제 (mirror)

    // Catmull-Rom → Cubic Bezier 변환 (tension=1 표준)
    //   CP1 = P[i]   + (P[i+1] - P[i-1]) / 6
    //   CP2 = P[i+1] - (P[i+2] - P[i])   / 6
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }

  return path
}

// ─── linearPath — 직선 polyline SVG path (각진 mountain chart) ────────────
//   · 데이터 포인트를 직선으로 연결 (sharp peak, Catmull-Rom 곡선보다 각짐)
//   · 사용자 정정 2026-05-12: 곡선 → 직선 (각진 시각 효과)
//   · catmullRomPath와 동일한 input/output 시그니처 (drop-in 교체 가능)
function linearPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`
  }
  return path
}
// ─── BOOKING_TRENDS — Figma 1:1 차트 viewBox 사양 ───────────────────────
const TREND_VIEWBOX_W = 510       // ← Figma 565:21965: w 509 (510으로 단순화)
const TREND_VIEWBOX_H = 414       // ← Figma: 차트 영역 height
const TREND_PADDING_TOP = 22      // ← Figma: SVG path가 chart 상단 5.2%부터 시작 (peak 잘림 방지)
const TREND_MARKER_LINE_H = 40    // ← Figma 570:7429: 활성 marker 수직 연결선 h-[40px]

// ← [2026-07-23] Y축 라벨 영역 폭 (고지 지시로 신설 — Figma에는 없던 요소)
const TREND_Y_AXIS_W = 28

function BookingTrendsAreaCard({ onRangeChange }: CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑦⑧와 dedupe) ──────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 일자별 count (모든 booking, 위젯 ②⑦⑧과 일관성) ──────────────
  // ← [2026-07-23] 일 단위 고정 → 기간별 자동 롤업 (utils/timeSeries)
  //   노쇼 현황과 동일한 문제였다: 3개월이면 점 90개, 전체면 200개 이상이 357px에 몰려
  //   곡선이 뭉개지고, 365일을 넘기면 빈 배열이 되어 그래프가 사라졌다.
  //   ※ 곡선(Catmull-Rom Area) 형식은 그대로 유지한다 — 이 카드는 '추세'를 보는 지표라
  //     막대보다 곡선이 읽기 좋고, 막대는 개수가 늘면 더 빨리 뭉개진다.
  const { bucket, points: dayStats } = useMemo(() => {
    const byDate = new Map<string, number>()
    bookings.forEach(b => {
      const d = tsDate(b.start_at)
      byDate.set(d, (byDate.get(d) ?? 0) + 1)
    })
    const r = buildSeries(dateFrom, dateTo, dates =>
      dates.reduce((sum, d) => sum + (byDate.get(d) ?? 0), 0)
    )
    return {
      bucket: r.bucket,
      points: r.points.map(p => ({ date: p.key, label: p.label, count: p.value })),
    }
  }, [bookings, dateFrom, dateTo])

  const rawMax = useMemo(
    () => dayStats.reduce((m, d) => Math.max(m, d.count), 0),
    [dayStats]
  )
  // ← [2026-07-23] Y축 눈금용 "보기 좋은 최대값".
  //   실측 최대값(예: 23)을 그대로 축 상한으로 쓰면 눈금이 23·11.5·0 처럼 나와 읽기 어렵다.
  //   1·2·5 배수로 올림해 25·12.5·0 형태로 만든다. 0건일 때는 축이 무너지지 않게 1로 둔다.
  const maxCount = useMemo(() => {
    if (rawMax <= 0) return 1
    const mag  = Math.pow(10, Math.floor(Math.log10(rawMax)))
    const norm = rawMax / mag
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
    return step * mag
  }, [rawMax])
  // Y축 눈금 3개 (0 / 중간 / 최대)
  const yTicks = useMemo(() => [maxCount, maxCount / 2, 0], [maxCount])

  // ── 4. 인터랙티브 hover/click state ──────────────────────────────────
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const activeIdx = useMemo(
    () => activeDate ? dayStats.findIndex(d => d.date === activeDate) : -1,
    [activeDate, dayStats]
  )
  const activeStats = activeIdx >= 0 ? dayStats[activeIdx] : null

  // ── Active label "5월 20일  20건" (Figma 1:1: 공백 2개) ──
  const activeLabel = useMemo(() => {
    if (!activeStats) return null
    // ← [2026-07-23] 버킷 라벨 사용 (일별 "7/23" / 주별 "7/20~" / 월별 "7월")
    return `${activeStats.label}  ${activeStats.count}건`
  }, [activeStats])

  // ── X축 footer 양 끝 라벨 (Figma 570:7467: 양 끝만 표시) ──────────────
  // ← [2026-07-23] 양 끝 2개 → 양 끝 + 중간 3개.
  //   기간이 길어지면 양 끝만으로는 중간 지점이 언제인지 가늠할 수 없다.
  //   버킷 라벨을 그대로 쓰므로 집계 단위와 항상 일치한다.
  const xAxisLabels = useMemo(() => {
    if (dayStats.length === 0) return []
    if (dayStats.length === 1) return [dayStats[0].label]
    const mid = Math.floor((dayStats.length - 1) / 2)
    return dayStats.length < 3
      ? [dayStats[0].label, dayStats[dayStats.length - 1].label]
      : [dayStats[0].label, dayStats[mid].label, dayStats[dayStats.length - 1].label]
  }, [dayStats])

  // ── 5. SVG 좌표 계산 ──────────────────────────────────────────────────
  const points = useMemo(() => {
    if (dayStats.length === 0) return []
    const drawableH = TREND_VIEWBOX_H - TREND_PADDING_TOP
    return dayStats.map((d, i) => {
      const x = dayStats.length === 1
        ? TREND_VIEWBOX_W / 2
        : (i / (dayStats.length - 1)) * TREND_VIEWBOX_W
      const yRatio = maxCount > 0 ? d.count / maxCount : 0
      const y = TREND_VIEWBOX_H - drawableH * yRatio
      return { x, y, date: d.date, count: d.count }
    })
  }, [dayStats, maxCount])

  const linePath = useMemo(() => catmullRomPath(points), [points])
  const areaPath = useMemo(() => {
    if (points.length === 0) return ''
    return linePath +
      ` L ${TREND_VIEWBOX_W.toFixed(2)},${TREND_VIEWBOX_H.toFixed(2)}` +
      ` L 0,${TREND_VIEWBOX_H.toFixed(2)} Z`
  }, [linePath, points])

  const activePoint = activeIdx >= 0 ? points[activeIdx] : null

  // ── 6. Label clamp (좌/우 가장자리 잘림 방지) ────────────────────────
  const labelPosition = useMemo(() => {
    if (!activePoint) return null
    const leftPct = (activePoint.x / TREND_VIEWBOX_W) * 100
    let leftStr:    string
    let translateX: string
    if (leftPct < 12) {
      leftStr    = '0'
      translateX = '0'
    } else if (leftPct > 88) {
      leftStr    = '100%'
      translateX = '-100%'
    } else {
      leftStr    = `${leftPct}%`
      translateX = '-50%'
    }
    return { leftStr, translateX }
  }, [activePoint])

  return (
    <div style={{
      // ── v6: Figma 1:1 정확 반영 ──────────────────────────────────
      //   · padding pt12 px16 pb16 (Figma 565:21848)
      //   · flex-col items-start justify-between
      //   · v5 (padding 0) 폐기 → Figma 1:1로 복귀
      //   · 단, absolute layout 유지 (작동 보장)
      position:      'relative',
      background:    '#fff',
      borderRadius:  24,
      height:        400,                         // ← [2026-07-23 Phase 1] Figma Row2 389.33×400 (기존 542×504)
      width:         '100%',
      overflow:      'hidden',
    }}>
      {/* ── 헤더 (absolute top 12 left 16 right 16) ─────────────── */}
      <div style={{
        position:      'absolute',
        top:           12,                                 // ← Figma pt12
        left:          16,                                 // ← Figma px16
        right:         16,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'flex-start',
        gap:           2,                                  // ← Figma gap-[2px]
        zIndex:        2,
      }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500,                                  // ← Pretendard:Medium
          fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>예약 추이</p>{/* ← [2026-07-23] Figma 문구: '일일' 제거 */}
        {/* ← [2026-07-23 Phase 1] SmallDateTrigger×2 인라인 조립 → DashboardRangeRow 공통 행 (프리셋 pill 한 달/3개월/전체 포함) */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 차트 영역 (absolute, X축 footer 위까지) ──────────────────
            · top 70 = 헤더 끝 (12 + 22 title + 2 gap + 18 date = 54) + 16 gap
            · bottom 40 = X축 footer (24 = 수평선 1 + gap 4 + text 15 + 4 안전) + pb16 = 40
            · left/right 16 = Figma px16 padding */}
      {/* ── Y축 (Figma에 없던 요소 — 고지 지시 2026-07-23로 신설) ────────
            · 눈금 3개(최대/중간/0) + 각 눈금의 가로 그리드선
            · 축 폭 28px를 확보하고 차트를 그만큼 오른쪽으로 민다 */}
      <div style={{
        position:'absolute', top:70, left:16, bottom:56, width:TREND_Y_AXIS_W,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        pointerEvents:'none', zIndex:1,
      }}>
        {yTicks.map((t, ti) => (
          <span key={ti} style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif", fontWeight:500, fontSize:10, lineHeight:1,
            letterSpacing:'0.1px', color:'#DDE1E6',
            transform: ti === 0 ? 'translateY(0)' : ti === yTicks.length - 1 ? 'translateY(-50%)' : 'translateY(-50%)',
          }}>{Number.isInteger(t) ? t : t.toFixed(1)}</span>
        ))}
      </div>
      {/* 가로 그리드선 — 눈금과 같은 높이 */}
      <div style={{
        position:'absolute', top:70, left:16 + TREND_Y_AXIS_W, right:16, bottom:56,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        pointerEvents:'none',
      }}>
        {yTicks.map((_, ti) => (
          <div key={ti} style={{ borderTop:'0.5px dashed #F1F3F5', width:'100%' }} />
        ))}
      </div>

      <div style={{
        position: 'absolute',
        top:      70,
        left:     16 + TREND_Y_AXIS_W,   // ← [2026-07-23] Y축 폭만큼 우측 이동
        right:    16,
        bottom:   56,   // ← [2026-07-23] X축 라벨 2줄(값+단위)로 늘어나 여백 확대
      }}>
        {dayStats.length === 0 ? (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '데이터 없음'}
          </div>
        ) : (
          <>
            {/* ── SVG: fill area + outline + active marker (line + circle) ── */}
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${TREND_VIEWBOX_W} ${TREND_VIEWBOX_H}`}
              preserveAspectRatio="none"                   // ← 가로 stretch
              style={{ position:'absolute', inset:0, display:'block' }}
            >
              <defs>
                {/* ── Figma 그라데이션 fill: 위 진함 → 아래 흰색 fade-out ── */}
                <linearGradient id="trend-area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#5C5C5C" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* ── Fill area (그라데이션, 외곽선 없이 자연스러운 형태) ── */}
              {areaPath && (
                <path d={areaPath} fill="url(#trend-area-fill)" />
              )}
              {/* ── 외곽선 삭제됨 (사용자 정정 2026-05-12) ──
                    이전: <path d={linePath} fill="none" stroke="#888" ... />
                    fade-out gradient만으로 자연스러운 mountain 효과 */}
              {/* ── Active 수직 연결선 (Figma 570:7429: h-[40px], 0.5px) ── */}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  y1={activePoint.y - TREND_MARKER_LINE_H - 4}    // ← label 아래 끝
                  x2={activePoint.x}
                  y2={activePoint.y - 4}                            // ← circle 위 끝
                  stroke="#000"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* ── Active 데이터 포인트 (Figma 565:21972: size-[8px] = r=4) ── */}
              {activePoint && (
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                  fill="#FFFFFF"
                  stroke="#000000"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* ── Column별 hit area (위젯 ⑥ 패턴, hover detection) ── */}
            <div
              onMouseLeave={() => setActiveDate(null)}
              style={{
                position: 'absolute',
                inset:    0,
                display:  'flex',
                cursor:   'pointer',
              }}>
              {dayStats.map(d => (
                <div
                  key={d.date}
                  // ← [2026-05-26 Dashboard 카드 클릭 활성화] e.stopPropagation
                  onMouseEnter={() => setActiveDate(d.date)}
                  onClick={(e) => { e.stopPropagation(); setActiveDate(prev => prev === d.date ? null : d.date) }}
                  style={{
                    flex:     1,
                    height:   '100%',
                    minWidth: 0,
                  }}
                />
              ))}
            </div>

            {/* ── Active label (StatusBadge-XS, line 위쪽) ──
                  · Figma 565:21967: bg rgba(255,255,255,0.9), border 1px black, rounded-24
                  · Figma 565:21968: Pretendard Medium 10 #1E1E1E tracking 0.1
                  · 위치: line 위쪽 (top = (activePoint.y - MARKER_LINE_H - 4) %, translateY -100% - 2px) */}
            {activePoint && activeLabel && labelPosition && (
              <div style={{
                position:    'absolute',
                left:        labelPosition.leftStr,
                top:         `${((activePoint.y - TREND_MARKER_LINE_H - 4) / TREND_VIEWBOX_H) * 100}%`,
                transform:   `translate(${labelPosition.translateX}, calc(-100% - 2px))`,
                background:  'rgba(255,255,255,0.9)',
                border:      '1px solid #000',
                borderRadius:24,
                padding:     '2px 8px',
                display:     'flex',
                alignItems:  'center',
                justifyContent:'center',
                fontFamily:  "'Pretendard', -apple-system, sans-serif",
                fontWeight:  500,                              // ← Figma: Pretendard Medium
                fontSize:    10,
                lineHeight:  1.5,
                letterSpacing:'0.1px',
                color:       '#1E1E1E',
                whiteSpace:  'nowrap',
                maxWidth:    'calc(100% - 8px)',
                overflow:    'hidden',
                textOverflow:'ellipsis',
                pointerEvents:'none',
                zIndex:      10,
              }}>
                {activeLabel}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── X축 footer (Figma 570:7433 수평선 + 570:7467 양 끝 라벨) ──── */}
      <div style={{
        position:      'absolute',
        bottom:        16,                                  // ← Figma pb16
        left:          16,
        right:         16,
        display:       'flex',
        flexDirection: 'column',
        gap:           4,
      }}>
        {/* 수평선 (Figma 570:7433: 0.5px) */}
        <div style={{
          borderTop: '0.5px solid #DDE1E6',
          width:     '100%',
        }} />
        {/* 양 끝 날짜 라벨 (Figma 570:7467: justify-between, Medium 10 #DDE1E6) */}
        <div style={{
          display:        'flex',
          justifyContent: 'space-between',
          fontFamily:     "'Pretendard', -apple-system, sans-serif",
          fontWeight:     500,                              // ← Figma: Pretendard Medium
          fontSize:       10,
          lineHeight:     1.5,
          letterSpacing:  '0.1px',
          color:          '#DDE1E6',                         // ← Figma: #DDE1E6 (날짜 picker #AEB5C4와 다름)
          whiteSpace:     'nowrap',
        }}>
          {/* ← [2026-07-23] 양 끝 2개 → 3개(시작/중간/끝) */}
          {xAxisLabels.map((l, li) => <span key={li}>{l}</span>)}
        </div>
        {/* ← [2026-07-23] 축 단위 명시. 막대/점 하나가 뜻하는 단위가 기간에 따라 바뀌므로
              적지 않으면 "7월"이 하루인지 한 달인지 알 수 없다. */}
        <div style={{
          display:'flex', justifyContent:'space-between',
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:400, fontSize:10, lineHeight:1.5, color:'#CBD5E1',
        }}>
          <span>x · {BUCKET_LABEL[bucket]}</span>
          <span>y · 예약 건수</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑦ 부서별 예약 현황 (Figma node 565:13085) ─────────────────────────
//   사용처: Row 3 Col 2 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + b.dept group by
//   동작: 상단 부서 list (Top 5, count 0 placeholder) + 하단 가로 비율 bar
//   ※ Figma 1:1: padding p16 균등 + flex-col gap 24 (위젯 ②④⑤⑥과 다름)
//   ※ hover/click 시 그 column #343333 진해짐 + label (위젯 ②⑤⑥ 패턴 일관)

// ─── [2026-07-23 Phase 2-B] DEPT_RANK_COLORS / DEPT_RANK_ACTIVE_COLOR 삭제 ──
//   두 상수 모두 '부서 예약 순위' 하단의 가로 비율 bar 차트 전용이었다.
//   Figma 551:3652에 bar 차트가 없어 차트를 제거했으므로 참조처가 0이 되어 함께 삭제.
//   (dead code를 남기면 다음 작업자가 '색상 규칙이 있다'고 오인한다)


function DepartmentBookingsCard({ onRangeChange }: CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑥와 dedupe) ──────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 부서별 카운트 (Q1: 모든 booking, Q6: b.dept group by) ─────────
  //   · b.dept null/empty 안전 제외
  //   · 그 기간 예약 있는 부서만 표시 (Q6 A)
  const deptStats = useMemo(() => {
    const map = new Map<string, number>()
    bookings.forEach(b => {
      const dept = b.dept?.trim()
      if (!dept) return                                 // ← 안전: dept 없는 booking 제외
      map.set(dept, (map.get(dept) ?? 0) + 1)
    })
    return Array.from(map.entries())
      .map(([dept, count]) => ({ dept, count }))
      .sort((a, b) => b.count - a.count)                // Q6: count desc
  }, [bookings])

  // ── 4. Top 8 부서 ───────────────────────────────────────────────────
  //   ← [2026-07-23 Phase 2-B] Figma 551:3659 = 8행 × h34 = 272 (기존 Top 7 + 가로 bar 구성)
  const top8 = useMemo(() => deptStats.slice(0, 8), [deptStats])

  // ← [2026-07-23 Phase 2-B] totalCount / activeDept / activeStats / activeLabel 제거
  //   전부 하단 '가로 비율 bar 차트' 전용 상태였고, Figma 551:3652에는 bar 차트가 없다.
  //   (헤더 45 + gap 51 + 8행 리스트 272 = 400 으로 카드가 정확히 채워짐)

  return (
    <div style={{
      // ── Figma outer 1:1 (다른 위젯과 다른 padding/gap 패턴) ──
      background:    '#fff',
      borderRadius:  24,
      padding:       16,                                // ← Figma: p16 균등 (위젯 ②④⑤⑥의 pt12 px16 pb16과 다름)
      display:       'flex',
      flexDirection: 'column',
      justifyContent:'space-between',                   // ← [2026-07-23 Phase 2-B] gap 24 → space-between
                                                        //   Figma: 헤더 y16~61 / 리스트 y112~384 → 간격 51px이 자동 산출됨
      height:        400,                         // ← [2026-07-23 Phase 1] Figma Row2 389.33×400 (기존 542×504)
      width:         '100%',
      overflow:      'hidden',                          // ← Figma: overflow-clip
    }}>
      {/* ── 헤더 (gap 2, 위젯 ②④⑤⑥과 동일) ─────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>부서 예약 순위</p>{/* ← [2026-07-23 Phase 1] Figma 문구: 부서별 예약 현황 → 부서 예약 순위 */}
        {/* ── 날짜 범위 picker (위젯 ②④⑤⑥와 동일) ── */}
        {/* ← [2026-07-23 Phase 1] SmallDateTrigger×2 인라인 조립 → DashboardRangeRow 공통 행 (프리셋 pill 한 달/3개월/전체 포함) */}
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 부서 리스트 (Figma 551:3659 — 8행, 랭크 서클 + 부서명 + 건수) ──
            ← [2026-07-23 Phase 2-B] dot(12px 색상) → RankListRow(16px 랭크 서클 숫자)
              Figma에 순위 숫자가 명시되어 있고, '회의실 노쇼 현황' Top5와 동일 컴포넌트다 */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {top8.map((d, i) => (
          <RankListRow
            key={d.dept}
            rank={i + 1}
            label={d.dept}
            count={d.count}
            first={i === 0}
          />
        ))}
        {/* ── deptStats.length < 8인 경우 placeholder row로 8개 채움 ── */}
        {Array.from({ length: Math.max(0, 8 - top8.length) }).map((_, i) => (
          <RankListRow
            key={`empty-${i}`}
            rank={top8.length + i + 1}
            label={loading ? '로딩 중…' : '—'}
            count={0}
            first={false}
            empty
          />
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑧ 시간대별 예약 분포 (Figma node 565:21770) ─────────────────────
//   사용처: Row 4 (좌측만, 우측 빈 칸 — Figma 1:1)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange
//   동작: 13 columns (7시~19시 운영시간) 이중 봉 차트, 위젯 ⑥ 그래프 형식
//   ※ Figma 1:1: 외곽 봉 bg #F6F7FA + 내부 봉 #DDDEDF→#EFF0F1 (활성 시 #000→#7E7F80)
//   ※ 헤더 두 번째 줄 justify-between: 좌(picker) / 우(subtitle) — 위젯 ⑥⑦과 다름
//   ※ Q5: timezone 안전 — b.start_at.substring(11, 13)로 KST hour 추출

// ─── HOURLY — Figma 1:1 차트 사양 상수 ────────────────────────────────────
const OPERATING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]   // ← Q3: 7~19시 13 columns
const HOURLY_OUTER_H  = 93                                                    // ← Figma: 외곽 봉 height

function HourlyDistributionCard({ onRangeChange }: CardRangeReporter) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑥⑦와 dedupe) ────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 시간대별 count (Q1: 모든 booking, Q2: start_at hour, Q5: substring 안전) ─
  //   · Q5: b.start_at.substring(11, 13) → "08" → 8 (KST hour, timezone 무관)
  //   · Q3: 7~19시만 카운트 (운영 외 시간 표시 안 함)
  const hourStats = useMemo(() => {
    return OPERATING_HOURS.map(h => {
      const count = bookings.filter(b => {
        if (!b.start_at) return false                  // ← 안전: start_at 없는 booking 제외
        const hourStr = b.start_at.substring(11, 13)   // Q5: ISO 8601 "T08:30..." → "08"
        return parseInt(hourStr, 10) === h
      }).length
      return { hour: h, count }
    })
  }, [bookings])

  // ── 4. maxCount (내부 봉 비례 계산 기준) ──────────────────────────────
  const maxCount = useMemo(
    () => hourStats.reduce((m, d) => Math.max(m, d.count), 0),
    [hourStats]
  )

  // ── 5. 인터랙티브 hover/click state (Q4: 위젯 ②⑤⑥⑦ v3 패턴 일관) ───
  const [activeHour, setActiveHour] = useState<number | null>(null)
  const activeStats  = useMemo(
    () => hourStats.find(d => d.hour === activeHour) ?? null,
    [activeHour, hourStats]
  )

  // ── 활성 column label 내용 ("{N}시 {N}건") ───────────────────────────
  const activeLabel = useMemo(() => {
    if (!activeStats) return null
    return `${activeStats.hour}시 ${activeStats.count}건`
  }, [activeStats])

  return (
    <div style={{
      // ── Figma outer 1:1 (Row 4 단독, 좌측만) ──
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',           // ← Figma: pt12 px16 pb16
      display:       'flex',
      flexDirection: 'column',
      gap:           24,                                // ← Figma: flex-col gap 24
      width:         '100%',
      overflow:      'hidden',                          // ← Figma: overflow-clip
    }}>
      {/* ── 헤더 (위젯 ⑥⑦과 다른 구조 - 두 번째 줄 justify-between) ──── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>시간대별 예약 분포</p>
        {/* ── 두 번째 줄: 좌(picker) ↔ 우(subtitle) justify-between ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',              // ← Figma: 헤더 두 번째 줄 좌/우 분리
          width:          '100%',
        }}>
          {/* 좌: 날짜 범위 picker (위젯 ②④⑤⑥⑦와 동일) */}
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
            <span style={{
              fontFamily:"'Pretendard', -apple-system, sans-serif",
              fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
            }}>⎯</span>
            <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
          </div>
          {/* 우: subtitle "운영시간 오전 7시 부터 오후 7시" — Figma 1:1 */}
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
            whiteSpace:'nowrap',
          }}>운영시간 오전 7시 부터 오후 7시</p>
        </div>
      </div>

      {/* ── 차트 (h 111, gap 4, items-end, 13 columns) ──────────────── */}
      <div
        onMouseLeave={() => setActiveHour(null)}
        style={{
          display:    'flex',
          alignItems: 'flex-end',                       // ← Figma: items-end
          gap:        4,                                 // ← Figma: gap 4
          height:     111,                               // ← Figma: chart 컨테이너 h 111 (graph 93 + gap 4 + label 14)
          width:      '100%',
          position:   'relative',
        }}>
        {hourStats.map(d => {
          const isActive = d.hour === activeHour
          // ── 내부 봉 height: count/maxCount × 93 (외곽 height) ──
          //   · maxCount=0 (전체 0) → 내부 미표시 (외곽만)
          //   · Math.max(2,...): count > 0이면 최소 2px 표시 (시각적 존재감)
          const innerH = maxCount > 0 && d.count > 0
            ? Math.max(2, (d.count / maxCount) * HOURLY_OUTER_H)
            : 0
          return (
            <div
              key={d.hour}
              // ← [2026-05-26 Dashboard 카드 클릭 활성화] e.stopPropagation
              onMouseEnter={() => setActiveHour(d.hour)}
              onClick={(e) => { e.stopPropagation(); setActiveHour(prev => prev === d.hour ? null : d.hour) }}
              style={{
                flex:          1,
                height:        '100%',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'stretch',
                justifyContent:'flex-end',                // ← Figma: column items-start justify-end
                gap:           4,                          // ← Figma: column 내부 gap 4
                minWidth:      0,
                cursor:        'pointer',
              }}>
              {/* ── Graph 영역 (외곽 봉 + 내부 봉) ── */}
              <div style={{
                position:    'relative',
                height:      HOURLY_OUTER_H,             // ← Figma: 외곽 h 93
                width:       '100%',
                background:  '#F6F7FA',                   // ← Figma: 외곽 bg #F6F7FA (위젯 ⑥의 #FCFCFC와 다름)
              }}>
                {/* ── 내부 봉 (bottom 정렬, 비례 height, 활성 시 검정 그라데이션) ── */}
                {innerH > 0 && (
                  <div style={{
                    position:   'absolute',
                    bottom:     0,
                    left:       0,
                    right:      0,
                    height:     innerH,
                    // ── Figma 1:1 ──
                    //   평소: linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)
                    //   활성: linear-gradient(to bottom, #000 48.954%, #7E7F80 100%)
                    background: isActive
                      ? 'linear-gradient(to bottom, #000 48.954%, #7E7F80 100%)'
                      : 'linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)',
                    transition: 'height 0.4s ease, background 0.15s ease',
                  }}/>
                )}
                {/* ── 활성 column label (내부 봉 위쪽 6px - 위젯 ⑥ 패턴) ── */}
                {isActive && activeLabel && (
                  <div style={{
                    position:    'absolute',
                    bottom:      innerH + 6,
                    left:        '50%',
                    transform:   'translateX(-50%)',
                    // ── Figma StatusBadge-XS (위젯 ②⑤⑥⑦와 동일) ──
                    background:  'rgba(255,255,255,0.9)',
                    border:      '1px solid #000',
                    borderRadius:24,
                    padding:     '2px 8px',
                    display:     'flex',
                    gap:         10,
                    alignItems:  'center',
                    justifyContent:'center',
                    fontFamily:  "'Pretendard', -apple-system, sans-serif",
                    fontWeight:  400,
                    fontSize:    10,
                    lineHeight:  1.5,
                    letterSpacing:'0.1px',
                    color:       '#1E1E1E',
                    whiteSpace:  'nowrap',
                    pointerEvents:'none',
                    zIndex:      10,
                  }}>
                    {activeLabel}
                  </div>
                )}
              </div>
              {/* ── 시간 라벨 (X축, "7시" ~ "19시") ── */}
              <span style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif",
                fontWeight:400, fontSize:9, lineHeight:1.5, color:'#AEB5C4',
                textAlign:'center',
                whiteSpace:'nowrap',
              }}>{d.hour}시</span>
            </div>
          )
        })}
        {/* ── 빈 데이터 case (전체 0건) - 차트 자체는 모두 외곽만 표시 ── */}
        {!loading && maxCount === 0 && bookings.length === 0 && (
          <div style={{
            position:'absolute',
            top:0, left:0, right:0, bottom:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            pointerEvents:'none',
            fontSize:11, color:'#CBD5E1',
          }}>
            예약 데이터 없음
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── DashboardPlaceholderCard ───────────────────────────────────────────────
//   목적: Phase 4~10 위젯 구현 전까지 외곽 레이아웃 유지 + 진척 표시
//   교체 방식: 각 Phase에서 해당 카드만 진짜 위젯으로 교체
//   ※ 시각: 동일한 outer 스타일 (bg #fff / radius 24 / pt12 px16 pb16) 유지
//
//   ← [2026-05-11 Phase 3.5] dateRange prop optional + default 자동 생성
//      · 사유: Q1 결정 — 각 위젯이 자체 날짜 필터(DateDisplay × 2 picker) 보유
//      · placeholder 시점에는 default 30일 텍스트만 표시 (인터랙션 없음)
//      · 각 위젯이 Phase 4-10에서 구현되면 picker로 교체
interface PlaceholderProps {
  height:    number       // ← Figma 카드 높이 (Row 1: 268 / Row 2-3: 504 / Row 4: 205)
  title:     string       // ← Figma 카드 타이틀
  subtitle?: string       // ← Figma 카드 서브타이틀 (시간대별 예약 분포만 사용)
  /** 날짜 범위 표시 (3-state):
   *  · undefined → default 30일 자동 표시 (지난 30일 ⎯ 오늘)
   *  · null      → 표시 안 함 (위젯 ③ 최근 생성된 예약, ⑧ 시간대별 예약 분포)
   *  · string    → 명시한 텍스트 표시 */
  dateRange?: string | null
  phaseNote: string       // ← "Phase N에서 구현 예정" 안내
}
function DashboardPlaceholderCard({ height, title, subtitle, dateRange, phaseNote }: PlaceholderProps) {
  // ← [2026-05-11 Phase 3.5] dateRange 미지정 시 default 30일 자동 표시
  //   default 산출: 각 위젯이 own state로 초기화할 때 동일한 값 사용 예정 (UX 연속성)
  const effectiveDateRange = dateRange ?? `${addDaysStr(todayStr(), -29)} ⎯ ${todayStr()}`
  return (
    <div style={{
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          4,
      height,
      width:        '100%',
    }}>
      {/* 타이틀 블록 — Figma 동일 스펙 */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{title}</p>
        {subtitle && (
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
          }}>{subtitle}</p>
        )}
        {dateRange !== null && (
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
          }}>{effectiveDateRange}</p>
        )}
      </div>

      {/* Phase 진행 안내 — 카드 중앙 */}
      <div style={{
        flex:1, width:'100%',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <span style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontSize: 12, color:'#CBD5E1', fontWeight:400,
        }}>🚧 {phaseNote}</span>
      </div>
    </div>
  )
}

// ─── AdminDashboard ────────────────────────────────────────────────────────────
// ← [2026-05-28] currentUserId/currentUserEmail prop 추가 — DetailDrawer 내부 BookingStatusBadge 'mine' 칩 판정용 (P4-B 패턴)
export function AdminDashboard({ bookings, rooms, users, isMobile, onDetail, onGoApprovals = () => {}, currentUserId = '', currentUserEmail = '' }) {  // ← [2026-06-10] onGoApprovals 추가 — 승인 대기 카드 → '승인 관리' 탭 이동용
  // ── [2026-05-11 Phase 3.5] 외곽 정비 — 카드별 독립 날짜 필터로 전환 ──────
  //   · 사유: Q1 결정 — 위젯 ②~⑧이 각자 dateFrom/dateTo state + own
  //            loadBookingsByRange fetch + DateDisplay picker 보유
  //   · 제거된 state: dateFrom/setDateFrom, dateTo/setDateTo, rangeData/setRangeData,
  //                   loadingChart/setLoadingChart
  //   · 제거된 effect: fetchRange useCallback + useEffect (각 위젯 own fetch)
  //   · 제거된 useMemo: filtered / past / confirmed / dayRange / roomStats / deptStats /
  //                    noshowRank / hourDist / roomChartData / deptChartData
  //                    (각 위젯 구현 시 자체 state + 계산)
  //   · 제거된 변수: noshowRate, noswColor (위젯별 own 정의로 이전)
  //   · 제거된 helper: inputStyle / btnStyle (공통 날짜 필터 UI 전용)
  //   · 유지: pendingCount — bookings prop에서 직접 (실시간 pending count, 위젯 ①)
  //   · rooms / users / onDetail props: Phase 4-10 위젯 구현 시 사용 예정 → 시그니처 보존

  // ── 반응형 컬럼 수 (← [2026-07-24 #4] iPad 대응) ────────────────────────
  //
  //   기존은 isMobile(768 미만) 하나로만 갈라 3열/1열이었다. 그 사이 구간 —
  //   iPad 세로 820, iPad 가로 1180~1194, 10.2" 가로 1024 — 이 전부 3열로 떨어져
  //   카드 한 장이 200~300px 로 찌그러졌다. 9행 표와 히트맵이 들어가는 카드라
  //   그 폭에서는 라벨이 전부 잘린다.
  //
  //   Figma 카드 실폭 389.33 을 기준으로, 카드가 그 폭 근처를 유지하도록
  //   가용 폭에서 열 수를 역산한다. 임의의 브레이크포인트가 아니라
  //   "카드가 읽히는 최소 폭"이 기준이다.
  const { width: vw } = useBreakpoint()

  //   ← [2026-07-24] 판정 기준을 뷰포트 폭 → **카드 실폭**으로 교체.
  //
  //   기존은 vw<1280 이면 2열, 아니면 3열이었다. 그런데 어드민은 사이드 네비가
  //   244px 를 먼저 떼가므로 같은 vw 라도 카드에 남는 폭이 크게 다르다.
  //   1512 노트북에서 3열이면 카드가 404px — 9행 표·히트맵·10분류 스택바가 들어가는
  //   카드로는 답답하다는 지적(고지)이 정확했다.
  //
  //   그래서 "카드가 몇 px 남는가" 로 판정한다. 임계값은 임의값이 아니라
  //   Figma 카드 실폭(389.33)에 여유를 준 값 — 3열은 카드가 480px 이상 나올 때만 허용.
  const navInlineDash = vw < 1024
  const contentW = Math.min(vw, 1920) - (vw < 768 ? 36 : navInlineDash ? 40 : 268)
  const cols3 = contentW >= 1450 ? 3 : contentW >= 740 ? 2 : 1
  const cols2 = contentW >= 740 ? 2 : 1
  const gridCls = (n: number) => `grid gap-4 ${n === 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-2' : 'grid-cols-3'}`

  // 위젯 ① 승인 대기용 — bookings prop에서 직접 계산 (날짜 필터 없음)
  // ← [2026-07-23 버그수정] 기한 초과 pending 제외 (utils/pendingStatus SSOT)
  const pendingCount = countAwaitingApproval(bookings)

  // ═══════════════════════════════════════════════════════════════════════════
  // ← [2026-05-26 신규] 카드 클릭 → DetailDrawer 활성화 (사용자 결정 2026-05-26)
  //   · 8개 카드 모두 클릭 가능 (정렬 옵션은 카드별 분기)
  //   · ③ RecentBookingsCard는 행 클릭은 onDetail(개별 예약), 카드 wrapper 클릭은 bookings drawer (행 onClick에 stopPropagation)
  //   · SmallDateTrigger / 차트 봉 클릭 등 inner 인터랙티브 요소는 stopPropagation으로 충돌 차단 완료
  //
  // 진입 기간: 카드 클릭 시 기본 30일 (DetailDrawer가 자체 DateRangePicker로 재변경 가능)
  // ═══════════════════════════════════════════════════════════════════════════
  // ← [2026-05-28] initialDateMode 추가 — '최근 생성된 예약' 카드 진입 시 'createdAt' 모드로 시작
  // ← [2026-07-23] initialPurpose 추가 — 목적 카드에서 분류를 직접 골라 들어오면
  //   드로어가 그 분류의 개별 예약 목록(드릴다운)부터 보여준다.
  // ← [2026-07-24] from/to 추가 — 클릭한 카드의 조회 기간을 드로어가 그대로 이어받는다
  type CardDrawer = { type: DetailType; sortKey?: string; sortAsc?: boolean; initialDateMode?: 'createdAt' | 'startAt'; initialPurpose?: PurposeCode; from?: string; to?: string }
  const [cardDrawer, setCardDrawer] = useState<CardDrawer | null>(null)
  const drawerInitFrom = addDaysStr(todayStr(), -29)
  const drawerInitTo   = todayStr()

  // ── 카드별 조회 기간 보관소 (← [2026-07-24]) ─────────────────────────────
  //
  //   각 카드가 useReportRange 로 자기 기간을 보고하면 여기에 쌓아두고,
  //   래퍼를 클릭할 때 그 값을 드로어 초기 기간으로 넘긴다.
  //
  //   ★ useState 가 아니라 useRef 인 이유
  //     보고는 카드 12개가 마운트·기간변경 때마다 발생한다. state 로 받으면
  //     그때마다 AdminDashboard 전체가 리렌더되고, 리렌더가 카드의 fetch effect 를
  //     다시 건드릴 여지가 생긴다. 이 값은 '클릭 순간'에만 읽히므로 렌더와 무관하다.
  const cardRangeRef = useRef<Record<string, CardRange>>({})
  const reportRange  = (key: string) => (r: CardRange) => { cardRangeRef.current[key] = r }
  /** 카드가 아직 보고 전이면(이론상 없음) 기존 기본값으로 안전하게 폴백 */
  const rangeOf = (key: string): { from: string; to: string } =>
    cardRangeRef.current[key] ?? { from: drawerInitFrom, to: drawerInitTo }

  // 카드 wrapper 공통 스타일 — hover 시 살짝 그림자 (cursor pointer)
  const cardWrapStyle: React.CSSProperties = {
    cursor: 'pointer',
    borderRadius: 24,
    transition: 'box-shadow 0.15s',
  }
  // ← [2026-07-24] Row5 전용 — 카드를 그리드 셀 높이에 맞춰 늘린다.
  //   그리드는 이미 align-items:stretch 라 '셀'은 늘어나 있었는데, 카드가 그 안에서
  //   고정 높이로 버티고 있어 효과가 없었다. 셀을 flex 로 만들면 자식(카드)이
  //   교차축으로 stretch 되어 행에서 가장 긴 카드 높이에 자동으로 맞는다.
  //   ※ cardWrapStyle 자체를 고치지 않는 이유: 다른 행은 이미 카드 높이가 서로 같아
  //     변경 이유가 없고, 공통 스타일을 건드리면 6개 행 전부가 영향권에 들어온다.
  const cardWrapStretch: React.CSSProperties = { ...cardWrapStyle, display: 'flex' }
  const cardWrapHover = (e: React.MouseEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)'
  }
  const cardWrapLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).style.boxShadow = 'none'
  }

  return (
    <div className="flex flex-col gap-4" style={{ width: '100%' }}>{/* ← [2026-07-24] maxWidth 1200 해제 — 바깥(AdminView 1920)이 상한을 쥔다. 여기서 또 자르면 넓힌 폭이 사라진다 */}

      {/* ══════════════════════════════════════════════════════════════════════
           [2026-07-23 Phase 1] 대시보드 외곽 5-row grid 재구성 (Figma node 551:3316 1:1)

           변경 전(2026-05-11 Phase 3, node 489:393 / maxWidth 1100)
             Row1 3-col 356×268 : ①승인대기 ②노쇼현황 ③최근생성된예약
             Row2 2-col 542×504 : ④예약많은회의실 ⑤회의실노쇼현황
             Row3 2-col 542×504 : ⑥예약추이 ⑦부서별예약현황
             Row4 2-col         : ⑧시간대별예약분포 + 빈칸

           변경 후(Figma 551:3316 / maxWidth 1200, gap 16)
             Row1 2-col 592×367 : ①승인대기 ②최근생성된예약   ← [2026-07-23] 342→367
             Row2 3-col 389×400 : ③사용자예약순위 ④일일예약추이 ⑤부서예약순위   ← [2026-07-23] ④⑤ 교환
             Row3 3-col 389×400 : ⑥사용자누적노쇼 ⑦일일노쇼현황 ⑧회의실노쇼현황  ← [2026-07-23] ⑥⑦ 교환
             Row4 3-col 389×364 : ⑨예약많은회의실 ⑩회의실별가동률 ⑪요일별가동률       ← [2026-07-24] Row5에서 올라옴
             Row5 1-col 1200    : ⑫회의실사용목적AI분석 (풀폭 — 스택바 + 10분류 표)  ← [2026-07-24] Row4에서 내려감
             Row6 1-col 1200    : ⑬시간대별예약분포 (풀폭)                            ← [2026-07-23]

           · 신규 위젯 3종(③⑦⑨)은 Phase 2·3에서 구현 — 현재는 DashboardPlaceholderCard로 자리만 확보.
             자리를 비워두지 않는 이유: 그리드 컬럼 수가 달라지면 나머지 카드 폭이 전부 틀어져
             Phase 2 착수 시 레이아웃을 또 손봐야 하므로, 골격은 이번에 확정한다.
           · 각 위젯의 자체 dateFrom/dateTo state + 독립 fetch 구조(Phase 3.5)는 그대로 유지.
           · 기존 카드의 onClick(DetailDrawer 진입) 동작은 1건도 변경하지 않음.
         ═══════════════════════════════════════════════════════════════════════ */}

      {/* ── Row 1: ① 승인 대기 / ② 최근 생성된 예약 (2-col 592×342) ── */}
      <div className={gridCls(cols2)}>
        {/* ① 승인 대기 → [2026-06-10] 드로어 대신 '승인 관리' 탭으로 즉시 이동 (동작 유지) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => onGoApprovals()}>
          <ApprovalPendingCard count={pendingCount} />
        </div>

        {/* ② 최근 생성된 예약 → 헤더 클릭은 bookings drawer(생성일 최신순), 행 클릭은 onDetail (동작 유지) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'bookings', initialDateMode: 'createdAt', sortKey: 'createdAt', sortAsc: false, ...rangeOf('recent') })}>
          <RecentBookingsCard
            users={users}
            rooms={rooms}
            onDetail={onDetail}
            onRangeChange={reportRange('recent')}
          />
        </div>
      </div>

      {/* ── Row 2: ③ 사용자 예약 순위 / ④ 부서 예약 순위 / ⑤ 일일 예약 추이 (3-col 389×400) ── */}
      <div className={gridCls(cols3)}>
        {/* ③ 사용자 예약 순위 → users 통계 (count desc — 카드 정렬과 동일 진입) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'users', sortKey: 'count', sortAsc: false, ...rangeOf('userRank') })}>
          <UserRankingCard users={users} onRangeChange={reportRange('userRank')} />
        </div>
        {/* ④ 일일 예약 추이 → 전체 예약 목록 (동작 유지)
              ← [2026-07-23] Figma 갱신으로 부서 예약 순위와 위치 교환 (Row2 Col2) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'bookings', ...rangeOf('trend') })}>
          <BookingTrendsAreaCard onRangeChange={reportRange('trend')} />
        </div>
        {/* ⑤ 부서 예약 순위 → dept 통계 (동작 유지) ← [2026-07-23] Row2 Col3으로 이동 */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'dept', ...rangeOf('dept') })}>
          <DepartmentBookingsCard onRangeChange={reportRange('dept')} />
        </div>
      </div>

      {/* ── Row 3: ⑥ 일일 노쇼 현황 / ⑦ 사용자 누적 노쇼 / ⑧ 회의실 노쇼 현황 (3-col 389×400) ── */}
      <div className={gridCls(cols3)}>
        {/* ⑥ 사용자 누적 노쇼 → users 통계 (noshow desc — 카드 정렬과 동일 진입)
              ← [2026-07-23] Figma 갱신으로 일일 노쇼 현황과 위치 교환 (Row3 Col1) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'users', sortKey: 'noshow', sortAsc: false, ...rangeOf('userNoshow') })}>
          <UserNoshowCard users={users} onRangeChange={reportRange('userNoshow')} />
        </div>
        {/* ⑦ 일일 노쇼 현황 → 노쇼 목록 (동작 유지) ← [2026-07-23] Row3 Col2로 이동 */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'noshow', ...rangeOf('noshow') })}>
          <NoshowChartCard onRangeChange={reportRange('noshow')} />
        </div>
        {/* ⑧ 회의실 노쇼 현황 → rooms 통계 (noshow desc 진입 정렬 — 동작 유지) */}
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'rooms', sortKey: 'noshow', sortAsc: false, ...rangeOf('roomNoshow') })}>
          <RoomNoshowCard rooms={rooms} onRangeChange={reportRange('roomNoshow')} />
        </div>
      </div>

      {/* ── Row 4: ⑨ 예약 많은 회의실 / ⑩ 회의실별 가동률 / ⑪ 요일별 가동률 (3-col) ──
            ← [2026-07-24 #2] 고지 지시로 '회의실 사용 목적 AI 분석' 과 위치 교환.
              회의실 3종(건수·가동률)이 같은 대상을 다른 각도로 보는 묶음이라 위로 올리고,
              목적 분석은 성격이 다른 단독 분석이라 아래로 내린다.
            ※ ⑨와 ⑩은 나란히 놓이지만 서로 다른 질문에 답한다 —
              ⑨ '몇 건 잡혔나(건수)' / ⑩ '얼마나 채워졌나(시간 점유율)' */}
      <div className={gridCls(cols3)}>
        {/* ⑨ 예약 많은 회의실 → rooms 통계 · 건수 desc 진입 */}
        <div style={cardWrapStretch} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'rooms', sortKey: 'confirmed', sortAsc: false, ...rangeOf('roomRank') })}>
          <RoomRankingCard rooms={rooms} onRangeChange={reportRange('roomRank')} />
        </div>
        {/* ⑩ 회의실별 가동률 → 같은 표를 열되 ★가동률 desc 로 진입 (← [2026-07-24])
              카드가 답하는 질문이 "얼마나 채워졌나"이므로 드릴다운도 그 순서여야 한다.
              기존엔 세 카드가 모두 건수 desc 로 들어가 "같은 화면"으로 보였다. */}
        <div style={cardWrapStretch} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'rooms', sortKey: 'util', sortAsc: false, ...rangeOf('utilRoom') })}>
          <RoomUtilizationByRoomCard rooms={rooms} onRangeChange={reportRange('utilRoom')} />
        </div>
        {/* ⑪ 요일별 가동률 → 회의실별 가동률과 같은 계산이므로 동일하게 가동률 desc 진입 */}
        <div style={cardWrapStretch} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'rooms', sortKey: 'util', sortAsc: false, ...rangeOf('utilWeekday') })}>
          <RoomUtilizationCard rooms={rooms} onRangeChange={reportRange('utilWeekday')} />
        </div>
      </div>

      {/* ── Row 5: ⑫ 회의실 사용 목적 AI 분석 (1200 풀폭) ──
            ← [2026-07-24 #2] Row4 ↔ Row5 위치 교환 (고지 지시).
            ← [2026-07-23] Figma 갱신: 592 2-col → 풀폭 1행 단독.
              10분류 스택 바 + 10행 표가 592폭에서는 라벨이 전부 잘린다. */}
      <div className="grid gap-4 grid-cols-1">
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'purpose', ...rangeOf('purpose') })}>
          <MeetingPurposeCard
            /* 분류 선택 → 그 분류의 개별 예약 목록으로 바로 진입 (드로어 드릴다운 상태로 오픈) */
            onPickPurpose={(code) => setCardDrawer({ type: 'purpose', initialPurpose: code, ...rangeOf('purpose') })}
            onRangeChange={reportRange('purpose')}
          />
        </div>
      </div>

      {/* ── Row 6: ⑬ 시간대별 예약 분포 (1200 풀폭) ──
            ← [2026-07-23] Figma 갱신으로 Row5 3-col에서 빠져 단독 풀폭으로 이동 */}
      <div className="grid gap-4 grid-cols-1">
        <div style={cardWrapStyle} onMouseEnter={cardWrapHover} onMouseLeave={cardWrapLeave}
          onClick={() => setCardDrawer({ type: 'hours', ...rangeOf('hours') })}>
          <HourlyDistributionCard onRangeChange={reportRange('hours')} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ← [2026-05-26] DetailDrawer 재활성화 (Q5 결정 번복 → 사용자 결정 2026-05-26)
          · 카드 클릭 시 setCardDrawer 호출 → 여기서 렌더링
          · type / sortKey / sortAsc 카드별 분기 (RoomRanking ↔ RoomNoshow 정렬 차별화)
          · 진입 기간: 기본 -30일 ~ 오늘 (DetailDrawer 내부 DateRangePicker로 재변경 가능)
          ═══════════════════════════════════════════════════════════════════════ */}
      {cardDrawer && (
        <DetailDrawer
          type={cardDrawer.type}
          rooms={rooms}
          users={users}
          /* ← [2026-07-24] 카드가 보고한 기간으로 연다. 카드에서 3개월을 보고
                클릭했는데 드로어가 한 달치를 보여주던 불일치를 없앤다. */
          initFrom={cardDrawer.from ?? drawerInitFrom}
          initTo={cardDrawer.to ?? drawerInitTo}
          initialSortKey={cardDrawer.sortKey}
          initialSortAsc={cardDrawer.sortAsc}
          initialDateMode={cardDrawer.initialDateMode}  /* ← [2026-05-28] 카드별 진입 모드 (예: 최근 생성→'createdAt', 예약추이→default 'startAt') */
          initialPurpose={cardDrawer.initialPurpose}    /* ← [2026-07-23] 목적 분류 직접 선택 시 초기 드릴다운 */
          onDetail={onDetail}
          onClose={() => setCardDrawer(null)}
          currentUserId={currentUserId}        /* ← [2026-05-28] BookingStatusBadge 'mine' 칩 판정용 (P4-B) */
          currentUserEmail={currentUserEmail}  /* ← [2026-05-28] BookingStatusBadge 'mine' 칩 판정용 (P4-B) */
        />
      )}
    </div>
  )
}

// ─── AdminBookings ─────────────────────────────────────────────────────────────
// ← [2026-04-24 P6-B] users prop 추가 — 예약자 이름 live 조회용 (L1113)
export function AdminBookings({ bookings, setBookings, rooms, users = [], onForceCancel, showToast, isMobile, PER_PAGE, onDetail }) {
  const today=todayStr()
  const [dateFrom, setDateFrom]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`})
  const [dateTo,   setDateTo]  =useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`})
  const [filterRoom,   setFilterRoom]  =useState('ALL')
  const [filterUser,   setFilterUser]  =useState('')
  const [filterStatus, setFilterStatus]=useState('ALL')
  const [page, setPage]=useState(1)
  // ← [2026-04-24 P8-B] 자체 cancelModal / cancelReason / cancelling state 제거
  //   · 공통 컴포넌트 ConfirmForceCancelModal (App.tsx modal)로 이관
  //   · onForceCancel prop은 이제 App의 confirmAndAdminForceCancel — (id) 단일 인자, 다이얼로그 자동 오픈
  //   · doCancel / cancelReason 입력 / 로딩 상태는 모두 공통 컴포넌트가 담당
  // ← [2026-05-11 Phase 2] 로컬 isNoshow 정의 제거 — utils/noshow.ts SSOT 사용
  //   · 옛 룰: autoCancelled && !checkedIn && !earlyEnded && cancelledBy!=='admin'
  //   · 확정 룰: status==='confirmed' && cancelledBy==='system' && !checkedIn
  //   · cancelledBy!=='admin' 가드 제거 사유: 확정 룰의 status==='confirmed' 조건이
  //     강제취소(status='cancelled' + cancelledBy='admin')를 자동 분리 — 가드 중복
  //   · adminCancel 탭 필터(L1089)는 그대로 유지 — 별개 분류 카운트용
  const filtered=useMemo(()=>bookings.filter(b=>{
    const d=tsDate(b.start_at)
    if(d<dateFrom||d>dateTo)return false
    if(filterRoom!=='ALL'&&b.room_id!==Number(filterRoom))return false
    if(filterUser&&!b.user.toLowerCase().includes(filterUser.toLowerCase()))return false
    if(filterStatus==='upcoming'&&(b.autoCancelled||b.status==='rejected'||d<today))return false
    if(filterStatus==='completed'&&!((b.checkedIn||b.earlyEnded)&&!b.autoCancelled))return false
    if(filterStatus==='cancelled'&&!(b.autoCancelled||b.status==='rejected'))return false
    if(filterStatus==='noshow'&&!isNoshow(b))return false
    if(filterStatus==='adminCancel'&&b.cancelledBy!=='admin')return false
    return true
  }).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[bookings,dateFrom,dateTo,filterRoom,filterUser,filterStatus,today])
  const totalPages=Math.max(1,Math.ceil(filtered.length/PER_PAGE))
  const paged=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)
  const stats={
    all:filtered.length,
    upcoming:filtered.filter(b=>!b.autoCancelled&&b.status!=='rejected'&&tsDate(b.start_at)>=today).length,
    completed:filtered.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length,
    cancelled:filtered.filter(b=>b.autoCancelled||b.status==='rejected').length,
    noshow:filtered.filter(isNoshow).length,
    adminCancel:filtered.filter(b=>b.cancelledBy==='admin').length,
  }
  // ← [2026-04-24 P8-B] doCancel 함수 제거 — App.tsx의 confirmAndAdminForceCancel이 담당
  //   (다이얼로그에서 사유 입력 → 확정 시 adminForceCancelBooking 호출까지 전부 공통 경로)
  const getBadge=(b:Booking)=>{
    const d=tsDate(b.start_at)
    if(b.status==='pending'&&!b.autoCancelled)return<span style={{background:'#FEF3C7',color:'#92400E',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>승인대기</span>
    if(b.status==='rejected')return<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>거절</span>
    // ★ 관리자 강제취소 — 가장 먼저 체크 (다른 취소 케이스와 명확히 구분)
    if(b.cancelledBy==='admin')return<span style={{background:'#111',color:'#fff',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999,display:'inline-flex',alignItems:'center',gap:3}}><AlertTriangle size={9} strokeWidth={1.8}/>관리자 강제취소</span>
    if(isNoshow(b)&&d<today)return<span style={{background:'#FEF3C7',color:'#D97706',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>노쇼</span>
    if(b.autoCancelled)return<span style={{background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>취소</span>
    if(b.checkedIn||b.earlyEnded)return<span style={{background:'#DCFCE7',color:'#16A34A',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>완료</span>
    if(d>=today)return<span style={{background:'#EFF6FF',color:'#3B82F6',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>예정</span>
    return<span style={{background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>종료</span>
  }
  return(
    <div className="anm">
      <div style={{background:'#fff',borderRadius:16,padding:isMobile?'16px':'20px 24px',marginBottom:16}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'flex-end'}}>
          {[{l:'시작일',v:dateFrom,s:setDateFrom},{l:'종료일',v:dateTo,s:setDateTo}].map(f=>(
            <div key={f.l} style={{flex:'1 1 130px',minWidth:120}}>
              <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label>
              <DateField value={f.v} onChange={d=>{f.s(d);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,fontSize:13,background:'#F8FAFC'}}/>{/* ← [2026-08-03] */}
            </div>
          ))}
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>회의실</label>
            <select value={filterRoom} onChange={e=>{setFilterRoom(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}>
              <option value="ALL">전체</option>{rooms.map(r=><option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>예약자</label>
            <input placeholder="이름 검색..." value={filterUser} onChange={e=>{setFilterUser(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}/>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:12,flexWrap:'wrap'}}>
          {[
            {id:'ALL',        l:`전체 ${stats.all}`},
            {id:'upcoming',   l:`예정 ${stats.upcoming}`},
            {id:'completed',  l:`완료 ${stats.completed}`},
            {id:'noshow',     l:`노쇼 ${stats.noshow}`},
            {id:'cancelled',  l:`취소 ${stats.cancelled}`},
            {id:'adminCancel',l:`관리자취소 ${stats.adminCancel}`, dark:true},
          ].map(s=>(
            <button key={s.id} className="btn" onClick={()=>{setFilterStatus(s.id);setPage(1)}}
              style={{padding:'5px 12px',fontSize:11,borderRadius:999,
                background:filterStatus===s.id?((s as any).dark?'#111':'#111'):'#F8FAFC',
                color:filterStatus===s.id?'#fff':'#64748B',
                border:filterStatus===s.id?'none':'1px solid #E2E8F0'}}>{s.l}</button>
          ))}
          <button className="btn" onClick={()=>{
            const getStatus=(b:Booking)=>b.cancelledBy==='admin'?'관리자강제취소':b.autoCancelled?'취소':b.checkedIn?'완료':b.status==='pending'?'승인대기':'예정'
            const csvRows=filtered.map(b=>{const r=rooms.find(rm=>rm.room_id===b.room_id);return{목적:purposeExportText(b.purpose,b.purposeDetail),회의명:b.title,회의실:r?.room_name??'',날짜:tsDate(b.start_at),시작:b.start_at.slice(11,16),종료:b.end_at.slice(11,16),예약자:b.user,부서:b.dept,상태:getStatus(b)}})
            exportCSV(csvRows,`예약목록_${dateFrom}_${dateTo}`)
          }} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:5,padding:'5px 12px',fontSize:11,borderRadius:999,background:'#F8FAFC',border:'1px solid #E2E8F0',color:'#374151',fontWeight:600}}>
            <Download size={10} strokeWidth={1.8}/> CSV
          </button>
        </div>
      </div>
      <div style={{background:'#fff',borderRadius:16,overflow:'hidden'}}>
        {paged.length===0?(<div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}><div style={{display:'flex',justifyContent:'center',marginBottom:8}}><Inbox size={40} strokeWidth={1.8} color="#CBD5E1"/></div><div style={{fontSize:13}}>조건에 맞는 예약이 없습니다</div></div>):(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'#F8FAFC'}}>
                {['목적','회의명','회의실','날짜','시간','예약자','상태','관리'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:600,color:'#94A3B8',whiteSpace:'nowrap',borderBottom:'1px solid #F1F5F9'}}>{h}</th>)}
              </tr></thead>
              <tbody>{paged.map(b=>{const r=rooms.find(rm=>rm.room_id===b.room_id);const canCancel=!b.autoCancelled&&b.status!=='rejected';
                // ← [2026-04-24 P6-B] 예약자 이름 live — profiles.name 우선, snapshot fallback
                const owner = (users as any[]).find((u:any) => u.user_id === b.user_id);
                const displayName = owner?.name ?? b.user ?? '—';
                return(
                <tr key={b.id} style={{borderBottom:'1px solid #F8FAFC',cursor:'pointer'}} onClick={()=>onDetail&&onDetail(b)} onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  {/* ← [2026-07-27 목적 Phase 3] 목적 컬럼 — NULL(도입 전 예약)은 '—' */}
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{b.purpose ? <PurposeChip purpose={b.purpose} size="row" /> : <span style={{color:'#C3CBD9'}}>—</span>}</td>
                  <td style={{padding:'10px 14px',fontWeight:600,color:'#111',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{r?.room_name??'?'}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSDateFull(b.start_at)}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}><div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:500,flexShrink:0,background:'#F1EFE8',color:'#444441'}}>{(displayName ?? '?')[0]}</div><span style={{fontSize:13,fontWeight:500}}>{displayName}</span></div></td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{getBadge(b)}</td>
                  <td style={{padding:'10px 14px'}} onClick={e=>e.stopPropagation()}>{canCancel&&<Button variant='danger-outline' size='sm' onClick={()=>onForceCancel(b.id)}>강제 취소</Button>}{/* ← [2026-04-24 P8-B] setCancelModal(b) → onForceCancel(b.id) — App.tsx confirmAndAdminForceCancel이 ConfirmForceCancelModal 자동 오픈 */}</td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        )}
        {totalPages>1&&(<div style={{display:'flex',justifyContent:'center',gap:4,padding:'16px',borderTop:'1px solid #F1F5F9'}}>
          <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===1?'#CBD5E1':'#64748B'}}>‹</button>
          {Array.from({length:Math.min(totalPages,7)},(_,i)=>{const p=totalPages<=7?i+1:page<=4?i+1:page>=totalPages-3?totalPages-6+i:page-3+i;return<button key={p} className="btn" onClick={()=>setPage(p)} style={{padding:'6px 10px',fontSize:12,borderRadius:8,minWidth:32,background:page===p?'#111':'#F8FAFC',color:page===p?'#fff':'#64748B',fontWeight:page===p?700:400}}>{p}</button>})}
          <button className="btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===totalPages?'#CBD5E1':'#64748B'}}>›</button>
        </div>)}
      </div>
      {/* ← [2026-04-24 P8-B] 인라인 강제취소 모달 제거 — ConfirmForceCancelModal 공통 컴포넌트로 이관
            (App.tsx confirmAndAdminForceCancel 헬퍼가 modal.type='confirmForceCancel' 띄움) */}
    </div>
  )
}

// ─── AdminRooms ────────────────────────────────────────────────────────────────
export function AdminRooms({ showToast, isMobile }) {
  const [rooms,setRooms]=useState<Room[]>([])
  const [loadingRooms,setLoadingRooms]=useState(true)
  const [editRoom,setEditRoom]=useState<any>(null)
  const [form,setForm]=useState<Record<string,any>>({})
  const [thumbnail,setThumbnail]=useState('')
  const [gallery,setGallery]=useState<string[]>([])
  const [uploading,setUploading]=useState(false)
  const thumbRef=useRef<HTMLInputElement>(null)
  const galleryRef=useRef<HTMLInputElement>(null)
  const [allFeatures,setAllFeatures]=useState<any[]>([])
  const [selectedFeats,setSelectedFeats]=useState<number[]>([])
  useEffect(()=>{
    setLoadingRooms(true)
    Promise.all([loadAllRooms(),loadFeatures()]).then(([r,f])=>{setRooms(r);setAllFeatures(f)}).catch(err=>showToast(err.message??'로드 실패','error')).finally(()=>setLoadingRooms(false))
  },[])
  const openEdit=async(r:Room|null)=>{
    // ← [2026-05-14] usage_rules(이용규칙) 추가
    setForm({room_name:r?.room_name??'',room_name_ko:r?.room_name_ko??'',floor_id:r?.floor_id??1,capacity:r?.capacity??4,notes:r?.notes??'',usage_rules:r?.usage_rules??'',is_active:r?.is_active??true,is_admin_only:r?.is_admin_only??false})
    setEditRoom(r??{room_id:null})
    if(r?.room_id){const imgs=await loadRoomImages(r.room_id);setThumbnail(imgs.thumbnail_url);setGallery(imgs.gallery_urls);setSelectedFeats((r.features??[]).map((f:any)=>f.feature_id))}
    else{setThumbnail('');setGallery([]);setSelectedFeats([])}
  }
  const handleThumbnailUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file||!editRoom?.room_id)return;setUploading(true);try{if(thumbnail)await deleteRoomImage(thumbnail);const url=await uploadRoomImage(editRoom.room_id,file,'thumbnail');setThumbnail(url);showToast('대표 이미지가 업로드되었습니다.')}catch(err:any){showToast(err.message,'error')}finally{setUploading(false);e.target.value=''}}
  const handleGalleryUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{const files=Array.from(e.target.files||[]);if(!files.length||!editRoom?.room_id)return;setUploading(true);try{const urls=await Promise.all(files.map(f=>uploadRoomImage(editRoom.room_id,f,'gallery')));setGallery(prev=>[...prev,...urls]);showToast(`갤러리 이미지 ${urls.length}장이 추가되었습니다.`)}catch(err:any){showToast(err.message,'error')}finally{setUploading(false);e.target.value=''}}
  const removeGalleryImage=async(url:string)=>{await deleteRoomImage(url);setGallery(prev=>prev.filter(u=>u!==url));showToast('이미지가 삭제되었습니다.','info')}
  const saveEdit=async()=>{
    if(!form.room_name.trim()){showToast('회의실명을 입력해주세요.','error');return}
    const capacity=Number(form.capacity),floor_id=Number(form.floor_id),roomId=editRoom?.room_id
    try{
      if(roomId){await upsertRoom({room_id:roomId,room_code:'',room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',usage_rules:form.usage_rules??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery}as any);await saveRoomImages(roomId,thumbnail,gallery);await saveRoomFeatures(roomId,selectedFeats);setRooms(prev=>prev.map(r=>r.room_id===roomId?{...r,...form,capacity,floor_id,thumbnail,gallery,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))}:r));showToast('회의실 정보가 수정되었습니다.')}
      else{const nid=Math.max(...rooms.map(r=>r.room_id),0)+1;const newRoom={room_id:nid,room_code:`ROOM_${nid}`,room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',usage_rules:form.usage_rules??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery};await upsertRoom(newRoom as any);await saveRoomImages(nid,thumbnail,gallery);await saveRoomFeatures(nid,selectedFeats);setRooms(prev=>[...prev,{...newRoom,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))}as any]);showToast('회의실이 추가되었습니다.')}
      setEditRoom(null)
    }catch(err:any){showToast(err.message,'error')}
  }
  const toggleActive=async(rid:number)=>{const next=!rooms.find(r=>r.room_id===rid)?.is_active;try{await toggleRoomActive(rid,next);setRooms(rooms.map(r=>r.room_id===rid?{...r,is_active:next}:r));showToast(next?'활성화되었습니다.':'비활성화되었습니다.','info')}catch(err:any){showToast(err.message,'error')}}
  if(loadingRooms)return<div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}><Building2 size={36} strokeWidth={1.8} color="#CBD5E1"/><div style={{fontSize:13,marginTop:8}}>회의실 불러오는 중...</div></div>
  return(
    <div className="anm">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:600,color:'#111'}}>전체 {rooms.length}개 <span style={{fontSize:12,color:'#94A3B8',fontWeight:400}}>활성 {rooms.filter(r=>r.is_active).length} · 비활성 {rooms.filter(r=>!r.is_active).length}</span></div>
        <Button variant='primary' size='sm' onClick={()=>openEdit(null)}>+ 회의실 추가</Button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:12}}>
        {rooms.map(r=>{const fl=getFloor(r.floor_id);return(
          <div key={r.room_id} className="anm" style={{background:'#fff',borderRadius:16,overflow:'hidden',opacity:r.is_active?1:0.6}}>
            <div style={{display:'flex',gap:16,padding:'20px 20px 16px'}}>
              <div style={{width:88,height:88,borderRadius:12,overflow:'hidden',flexShrink:0,background:'#F8FAFC'}}>
                {r.thumbnail?<img src={r.thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={24} strokeWidth={1.8} color="#CBD5E1"/></div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#111'}}>{r.room_name}</div>
                  {!r.is_active&&<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>비활성</span>}
                  {r.is_admin_only&&<span style={{background:'#F3E8FF',color:'#7C3AED',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>관리자전용</span>}
                </div>
                <div style={{fontSize:12,color:'#64748B',marginTop:2}}>{r.room_name} · {fl?.floor_name} · {r.capacity}인</div>
                {(r.features??[]).length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>{(r.features??[]).slice(0,3).map(f=><span key={f.feature_id} style={{background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:999,padding:'2px 7px',fontSize:10,color:'#0369A1',fontWeight:600}}>{f.feature_name}</span>)}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,padding:'0 20px 16px'}}>
              <Button variant='secondary' size='sm' flex onClick={()=>openEdit(r)}>수정</Button>
              <Button variant={r.is_active?'danger-outline':'success'} size='sm' flex onClick={()=>toggleActive(r.room_id)}>{r.is_active?'비활성화':'활성화'}</Button>
            </div>
          </div>
        )})}
      </div>
      {editRoom&&(<ModalPortal><div onClick={e=>e.target===e.currentTarget&&setEditRoom(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
        <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>\n          <div style={{overflowY:'auto',flex:1,padding:'24px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div style={{fontSize:16,fontWeight:600,color:'#111'}}>{editRoom?.room_id?'회의실 정보 수정':'새 회의실 추가'}</div>
            <ModalCloseButton onClick={()=>setEditRoom(null)} />
          </div>
          {[{k:'room_name',l:'회의실명 (영문) *'},{k:'room_name_ko',l:'회의실명 (한글)'}].map(f=>(<div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label><input value={form[f.k]||''} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>))}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>층 *</label><select value={form.floor_id} onChange={e=>setForm(p=>({...p,floor_id:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}>{FLOORS.map(f=><option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}</select></div>
            <div><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>수용인원 *</label><input type="number" value={form.capacity} min={1} onChange={e=>setForm(p=>({...p,capacity:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>
          </div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>설명/메모</label><textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none',resize:'none'}}/></div>
          {/* ← [2026-05-14] 이용규칙 입력 — 엔터/띄어쓰기 보존 textarea, rows={6} (notes보다 길어 별도 라벨) */}
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>이용규칙</label><textarea value={form.usage_rules||''} onChange={e=>setForm(p=>({...p,usage_rules:e.target.value}))} rows={6} placeholder="예) 본 회의실은 임원 회의 우선 사용입니다.&#10;음식물 반입 시 사전 협의 부탁드립니다." style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none',resize:'vertical',fontFamily:'inherit',lineHeight:1.5}}/></div>
          <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}><input type="checkbox" id="is_admin_only" checked={!!form.is_admin_only} onChange={e=>setForm(p=>({...p,is_admin_only:e.target.checked}))} style={{width:16,height:16,cursor:'pointer'}}/><label htmlFor="is_admin_only" style={{fontSize:13,color:'#374151',cursor:'pointer',fontWeight:500}}>관리자 전용 회의실 (일반 유저 예약 불가)</label></div>
          {allFeatures.length>0&&(<div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>회의실 기능</label><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{allFeatures.map(f=>(<label key={f.feature_id} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'6px 12px',borderRadius:8,border:'1px solid #E2E8F0',fontSize:12,fontWeight:500,background:selectedFeats.includes(f.feature_id)?'#111':'#F8FAFC',color:selectedFeats.includes(f.feature_id)?'#fff':'#64748B'}}><input type="checkbox" checked={selectedFeats.includes(f.feature_id)} style={{display:'none'}} onChange={e=>setSelectedFeats(prev=>e.target.checked?[...prev,f.feature_id]:prev.filter(id=>id!==f.feature_id))}/>{f.feature_name}</label>))}</div></div>)}
          {editRoom?.room_id&&(<>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>대표 이미지</label>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:72,height:72,borderRadius:10,overflow:'hidden',background:'#F8FAFC',flexShrink:0,border:'1px solid #E2E8F0'}}>{thumbnail?<img src={thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={20} strokeWidth={1.8} color="#CBD5E1"/></div>}</div>
                <div style={{flex:1}}><input ref={thumbRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleThumbnailUpload}/><button className="btn" onClick={()=>thumbRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Upload size={13} strokeWidth={1.8}/>{uploading?'업로드 중...':thumbnail?'이미지 교체':'이미지 업로드'}</button>{thumbnail&&<button className="btn" onClick={async()=>{await deleteRoomImage(thumbnail);setThumbnail('');showToast('삭제되었습니다.','info')}} style={{width:'100%',marginTop:6,padding:'8px',borderRadius:10,background:'#FEF2F2',color:'#DC2626',fontSize:11,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Trash2 size={11} strokeWidth={1.8}/> 삭제</button>}</div>
              </div>
            </div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>갤러리 ({gallery.length}장)</label>
              {gallery.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginBottom:8}}>{gallery.map((url,i)=>(<div key={i} style={{position:'relative',paddingBottom:'100%',borderRadius:8,overflow:'hidden',background:'#F8FAFC'}}><img src={url} alt="" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/><button onClick={()=>removeGalleryImage(url)} style={{position:'absolute',top:4,right:4,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.6)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><X size={10} strokeWidth={1.8}/></button></div>))}</div>}
              <input ref={galleryRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleGalleryUpload}/><button className="btn" onClick={()=>galleryRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><ImagePlus size={13} strokeWidth={1.8}/>{uploading?'업로드 중...':'갤러리 이미지 추가'}</button>
            </div>
          </>)}
          </div>
          {/* sticky footer */}
          <div style={{display:'flex',gap:8,padding:'12px 24px 20px',borderTop:'1px solid #F1F5F9',flexShrink:0}}>
            <Button variant='ghost' flex onClick={()=>setEditRoom(null)}>취소</Button>
            <Button variant='primary' flex onClick={saveEdit}>저장</Button>
          </div>
        </div>
      </div></ModalPortal>)}
    </div>
  )
}

// ─── AdminUsers ────────────────────────────────────────────────────────────────
// ← [2026-04-18 P0 fix] import 제거 → 최상단으로 이동
//
// ✅ 변경 이력
//  - [2026-05-14] '로그인/미로그인' 구별 기능 제거
//      · 배경: sync-all-users v7부터 미로그인 사용자도 Azure AD에서 dept 자동 수집
//              → 기존 `dept 유무 = 로그인 여부` heuristic이 무효화됨
//      · 변경: FilterType에서 'logged'|'unlogged' 제거, 카운트/필터/탭/뱃지/CSV 라벨 모두 정리
//      · 영향: 사용자 목록 화면에서 '로그인'·'미로그인' 탭 사라짐, dept 빈값은 '-'로 표시
//      · 후속 [2026-05-14] '전체' 라벨 → '재직자'로 변경 (퇴사자와 대구되는 명확한 표현)

export function AdminUsers({ users, setUsers, rooms = [], showToast, isMobile, currentUserId = '' }) {
  // ← [2026-05-26] rooms prop 추가 — 노쇼 현황 DetailDrawer 드릴다운 시 회의실 이름 표시용
  //   기본값 [] — 외부에서 미전달 시도 안전 동작 (회의실 컬럼만 빈 값)
  type FilterType = 'all' | 'admin' | 'onleave' | 'departed' // ← [2026-07-30] 'onleave'(휴직·예정) 추가 / [2026-05-14] 'logged' | 'unlogged' 제거

  const [filter,     setFilter]     = useState<FilterType>('all')
  const [searchQ,    setSearchQ]    = useState('')
  // ← [2026-07-30] 재직 상태 변경·즉시 퇴사 모달 대상 사용자
  const [statusUser, setStatusUser] = useState<AppUser | null>(null)
  // 사용자 상세 모달
  // ── 관리자 역할 (← [2026-07-24] Phase 1) ───────────────────────────────
  //   목록 배지 + 상세 모달 체크박스 그리드에서 쓴다.
  //   USER/ADMIN 토글은 제거했다 — profiles.role 은 이제 역할 개수에서 파생되는 값이라
  //   직접 바꾸면 admin_roles 와 어긋난다(권한 체계가 두 벌로 갈라졌던 원인).
  const [roleMap,   setRoleMap]   = useState<Record<string, string[]>>({})
  const [roleDraft, setRoleDraft] = useState<string[]>([])
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleLog,   setRoleLog]   = useState<RoleGrantLog[]>([])   // ← [2026-07-24 P2] 권한 변경 이력
  // ← [2026-07-24 P4] 목록 ↔ 권한 매트릭스 전환.
  //   별도 탭을 만들지 않은 이유: 권한은 '사용자'에 붙는 속성이라 같은 탭 안에서
  //   보는 방식만 바꾸는 게 맞고, 탭이 늘면 역할 게이트 대상도 같이 늘어난다.
  const [roleView,  setRoleView]  = useState(false)
  const [iAmSuper,  setIAmSuper]  = useState(false)

  const loadRoles = useCallback(async () => {
    try { setRoleMap(await loadAllUserRoles()) }
    catch (e: any) { console.warn('[AdminUsers] 역할 조회 실패:', e.message) }
  }, [])
  useEffect(() => { loadRoles() }, [loadRoles])
  useEffect(() => {
    loadMyAdminRoles(currentUserId).then(r => setIAmSuper(r.includes(SUPER_ROLE))).catch(() => {})
  }, [currentUserId])

  const [editUser,   setEditUser]   = useState<AppUser | null>(null)
  const [form,       setForm]       = useState<Record<string,any>>({})
  const [saving,     setSaving]     = useState(false)
  // Azure AD 동기화
  const [syncing,    setSyncing]    = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  // 퇴사자 목록
  const [departed,   setDeparted]   = useState<DepartedUser[]>([])
  // ← [2026-07-30] 수동 퇴사 UI 노출 — EmploymentStatusModal(depart-user Edge Function 경로)

  // ═══════════════════════════════════════════════════════════════════════════
  // ← [2026-05-26 신규] 사용자별 누적 노쇼 통계
  //   · 기본 기간: 현재일 기준 한 달 전 ~ 오늘 (사용자 결정 2026-05-26)
  //   · 데이터 소스: loadBookingsByRange(noshowFrom, noshowTo) — 자체 fetch (memory-light)
  //   · 카운트 룰: isNoshow SSOT (utils/noshow.ts) — 분산 룰 추가 금지 (userMemories 원칙)
  //   · 매핑 키: user_id UUID (동명이인 안전)
  //   · 정렬 기본: 이름순 (사용자 결정) — 컬럼 헤더 클릭 시 노쇼 많은 순으로 변경 가능
  // ═══════════════════════════════════════════════════════════════════════════
  const [noshowFrom, setNoshowFrom] = useState<string>(() => addDaysStr(todayStr(), -30))  // ← 한 달 전 (사용자 결정)
  const [noshowTo,   setNoshowTo]   = useState<string>(() => todayStr())
  const [noshowMap,  setNoshowMap]  = useState<Map<string, number>>(new Map())              // ← Map<user_id, noshowCount>
  const [noshowLoading, setNoshowLoading] = useState(false)
  // ← 컬럼 정렬 ('name' 기본 — 사용자 결정 / 컬럼 클릭 시 변경)
  const [userSortKey, setUserSortKey] = useState<'name' | 'noshow'>('name')
  const [userSortAsc, setUserSortAsc] = useState<boolean>(true)
  // ← 노쇼 현황 상세 DetailDrawer state
  const [noshowDrawer, setNoshowDrawer] = useState<{ from: string; to: string } | null>(null)

  // 누적 노쇼 fetch — 기간 변경 시 자동 재조회
  useEffect(() => {
    let cancelled = false
    setNoshowLoading(true)
    loadBookingsByRange(noshowFrom, noshowTo)
      .then(bookings => {
        if (cancelled) return
        const m = new Map<string, number>()
        bookings.forEach(b => {
          if (!isNoshow(b)) return
          // user_id UUID 우선 매핑 (동명이인 안전). user_id 없는 외부 예약은 통계 제외.
          const uid = b.user_id
          if (!uid) return
          m.set(uid, (m.get(uid) ?? 0) + 1)
        })
        setNoshowMap(m)
      })
      .catch(e => console.error('[AdminUsers] noshow fetch failed', e))
      .finally(() => { if (!cancelled) setNoshowLoading(false) })
    return () => { cancelled = true }
  }, [noshowFrom, noshowTo])

  useEffect(() => {
    loadDepartedUsers().then(setDeparted).catch(() => {})
  }, [])

  // ── 동기화 이력
  const SYNC_LOG_KEY = 'cnr_sync_logs'
  const loadSyncLogs = (): SyncResult[] => {
    try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) ?? '[]') } catch { return [] }
  }
  const saveSyncLog = (r: SyncResult) => {
    localStorage.setItem(SYNC_LOG_KEY, JSON.stringify([r, ...loadSyncLogs()].slice(0, 20)))
  }
  const [syncLogs, setSyncLogs] = useState<SyncResult[]>(loadSyncLogs)
  const [showLogs, setShowLogs] = useState(false)

  // ═══════════════════════════════════════════════════════════════════════════
  // ← [2026-05-26 BUGFIX] '재직자' 카운트에 퇴사자 섞이는 문제 해결
  //   증상: 사용자 보고 — "재직자" 탭 숫자에 퇴사자가 더해져 나옴
  //
  //   진단 (3단계 가설 검증):
  //   1) loadUsers는 .neq('is_active', false) 필터 이미 적용 (api.ts L828, 2026-05-14 동일 이슈 수정 시 추가됨)
  //   2) App.tsx에서 setUsers는 loadUsers() 결과만 사용 — 다른 경로 없음 ✓
  //   3) 결론: DB 데이터 불일치 — departed_users 테이블에는 있는데 profiles.is_active가 false가 아닌
  //            (NULL 또는 true 상태로 남은) 케이스가 일부 존재. 즉 sync-all-users / manualDepartUser가
  //            두 테이블 동시 업데이트를 누락한 케이스 (근본 점검 별도 TODO)
  //
  //   화면 안전망: departed.email Set으로 cross-reference 필터
  //   · email은 NOT NULL + 시스템 전반 식별자 (userMemories 명시)
  //   · users 배열에 퇴사자가 섞여 있어도 화면에서는 강제 제외
  //   · 다른 컴포넌트(AdminBookings 등)에 영향 0 — AdminUsers 내부 변수만 변경
  //
  //   📌 TODO (별도 채팅 점검): sync-all-users / manualDepartUser Edge Function이
  //      departed_users INSERT 시 profiles.is_active=false UPDATE도 동시에 하는지 검증.
  //      누락 시 두 테이블 동기화 트리거 추가 또는 백필 스크립트 실행 필요.
  //   ✅ [2026-07-30 해소] 퇴사 파이프라인이 process_departure RPC 단일 트랜잭션으로
  //      일원화되어(20260735) 두 테이블 불일치가 구조적으로 재발하지 않는다.
  //      이 cross-reference 필터는 과거 잔여 데이터 대비 안전망으로 유지.
  // ═══════════════════════════════════════════════════════════════════════════
  const activeUsers = useMemo(() => {
    if (!departed.length) return users  // 퇴사자 없으면 그대로 (불필요한 연산 회피)
    // email 기반 cross-reference — DepartedUser.email은 NOT NULL, lowercase 정규화
    const departedEmailSet = new Set(
      departed
        .map(d => (d.email ?? '').toLowerCase().trim())
        .filter(Boolean)
    )
    if (!departedEmailSet.size) return users
    return users.filter(u => !departedEmailSet.has((u.email ?? '').toLowerCase().trim()))
  }, [users, departed])

  // ── 카운트
  // ← [2026-05-26 BUGFIX] users → activeUsers — 퇴사자 cross-reference 안전망 적용
  const counts = {
    all:      activeUsers.length,
    admin:    activeUsers.filter(u => u.role === 'ADMIN').length,
    // ← [2026-07-30] 휴직·퇴사예정 카운트 (returned 는 재직 계열이라 미포함)
    onleave:  activeUsers.filter(u => u.employment_status === 'leave' || u.employment_status === 'departing').length,
    // ← [2026-05-14] logged/unlogged 카운트 제거 (dept 유무로 판정하던 heuristic 폐기)
    departed: departed.length,
  }

  // ── 검색 + 필터
  // ← [2026-05-26 BUGFIX] users → activeUsers — 퇴사자가 검색/정렬 결과에도 안 보이도록 보장
  const filteredUsers = activeUsers.filter(u => {
    if (filter === 'admin'    && u.role !== 'ADMIN') return false
    // ← [2026-07-30] '휴직·예정' 필터 — 휴직 + 퇴사예정만
    if (filter === 'onleave'  && u.employment_status !== 'leave' && u.employment_status !== 'departing') return false
    // ← [2026-05-14] logged/unlogged 필터 분기 제거 (FilterType에서도 제거됨)
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return u.name.toLowerCase().includes(q)
        || (u.dept ?? '').toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
  })

  // ← [2026-05-26 신규] 정렬 — userSortKey 'name'(이름) 또는 'noshow'(누적노쇼)
  //   기본: 이름 asc (사용자 결정). 노쇼 컬럼 헤더 클릭 시 noshow desc로 변경.
  const sortedFilteredUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      if (userSortKey === 'noshow') {
        const an = noshowMap.get(a.user_id) ?? 0
        const bn = noshowMap.get(b.user_id) ?? 0
        if (an !== bn) return userSortAsc ? an - bn : bn - an
        // 동률은 이름으로 안정 정렬
        return a.name.localeCompare(b.name)
      }
      // 이름 정렬
      return userSortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    })
  }, [filteredUsers, userSortKey, userSortAsc, noshowMap])

  const filteredDeparted = departed.filter(u => {
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return u.name.toLowerCase().includes(q)
        || (u.dept ?? '').toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
  })

  const openDetail = (u: AppUser) => {
    setForm({ name: u.name, dept: u.dept, email: u.email, role: u.role })
    setRoleDraft(roleMap[u.user_id] ?? [])   // ← [2026-07-24] 현재 역할로 체크 상태 초기화
    setRoleLog([])
    loadRoleGrantLog(u.user_id).then(setRoleLog).catch(() => {})   // ← [2026-07-24 P2]
    setEditUser(u)
  }

  // ← [2026-07-30 UI 통합] 권한 변경 dirty 판정 — 초안(roleDraft) vs 저장본(roleMap)
  //   배경: 모달에 '권한 저장'(소형) / '저장'(하단) 버튼이 2개라 하단 저장만 누르고
  //   권한이 안 바뀌는 혼선 발생 (2026-07-30 실사용 보고). 저장 경로를 하나로 통합.
  const savedRoles = roleMap[editUser?.user_id ?? ''] ?? []
  const rolesDirty = !!editUser
    && [...roleDraft].sort().join(',') !== [...savedRoles].sort().join(',')

  const closeModal = () => {
    // ← [2026-07-30 UI 통합] 미저장 권한 변경 이탈 방지 — 권한은 실수 비용이 큼
    //   (매트릭스의 역할 0개 confirm 과 동일한 이유). 오버레이/X/취소 모두 이 경로.
    if (rolesDirty && !window.confirm('저장하지 않은 권한 변경이 있습니다. 저장하지 않고 닫을까요?')) return
    setEditUser(null)
  }

  /** 역할 저장 내부 헬퍼 — ← [2026-07-30 UI 통합] 단독 버튼 제거, saveEdit 에서만 호출.
   *  전체 교체. 실패 사유는 RPC 가 코드로 알려준다(마지막 super 등). 성공 여부 반환. */
  const saveRolesInternal = async (): Promise<boolean> => {
    if (!editUser) return false
    const res = await setUserAdminRoles(editUser.user_id, roleDraft)
    if (!res.ok) { showToast(res.message ?? '권한 저장 실패', 'error'); return false }
    await loadRoles()
    loadRoleGrantLog(editUser.user_id).then(setRoleLog).catch(() => {})
    // profiles.role 이 RPC 안에서 함께 바뀌므로 목록도 갱신한다
    // ← [2026-07-30] 함수형 업데이트 — 직후 프로필 낙관 갱신과 연속 호출되므로 stale 클로저 금지
    setUsers(prev => prev.map(u => u.user_id === editUser.user_id
      ? { ...u, role: roleDraft.length > 0 ? 'ADMIN' : 'USER' } : u))
    return true
  }

  // ── 저장 — ← [2026-07-30 UI 통합] 하단 '저장' 하나가 권한+프로필 순차 저장
  //   순서: ① 권한(dirty && super 일 때만) → 실패 시 전체 중단(부분 저장 방지, 모달 유지)
  //         ② 프로필(name/dept) — 기존 낙관 갱신+롤백 로직 유지
  //   super 가 아니면 체크박스가 disabled 라 rolesDirty 자체가 발생하지 않음 (방어적 가드 병행)
  const saveEdit = async () => {
    if (!editUser?.user_id) return
    if (!form.name.trim()) { showToast('이름은 필수입니다.', 'error'); return }
    setSaving(true)
    try {
      // ① 권한 먼저 — 실패하면 프로필도 저장하지 않는다 (반쪽 저장이 더 큰 혼란)
      const withRoles = rolesDirty && iAmSuper
      if (withRoles) {
        setRoleSaving(true)
        const ok = await saveRolesInternal()
        setRoleSaving(false)
        if (!ok) return   // 실패 사유 토스트는 내부에서 — 모달 유지, 재시도 가능
      }
      // ② 프로필 — 낙관 갱신 + 실패 롤백 (기존 로직, 함수형 업데이트로 전환)
      const prevRow = users.find(u => u.user_id === editUser.user_id)
      setUsers(prev => prev.map(u => u.user_id === editUser.user_id ? { ...u, ...form } : u))
      try {
        // ← [2026-07-24] role 제거 — profiles.role 은 admin_roles 개수에서 파생되는 값이라
        //   여기서 직접 쓰면 권한 체계가 다시 두 벌로 갈라진다. 역할은 위 saveRolesInternal 이 담당.
        await updateProfile(editUser.user_id, { name: form.name, dept: form.dept })
      } catch (err: any) {
        if (prevRow) setUsers(prev => prev.map(u => u.user_id === editUser.user_id ? prevRow : u))
        // ← 권한은 이미 저장됨 — 무엇이 성공/실패했는지 명확히 알림 (조용한 반쪽 저장 방지)
        showToast(withRoles ? `권한은 저장됐지만 정보 저장에 실패했습니다: ${err.message}` : err.message, 'error')
        return
      }
      showToast(withRoles ? '권한과 정보를 저장했습니다.' : '수정되었습니다.')
      setEditUser(null)   // ← closeModal 미사용 — 저장 직후엔 dirty confirm 불필요
    } finally { setSaving(false) }
  }

  // ── 권한 토글 — [2026-07-24] 제거
  //   `updateProfile({ role })` 로 profiles.role 을 직접 뒤집던 함수였다.
  //   이제 profiles.role 은 admin_roles 개수에서 파생되는 값이라, 여기서 직접 쓰면
  //   권한 체계가 다시 두 벌로 갈라진다(도서관 RLS 차단의 원인이었던 그 구조).
  //   권한 변경은 상세 모달의 역할 그리드 → admin_set_user_roles RPC 한 경로뿐이다.

  // ── Azure AD 동기화
  const handleSync = async () => {
    // ← [2026-07-30 CTA 전수검사 P3] 실행 확인 — 신규 계정 생성·프로필 갱신·퇴사 감지가
    //   원클릭으로 돌던 것을 막는다. 관리자 화면 저빈도 액션이라 native confirm(L1)으로 충분.
    if (!window.confirm('Azure AD 동기화를 실행할까요?\n신규 계정 생성 · 프로필 갱신 · 퇴사 감지가 즉시 반영됩니다.')) return
    setSyncing(true); setSyncResult(null)
    try {
      const result = await syncAllUsers()
      setSyncResult(result); saveSyncLog(result); setSyncLogs(loadSyncLogs())
      const [refreshed, refreshedDeparted] = await Promise.all([loadUsers(), loadDepartedUsers()])
      setUsers(refreshed); setDeparted(refreshedDeparted)
      showToast(`동기화 완료 — ${result.synced}명 반영`, 'info')
    } catch (err: any) {
      showToast(err.message ?? 'Azure AD 동기화 실패', 'error')
    } finally { setSyncing(false) }
  }

  // ── 필터 탭
  const FILTER_TABS: { id: FilterType; label: string }[] = [
    { id: 'all',      label: '재직자' }, // ← [2026-05-14] '전체' → '재직자' (퇴사자와 대구되는 명확한 표현, 의미적으로 'all'은 재직중인 사용자 전체)
    { id: 'admin',    label: 'Admin' },
    // ← [2026-05-14] '로그인'·'미로그인' 탭 제거 (dept 유무 heuristic 폐기)
    { id: 'onleave',  label: '휴직·예정' }, // ← [2026-07-30] 휴직 + 퇴사예정
    { id: 'departed', label: '퇴사자' },
  ]

  return (
    <div className="anm">
      {/* ── 헤더 ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:15, fontWeight:600, color:'#111' }}>사용자 관리</div>
        <div style={{ display:'flex', gap:8 }}>
          {/* ← [2026-07-24 P4] 권한 매트릭스 토글 */}
          <button className="btn" onClick={() => setRoleView(v => !v)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8,
              background: roleView ? '#111' : '#F8FAFC', border: roleView ? 'none' : '1px solid #E2E8F0',
              color: roleView ? '#fff' : '#374151', fontWeight:600, cursor:'pointer' }}>
            {roleView ? '사용자 목록' : '권한 매트릭스'}
          </button>
          <button className="btn" onClick={handleSync} disabled={syncing}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8,
              background: syncing ? '#F1F5F9' : '#EFF6FF', border:'1px solid #BFDBFE',
              color: syncing ? '#94A3B8' : '#2563EB', fontWeight:600, cursor: syncing ? 'not-allowed' : 'pointer' }}>
            <RefreshCw size={11} strokeWidth={1.8}/>
            {syncing ? '동기화 중...' : 'Azure AD 동기화'}
          </button>
          {/* ← [2026-05-26 신규] 노쇼 현황 상세 — DetailDrawer type='users' 진입 시 노쇼한 사람 최신순 정렬 (사용자 결정) */}
          {filter !== 'departed' && (
            <button className="btn"
              onClick={() => setNoshowDrawer({ from: noshowFrom, to: noshowTo })}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8,
                background:'#FFF5F5', border:'1px solid #FECACA', color:'#DC2626', fontWeight:600 }}>
              <AlertCircle size={11} strokeWidth={1.8}/> 노쇼 현황 상세
            </button>
          )}
          <button className="btn"
            // ← [2026-05-26] CSV에 누적노쇼 + 조회기간 컬럼 추가 (사용자 요청)
            onClick={() => exportCSV(
              filter === 'departed'
                ? filteredDeparted.map(u => ({ 이름:u.name, 부서:u.dept, 이메일:u.email, 퇴사일:u.departed_at.slice(0,10) }))
                : sortedFilteredUsers.map(u => ({
                    이름: u.name,
                    부서: u.dept || '',
                    이메일: u.email,
                    권한: u.role,
                    재직상태: u.employment_status === 'leave' ? '휴직'
                            : u.employment_status === 'departing' ? `퇴사예정(${u.departure_scheduled_on ?? ''})`
                            : u.employment_status === 'returned' ? '복직' : '재직', // ← [2026-07-30]
                    누적노쇼: noshowMap.get(u.user_id) ?? 0,
                    조회기간: `${noshowFrom} ~ ${noshowTo}`,
                  })),
              filter === 'departed' ? '퇴사자목록' : '사용자목록'
            )}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#374151', fontWeight:600 }}>
            <Download size={10} strokeWidth={1.8}/> CSV
          </button>
        </div>
      </div>

      {/* ─ [2026-05-26 UI HOTFIX] 누적 노쇼 기간 선택 — 직관성 개선 ─────────────
          · 변경 사유: 사용자 보고 "조회 툴바가 직관적이지 않음"
          · 개선:
            1) 시각 그룹화 — 좌측 [라벨+input] · 중앙 [퀵버튼 그룹] · 우측 [로딩]
            2) 라벨 명확화 — "누적 노쇼 조회 기간" → 아이콘+굵은 텍스트
            3) input 크기 증가 — height 28→32, 폰트 11→12
            4) 퀵버튼 그룹화 — 배경 추가하여 시각적 묶음 표시
            5) 활성 퀵버튼 표시 — 현재 선택된 프리셋 black bg 강조
            6) padding 8→10·14 — 더 여유로운 공간
      ──────────────────────────────────────────────────────────────────────────── */}
      {filter !== 'departed' && (() => {
        // 현재 활성 프리셋 추정 (정확 매칭 시에만 활성 표시)
        const isPreset7d   = noshowFrom === addDaysStr(todayStr(), -7)  && noshowTo === todayStr()
        const isPreset30d  = noshowFrom === addDaysStr(todayStr(), -30) && noshowTo === todayStr()
        const isPreset90d  = noshowFrom === addDaysStr(todayStr(), -90) && noshowTo === todayStr()

        const quickBtnStyle = (active: boolean): React.CSSProperties => ({
          padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:8,
          background: active ? '#111' : '#fff',
          color:      active ? '#fff' : '#64748B',
          border:     active ? 'none' : '1px solid #E2E8F0',
          cursor: 'pointer',
          transition: 'all 0.12s',
        })

        return (
          <div style={{
            display:'flex', alignItems:'center', gap:14, marginBottom:14,
            padding:'10px 14px', background:'#fff', borderRadius:12,
            border:'1px solid #F1F5F9', flexWrap:'wrap',
          }}>
            {/* ── 좌측: 라벨 + 기간 입력 ────────────────────────────────── */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <AlertCircle size={14} strokeWidth={1.8} color="#DC2626"/>
              <span style={{ fontSize:12, fontWeight:700, color:'#111', whiteSpace:'nowrap' }}>
                누적 노쇼 조회 기간
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {/* ← [2026-08-03] native date → 공통 DateField */}
              <DateField value={noshowFrom} max={noshowTo}
                onChange={setNoshowFrom}
                style={{ padding:'0 10px', borderRadius:8, fontSize:12, fontWeight:500, background:'#F8FAFC', height:32, minWidth:130 }}/>
              <span style={{ fontSize:12, color:'#94A3B8', fontWeight:500 }}>~</span>
              <DateField value={noshowTo} min={noshowFrom} max={todayStr()}
                onChange={setNoshowTo}
                style={{ padding:'0 10px', borderRadius:8, fontSize:12, fontWeight:500, background:'#F8FAFC', height:32, minWidth:130 }}/>
            </div>

            {/* ── 중앙: 퀵버튼 그룹 (시각 묶음) ───────────────────────── */}
            <div style={{
              display:'flex', alignItems:'center', gap:4,
              padding:4, background:'#F8FAFC', borderRadius:10,
            }}>
              <button className="btn"
                onClick={() => { setNoshowFrom(addDaysStr(todayStr(), -7));  setNoshowTo(todayStr()) }}
                style={quickBtnStyle(isPreset7d)}>7일</button>
              <button className="btn"
                onClick={() => { setNoshowFrom(addDaysStr(todayStr(), -30)); setNoshowTo(todayStr()) }}
                style={quickBtnStyle(isPreset30d)}>한 달</button>
              <button className="btn"
                onClick={() => { setNoshowFrom(addDaysStr(todayStr(), -90)); setNoshowTo(todayStr()) }}
                style={quickBtnStyle(isPreset90d)}>3개월</button>
            </div>

            {/* ── 우측: 로딩 인디케이터 ─────────────────────────────────── */}
            {noshowLoading && (
              <span style={{
                fontSize:11, color:'#94A3B8', display:'flex', alignItems:'center',
                gap:5, marginLeft:'auto', fontWeight:500,
              }}>
                <RefreshCw size={11} strokeWidth={1.8} style={{ animation:'spin 1s linear infinite' }}/>
                노쇼 집계 중...
              </span>
            )}
          </div>
        )
      })()}

      {/* ── 동기화 결과 배너 ── */}
      {syncResult && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', marginBottom:10, borderRadius:10, background:'#F0FDF4', border:'1px solid #86EFAC', flexWrap:'wrap', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <CheckCircle2 size={13} strokeWidth={1.8} color="#16A34A"/>
            <span style={{ fontSize:12, fontWeight:600, color:'#15803D' }}>Azure AD 동기화 완료</span>
            <span style={{ fontSize:11, color:'#64748B' }}>총 {syncResult.total}명 · {syncResult.synced}명 반영</span>
            {syncResult.departed > 0 && (
              <span style={{ fontSize:11, fontWeight:600, color:'#DC2626', background:'#FEF2F2', padding:'1px 8px', borderRadius:999 }}>
                퇴사자 {syncResult.departed}명
                {syncResult.cancelledBookings > 0 && ` · 예약 ${syncResult.cancelledBookings}건 취소`}
              </span>
            )}
          </div>
          <span style={{ fontSize:10, color:'#94A3B8' }}>
            {new Date(syncResult.syncedAt).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}
          </span>
        </div>
      )}

      {/* ── 동기화 이력 ── */}
      {syncLogs.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <button className="btn" onClick={() => setShowLogs(v => !v)}
            style={{ fontSize:11, color:'#94A3B8', background:'none', display:'flex', alignItems:'center', gap:4, padding:'2px 0' }}>
            <RefreshCw size={10} strokeWidth={1.8}/>
            동기화 이력 {syncLogs.length}건 {showLogs ? '▲' : '▼'}
          </button>
          {showLogs && (
            <div style={{ marginTop:6, background:'#F8FAFC', borderRadius:10, overflow:'hidden', border:'1px solid #E2E8F0' }}>
              {syncLogs.map((log, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 14px', borderBottom: i < syncLogs.length-1 ? '1px solid #F1F5F9' : 'none', fontSize:11 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ color:'#64748B' }}>{new Date(log.syncedAt).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                    <span style={{ color:'#374151' }}>총 {log.total}명 · {log.synced}명 반영</span>
                    {(log as any).departed > 0 && <span style={{ color:'#DC2626', fontWeight:600 }}>퇴사 {(log as any).departed}명</span>}
                  </div>
                  <span style={{ color: log.success ? '#16A34A' : '#DC2626', fontWeight:600 }}>{log.success ? '성공' : '실패'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 정리 유도 배너 (← [2026-07-24 Phase 2]) ──────────────────────
            백필로 기존 관리자 전원이 일반 역할 10개를 전부 갖고 있다. 이걸 정리해야
            세분화가 실제 효과를 갖는데, "정리한다"를 사람 기억에 맡기면 그대로 남는다
            (공지 배너가 두 달 방치된 그 패턴). 남아 있는 동안 눈에 보이게 둔다. */}
      {(() => {
        const allRoleUsers = activeUsers.filter(u => {
          const rs = roleMap[u.user_id] ?? []
          return !rs.includes(SUPER_ROLE) && rs.length === NORMAL_ROLES.length
        })
        if (allRoleUsers.length === 0) return null
        return (
          <div style={{
            display:'flex', alignItems:'center', gap:10, padding:'10px 14px', marginBottom:12,
            background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, flexWrap:'wrap',
          }}>
            <AlertTriangle size={14} strokeWidth={1.8} color="#D97706"/>
            <span style={{ fontSize:12, fontWeight:700, color:'#92400E' }}>
              전 역할 보유 {allRoleUsers.length}명
            </span>
            <span style={{ fontSize:12, color:'#A16207' }}>
              권한 세분화 도입 시 기존 관리자에게 일괄 부여된 상태입니다.
              담당이 아닌 역할을 빼면 해당 메뉴가 그 사람 화면에서 사라집니다.
            </span>
            <span style={{ fontSize:11, color:'#C2A14D', marginLeft:'auto', whiteSpace:'nowrap' }}>
              {allRoleUsers.slice(0, 3).map(u => u.name).join(', ')}
              {allRoleUsers.length > 3 ? ` 외 ${allRoleUsers.length - 3}명` : ''}
            </span>
          </div>
        )
      })()}

      {/* ── 필터 탭 ── */}
      <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        {FILTER_TABS.map(t => (
          <button key={t.id} className="btn" onClick={() => setFilter(t.id)}
            style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'5px 12px', borderRadius:999, fontSize:12, fontWeight:600, cursor:'pointer',
              background: filter === t.id ? '#111' : '#F8FAFC',
              color:      filter === t.id ? '#fff' : '#374151',
              border:     filter === t.id ? 'none' : '1px solid #E2E8F0',
            }}>
            <span>{t.label}</span>
            <span style={{ fontWeight:700 }}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* ── 검색창 ── */}
      <div style={{ background:'#fff', borderRadius:12, padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
        <Search size={14} strokeWidth={1.8} color="#94A3B8" style={{flexShrink:0}}/>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="이름, 부서, 이메일로 검색..."
          style={{ flex:1, border:'none', outline:'none', fontSize:13, background:'transparent', color:'#111' }}/>
        {searchQ && (
          <button className="btn" onClick={() => setSearchQ('')} style={{ background:'none', color:'#CBD5E1', display:'flex', alignItems:'center' }}>
            <X size={11} strokeWidth={1.8}/>
          </button>
        )}
      </div>

      {/* ── 권한 매트릭스 (← [2026-07-24 P4]) ── */}
      {roleView && (
        <AdminRoleMatrix
          users={activeUsers} roleMap={roleMap} canEdit={iAmSuper}
          showToast={showToast} onSaved={loadRoles}
        />
      )}

      {/* ── 사용자 목록 ── */}
      {!roleView && filter !== 'departed' && (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden' }}>
          {isMobile ? (
            // 모바일: 카드 리스트
            <div>
              {sortedFilteredUsers.map(u => {
                // ← [2026-05-26] 누적 노쇼 카운트 — 0/1~2/3+ 색상 구분 (사용자 결정)
                const nsCount = noshowMap.get(u.user_id) ?? 0
                const nsColor = nsCount === 0 ? '#94A3B8' : nsCount <= 2 ? '#D97706' : '#DC2626'
                const nsBg    = nsCount === 0 ? '#F1F5F9' : nsCount <= 2 ? '#FEF3C7' : '#FEE2E2'
                return (
                  <div key={u.user_id}
                    onClick={() => openDetail(u)}
                    style={{ padding:'14px 20px', borderBottom:'1px solid #F8FAFC', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFBFD')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    {/* ← [2026-07-30] 재직 상태 라벨 — 확정 요구사항 "아바타 앞에 항상 표시" */}
                    <EmploymentBadge user={u} variant="sm" />
                    <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={36} bgColor={u.role==='ADMIN'?'#111':'#E2E8F0'} textColor={u.role==='ADMIN'?'#fff':'#64748B'} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#111' }}>
                        {u.name}
                        {u.dept && <> <span style={{ color:'#94A3B8', fontWeight:400 }}>{u.dept}</span></>}
                      </div>
                      <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{u.email}</div>
                    </div>
                    {/* ← [2026-07-30] 상태 변경 버튼 — 행 클릭(상세)과 분리 (stopPropagation) */}
                    <button className="btn"
                      onClick={e => { e.stopPropagation(); setStatusUser(u) }}
                      style={{ padding:'4px 9px', borderRadius:8, fontSize:10, fontWeight:600, background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#374151', whiteSpace:'nowrap' }}>
                      상태
                    </button>
                    {/* ← [2026-05-26 신규] 모바일 노쇼 뱃지 */}
                    <span title={`최근 ${noshowFrom} ~ ${noshowTo}`} style={{
                      padding:'3px 8px', borderRadius:999, fontSize:10, fontWeight:600,
                      background: nsBg, color: nsColor, whiteSpace:'nowrap',
                    }}>노쇼 {nsCount}</span>
                    <span style={{
                      padding:'3px 9px', borderRadius:999, fontSize:10, fontWeight:600,
                      background: u.role==='ADMIN' ? '#111' : '#F8FAFC',
                      color:      u.role==='ADMIN' ? '#fff' : '#64748B',
                    }}>{u.role}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            // ← [2026-05-26 UI HOTFIX] 데스크탑 테이블 — 가로 스크롤 wrapper 추가
            //   원인: 새 컬럼(누적 노쇼) 추가로 6컬럼 → 좁은 화면에서 압축됨
            //   해결: 외곽 div에 overflowX:'auto' + table minWidth 720
            //   안전: 외곽 borderRadius는 부모 wrapper(L3465)가 유지
            <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', minWidth:780, borderCollapse:'collapse', fontSize:13 }}>{/* ← [2026-07-30] 상태 컬럼 추가로 720→780 */}
              <thead>
                <tr style={{ background:'#F8FAFC' }}>
                  {/* ← [2026-05-26] 헤더 정렬 가능 — 이름·누적노쇼 컬럼 (사용자 결정: 이름 기본, 노쇼 클릭 시 desc) */}
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9' }}></th>
                  {/* 이름 — 정렬 가능 */}
                  <th onClick={() => {
                      if (userSortKey === 'name') setUserSortAsc(s => !s)
                      else { setUserSortKey('name'); setUserSortAsc(true) }
                    }}
                    style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600,
                      color: userSortKey==='name' ? '#111' : '#94A3B8',
                      borderBottom:'1px solid #F1F5F9', cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
                    이름
                    <ArrowUpDown size={9} strokeWidth={1.8} style={{ marginLeft:4, opacity: userSortKey==='name' ? 1 : 0.4, verticalAlign:'middle' }}/>
                    {userSortKey==='name' && <span style={{ marginLeft:2, fontSize:9 }}>{userSortAsc ? '▲' : '▼'}</span>}
                  </th>
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9' }}>부서</th>
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9' }}>이메일</th>
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9' }}>권한</th>
                  {/* 누적 노쇼 — 정렬 가능 (클릭 시 노쇼 많은 순) */}
                  <th onClick={() => {
                      if (userSortKey === 'noshow') setUserSortAsc(s => !s)
                      else { setUserSortKey('noshow'); setUserSortAsc(false) }  // ← 노쇼는 desc 기본 (많은 순)
                    }}
                    style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600,
                      color: userSortKey==='noshow' ? '#DC2626' : '#94A3B8',
                      borderBottom:'1px solid #F1F5F9', cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
                    누적 노쇼
                    <ArrowUpDown size={9} strokeWidth={1.8} style={{ marginLeft:4, opacity: userSortKey==='noshow' ? 1 : 0.4, verticalAlign:'middle' }}/>
                    {userSortKey==='noshow' && <span style={{ marginLeft:2, fontSize:9 }}>{userSortAsc ? '▲' : '▼'}</span>}
                  </th>
                  {/* ← [2026-07-30] 재직 상태 변경 컬럼 */}
                  <th style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9', whiteSpace:'nowrap' }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {/* ← [2026-05-26] 로딩 인디케이터 (사용자 결정: 약 1초 지연 대비) */}
                {noshowLoading && (
                  <tr style={{ borderBottom:'1px solid #F8FAFC' }}>
                    <td colSpan={7} style={{ padding:'14px', textAlign:'center', color:'#CBD5E1', fontSize:11 }}>{/* ← [2026-07-30] 상태 컬럼 추가로 6→7 */}
                      <RefreshCw size={11} strokeWidth={1.8} style={{ display:'inline-block', verticalAlign:'middle', marginRight:6 }}/>
                      노쇼 집계 중...
                    </td>
                  </tr>
                )}
                {sortedFilteredUsers.map(u => {
                  // ← [2026-05-26] 누적 노쇼 카운트 + 색상
                  const nsCount = noshowMap.get(u.user_id) ?? 0
                  const nsColor = nsCount === 0 ? '#94A3B8' : nsCount <= 2 ? '#D97706' : '#DC2626'
                  const nsBg    = nsCount === 0 ? '#F1F5F9' : nsCount <= 2 ? '#FEF3C7' : '#FEE2E2'
                  return (
                    <tr key={u.user_id}
                      onClick={() => openDetail(u)}
                      style={{ borderBottom:'1px solid #F8FAFC', cursor:'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#FAFBFD')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding:'10px 14px', whiteSpace:'nowrap' }}>
                        {/* ← [2026-07-30] 재직 상태 라벨 — 확정 요구사항 "아바타 앞에 항상 표시" */}
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <EmploymentBadge user={u} variant="sm" />
                          <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={30} bgColor={u.role==='ADMIN'?'#111':'#E2E8F0'} textColor={u.role==='ADMIN'?'#fff':'#64748B'} />
                        </div>
                      </td>
                      <td style={{ padding:'10px 14px', fontWeight:600, color:'#111' }}>{u.name}</td>
                      <td style={{ padding:'10px 14px', color:'#64748B' }}>
                        {u.dept || '-'}
                      </td>
                      <td style={{ padding:'10px 14px', color:'#64748B' }}>{u.email}</td>
                      {/* ← [2026-07-24] USER/ADMIN 배지 → 역할 요약.
                            'ADMIN' 만으로는 무엇을 할 수 있는 사람인지 알 수 없다 */}
                      <td style={{ padding:'10px 14px' }}>
                        {(() => {
                          const rs = roleMap[u.user_id] ?? []
                          const isSuper = rs.includes(SUPER_ROLE)
                          if (rs.length === 0) return <span style={{ fontSize:11, color:'#CBD5E1' }}>-</span>
                          return (
                            <span title={rs.join(', ')} style={{
                              padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:600,
                              background: isSuper ? '#FEF2F2' : '#F8FAFC',
                              color:      isSuper ? '#B91C1C' : '#64748B',
                              border:     `1px solid ${isSuper ? '#FECACA' : '#E2E8F0'}`,
                              whiteSpace:'nowrap',
                            }}>{roleSummary(rs)}</span>
                          )
                        })()}
                      </td>
                      {/* ← [2026-05-26] 누적 노쇼 뱃지 — 0=회색, 1~2=노랑, 3+=빨강 (사용자 결정) */}
                      <td style={{ padding:'10px 14px' }}>
                        <span title={`조회기간: ${noshowFrom} ~ ${noshowTo}`} style={{
                          display:'inline-block', minWidth:32, textAlign:'center',
                          padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700,
                          background: nsBg, color: nsColor,
                        }}>{nsCount}</span>
                      </td>
                      {/* ← [2026-07-30] 재직 상태 변경 — 행 클릭(상세)과 분리 (stopPropagation) */}
                      <td style={{ padding:'10px 14px' }}>
                        <button className="btn"
                          onClick={e => { e.stopPropagation(); setStatusUser(u) }}
                          style={{ padding:'4px 10px', borderRadius:8, fontSize:10, fontWeight:600, background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#374151', whiteSpace:'nowrap', cursor:'pointer' }}>
                          상태 변경
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* ── 퇴사자 목록 ── */}
      {!roleView && filter === 'departed' && (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden' }}>
          {isMobile ? (
            <div>
              {filteredDeparted.map(u => (
                <div key={u.id} style={{ padding:'14px 20px', borderBottom:'1px solid #F8FAFC', display:'flex', alignItems:'center', gap:12, opacity:0.7 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'#FEE2E2', color:'#DC2626', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {u.name.charAt(0)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, ...departedNameStyle }}>{/* ← [2026-07-30] 퇴사자 이름 취소선 (확정: 전부 적용) */}
                      {u.name}{' '}
                      <span style={{ fontSize:10, fontWeight:600, background:'#FEE2E2', color:'#DC2626', padding:'1px 6px', borderRadius:999, textDecoration:'none' }}>퇴사</span>
                    </div>
                    <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{u.dept} · {u.email}</div>
                    <div style={{ fontSize:10, color:'#CBD5E1', marginTop:2 }}>퇴사일: {u.departed_at.slice(0,10)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#FEF2F2' }}>
                  {['', '이름', '부서', '이메일', '퇴사일'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #FEE2E2' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeparted.map(u => (
                  <tr key={u.id} style={{ borderBottom:'1px solid #F8FAFC', opacity:0.75 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FFF5F5')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding:'10px 14px', width:44 }}>
                      <div style={{ width:30, height:30, borderRadius:'50%', background:'#FEE2E2', color:'#DC2626', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {u.name.charAt(0)}
                      </div>
                    </td>
                    <td style={{ padding:'10px 14px', fontWeight:600 }}>
                      <span style={departedNameStyle}>{u.name}</span>{/* ← [2026-07-30] 퇴사자 이름 취소선 (확정: 전부 적용) */}
                      <span style={{ marginLeft:6, fontSize:10, fontWeight:600, background:'#FEE2E2', color:'#DC2626', padding:'1px 6px', borderRadius:999 }}>퇴사</span>
                    </td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.dept || '-'}</td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.email}</td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.departed_at.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          재직 상태 변경 · 즉시 퇴사 모달 (← [2026-07-30])
          · 상태 변경: RPC 응답값으로 users state 패치 (낙관적 갱신 금지)
          · 즉시 퇴사: users + departed 재로드 (profiles 삭제·departed_users 추가 반영)
      ══════════════════════════════════════════════════════════════════════ */}
      {statusUser && (
        <EmploymentStatusModal
          user={statusUser}
          showToast={showToast}
          onClose={() => setStatusUser(null)}
          onStatusChanged={(userId, patch) => {
            setUsers(users.map(u => u.user_id === userId ? { ...u, ...patch } : u))
          }}
          onDeparted={async () => {
            const [refreshed, refreshedDeparted] = await Promise.all([loadUsers(), loadDepartedUsers()])
            setUsers(refreshed); setDeparted(refreshedDeparted)
          }}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          사용자 상세 모달 (드로어 → 중앙 모달)
      ══════════════════════════════════════════════════════════════════════ */}
      {editUser && (
        <ModalPortal>
        <div onClick={closeModal}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
          <div className="anm" onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:480, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column' }}>

            {/* ── 모달 헤더 */}
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <UserAvatar name={editUser.name} avatarUrl={(editUser as any).avatar_url ?? null} size={40} bgColor={editUser.role==='ADMIN'?'#111':'#E2E8F0'} textColor={editUser.role==='ADMIN'?'#fff':'#64748B'} />
                <div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#111' }}>{editUser.name}</div>
                  <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{editUser.email}</div>
                </div>
              </div>
              <button className="btn" onClick={closeModal} style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', background:'#F1F5F9', color:'#64748B' }}>
                <X size={14} strokeWidth={1.8}/>
              </button>
            </div>

            {/* ── 기본 정보 편집 뷰 */}
            <div style={{ padding:'20px 24px', flex:1 }}>
                {/* 이름 */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>이름 *</label>
                  <input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:14, background:'#fff', outline:'none', boxSizing:'border-box' }}
                    onFocus={e => e.target.style.borderColor='#111'} onBlur={e => e.target.style.borderColor='#E2E8F0'}/>
                </div>
                {/* 부서 */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>부서</label>
                  <input value={form.dept || ''} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}
                    style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:14, background:'#fff', outline:'none', boxSizing:'border-box' }}
                    onFocus={e => e.target.style.borderColor='#111'} onBlur={e => e.target.style.borderColor='#E2E8F0'}/>
                </div>
                {/* 이메일 (읽기 전용) */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>이메일</label>
                  <input value={form.email || ''} readOnly style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #F1F5F9', fontSize:14, background:'#F8FAFC', outline:'none', color:'#94A3B8', boxSizing:'border-box' }}/>
                </div>
                {/* ── 관리자 권한 (← [2026-07-24] Phase 1) ─────────────────────
                      USER/ADMIN 토글을 역할 체크박스 그리드로 교체.
                      체크된 역할의 탭만 그 사람에게 보인다. 역할 0개 = 어드민 진입 불가.
                      부여·회수는 최고 관리자(super)만 가능하다. */}
                <div style={{ marginBottom:20 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:8 }}>
                    관리자 권한
                    {!iAmSuper && <span style={{ marginLeft:6, fontWeight:400, color:'#CBD5E1' }}>— 최고 관리자만 변경할 수 있습니다</span>}
                  </label>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
                    {NORMAL_ROLES.map(r => {
                      const on = roleDraft.includes(r.id)
                      return (
                        <label key={r.id} title={r.desc}
                          style={{
                            display:'flex', alignItems:'center', gap:8, padding:'9px 10px',
                            borderRadius:8, border:`1px solid ${on ? '#111' : '#E2E8F0'}`,
                            background: on ? '#F8FAFC' : '#fff',
                            cursor: iAmSuper ? 'pointer' : 'not-allowed', opacity: iAmSuper ? 1 : 0.6,
                            fontSize:12, fontWeight:600, color:'#374151',
                          }}>
                          <input type="checkbox" checked={on} disabled={!iAmSuper}
                            onChange={e => setRoleDraft(d =>
                              e.target.checked ? [...d, r.id] : d.filter(x => x !== r.id))} />
                          {r.label}
                          {r.tab === null && <span style={{ fontSize:10, color:'#CBD5E1' }}>미구현</span>}
                        </label>
                      )
                    })}
                  </div>

                  {/* super 는 같은 그리드에 두되 시각적으로 분리한다 —
                      권한 부여 권한까지 넘기는 것이라 실수로 체크되면 안 된다 */}
                  <label style={{
                    display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderRadius:8,
                    border:`1.5px solid ${roleDraft.includes(SUPER_ROLE) ? '#DC2626' : '#FECACA'}`,
                    background: roleDraft.includes(SUPER_ROLE) ? '#FEF2F2' : '#fff',
                    cursor: iAmSuper ? 'pointer' : 'not-allowed', opacity: iAmSuper ? 1 : 0.6,
                  }}>
                    <input type="checkbox" checked={roleDraft.includes(SUPER_ROLE)} disabled={!iAmSuper}
                      onChange={e => setRoleDraft(d =>
                        e.target.checked ? [...d, SUPER_ROLE] : d.filter(x => x !== SUPER_ROLE))} />
                    <span style={{ fontSize:12, fontWeight:700, color:'#B91C1C' }}>최고 관리자 (super)</span>
                    <span style={{ fontSize:11, color:'#94A3B8' }}>모든 메뉴 + 다른 사람 권한 부여·회수</span>
                  </label>

                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                    <span style={{ fontSize:11, color:'#94A3B8' }}>
                      {roleDraft.length === 0 ? '역할 없음 — 어드민에 진입할 수 없습니다' : `${roleDraft.length}개 선택`}
                    </span>
                    <div style={{ flex:1 }} />
                    {/* ← [2026-07-30 UI 통합] 소형 '권한 저장' 버튼 제거 — 저장 버튼 2개 혼선의 원인.
                          권한도 하단 '저장' 한 곳에서 함께 적용되며, 변경 중임을 배지로만 표시 */}
                    {rolesDirty && (
                      <span style={{ fontSize:11, fontWeight:600, color:'#B45309', background:'#FEF3C7',
                                     padding:'3px 9px', borderRadius:6, whiteSpace:'nowrap' }}>
                        권한 변경됨 — 아래 '저장'을 누르면 적용됩니다
                      </span>
                    )}
                  </div>

                  {/* ── 권한 변경 이력 (← [2026-07-24 Phase 2]) ─────────────────
                        granted_by 만으로는 **회수 이력이 남지 않는다**(행이 사라지므로).
                        "언제부터 이 사람이 도서 관리를 못 하게 됐나" 에 답할 수 있어야 한다.
                        actor 가 비어 있으면 시스템(퇴사 자동 회수·마이그레이션 백필)이다. */}
                  {roleLog.length > 0 && (
                    <details style={{ marginTop:12 }}>
                      <summary style={{ fontSize:11, fontWeight:600, color:'#64748B', cursor:'pointer' }}>
                        권한 변경 이력 {roleLog.length}건
                      </summary>
                      <div style={{ marginTop:8, maxHeight:180, overflowY:'auto',
                                    border:'1px solid #F1F5F9', borderRadius:8 }}>
                        {roleLog.map(g => {
                          const actor = users.find(u => u.user_id === g.actor)
                          const label = ADMIN_ROLES.find(r => r.id === g.role)?.label ?? g.role
                          return (
                            <div key={g.id} style={{
                              display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                              borderBottom:'1px solid #F8FAFC', fontSize:11,
                            }}>
                              <span style={{ color:'#94A3B8', whiteSpace:'nowrap' }}>
                                {g.created_at.slice(0, 10)}
                              </span>
                              <span style={{
                                padding:'1px 7px', borderRadius:999, fontWeight:700,
                                background: g.action === 'grant' ? '#DCFCE7' : '#FEE2E2',
                                color:      g.action === 'grant' ? '#166534' : '#B91C1C',
                              }}>{g.action === 'grant' ? '부여' : '회수'}</span>
                              <span style={{ color:'#374151', fontWeight:600 }}>{label}</span>
                              <div style={{ flex:1 }} />
                              <span style={{ color:'#CBD5E1' }}>{actor?.name ?? '시스템'}</span>
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  )}
                </div>

                {/* 저장 / 취소 — ← [2026-07-30 UI 통합] '저장' 하나가 권한+프로필 전부 적용 */}
                <div style={{ display:'flex', gap:8, marginBottom:24 }}>
                  <Button variant='ghost' flex onClick={closeModal}>취소</Button>
                  <Button variant='primary' flex loading={saving || roleSaving} onClick={saveEdit}>저장</Button>
                </div>
              </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          ← [2026-05-26 신규] 노쇼 현황 상세 DetailDrawer
          · 진입 정렬: lastNoshowAt desc (노쇼한 사람 최신순 — 사용자 결정)
          · 기간: AdminUsers의 현재 노쇼 조회기간(noshowFrom/To) prop 전달
          · 기존 DetailDrawer 인프라 100% 재사용 (CSV/드릴다운/기간변경 모두 동작)
          ═══════════════════════════════════════════════════════════════════════ */}
      {noshowDrawer && (
        <DetailDrawer
          type='users'
          rooms={rooms}
          users={users}
          initFrom={noshowDrawer.from}
          initTo={noshowDrawer.to}
          initialSortKey='lastNoshowAt'
          initialSortAsc={false}
          onClose={() => setNoshowDrawer(null)}
        />
      )}
    </div>
  )
}
// ─── AdminApprovals ────────────────────────────────────────────────────────────
// 승인 정책:
//   - 승인/거절 가능 시간: start_at 1분 전까지 (nowMs < startMs - 60000)
//   - 기한 초과: status='pending' && autoCancelled=true
//   - 거절: status='rejected' && autoCancelled=true
//   - 승인 완료: status='confirmed'
// ← [2026-04-18 P0 fix] import 제거 → 최상단으로 이동

export function AdminApprovals({ bookings, rooms, users, onApprove, onReject, showToast, isMobile, onDetail }) {
  const [filterStatus, setFilterStatus] = useState<'pending'|'confirmed'|'rejected'|'expired'|'all'>('pending')
  const [rejectModal,  setRejectModal]  = useState<{id:string;title:string;user:string}|null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [processing,   setProcessing]   = useState<string|null>(null)
  const [nowMs,        setNowMs]        = useState(Date.now())
  const [dateFrom,     setDateFrom]     = useState(getMonthStart(0))
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [rangeData,    setRangeData]    = useState<Booking[]>([])
  const [loadingRange, setLoadingRange] = useState(false)
  // 툴바 내 로컬 필터 (sort/floor/search)
  const [sortOrder,   setSortOrder]   = useState<'latest'|'oldest'>('latest')
  const [floorFilter, setFloorFilter] = useState<number|'ALL'>('ALL')
  const [searchQ,     setSearchQ]     = useState('')

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 10000)
    return () => clearInterval(iv)
  }, [])

  const adminRoomIds = useMemo(() => new Set(rooms.filter(r => r.is_admin_only).map(r => r.room_id)), [rooms])

  const fetchRange = useCallback(async () => {
    setLoadingRange(true)
    try {
      const data = await loadBookingsByRange(dateFrom, dateTo)
      setRangeData(data.filter(b => adminRoomIds.has(b.room_id)))
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [dateFrom, dateTo, adminRoomIds])

  useEffect(() => { fetchRange() }, [fetchRange])

  const mergedData = useMemo(() => {
    const liveAll = bookings.filter(b => adminRoomIds.has(b.room_id))
    const liveIds = new Set(liveAll.map(b => b.id))
    const historical = rangeData.filter(b => !liveIds.has(b.id))
    return [...liveAll, ...historical].sort((a,b) => b.start_at.localeCompare(a.start_at))
  }, [bookings, rangeData, adminRoomIds])

  const classify = (b: Booking) => {
    if (b.status === 'pending' && b.autoCancelled)  return 'expired'
    // ← [2026-07-23 버그수정] 마감이 지난 pending은 '대기'가 아니라 '기한초과'다.
    //   기존엔 autoCancelled 플래그만 봤기 때문에, cron이 아직 마킹하지 않은 건이
    //   대기 탭에 떴다가 tick 후 사라졌다.
    if (isExpiredPending(b))                        return 'expired'
    if (isAwaitingApproval(b))                      return 'pending'
    if (b.status === 'confirmed') return 'confirmed'
    if (b.status === 'rejected')  return 'rejected'
    return 'other'
  }

  const displayData = useMemo(() => {
    if (filterStatus === 'all') return mergedData
    return mergedData.filter(b => classify(b) === filterStatus)
  }, [mergedData, filterStatus])

  // 툴바 내 로컬 필터 적용 (sort/floor/search)
  const floors = useMemo(() =>
    [...new Set(rooms.map(r => r.floor_id).filter(Boolean))].sort((a,b) => (a as number)-(b as number)) as number[],
  [rooms])

  const filteredDisplayData = useMemo(() => {
    let list = [...displayData]
    if (floorFilter !== 'ALL') {
      const ids = rooms.filter(r => r.floor_id === floorFilter).map(r => r.room_id)
      list = list.filter(b => ids.includes(b.room_id))
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(b => b.title.toLowerCase().includes(q) || (b.user ?? '').toLowerCase().includes(q))
    }
    return list.sort((a, b) =>
      sortOrder === 'latest' ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : (a.createdAt ?? 0) - (b.createdAt ?? 0)
    )
  }, [displayData, floorFilter, searchQ, sortOrder, rooms])

  const counts = useMemo(() => ({
    pending:   mergedData.filter(b => classify(b) === 'pending').length,
    confirmed: mergedData.filter(b => classify(b) === 'confirmed').length,
    rejected:  mergedData.filter(b => classify(b) === 'rejected').length,
    expired:   mergedData.filter(b => classify(b) === 'expired').length,
    all:       mergedData.length,
  }), [mergedData])

  const canApprove = (b: Booking) => nowMs < new Date(b.start_at).getTime() - 60_000
  const minsLeft   = (b: Booking) => Math.max(0, Math.floor((new Date(b.start_at).getTime() - 60_000 - nowMs) / 60_000))

  const doApprove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (processing) return
    setProcessing(id)
    try { await onApprove(id); fetchRange() }
    finally { setProcessing(null) }
  }

  const doReject = async () => {
    if (!rejectModal || processing) return
    setProcessing(rejectModal.id)
    try {
      await onReject(rejectModal.id, rejectReason || '관리자 거절')
      setRejectModal(null); setRejectReason('')
      fetchRange()
    } finally { setProcessing(null) }
  }

  const TABS = [
    { id:'pending',   label:'대기',    count:counts.pending,   color:'#D97706', activeBg:'#FEF3C7' },
    { id:'confirmed', label:'승인완료', count:counts.confirmed, color:'#16A34A', activeBg:'#DCFCE7' },
    { id:'rejected',  label:'거절',    count:counts.rejected,  color:'#DC2626', activeBg:'#FEF2F2' },
    { id:'expired',   label:'기한초과', count:counts.expired,   color:'#94A3B8', activeBg:'#F1F5F9' },
    { id:'all',       label:'전체',    count:counts.all,       color:'#111',    activeBg:'#F1F5F9' },
  ] as const

  return (
    <div className="anm">
      {/* 인라인 날짜 필터 */}
      <div style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111' }}>승인 관리</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {/* ← [2026-08-03] native date → 공통 DateField */}
            <DateField value={dateFrom} onChange={setDateFrom}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', width:118 }}/>
            <span style={{ fontSize:12, color:'#CBD5E1' }}>~</span>
            <DateField value={dateTo} onChange={setDateTo}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', width:118 }}/>
            {[
              { label:'오늘',     fn:():[string,string]=>[todayStr(), todayStr()] },
              { label:'지난 7일', fn:():[string,string]=>[addDaysStr(todayStr(),-6), todayStr()] },
              { label:'이번 달',  fn:():[string,string]=>[getMonthStart(0), todayStr()] },
              { label:'지난 달',  fn:():[string,string]=>[getMonthStart(-1), getMonthEnd(-1)] },
            ].map(p => (
              <button key={p.label} className="btn" onClick={() => { const [f,t]=p.fn(); setDateFrom(f); setDateTo(t) }}
                style={{ height:32, padding:'0 10px', border:'0.5px solid #E2E8F0', borderRadius:8, fontSize:12, background:'#fff', color:'#64748B', cursor:'pointer', whiteSpace:'nowrap' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* Row 2: 상태 탭 + 정렬 + 층 + 검색 */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
            {TABS.map(t => (
              <button key={t.id} className="btn" onClick={() => setFilterStatus(t.id as any)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:999,
                  fontWeight: filterStatus===t.id ? 700 : 500,
                  background: filterStatus===t.id ? t.activeBg : '#F8FAFC',
                  color:      filterStatus===t.id ? t.color    : '#64748B',
                  border:     filterStatus===t.id ? `1.5px solid ${t.color}40` : '1px solid #E2E8F0' }}>
                <span>{t.label}</span>
                {t.count > 0 && <span style={{ background: filterStatus===t.id ? t.color : '#E2E8F0', color: filterStatus===t.id ? '#fff' : '#64748B', borderRadius:999, padding:'1px 6px', fontSize:10, fontWeight:600 }}>{t.count}</span>}
              </button>
            ))}
          </div>
          <div style={{ flex:1 }}/>
          {(['latest','oldest'] as const).map(s => (
            <button key={s} className="btn" onClick={() => setSortOrder(s)}
              style={{ height:32, padding:'0 10px', border:'0.5px solid', borderColor: sortOrder===s ? 'transparent' : '#E2E8F0', borderRadius:8, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' as const, background: sortOrder===s ? '#111' : '#fff', color: sortOrder===s ? '#fff' : '#64748B' }}>
              {s==='latest' ? '최신순' : '과거순'}
            </button>
          ))}
          <div style={{ position:'relative', minWidth:140, maxWidth:200 }}>
            <svg style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', opacity:.35, pointerEvents:'none' }} width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="이름 또는 회의명"
              style={{ width:'100%', height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 10px 0 28px', fontSize:12, background:'#fff', color:'#111', outline:'none' }}/>
          </div>
        </div>
      </div>

      <BookingListTable
        bookings={bookings}
        rooms={rooms}
        users={users ?? []}
        currentUser=""
        onDetail={onDetail ?? (() => {})}
        loading={loadingRange}
        controlled={filteredDisplayData}
        hideFilters={true}
        actionColumn={{
          header: '처리',
          render: (b: Booking) => {
            const status = classify(b)
            const isProc = processing === b.id

            // 승인완료 — 처리한 관리자 칩 (데이터 없으면 빈칸)
            if (status === 'confirmed') {
              if (!b.processedByName) return null
              const processedByUser = (users ?? []).find((u: any) => u.name === b.processedByName)
              return <UserChip name={b.processedByName} avatarUrl={b.processedByAvatar ?? null} variant="sm" isAdmin userInfo={processedByUser} />
            }

            // 거절 — 처리한 관리자 칩 (데이터 없으면 빈칸)
            if (status === 'rejected') {
              if (!b.processedByName) return null
              const processedByUser = (users ?? []).find((u: any) => u.name === b.processedByName)
              return <UserChip name={b.processedByName} avatarUrl={b.processedByAvatar ?? null} variant="sm" isAdmin userInfo={processedByUser} />
            }

            // 기한초과 — 라벨만
            if (status === 'expired') {
              return <span style={{ fontSize:11, color:'#94A3B8', padding:'4px 8px', background:'#F8FAFC', borderRadius:8 }}>기한초과</span>
            }

            // 승인 대기 — 승인/거절 버튼
            if (status !== 'pending' || b.autoCancelled) return null
            if (!canApprove(b)) return <span style={{ fontSize:11, color:'#94A3B8', padding:'4px 8px', background:'#F8FAFC', borderRadius:8 }}>마감</span>
            const mins = minsLeft(b)
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', gap:5 }}>
                  <button onClick={e => doApprove(b.id, e)} disabled={isProc}
                    style={{ padding:'5px 10px', fontSize:11, fontWeight:600, borderRadius:8, background:'#16A34A', color:'#fff', border:'none', cursor:isProc?'default':'pointer', opacity:isProc?0.6:1 }}>승인</button>
                  <button onClick={e => { e.stopPropagation(); setRejectModal({id:b.id,title:b.title,user:b.user}) }} disabled={isProc}
                    style={{ padding:'5px 10px', fontSize:11, fontWeight:600, borderRadius:8, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FCA5A5', cursor:isProc?'default':'pointer', opacity:isProc?0.6:1 }}>거절</button>
                </div>
                {mins <= 30 && <span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>{mins > 0 ? `${mins}분 후 마감` : '곧 마감'}</span>}
              </div>
            )
          }
        }}
      />

      {rejectModal && (
        <ModalPortal>
        <div onClick={e => e.target === e.currentTarget && setRejectModal(null)}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:420, padding:'24px', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize:16, fontWeight:600, color:'#111', marginBottom:4 }}>예약 거절</div>
            <div style={{ fontSize:13, color:'#64748B', marginBottom:16 }}>"{rejectModal.title}" — {rejectModal.user}</div>
            <div style={{ fontSize:11, color:'#D97706', background:'#FFFBEB', borderRadius:8, padding:'8px 12px', marginBottom:14 }}>
              ⚠️ 거절 시 예약은 즉시 취소되며 신청자에게 알림이 발송됩니다
            </div>
            <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:6 }}>거절 사유</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="거절 사유를 입력하세요 (선택)"
              style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:13, outline:'none', resize:'none', background:'#F8FAFC', boxSizing:'border-box' }}/>
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <Button variant='ghost' flex onClick={() => setRejectModal(null)}>취소</Button>
              <Button variant='danger' flex loading={!!processing} onClick={doReject}>거절 확정</Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
