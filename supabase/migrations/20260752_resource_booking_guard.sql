-- ============================================================================
-- 20260752_resource_booking_guard.sql
-- 자원예약 — 시간 가드 + 기한 변경 규칙 (DB 방어선 신설)
--
-- [2026-08-26] 진단: resource_bookings 에는 회의실 bookings 가 가진
--   trg_prevent_past_booking(과거 시작 차단) / check_booking_date_limit(30일) 이 없고,
--   UPDATE RLS 는 컬럼 제한이 없어 예약자가 item_id·user_id·start_at 을 임의 변경 가능했다.
--   → 과거 시간 예약이 실제로 들어간 사고의 근본 원인. 프론트 필터는 표면.
--
-- 본 마이그레이션
--   ① 이력 컬럼 2 — period_changed_at / period_changed_by (최근 1회, 감사테이블은 잦아지면 그때)
--   ② INSERT 가드 — PAST_START(now-10분, 회의실 동일 여유) / PAST_RETURN_DUE / DATE_LIMIT_30D(비관리자)
--   ③ UPDATE 가드 — 기존 guard_return 흡수 + 불변 필드 + 상태별 기간 변경 규칙
--        · 비관리자: item_id / user_id 변경 불가 (IMMUTABLE_FIELD)
--        · 취소·반납완료 건: 기간 변경 불가 (BOOKING_CLOSED)
--        · 시작 후(now ≥ OLD.start_at): start_at 변경 불가 (START_LOCKED) — 관리자 포함, 과거는 못 바꾼다
--        · start_at 변경 시 과거 불가 (PAST_START) / 30일 초과 불가 (DATE_LIMIT_30D, 비관리자)
--        · end_at 변경 시 now 이전 불가 (PAST_END)  — 사용 중 단축은 now 까지
--        · return_due 변경 시 KST 오늘 이전 불가 (PAST_RETURN_DUE) — 앞당기기는 오늘까지(고지 확정)
--        · 기간 필드가 바뀌면 period_changed_at/by 자동 기록
--   ④ notifications.type CHECK 에 resource_booking_period_changed 추가 (20260748 §3 패턴)
--
-- 중복(겹침)은 계속 EXCLUDE resource_bookings_no_overlap 이 INSERT/UPDATE 모두 방어 — RLS 미사용(설계 확정).
-- session_user='postgres' 는 회의실 관례대로 우회(SQL Editor 복구 경로).
-- 실행: SQL Editor 전체 붙여넣기 → Run. 재실행 안전.
-- 배포 순서: 본 SQL → _shared/notification-types + send-notification 재배포 → 프론트
-- ============================================================================

BEGIN;

-- [1] 이력 컬럼
ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS period_changed_at timestamptz;
ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS period_changed_by uuid;
COMMENT ON COLUMN resource_bookings.period_changed_at IS '기간(사용시간·반납일) 최근 변경 시각 — 트리거 자동 기록';
COMMENT ON COLUMN resource_bookings.period_changed_by IS '기간 최근 변경자 auth.uid() — 예약자 본인 또는 자원 관리자';

-- [2] INSERT 가드
CREATE OR REPLACE FUNCTION public.resource_bookings_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF session_user = 'postgres' THEN RETURN NEW; END IF;

  -- 회의실 prevent_past_booking_insert 와 동일: 10분 여유(시계 오차 + 방금 시작한 예약)
  IF NEW.start_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'PAST_START' USING ERRCODE = '23514';
  END IF;
  IF NEW.return_due < v_today_kst THEN
    RAISE EXCEPTION 'PAST_RETURN_DUE' USING ERRCODE = '23514';
  END IF;
  -- 회의실 check_booking_date_limit 동일: 오늘+31일 00:00 KST 이전까지 (= 오늘+30일 23:59)
  IF NOT has_admin_role('resource')
     AND NEW.start_at >= ((v_today_kst + 31)::timestamp AT TIME ZONE 'Asia/Seoul') THEN
    RAISE EXCEPTION 'DATE_LIMIT_30D' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resource_bookings_guard_insert ON resource_bookings;
CREATE TRIGGER trg_resource_bookings_guard_insert
  BEFORE INSERT ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION resource_bookings_guard_insert();

-- [3] UPDATE 가드 — 기존 resource_bookings_guard_return 을 흡수·대체
CREATE OR REPLACE FUNCTION public.resource_bookings_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_admin      boolean := has_admin_role('resource');
  v_today_kst  date    := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_started    boolean := now() >= OLD.start_at;
  v_period_chg boolean := NEW.start_at   IS DISTINCT FROM OLD.start_at
                       OR NEW.end_at     IS DISTINCT FROM OLD.end_at
                       OR NEW.return_due IS DISTINCT FROM OLD.return_due;
BEGIN
  IF session_user = 'postgres' THEN RETURN NEW; END IF;

  -- (구 guard_return) 반납 확인은 관리자 전용
  IF (NEW.returned_at IS DISTINCT FROM OLD.returned_at
      OR NEW.returned_by IS DISTINCT FROM OLD.returned_by)
     AND NOT v_admin THEN
    RAISE EXCEPTION 'RETURN_CONFIRM_ADMIN_ONLY' USING ERRCODE = 'P0001';
  END IF;

  -- 불변 필드 — 개체 바꾸기는 취소 후 재예약(EXCLUDE 판정이 개체 기준)
  IF NOT v_admin AND (NEW.item_id IS DISTINCT FROM OLD.item_id
                      OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
  END IF;

  IF v_period_chg THEN
    IF OLD.status <> 'confirmed' OR OLD.returned_at IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_CLOSED' USING ERRCODE = 'P0001';
    END IF;
    IF v_started AND NEW.start_at IS DISTINCT FROM OLD.start_at THEN
      RAISE EXCEPTION 'START_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.start_at IS DISTINCT FROM OLD.start_at THEN
      IF NEW.start_at < now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'PAST_START' USING ERRCODE = '23514';
      END IF;
      IF NOT v_admin
         AND NEW.start_at >= ((v_today_kst + 31)::timestamp AT TIME ZONE 'Asia/Seoul') THEN
        RAISE EXCEPTION 'DATE_LIMIT_30D' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.end_at IS DISTINCT FROM OLD.end_at AND NEW.end_at < now() THEN
      RAISE EXCEPTION 'PAST_END' USING ERRCODE = '23514';
    END IF;
    IF NEW.return_due IS DISTINCT FROM OLD.return_due AND NEW.return_due < v_today_kst THEN
      RAISE EXCEPTION 'PAST_RETURN_DUE' USING ERRCODE = '23514';
    END IF;
    NEW.period_changed_at := now();
    NEW.period_changed_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resource_bookings_guard_return ON resource_bookings;
DROP TRIGGER IF EXISTS trg_resource_bookings_guard_update ON resource_bookings;
-- ⚠ occupancy 트리거(occupied_until 재계산)보다 먼저 실행되도록 이름 순서 보장 — Postgres 는 같은 이벤트의
--   트리거를 이름 알파벳순으로 실행: guard_update(g) < occupancy(o). 검증 [4] 에서 확인.
CREATE TRIGGER trg_resource_bookings_guard_update
  BEFORE UPDATE ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION resource_bookings_guard_update();
DROP FUNCTION IF EXISTS public.resource_bookings_guard_return();

-- [4] notifications.type CHECK 확장 (20260748 §3 패턴 그대로)
DO $$
DECLARE
  v_con  record;
  v_new  text;
  v_type text := 'resource_booking_period_changed';
BEGIN
  SELECT conname, oid INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'notifications'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%type%'
  LIMIT 1;
  IF v_con.conname IS NULL THEN
    RAISE NOTICE '[4] notifications.type CHECK 없음 — 조치 불필요';
    RETURN;
  END IF;
  v_new := pg_get_constraintdef(v_con.oid);
  IF position(v_type IN v_new) > 0 THEN
    RAISE NOTICE '[4] 이미 허용됨';
    RETURN;
  END IF;
  IF v_new LIKE '%ANY (ARRAY[%' THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_con.conname);
    v_new := replace(v_new, ']))', format(', %L::text]))', v_type));
    EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I %s', v_con.conname, v_new);
    RAISE NOTICE '[4] % 허용 목록에 추가', v_type;
  ELSE
    RAISE EXCEPTION '[4] CHECK 형태를 자동 확장할 수 없습니다(%) — % 를 수동 추가하세요', v_new, v_type;
  END IF;
END $$;

COMMIT;

-- [5] 검증 — 단일 결과셋
SELECT no, item, value FROM (
  SELECT 1 AS no, '이력 컬럼 2개'::text AS item,
         CASE WHEN (SELECT count(*) FROM information_schema.columns
                    WHERE table_name='resource_bookings'
                      AND column_name IN ('period_changed_at','period_changed_by')) = 2 THEN '✅' ELSE '❌' END AS value
  UNION ALL
  SELECT 2, 'INSERT 가드 트리거',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_resource_bookings_guard_insert') THEN '✅' ELSE '❌' END
  UNION ALL
  SELECT 3, 'UPDATE 가드 트리거 (구 guard_return 제거)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_resource_bookings_guard_update')
               AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_resource_bookings_guard_return')
               AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='resource_bookings_guard_return') THEN '✅' ELSE '❌' END
  UNION ALL
  SELECT 4, 'BEFORE UPDATE 실행 순서 (guard → occupancy)',
         (SELECT string_agg(tgname, ' → ' ORDER BY tgname) FROM pg_trigger
           WHERE tgrelid='resource_bookings'::regclass AND NOT tgisinternal AND tgtype & 16 = 16)
  UNION ALL
  SELECT 5, 'EXCLUDE 유지',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='resource_bookings_no_overlap') THEN '✅' ELSE '❌' END
  UNION ALL
  SELECT 6, 'notifications CHECK 에 period_changed',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c'
                                 AND pg_get_constraintdef(oid) ILIKE '%type%')
              THEN '— (CHECK 없음)'
              WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c'
                             AND pg_get_constraintdef(oid) LIKE '%resource_booking_period_changed%')
              THEN '✅' ELSE '❌' END
) v ORDER BY no;
