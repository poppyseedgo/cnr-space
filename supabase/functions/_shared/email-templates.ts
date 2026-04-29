// @ts-nocheck
/**
 * _shared/email-templates.ts
 * C&R Space 알림 시스템 — Outlook-first 이메일 템플릿 엔진
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 원칙
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Figma 디자인 기반 단색 시스템
 *    · 모든 이벤트 동일 디자인 (색상 구분 제거)
 *    · 블랙 / 화이트 / 연하늘색(#DFF3FF) 3가지 주요 색상만 사용
 *    · 이벤트별 구분은 제목(말머리 태그) + 헤더 라벨 + 본문 배너 텍스트로만
 *
 * 2. 완전 테이블 기반 레이아웃 (Outlook-first)
 *    · <div>는 텍스트 컨테이너로만 — 레이아웃은 반드시 <table>
 *    · Outlook은 flex/grid/inline-block 대부분 무시
 *    · width/height는 CSS와 HTML 속성 양쪽에 선언
 *
 * 3. 인라인 스타일 전용
 *    · <style> 태그 사용 안 함
 *    · 색상은 HEX만 (rgba는 Outlook 구버전 무시)
 *    · 폰트 스택: 'Malgun Gothic', 'Apple SD Gothic Neo', Arial, sans-serif
 *    · style="..." 안 font-family는 홑따옴표 (따옴표 충돌 방지)
 *
 * 4. MSO 조건부 분기
 *    · Outlook 전용: <!--[if mso]>...<![endif]-->
 *    · Outlook 제외: <!--[if !mso]><!-->...<!--<![endif]-->
 *    · VML 버튼으로 CTA 둥근 모서리 유지 (Outlook 전용)
 *
 * 5. 정책 기반 렌더링
 *    · notification-types.ts의 POLICIES를 단일 진실 원천으로 사용
 *    · 제목/헤더 라벨/배너/CTA는 정책에서 파생
 *    · 단 배경색/버튼색은 정책값 무시하고 단색 시스템 고정
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-18 P2 v1] 초기 생성
 *   · 14개 이벤트 × 3개 역할 = 42가지 조합을 단일 renderEmail 함수로 통합
 *   · Outlook 2019/365 호환성 최우선 (VML, MSO 조건부, 테이블 레이아웃)
 *
 * [2026-04-18 P2 v2] Figma 디자인 전면 반영
 *   · 컬러풀 헤더 제거 → 단색 화이트 배경
 *   · 회의 제목을 상/하 border로 구분 (0.5px solid black)
 *   · 인포 라벨: 한글 "날짜/시간/..." → 영문 대문자 "DATE/TIME/..."
 *   · 아바타: 26/20px 혼용 → 24px 통일 (검정 배경 + 흰색 텍스트)
 *   · 참석자 pill 배경(#EEF2FF) 제거 → 예약자와 동일한 단순 행
 *   · 참석자 여러 명 세로 나열 (기존 가로 칩 제거)
 *   · 배너: 이벤트별 5가지 색 → 단일 #DFF3FF 하늘색
 *   · CTA: 이벤트별 색상 → 단일 검정 고정
 *   · 관리자/참석자만 배지 표시, 예약자는 기본이라 생략
 *   · approved/rejected의 처리 관리자를 예약자 행 아래 "처리자" 행으로 추가
 *   · 반복 예약은 REPEAT 라벨 행으로 날짜 목록 모아보기
 *   · 거절 사유·강제 취소 사유를 메인 배너 내부에 통합 (별도 박스 금지)
 *   · 푸터 "문의: 총무팀" 한 줄 제거 → "자동발송" 문구만 유지
 *
 * [2026-04-18 P2 v3] 로고 이미지 적용
 *   · C&R SPACE 텍스트 → PNG 이미지로 교체 (Figma 원본 Pretendard Medium 재현)
 *   · 이미지 경로: {appUrl}/email-logo.png (Cloudflare Pages 정적 호스팅)
 *   · 이미지 차단 시 alt 텍스트에 Figma 스타일 폰트 적용 → 폴백 품질 유지
 *   · 원본 이미지: 618×88px (2x Retina), 표시 크기: 200×28px
 *
 * [2026-04-18 P2 v4] renderBanner 버그 수정 + 디자인 이슈 4종 수정
 *   · 문제 1 (P2 v4 배송2): 정책에 contextBanner가 없는 이벤트(cancelled/rejected 등)에서
 *     admin_force/reject_reason 동적 컨텐츠가 있어도 배너 전체가 스킵됨
 *   · 수정 1: parts 수집 완료 후에만 빈 여부 판단 → 동적 배너만 있어도 렌더됨
 *
 *   · 문제 2 (배송 4): 프로덕션 실 발송 테스트에서 발견된 4가지 버그
 *   · 수정 2-1: 로고 아래 여백 8px → 16px (Figma pb-[16px] 반영)
 *   · 수정 2-2: 거절 이메일 안내 배너와 거절 사유를 2개의 독립된 박스로 분리
 *     - 첫 박스: #DFF3FF 하늘색 (일반 안내)
 *     - 둘째 박스: #FFF1F1 연빨강 + #EF4444 빨강 텍스트 (거절 사유만)
 *     - 두 박스 사이 16px spacer row
 *     - "거절 사유는 본문에 표시됩니다." 문구 제거 (POLICIES.rejected.booker.title="")
 *   · 수정 2-3: 라벨 세로 깨짐 방지 — table-layout:fixed + min-width + white-space:nowrap
 *   · 수정 2-4: iOS Mail 날짜/시간 자동 링크화 차단 — format-detection meta + <a>/pointer-events:none 래핑
 *   · 수정 2-5 (보너스): 긴 부서명 줄바꿈 허용 — word-break:keep-all + white-space:nowrap 제거
 */

import { POLICIES, renderUrl, type NotificationType } from './notification-types.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 타입 정의
// ═══════════════════════════════════════════════════════════════════════════

export interface EmailBookingData {
  id:         string
  title:      string
  memo?:      string
  start_at:   string             // ISO with +09:00
  end_at:     string             // ISO with +09:00
  room_name:  string
  user_name:  string             // 예약자 이름 (fallback)
  user_dept:  string             // 예약자 부서 (fallback)
  admin_name?:    string
  admin_avatar?:  string | null
  admin_force?:   boolean
  cancel_reason?: string
  reject_reason?: string
  recur_label?:   string         // 반복 설명 (예: "매주 수요일 · 5회 반복")
}

export interface EmailCreatorInfo {
  email:      string
  name:       string
  dept:       string
  avatar_url: string | null
}

export interface EmailAttendee {
  email:      string
  name:       string
  dept?:      string
  avatar_url?: string | null
}

export interface EmailRenderInput {
  type:          NotificationType
  booking:       EmailBookingData
  role:          'booker' | 'attendee' | 'admin'
  recipientName: string
  creatorInfo:   EmailCreatorInfo | null
  attendeeList:  EmailAttendee[]
  recurBookings: { start_at: string; end_at: string }[]
  appUrl:        string
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 디자인 토큰 (Figma)
// ═══════════════════════════════════════════════════════════════════════════

// style="..." 내부 폰트명은 홑따옴표 (따옴표 충돌 방지)
const FONT = `'Malgun Gothic', 'Apple SD Gothic Neo', Arial, sans-serif`

const C = {
  TEXT:          '#111111',
  TEXT_SUB:      '#A1A1AA',       // 부제 (부서 등) — rgba(17,17,17,0.35) HEX 근사
  TEXT_FOOTER:   '#99A1AF',
  TEXT_INVERSE:  '#FFFFFF',
  BG_PAGE:       '#FFFFFF',
  BG_BANNER:     '#DFF3FF',       // 배지/배너 단일 색 (하늘색)
  BG_REJECT:     '#FFF1F1',       // 거절 사유 배너 배경 (연빨강) — Figma node 147:225
  TEXT_REJECT:   '#EF4444',       // 거절 사유 텍스트 (빨강)
  BG_BLACK:      '#000000',       // 아바타 + CTA 배경
  BORDER_THIN:   '#000000',       // 0.5px solid black
  AVATAR_TEXT:   '#E7E7E7',
}

const D = {
  WRAPPER_WIDTH: 568,
  PAGE_PADDING:  '24px',
  SECTION_GAP:   '24px',
  LOGO_PB:       '32px',
  ROW_PY:        '14px',
  LABEL_WIDTH:   100,
  AVATAR_SIZE:   24,
  CTA_PADDING:   '16px',
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 날짜/시간 포맷 유틸 (KST 기준)
// ═══════════════════════════════════════════════════════════════════════════

function fmtDate(ts: string): string {
  if (!ts) return ''
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const days = ['일','월','화','수','목','금','토']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}년 ${pad(kst.getUTCMonth()+1)}월 ${pad(kst.getUTCDate())}일 (${days[kst.getUTCDay()]})`
}

function fmtTime(ts: string | undefined | null): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return '—'
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const h   = kst.getUTCHours()
    const m   = String(kst.getUTCMinutes()).padStart(2, '0')
    const period = h < 12 ? '오전' : '오후'
    const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${period} ${hour}:${m}`
  } catch {
    return '—'
  }
}

function escapeHtml(s: string): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 아바타 & 사용자 행 (Figma 디자인 통일)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 아바타 원형 — Figma: 24px 검정 배경 + 흰색 이니셜
 * Outlook은 border-radius 무시 → 검정 정사각으로 폴백 (의도된 동작)
 */
function renderAvatar(name: string, avatarUrl: string | null | undefined): string {
  const initial = escapeHtml((name ?? '?')[0] ?? '?')
  const size = D.AVATAR_SIZE

  if (avatarUrl && avatarUrl.startsWith('https://')) {
    return `<img src="${escapeHtml(avatarUrl)}" width="${size}" height="${size}" alt="" ` +
           `style="width:${size}px;height:${size}px;border-radius:1000px;display:block;border:0;" />`
  }

  // 이니셜 폴백: 검정 원형 + 밝은 회색 이니셜
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
         `width="${size}" height="${size}" ` +
         `style="width:${size}px;height:${size}px;background:${C.BG_BLACK};border-radius:1000px;">` +
         `<tr><td align="center" valign="middle" ` +
         `style="width:${size}px;height:${size}px;text-align:center;vertical-align:middle;` +
         `color:${C.AVATAR_TEXT};font-family:${FONT};font-size:12px;font-weight:500;line-height:1.3;">` +
         `${initial}</td></tr></table>`
}

/**
 * 사용자 한 명 행 (예약자/참석자/처리자 공통)
 * [아바타] 이름 부서(회색)
 * · suffix는 처리자용 "(승인)" / "(거절)" 같은 말미 텍스트
 *
 * ← [2026-04-18 P2 v4] 긴 영문 부서명 줄바꿈 허용
 *   · 문제: "Clinical Platform Research Institute" 같은 긴 부서명이 모바일 너비 초과
 *   · 원인: 값 <td>에 white-space:nowrap이 있어 줄바꿈 안 됨
 *   · 해결: nowrap 제거 + word-break:keep-all (한글 어절/영문 단어 단위로 자연 줄바꿈)
 */
function renderUserRow(
  name: string,
  dept: string,
  avatarUrl: string | null | undefined,
  suffix?: string,
): string {
  const nameEsc   = escapeHtml(name)
  const deptEsc   = escapeHtml(dept)
  const suffixEsc = suffix ? escapeHtml(suffix) : ''

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;vertical-align:middle;">` +
    `<tr>` +
      `<td style="vertical-align:middle;padding-right:7px;white-space:nowrap;">${renderAvatar(name, avatarUrl)}</td>` +
      `<td style="vertical-align:middle;font-family:${FONT};font-size:14px;font-weight:500;line-height:1.3;word-break:keep-all;">` +
        `<span style="color:${C.TEXT};white-space:nowrap;">${nameEsc}</span>` +
        (deptEsc ? `&nbsp;<span style="color:${C.TEXT_SUB};">${deptEsc}</span>` : '') +
        (suffixEsc ? `&nbsp;<span style="color:${C.TEXT_SUB};white-space:nowrap;">${suffixEsc}</span>` : '') +
      `</td>` +
    `</tr></table>`
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 섹션 렌더러
// ═══════════════════════════════════════════════════════════════════════════

/** 배지 (Figma: #DFF3FF 배경, 12px Medium) */
function renderBadge(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;background:${C.BG_BANNER};border-radius:4px;">` +
    `<tr><td style="padding:4px 8px;font-family:${FONT};font-size:12px;font-weight:500;color:${C.TEXT};line-height:1.3;">${escapeHtml(text)}</td></tr>` +
  `</table>`
}

/**
 * 로고 섹션
 * · C&R SPACE 로고 (PNG 이미지, {appUrl}/email-logo.png)
 *   · 표시 크기: 200×28px (Figma 원본 기준)
 *   · 실제 이미지: 618×88px (2x Retina 대응)
 *   · alt 텍스트에 큰 폰트 스타일 적용 → 이미지 차단 환경에서도 "C&R SPACE" 표시
 * · 이벤트 라벨 (16px Medium)
 * · 역할 배지 (관리자/참석자만 — 예약자는 기본이라 생략)
 */
function renderLogoSection(input: EmailRenderInput): string {
  const policy = POLICIES[input.type]
  const isRecur = input.recurBookings.length > 1

  // 반복 예약 시 라벨 변경
  let headerLabel = policy.headerLabel
  if (isRecur && input.type === 'created') {
    headerLabel = `반복 예약 ${input.recurBookings.length}건이 확정되었습니다`
  } else if (isRecur && input.type === 'pending') {
    headerLabel = `반복 예약 ${input.recurBookings.length}건 승인 요청`
  }

  let badge = ''
  if (input.role === 'admin') {
    badge = renderBadge('관리자 수신 알림')
  } else if (input.role === 'attendee') {
    badge = renderBadge('참석자 수신 알림')
  }

  // 로고 이미지 (Figma Pretendard Medium 30px 재현)
  //   · 이미지 URL: {appUrl}/email-logo.png (Cloudflare Pages 정적 호스팅)
  //   · alt: 이미지 차단 시 폴백용 (큰 폰트 스타일 적용 금지 — 로드 후에도 alt 렌더하는 일부 클라이언트에서 중복 표시됨)
  //   · display:block + border:0 — Outlook의 기본 border + inline-block 이슈 방지
  const logoUrl = `${input.appUrl}/email-logo.png`
  const logoHtml =
    `<img src="${escapeHtml(logoUrl)}" width="200" height="28" alt="C&amp;R SPACE" ` +
    `style="display:block;border:0;width:200px;height:auto;max-width:200px;" />`

  return `<tr><td style="padding-bottom:${D.LOGO_PB};">` +
    `<div style="margin:0 0 16px;">${logoHtml}</div>` +
    // ← [2026-04-18 P2 v4] 로고 아래 여백 8px → 16px (Figma 디자인 pb-[16px] 반영)
    `<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;font-weight:500;line-height:1.4;color:${C.TEXT};">${escapeHtml(headerLabel).replace(/\n/g, '<br>')}</p>` +
    badge +
  `</td></tr>`
}

/**
 * 제목 섹션 — 상/하 0.5px 검정 border로 구분
 * · 회의 제목 (19px Bold uppercase)
 * · 회의실 (14px Regular)
 */
function renderTitleSection(input: EmailRenderInput): string {
  const policy = POLICIES[input.type]
  const titleEsc = escapeHtml(input.booking.title)
  const roomEsc  = escapeHtml(input.booking.room_name ?? '')
  const strikethrough = policy.isCancelledStyle ? 'text-decoration:line-through;' : ''

  return `<tr><td style="padding:24px 0;border-top:0.5px solid ${C.BORDER_THIN};border-bottom:0.5px solid ${C.BORDER_THIN};">` +
    `<p style="margin:0 0 4px;font-family:${FONT};font-size:19px;font-weight:700;line-height:1.4;color:${C.TEXT};text-transform:uppercase;${strikethrough}">${titleEsc}</p>` +
    (roomEsc ? `<p style="margin:0;font-family:${FONT};font-size:14px;font-weight:400;line-height:1.3;color:${C.TEXT};letter-spacing:0.07px;">${roomEsc}</p>` : '') +
  `</td></tr>`
}

/**
 * 인포 카드 행 (공통)
 * · 라벨: 영문 대문자 12px Bold tracking 1px (왼쪽 100px 고정)
 * · 값:   14px Medium
 *
 * ← [2026-04-18 P2 v4] 라벨 세로 깨짐 방지
 *   · 문제: Apple Mail iOS에서 "예약자" 라벨이 세로로 쌓임 (예/약/자)
 *   · 원인: 좁은 뷰포트에서 width:100px가 무시되면서 라벨 <td>가 squeeze됨
 *   · 해결: 라벨 <td>에 white-space:nowrap + min-width 추가
 *            inner table에 table-layout:fixed 추가 (컬럼 폭 강제 유지)
 */
function renderInfoRow(label: string, valueHtml: string, options?: { nowrap?: boolean }): string {
  const labelEsc = escapeHtml(label)
  const nowrap   = options?.nowrap ? 'white-space:nowrap;' : ''

  return `<tr><td style="padding:${D.ROW_PY} 0;vertical-align:top;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>` +
      `<td width="${D.LABEL_WIDTH}" style="width:${D.LABEL_WIDTH}px;min-width:${D.LABEL_WIDTH}px;white-space:nowrap;vertical-align:top;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;color:${C.TEXT};line-height:1.3;padding-top:2px;">${labelEsc}</td>` +
      `<td style="vertical-align:top;font-family:${FONT};font-size:14px;font-weight:500;color:${C.TEXT};line-height:1.3;word-break:keep-all;${nowrap}">${valueHtml}</td>` +
    `</tr></table>` +
  `</td></tr>`
}

/**
 * 본문 정보 카드 (인포 섹션 전체)
 */
function renderInfoCard(input: EmailRenderInput): string {
  const isRecur = input.recurBookings.length > 1

  const creatorName   = input.creatorInfo?.name       ?? input.booking.user_name ?? ''
  const creatorDept   = input.creatorInfo?.dept       ?? input.booking.user_dept ?? ''
  const creatorAvatar = input.creatorInfo?.avatar_url ?? null

  const rows: string[] = []

  // DATE
  // ← [P2 v4] iOS Mail 자동 링크화 방지용 <a> 래핑 (color 강제 + pointer-events 차단)
  //   단순 format-detection meta만으론 일부 iOS 버전에서 여전히 링크 생성됨 → <a>로 가둬 스타일 오버라이드
  const dateStr = escapeHtml(fmtDate(input.booking.start_at))
  const dateValue = `<a href="#" style="color:${C.TEXT};text-decoration:none;pointer-events:none;cursor:default;">${dateStr}</a>`
  rows.push(renderInfoRow('DATE', dateValue, { nowrap: true }))

  // TIME
  const timeStartStr = escapeHtml(fmtTime(input.booking.start_at))
  const timeEndStr   = escapeHtml(fmtTime(input.booking.end_at))
  const timeValue = `<a href="#" style="color:${C.TEXT};text-decoration:none;pointer-events:none;cursor:default;">${timeStartStr} - ${timeEndStr}</a>`
  rows.push(renderInfoRow('TIME', timeValue, { nowrap: true }))

  // REPEAT (반복 예약 시)
  if (isRecur) {
    const recurSummary = input.booking.recur_label
      ? `<div style="margin-bottom:6px;">${escapeHtml(input.booking.recur_label)}</div>`
      : `<div style="margin-bottom:6px;">총 ${input.recurBookings.length}회 반복</div>`
    // ← [P2 v4] 반복 날짜 목록도 동일하게 자동 링크 방지
    const recurList = input.recurBookings.map(b =>
      `<div style="margin-top:2px;color:${C.TEXT_SUB};font-size:13px;line-height:1.5;">` +
        `<a href="#" style="color:${C.TEXT_SUB};text-decoration:none;pointer-events:none;cursor:default;">${escapeHtml(fmtDate(b.start_at))}</a>` +
      `</div>`
    ).join('')
    rows.push(renderInfoRow('REPEAT', recurSummary + recurList))
  }

  // ROOM
  rows.push(renderInfoRow('ROOM', escapeHtml(input.booking.room_name ?? ''), { nowrap: true }))

  // MEMO (있는 경우만)
  if (input.booking.memo) {
    const memoHtml = escapeHtml(input.booking.memo).replace(/\n/g, '<br>')
    rows.push(renderInfoRow('MEMO', `<span style="line-height:1.5;">${memoHtml}</span>`))
  }

  // 예약자
  rows.push(renderInfoRow('예약자', renderUserRow(creatorName, creatorDept, creatorAvatar)))

  // 참석자 (세로 나열)
  if (input.attendeeList.length > 0) {
    const attendeeRows = input.attendeeList
      .map((a, i) => {
        const mt = i === 0 ? '0' : '10px'
        return `<div style="margin-top:${mt};">${renderUserRow(a.name, a.dept ?? '', a.avatar_url)}</div>`
      })
      .join('')
    rows.push(renderInfoRow('참석자', attendeeRows))
  }

  // 처리자 (approved/rejected + admin_name 있을 때)
  if ((input.type === 'approved' || input.type === 'rejected') && input.booking.admin_name) {
    const suffix = input.type === 'approved' ? '(승인)' : '(거절)'
    rows.push(renderInfoRow('처리자', renderUserRow(input.booking.admin_name, '', input.booking.admin_avatar, suffix)))
  }

  return `<tr><td style="padding:${D.SECTION_GAP} 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>` +
  `</td></tr>`
}

/**
 * 배너 섹션
 *
 * 렌더 규칙:
 *   1. 정책 메인 배너 (있으면)              — #DFF3FF 하늘색
 *   2. 동적 통합: cancelled + admin_force    — 같은 하늘색 배너 안에 추가
 *   3. 동적 분리: rejected + reject_reason   — 별도 빨간 배너(#FFF1F1) 하나 더
 *   · 정책 배너와 거절 배너는 16px 간격으로 세로 나열
 *
 * ← [2026-04-18 P2 v4]
 *   · 거절 사유 렌더링을 별도 박스로 분리 (Figma node 147:225 디자인 반영)
 *   · 색상: #FFF1F1 배경 + #EF4444 빨강 텍스트
 *   · 구조: 첫 배너(안내)와 두 번째 배너(거절 사유) 사이 16px gap
 */
function renderBanner(input: EmailRenderInput): string {
  const policy = POLICIES[input.type]
  const banners: string[] = []   // 각 요소가 하나의 <table> 블록(배너 박스)

  // ─── 1. 정책 기반 메인 배너 (#DFF3FF) ────────────────────────────
  const bannerKey = input.role === 'booker' ? 'booker' : input.role === 'attendee' ? 'attendee' : 'admin'
  const b = policy.contextBanner?.[bannerKey]

  const mainParts: string[] = []
  if (b) {
    // title이 비어있지 않을 때만 렌더 (rejected.booker의 경우 title 없음)
    // ← [2026-04-29] \n → <br> 변환 지원 (checkin_warning_5 헤더 등 다행 문구)
    if (b.title) {
      mainParts.push(
        `<p style="margin:0;font-family:${FONT};font-size:12px;font-weight:600;line-height:1.4;color:${C.TEXT};">${escapeHtml(b.title).replace(/\n/g, '<br>')}</p>`
      )
    }
    if (b.body) {
      // ← [2026-04-29] \n → <br> 변환 지원
      let bodyHtml = escapeHtml(b.body).replace(/\n/g, '<br>')
      // ← [2026-04-29] {NOSHOW_TIME} 플레이스홀더 치환 — checkin_start: start_at+10분 자동 계산
      //   정책 body에 {NOSHOW_TIME} 포함 시 예약 시작시각 기준 +10분 포맷 시간으로 치환
      if (bodyHtml.includes('{NOSHOW_TIME}') && input.booking.start_at) {
        const noshowMs = new Date(input.booking.start_at).getTime() + 10 * 60 * 1000
        const noshowTime = escapeHtml(fmtTime(new Date(noshowMs).toISOString()))
        bodyHtml = bodyHtml.replace('{NOSHOW_TIME}', noshowTime)
      }
      mainParts.push(
        `<p style="margin:${mainParts.length > 0 ? '4px' : '0'} 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT};">${bodyHtml}</p>`
      )
    }
  }

  // 동적 통합 — cancelled + admin_force (메인 배너와 같은 #DFF3FF 박스에 추가)
  if (input.type === 'cancelled' && input.booking.admin_force) {
    const topMargin = mainParts.length > 0 ? '12px' : '0'
    mainParts.push(
      `<p style="margin:${topMargin} 0 0;font-family:${FONT};font-size:12px;font-weight:600;line-height:1.4;color:${C.TEXT};">관리자에 의해 강제 취소된 예약입니다.</p>`
    )
    if (input.booking.cancel_reason) {
      mainParts.push(
        `<p style="margin:4px 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT};">취소 사유: ${escapeHtml(input.booking.cancel_reason)}</p>`
      )
    }
  }

  // 메인 배너가 내용이 있으면 박스로 감쌈
  if (mainParts.length > 0) {
    banners.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.BG_BANNER};border-radius:16px;">` +
        `<tr><td style="padding:16px;">${mainParts.join('')}</td></tr>` +
      `</table>`
    )
  }

  // ─── 2. 거절 사유 전용 배너 (#FFF1F1, 빨강 텍스트) ────────────────
  //       Figma node 147:225 디자인: 메인 배너와 분리된 별도 박스
  if (input.type === 'rejected' && input.booking.reject_reason) {
    banners.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.BG_REJECT};border-radius:16px;">` +
        `<tr><td style="padding:16px;">` +
          `<p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;line-height:1.4;color:${C.TEXT_REJECT};">거절 사유</p>` +
          `<p style="margin:4px 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT_REJECT};">${escapeHtml(input.booking.reject_reason)}</p>` +
        `</td></tr>` +
      `</table>`
    )
  }

  // 아무 배너도 없으면 빈 렌더
  if (banners.length === 0) return ''

  // 배너들을 <tr><td>로 묶어 세로 나열. 배너 간 16px 간격은 tr 사이에 spacer tr로 구현
  //   (Outlook은 tr에 margin-bottom을 지원 안 함 — spacer row 패턴이 가장 안전)
  const rows = banners.map((banner, idx) => {
    const spacer = idx > 0
      ? `<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>`
      : ''
    return spacer + `<tr><td>${banner}</td></tr>`
  }).join('')

  return rows
}

/**
 * CTA 버튼 (Figma: 검정 배경, 12px rounded, 그림자)
 */
function renderCTA(input: EmailRenderInput): string {
  const policy = POLICIES[input.type]
  if (!policy.cta) return ''

  const ctaKey = input.role === 'booker' ? 'booker' : input.role === 'attendee' ? 'attendee' : 'admin'
  const cta = policy.cta[ctaKey]
  if (!cta) return ''

  const url    = renderUrl(cta.urlTemplate, { APP_URL: input.appUrl, BOOKING_ID: input.booking.id })
  const urlEsc = escapeHtml(url)
  const label  = escapeHtml(cta.label)

  const bgColor = C.BG_BLACK  // Figma 디자인: 검정 고정
  const btnHeight = 54

  const msoButton =
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
      `href="${urlEsc}" style="height:${btnHeight}px;v-text-anchor:middle;width:100%;" arcsize="22%" stroke="f" fillcolor="${bgColor}">` +
      `<w:anchorlock/>` +
      `<center style="color:${C.TEXT_INVERSE};font-family:${FONT};font-size:14px;font-weight:700;">${label}</center>` +
    `</v:roundrect>` +
    `<![endif]-->`

  const standardButton =
    `<!--[if !mso]><!-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bgColor};border-radius:12px;box-shadow:0 4px 20px rgba(70,70,70,0.2);">` +
      `<tr><td align="center" style="padding:${D.CTA_PADDING};">` +
        `<a href="${urlEsc}" target="_blank" style="display:block;color:${C.TEXT_INVERSE};text-decoration:none;font-family:${FONT};font-size:14px;font-weight:700;line-height:1.2;">${label}</a>` +
      `</td></tr>` +
    `</table>` +
    `<!--<![endif]-->`

  return `<tr><td>` +
    msoButton +
    standardButton +
  `</td></tr>`
}

/**
 * 푸터 (Figma: "이 메일은 C&R SPACE에서 자동발송 된 이메일 입니다.")
 */
function renderFooter(): string {
  return `<tr><td style="padding:${D.SECTION_GAP} 30px;text-align:center;">` +
    `<p style="margin:0;font-family:${FONT};font-size:11px;font-weight:400;line-height:1.45;color:${C.TEXT_FOOTER};text-align:center;">` +
      `이 메일은 C&amp;R SPACE에서 자동발송 된 이메일 입니다.` +
    `</p>` +
  `</td></tr>`
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 메인 진입점 — renderEmail
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이메일 HTML 전체 렌더링 (Figma 디자인 + Outlook-first)
 *
 * @param input  이벤트 타입 + 예약 데이터 + 수신자 역할 + 부가 컨텍스트
 * @returns      완전한 <!DOCTYPE ...>...</html> 문자열
 */
export function renderEmail(input: EmailRenderInput): string {
  const logoSection  = renderLogoSection(input)
  const titleSection = renderTitleSection(input)
  const infoCard     = renderInfoCard(input)
  const banner       = renderBanner(input)
  const cta          = renderCTA(input)
  const footer       = renderFooter()

  // 섹션 간 spacer (배너/CTA 유무에 따라 조건부)
  const hasBanner = banner !== ''
  const hasCTA    = cta !== ''
  const bannerGap = hasBanner ? `<tr><td style="height:${D.SECTION_GAP};line-height:${D.SECTION_GAP};font-size:0;">&nbsp;</td></tr>` : ''
  const ctaGap    = hasCTA    ? `<tr><td style="height:${D.SECTION_GAP};line-height:${D.SECTION_GAP};font-size:0;">&nbsp;</td></tr>` : ''

  return `<!DOCTYPE html>
<html lang="ko" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <!-- ← [2026-04-18 P2 v4] iOS Mail의 날짜/시간/주소 자동 링크화 차단 (파란 밑줄 방지) -->
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <title>C&amp;R SPACE</title>
</head>
<body style="margin:0;padding:0;background:${C.BG_PAGE};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.BG_PAGE};">
    <tr><td align="center" style="padding:${D.PAGE_PADDING};">
      <!--[if mso]>
      <table role="presentation" width="${D.WRAPPER_WIDTH}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
      <![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${D.WRAPPER_WIDTH}px;width:100%;background:${C.BG_PAGE};">
        ${logoSection}
        ${titleSection}
        ${infoCard}
        ${banner}
        ${bannerGap}
        ${cta}
        ${ctaGap}
        ${footer}
      </table>
      <!--[if mso]>
      </td></tr></table>
      <![endif]-->
    </td></tr>
  </table>
</body>
</html>`
}
