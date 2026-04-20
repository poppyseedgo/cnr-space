# C&R SPACE Pilot Survey

CTM 파일럿 테스트(2026-04-20)를 위한 실시간 설문 응답 페이지.

## 🏗 아키텍처

```
[사용자 브라우저]
    ↓ 응답 변경
[Vanilla JS + Vite]
    ↓ 즉시 (라디오/체크) / 500ms 디바운스 (텍스트)
[localStorage 백업]  ←  네트워크 실패 시 보존 (근본 해결)
    ↓ upsert
[Supabase REST API]
    ↓
[survey_responses 테이블]
```

## 📁 프로젝트 구조

```
cnr-pilot-survey/
├── index.html                  # 기본 셸
├── src/
│   ├── main.js                 # 앱 진입점 - 슬라이드 렌더링/네비게이션
│   ├── survey-data.js          # 전체 17 슬라이드 문항 데이터
│   ├── supabase-client.js      # Supabase REST + 실시간 저장
│   └── styles.css              # 전체 스타일
├── supabase_schema.sql         # Supabase 테이블/RLS/트리거 DDL
├── vite.config.js
├── package.json
└── .env.example
```

## 🚀 배포 순서

### 1. Supabase 스키마 적용 (최초 1회)

1. Supabase Dashboard → https://supabase.com/dashboard/project/jjzcqpbwkkujttwxksvy
2. 좌측 **SQL Editor** 열기
3. `supabase_schema.sql` 파일 전체 복사하여 붙여넣기
4. **Run** 클릭 → `survey_responses` 테이블 + RLS 정책 + View 생성

### 2. 로컬 개발/확인

```bash
# Supabase anon key 설정 (.env.local 생성)
echo "VITE_SUPABASE_ANON_KEY=eyJhbGc..." > .env.local

npm install
npm run dev
# → http://localhost:5173
```

### 3. Cloudflare Pages 배포 (권장 방식: GitHub 연동)

1. GitHub에 새 저장소 `cnr-pilot-survey` 생성 후 푸시
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 저장소 선택 후 빌드 설정:
   - **Framework preset**: None
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Environment variables**:
     - `VITE_SUPABASE_ANON_KEY` = `(Supabase anon key)`
4. **Save and Deploy**
5. 배포 완료 후 URL 확인: `cnr-pilot-survey.pages.dev`

### 4. Direct Upload (빠른 테스트용)

```bash
# 빌드
npm run build

# wrangler 설치 (1회)
npm install -g wrangler

# 배포
wrangler pages deploy dist --project-name cnr-pilot-survey
```

## 🔧 주요 기능

- ✅ **실시간 자동 저장**: 라디오/체크박스는 즉시, 텍스트는 500ms 디바운스
- ✅ **이탈 복구**: 브라우저 재접속 시 session_id로 이어서 응답 가능
- ✅ **네트워크 실패 방어**: localStorage 백업으로 데이터 유실 방지
- ✅ **반응형**: 모바일 375px ~ 데스크탑 대응
- ✅ **XSS 방어**: 모든 사용자 입력 escape 처리
- ✅ **접근성**: 44px 최소 탭 타겟, 포커스 표시, ARIA 라벨

## 📊 응답 조회

Supabase SQL Editor에서:

```sql
-- 전체 응답 요약
SELECT * FROM survey_summary;

-- 완료된 응답만
SELECT
  respondent_name,
  anonymous,
  answers,
  created_at,
  updated_at
FROM survey_responses
WHERE is_completed = true
ORDER BY updated_at DESC;

-- 특정 Task 체크 비율 (예: Task 3 예약 완료)
SELECT
  COUNT(*) FILTER (WHERE (answers->>'t3_book_complete')::boolean = true) AS checked,
  COUNT(*) AS total
FROM survey_responses
WHERE is_completed = true;
```

## 🆘 문제 해결

- **저장이 안 됨** → 브라우저 콘솔 → `cnr_pilot_backup` localStorage 키 확인. 데이터는 살아있음.
- **중복 응답 방지가 필요** → `session_id` 대신 `respondent_name` UNIQUE 제약 추가 필요.
- **URL에 `?reset=1`** 붙이면 세션 초기화 (테스트용).
