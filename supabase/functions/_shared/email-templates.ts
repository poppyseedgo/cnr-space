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
 * [2026-04-18 P2 v4] renderBanner 버그 수정 (배송 2 통합 테스트에서 발견)
 *   · 문제: 정책에 contextBanner가 없는 이벤트(cancelled/rejected 등)에서
 *     admin_force/reject_reason 동적 컨텐츠가 있어도 배너 전체가 스킵됨
 *   · 수정: parts 수집 완료 후에만 빈 여부 판단 → 동적 배너만 있어도 렌더됨
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
  BG_BANNER:     '#DFF3FF',       // 배지/배너 단일 색
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
      `<td style="vertical-align:middle;padding-right:7px;">${renderAvatar(name, avatarUrl)}</td>` +
      `<td style="vertical-align:middle;font-family:${FONT};font-size:14px;font-weight:500;line-height:1.3;white-space:nowrap;">` +
        `<span style="color:${C.TEXT};">${nameEsc}</span>` +
        (deptEsc ? `&nbsp;<span style="color:${C.TEXT_SUB};">${deptEsc}</span>` : '') +
        (suffixEsc ? `&nbsp;<span style="color:${C.TEXT_SUB};">${suffixEsc}</span>` : '') +
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
    `<div style="margin:0 0 8px;">${logoHtml}</div>` +
    `<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;font-weight:500;line-height:1.4;color:${C.TEXT};">${escapeHtml(headerLabel)}</p>` +
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
 */
function renderInfoRow(label: string, valueHtml: string, options?: { nowrap?: boolean }): string {
  const labelEsc = escapeHtml(label)
  const nowrap   = options?.nowrap ? 'white-space:nowrap;' : ''

  return `<tr><td style="padding:${D.ROW_PY} 0;vertical-align:top;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="${D.LABEL_WIDTH}" style="width:${D.LABEL_WIDTH}px;vertical-align:top;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;color:${C.TEXT};line-height:1.3;padding-top:2px;">${labelEsc}</td>` +
      `<td style="vertical-align:top;font-family:${FONT};font-size:14px;font-weight:500;color:${C.TEXT};line-height:1.3;${nowrap}">${valueHtml}</td>` +
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
  rows.push(renderInfoRow('DATE', escapeHtml(fmtDate(input.booking.start_at)), { nowrap: true }))

  // TIME
  const timeValue = `${escapeHtml(fmtTime(input.booking.start_at))} - ${escapeHtml(fmtTime(input.booking.end_at))}`
  rows.push(renderInfoRow('TIME', timeValue, { nowrap: true }))

  // REPEAT (반복 예약 시)
  if (isRecur) {
    const recurSummary = input.booking.recur_label
      ? `<div style="margin-bottom:6px;">${escapeHtml(input.booking.recur_label)}</div>`
      : `<div style="margin-bottom:6px;">총 ${input.recurBookings.length}회 반복</div>`
    const recurList = input.recurBookings.map(b =>
      `<div style="margin-top:2px;color:${C.TEXT_SUB};font-size:13px;line-height:1.5;">${escapeHtml(fmtDate(b.start_at))}</div>`
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
 * 배너 — Figma: #DFF3FF 단일 배경, rounded-16px
 * · 정책 기반 메인 메시지 (있으면 표시)
 * · 거절 사유/강제 취소 사유가 있으면 같은 박스 내부에 통합
 *
 * ← [2026-04-18 P2 버그 수정] 기존: 정책 배너 없으면 early return → 동적 배너도 스킵됨.
 *    이제 parts를 모두 수집한 후 비었을 때만 반환. 동적 배너만 있어도 렌더됨.
 */
function renderBanner(input: EmailRenderInput): string {
  const policy = POLICIES[input.type]
  const parts: string[] = []

  // 1. 정책 기반 메인 배너 (있으면)
  const bannerKey = input.role === 'booker' ? 'booker' : input.role === 'attendee' ? 'attendee' : 'admin'
  const b = policy.contextBanner?.[bannerKey]
  if (b) {
    parts.push(
      `<p style="margin:0;font-family:${FONT};font-size:12px;font-weight:600;line-height:1.4;color:${C.TEXT};">${escapeHtml(b.title)}</p>`
    )
    if (b.body) {
      parts.push(
        `<p style="margin:4px 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT};">${escapeHtml(b.body)}</p>`
      )
    }
  }

  // 2. 동적 통합 — cancelled + admin_force
  //    ← [버그 수정] 정책 배너 유무와 무관하게 렌더되도록 if (b) 블록 밖에서 처리
  if (input.type === 'cancelled' && input.booking.admin_force) {
    // 기존 parts가 있으면 간격(12px), 없으면 첫 항목이니 간격 없음
    const topMargin = parts.length > 0 ? '12px' : '0'
    parts.push(
      `<p style="margin:${topMargin} 0 0;font-family:${FONT};font-size:12px;font-weight:600;line-height:1.4;color:${C.TEXT};">관리자에 의해 강제 취소된 예약입니다.</p>`
    )
    if (input.booking.cancel_reason) {
      parts.push(
        `<p style="margin:4px 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT};">취소 사유: ${escapeHtml(input.booking.cancel_reason)}</p>`
      )
    }
  }

  // 3. 동적 통합 — rejected + reject_reason
  //    ← [버그 수정] 정책 배너 유무와 무관하게 렌더
  if (input.type === 'rejected' && input.booking.reject_reason) {
    const topMargin = parts.length > 0 ? '12px' : '0'
    parts.push(
      `<p style="margin:${topMargin} 0 0;font-family:${FONT};font-size:12px;font-weight:600;line-height:1.4;color:${C.TEXT};">거절 사유</p>` +
      `<p style="margin:4px 0 0;font-family:${FONT};font-size:12px;font-weight:500;line-height:1.4;color:${C.TEXT};">${escapeHtml(input.booking.reject_reason)}</p>`
    )
  }

  // 4. 수집된 parts가 비었으면 배너 자체 렌더 안 함
  if (parts.length === 0) return ''

  return `<tr><td>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.BG_BANNER};border-radius:16px;">` +
      `<tr><td style="padding:16px;">${parts.join('')}</td></tr>` +
    `</table>` +
  `</td></tr>`
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
