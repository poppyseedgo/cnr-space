# Phase 5-A 배포 — 알림 수신자 결정 v2 · 사용자별 알림 설정 · Work Space 멤버 명시화  (2026-09-30)

## 무엇이 바뀌나 (한 줄)
관리자 알림 수신자를 **DB 함수 1개**(`notification_resolve_recipients`)가 결정하고, Edge 는 그 결과만 쓴다.
→ 권한을 빼면 알림도 끊기고, 사용자 상세에서 사람별로 이메일·인앱을 끌 수 있다.

## 배포 순서 — 반드시 이 순서. ①만 하고 ②를 안 하면 수신자가 안 바뀐다 (8/5·9/30 사고 원인)

### ① SQL — Supabase SQL Editor 에서 전체 Run (트랜잭션 1개 · 멱등)
`supabase/migrations/20261003_notify_recipients_v2.sql`

Messages 탭에 아래가 보여야 성공:
```
NOTICE: [소급] 자격 없는 지정 수신자 삭제: … (0건 이상)
NOTICE: [검증] Phase 5-A 전 항목 통과
```
`[시드] Work Space 멤버 4명 매칭 실패` 가 뜨면 **전체 롤백**됨 — profiles 이름(김기남·송보람·박찬희·고현정) 확인 후 재실행.

**SQL 직후 즉시 달라지는 것 (Edge 재배포 전에도):**
- Work Space 진입 = `workboard` 명시 보유자 **4명만**. super 자동 통과 폐지 → 황진희·김수빈·임지원·송지나·임지영은 Work Space 메뉴/데이터 접근 불가 (의도된 변경).
- 자격 없는 지정 수신자 행 삭제 (예: 도서관리 권한 없는 사람이 `book_checkout_created` 지정에 있던 경우).

### ② Edge 재배포 — `_shared` 가 바뀌었으므로 반드시
```bash
cd <cnr-space 로컬>
git fetch origin && git checkout main && git reset --hard origin/main   # PR 머지 후
supabase functions deploy send-notification --project-ref jjzcqpbwkkujttwxksvy
```
확인: Supabase › Edge Functions › send-notification 버전이 올라갔는지. 이후 첫 알림부터 `notification_logs` 에 행이 쌓인다.

### ③ 프론트 — PR 머지 → Cloudflare Pages 자동 배포
브랜치 `feat/notify-5a` → PR → Merge. (아래 "머지 확인" 참고)

### ④ 검증 — `supabase/migrations/_diagnose_notify_20260930.sql` 전체 Run
| # | 기대 |
|---|---|
| 1 | book→`{book}` · resource_overdue/hold_conflict→`{resource}` · wb_issue_created→`{workboard}` · pending 3종→`NULL` |
| 2 | `book_checkout_created` 수신자에 **송지나 없음** · `pending` 은 ADMIN 전원 |
| 3 | workboard 보유자 정확히 4명 |
| 4 | `legacy_cnt 0 · member_cnt 14` |
| 7 | `resolve_open_to_authenticated = false` |

화면 검증: 어드민 › 사용자 설정 › 아무 관리자 클릭 → 관리자 권한 그리드 아래 **'알림 수신 (개인 설정)'** 섹션. 토글 → 토스트 → 새로고침 후 유지.

## 변경 파일
| 파일 | 내용 |
|---|---|
| `supabase/migrations/20261003_notify_recipients_v2.sql` | [A] required_roles 재정의 [B] notification_user_prefs + RPC 2 [C] resolve_recipients [D] notification_logs [E] wb_is_member + 정책 14 교체 + 4인 시드 [F] 검증 |
| `supabase/migrations/_diagnose_notify_20260930.sql` | 배포 후 진단 7개 |
| `supabase/functions/_shared/recipient-resolver.ts` | PostgREST 임베드 제거 → RPC `notification_resolve_recipients` 단일 경로 (실패 시 빈 배열 = fail-closed) |
| `supabase/functions/send-notification/index.ts` | 개인 채널 플래그 존중 · `skipped/user_off` · `skipped/no_recipient` 로그 |
| `src/data/notificationCatalog.ts` | Work Space 그룹 + wb_ 5종 (5-B 발송용 사전 등록) · super 문구 제거 |
| `src/data/adminRoles.ts` | `explicit` 플래그 — workboard 는 super 로 안 열림 (DB `wb_is_member` 와 동일 규칙) |
| `src/lib/api.ts` | `loadUserNotificationPrefs` / `setUserNotificationPref` |
| `src/components/common/UserNotificationPrefs.tsx` | 신규 — 사용자 상세 '알림 수신' 섹션 |
| `src/pages/AdminPage.tsx` | 섹션 마운트 · 권한 저장 후 재조회(prefsKey) |

## 동작 규칙 (SSOT = DB)
```
E = 자격자 (required_roles NULL → profiles.role='ADMIN' 활성 전원 / 아니면 admin_roles ∈ roles 활성)
지정명단 있음 → 활성 지정 ∩ E   (전원 퇴사 → 빈 집합 · 지정 중 자격자 0 → E)
지정명단 없음 → E
자격자 0명   → 아무에게도 안 감 + 로그 skipped/no_recipient   (ADMIN 전원 폴백 폐지)
− 개인 OFF(type, channel) 는 그 채널만 제외    우선순위: 전역 채널 OFF > 개인 OFF > 자격·지정
당사자 알림(내 예약·내 대여·내 업무)은 이 규칙 대상 아님 — 항상 수신
```

## 롤백
SQL 은 트랜잭션이라 실패 시 자동 롤백. 배포 후 되돌리려면: Edge 이전 버전 재배포(v116) — 단 이 경우 예전 문제(ADMIN 전원 수신)로 돌아감.

## 아직 남은 것
- **알림 설정 탭 채널 토글이 저장되지 않는 문제**(`notification_settings` 0행) — 원인 미확인. 재현 절차 필요: 어떤 종류 토글 → 토스트 문구 → 새로고침 후 상태.
- 발송 로그 화면(어드민에서 `notification_logs` 조회) — 미리보기 후 별도.
- Phase 5-B: Work Space 알림 5종 발송 + 다이제스트.
