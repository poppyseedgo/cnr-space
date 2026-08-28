-- ============================================================================
-- 20260761_resource_hold_gate.sql — 자원 실물 홀드 게이트 (2026-08-28, 고지 확정)
--
-- 운영 규칙: 관리자가 실물을 수령하고 [반납 확인]을 누르기 전까지 해당 자원은
--            '예약 가능한 상태'가 아니다. 시작일이 오늘이든 미래든 신규 예약 생성 불가.
--
-- 배경 사고: 방수진(반납일 8/27, 연체)이 실물을 쥔 채로 이현준의 8/28 예약이 시작됨.
--   EXCLUDE 는 "계획된 점유"(start~반납일 19:00 = occupied_until)만 방어하고
--   "실물 점유"(start~반납 확인)는 제약 밖이었음 — 이 마이그레이션이 그 방어선을 추가.
--
-- 내용:
--  [1] resource_bookings.notified_hold_conflict_on date — 시작일 도래 충돌 통지 멱등 (cron ③)
--  [2] resource_bookings_guard_insert() 확장 — ITEM_STILL_HELD:
--      같은 개체에 미반납 홀더(confirmed·start_at<=now·returned_at IS NULL)가 있으면 INSERT 거부.
--      · 관리자 예외 없음 — 실물이 없는 건 관리자에게도 없는 것. 실물을 갖고 있다면
--        [반납 확인]을 먼저 누르면 되므로 예외가 필요 없다 (고지 확정).
--      · UPDATE(기한 변경)는 비대상 — 기존 예약의 기간 조정은 guard_update 담당, 신규 선점이 아님.
--      · 홀드 시작 전에 이미 생성돼 있던 예약(이현준 케이스)은 논리적으로 차단 불가 →
--        resource-due-reminder cron ③ resource_hold_conflict 통지로 대응.
--
-- 재실행: 멱등 (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE)
-- 배포 순서: 본 SQL → Edge(_shared/notification-types·send-notification·resource-due-reminder) → 프론트
-- ============================================================================

DO $$
BEGIN
  -- 프리플라이트: to_regclass 가드 먼저 (8/19 교훈 — 테이블 존재 확인 전 조회 금지)
  IF to_regclass('public.resource_bookings') IS NULL THEN
    RAISE EXCEPTION '[20260761] resource_bookings 테이블이 없습니다 — 20260734 선행 필요';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resource_bookings_guard_insert'
  ) THEN
    RAISE EXCEPTION '[20260761] resource_bookings_guard_insert() 가 없습니다 — 20260752 선행 필요';
  END IF;
END $$;

-- [1] cron ③ 멱등 컬럼 (notified_due_on/notified_overdue_on 과 동일 패턴)
ALTER TABLE public.resource_bookings
  ADD COLUMN IF NOT EXISTS notified_hold_conflict_on date;

COMMENT ON COLUMN public.resource_bookings.notified_hold_conflict_on IS
  '시작일 도래 시 선행 미반납 홀더 충돌 통지 발송일(KST) — resource_hold_conflict 1회성 멱등 (20260761)';

-- [2] guard_insert 확장 — 20260752 본문 유지 + ITEM_STILL_HELD 추가
CREATE OR REPLACE FUNCTION public.resource_bookings_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- ← [2026-08-28 20260761] 실물 홀드 게이트 (고지 확정 운영 규칙):
  --   미반납 홀더가 있는 개체는 반납 확인 전까지 어떤 신규 예약도 받지 않는다.
  --   관리자 예외 없음. EXCLUDE(계획 점유)와 별개의 방어선 — 실물 점유 기준.
  IF EXISTS (
    SELECT 1 FROM public.resource_bookings h
    WHERE h.item_id     = NEW.item_id
      AND h.status      = 'confirmed'
      AND h.returned_at IS NULL
      AND h.start_at   <= now()
  ) THEN
    RAISE EXCEPTION 'ITEM_STILL_HELD' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- 검증
DO $$
DECLARE
  v_src text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'resource_bookings'
      AND column_name = 'notified_hold_conflict_on'
  ) THEN
    RAISE EXCEPTION '[20260761 검증실패] notified_hold_conflict_on 컬럼 없음';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resource_bookings_guard_insert';
  IF v_src NOT LIKE '%ITEM_STILL_HELD%' THEN
    RAISE EXCEPTION '[20260761 검증실패] guard_insert 에 ITEM_STILL_HELD 미반영';
  END IF;
  IF v_src NOT LIKE '%DATE_LIMIT_30D%' OR v_src NOT LIKE '%PAST_START%' THEN
    RAISE EXCEPTION '[20260761 검증실패] guard_insert 기존 검사 소실';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.resource_bookings'::regclass
      AND tgname = 'trg_resource_bookings_guard_insert' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '[20260761 검증실패] trg_resource_bookings_guard_insert 트리거 없음';
  END IF;

  RAISE NOTICE '[20260761] 홀드 게이트 적용 완료 — ITEM_STILL_HELD + notified_hold_conflict_on';
END $$;
