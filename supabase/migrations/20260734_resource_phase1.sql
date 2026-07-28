-- ============================================================================
-- 20260734_resource_phase1.sql
-- 자원예약(통합 자원등록 관리) Phase 1 — DB 기반
--
-- [2026-07-28] 확정 사항 반영:
--   ① admin_roles 'pointer' → 'resource' rename (진단 [9] 11명 보유 확인)
--   ② 점유 규칙: 반납일 > 사용일이면 반납일 19:00(KST)까지 독점
--      → occupied_until 트리거 계산 + EXCLUDE gist 원천 차단
--   ③ 반납은 관리자 "반납 확인" 액션 필수 → returned_at/returned_by,
--      비관리자의 반납 필드 변경은 트리거로 차단 (RLS는 컬럼 구분 불가)
--   ④ 진단 [1]~[3] 전부 0행 → pointer_* 3테이블 + RPC 2종 DROP (이관 없음)
--
-- 실행: Supabase SQL Editor에 전체 붙여넣기 → Run (단일 트랜잭션, 실패 시 전체 롤백)
-- 재실행: 멱등 아님(rename·DROP 포함) — 정상 완료 후 재실행 금지.
--         [0] 프리플라이트가 이중 실행을 스스로 차단한다.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [0] 프리플라이트 — 진단 시점과 상태가 달라졌으면 중단
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 진단(2026-07-28) 이후 실데이터가 생겼으면 DROP 금지 → 수동 확인 필요
  IF (SELECT count(*) FROM pointer_checkouts) > 0
     OR (SELECT count(*) FROM pointer_items) > 0
     OR (SELECT count(*) FROM pointer_types) > 0 THEN
    RAISE EXCEPTION 'POINTER_DATA_EXISTS: 진단 이후 pointer_* 에 데이터가 생겼습니다. 이관 여부를 먼저 결정하세요.';
  END IF;

  -- 이미 rename 됐다면(재실행) 중단
  IF EXISTS (SELECT 1 FROM admin_roles WHERE role = 'resource') THEN
    RAISE EXCEPTION 'ALREADY_MIGRATED: resource 역할이 이미 존재합니다. 이 파일은 재실행 대상이 아닙니다.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [1] EXCLUDE 제약 전제조건 (진단 [8] 설치 확인됨 — 방어적 멱등 실행)
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ────────────────────────────────────────────────────────────────────────────
-- [2] admin_roles 'pointer' → 'resource' rename
--     순서 중요: CHECK 를 먼저 내리고 → 데이터 UPDATE → 새 CHECK.
--     (새 CHECK 를 먼저 걸면 기존 'pointer' 11행이 위반이라 ALTER 실패
--      — Phase 2 에서 겪은 'meeting_room' CHECK 롤백과 동일한 함정)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_role_check;

UPDATE admin_roles SET role = 'resource' WHERE role = 'pointer';
-- ↑ UNIQUE(user_id, role) 충돌 없음 — 진단 [10] 에서 resource 0명 확인

ALTER TABLE admin_roles ADD CONSTRAINT admin_roles_role_check
  CHECK (role IN (
    'dashboard','booking','approval','room','user','visitor',
    'book','notification','notice','resource','super','kb',
    -- ⚠ 'pointer' 는 허용값에서 제거 — 데이터 0행 보장(위 UPDATE) 후이므로 안전.
    --    남겨두면 SQL 직접 부여로 되살아나 RLS 가 조용히 false 를 돌려주는
    --    "이름≠의미" 상태가 재발한다 (is_profile_admin 전철).
    -- 레거시 2종은 Phase 2 결정대로 유지 (실데이터 0건 실측, 무해)
    'zoom','meeting_room'
  ));

-- 감사 로그 — UPDATE 는 grant/revoke 경로를 타지 않으므로 이력을 직접 남긴다.
-- actor NULL = 프론트에서 '시스템' 으로 표시된다 (Phase 2 규칙).
INSERT INTO admin_role_grants (target_user, role, action, actor)
SELECT user_id, 'pointer', 'revoke', NULL FROM admin_roles WHERE role = 'resource';

INSERT INTO admin_role_grants (target_user, role, action, actor)
SELECT user_id, 'resource', 'grant', NULL FROM admin_roles WHERE role = 'resource';

-- ────────────────────────────────────────────────────────────────────────────
-- [3] 구 포인터 백엔드 폐기 (진단 [12] 정책 8개는 테이블과 함께 소멸)
-- ────────────────────────────────────────────────────────────────────────────
-- RPC 2종 — 로컬 저장소에 정의 파일이 없어 시그니처 불명 → pg_proc 에서 찾아 동적 DROP
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('borrow_pointer','return_pointer')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

-- FK 역순으로 DROP (checkouts → items → types)
DROP TABLE IF EXISTS pointer_checkouts;
DROP TABLE IF EXISTS pointer_items;
DROP TABLE IF EXISTS pointer_types;

-- ────────────────────────────────────────────────────────────────────────────
-- [4] 신규 테이블 3종
-- ────────────────────────────────────────────────────────────────────────────

-- [4-1] 자원 카테고리 — 예약 정책은 카테고리 레벨 컬럼
--       ("1시간 단위"는 포인터의 속성이지 자원예약의 속성이 아님)
CREATE TABLE resource_categories (
  id                int  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name              text NOT NULL UNIQUE,             -- 예: "레이저 포인터", "노트북"
  description       text,
  icon              text,                             -- 프론트 아이콘 키 (선택)
  slot_step_minutes int  NOT NULL DEFAULT 60
                    CHECK (slot_step_minutes IN (15, 30, 60)),
  allow_multi_day   boolean NOT NULL DEFAULT true,    -- false 면 모달에서 반납일 필드 숨김(당일 반납 강제)
  open_time         time NOT NULL DEFAULT '07:00',    -- KST 기준 (회의실 tOpts 관례)
  close_time        time NOT NULL DEFAULT '19:00',
  is_active         boolean NOT NULL DEFAULT true,    -- 삭제 대신 비활성 (예약 이력 보존)
  sort_order        int  NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (close_time > open_time)
);

-- [4-2] 개별 자원 개체
CREATE TABLE resource_items (
  id          int  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  category_id int  NOT NULL REFERENCES resource_categories(id),
  label       text NOT NULL,                          -- 표시명 (예: "P-01")
  asset_code  text UNIQUE,                            -- 회사 자산번호 (선택)
  status      text NOT NULL DEFAULT 'available'
              CHECK (status IN ('available','maintenance','retired')),
              -- 'borrowed' 없음 — 점유는 resource_bookings 에서 파생 (상태 저장 금지 원칙,
              --  회의실 getRoomStatus 와 동일). retired = 삭제 대체(이력 보존)
  memo        text,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, label)
);

-- [4-3] 예약 — 회의실 bookings 구조 준용 (snake_case, id text, 스냅샷+live 조회)
CREATE TABLE resource_bookings (
  id             text PRIMARY KEY,                    -- 클라 생성 'r{epoch_ms}_{n}' (bookings 'b...' 관례)
  item_id        int  NOT NULL REFERENCES resource_items(id),
  user_id        uuid NOT NULL,                       -- FK 없음 (bookings 패턴, live 는 users JOIN)
  user_email     text NOT NULL,                       -- UUID OR email 이중 식별 (프로젝트 규칙)
  user_name      text,                                -- 스냅샷 — 퇴사자 폴백 전용
  user_dept      text,
  start_at       timestamptz NOT NULL,                -- 사용 시작
  end_at         timestamptz NOT NULL,                -- 사용 종료 (같은 KST 날짜 — 트리거 검증)
  return_due     date NOT NULL,                       -- 반납일 (KST 날짜)
  occupied_until timestamptz NOT NULL,                -- 트리거 계산 — 클라 값 무시(조작 시 겹침 뚫림)
  status         text NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed','cancelled')),
  returned_at    timestamptz,                         -- 관리자 반납 확인 시각 (③ 확정)
  returned_by    uuid,                                -- 확인한 관리자
  cancelled_at   timestamptz,
  cancelled_by   text,                                -- 'user' | 'admin' | 'departed' (bookings 관례)
  memo           text CHECK (char_length(memo) <= 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  -- ② 점유 구간 겹침 원천 차단 — 취소 건은 제외 (partial EXCLUDE)
  CONSTRAINT resource_bookings_no_overlap
    EXCLUDE USING gist (item_id WITH =, tstzrange(start_at, occupied_until) WITH &&)
    WHERE (status = 'confirmed')
);

CREATE INDEX idx_resource_bookings_user    ON resource_bookings (user_id);
CREATE INDEX idx_resource_bookings_overdue ON resource_bookings (occupied_until)
  WHERE status = 'confirmed' AND returned_at IS NULL;  -- 연체 조회·알림 배치용

-- ────────────────────────────────────────────────────────────────────────────
-- [5] 트리거 2종
-- ────────────────────────────────────────────────────────────────────────────

-- [5-1] occupied_until 서버 계산 + 날짜 규칙 검증
--       KST 변환: (date + time)::timestamp(naive, KST 의미) AT TIME ZONE 'Asia/Seoul' → timestamptz
--       (KST 는 서머타임 없음 — 도서 알림 cron 과 동일 전제)
CREATE OR REPLACE FUNCTION resource_bookings_compute_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_kst date := (NEW.start_at AT TIME ZONE 'Asia/Seoul')::date;
  v_end_kst   date := (NEW.end_at   AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF v_end_kst <> v_start_kst THEN
    RAISE EXCEPTION 'USAGE_MUST_BE_SAME_DAY' USING ERRCODE = 'P0001';
    -- 사용시간은 하루 안(Figma: 사용일 1개 + 시작~종료). 여러 날 점유는 반납일로 표현
  END IF;
  IF NEW.return_due < v_start_kst THEN
    RAISE EXCEPTION 'RETURN_BEFORE_START' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.return_due = v_start_kst THEN
    NEW.occupied_until := NEW.end_at;                 -- 당일 반납 → 같은 날 다른 시간대 타인 예약 가능
  ELSE
    NEW.occupied_until :=
      (NEW.return_due::timestamp + interval '19 hours') AT TIME ZONE 'Asia/Seoul';
  END IF;                                             -- 반납일 19:00 KST 까지 독점 (② 확정)
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resource_bookings_occupancy
  BEFORE INSERT OR UPDATE OF start_at, end_at, return_due, occupied_until
  ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION resource_bookings_compute_occupancy();
  -- occupied_until 을 UPDATE OF 에 포함 → 클라가 직접 바꿔도 트리거가 재계산해 덮어씀

-- [5-2] 반납 확인은 관리자 전용 (③ 확정) — RLS 는 컬럼 단위 구분이 불가하므로 트리거가 근본 해결.
--       본인이 자기 예약의 returned_at 을 셀프 기입해 연체를 지우는 조작을 DB 레벨에서 차단
CREATE OR REPLACE FUNCTION resource_bookings_guard_return()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.returned_at IS DISTINCT FROM OLD.returned_at
      OR NEW.returned_by IS DISTINCT FROM OLD.returned_by)
     AND NOT has_admin_role('resource') THEN
    RAISE EXCEPTION 'RETURN_CONFIRM_ADMIN_ONLY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resource_bookings_guard_return
  BEFORE UPDATE ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION resource_bookings_guard_return();

-- ────────────────────────────────────────────────────────────────────────────
-- [6] RLS — 처음부터 has_admin_role('resource') 단독 기준
--     (is_profile_admin OR 분기는 [LEGACY · 신규 사용 금지] — 3-B 에서 상수 false)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE resource_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_bookings   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resource_categories_select_all" ON resource_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resource_categories_write_admin" ON resource_categories
  FOR ALL TO authenticated
  USING (has_admin_role('resource')) WITH CHECK (has_admin_role('resource'));

CREATE POLICY "resource_items_select_all" ON resource_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resource_items_write_admin" ON resource_items
  FOR ALL TO authenticated
  USING (has_admin_role('resource')) WITH CHECK (has_admin_role('resource'));

-- 예약: 전체 열람(가용성 표시), INSERT 는 본인 또는 관리자 대리예약(booker override —
-- 회의실 insertBooking 패턴, SECURITY DEFINER 불필요), 수정·취소는 본인 or 관리자
CREATE POLICY "resource_bookings_select_all" ON resource_bookings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resource_bookings_insert_self_or_admin" ON resource_bookings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR has_admin_role('resource'));
CREATE POLICY "resource_bookings_update_self_or_admin" ON resource_bookings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_admin_role('resource'))
  WITH CHECK (user_id = auth.uid() OR has_admin_role('resource'));
CREATE POLICY "resource_bookings_delete_admin" ON resource_bookings
  FOR DELETE TO authenticated
  USING (has_admin_role('resource'));

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- [7] 검증 — COMMIT 후 단일 결과셋 (전부 ✅ 이어야 정상)
-- ────────────────────────────────────────────────────────────────────────────
SELECT no, item, value FROM (
  SELECT 1 AS no, 'resource_* 3테이블'::text AS item,
         CASE WHEN to_regclass('resource_categories') IS NOT NULL
               AND to_regclass('resource_items') IS NOT NULL
               AND to_regclass('resource_bookings') IS NOT NULL
              THEN '✅' ELSE '❌' END AS value
  UNION ALL
  SELECT 2, 'pointer_* 3테이블 제거',
         CASE WHEN to_regclass('pointer_types') IS NULL
               AND to_regclass('pointer_items') IS NULL
               AND to_regclass('pointer_checkouts') IS NULL
              THEN '✅' ELSE '❌' END
  UNION ALL
  SELECT 3, 'admin_roles resource 보유자(11명 기대)',
         (SELECT count(*)::text || '명' FROM admin_roles WHERE role = 'resource')
  UNION ALL
  SELECT 4, 'admin_roles pointer 잔존(0 기대)',
         (SELECT count(*)::text FROM admin_roles WHERE role = 'pointer')
  UNION ALL
  SELECT 5, 'rename 감사로그(22건 기대)',
         (SELECT count(*)::text FROM admin_role_grants
          WHERE role IN ('pointer','resource') AND actor IS NULL)
  UNION ALL
  SELECT 6, 'EXCLUDE 제약',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname = 'resource_bookings_no_overlap')
              THEN '✅' ELSE '❌' END
  UNION ALL
  SELECT 7, '트리거 2종',
         (SELECT count(*)::text || '/2' FROM pg_trigger
          WHERE tgname IN ('trg_resource_bookings_occupancy',
                           'trg_resource_bookings_guard_return'))
  UNION ALL
  SELECT 8, 'resource_* RLS 정책 수(8 기대)',
         (SELECT count(*)::text FROM pg_policies
          WHERE tablename IN ('resource_categories','resource_items','resource_bookings'))
  UNION ALL
  SELECT 9, 'borrow/return RPC 제거',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p
                               JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'public'
                                 AND proname IN ('borrow_pointer','return_pointer'))
              THEN '✅' ELSE '❌' END
) t ORDER BY no;
