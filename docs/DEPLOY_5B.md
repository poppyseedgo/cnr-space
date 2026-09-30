# Phase 5-B 배포 — Work Space 알림 5종 + 일일 다이제스트  (2026-09-30)

## 무엇이 바뀌나
| 알림 | 언제 | 누구에게 (본인 제외) | 채널 |
|---|---|---|---|
| `wb_task_assigned` 업무 배정 | 담당자 추가 저장 직후 | **새로 담당이 된 사람** | 메일 + 인앱 |
| `wb_comment_added` 댓글 | 댓글 등록 직후 | 담당자 · 작성자 · 기존 댓글 작성자 (이슈: 등록자 · 연결 업무 담당자 · 댓글 작성자) | 메일 + 인앱 |
| `wb_issue_created` 이슈 등록 | 드로어 등록 · 빠른 등록 | 멤버 전원 | 메일 + 인앱 |
| `wb_issue_resolved` 이슈 해결/보류 | 비종결 → 해결·보류 전이 | 등록자 · 연결 업무 담당자 · 댓글 작성자 | 메일 + 인앱 |
| `wb_daily_digest` 일일 요약 | 매일 09:00 KST · 1인 1통 | 멤버 4명 (항목 0건인 날은 미발송) | 메일 + 인앱 |

- 자격 = 명시 `workboard` 권한 (5-A 규칙). 알림 설정 탭(종류 OFF) > 사용자 상세 개인 OFF > 위 규칙.
- 이메일 CTA / 인앱 클릭 → `#workboard-task-{id}` · `#workboard-issue-{id}` → 해당 드로어 자동 오픈. 다이제스트는 `#workboard`.
- 다이제스트 범위 = 멤버 전원 업무(본인 담당 "나"). `wb_digest_build(p_scope)` 에 `'mine'` 이 이미 있어 후속 "내 업무만" 개인 선택은 설정 1개 + UI 만 추가하면 된다.

## 배포 순서 — ① → ② → ③ 순서 권장 (거꾸로 해도 깨지진 않음: 미지원 type 은 400·자격자 0명은 로그만 남고 화면 저장은 영향 없음)

### ① SQL — Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
`supabase/migrations/20261004_workboard_notify.sql`
```
NOTICE: [cron] wb-daily-digest-0900kst 등록 (0 0 * * * UTC = 09:00 KST)
NOTICE: [검증] Phase 5-B SQL 전 항목 통과
```
cron 은 기존 `book-due-reminder-0900kst` 잡의 command(URL·헤더)를 복제해 함수명만 바꾼다 — 원본 잡이 없으면 EXCEPTION(전체 롤백).

### ② Edge 2개 — `_shared` 변경 + 신규 함수
```bash
git fetch origin && git checkout main && git reset --hard origin/main   # PR 머지 후
supabase functions deploy send-notification --project-ref jjzcqpbwkkujttwxksvy
supabase functions deploy wb-daily-digest  --project-ref jjzcqpbwkkujttwxksvy
```
- send-notification → v118 이상 · wb-daily-digest → v1 (verify_jwt 기본값 true — resource-due-reminder 와 동일, cron 헤더의 키로 통과)

### ③ 프론트 — PR 머지 → Cloudflare 자동
브랜치 `feat/notify-5b`.

### ④ 검증 — `_diagnose_workboard_notify_20260930.sql` 전체 Run
1) 6행 전부 `ok=true` · 2) 멤버 4명 · 3) 오늘 counts · (5·6 은 첫 발송 후)

화면 검증 (멤버 계정):
1. 업무 열기 → 담당자에 다른 멤버 추가 → 그 사람에게 메일 `[C&R SPACE · 업무배정]  {제목}` + 인앱 → 인앱 클릭 시 드로어 열림
2. 댓글 달기 → 담당자·작성자에게 `[C&R SPACE · 댓글]` (인용 박스)
3. 이슈 빠른 등록 → 나머지 3명에게 `[C&R SPACE · 이슈등록]`
4. 이슈 보드에서 해결/보류로 이동 → 등록자에게 `[C&R SPACE · 이슈처리]` (헤더는 해결/보류로 구체화)
5. 다이제스트 수동 점검: Supabase › Edge Functions › wb-daily-digest › Invoke (body 없음) 또는
   `curl -X POST "https://jjzcqpbwkkujttwxksvy.supabase.co/functions/v1/wb-daily-digest?force=1" -H "Authorization: Bearer <anon key>"`
   → 응답 `{sent, empty, skipped, failed, details}` · 메일 제목 `[C&R SPACE · Work Space]  10/1 (목) 지연 2 · 오늘 3 …`

## 변경 파일
| 파일 | 내용 |
|---|---|
| `supabase/migrations/20261004_workboard_notify.sql` | [A] wb_notification_recipients [B] wb_notification_context [C] wb_digest_build(p_scope all/mine) [D] wb_digest_log [E] cron [F] 검증 |
| `supabase/migrations/_diagnose_workboard_notify_20260930.sql` | 배포 후 진단 6개 |
| `supabase/functions/_shared/notification-types.ts` | NotificationType +5 · RecipientRule `wb_recipients` · POLICIES 5종 · CTA 4종 · getSubject wb 역할 접미 생략 |
| `supabase/functions/_shared/recipient-resolver.ts` | `wb_recipients` → DB RPC (admins 슬롯) |
| `supabase/functions/send-notification/index.ts` | wb 컨텍스트 로드(DB) · renderEmail isWorkboard 분기(행·인용·다이제스트 4섹션) · 인앱 body 규칙 · booking_id `task-/issue-/digest-` |
| `supabase/functions/wb-daily-digest/index.ts` | 신규 — 멤버별 digest_build → send-notification invoke → wb_digest_log (dedupe · ?force=1 · ?date=) |
| `src/lib/workboardApi.ts` | `notifyWb()` · insertWbComment 성공 시 자체 발사 |
| `src/pages/WorkboardPage.tsx` | 배정 diff · 이슈 등록/해결 전이 발사 · 딥링크 소비(해시·prop) |
| `src/App.tsx` | `#workboard-*` → view workboard · OAuth 복원 · 알림벨 → wbDeepLink |
| `src/components/layout/NotificationBell.tsx` | `wb_` 알림 클릭 → onOpenWorkboard |
| `src/data/notificationMeta.ts` | wb 5종 벨 색상 |

## 검증 기록
- SQL 시뮬 sim5b: 34/34 ✅ (수신자 12 · 컨텍스트 8 · 다이제스트 9 · 로그 4 · 멱등 1)
- send-notification e2e mock(fetch 수준 PostgREST·Resend 가짜): 27/27 ✅ — 실렌더 HTML = 승인 미리보기와 동일 (5B_real_mails.png)
- wb-daily-digest mock: 6/6 ✅ · Playwright 프론트: 13/13 ✅ (배정 diff·본인 제외·댓글·빠른 등록·전이·딥링크 3경로)
- `npm run check` ✅ · deno check ✅

## 알려진 한계
- 담당자를 매우 빠르게 연속 추가하면(재조회 전) 앞사람이 한 번 더 알림받을 수 있음 — 드로어가 저장을 await 하므로 정상 조작에선 발생하지 않음.
- 이슈 → 업무 전환으로 생긴 업무의 담당자(= 보고자 본인)는 배정 알림 대상 아님(본인).
- 미리보기 시안의 TODAY 섹션에 "이슈" 항목이 있었으나 이슈에는 마감이 없어 다이제스트는 **업무만** 다룬다. "미해결 이슈 N" 줄은 원하시면 후속.
