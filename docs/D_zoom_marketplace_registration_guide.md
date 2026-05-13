# Phase D: Zoom Marketplace 9계정 등록 가이드

**작업자**: 고지님 (직접 작업)  
**예상 소요**: 계정당 약 10분 × 9 = **약 1.5시간**  
**전제**: `20260511_v2_extension_schema.sql` 실행 완료 (zoom_accounts 테이블 존재)

---

## 0. 사전 준비 (1회)

### 0-1. 암호화 키 생성

`zoom_accounts.oauth_client_secret_enc` 컬럼은 `pgcrypto`의 `pgp_sym_encrypt`로 암호화 저장합니다. 키는 단 한 곳, **Supabase 환경변수**에만 보관합니다.

**키 생성** (로컬 터미널):
```bash
openssl rand -base64 32
# 예시 출력: V2hKx7nQ8mPzL5jR2tY4uW9cN1aF6sH3=
```

생성된 키를 안전한 곳에 임시 보관 (1Password 등).

### 0-2. Supabase 환경변수 등록

Supabase Dashboard → Edge Functions → Secrets:
```
ZOOM_SECRET_KEY = <위에서 생성한 키>
```

⚠️ 이 키를 잃어버리면 9개 계정의 client_secret 모두 복호화 불가능 → 재등록 필요. 반드시 백업.

### 0-3. pgcrypto 확장 확인

Supabase SQL Editor에서:
```sql
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';
```

결과가 비어있으면:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```
(Supabase는 기본 활성화되어 있을 가능성 높음)

---

## 1. 계정별 등록 절차 (9회 반복)

각 계정마다 아래 절차를 그대로 반복합니다. 시작 전 9개 계정의 비밀번호 `Welcome123`을 안전한 비밀번호로 변경하는 것을 강력히 권장합니다 (Marketplace 등록 후).

### 1-1. Zoom Marketplace 로그인

1. **`cnrres1@gmail.com`** 으로 Zoom에 로그인 (https://zoom.us)
2. Marketplace 이동: https://marketplace.zoom.us
3. 우측 상단 **Develop → Build App** 클릭

### 1-2. Server-to-Server OAuth 앱 생성

1. **"Server-to-Server OAuth"** 카드의 **Create** 클릭
2. 앱 이름 입력: `CNR Space - 1번` (계정 번호에 맞게)
3. **Create** 클릭

### 1-3. App Credentials 확인 (📋 복사)

좌측 메뉴 **App Credentials** 탭:

```
Account ID:    [복사]   ← INSERT의 zoom_account_id
Client ID:     [복사]   ← INSERT의 oauth_client_id
Client Secret: [복사]   ← INSERT의 oauth_client_secret_enc (암호화 대상)
```

⚠️ Client Secret은 한 번만 표시됩니다. 안전한 곳에 즉시 복사.

### 1-4. Information 입력

좌측 메뉴 **Information** 탭 → 필수 항목 채우기:

| 항목 | 값 |
|---|---|
| App Name | CNR Space - 1번 |
| Short Description | C&R Research 사내 Zoom 미팅 예약 시스템 |
| Long Description | 내부 메모용 임의 입력 가능 |
| Company Name | (주)씨엔알리서치 |
| Developer Name | 고현정 |
| Developer Email | gohyunjung@cnrres.com |

### 1-5. Scopes 설정 (가장 중요)

좌측 메뉴 **Scopes** 탭 → **+ Add Scopes**:

다음 4개 scope를 **반드시** 추가:

| Scope | 용도 |
|---|---|
| `meeting:read:admin` | 미팅 정보 조회 |
| `meeting:write:admin` | 미팅 생성/수정/삭제 ← 핵심 |
| `user:read:admin` | 사용자(=계정) 정보 조회 |
| `user:read` | 호스트 키 등 프로필 조회 |

추가 후 **Done** → **Continue**.

### 1-6. Activation

좌측 메뉴 **Activation** 탭 → **Activate your app** 클릭.

✅ 앱이 활성화되면 토큰 발급 가능 상태.

### 1-7. Host Key 확인

별도 탭에서 https://zoom.us/profile 접속 (cnrres1 로그인 상태):

1. 좌측 **Profile** 클릭
2. 우측에서 **Host Key** 항목 찾기
3. **Show** 클릭 → 6자리 숫자 확인 (예: `123456`)
4. 복사 (INSERT의 `host_key`에 사용)

⚠️ Host Key가 너무 단순하다면 **Edit**으로 강한 6자리로 변경하고 다시 복사.

### 1-8. DB INSERT (1개 계정)

Supabase SQL Editor에서 아래 SQL 실행. 각 `<...>` 부분을 1-3, 1-7에서 복사한 값으로 교체:

```sql
INSERT INTO zoom_accounts (
  email,
  display_name,
  host_key,
  oauth_client_id,
  oauth_client_secret_enc,
  zoom_account_id,
  sort_order
) VALUES (
  'cnrres1@gmail.com',
  '회사 Zoom 1번',
  '<여기에 6자리 Host Key>',
  '<여기에 Client ID>',
  pgp_sym_encrypt(
    '<여기에 Client Secret>',
    current_setting('app.zoom_secret_key')
  ),
  '<여기에 Account ID>',
  1
);
```

⚠️ `current_setting('app.zoom_secret_key')`는 Supabase 환경변수에서 자동 조회되지 않습니다. **두 가지 옵션**:

**옵션 A (간단, 권장)**: SQL 실행 직전에 세션 변수 설정
```sql
SET app.zoom_secret_key = '<0-1에서 생성한 키>';
-- 이어서 위 INSERT 실행
```
세션 종료 시 자동 소멸하므로 보안상 안전. **단, 매 INSERT마다 SET 필요.**

**옵션 B (영구)**: PostgreSQL 설정에 등록
```sql
ALTER DATABASE postgres SET app.zoom_secret_key = '<키>';
```
DB 전체에 영구 적용. SQL Editor 재접속 후에도 유지. **다만 키가 DB 설정에 평문 저장됨.**

→ 추천: **9번 등록 동안만 옵션 A** 사용 후, 작업 끝나면 키를 SQL Editor에서 완전히 제거.

### 1-9. 검증 (1개 계정)

방금 INSERT한 row가 정상이고 복호화 가능한지 확인:

```sql
SET app.zoom_secret_key = '<키>';

SELECT
  email,
  display_name,
  oauth_client_id,
  pgp_sym_decrypt(
    oauth_client_secret_enc::bytea,
    current_setting('app.zoom_secret_key')
  ) AS decrypted_secret,
  host_key
FROM zoom_accounts
WHERE email = 'cnrres1@gmail.com';
```

`decrypted_secret`이 원본 Client Secret과 일치하면 ✓.

---

## 2. 반복

위 1-1 ~ 1-9를 9개 계정에 대해 반복:

| # | 이메일 | display_name | sort_order |
|---|---|---|---|
| 1 | cnrres1@gmail.com | 회사 Zoom 1번 | 1 |
| 2 | cnrres2@gmail.com | 회사 Zoom 2번 | 2 |
| 3 | cnrres3@gmail.com | 회사 Zoom 3번 | 3 |
| 4 | cnrres11@gmail.com | 회사 Zoom 11번 | 4 |
| 5 | cnrres12@gmail.com | 회사 Zoom 12번 | 5 |
| 6 | cnrres13@gmail.com | 회사 Zoom 13번 | 6 |
| 7 | cnrres21@gmail.com | 회사 Zoom 21번 | 7 |
| 8 | cnrres22@gmail.com | 회사 Zoom 22번 | 8 |
| 9 | cnrres23@gmail.com | 회사 Zoom 23번 | 9 |

---

## 3. 최종 검증

9개 모두 등록 후:

```sql
-- 9개 row 모두 존재 확인
SELECT id, email, display_name, sort_order, active
FROM zoom_accounts
ORDER BY sort_order;

-- 모든 secret이 복호화 가능한지 일괄 검증
SET app.zoom_secret_key = '<키>';
SELECT
  email,
  CASE
    WHEN pgp_sym_decrypt(oauth_client_secret_enc::bytea,
                         current_setting('app.zoom_secret_key')) IS NOT NULL
    THEN '✓'
    ELSE '✗'
  END AS secret_ok
FROM zoom_accounts
ORDER BY sort_order;
```

모두 ✓ 표시되면 Phase D 완료.

---

## 4. 등록 후 보안 마무리

- [ ] 9개 Gmail 계정의 비밀번호를 `Welcome123`에서 강한 비밀번호로 일괄 변경
- [ ] Marketplace 등록 시 사용한 Client Secret 메모를 안전한 곳에 보관 (1Password 등)
- [ ] SQL Editor 히스토리에서 `app.zoom_secret_key` 관련 SQL 모두 삭제 (브라우저)
- [ ] 작업용 임시 메모(클립보드, 텍스트 에디터 등)에서 secret/host_key 모두 삭제

---

## 5. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| Marketplace에서 "You are not eligible to create an app" | 해당 계정에 admin 권한 없음 | 9개 계정은 별도 독립 어카운트이므로 자기 자신이 admin. Zoom 로그아웃 → 다시 로그인 |
| Scope 추가 시 일부 항목이 회색 처리 | Free 플랜 한정. Workplace Business 확인 필요 | IT팀에 라이센스 상태 확인 |
| `pgp_sym_encrypt` 함수 not found | pgcrypto 확장 미설치 | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` |
| 복호화 시 결과가 깨짐 | 세션 변수 키가 인코딩 등록 시점과 다름 | INSERT 시점과 동일한 키로 SET 후 재시도 |

---

## 6. 다음 단계 (Phase A 진행 전 체크)

Phase D 완료 후 Phase A(RLS 정책)로 넘어가기 전에 확인:

- [ ] `SELECT COUNT(*) FROM zoom_accounts` = 9
- [ ] 모든 9개 row의 `oauth_client_secret_enc`가 NULL이 아니고 복호화 가능
- [ ] 모든 9개 row의 `host_key`가 정확한 6자리 숫자
- [ ] `active = true` (전부 기본값)
- [ ] Supabase Secrets에 `ZOOM_SECRET_KEY` 등록 확인 (Edge Function에서 사용 예정)

완료되면 Phase A로 넘어가 RLS 정책 마이그레이션 진행.
