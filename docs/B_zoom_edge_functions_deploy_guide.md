# Phase B: Edge Function 배포 및 테스트 가이드

**작성일**: 2026-05-13  
**전제 조건**:
- DB 스키마 r5 적용 완료
- `zoom_accounts` 9 rows 등록 완료
- Supabase Secrets 3개 등록 완료 (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`)

---

## 파일 구조

```
supabase/functions/
├── _shared/
│   └── zoom-oauth.ts            ← 신규 (공유 OAuth 헬퍼)
├── create-zoom-meeting/
│   └── index.ts                 ← 신규
└── delete-zoom-meeting/
    └── index.ts                 ← 신규
```

---

## Step 1. 파일 배치

전달드린 파일 3개를 로컬 `cnr-space` 프로젝트의 다음 위치에 복사:

```bash
# 프로젝트 루트로 이동 가정
cd ~/cnr-space   # (실제 경로에 맞게 조정)

# _shared/zoom-oauth.ts 추가
cp /path/to/zoom-oauth.ts supabase/functions/_shared/zoom-oauth.ts

# create-zoom-meeting 신규 디렉토리
mkdir -p supabase/functions/create-zoom-meeting
cp /path/to/create-zoom-meeting-index.ts supabase/functions/create-zoom-meeting/index.ts

# delete-zoom-meeting 신규 디렉토리
mkdir -p supabase/functions/delete-zoom-meeting
cp /path/to/delete-zoom-meeting-index.ts supabase/functions/delete-zoom-meeting/index.ts
```

---

## Step 2. 배포

```bash
cd ~/cnr-space

# 1) create-zoom-meeting 배포
supabase functions deploy create-zoom-meeting \
  --project-ref jjzcqpbwkkujttwxksvy \
  --no-verify-jwt

# 2) delete-zoom-meeting 배포
supabase functions deploy delete-zoom-meeting \
  --project-ref jjzcqpbwkkujttwxksvy \
  --no-verify-jwt
```

각 명령어 실행 후 출력에서 다음을 확인:
- `Deployed Function <함수명> on project jjzcqpbwkkujttwxksvy` 메시지
- 함수 URL: `https://jjzcqpbwkkujttwxksvy.supabase.co/functions/v1/<함수명>`

⚠️ `_shared/zoom-oauth.ts`는 별도 배포 불필요. import 시 자동 포함됩니다.

---

## Step 3. 통합 테스트 (Supabase SQL Editor 활용)

배포만으로는 동작이 검증되지 않으니, **실제 미팅 1건을 생성/취소**해서 end-to-end 확인합니다.

### 3-1. 테스트용 booking INSERT

```sql
-- 본인 user_id 확인
SELECT id, email FROM auth.users WHERE email = 'gohyunjung@cnrres.com';

-- 테스트 booking INSERT (cnrres1 계정으로, 10분 후 시작 30분 미팅)
INSERT INTO zoom_bookings (
  zoom_account_id,
  user_id,
  title,
  start_time,
  end_time,
  status
) VALUES (
  1,                                                  -- cnrres1 (sort_order=1의 id 확인 필요)
  '<위에서 확인한 본인 user_id>',
  '[테스트] Zoom 연동 테스트 미팅',
  now() + interval '10 minutes',
  now() + interval '40 minutes',
  'pending'
)
RETURNING id;
-- ↑ 반환된 booking_id를 다음 단계에서 사용
```

⚠️ `zoom_account_id`는 `zoom_accounts` 테이블의 실제 id 값. `SELECT id FROM zoom_accounts WHERE email='cnrres1@gmail.com'`로 먼저 확인.

### 3-2. create-zoom-meeting 호출

```bash
# 방법 A: curl로 직접 호출
curl -X POST \
  https://jjzcqpbwkkujttwxksvy.supabase.co/functions/v1/create-zoom-meeting \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "<3-1에서 반환된 uuid>"}'
```

`<ANON_KEY>`는 Supabase Dashboard → Settings → API → Project API keys → `anon` `public` 값.

**기대 응답 (200)**:
```json
{
  "zoom_meeting_id": "82345678901",
  "join_url": "https://us02web.zoom.us/j/82345678901?pwd=...",
  "passcode": "abc123",
  "host_key": "123456"
}
```

### 3-3. DB 상태 확인

```sql
SELECT id, status, zoom_meeting_id, join_url, passcode
FROM zoom_bookings
WHERE id = '<3-1 uuid>';
-- 기대: status='confirmed', zoom_meeting_id/join_url/passcode 모두 채워짐
```

### 3-4. Zoom 측 확인

- https://zoom.us에 cnrres1로 로그인
- 좌측 **회의 (Meetings)** → **예정** 탭
- 방금 생성한 "[테스트] Zoom 연동 테스트 미팅" 표시됨 ← 정상

### 3-5. delete-zoom-meeting 호출

```bash
curl -X POST \
  https://jjzcqpbwkkujttwxksvy.supabase.co/functions/v1/delete-zoom-meeting \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "<3-1 uuid>", "cancelled_by": "user"}'
```

**기대 응답 (200)**:
```json
{
  "cancelled": true,
  "zoom_meeting_id": "82345678901"
}
```

### 3-6. 취소 후 상태 확인

```sql
SELECT id, status, cancelled_by, cancelled_at, zoom_meeting_id
FROM zoom_bookings
WHERE id = '<3-1 uuid>';
-- 기대: status='cancelled', cancelled_by='user', cancelled_at=현재 시각
```

- Zoom 측에서도 미팅이 삭제됐는지 확인 (목록에서 사라짐)

### 3-7. zoom_oauth_token 캐시 확인

```sql
SELECT id, length(access_token) AS token_len, expires_at, refreshed_at
FROM zoom_oauth_token;
-- 기대: 1 row, token_len 약 50~100자, expires_at은 약 1시간 후
```

### 3-8. 테스트 booking 정리

```sql
DELETE FROM zoom_bookings WHERE title LIKE '[테스트]%';
```

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 응답 500 `ZOOM_ACCOUNT_ID not configured` | Supabase Secrets에 등록 안 됨 | Dashboard → Edge Functions → Secrets 확인 |
| 응답 502 `Zoom API error 401 unauthorized` | client_id/secret 잘못 입력 또는 Zoom 앱이 Activate 안 됨 | Zoom Marketplace에서 앱 Activation 상태 확인 |
| 응답 502 `Zoom API error 400 ... invalid email` | zoom_accounts.email이 Zoom 측 sub-user와 불일치 | `SELECT email FROM zoom_accounts` 확인 |
| 응답 502 `... invalid_grant` | account_id 잘못됨 | base64 형식의 Account ID인지 확인 (숫자 X) |
| 미팅은 생성됐는데 응답 500 | 6단계 DB UPDATE 실패 | Edge Function 로그 확인 (Supabase Dashboard) |

---

## Edge Function 로그 확인 방법

Supabase Dashboard → Edge Functions → 함수 클릭 → **Logs** 탭. 실시간 로그 보임.

또는 CLI:
```bash
supabase functions logs create-zoom-meeting --project-ref jjzcqpbwkkujttwxksvy
```

---

## 다음 단계

✅ Phase B 배포 + 통합 테스트 통과 후:

- **Phase C**: 사용자 화면 (예약 페이지 UI) 와이어프레임 + Figma 작업
- **Phase A 적용**: RLS 정책 마이그레이션 (이미 작성됨) + 첫 super 관리자 INSERT
- **Frontend 연동**: React에서 `supabase.functions.invoke('create-zoom-meeting', ...)` 호출

테스트 결과나 막히는 부분 있으면 알려주세요.
