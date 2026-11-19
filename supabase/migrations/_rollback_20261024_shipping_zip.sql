-- ============================================================================
-- _rollback_20261024_shipping_zip.sql — 20261024_shipping_zip.sql 되돌리기
-- ⚠ 저장된 우편번호 값이 삭제된다. 프론트(주소 검색 배포본)는 우편번호를 함께 보내지만
--   되돌린 함수는 모르는 값을 무시하므로 등록·수정은 계속 동작한다.
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- ============================================================================
BEGIN;
DO $$
DECLARE r record; v_def text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'public.shipping_fill(jsonb)',
       $f$

  -- 우편번호 (선택 — 주소 검색으로 채워진다. 빈 값 또는 숫자 5자리)   ← [2026-11-19 20261024]
  v.sender_zip       := btrim(COALESCE(p->>'sender_zip', ''));
  v.receiver_zip     := btrim(COALESCE(p->>'receiver_zip', ''));
  IF v.sender_zip <> '' AND v.sender_zip !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'INVALID:sender_zip' USING ERRCODE = 'P0001'; END IF;
  IF v.receiver_zip <> '' AND v.receiver_zip !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'INVALID:receiver_zip' USING ERRCODE = 'P0001'; END IF;$f$),
      (2, 'public.shipping_create(jsonb)', $f$,
    sender_zip, receiver_zip$f$),
      (3, 'public.shipping_create(jsonb)', $f$,
    v.sender_zip, v.receiver_zip$f$),
      (4, 'public.shipping_update(uuid,jsonb)', $f$
    sender_zip = v.sender_zip, receiver_zip = v.receiver_zip,$f$)
    ) AS x(ord, fn, frm)
    ORDER BY ord
  LOOP
    SELECT pg_get_functiondef(r.fn::regprocedure) INTO v_def;
    IF position(r.frm IN v_def) > 0 THEN EXECUTE replace(v_def, r.frm, ''); END IF;
  END LOOP;
END $$;
ALTER TABLE public.shipping_records DROP COLUMN IF EXISTS sender_zip;
ALTER TABLE public.shipping_records DROP COLUMN IF EXISTS receiver_zip;
COMMIT;
