-- ============================================================================
-- 20261024_shipping_zip.sql
-- 운송내역서 — 우편번호 칸 추가 (주소 검색 연결용)
--
-- ✅ 변경 이력
--  - [2026-11-19 운영 적용] Supabase(jjzcqpbwkkujttwxksvy) 적용 완료 — 마이그레이션 이력 20261119072526 '20261024_shipping_zip'. 검증 블록 통과,
--      적용 후 함수 본문 md5 가 로컬 시뮬과 일치(create f7ba64a4 · fill e0c697aa · update 9178424b). 기존 3건은 우편번호 빈 값.
--  - [2026-11-19] 신규 (고지 확정 2026-11-19 "우편번호 필드를 만들고 추가하되, 출력 양식에는 드러내지 않는다")
--      · [A] shipping_records.sender_zip / receiver_zip (text, 기본값 '') 추가.
--            주소 검색(카카오 우편번호 서비스)에서 고른 5자리 우편번호를 저장한다. 직접 입력한 주소는 빈 값.
--            ⚠ 저장만 한다 — 라벨 인쇄 · 엑셀다운로드 · 관리자 목록에는 내보내지 않는다(그룹웨어 서식에 칸이 없음).
--      · [B] shipping_fill / shipping_create / shipping_update — 두 칸을 읽고 쓰도록 4곳 치환.
--            본문은 운영 배포본(pg_get_functiondef)을 읽어 해당 줄만 치환한다(손으로 다시 옮겨 적지 않는다).
--            형식: 빈 값 또는 숫자 5자리. 그 외는 INVALID:sender_zip / INVALID:receiver_zip.
--            payload 에 두 칸이 없으면 빈 값 — 이전 화면(우편번호 칸 없는 배포본)에서 등록해도 그대로 동작한다.
--
-- 전화번호 하이픈은 DB 가 아니라 화면(src/utils/phone.ts 한 곳)에서 넣는다 — 규칙을 두 군데 두지 않기 위함.
-- 실행: Supabase SQL Editor 전체 Run 또는 MCP apply_migration (트랜잭션 1개 · 멱등)
-- 시뮬: _sim_shipping_20261119/ (기존 77항목 회귀 + 우편번호 Z1~Z9 = 86항목, 결과 _sim__result_20261119.txt)
-- 순서: 20261023_shipping_temp.sql → 이 파일
-- 배포 짝: 프론트 feat/shipping-address-phone (주소 검색 · 우편번호 칸 · 전화번호 하이픈)
--          이 파일을 먼저 적용해도 이전 화면은 그대로 동작한다(추가된 칸은 빈 값으로 저장).
-- 롤백: _rollback_20261024_shipping_zip.sql
-- ============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- [A] 우편번호 칸
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipping_records ADD COLUMN IF NOT EXISTS sender_zip   text NOT NULL DEFAULT '';   -- ← [2026-11-19] 발신처 우편번호
ALTER TABLE public.shipping_records ADD COLUMN IF NOT EXISTS receiver_zip text NOT NULL DEFAULT '';   -- ← [2026-11-19] 수신처 우편번호
COMMENT ON COLUMN public.shipping_records.sender_zip   IS '[2026-11-19] 발신처 우편번호(5자리, 주소 검색으로 채움. 직접 입력 주소는 빈 값). 저장 전용 — 라벨·엑셀에 내보내지 않는다';
COMMENT ON COLUMN public.shipping_records.receiver_zip IS '[2026-11-19] 수신처 우편번호(5자리, 주소 검색으로 채움. 직접 입력 주소는 빈 값). 저장 전용 — 라벨·엑셀에 내보내지 않는다';

-- ─────────────────────────────────────────────────────────────────────────────
-- [B] 함수 3개 — 해당 줄만 치환
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r      record;
  v_def  text;
  v_hits integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- ① shipping_fill: 선택 텍스트 마지막 줄 뒤에 우편번호 읽기·형식 검사 추가
      (1, 'public.shipping_fill(jsonb)',
       $f$  v.receiver_addr2   := btrim(COALESCE(p->>'receiver_addr2', ''));$f$,
       $t$  v.receiver_addr2   := btrim(COALESCE(p->>'receiver_addr2', ''));

  -- 우편번호 (선택 — 주소 검색으로 채워진다. 빈 값 또는 숫자 5자리)   ← [2026-11-19 20261024]
  v.sender_zip       := btrim(COALESCE(p->>'sender_zip', ''));
  v.receiver_zip     := btrim(COALESCE(p->>'receiver_zip', ''));
  IF v.sender_zip <> '' AND v.sender_zip !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'INVALID:sender_zip' USING ERRCODE = 'P0001'; END IF;
  IF v.receiver_zip <> '' AND v.receiver_zip !~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'INVALID:receiver_zip' USING ERRCODE = 'P0001'; END IF;$t$),
      -- ② shipping_create: INSERT 칸 목록
      (2, 'public.shipping_create(jsonb)',
       $f$    receiver_company, receiver_name, receiver_phone, receiver_addr1, receiver_addr2$f$,
       $t$    receiver_company, receiver_name, receiver_phone, receiver_addr1, receiver_addr2,
    sender_zip, receiver_zip$t$),
      -- ③ shipping_create: VALUES
      (3, 'public.shipping_create(jsonb)',
       $f$    v.receiver_company, v.receiver_name, v.receiver_phone, v.receiver_addr1, v.receiver_addr2$f$,
       $t$    v.receiver_company, v.receiver_name, v.receiver_phone, v.receiver_addr1, v.receiver_addr2,
    v.sender_zip, v.receiver_zip$t$),
      -- ④ shipping_update: SET
      (4, 'public.shipping_update(uuid,jsonb)',
       $f$    receiver_addr1 = v.receiver_addr1, receiver_addr2 = v.receiver_addr2,$f$,
       $t$    receiver_addr1 = v.receiver_addr1, receiver_addr2 = v.receiver_addr2,
    sender_zip = v.sender_zip, receiver_zip = v.receiver_zip,$t$)
    ) AS x(ord, fn, frm, rep)
    ORDER BY ord
  LOOP
    SELECT pg_get_functiondef(r.fn::regprocedure) INTO v_def;
    IF position(r.rep IN v_def) > 0 THEN
      RAISE NOTICE '[B-%] % 이미 반영됨 — 건너뜀', r.ord, r.fn;
      CONTINUE;
    END IF;
    v_hits := (length(v_def) - length(replace(v_def, r.frm, ''))) / length(r.frm);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '[B-%] % 치환 대상 줄이 %곳 — 1곳이어야 합니다(운영 본문이 예상과 다름)', r.ord, r.fn, v_hits;
    END IF;
    EXECUTE replace(v_def, r.frm, r.rep);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 검증 — 하나라도 실패하면 전체 롤백
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_fill text; v_create text; v_update text;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'shipping_records' AND column_name IN ('sender_zip', 'receiver_zip')
         AND is_nullable = 'NO') <> 2
    THEN RAISE EXCEPTION '[검증 A] 우편번호 칸 2개가 없거나 NULL 허용'; END IF;

  SELECT prosrc INTO v_fill   FROM pg_proc WHERE oid = 'public.shipping_fill(jsonb)'::regprocedure;
  SELECT prosrc INTO v_create FROM pg_proc WHERE oid = 'public.shipping_create(jsonb)'::regprocedure;
  SELECT prosrc INTO v_update FROM pg_proc WHERE oid = 'public.shipping_update(uuid,jsonb)'::regprocedure;
  IF v_fill NOT LIKE '%INVALID:sender_zip%' OR v_fill NOT LIKE '%INVALID:receiver_zip%'
    THEN RAISE EXCEPTION '[검증 B] shipping_fill 우편번호 미반영'; END IF;
  IF v_create NOT LIKE '%sender_zip, receiver_zip%' OR v_create NOT LIKE '%v.sender_zip, v.receiver_zip%'
    THEN RAISE EXCEPTION '[검증 B] shipping_create 우편번호 미반영'; END IF;
  IF v_update NOT LIKE '%sender_zip = v.sender_zip, receiver_zip = v.receiver_zip%'
    THEN RAISE EXCEPTION '[검증 B] shipping_update 우편번호 미반영'; END IF;
  -- 20261023 의 규칙이 그대로 남아 있는지
  IF v_fill NOT LIKE '%REQUIRED:billable%' OR v_fill NOT LIKE '%INVALID:quantity%'
     OR v_create NOT LIKE '%shipping_no_counters%' OR v_update NOT LIKE '%ITEM_TYPE_LOCKED%' OR v_update NOT LIKE '%EDIT_WINDOW_CLOSED%'
    THEN RAISE EXCEPTION '[검증 B] 20261023 규칙 유실'; END IF;
  -- CREATE OR REPLACE 는 권한을 유지한다 — 그대로인지 확인
  IF NOT has_function_privilege('authenticated', 'public.shipping_create(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.shipping_update(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.shipping_create(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.shipping_fill(jsonb)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.shipping_records', 'INSERT')
    THEN RAISE EXCEPTION '[검증 G] 권한이 20261023 과 달라짐'; END IF;

  RAISE NOTICE '[20261024] 검증 통과 — 우편번호 칸 2개 · 함수 3개 반영 · 기존 규칙·권한 유지';
END $$;

COMMIT;
