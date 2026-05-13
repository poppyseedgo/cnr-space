# Phase D: ZOOM 환경변수 등록 + 9개 sub-user 호스트키 수집

**작업자**: 고지님  
**예상 소요**: 환경변수 5분 + 호스트키 9 × 2분 = **약 25분**  
**전제**:
- DB 스키마 r5 적용 완료 (`zoom_accounts`, `zoom_oauth_token` 테이블 존재)
- knkim님으로부터 자격증명 3개 수령 완료

---

## Step 1. Supabase Edge Function 환경변수 등록 (5분)

### 1-1. 환경변수 등록

Supabase Dashboard 접속 → 좌측 메뉴 **Edge Functions** → 상단 **Secrets** 탭 → **Add new secret** 버튼.

다음 3개 등록:

| Name | Value |
|---|---|
| `ZOOM_ACCOUNT_ID` | `51672994` |
| `ZOOM_CLIENT_ID` | knkim님이 전달한 Client ID |
| `ZOOM_CLIENT_SECRET` | knkim님이 전달한 Client Secret |

### 1-2. 검증

좌측 메뉴 **Settings → Edge Functions → Secrets**에서 3개가 모두 표시되는지 확인. 
값은 보이지 않지만 이름은 보입니다.

⚠️ **Client Secret 보관**: knkim님께 받은 메모는 안전한 곳(1Password 등)에 보관 후, 메일/메신저 등 평문 채널에서는 즉시 삭제하세요.

---

## Step 2. 9개 sub-user 호스트키 수집 (9 × 2분 = 약 18분)

### 2-1. 첫 번째 계정 진행 (cnrres1@gmail.com)

1. **https://zoom.us/profile** 접속
2. cnrres1@gmail.com / `Welcome123`으로 로그인 (또는 이미 변경된 비밀번호)
3. 좌측 **Profile** 메뉴 클릭 (이미 기본)
4. 우측 페이지에서 **"호스트 키" (Host Key)** 항목 찾기 (페이지 중간~하단)
5. **표시** 또는 **Show** 클릭 → 6자리 숫자 확인 (예: `123456`)
6. 6자리 숫자 복사

⚠️ **권장**: 호스트 키가 너무 단순한 패턴(예: `111111`, `123456`)이면 **편집 → 변경** 클릭해서 강한 6자리로 변경 후 복사.

### 2-2. DB INSERT (cnrres1)

Supabase SQL Editor에서:

```sql
INSERT INTO zoom_accounts (email, display_name, host_key, sort_order)
VALUES ('cnrres1@gmail.com', '회사 Zoom 1번', '<여기에 6자리>', 1);
```

### 2-3. 나머지 8개 계정 반복

각 계정에 대해 위 2-1 ~ 2-2를 반복. 9개 모두 끝나면 한 번에 묶어서 INSERT해도 됩니다:

```sql
-- 9개 한 번에 INSERT (호스트키 9개 수집 완료 후)
INSERT INTO zoom_accounts (email, display_name, host_key, sort_order) VALUES
  ('cnrres1@gmail.com',  '회사 Zoom 1번',  '<6자리>', 1),
  ('cnrres2@gmail.com',  '회사 Zoom 2번',  '<6자리>', 2),
  ('cnrres3@gmail.com',  '회사 Zoom 3번',  '<6자리>', 3),
  ('cnrres11@gmail.com', '회사 Zoom 11번', '<6자리>', 4),
  ('cnrres12@gmail.com', '회사 Zoom 12번', '<6자리>', 5),
  ('cnrres13@gmail.com', '회사 Zoom 13번', '<6자리>', 6),
  ('cnrres21@gmail.com', '회사 Zoom 21번', '<6자리>', 7),
  ('cnrres22@gmail.com', '회사 Zoom 22번', '<6자리>', 8),
  ('cnrres23@gmail.com', '회사 Zoom 23번', '<6자리>', 9);
```

---

## Step 3. 검증 (2분)

다음 쿼리로 9개 row가 모두 정상 등록됐는지 확인:

```sql
-- 1) 9개 모두 INSERT됐는지
SELECT count(*) AS total FROM zoom_accounts;
-- 기대값: 9

-- 2) 각 row 상태 확인
SELECT id, email, display_name, host_key, sort_order, active
FROM zoom_accounts
ORDER BY sort_order;
-- 기대값: 9 rows, 모든 host_key가 6자리 숫자, active=true

-- 3) host_key 형식 검증 (모두 6자리 숫자인지)
SELECT email, host_key
FROM zoom_accounts
WHERE host_key !~ '^[0-9]{6}$';
-- 기대값: 0 rows (모두 6자리 숫자면 통과)

-- 4) 중복 host_key 확인 (보안상 동일 키 사용은 비추천)
SELECT host_key, count(*) AS cnt
FROM zoom_accounts
GROUP BY host_key
HAVING count(*) > 1;
-- 기대값: 0 rows
```

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| Zoom 로그인 시 "이 계정은 다른 계정에 의해 관리됨" 경고 | 마스터 어카운트 sub-user 정상 동작 | 무시하고 계속 진행 가능 |
| Profile에서 "Host Key" 항목이 안 보임 | 페이지 스크롤 더 내리기. 또는 "추가 정보 보기" 클릭 필요할 수 있음 | "보안" 섹션 근처에 있음 |
| INSERT 시 `null value in column "host_key"` 에러 | host_key를 비워둠 | 6자리 숫자 채워서 다시 INSERT |
| INSERT 시 `duplicate key value violates unique constraint` | 같은 email로 이미 INSERT됨 | 기존 row 확인 후 필요 시 DELETE 또는 UPDATE |

---

## Phase D 완료 후 다음 단계

✅ 환경변수 3개 등록 완료  
✅ zoom_accounts 9 rows 정상 등록  
✅ 모든 host_key 6자리 숫자 확인  

→ **Phase B 진행**: `create-zoom-meeting` Edge Function 코드 작성 + Zoom API 호출 테스트
