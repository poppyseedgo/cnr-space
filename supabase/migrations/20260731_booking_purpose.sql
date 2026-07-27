-- ═══════════════════════════════════════════════════════════════════════════
-- 20260731_booking_purpose.sql — 예약 '목적' 카테고리 컬럼 추가
-- ═══════════════════════════════════════════════════════════════════════════
-- [2026-07-27 Phase 1] 회의실 예약 목적 카테고리 신규 기능
--   · bookings.purpose        : 목적 코드 (10종, NULL = 과거 예약 / 미지정)
--   · bookings.purpose_detail : '기타(etc)' 선택 시 구체 사유 (최대 40자)
--
--   설계 근거:
--     · 사용자가 직접 선택하는 값이라 title 파생 불가 → DB 컬럼 저장이 정답
--       (2026-07-23 확정한 "DB 컬럼 승격 조건: 사용자 수동 입력" 케이스)
--     · 기존 대시보드 title 파생 분류(meetingPurpose.ts)와는 별개 체계 —
--       어드민 통계 반영은 한 달 운영 후 별건 진행 (2026-07-27 고지 확정)
--     · 코드 저장(라벨 아님): 라벨 문구 변경 시 백필 불필요, 집계 키 안정
--
--   제약:
--     · purpose 는 10코드 외 값 차단 (NULL 은 과거 예약이라 허용)
--     · purpose_detail 은 purpose='etc' 일 때만 존재 가능, 1~40자
--       → "기타가 아닌데 detail 이 남는" 데이터 오염을 DB 레벨에서 원천 차단
--
--   멱등: 전체 재실행 안전 (IF NOT EXISTS / pg_constraint 존재 확인)
--   프론트 SSOT: src/data/bookingPurpose.ts (코드·라벨 목록과 반드시 일치)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 컬럼 추가 ────────────────────────────────────────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS purpose        text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS purpose_detail text;

COMMENT ON COLUMN public.bookings.purpose IS
  '회의 목적 코드 (audit/hr/task/survey/client/part/team/mgmt/training/etc). NULL=기능 도입 전 예약. SSOT: src/data/bookingPurpose.ts';
COMMENT ON COLUMN public.bookings.purpose_detail IS
  '목적이 etc(기타)일 때만 존재하는 구체 사유 (1~40자). etc 외에는 NULL 강제(CHECK)';

-- ── 2. CHECK 제약 (멱등 — 존재하면 스킵) ────────────────────────────────────
DO $$
BEGIN
  -- 2-1. 목적 코드 화이트리스트
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bookings_purpose_code' AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT chk_bookings_purpose_code
      CHECK (
        purpose IS NULL OR purpose IN (
          'audit', 'hr', 'task', 'survey', 'client',
          'part',  'team', 'mgmt', 'training', 'etc'
        )
      );
  END IF;

  -- 2-2. 기타 상세: etc 전용 + 1~40자
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bookings_purpose_detail' AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT chk_bookings_purpose_detail
      CHECK (
        purpose_detail IS NULL
        OR (purpose = 'etc' AND char_length(purpose_detail) BETWEEN 1 AND 40)
      );
  END IF;
END $$;

-- ── 3. 검증 (읽기 전용) ─────────────────────────────────────────────────────
-- 실행 후 아래 두 SELECT 로 적용 확인:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--     WHERE table_name='bookings' AND column_name LIKE 'purpose%';
--   SELECT conname FROM pg_constraint
--     WHERE conrelid='public.bookings'::regclass AND conname LIKE 'chk_bookings_purpose%';
