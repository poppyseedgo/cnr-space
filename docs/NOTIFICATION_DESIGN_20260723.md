# 알림 시스템 전수조사 및 설계서

> 작성 2026-07-23 · 대상 시스템 C&R Space (`space.cnrres.com`)
> 관련 변경: `20260728_notification_settings.sql`, 어드민 `알림 설정` 탭

---

## 1. 왜 이 문서를 만들었나

알림이 "누구에게 · 어떤 채널로" 나가는지가 **여섯 곳에 흩어져 있었다.**

| 흩어진 위치 | 결정하는 것 |
|---|---|
| `_shared/notification-types.ts` (POLICIES) | 문구, 수신자 규칙, CTA |
| `_shared/recipient-resolver.ts` | 규칙 → 실제 사람 |
| `send-notification/index.ts` | Teams 발송 대상 목록(하드코딩 배열) |
| `_shared/notification-inapp.ts` | 인앱 본문·발송 여부 |
| 프론트 `api.ts` / 각 Edge Function | 언제 호출할지 |
| (없음) | **끄고 켜는 수단** |

마지막 줄이 핵심이다. 지금까지 알림을 멈추는 유일한 방법은 **코드를 고쳐 배포하는 것**이었다.
그래서 `pending_expiring` / `pending_expired` 는 소스에서 호출 블록이 주석 처리된 채로 남아 있다 —
운영 판단이 코드 주석으로 기록된 상태다.

이 문서는 ① 현재 발송되는 알림 전수, ② 채널·수신자 결정 로직, ③ 새로 도입한 설정 구조를 정리한다.

---

## 2. 전수조사 — 알림 29종

채널 표기: **메일** = Resend(`space@cnrres.com`), **인앱** = 헤더 종 아이콘, **Teams** = Adaptive Card(웹훅 미설정 시 자동 무시)

### 2.1 회의실 예약 (13종)

| # | type | 발송 시점 | 수신자 | 메일 | 인앱 | Teams |
|---|---|---|---|:--:|:--:|:--:|
| 1 | `created` | 예약 생성 즉시 | 예약자+참석자 | O | O | O |
| 2 | `created_on_behalf` | 관리자 대리 예약 즉시 | 예약자+참석자 | O | O | O |
| 3 | `updated` | 예약 변경 즉시 | 예약자+참석자 | O | O | O |
| 4 | `cancelled` | 취소 즉시 | 예약자+참석자 | O | O | O |
| 5 | `owner_changed` | 예약자 변경(신규 지정) | 예약자+참석자 | O | O | O |
| 6 | `former_booker` | 예약자에서 해제된 사람 | 이전 예약자 | O | O | – |
| 7 | `attendee_removed` | 참석자 명단 제외 | 제외된 참석자 | O | O | – |
| 8 | `daily_reminder` | 매일 07:00 KST | 예약자+참석자 | O | O | – |
| 9 | **`pending`** | 에메랄드 룸 접수 즉시 | 예약자+참석자+**관리자** | O | O | O |
| 10 | `approved` | 관리자 승인 즉시 | 예약자+참석자 | O | O | O |
| 11 | `rejected` | 관리자 거절 즉시 | 예약자+참석자 | O | O | O |
| 12 | **`pending_expiring`** | 승인 기한 임박 | **관리자만** | O | O | O |
| 13 | **`pending_expired`** | 승인 기한 경과 | 예약자+참석자+**관리자** | O | O | O |

> ⚠️ 12·13은 `auto-cancel-bookings` 의 해당 블록이 **주석 처리**되어 현재 발송되지 않는다(v3 재설계 대기).
> 설정 화면에는 표시되지만, 채널을 켜도 호출 자체가 없으므로 나가지 않는다.

### 2.2 체크인·노쇼 (4종)

| # | type | 발송 시점 | 수신자 | 메일 | 인앱 | Teams |
|---|---|---|---|:--:|:--:|:--:|
| 14 | `checkin_before_5` | 시작 5분 전 | 예약자+참석자 | O | O | – |
| 15 | `checkin_warning_5` | 시작 5분 후 미체크인 | 예약자+참석자 | O | O | – |
| 16 | `noshow` | 노쇼 자동 취소 | 예약자+참석자 | O | O | O |
| 17 | `early_end` | 조기 종료 즉시 | 예약자+참석자 | O | O | – |

### 2.3 도서관 (9종 + 폐지 3종)

| # | type | 발송 시점 | 수신자 | 메일 | 인앱 | Teams |
|---|---|---|---|:--:|:--:|:--:|
| 18 | **`book_checkout_created`** | 대여·예약 생성 즉시 | **도서 담당 관리자** | O | O | – |
| 19 | `book_borrowed` | 대여 시작 즉시(예약 제외) | 대여자 | O | O | – |
| 20 | `book_started` | 예약 시작일 09:00 KST | 대여자 | O | O | – |
| 21 | `book_extended` | 연장 신청 직후 | 대여자 | O | O | – |
| 22 | `book_due_tomorrow` | 매일 09:00 KST | 대여자 | O | O | – |
| 23 | `book_due_today` | 매일 09:00 KST | 대여자 | O | O | – |
| 24 | `book_overdue` | 매일 09:00 KST | 대여자 | O | O | – |
| 25 | `book_penalty_applied` | 반납 시 제재 확정 | 대여자 | O | O | – |
| 26 | `book_penalty_cleared` | 제재 만료·해제 | 대여자 | O | O | – |
| – | `book_requested` / `book_request_approved` / `book_request_rejected` | **폐지** (승인 플로우 종료) | – | – | – | – |

> 도서 알림은 **Teams 대상이 아니다.** `send-notification` 의 `teamsTargetTypes` 배열에 회의실 계열 11종만 들어 있다.
> 설정 화면에서도 Teams 열은 `—` 로 표시해 "켰는데 안 온다"를 만들지 않는다.

### 2.4 관리자 수신 알림 — 이번 작업의 초점

관리자에게 나가는 알림은 **5종**뿐이다.

| type | 기본 수신자 해석 | 실제 인원 | 상태 |
|---|---|---|---|
| `pending` | `profiles.role='ADMIN'` 전원 | 11명 | 발송 중 |
| `pending_expiring` | `profiles.role='ADMIN'` 전원 | 11명 | 호출 주석 처리 |
| `pending_expired` | `profiles.role='ADMIN'` 전원 | 11명 | 호출 주석 처리 |
| `book_requested` | `profiles.role='ADMIN'` 전원 | – | 폐지 |
| **`book_checkout_created`** | `admin_roles.role IN ('book','super')` | 지정 3명 | **신규** |

**여기서 드러난 구조적 문제**: 관리자 알림의 수신자가 `profiles.role='ADMIN'` 이라는 *화면 진입 권한*으로 결정된다.
"어드민 화면을 볼 수 있는 사람"과 "이 업무를 담당하는 사람"은 다른 개념인데 같은 값을 쓰고 있었다.
도서 대여처럼 하루 여러 건 발생하는 이벤트에서는 관리자 11명 전원에게 메일이 가고, 결국 아무도 읽지 않게 된다.

---

## 3. 발송 로직 (현재)

```
[호출부]  프론트 api.ts  /  Edge(cron: daily-reminder, checkin-reminder,
                              auto-cancel-bookings, book-due-reminder)
    │  POST send-notification { type, booking }
    ▼
[send-notification]
    ├─ POLICIES[type] 조회 ── 없으면 400
    ├─ ★ loadChannelFlags(type)          ← 신규: notification_settings
    ├─ Teams  : teamsTargetTypes 포함 && channels.teams
    ├─ resolveRecipients(rule, type)
    │      ├─ booker / attendees / admins / removedAttendees /
    │      │  formerBooker / bookBorrower / owner
    │      └─ ★ 관리자 규칙이면 notification_recipients 지정 명단이 우선
    ├─ 메일 : buildEmailItems → sendEmails      (channels.email)
    └─ 인앱 : sendInAppForAllRoles              (channels.inapp)
```

### 3.1 수신자 규칙 (RecipientRule)

| 규칙 | 해석 |
|---|---|
| `booker_only` | 예약자 1명 |
| `booker_and_attendees` | 예약자 + 참석자(예약자 제외) |
| `admins_only` | `profiles.role='ADMIN' AND is_active` |
| `booker_attendees_admins` | 위 셋 모두 |
| `removed_attendees` | 제외된 참석자 |
| `former_booker` | 이전 예약자 |
| `book_borrower` | 도서 대여자 본인 |
| **`book_admins`** | `admin_roles.role IN ('book','super')` + `profiles.is_active` |

`owner`(본문의 예약자/대여자 행)는 규칙과 무관하게 `booking.user_id` 로 항상 해석된다 —
수신자와 주체는 다른 개념이기 때문이다.

---

## 4. 신규 설정 구조

### 4.1 테이블

```sql
notification_settings   (type, channel, enabled, updated_at, updated_by)   -- PK(type, channel)
notification_recipients (id, type, user_id, created_at, created_by)        -- UNIQUE(type, user_id)
```

### 4.2 핵심 규칙 세 가지

**① 미설정 = 켜짐 (fail-open)**

행이 없거나 조회가 실패하면 **발송한다.**
알림이 한 번 더 가는 것보다 "예약이 잡혔는데 아무도 모르는" 쪽이 훨씬 비싸다.
새 알림 타입을 추가하고 시드를 깜빡해도 조용히 죽지 않는다.
**끄는 것은 언제나 명시적 행위**(`enabled=false` 행)여야 한다.

프론트 `isChannelEnabled()` 와 Edge `loadChannelFlags()` 가 같은 해석을 쓴다.
둘이 어긋나면 "화면은 꺼짐인데 메일은 오는" 상태가 된다.

**② 수신자 지정 = 대체이지 차단이 아니다**

`notification_recipients` 에 그 타입의 행이 하나라도 있으면 **그 명단만** 받는다.
행이 없으면 기존 규칙대로. 비우면 규칙으로 되돌아간다 —
완전히 멈추려면 채널 토글을 쓴다. 두 행위를 한 UI에 섞지 않는다.

단, 지정 명단은 있는데 전원이 퇴사한 경우에는 **빈 목록 그대로 처리**한다.
여기서 "규칙으로 폴백"하면, 3명만 받도록 설정해 둔 알림이 어느 날 갑자기 관리자 전원에게 간다.

**③ 저장 시 퇴사자 제외**

`admin_set_notification_recipients` 가 `profiles.is_active` 를 확인하고 거른다.
저장은 됐는데 발송에서 빠지면 "설정했는데 안 온다"가 된다.

### 4.3 권한

- 테이블 RLS: `is_profile_admin() OR has_admin_role('super')` — 읽기·쓰기 모두
- 변경은 전부 `SECURITY DEFINER` RPC 경유 (클라 직접 UPDATE 금지)
- Edge Function 은 `SERVICE_ROLE_KEY` 라 RLS 우회 → 발송 경로는 영향 없음

### 4.4 어드민 화면

`어드민 > 알림 설정` (`#admin-tab-notifications`)

- 그룹별(회의실 / 체크인·노쇼 / 도서관 / 연체 제재) 표 × 채널 3열 토글
- 지원하지 않는 채널은 `—` (도서 알림의 Teams 등)
- 폐지 알림은 기본 숨김, 체크박스로 표시
- 관리자 수신 알림만 하단에서 수신자 편집(검색 → 칩 추가 → 저장)
- **낙관적 갱신 없음** — RPC 성공 후에만 화면 반영.
  알림 설정은 실패를 즉시 알아채기 어려운 자리(다음 이벤트가 나야 드러난다)라,
  화면이 먼저 바뀌면 꺼진 줄 알고 넘어간다.

---

## 5. 이번 배포로 확정된 운영 규칙

| 알림 | 수신자 | 근거 |
|---|---|---|
| `book_checkout_created` | **고현정, 박찬희, 송보람** | 도서 운영 담당. `notification_recipients` 시드 |

마이그레이션은 이름으로 3명을 찾아 넣고, **결과가 정확히 3명이 아니면 전체 롤백**한다.
동명이인·미등록 계정을 조용히 넘기면 "왜 안 오지"를 나중에 추적해야 한다.

담당자 변경은 이제 **배포 없이 어드민 화면에서** 처리한다.

---

## 6. 남은 과제

1. `pending_expiring` / `pending_expired` 호출 블록 주석 해제 — v3 재설계 후.
   설정 화면이 생겼으므로, 이제는 코드 주석이 아니라 **채널 OFF** 로 표현하는 것이 맞다.
2. `notifications.type` CHECK 제약 여부 확인 (`_diagnose_book_notify_20260723.sql` [3]).
   제약이 있으면 신규 타입 추가 시 인앱만 조용히 실패한다.
3. Teams 웹훅 미사용 상태 정리 — 채널 열을 계속 노출할지 결정 필요.
4. 알림 발송 로그 테이블 부재. 현재는 Edge Function 콘솔 로그가 유일한 추적 수단이라
   "그 메일이 실제로 나갔는가"를 사후에 확인할 수 없다.
