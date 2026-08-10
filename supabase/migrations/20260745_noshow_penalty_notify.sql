-- ============================================================================
-- 20260745_noshow_penalty_notify.sql
-- 노쇼 이용 제재 알림 (Phase 2-2) — 발생/해제 통지용 컬럼 + service_role RPC 4종
--
-- ✅ 변경 이력
--  - [2026-08-10] 신규 — 설계 승인(docs/노쇼제재_알림_설계문서_20260810.md).
--      선례: 도서 제재 통지(20260726 expire_book_penalties + mark_..._notified).
--
-- 📌 구조 (설계 문서 §3~5 확정)
--    · 발송 주체 = auto-cancel-bookings cron 스텝 (15분 주기 폴링).
--      제재 발생 지점이 DB 트리거(백그라운드)라 이벤트 기반이 구조적으로 불가.
--    · lock-step: cron 이 조회 → 발송 성공 건만 마킹. 마킹 먼저 찍으면
--      발송 실패가 영구 미통지가 된다 (P3 v2 원칙).
--    · 해제 3경로(기간 만료/관리자 수동/근거 노쇼 해제·삭제 자동 revoke) 단일 타입.
--      단 자동 revoke 직후 재평가로 새 제재가 즉시 재발급된 경우 still_blocked=true —
--      "해제되었습니다" 통지가 거짓말이 되므로 cron 이 발송을 건너뛰고 마킹만 한다.
--    · RPC 는 전부 service_role 전용 — 클라이언트가 통지 상태를 조작할 이유가 없다.
--    · *_kst 필드는 서버에서 완성된 문자열로 반환 — Edge/프론트 재변환 금지
--      (타임존 이중 적용 하루 밀림 교훈).
--
-- 📌 소급 규칙 (설계 §4)
--    · 이미 만료/해제된 과거 제재 → 일괄 마킹 = 소급 통지 안 함 (끝난 제재 통지는 혼란)
--    · 진행 중 제재 → 미마킹 유지 = 다음 cron 에서 발생 통지 (제재 중이므로 정당·필요)
--
-- 📌 notifications.type CHECK 제약 (설계 §7-2 리스크)
--    · 제약이 있으면 신규 타입 인앱 INSERT 가 조용히 실패한다.
--      말미 DO 블록이 진단해 제약이 존재하면 NOTICE 로 경고한다 (자동 변경은 하지
--      않는다 — 제약 정의를 모르는 채 재작성하면 기존 타입이 깨질 수 있다.
--      경고가 뜨면 제약 정의를 확인해 신규 타입 2종을 수동 추가할 것).
--
-- 배포 안전성: 이 파일만 먼저 적용해도 안전 — 구버전 cron 은 스텝이 없어
--   미발송 유지일 뿐이다. 멱등 — 재실행 안전.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) 통지 마킹 컬럼 + 미통지 조회용 부분 인덱스
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.noshow_penalties
  ADD COLUMN IF NOT EXISTS notified_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_cleared_at timestamptz;

COMMENT ON COLUMN public.noshow_penalties.notified_applied_at IS
  '[2026-08-10] 발생(noshow_penalty_applied) 통지 완료 시각. NULL=미통지 — cron 재시도 대상';
COMMENT ON COLUMN public.noshow_penalties.notified_cleared_at IS
  '[2026-08-10] 해제(noshow_penalty_cleared) 통지 완료 시각. still_blocked 스킵도 마킹된다';

CREATE INDEX IF NOT EXISTS idx_noshow_penalties_unnotified_applied
  ON public.noshow_penalties (ends_at)
  WHERE notified_applied_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_noshow_penalties_unnotified_cleared
  ON public.noshow_penalties (ends_at)
  WHERE notified_cleared_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 2) 소급 마킹 — 마이그레이션 시점에 이미 끝난 제재는 통지하지 않는다
--    (notified_* 가 NULL 인 행만 건드림 → 재실행해도 새 마킹이 안 생겨 멱등)
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.noshow_penalties
   SET notified_applied_at = COALESCE(notified_applied_at, created_at),
       notified_cleared_at = COALESCE(notified_cleared_at, now())
 WHERE (revoked_at IS NOT NULL OR ends_at <= now())
   AND (notified_applied_at IS NULL OR notified_cleared_at IS NULL);

-- ════════════════════════════════════════════════════════════════════════
-- 3) 발생 통지 대상 조회 — 유효(진행 중) & 미통지
--    ends_at > now() 조건: 통지 전에 이미 끝나버린 제재는 발생 통지가 무의미
--    (cleared 조회에는 걸리므로 통지가 완전히 증발하지는 않는다 — 설계 §4)
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_unnotified_noshow_penalties();
CREATE FUNCTION public.get_unnotified_noshow_penalties()
RETURNS TABLE (
  penalty_id           uuid,
  user_id              uuid,
  user_name            text,
  triggered_booking_id text,
  booking_title        text,      -- 3번째 노쇼 예약 제목 (payload booking.title — 삭제됐으면 폴백)
  noshow_count         int,
  starts_kst           text,      -- 'YYYY-MM-DD HH24:MI' (Edge 재변환 금지)
  ends_kst             text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         p.user_id,
         p.user_name,
         p.triggered_booking_id,
         COALESCE(b.title, '회의실 예약'),
         COALESCE(array_length(p.counted_booking_ids, 1), 3),
         to_char(p.starts_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
         to_char(p.ends_at   AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
    FROM public.noshow_penalties p
    LEFT JOIN public.bookings b ON b.id = p.triggered_booking_id
   WHERE p.notified_applied_at IS NULL
     AND p.revoked_at IS NULL
     AND p.ends_at > now()
   ORDER BY p.created_at
$$;

REVOKE ALL ON FUNCTION public.get_unnotified_noshow_penalties() FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_unnotified_noshow_penalties() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 발생 통지 마킹 — 발송 성공 건만 (lock-step)
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.mark_noshow_penalty_applied_notified(uuid[]);
CREATE FUNCTION public.mark_noshow_penalty_applied_notified(p_penalty_ids uuid[])
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH upd AS (
    UPDATE public.noshow_penalties
       SET notified_applied_at = now()
     WHERE id = ANY(p_penalty_ids)
       AND notified_applied_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM upd
$$;

REVOKE ALL ON FUNCTION public.mark_noshow_penalty_applied_notified(uuid[]) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_noshow_penalty_applied_notified(uuid[]) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 해제 통지 대상 조회 — (수동·자동 revoke) OR (기간 만료), 미통지
--    still_blocked = 같은 사용자의 다른 유효 제재 존재 여부
--      → true 면 cron 이 발송을 건너뛰고 마킹만 한다 (해제 거짓말 방지, 설계 §5)
--    ⚠ notified_applied_at IS NOT NULL 조건을 넣지 않는다 — 넣으면 applied 발송이
--      영구 실패한 건의 cleared 까지 영구 미통지가 된다 (설계 §4 문서화 결정)
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_uncleared_noshow_penalties();
CREATE FUNCTION public.get_uncleared_noshow_penalties()
RETURNS TABLE (
  penalty_id           uuid,
  user_id              uuid,
  user_name            text,
  triggered_booking_id text,
  booking_title        text,
  ends_kst             text,
  still_blocked        boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         p.user_id,
         p.user_name,
         p.triggered_booking_id,
         COALESCE(b.title, '회의실 예약'),
         to_char(p.ends_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
         EXISTS (
           SELECT 1 FROM public.noshow_penalties q
            WHERE q.user_id = p.user_id
              AND q.id <> p.id
              AND q.revoked_at IS NULL
              AND now() >= q.starts_at
              AND now() <  q.ends_at
         )
    FROM public.noshow_penalties p
    LEFT JOIN public.bookings b ON b.id = p.triggered_booking_id
   WHERE p.notified_cleared_at IS NULL
     AND (p.revoked_at IS NOT NULL OR p.ends_at <= now())
   ORDER BY p.created_at
$$;

REVOKE ALL ON FUNCTION public.get_uncleared_noshow_penalties() FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_uncleared_noshow_penalties() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 6) 해제 통지 마킹 — 발송 성공 건 + still_blocked 스킵 건
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.mark_noshow_penalty_cleared_notified(uuid[]);
CREATE FUNCTION public.mark_noshow_penalty_cleared_notified(p_penalty_ids uuid[])
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH upd AS (
    UPDATE public.noshow_penalties
       SET notified_cleared_at = now()
     WHERE id = ANY(p_penalty_ids)
       AND notified_cleared_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM upd
$$;

REVOKE ALL ON FUNCTION public.mark_noshow_penalty_cleared_notified(uuid[]) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_noshow_penalty_cleared_notified(uuid[]) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 7) notifications.type CHECK 제약 진단 (설계 §7-2)
--    자동 변경하지 않는다 — 제약이 있으면 NOTICE 로 경고만.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'notifications'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%type%'
   LIMIT 1;

  IF v_def IS NOT NULL THEN
    RAISE NOTICE '⚠ notifications 테이블에 type 관련 CHECK 제약 존재: % — noshow_penalty_applied / noshow_penalty_cleared 를 허용 목록에 수동 추가해야 인앱이 저장됩니다.', v_def;
  ELSE
    RAISE NOTICE '✓ notifications.type CHECK 제약 없음 — 신규 타입 인앱 저장 문제 없음.';
  END IF;
END $$;

COMMIT;

-- ── 배포 후 확인 (읽기 전용) ─────────────────────────────────────────────
-- SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noshow_penalties' AND column_name='notified_applied_at') AS col_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_unnotified_noshow_penalties')      AS get_a_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='mark_noshow_penalty_applied_notified') AS mark_a_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_uncleared_noshow_penalties')       AS get_c_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='mark_noshow_penalty_cleared_notified') AS mark_c_ok;
-- SELECT id, user_name, ends_at, notified_applied_at, notified_cleared_at FROM noshow_penalties ORDER BY created_at DESC;
