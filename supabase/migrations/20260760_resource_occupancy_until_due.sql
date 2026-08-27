-- 20260760 — 자원예약 점유구간: 당일 반납 건도 반납일 19:00 KST 까지 독점 (2026-08-27 고지 확정)
-- 배경: 구 산식은 반납일=사용일이면 occupied_until=end_at → 같은 날 타인 예약 허용.
--       실물은 관리자 반납 확인 전까지 예약자에게 있으므로 당일/복수일 구분 없이 반납일 19:00 까지 EXCLUDE 범위.
--       조기 반납(returned_at < occupied_until) 시 GREATEST(start_at, returned_at) 로 해제는 20260753 그대로.
-- 영향: 기존 confirmed 5건 재계산(EXCLUDE 충돌 0건 사전 확인). DB 판정 상수·가드·cron 변경 없음.

BEGIN;

CREATE OR REPLACE FUNCTION public.resource_bookings_compute_occupancy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_start_kst date := (NEW.start_at AT TIME ZONE 'Asia/Seoul')::date;
  v_end_kst   date := (NEW.end_at   AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF v_end_kst <> v_start_kst THEN
    RAISE EXCEPTION 'USAGE_MUST_BE_SAME_DAY' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.return_due < v_start_kst THEN
    RAISE EXCEPTION 'RETURN_BEFORE_START' USING ERRCODE = 'P0001';
  END IF;

  -- ← [2026-08-27 20260760] 당일 반납 분기 삭제 — 반납 확인 전까지 실물 점유이므로 반납일 19:00 KST 까지 독점
  NEW.occupied_until :=
    (NEW.return_due::timestamp + interval '19 hours') AT TIME ZONE 'Asia/Seoul';

  -- ← [2026-08-26 20260753] 반납 확인 시각이 점유 끝보다 이르면 그 시각에 점유 해제 (조기 반납)
  --   start_at 아래로는 내리지 않는다 — EXCLUDE 의 tstzrange(start_at, occupied_until) 하한 규칙 보호
  IF NEW.returned_at IS NOT NULL AND NEW.returned_at < NEW.occupied_until THEN
    NEW.occupied_until := GREATEST(NEW.start_at, NEW.returned_at);
  END IF;
  RETURN NEW;
END;
$$;

-- 기존 건 재계산 (BEFORE UPDATE 트리거 경유 — 가드는 session_user=postgres 면 통과)
UPDATE public.resource_bookings SET occupied_until = occupied_until WHERE status = 'confirmed';

-- 검증: 당일 반납·미반납 건이 반납일 19:00 KST 로 바뀌었는지
SELECT id, user_name, return_due, returned_at,
       to_char(occupied_until AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS occ_kst
FROM public.resource_bookings WHERE status = 'confirmed' ORDER BY start_at;

COMMIT;
