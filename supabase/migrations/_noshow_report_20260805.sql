-- ============================================================================
-- _noshow_report_20260805.sql  (읽기 전용 — 데이터 변경 없음)
-- 공지문 숫자 채움용 노쇼 현황 리포트 — 오픈일(2026-04-22) ~ 오늘
--
-- 📌 Supabase SQL Editor 는 여러 SELECT 중 마지막 결과만 표시하므로
--    전체를 UNION ALL 단일 결과셋으로 묶음 (2026-07-24 진단 v1 실패 교훈).
-- 📌 노쇼 판정 = 확정룰 status='confirmed' AND cancelled_by='system' AND checked_in=false
-- 📌 분모 = 기간 내 start_at 기준 실제 생성된 모든 예약 (취소·거절·대기 포함 — 2026-07-23 확정)
-- ============================================================================

WITH base AS (
  SELECT *,
         (start_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
         (status = 'confirmed' AND cancelled_by = 'system' AND checked_in = false) AS is_noshow
  FROM public.bookings
  WHERE start_at >= '2026-04-22T00:00:00+09:00'
    AND start_at <  now()
)
SELECT 섹션, 항목, 값 FROM (
  -- [1] 총괄
  SELECT 10 AS ord, '1.총괄' AS 섹션, '기간' AS 항목,
         '2026-04-22 ~ ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS 값
  UNION ALL
  SELECT 11, '1.총괄', '전체 예약(건)', count(*)::text FROM base
  UNION ALL
  SELECT 12, '1.총괄', '노쇼(건)', count(*) FILTER (WHERE is_noshow)::text FROM base
  UNION ALL
  SELECT 13, '1.총괄', '노쇼율(%)',
         round(100.0 * count(*) FILTER (WHERE is_noshow) / NULLIF(count(*), 0), 1)::text
  FROM base
  UNION ALL
  -- [2] 월별 추이
  SELECT 20 + row_number() OVER (ORDER BY m), '2.월별',
         to_char(m, 'YYYY-MM'),
         total::text || '건 중 노쇼 ' || ns::text || '건 (' ||
         round(100.0 * ns / NULLIF(total, 0), 1)::text || '%)'
  FROM (
    SELECT date_trunc('month', kst_date)::date AS m,
           count(*) AS total, count(*) FILTER (WHERE is_noshow) AS ns
    FROM base GROUP BY 1
  ) t
  UNION ALL
  -- [3] 부서별 노쇼 Top 5 (스냅샷 user_dept 기준)
  SELECT 40 + row_number() OVER (ORDER BY ns DESC), '3.부서 Top5',
         COALESCE(NULLIF(user_dept, ''), '(부서 미상)'),
         ns::text || '건'
  FROM (
    SELECT user_dept, count(*) AS ns
    FROM base WHERE is_noshow
    GROUP BY user_dept ORDER BY ns DESC LIMIT 5
  ) d
  UNION ALL
  -- [4] 반복 노쇼 (개인 실명은 공지에 쓰지 않음 — 인원수만)
  SELECT 60, '4.반복 노쇼', '2회 이상 노쇼 인원(명)', count(*)::text
  FROM (SELECT user_id FROM base WHERE is_noshow GROUP BY user_id HAVING count(*) >= 2) r
  UNION ALL
  SELECT 61, '4.반복 노쇼', '1인 최다 노쇼(건)', COALESCE(max(ns), 0)::text
  FROM (SELECT count(*) AS ns FROM base WHERE is_noshow GROUP BY user_id) r2
  UNION ALL
  -- [5] 요일별 노쇼 (경각심 지표 — 어느 요일에 몰리는가)
  SELECT 70 + dow, '5.요일별',
         (ARRAY['월','화','수','목','금','토','일'])[dow], ns::text || '건'
  FROM (
    SELECT EXTRACT(isodow FROM kst_date)::int AS dow, count(*) AS ns
    FROM base WHERE is_noshow GROUP BY 1
  ) w
) rep
ORDER BY ord;
