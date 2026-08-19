-- ============================================================================
-- 20260748_resource_notifications.sql
-- 자원예약 Phase 4 — 알림 기반 DB
--
-- [2026-08-19] 확정: 알림 5종 / cron 09:00 KST(도서와 동일) / 관리자 취소 알림 포함
--   ① cron 멱등 컬럼 2개 (book_checkouts dedupe 패턴)
--   ② 자격 불변식(20260747) 확장 — resource_overdue 지정 수신 자격 = resource/super
--   ③ notifications.type CHECK 진단·확장 (20260745 §7-2 패턴 — 있으면 인앱이 조용히 실패)
--   ④ cron 등록 — resource-due-reminder 매일 09:00 KST (0 0 * * * UTC)
--
-- 실행: SQL Editor 전체 붙여넣기 → Run. 재실행 안전(멱등).
-- 배포 순서: 본 SQL → _shared 교체 + send-notification 재배포 → cron 함수 배포 → 프론트
--   (8/5 사고 교훈: Edge 미배포 시 신규 타입 발송이 400 — 프론트 호출은 fire-and-forget 이라 무해하나 알림은 안 감)
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [1] cron 멱등 마킹 컬럼 (발송일 KST date — 같은 날 재실행 중복 방지)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS notified_due_on     date;
ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS notified_overdue_on date;

COMMENT ON COLUMN resource_bookings.notified_due_on     IS '반납일 안내 발송일(KST) — resource-due-reminder 멱등 마킹';
COMMENT ON COLUMN resource_bookings.notified_overdue_on IS '연체 알림 최근 발송일(KST) — 매일 1회 반복(도서 관례)';

-- ────────────────────────────────────────────────────────────────────────────
-- [2] 지정 수신자 자격 SSOT 확장 (20260747 notification_required_roles)
--     관리자 수신 자원 타입은 resource_overdue 1종 — 자격 = admin_roles resource/super.
--     개인 대상 4종은 NULL 유지(관리자 수신 없음 = 지정 대상 아님).
--     ⚠ 원본이 DB 에만 있고 저장소에 20260747 파일이 없어, 현행 정의를
--       MCP 실측(2026-08-19)한 뒤 전체 재정의한다. 실측 원본:
--       book_checkout_created → {book,super} / ELSE NULL
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notification_required_roles(p_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type = 'book_checkout_created' THEN ARRAY['book','super']
    WHEN p_type = 'resource_overdue'      THEN ARRAY['resource','super']  -- ← [2026-08-19 Phase 4]
    ELSE NULL
  END
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- [3] notifications.type CHECK 진단·확장 (20260745 §7-2 패턴)
--     CHECK 가 존재하면 신규 5타입 인앱 INSERT 가 조용히 실패한다.
--     허용 목록에 자동 추가 시도, 파싱 불가 형태면 NOTICE 로 수동 조치 안내.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_con  record;
  v_def  text;
  v_new  text;
  v_type text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'notifications'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%type%'
  LIMIT 1;

  IF v_con.conname IS NULL THEN
    RAISE NOTICE '[3] notifications.type CHECK 없음 — 조치 불필요 (인앱 저장 자유)';
    RETURN;
  END IF;

  v_def := v_con.conname;
  v_new := pg_get_constraintdef(v_con.oid);
  RAISE NOTICE '[3] notifications CHECK 발견: % — 자원 5타입 허용 여부 검사', v_new;

  FOREACH v_type IN ARRAY ARRAY[
    'resource_booking_created','resource_booking_cancelled_by_admin',
    'resource_return_confirmed','resource_due_reminder','resource_overdue'
  ] LOOP
    IF position(v_type IN v_new) = 0 THEN
      -- ANY(ARRAY[...]) 형태면 목록 끝에 추가해 재생성
      IF v_new LIKE '%ANY (ARRAY[%' THEN
        EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', v_con.conname);
        v_new := replace(v_new, ']))', format(', %L::text]))', v_type));
        EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I %s', v_con.conname, v_new);
        RAISE NOTICE '[3] % 허용 목록에 추가', v_type;
      ELSE
        RAISE EXCEPTION '[3] CHECK 형태를 자동 확장할 수 없습니다(%) — % 를 수동 추가하세요', v_new, v_type;
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- [4] cron 등록 — 매일 09:00 KST = 00:00 UTC (도서 book-due-reminder 와 동일 시각)
--     ⚠ pg_cron + pg_net 전제 (기존 도서 cron 과 동일 방식이면 아래 주석 해제 후
--       기존 book-due-reminder 잡의 URL·헤더 형식을 그대로 복제해 실행하세요.
--       프로젝트마다 anon 키 헤더 방식이 달라 여기 하드코딩하지 않는다 — 기존 잡이 SSOT)
-- ────────────────────────────────────────────────────────────────────────────
-- 기존 도서 잡(book-due-reminder-0900kst, '0 0 * * *' — 2026-08-19 실측)을 복제해 등록.
-- 키를 파일에 적지 않고 DB 의 기존 command 를 그대로 치환 재사용한다 (기존 잡 = SSOT):
SELECT cron.schedule(
  'resource-due-reminder-0900kst',
  '0 0 * * *',
  replace(
    (SELECT command FROM cron.job WHERE jobname = 'book-due-reminder-0900kst'),
    'book-due-reminder', 'resource-due-reminder')
);

-- ────────────────────────────────────────────────────────────────────────────
-- [5] 검증 — 단일 결과셋
-- ────────────────────────────────────────────────────────────────────────────
SELECT no, item, value FROM (
  SELECT 1 AS no, '멱등 컬럼 2개'::text AS item,
         CASE WHEN (SELECT count(*) FROM information_schema.columns
                    WHERE table_name='resource_bookings'
                      AND column_name IN ('notified_due_on','notified_overdue_on')) = 2
              THEN '✅' ELSE '❌' END AS value
  UNION ALL
  SELECT 2, 'required_roles(resource_overdue)',
         coalesce(array_to_string(notification_required_roles('resource_overdue'), ','), '(NULL)')
  UNION ALL
  SELECT 3, 'required_roles(book_checkout_created) 보존',
         coalesce(array_to_string(notification_required_roles('book_checkout_created'), ','), '(NULL)')
  UNION ALL
  SELECT 4, 'notifications.type CHECK 상태',
         coalesce((SELECT CASE WHEN pg_get_constraintdef(oid) LIKE '%resource_overdue%'
                               THEN '✅ 자원 타입 포함' ELSE '⚠ 자원 타입 미포함 — [3] NOTICE 확인' END
                   FROM pg_constraint
                   WHERE conrelid='notifications'::regclass AND contype='c'
                     AND pg_get_constraintdef(oid) ILIKE '%type%' LIMIT 1),
                  '✅ CHECK 없음(자유)')
  UNION ALL
  SELECT 5, 'cron 등록 여부(1 기대)',
         coalesce((SELECT count(*)::text FROM cron.job WHERE jobname='resource-due-reminder-0900kst'), '0')
) t ORDER BY no;
