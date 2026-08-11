// @ts-nocheck
/**
 * send-notification Edge Function
 * C&R Space 알림 시스템 — 이메일 + 인앱 + Teams 통합 발송 진입점
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2026-08-10 v2 재구성] 유실 모듈 통합 + 8/5 사양 + 노쇼 제재 2타입
 *   · 배경: 로컬 유일본이던 email-templates.ts / notification-inapp.ts 유실
 *     (0810PM12 zip 부재) — 이 구버전 index.ts(2026-07-27 세대, 라이브 배포본)를
 *     베이스로 두 모듈의 역할을 본 파일에 내장해 의존을 제거했다.
 *       - renderEmail  → §4 generic 렌더 (POLICIES 정책 필드 기반, 타입별 HTML
 *         하드코딩 금지. 예외 = rejected 사유·cancelled 강제 사유·제재 제한기간)
 *       - insertInAppBulk/buildInAppBody → §5 내장 (도서·제재 분기 포함)
 *   · [20260728] 채널 게이트 loadChannelFlags(type) — teams/email/inapp 3곳.
 *     미설정=켜짐(fail-open). 이메일은 본문 조립까지 진행하고 발송만 생략
 *     (조립 결함을 설정으로 가리면 다시 켤 때 드러나는 문제 방지).
 *   · [20260728] resolveRecipients 에 notificationType 전달 — 지정 수신자 명단
 *     우선 적용 (미전달이 8/5 '비도서 관리자 오발송'의 원인이었다).
 *   · [20260741] notification_logs 기록 — 행 = 수신자1×채널1, sent/failed/skipped,
 *     이메일·이름 스냅샷. writeLogs 는 예외를 삼킨다(기록은 부가 기능, 발송 불가침).
 *   · [20260745] 노쇼 이용 제재 2타입 (noshow_penalty_applied/cleared) —
 *     인앱 본문 분기 + 이메일 '제한 기간' 라인. payload *_kst 는 서버 완성
 *     문자열이라 재변환 금지 (타임존 이중 적용 하루 밀림 교훈).
 *   · 응답 계약 유지 {success,type,emailSent,emailFailed,rateLimited,results}
 *     + channels 추가 (auto-cancel P3 v2 의 boolean 판정과 호환 — 키 추가는 무해)
 *
 * [2026-06-12] 예약자(소유권) 변경 알림 2종 지원 (owner_changed / former_booker)
 *   · resolveRecipients 호출에 formerBookerUserId 전달
 *   · buildEmailItems: formerBooker 수신자 이메일 렌더 분기(role='booker') 추가
 *   · sendInAppForAllRoles: formerBooker 인앱 발송(role='booker') 추가
 *   · Teams colorMap/titleMap/teamsTargetTypes에 owner_changed 추가 (former_booker는 Teams 제외)
 *
 * [2025-04-13] 초기 버전
 *   1. pending 타입 — profiles 테이블에서 admin 이메일 직접 조회 (프론트 의존 제거)
 *   2. user_email 누락 시 user_id → profiles 자동 조회
 *   3. FROM_EMAIL 환경변수화 (커스텀 도메인 지원)
 *   4. APP_URL 기본값 cnr-space.pages.dev로 수정
 *
 * [2026-04-18 P2] 전면 리팩토링 — 781줄 → ~280줄 (64% 축소)
 *   · 5개 _shared 공용 헬퍼로 로직 분리:
 *       - notification-types.ts  : 14개 이벤트 정책
 *       - email-templates.ts     : Figma 기반 HTML 렌더링
 *       - email-sender.ts        : Resend Batch API + 재시도
 *       - notification-inapp.ts  : 인앱 알림 INSERT
 *       - recipient-resolver.ts  : 수신자 통합 조회
 *   · 이벤트별 분기(6개) → 정책 기반 단일 로직으로 통합
 *   · Resend rate_limit 근본 해결: 수신자 N명 → Batch 1회 호출
 *   · 인앱 알림 발송 로직 추가 (기존엔 일부만 프론트에서 처리)
 *   · Teams Adaptive Card 발송은 그대로 유지
 *   · 제목 포맷 변경: "[C&R SPACE] ✅ 예약 확정 — ..." → "[예약확정]  ..."
 *     (notification-types.getSubject() 참조)
 *
 * [2026-05-12] APP_URL fallback 운영 도메인으로 변경
 *   · cnr-space.pages.dev (Cloudflare Pages 기본 도메인) → space.cnrres.com (운영)
 *   · 환경변수 APP_URL이 설정된 경우 그쪽이 우선 (fallback은 안전망)
 *   · 영향 범위: 모든 메일 CTA 버튼 URL, appUrl로 전달되는 모든 링크
 *   · 배포 동기화: supabase secrets set APP_URL=https://space.cnrres.com 권장
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙 (CRITICAL — 위반 시 401 발생)
 * ═══════════════════════════════════════════════════════════════════════════
 *   · 반드시 --no-verify-jwt 플래그로 배포 (아래 "배포 방법" 참조)
 *   · Edge Function → Edge Function HTTP 호출은 ANON_KEY Bearer (SERVICE_KEY X)
 *   · 이 파일 자체는 외부/프론트에서 직접 호출되므로 JWT 검증 없음이 맞음
 *
 * 배포 방법:
 *   supabase functions deploy send-notification --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  POLICIES,
  getSubject,
  renderUrl,                       // ← [2026-08-10 v2] CTA URL 템플릿 치환 (기존 export 활용)
  type NotificationType,
  type RecipientRule,
} from '../_shared/notification-types.ts'
import { purposeText } from '../_shared/booking-purpose.ts'  // ← [2026-07-27 목적 Phase 4] Teams facts 목적 표기
// ← [2026-08-10 v2] email-templates.ts / notification-inapp.ts import 제거 —
//   두 모듈 유실로 본 파일 §4(generic 렌더)·§5(인앱)에 내장. 타입도 아래 로컬 정의.
import {
  sendEmails,
  type EmailItem,
} from '../_shared/email-sender.ts'
import {
  resolveRecipients,
  type Person,
  type ResolvedRecipients,
} from '../_shared/recipient-resolver.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 환경변수
// ═══════════════════════════════════════════════════════════════════════════

// ← [2026-05-12] APP_URL fallback 변경: cnr-space.pages.dev → space.cnrres.com (운영 도메인)
//   배경: 메일 링크 클릭 시 Cloudflare Pages 기본 도메인(cnr-space.pages.dev)으로 연결되어
//         사용자가 어색한 URL을 보게 됨. 운영 커스텀 도메인 space.cnrres.com 으로 통일.
//   환경변수 APP_URL이 설정되어 있으면 그쪽이 우선 — Secrets에도 동일 값 설정 권장.
//   배포 후 다음 명령으로 Secrets 동기화:
//     supabase secrets set APP_URL=https://space.cnrres.com
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://space.cnrres.com'
const TEAMS_WEBHOOK_URL = Deno.env.get('TEAMS_WEBHOOK_URL') ?? ''

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Supabase client (Service Role Key — profiles/booking_attendees/notifications 조작 권한 필요)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ═══════════════════════════════════════════════════════════════════════════
// 1-b. 로컬 타입 (← [2026-08-10 v2] 유실 모듈의 인터페이스를 본 파일에 정의)
// ═══════════════════════════════════════════════════════════════════════════

interface EmailAttendee { email: string; name: string; dept?: string; avatar_url?: string }
interface EmailCreatorInfo { email: string; name: string; dept?: string; avatar_url?: string }
interface EmailBookingData {
  id: string; title: string; memo?: string
  start_at?: string; end_at?: string; room_name?: string
  user_name?: string; user_dept?: string
  admin_name?: string; admin_avatar?: string; admin_force?: boolean
  cancel_reason?: string; reject_reason?: string; recur_label?: string
  purpose?: string; purpose_detail?: string
  book_title?: string; due_date_kst?: string; days_overdue?: number; checkout_date_kst?: string
  // ← [2026-08-10 v2] 노쇼 이용 제재 (20260745) — 서버 완성 KST 문자열, 재변환 금지
  noshow_count?: number; penalty_starts_kst?: string; penalty_ends_kst?: string
}
type InAppBookingData = EmailBookingData

// ═══════════════════════════════════════════════════════════════════════════
// 1-c. KST 포맷 (← [2026-08-10 v2])
//   cron 은 UTC ISO, 프론트는 +09:00 문자열을 보낸다 — slice(11,16) 방식은
//   UTC 입력에서 9시간 어긋난다. Intl(Asia/Seoul) 로만 변환한다.
//   payload 의 *_kst 필드는 이미 KST 완성 문자열이므로 이 함수를 태우지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

const KST_DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const KST_TIME = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
const KST_DAY  = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' })

function kstDate(iso?: string): string {          // '2026-08-16'
  if (!iso) return '-'
  const d = new Date(iso); if (isNaN(d.getTime())) return '-'
  const parts = KST_DATE.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function kstTime(iso?: string): string {          // '14:30'
  if (!iso) return '-'
  const d = new Date(iso); if (isNaN(d.getTime())) return '-'
  return KST_TIME.format(d)
}
function kstDateWithDay(iso?: string): string {   // '2026-08-16 (일)'
  if (!iso) return '-'
  const d = new Date(iso); if (isNaN(d.getTime())) return '-'
  return `${kstDate(iso)} (${KST_DAY.format(d)})`
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-d. 채널 게이트 (← [2026-08-10 v2, 20260728 사양])
//   규칙 ①: 미설정 = 켜짐 (fail-open). 조회 실패해도 발송 — 알림이 한 번 더
//   가는 것보다 "예약 잡혔는데 아무도 모르는" 쪽이 비싸다. 끄기는 명시적 행위.
// ═══════════════════════════════════════════════════════════════════════════

interface ChannelFlags { teams: boolean; email: boolean; inapp: boolean }

async function loadChannelFlags(type: string): Promise<ChannelFlags> {
  const flags: ChannelFlags = { teams: true, email: true, inapp: true }
  try {
    const { data, error } = await supabase
      .from('notification_settings')
      .select('channel, enabled')
      .eq('type', type)
    if (error || !data) return flags                    // fail-open
    for (const row of data) {
      if (row.channel === 'teams') flags.teams = row.enabled !== false
      if (row.channel === 'email') flags.email = row.enabled !== false
      if (row.channel === 'inapp') flags.inapp = row.enabled !== false
    }
  } catch (_) { /* fail-open */ }
  return flags
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-e. 발송 로그 (← [2026-08-10 v2, 20260741 사양])
//   행 = 수신자 1명 × 채널 1개. status: sent | failed | skipped.
//   이메일·이름을 스냅샷 저장 (퇴사로 profiles 가 지워져도 이력은 남는다).
//   인앱은 개별 결과를 안 돌려주므로 채널 단위 1행만 기록.
//   ★로그 실패가 발송을 막지 않는다 — 예외를 삼키고 콘솔에만 남긴다.
// ═══════════════════════════════════════════════════════════════════════════

interface LogRow {
  type: string; channel: 'email' | 'inapp'
  recipient_id?: string | null; recipient_email?: string | null; recipient_name?: string | null
  booking_id?: string | null; status: 'sent' | 'failed' | 'skipped'; detail?: string | null
}

async function writeLogs(rows: LogRow[]): Promise<void> {
  if (!rows.length) return
  try {
    const { error } = await supabase.from('notification_logs').insert(rows)
    if (error) console.warn('[notify] 발송 로그 기록 실패(발송은 정상):', error.message)
  } catch (e) {
    console.warn('[notify] 발송 로그 기록 오류(발송은 정상):', e)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Teams Adaptive Card 발송 (기존 로직 유지 — P2 범위 외)
// ═══════════════════════════════════════════════════════════════════════════

async function sendTeamsCard(type: string, booking: any): Promise<void> {
  if (!TEAMS_WEBHOOK_URL) return

  const colorMap: Record<string, string> = {
    created:          'Good',
    created_on_behalf:'Good',     // ← [2026-06-12] 대리 예약
    pending:          'Warning',
    approved:         'Good',
    rejected:         'Attention',
    cancelled:        'Default',
    noshow:           'Warning',
    updated:          'Default',
    owner_changed:    'Default',   // ← [2026-06-12] 예약자 변경
    pending_expiring: 'Warning',
    pending_expired:  'Attention',
  }
  const color = colorMap[type] ?? 'Default'

  const titleMap: Record<string, string> = {
    created:          '✅ 새 예약이 생성되었습니다',
    created_on_behalf:'✅ 관리자 대리 예약이 생성되었습니다',   // ← [2026-06-12]
    pending:          '📋 에메랄드 룸 승인 요청',
    approved:         '✅ 예약이 승인되었습니다',
    rejected:         '❌ 예약이 거절되었습니다',
    cancelled:        '❌ 예약이 취소되었습니다',
    noshow:           '⚠️ 노쇼 자동취소',
    updated:          '📝 예약이 변경되었습니다',
    owner_changed:    '🔁 예약자가 변경되었습니다',   // ← [2026-06-12]
    pending_expiring: '⏰ 에메랄드 룸 승인 기한 10분 전',
    pending_expired:  '❌ 승인 기한 초과 — 자동 취소 처리됨',
  }
  const cardTitle = titleMap[type] ?? '예약 알림'

  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: color,
            items: [{
              type: 'TextBlock',
              text: cardTitle,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            }],
          },
          {
            type: 'FactSet',
            facts: [
              // ← [2026-07-27 목적 Phase 4] 목적 행 — 없으면 생략 (Teams 미사용 상태지만 필드 정합성 유지)
              ...(purposeText(booking.purpose, booking.purpose_detail ?? booking.purposeDetail)
                ? [{ title: '목적', value: purposeText(booking.purpose, booking.purpose_detail ?? booking.purposeDetail)! }] : []),
              { title: '회의명', value: booking.title ?? '-' },
              { title: '회의실', value: booking.room_name ?? '-' },
              { title: '날짜',   value: booking.start_at ? booking.start_at.slice(0, 10) : '-' },
              { title: '시간',   value: booking.start_at && booking.end_at
                  ? `${booking.start_at.slice(11, 16)} ~ ${booking.end_at.slice(11, 16)}`
                  : '-' },
              { title: '예약자', value: `${booking.user_name ?? '-'} (${booking.user_dept ?? '-'})` },
              ...(booking.reject_reason ? [{ title: '거절 사유', value: booking.reject_reason }] : []),
            ],
          },
          ...(type === 'pending' ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '승인 관리 페이지로 이동',
              url: `${APP_URL}#admin-booking-${booking.id}`,
            }],
          }] : []),
          ...((type === 'created' || type === 'approved') ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '예약 확인하기',
              url: APP_URL,
            }],
          }] : []),
        ],
        '$version': '1.0',
      },
    }],
  }

  try {
    const res = await fetch(TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    })
    if (!res.ok) {
      console.warn('[notify] Teams 발송 실패:', res.status, await res.text())
    }
  } catch (e) {
    console.warn('[notify] Teams 발송 오류 (이메일은 정상):', e)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2-b. generic 이메일 렌더 (← [2026-08-10 v2] email-templates.ts 유실 대체)
//
//   원칙: POLICIES 정책 필드(headerLabel/headerColor/contextBanner/cta/
//   isCancelledStyle)만으로 렌더 — 타입별 HTML 하드코딩 금지.
//   허용 예외 3종(조건부 정보 라인): rejected 사유+처리자 / cancelled 강제
//   취소 사유 / noshow_penalty_applied 제한 기간 ("언제까지인지 없으면 문의가
//   그대로 관리자에게 간다" — 도서 L818 교훈).
//   인포카드 분기: 도서 필드(book_title 등) → 도서 포맷 / 제재 필드
//   (penalty_ends_kst) → 제재 포맷 / 그 외 → 회의 포맷.
// ═══════════════════════════════════════════════════════════════════════════

interface EmailRenderInput {
  type: NotificationType
  role: 'booker' | 'attendee' | 'admin'
  booking: EmailBookingData
  creatorInfo: EmailCreatorInfo | null
  recipientName: string
  attendeeList: EmailAttendee[]
  recurBookings: { start_at: string; end_at: string }[]
  appUrl: string
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ← [2026-08-11 원본 디자인 원복] SSOT = Figma ydfT0xP6nc83VxFd7GyEx4 노드 147:177
//   ("Mail - 거절메일") 실측 + 고지 제공 스크린샷 2종. 8/10 v2 generic 룩과
//   8/11 재설계 시안은 폐기 — 유실 전 원본 룩을 재현한다.
//   원본 토큰: 흰 배경 600px · 로고 "C&R SPACE" Instrument Sans 30 Medium
//   uppercase #111 · 헤더라벨 Pretendard 16 Medium · 역할 배지 #DFF3FF r4 ·
//   섹션 구분선 0.5px #111 · 타이틀 21 Medium + 서브 14 · 인포 행 라벨
//   Bold 12 ls1px 100px + 값 Medium 14 · 아바타 24 검정원(#E7E7E7 이니셜) ·
//   부서 rgba(17,17,17,.35) · 안내 배너 #DFF3FF r12 p16 12px · 사유 배너
//   #FFF1F1 + #EF4444 · CTA 검정 r16 py16 풀폭 shadow(70,70,70,.2) ·
//   푸터 11 #99A1AF 중앙 "이 메일은 C&R SPACE에서 자동발송 된 이메일 입니다."
//   전부 테이블+인라인 스타일 (Outlook: radius·shadow 미지원 시 각짐 허용).

const FONT_STACK = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif"
const LOGO_STACK = "'Instrument Sans','Pretendard','Apple SD Gothic Neo',sans-serif"

/** 인포 행 — 원본: 라벨 Bold 12 letter-spacing 1px 폭 100, 값 Medium 14, py 14 */
function infoRow(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:14px 0;font-size:12px;font-weight:700;letter-spacing:1px;color:#111;width:100px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:14px 0;font-size:14px;font-weight:500;color:#111;line-height:1.3;">${valueHtml}</td>
  </tr>`
}

/** 사람 셀 — 검정 원형 아바타 24(이니셜 #E7E7E7) + 이름 14 + 부서(35% 잉크) */
function personHtml(name: string, dept?: string): string {
  const initial = (name ?? '').trim().charAt(0) || '?'
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:24px;height:24px;border-radius:1000px;background:#000000;text-align:center;vertical-align:middle;font-size:12px;font-weight:500;color:#E7E7E7;">${esc(initial)}</td>
    <td style="padding-left:7px;font-size:14px;font-weight:500;color:#111;white-space:nowrap;">${esc(name)}</td>
    ${dept ? `<td style="padding-left:4px;font-size:14px;font-weight:500;color:rgba(17,17,17,0.35);white-space:nowrap;">${esc(dept)}</td>` : ''}
  </tr></table>`
}

/** 안내 배너 — 원본 파랑 #DFF3FF. 경고·사유 계열은 핑크 #FFF1F1 + #EF4444 */
function noticeBanner(tone: 'info' | 'danger', title: string | null, body: string): string {
  const bg = tone === 'danger' ? '#FFF1F1' : '#DFF3FF'
  const color = tone === 'danger' ? '#EF4444' : '#000000'
  return `<div style="margin-top:16px;padding:16px;border-radius:12px;background:${bg};">
    ${title ? `<div style="font-size:12px;font-weight:600;color:${color};">${esc(title)}</div>` : ''}
    <div style="${title ? 'margin-top:4px;' : ''}font-size:12px;font-weight:500;line-height:1.6;color:${color};">${esc(body)}</div>
  </div>`
}

function renderEmail(input: EmailRenderInput): string {
  const { type, role, booking, creatorInfo, recipientName: _rn, attendeeList, recurBookings, appUrl } = input
  const policy = POLICIES[type]

  const isBook    = !!(booking.book_title || booking.due_date_kst)
  const isPenalty = !!booking.penalty_ends_kst && (type === 'noshow_penalty_applied' || type === 'noshow_penalty_cleared')
  const pText = purposeText(booking.purpose, booking.purpose_detail)

  // ── 역할 배지 (원본 "관리자 수신 알림" 패턴) ─────────────────────────
  const roleBadge = role === 'admin' ? '관리자 수신 알림' : role === 'attendee' ? '참석자 수신 알림' : isBook ? '대여자 수신 알림' : isPenalty ? '대상자 수신 알림' : '예약자 수신 알림'

  // ── 인포 행 (원본: 영문 대문자 라벨 / 사람 라벨은 한글) ──────────────
  const rows: string[] = []
  if (isBook) {
    if (booking.checkout_date_kst) rows.push(infoRow('RENTED', esc(booking.checkout_date_kst)))
    if (booking.due_date_kst)      rows.push(infoRow('DUE', esc(booking.due_date_kst)))
    if (typeof booking.days_overdue === 'number' && booking.days_overdue > 0)
      rows.push(infoRow('OVERDUE', `<span style="color:#EF4444;">${esc(`${booking.days_overdue}일`)}</span>`))
    if (booking.user_name) rows.push(infoRow('대여자', personHtml(booking.user_name, booking.user_dept)))
  } else if (isPenalty) {
    if (typeof booking.noshow_count === 'number')
      rows.push(infoRow('NOSHOW', esc(`${booking.noshow_count}회 (1개월 내)`)))
    if (type === 'noshow_penalty_applied')
      rows.push(infoRow('PERIOD', `<span style="color:#EF4444;">${esc(`${booking.penalty_starts_kst ?? ''} ~ ${booking.penalty_ends_kst}`)}</span>`))
    if (booking.user_name) rows.push(infoRow('대상자', personHtml(booking.user_name, booking.user_dept)))
  } else {
    if (booking.start_at)  rows.push(infoRow('DATE', esc(kstDateWithDay(booking.start_at))))
    if (booking.start_at && booking.end_at)
      rows.push(infoRow('TIME', esc(`${kstTime(booking.start_at)} - ${kstTime(booking.end_at)}`)))
    if (booking.room_name) rows.push(infoRow('ROOM', esc(booking.room_name)))
    if (pText)             rows.push(infoRow('PURPOSE', esc(pText)))
    if (booking.recur_label) rows.push(infoRow('REPEAT', esc(booking.recur_label)))
    if (booking.memo)
      rows.push(infoRow('MEMO', esc(booking.memo).replace(/\n/g, '<br>')))
    const ownerName = creatorInfo?.name ?? booking.user_name
    if (ownerName) rows.push(infoRow('예약자', personHtml(ownerName, creatorInfo?.dept ?? booking.user_dept)))
    if (attendeeList.length > 0)
      rows.push(infoRow('참석자', attendeeList.map(a => personHtml(a.name, a.dept)).join('<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>')))
  }

  // ── 배너: 정책 contextBanner → 원본 2톤 매핑 (warning/danger→핑크, 그 외→파랑) ──
  const banner = policy?.contextBanner?.[role]
  let bannersHtml = ''
  if (banner) {
    // 원본(Figma 147:177·고지 스크린샷 2종): 안내 배너는 톤 무관 항상 파랑 —
    // 핑크는 사유(거절/취소/제한) 배너 전용. 정책 프리셋 색은 인앱 쪽 개념으로만 남긴다.
    bannersHtml += noticeBanner('info', null, banner.body ? `${banner.title} ${banner.body}` : banner.title)
  }
  // 사유 배너 (원본 "거절 사유" 패턴 — 타이틀 + 본문, 핑크/레드)
  if (type === 'rejected' && booking.reject_reason)
    bannersHtml += noticeBanner('danger', '거절 사유', booking.admin_name ? `${booking.reject_reason} (처리: ${booking.admin_name})` : booking.reject_reason)
  if (type === 'cancelled' && booking.admin_force && booking.cancel_reason)
    bannersHtml += noticeBanner('danger', '취소 사유', booking.cancel_reason)

  // ── 반복 일정 (원본 근거 없음 — 인포 행 스타일로 최소 표기) ───────────
  const recurHtml = recurBookings.length > 0
    ? infoRow('SCHEDULE', recurBookings.map(r => esc(`${kstDateWithDay(r.start_at)} ${kstTime(r.start_at)} - ${kstTime(r.end_at)}`)).join('<br>'))
    : ''

  // ── CTA (원본: 검정 풀폭 r16 — 색은 검정 고정, 라벨은 정책) ──────────
  const cta = policy?.cta?.[role]
  const ctaHtml = cta ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;"><tr>
      <td style="background:#000000;border-radius:16px;text-align:center;">
        <a href="${renderUrl(cta.urlTemplate, { APP_URL: appUrl, BOOKING_ID: booking.id })}"
           style="display:block;padding:16px 0;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(cta.label)}</a>
      </td>
    </tr></table>` : ''

  const headerLabel = policy?.headerLabel ?? '예약 알림'
  // 원본 거절메일(147:177)의 회의명엔 취소선이 없다 — 취소선은 "예약 자체가 취소된"
  // 타입(cancelled/noshow/pending_expired)에만. rejected 는 정책 isCancelledStyle 과
  // 무관하게 원본대로 일반 표기.
  const cancelled   = !!policy?.isCancelledStyle && type !== 'rejected'
  const titleStyle  = cancelled ? 'text-decoration:line-through;color:#99A1AF;' : 'color:#111;'
  const cardTitle   = isBook ? (booking.book_title ?? booking.title) : (booking.title || (isPenalty ? '회의실 예약' : '-'))
  const subLine     = isBook ? '도서 대여' : isPenalty ? (booking.user_name ?? '') : (booking.room_name ?? '')

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT_STACK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">
      <tr><td style="padding-bottom:32px;">
        <div style="padding-bottom:16px;font-family:${LOGO_STACK};font-size:30px;font-weight:500;color:#111;text-transform:uppercase;">C&amp;R SPACE</div>
        <div style="font-size:16px;font-weight:500;line-height:1.7;color:#111;">${esc(headerLabel)}</div>
        <div style="margin-top:4px;"><span style="display:inline-block;padding:4px 8px;border-radius:4px;background:#DFF3FF;font-size:12px;font-weight:500;color:#111;">${esc(roleBadge)}</span></div>
      </td></tr>
      <tr><td style="border-top:0.5px solid #111;border-bottom:0.5px solid #111;padding:24px 0;">
        <div style="font-size:21px;font-weight:500;line-height:1.5;${titleStyle}">${esc(cardTitle)}</div>
        ${subLine ? `<div style="padding-top:2px;font-size:14px;color:#111;letter-spacing:0.07px;">${esc(subLine)}</div>` : ''}
      </td></tr>
      <tr><td style="padding:24px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}${recurHtml}</table>
        ${bannersHtml}
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:24px 30px;text-align:center;">
        <div style="font-size:11px;line-height:16px;color:#99A1AF;">이 메일은 C&amp;R SPACE에서 자동발송 된 이메일 입니다.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 헬퍼 — Person[]을 EmailAttendee[]로 변환
// ═══════════════════════════════════════════════════════════════════════════

function toEmailAttendees(persons: Person[]): EmailAttendee[] {
  return persons
    .filter(p => !!p.email)
    .map(p => ({
      email:      p.email,
      name:       p.name,
      dept:       p.dept,
      avatar_url: p.avatar_url,
    }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 헬퍼 — 이메일 아이템 리스트 생성 (역할별 개인화)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 역할(booker/attendee/admin)별로 렌더 입력을 만들어 이메일 아이템으로 변환
 * · 각 수신자마다 role에 맞는 subject + html 생성
 * · sendEmails() batch API로 한 번에 발송
 */
function buildEmailItems(
  type: NotificationType,
  bookingData: EmailBookingData,
  recipients: ResolvedRecipients,
  attendeeList: EmailAttendee[],        // 공통 참석자 목록 (이메일 본문에 표시될 참석자 칩)
  recurBookings: { start_at: string; end_at: string }[],
): EmailItem[] {
  const items: EmailItem[] = []

  // creatorInfo: 본문에 예약자/대여자 정보 표시용 (Person → EmailCreatorInfo 변환)
  //
  // ← [2026-07-20] 소스를 recipients.booker → recipients.owner 로 변경.
  //
  //   booker 는 "메일을 받는 예약자"라 booker_* 규칙에서만 채워진다.
  //   본문의 예약자/대여자 행은 수신자가 아니라 **예약·대여의 주체**를 보여주는
  //   자리인데 수신자 목록에서 값을 가져오고 있었다.
  //   그 결과 booker 를 조회하지 않는 규칙(admins_only / former_booker /
  //   removed_attendees / book_borrower)에서 creatorInfo 가 null 이 되고,
  //   renderAvatar 가 이름 없는 "?" 원을 그렸다. 23종 중 11종이 해당.
  //     · book_* 7종            → 대여자 행 "?"
  //     · book_requested, pending_expiring (admins_only) → 예약자/신청자 행 "?"
  //     · former_booker, attendee_removed → 예약자 행 "?"
  //
  //   owner 는 recipient-resolver 가 규칙과 무관하게 booking.user_id 로 해석한다.
  //   booker 폴백은 혹시 owner 조회가 실패한 경우를 위한 안전망.
  const creatorSource = recipients.owner ?? recipients.booker
  const creatorInfo: EmailCreatorInfo | null = creatorSource ? {
    email:      creatorSource.email,
    name:       creatorSource.name,
    dept:       creatorSource.dept,
    avatar_url: creatorSource.avatar_url,
  } : null

  // 공통 렌더 입력 일부
  const baseInput = {
    type,
    booking:       bookingData,
    creatorInfo,
    recurBookings,
    appUrl:        APP_URL,
  }

  // ── 예약자 ──────────────────────────────────────────────────────
  if (recipients.booker?.email) {
    const role = 'booker' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: recipients.booker.name,
      attendeeList,                 // 예약자 본문엔 "참석자 N명" 전체 노출
    })
    items.push({
      to:      recipients.booker.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── 참석자 (개별 개인화) ────────────────────────────────────────
  for (const att of recipients.attendees) {
    if (!att.email) continue
    const role = 'attendee' as const
    // ← [2026-04-29] 본인 filter 제거 — 참석자도 전체 참석자 목록(본인 포함) 표시
    //   기존: attendeeList.filter(본인 제외) → 본인이 빠진 목록 or 1인일 때 목록 자체 미노출
    //   수정: attendeeList 그대로 전달 (예약자 메일과 동일하게 전체 참석자 노출)
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: att.name,
      attendeeList,
    })
    items.push({
      to:      att.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── 관리자 ──────────────────────────────────────────────────────
  for (const adm of recipients.admins) {
    if (!adm.email) continue
    const role = 'admin' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: adm.name,
      attendeeList,                 // 관리자도 전체 참석자 노출
    })
    items.push({
      to:      adm.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── removed_attendees (예외 케이스) ──────────────────────────────
  for (const rm of recipients.removedAttendees) {
    if (!rm.email) continue
    const role = 'attendee' as const  // removed도 attendee 역할로 렌더 (하지만 getSubject는 'attendee_removed' 예외 처리됨)
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: rm.name,
      attendeeList:  [],             // 참석자 명단은 비움 (제외된 입장)
    })
    items.push({
      to:      rm.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── former_booker (예약자 변경 시 원래 예약자) ──────────────────
  // ← [2026-06-12] role='booker'로 렌더 — former_booker 정책의 booker 배너/제목 사용
  //   ("회의 예약자에서 변경되었습니다"). 참석자 명단은 비움(더 이상 본인 예약 아님).
  if (recipients.formerBooker?.email) {
    const role = 'booker' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: recipients.formerBooker.name,
      attendeeList:  [],
    })
    items.push({
      to:      recipients.formerBooker.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── book_borrower (도서 대여자 본인) ────────────────────────────
  // ← [2026-07-20] role='booker'로 렌더 — 도서관 정책의 booker 배너/CTA 사용
  //   도서 알림은 참석자/관리자가 없어 이 1명이 유일한 수신자다.
  //   ← [2026-07-20 fix] 기존 코드가 renderEmail 없이 잘못된 형태로 push 하고
  //     괄호가 깨져 있어 배포 불가 상태였음. 다른 수신자 분기와 동일 구조로 정정.
  if (recipients.bookBorrower?.email) {
    const role = 'booker' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: recipients.bookBorrower.name,
      attendeeList:  [],
    })
    items.push({
      to:      recipients.bookBorrower.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  return items
}

// ═══════════════════════════════════════════════════════════════════════════
// 4-b. 인앱 본문 조립 + 벌크 INSERT (← [2026-08-10 v2] notification-inapp.ts 유실 대체)
//   notifications 스키마 = 프론트 insertNotification 실측:
//   { user_id, type, title, body, booking_id, is_read:false }
//   type 은 정책 inappType (알림벨 색상 notificationMeta 키와 1:1).
// ═══════════════════════════════════════════════════════════════════════════

function buildInAppBody(type: NotificationType, d: InAppBookingData): string {
  // ← [2026-08-10 v2] 노쇼 이용 제재 분기 — *_kst 서버 완성 문자열 그대로 (재변환 금지)
  if (type === 'noshow_penalty_applied')
    return `예약 제한 ~${d.penalty_ends_kst ?? ''} · 노쇼 ${d.noshow_count ?? 3}회`
  if (type === 'noshow_penalty_cleared')
    return '예약 제한이 해제되었습니다 · 다시 예약할 수 있습니다'

  // 도서 분기 — book_title 이 있으면 도서 포맷
  if (d.book_title) {
    const parts = [d.book_title]
    if (d.checkout_date_kst) parts.push(`대여 ${d.checkout_date_kst}`)
    if (d.due_date_kst)      parts.push(`반납기한 ${d.due_date_kst}`)
    if (typeof d.days_overdue === 'number' && d.days_overdue > 0) parts.push(`연체 ${d.days_overdue}일`)
    if (d.user_name)         parts.push(d.user_name)
    return parts.join(' · ')
  }

  // 기본(회의) 포맷: [목적] 제목 · 날짜 · 시간 · 회의실
  const pText = purposeText(d.purpose, d.purpose_detail)
  const parts: string[] = []
  parts.push(`${pText ? `[${pText}] ` : ''}${d.title || '회의실 예약'}`)
  if (d.start_at) parts.push(`${kstDate(d.start_at)} ${kstTime(d.start_at)}`)
  if (d.room_name) parts.push(d.room_name)
  return parts.join(' · ')
}

/** 역할별 제목이 정책에 비어 있으면(=대상 아님) 자동 스킵 — 구버전 계약 유지 */
async function insertInAppBulk(
  _sb: any,
  userIds: string[],
  type: NotificationType,
  role: 'booker' | 'attendee' | 'admin',
  d: InAppBookingData,
): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return 0
  const policy = POLICIES[type]
  if (!policy) return 0
  const title =
    role === 'booker'   ? policy.inappTitleBooker :
    role === 'attendee' ? policy.inappTitleAttendee :
                          policy.inappTitleAdmin
  if (!title) return 0                               // 빈 문자열 = 이 역할은 인앱 대상 아님

  const body = buildInAppBody(type, d)
  const rowsIns = ids.map(uid => ({
    user_id:    uid,
    type:       policy.inappType,
    title,
    body,
    booking_id: d.id ?? null,
    is_read:    false,
  }))
  const { error } = await supabase.from('notifications').insert(rowsIns)
  if (error) {
    console.warn(`[notify] 인앱 INSERT 실패 (${type}/${role}):`, error.message)
    return 0
  }
  return rowsIns.length
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 헬퍼 — 인앱 알림 일괄 발송 (역할별)
// ═══════════════════════════════════════════════════════════════════════════

async function sendInAppForAllRoles(
  type: NotificationType,
  bookingData: InAppBookingData,
  recipients: ResolvedRecipients,
): Promise<number> {   // ← [2026-08-10 v2] 삽입 건수 반환
  const bookerId      = recipients.booker?.user_id ? [recipients.booker.user_id] : []
  const attendeeIds   = recipients.attendees.map(p => p.user_id).filter(Boolean)
  const adminIds      = recipients.admins.map(p => p.user_id).filter(Boolean)
  const removedIds    = recipients.removedAttendees.map(p => p.user_id).filter(Boolean)
  // ← [2026-06-12] former_booker 인앱 수신자 (원래 예약자 1명)
  const formerBookerId = recipients.formerBooker?.user_id ? [recipients.formerBooker.user_id] : []
  // ← [2026-07-20] book_borrower 인앱 수신자 (도서 대여자 1명)
  const bookBorrowerId = recipients.bookBorrower?.user_id ? [recipients.bookBorrower.user_id] : []

  // 각 역할에 맞는 제목이 정책에 있으면 INSERT, 없으면 insertInAppBulk 내부에서 자동 스킵
  const tasks: Promise<any>[] = [
    insertInAppBulk(supabase, bookerId,    type, 'booker',   bookingData),
    insertInAppBulk(supabase, attendeeIds, type, 'attendee', bookingData),
    insertInAppBulk(supabase, adminIds,    type, 'admin',    bookingData),
    // removed_attendees도 attendee 역할로 알림 (정책: attendee_removed만 해당)
    insertInAppBulk(supabase, removedIds,  type, 'attendee', bookingData),
    // ← [2026-06-12] former_booker는 booker 역할로 알림 (정책: former_booker만 해당)
    //   former_booker 정책의 inappTitleBooker("회의 예약자에서 변경되었습니다") 사용
    insertInAppBulk(supabase, formerBookerId, type, 'booker', bookingData),
    // ← [2026-07-20] 도서 대여자는 booker 역할로 알림 (도서관 정책은 inappTitleBooker만 사용)
    insertInAppBulk(supabase, bookBorrowerId, type, 'booker', bookingData),
  ]

  // ← [2026-08-10 v2] 삽입 건수 합계 반환 — 발송 로그(인앱은 채널 단위 1행)에 사용
  const settled = await Promise.allSettled(tasks)
  return settled.reduce((n, r) => n + (r.status === 'fulfilled' ? (r.value ?? 0) : 0), 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { type, booking } = payload

    if (!type || !booking) {
      return new Response(JSON.stringify({ error: 'type, booking 필수' }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // 정책 조회 — 미지원 타입이면 400 반환
    const policy = POLICIES[type as NotificationType]
    if (!policy) {
      console.warn(`[notify] 미지원 type: ${type}`)
      return new Response(JSON.stringify({ error: `지원하지 않는 type: ${type}` }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // ── 채널 게이트 (← [2026-08-10 v2, 20260728 사양] 미설정=켜짐 fail-open) ──
    const channels = await loadChannelFlags(type)

    // ── Teams 알림 (비동기, 실패해도 이메일에 영향 없음) ─────────────
    // checkin_* / daily_reminder / attendee_removed 는 Teams 발송 대상 아님
    const teamsTargetTypes = [
      'created', 'pending', 'updated', 'cancelled', 'rejected',
      'approved', 'noshow', 'pending_expiring', 'pending_expired',
      'owner_changed',   // ← [2026-06-12] 예약자 변경 (former_booker는 Teams 제외 — attendee_removed와 동일)
      'created_on_behalf',  // ← [2026-06-12] 대리 예약
    ]
    if (teamsTargetTypes.includes(type) && channels.teams) {   // ← [v2] 채널 게이트
      sendTeamsCard(type, booking).catch(() => {})
    }

    // ── 수신자 조회 (정책 기반 RecipientRule 사용) ───────────────────
    const recipients = await resolveRecipients(supabase, {
      rule:          policy.recipients,
      // ← [2026-08-10 v2, 20260728 사양] 지정 수신자 명단 우선 적용의 핵심 —
      //   이 인자 미전달이 8/5 '비도서 관리자 오발송'(송지나 수신)의 원인이었다.
      notificationType: type as NotificationType,
      bookerUserId:  booking.user_id,
      bookingId:     booking.id,
      removedEmails: booking.removed_emails ?? [],   // attendee_removed 전용
      // ← [2026-06-12] former_booker 전용 — 원래 예약자 user_id
      formerBookerUserId: booking.former_booker_user_id,
      // ← [2026-07-20] book_borrower 전용 — 도서 대여자 user_id
      //   도서 알림 payload는 booking 슬롯에 도서 정보를 담아 보낸다(booking.user_id = 대여자).
      borrowerUserId: booking.user_id,
    })

    // ── 이메일 본문용 참석자 목록 생성 ────────────────────────────────
    // 참석자/관리자 렌더에도 "참석자 N명"이 보여야 하므로 공통 리스트 구성
    // (removed_attendees 제외 — 이 경우 참석자는 본인만이라 명단 표시 안 함)
    const attendeeListForEmail: EmailAttendee[] =
      policy.recipients === 'removed_attendees'
        ? []
        : toEmailAttendees(recipients.attendees)

    // ── EmailBookingData 구성 (렌더 입력용) ──────────────────────────
    // 기존 payload의 필드명과 email-templates의 인터페이스 매핑
    const bookingData: EmailBookingData = {
      id:            booking.id,
      title:         booking.title ?? '',
      memo:          booking.memo,
      start_at:      booking.start_at,
      end_at:        booking.end_at,
      room_name:     booking.room_name ?? '',
      // ← [2026-07-23] owner 폴백 추가.
      //   booker 는 "메일을 받는 예약자" 라 booker_* 규칙에서만 채워진다.
      //   book_admins 규칙에서는 null 이라 인앱 관리자 본문의 대여자 이름이 비었다.
      //   owner 는 규칙과 무관하게 booking.user_id(=대여자)로 해석된 DB live 값이다.
      user_name:     recipients.booker?.name ?? recipients.owner?.name ?? booking.user_name ?? '',
      user_dept:     recipients.booker?.dept ?? recipients.owner?.dept ?? booking.user_dept ?? '',
      admin_name:    booking.admin_name,
      admin_avatar:  booking.admin_avatar,
      admin_force:   booking.admin_force,
      cancel_reason: booking.cancel_reason,
      reject_reason: booking.reject_reason,
      recur_label:   booking.recur_label,
      // ← [2026-07-27 목적 Phase 4] 회의 목적 — 이메일 PURPOSE 행/인앱 프리픽스/Teams facts 공용. 없으면 전부 생략(fail-safe)
      purpose:        booking.purpose,
      purpose_detail: booking.purpose_detail ?? booking.purposeDetail,  // 프론트는 camelCase로 보내므로 이중 수용
      // ← [2026-07-20] 도서관 알림 전용 필드
      //   이 3개가 있으면 email-templates 가 회의(DATE/TIME/ROOM) 대신
      //   도서(반납예정/연체) 포맷으로 인포카드를 렌더한다.
      book_title:    booking.book_title,
      due_date_kst:  booking.due_date_kst,
      days_overdue:  booking.days_overdue,
      // ← [2026-07-23] 대여일 — 관리자 통지(book_checkout_created) 본문에 필요.
      //   미래 예약이면 반납기한만으로는 언제 나가는 책인지 알 수 없다.
      checkout_date_kst: booking.checkout_date_kst,
    }

    const recurBookings: { start_at: string; end_at: string }[] = booking.recurBookings ?? []

    // ── 이메일 아이템 리스트 생성 ────────────────────────────────────
    const emailItems = buildEmailItems(
      type as NotificationType,
      bookingData,
      recipients,
      attendeeListForEmail,
      recurBookings,
    )

    // ── 이메일 발송 (Batch API 1회 호출로 모두 발송) ─────────────────
    // ← [2026-08-10 v2] 채널 OFF 여도 본문 조립까지는 위에서 진행됐다 —
    //   조립 결함을 설정으로 가리면 다시 켤 때 드러난다 (20260728 원칙).
    const emailResult = channels.email
      ? await sendEmails(emailItems)
      : { total: emailItems.length, succeeded: 0, failed: 0, rateLimited: false, results: [] }

    // ── 인앱 알림 발송 (정책에 정의된 역할만 자동 INSERT) ────────────
    const inAppBooking: InAppBookingData = {
      id:        bookingData.id,
      title:     bookingData.title,
      room_name: bookingData.room_name,
      start_at:  bookingData.start_at,
      user_name: bookingData.user_name,
      // ← [2026-07-27 목적 Phase 4] 인앱 본문 [라벨] 프리픽스 입력
      purpose:        bookingData.purpose,
      purpose_detail: bookingData.purpose_detail,
      // ← [2026-07-20] 도서관 알림 전용 — buildInAppBody 의 도서 분기 입력.
      //   누락 시 body 가 "제목 · · " 형태로 빈 구분자만 남는다.
      book_title:   bookingData.book_title,
      due_date_kst: bookingData.due_date_kst,
      days_overdue: bookingData.days_overdue,
      checkout_date_kst: bookingData.checkout_date_kst,   // ← [2026-07-23]
    }
    // 인앱 알림은 이메일과 독립적으로 진행 (await하지 않고 Promise.allSettled 안에서)
    const inappSent = channels.inapp
      ? await sendInAppForAllRoles(type as NotificationType, inAppBooking, recipients)
      : 0

    // ── 발송 로그 (← [2026-08-10 v2, 20260741 사양] fire-and-forget) ──────
    //   이메일 = 수신자 1명 × 1행 (성공/실패/채널OFF skipped, 스냅샷).
    //   인앱   = 채널 단위 1행 (개별 결과를 안 돌려주므로).
    {
      const emailByTo = new Map((emailResult.results ?? []).map((r: any) => [r.to, r]))
      const logRows: LogRow[] = emailItems.map(it => {
        const r: any = emailByTo.get(it.to)
        const status: 'sent' | 'failed' | 'skipped' =
          !channels.email ? 'skipped' : r ? (r.success ? 'sent' : 'failed') : 'failed'
        return {
          type, channel: 'email',
          recipient_email: it.to,
          recipient_name:  null,          // 스냅샷 이름은 아이템에 없음 — 이메일이 식별자
          booking_id: booking.id ?? null,
          status,
          detail: !channels.email ? 'channel_off'
                : r?.messageId ? String(r.messageId)
                : r?.error ? String(r.error) : null,
        }
      })
      logRows.push({
        type, channel: 'inapp',
        booking_id: booking.id ?? null,
        status: !channels.inapp ? 'skipped' : 'sent',
        detail: !channels.inapp ? 'channel_off' : `inserted=${inappSent}`,
      })
      writeLogs(logRows).catch(() => {})
    }

    console.log(
      `[notify] ${type} 완료 — 이메일 ${emailResult.succeeded}/${emailResult.total}${
        emailResult.failed > 0 ? ` (${emailResult.failed} 실패)` : ''
      }${emailResult.rateLimited ? ' [RATE_LIMITED]' : ''} | 인앱 ${inappSent} | ch(t/e/i)=${channels.teams?1:0}/${channels.email?1:0}/${channels.inapp?1:0}`
    )

    return new Response(
      JSON.stringify({
        success:     emailResult.failed === 0,
        type,
        emailSent:   emailResult.succeeded,
        emailFailed: emailResult.failed,
        rateLimited: emailResult.rateLimited,
        inappSent,                                 // ← [2026-08-10 v2]
        channels,                                  // ← [2026-08-10 v2] 게이트 상태 (진단용)
        results:     emailResult.results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[notify] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
