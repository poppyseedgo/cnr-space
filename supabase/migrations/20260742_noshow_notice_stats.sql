-- ============================================================================
-- 20260742_noshow_notice_stats.sql
-- 노쇼 공지 SVG 용 집계 RPC — /api/noshow-notice (Cloudflare Pages Function) 짝 배포
--
-- ✅ [2026-08-05] 신규 — Figma 2802:55 노쇼 공지의 수치 자동 반영용
--
-- 📌 SECURITY DEFINER + anon GRANT 인 이유
--    · bookings RLS 를 우회해 집계만 노출 (행 단위 데이터·개인정보 없음)
--    · 공지 SVG 는 그룹웨어 <img> 로 로그인 없이 열리므로 anon 경로 필수
--    · ESG /api/roster 의 RPC 공개 패턴과 동일
-- 📌 판정·분모는 확정룰 그대로:
--    · 노쇼 = status='confirmed' AND cancelled_by='system' AND checked_in=false
--    · 분모 = start_at 기준 기간 내 실제 생성된 모든 예약 (2026-07-23 확정)
-- 📌 월별은 오픈월(2026-04)부터 현재 KST 월까지 generate_series — 예약 0건인
--    달도 행을 만든다 (9월이 되면 자동으로 9월 행이 늘어남)
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_noshow_notice_stats();
CREATE FUNCTION public.get_noshow_notice_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base AS (
  SELECT
    date_trunc('month', (start_at AT TIME ZONE 'Asia/Seoul'))::date AS m,
    user_id,
    (status = 'confirmed' AND cancelled_by = 'system' AND checked_in = false) AS is_noshow
  FROM public.bookings
  WHERE start_at >= '2026-04-22T00:00:00+09:00'
    AND start_at <  now()
),
months AS (
  SELECT generate_series(
    '2026-04-01'::date,
    date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date,
    interval '1 month'
  )::date AS m
),
monthly AS (
  SELECT mo.m,
         count(b.m)                              AS total,
         count(b.m) FILTER (WHERE b.is_noshow)   AS noshow
  FROM months mo
  LEFT JOIN base b ON b.m = mo.m
  GROUP BY mo.m
  ORDER BY mo.m
)
SELECT jsonb_build_object(
  'as_of_kst', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
  'open_date', '2026-04-22',
  'total',   (SELECT count(*) FROM base),
  'noshow',  (SELECT count(*) FILTER (WHERE is_noshow) FROM base),
  'repeat3', (SELECT count(*) FROM (
                SELECT user_id FROM base WHERE is_noshow
                GROUP BY user_id HAVING count(*) >= 3) r),
  'monthly', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'ym',     to_char(m, 'YYYY-MM'),
                'month',  EXTRACT(month FROM m)::int,
                'total',  total,
                'noshow', noshow
              ) ORDER BY m), '[]'::jsonb) FROM monthly)
);
$$;

REVOKE ALL ON FUNCTION public.get_noshow_notice_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.get_noshow_notice_stats() TO anon, authenticated, service_role;

COMMIT;

-- ── 배포 후 확인 (읽기 전용) ─────────────────────────────────────────────
-- SELECT jsonb_pretty(public.get_noshow_notice_stats());
