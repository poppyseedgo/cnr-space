/**
 * MyBookingTable — MY PAGE 전용 기간별 예약 조회 테이블
 *
 * ✅ 변경 이력
 *  - [2026-05-04 핫픽스] STEP 5 후속 정리 (Figma node 454:3905, 454:3951)
 *    · 세그먼트 탭 버튼: line-height '16px' 명시 추가 (Figma leading-[16px])
 *    · 본문 영역을 flex:1 wrapper로 묶음 — 데이터 행 적을 때 페이지네이션이 위로 떠있는 문제 해결
 *      (행이 적으면 wrapper가 남은 공간 흡수 → 페이지네이션 항상 컨테이너 하단 고정)
 *    · 헤더/페이지네이션에 명시적 borderRadius 적용 (부모 overflow:hidden 의존하지 않는 안전장치)
 *    · 행에 flexShrink:0 추가 (wrapper 내부에서 행 압축 방지)
 *
 *  - [2026-05-04 STEP 3] 신규 생성 — Figma node 446:418 1:1 반영
 *
 * 📌 BookingListTable과 분리한 이유 (근본 원인 해결)
 *  · BookingListTable은 AdminPage 전용으로 유지 (정렬/층필터/검색/노쇼 카운트 정책 등 다름)
 *  · MyPage용은 디자인·기능이 완전히 달라짐 (정렬/층/검색 제거, 새 디자인 토큰 적용)
 *  · 한 컴포넌트에 두 디자인을 props로 분기하면 "if hideX else..." 분기 폭발 → 분리가 정답
 *  · userMemories 룰: BookingListTable의 isNoshow는 다음 채팅(Admin 재설계)에서 통일
 *
 * 📌 데이터 정의 (사용자 정의 2026-05-04)
 *  · isNoshow: status==='confirmed' && cancelledBy==='system' && !checkedIn (userMemories 확정 룰)
 *  · 다가오는 예약: 미래(시작 전 OR 진행 중) + 살아있음 + 노쇼/취소/거절 제외
 *  · 완료: checkedIn || earlyEnded (autoCancelled 제외)
 *  · 노쇼: isNoshow
 *  · 취소: autoCancelled && !isNoshow (사용자 취소 + 관리자 강제취소 + 기한초과 등)
 *
 * 📌 퀵버튼 (사용자 정의)
 *  · 이번 달: 1일 ~ 말일
 *  · 지난 3개월: 오늘 -90일 ~ 오늘 (롤링)
 */

import { useState, useMemo } from 'react'
import {
  tsDate, tsTime, tsMin, fmtTime, fmtDateFullWithDay,
  todayStr, nowMinutes, objToStr,
} from '../../utils/time'
import { BookingStatusBadge } from './BookingStatusBadge'
import { UserAvatar } from './UserAvatar'
import { MetaBadge } from './MetaBadge'
import { DateDisplay } from './DateDisplay'
import { ChevronBackwardIcon, ChevronForwardIcon, EmptyFaceIcon } from './Icons'
import type { Booking, Room, AppUser } from '../../types'

// ─── 상수 ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 15  // ← 사용자 결정 2026-05-04: 기존 BookingListTable과 동일한 15건 유지

// ─── 노쇼/완료/취소/다가오는 판별 (단일 진실 원천) ─────────────────────────
//   userMemories 확정 룰: isNoshow = status==='confirmed' && cancelledBy==='system' && !checkedIn
//   auto_cancelled는 노쇼 판정에 사용 금지 (룰 명시)
function isNoshow(b: Booking): boolean {
  return b.status === 'confirmed' && b.cancelledBy === 'system' && !b.checkedIn
}
function isCompleted(b: Booking): boolean {
  // 완료 = 체크인됐거나 조기반납 + 취소 안 됨
  return (!!b.checkedIn || !!b.earlyEnded) && !b.autoCancelled
}
function isCancelled(b: Booking): boolean {
  // 취소 = autoCancelled && !노쇼 (사용자 취소 + 관리자 취소 + 기한초과)
  return !!b.autoCancelled && !isNoshow(b)
}
function isUpcoming(b: Booking, today: string, now: number): boolean {
  // 다가오는 예약 = 미래(시작 전) 또는 진행 중 + 살아있음
  if (isNoshow(b))                  return false
  if (b.autoCancelled)              return false
  if (b.status === 'rejected')      return false
  const startD = tsDate(b.start_at)
  const endM   = tsMin(b.end_at)
  if (startD > today)                       return true   // 미래
  if (startD === today && endM > now)       return true   // 오늘 + 종료 전
  return false
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface MyBookingTableProps {
  bookings:         Booking[]
  rooms:            Room[]
  users?:           AppUser[]
  currentUserId:    string                                 // ← UUID (BookingStatusBadge isBooker 판정용)
  currentUserEmail: string                                 // ← email (이중 복원 fallback)
  onDetail:         (b: Booking) => void
  loading?:         boolean
  /** CSV 버튼 클릭 콜백 (현재는 toast — 추후 CSV 다운로드 구현) */
  onCsvClick?:      () => void
}

// ─── Component ───────────────────────────────────────────────────────────────
export function MyBookingTable({
  bookings, rooms, users = [],
  currentUserId, currentUserEmail,
  onDetail, loading = false, onCsvClick,
}: MyBookingTableProps) {
  const today = todayStr()
  const now   = nowMinutes()

  // ── 날짜 범위 (기본: 이번 달)
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1)
    return objToStr(d)
  })
  const [to, setTo] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0)
    return objToStr(d)
  })
  // ── 활성 퀵버튼 ('month' | '3months' | null)
  const [activeQuick, setActiveQuick] = useState<'month' | '3months' | null>('month')
  // ── 활성 탭
  const [tab, setTab] = useState<'ALL' | 'upcoming' | 'completed' | 'noshow' | 'cancelled'>('ALL')
  // ── 페이지
  const [page, setPage] = useState(1)
  const resetPage = () => setPage(1)

  // ── 퀵버튼 적용
  const applyQuick = (type: 'month' | '3months') => {
    if (type === 'month') {
      // 이번 달: 1일 ~ 말일
      const f = new Date(); f.setDate(1)
      const t = new Date(f); t.setMonth(t.getMonth() + 1, 0)
      setFrom(objToStr(f)); setTo(objToStr(t))
    } else {
      // 지난 3개월: 오늘 -90일 ~ 오늘 (롤링) — 사용자 정의 2026-05-04
      const t = new Date()
      const f = new Date(); f.setDate(f.getDate() - 90)
      setFrom(objToStr(f)); setTo(objToStr(t))
    }
    setActiveQuick(type)
    resetPage()
  }

  // ── 1차 필터: 날짜 범위
  const dateFiltered = useMemo(() =>
    bookings.filter(b => {
      const d = tsDate(b.start_at)
      return d >= from && d <= to
    })
  , [bookings, from, to])

  // ── 통계 (탭 카운트)
  const stats = useMemo(() => ({
    all:       dateFiltered.length,
    upcoming:  dateFiltered.filter(b => isUpcoming(b, today, now)).length,
    completed: dateFiltered.filter(isCompleted).length,
    noshow:    dateFiltered.filter(isNoshow).length,
    cancelled: dateFiltered.filter(isCancelled).length,
  }), [dateFiltered, today, now])

  // ── 2차 필터: 탭 + 정렬 (최신순 = createdAt 내림차순)
  const displayList = useMemo(() => {
    let list = dateFiltered
    if (tab === 'upcoming')  list = list.filter(b => isUpcoming(b, today, now))
    if (tab === 'completed') list = list.filter(isCompleted)
    if (tab === 'noshow')    list = list.filter(isNoshow)
    if (tab === 'cancelled') list = list.filter(isCancelled)
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [dateFiltered, tab, today, now])

  // ── 페이징
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE))
  const pagedList  = displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── 탭 정의 (Figma 순서: 전체 예약 / 다가오는 예약 / 완료 / 노쇼 / 취소)
  const TABS: Array<{ id: typeof tab; label: string; count: number }> = [
    { id: 'ALL',       label: '전체 예약',     count: stats.all       },
    { id: 'upcoming',  label: '다가오는 예약', count: stats.upcoming  },
    { id: 'completed', label: '완료',         count: stats.completed  },
    { id: 'noshow',    label: '노쇼',         count: stats.noshow     },
    { id: 'cancelled', label: '취소',         count: stats.cancelled  },
  ]

  // ── 페이지 번호 배열 (… 처리 — 1, last, page±2 가시)
  const pageNumbers = useMemo<(number | '...')[]>(() => {
    const arr = Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
    const result: (number | '...')[] = []
    arr.forEach((n, i) => {
      if (i > 0 && n - (arr[i-1] as number) > 1) result.push('...')
      result.push(n)
    })
    return result
  }, [totalPages, page])

  return (
    <div>
      {/* ═══════════════════════════════════════════════════════════════════
          ↓ Filter Row 1: 날짜 범위 + 퀵버튼 (Figma node 449:1734)
          · 날짜 디스플레이 2개 (gap 12) + ⎯ + 퀵버튼 그룹 (gap 8)
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap:8,                                          // ← Figma: 좌측 그룹과 우측 그룹 사이 8
        marginBottom:24,                                // ← Figma: 영역 사이 24
        flexWrap:'wrap',
      }}>
        {/* 날짜 디스플레이 그룹 (좌측) */}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>{/* ← Figma: gap 12 */}
          <DateDisplay
            value={from}
            onChange={d => { setFrom(d); setActiveQuick(null); resetPage() }}
            max={to}
          />
          {/* Figma: ⎯ separator (16 Medium #111) */}
          <span style={{
            fontSize:16, fontWeight:500, color:'#111',
            lineHeight:1, whiteSpace:'nowrap',
          }}>⎯</span>
          <DateDisplay
            value={to}
            onChange={d => { setTo(d); setActiveQuick(null); resetPage() }}
            min={from}
          />
        </div>

        {/* 퀵버튼 그룹 (우측) */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>{/* ← Figma: gap 8 */}
          <QuickBtn active={activeQuick === 'month'}    onClick={() => applyQuick('month')}>이번 달</QuickBtn>
          <QuickBtn active={activeQuick === '3months'}  onClick={() => applyQuick('3months')}>지난 3개월</QuickBtn>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ Filter Row 2: 세그먼트 탭 + CSV 버튼 (Figma node 449:1774)
          · 좌측 세그먼트 컨테이너 (bg #F3F4F8 rounded full gap 4) + 탭 5개
          · 우측 CSV 버튼 (bg #fff rounded full)
          · h 40
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        height:40,                                      // ← Figma: h 40
        marginBottom:24,                                // ← Figma: 영역 사이 24
      }}>
        {/* 세그먼트 탭 컨테이너 */}
        <div style={{
          display:'flex', alignItems:'flex-start', gap:4,  // ← Figma: gap 4
          background:'#F3F4F8',                            // ← Figma: bg #F3F4F8
          borderRadius:9999,                                // ← Figma: rounded full
          overflow:'hidden',
        }}>
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); resetPage() }}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                  padding:'12px 16px',                       // ← Figma: py 12 px 16
                  borderRadius:9999,                          // ← Figma: rounded full (10000)
                  border:'none',
                  fontFamily:'inherit',
                  fontSize:14,                                // ← Figma: 14
                  lineHeight:'16px',                          // ← [2026-05-04 핫픽스] Figma leading-[16px] 명시 반영
                  cursor:'pointer',
                  whiteSpace:'nowrap',
                  background:    active ? '#111'     : '#fff',  // ← Figma: 활성 #111 / 비활성 #fff
                  color:         active ? '#fff'     : '#657487',// ← Figma: 활성 white / 비활성 #657487
                  transition:    'background 0.15s, color 0.15s',
                }}>
                <span style={{ fontWeight:500 }}>{t.label}</span>
                <span style={{ fontWeight:400 }}>{t.count}</span>
              </button>
            )
          })}
        </div>

        {/* CSV 버튼 (Figma node 449:1845) */}
        <button
          type="button"
          onClick={() => onCsvClick?.()}
          style={{
            background:'#fff',                              // ← Figma: bg #fff
            borderRadius:9999,                               // ← Figma: rounded full
            padding:'12px 16px',                             // ← Figma: py 12 px 16
            border:'none', cursor:'pointer',
            fontFamily:'inherit',
            fontSize:14, fontWeight:500,                     // ← Figma: 14 Medium
            color:'#A5B3C4',                                 // ← Figma: #A5B3C4
            lineHeight:'16px',                                // ← Figma: leading 16
            whiteSpace:'nowrap',
          }}>CSV</button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ 테이블 컨테이너 (Figma node 449:801 / 449:2465 / 454:3905·454:3951)
          · border-radius 16, overflow hidden, gap 1px (구분선 효과)
          · min-height 426 (사용자 명시 — 데이터 적어도 높이 유지)
          · ← [2026-05-04 핫픽스] 본문 영역을 flex:1 wrapper로 묶어 페이지네이션 항상 하단 고정
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{
        borderRadius:16,                                  // ← Figma: rounded 16
        overflow:'hidden',
        display:'flex', flexDirection:'column',
        gap:1,                                            // ← Figma: gap-px (행 사이 1px 구분선)
        minHeight:426,                                    // ← Figma: min-h 426 (참고 링크 #2)
        // ← [2026-05-04 핫픽스 v2] background #F1F5F9 → #FAFCFF (사용자 요청)
        //   gap 1px 사이 노출되는 구분선 색상 (행 사이 배경)
        background:'#FAFCFF',                             // ← rgb(250, 252, 255)
      }}>
        {/* ── 헤더 ─────────────────────────────────────────────────────── */}
        <div style={{
          display:'flex', height:60, background:'#fff', flexShrink:0,
          // ← [2026-05-04 핫픽스] 명시적 상단 borderRadius (부모 overflow:hidden 의존하지 않는 안전장치)
          borderRadius:'16px 16px 0 0',
        }}>
          <Th width={160} pad="10 16">날짜</Th>
          <Th width={160}                >시간</Th>
          <Th width={240}                >회의</Th>
          <Th width={162}                >회의실</Th>
          <Th width={120}                >예약자</Th>
          <Th flex                       >상태</Th>
        </div>

        {/* ── 본문 wrapper (flex:1) ──────────────────────────────────────
            ← [2026-05-04 핫픽스] 신규 wrapper — 페이지네이션 항상 하단 고정 보장
            · 행 적을 때 wrapper가 남은 공간 흡수 → 페이지네이션이 위로 떠있는 문제 해결
            · 행 많을 때 wrapper가 콘텐츠만큼 늘어남 (flex:1은 min-content 우선)
            · gap 1: wrapper 안의 행 사이 1px 구분선 (기존 컨테이너 gap에서 이전)
            · background #F1F5F9: 행이 비는 영역(빈 공간)도 컨테이너와 동일 회색
          ───────────────────────────────────────────────────────────── */}
        <div style={{
          flex:1, minHeight:0,                            // ← flex:1 + minHeight:0 (자식 overflow 방지)
          display:'flex', flexDirection:'column',
          gap:1,                                          // ← 행 사이 1px (기존과 동일)
          background:'#FAFCFF',                           // ← [2026-05-04 핫픽스 v2] #F1F5F9 → #FAFCFF (외곽 컨테이너와 일관성)
        }}>
          {/* loading / empty / 정상 — 모두 이 wrapper 안에서 렌더 */}
          {loading ? (
          <div style={emptyContainerStyle}>
            <span style={{ fontSize:14, color:'#CBD5E1' }}>불러오는 중…</span>
          </div>
        ) : pagedList.length === 0 ? (
          /* Figma node 449:2479 / 454:3966 1:1 — •_• 이모티콘 + 안내문 */
          <div style={emptyContainerStyle}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5 }}>{/* ← Figma: gap 5 */}
              <EmptyFaceIcon size={82} color="#D9E0EE"/>{/* ← 사용자 SVG (color #D9E0EE) */}
              <span style={{
                fontSize:14, fontWeight:500, color:'#D9E0EE',     // ← Figma: 14 Medium #D9E0EE
                lineHeight:1.5,
              }}>해당 기간에 내역이 없습니다.</span>
            </div>
          </div>
        ) : (
          /* 정상 행 렌더링 */
          pagedList.map(b => {
            const room        = rooms.find(r => r.room_id === b.room_id)
            // ← [user profile live 표시 정책 — userMemories 확정 룰]
            //   1순위: profiles.name live (users 배열에서 user_id 역조회)
            //   2순위: bookings.user snapshot
            //   3순위: '?'
            const owner       = users.find(u => u.user_id === b.user_id)
            const ownerName   = owner?.name ?? b.user ?? '?'
            const ownerAvatar = (owner as any)?.avatar_url ?? null

            return (
              <div
                key={b.id}
                onClick={() => onDetail(b)}
                style={{
                  display:'flex', height:60,                  // ← Figma: 행 60px 고정
                  background:'#fff',
                  cursor:'pointer',
                  flexShrink:0,                                 // ← [2026-05-04 핫픽스] wrapper 내부에서 행 압축 방지
                  transition:'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#FAFBFD'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = '#fff'}>
                {/* 날짜 */}
                <Td width={160} pad="10 16">
                  <span style={{ fontSize:14, fontWeight:500, color:'#64748B', lineHeight:1.5 }}>
                    {fmtDateFullWithDay(tsDate(b.start_at))}
                  </span>
                </Td>
                {/* 시간 */}
                <Td width={160}>
                  <div style={{
                    display:'flex', alignItems:'center', gap:4,
                    fontSize:14, fontWeight:400, color:'#64748B', lineHeight:1.5,
                    whiteSpace:'nowrap', overflow:'hidden',
                  }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{fmtTime(tsTime(b.start_at))}</span>
                    <span>–</span>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{fmtTime(tsTime(b.end_at))}</span>
                  </div>
                </Td>
                {/* 회의 */}
                <Td width={240}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>{/* ← Figma: gap 5 */}
                    {b.recurGroupId && <MetaBadge type="recurring" size="sm"/>}
                    <span style={{
                      fontSize:14, fontWeight:500, color:'#111', lineHeight:1.5,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{b.title}</span>
                  </div>
                </Td>
                {/* 회의실 */}
                <Td width={162}>
                  <span style={{
                    fontSize:14, fontWeight:400, color:'#111', lineHeight:1.5,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{room?.room_name ?? '—'}</span>
                </Td>
                {/* 예약자 */}
                <Td width={120}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>{/* ← Figma: gap 6 */}
                    {/* Figma: 아바타 20×20 / 이니셜 10 / 이름 14 Regular #111 */}
                    <UserAvatar name={ownerName} avatarUrl={ownerAvatar} size={20}/>
                    <span style={{
                      fontSize:14, fontWeight:400, color:'#111', lineHeight:1.3,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{ownerName}</span>
                  </div>
                </Td>
                {/* 상태 (size='list' — 자동 단일 칩 + chip--list 스타일) */}
                <Td flex>
                  <BookingStatusBadge
                    booking={b}
                    room={room}
                    isAdminRoom={!!room?.is_admin_only}
                    size="list"
                    currentUserId={currentUserId}
                    currentUserEmail={currentUserEmail}
                  />
                </Td>
              </div>
            )
          })
        )}
        </div>{/* ↑ 본문 wrapper 끝 */}

        {/* ── 페이지네이션 (Figma node 449:1341 / 454:3940) ──────────────
            · 중앙 정렬, h 60, gap 4, padding 16
            · 버튼: w 32 h 30 rounded 8 / 활성 bg #000 white / 비활성 bg #F8FAFC #64748B
            · chevron: 동일 사이즈, SVG 아이콘
            · ← [2026-05-04 핫픽스] 명시적 하단 borderRadius (부모 overflow:hidden 의존하지 않는 안전장치)
          ───────────────────────────────────────────────────────────── */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'center',
          gap:4,                                            // ← Figma: gap 4
          padding:16,                                       // ← Figma: padding 16
          height:60,                                        // ← Figma: h 60
          background:'#fff',
          flexShrink:0,
          borderRadius:'0 0 16px 16px',                     // ← [2026-05-04 핫픽스] 하단 모서리 명시
        }}>
          <PageBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronBackwardIcon size={24}/>
          </PageBtn>
          {pageNumbers.map((n, i) =>
            n === '...' ? (
              <span key={`d${i}`} style={{
                width:32, height:30, display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12, color:'#CBD5E1',
              }}>…</span>
            ) : (
              <PageBtn key={n} onClick={() => setPage(n as number)} active={page === n}>
                {n}
              </PageBtn>
            )
          )}
          <PageBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            <ChevronForwardIcon size={24}/>
          </PageBtn>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── 내부 헬퍼 컴포넌트 ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ─── 퀵버튼 (이번 달 / 지난 3개월) ───────────────────────────────────────
function QuickBtn({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        // Figma node 449:1877 / 451:3019:
        // h 47, padding px 24 py 14, rounded 12
        // 활성: bg #111 / text #fff / SemiBold
        // 비활성: bg #fff / text #64748B / Medium
        height:47, padding:'14px 24px', borderRadius:12,
        border:'none', cursor:'pointer',
        fontFamily:'inherit', fontSize:14, lineHeight:'normal',
        whiteSpace:'nowrap',
        background: active ? '#111' : '#fff',
        color:      active ? '#fff' : '#64748B',
        fontWeight: active ? 600   : 500,
        transition: 'background 0.15s, color 0.15s',
      }}>
      {children}
    </button>
  )
}

// ─── 페이지네이션 버튼 ──────────────────────────────────────────────────
function PageBtn({ onClick, disabled, active, children }:
  { onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        // Figma node 449:1362(active) / 449:1363(inactive) / 449:1375(chevron):
        // w 32 h 30, rounded 8, padding px 10 py 6
        // 활성: bg #000 white 12 Medium / 비활성: bg #F8FAFC #64748B 12 Regular
        width:32, height:30, borderRadius:8,
        padding:'6px 10px',
        border:'none',
        display:'flex', alignItems:'center', justifyContent:'center',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? '#000' : '#F8FAFC',
        color:      active ? '#fff' : disabled ? '#CBD5E1' : '#64748B',
        opacity:    disabled ? 0.5 : 1,
        fontSize:12, fontWeight: active ? 500 : 400,
        fontFamily:'inherit',
        transition:'background 0.15s, color 0.15s',
      }}>
      {children}
    </button>
  )
}

// ─── 테이블 헤더 셀 ─────────────────────────────────────────────────────
function Th({ width, flex, pad = '10 14', children }:
  { width?: number; flex?: boolean; pad?: string; children: React.ReactNode }) {
  // Figma node 449:764 등: padding 10 16(첫셀) / 10 14(나머지), 14 SemiBold #92A0BC
  const [py, px] = pad.split(' ').map(Number)
  return (
    <div style={{
      ...(flex ? { flex:1, minWidth:0 } : { width, flexShrink:0 }),
      height:60,
      padding:`${py}px ${px}px`,
      display:'flex', alignItems:'center',
    }}>
      <span style={{
        fontSize:14, fontWeight:600, color:'#92A0BC',     // ← Figma: 14 SemiBold #92A0BC
        lineHeight:1.5,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
      }}>{children}</span>
    </div>
  )
}

// ─── 테이블 본문 셀 ─────────────────────────────────────────────────────
function Td({ width, flex, pad = '10 14', children }:
  { width?: number; flex?: boolean; pad?: string; children: React.ReactNode }) {
  const [py, px] = pad.split(' ').map(Number)
  return (
    <div style={{
      ...(flex ? { flex:1, minWidth:0 } : { width, flexShrink:0 }),
      height:60,
      padding:`${py}px ${px}px`,
      display:'flex', alignItems:'center',
      overflow:'hidden',
    }}>{children}</div>
  )
}

// ─── 빈 상태 / 로딩 컨테이너 공통 스타일 ─────────────────────────────────
const emptyContainerStyle: React.CSSProperties = {
  flex:1, minHeight:306,                    // ← 426(전체) - 60(헤더) - 60(페이지네이션) = 306 (Empty 표시 영역)
  background:'#fff',
  display:'flex', alignItems:'center', justifyContent:'center',
}
