-- ============================================================================
-- 20261023_shipping_temp.sql
-- 운송내역서 임시 등록 페이지 (#shipping) — 그룹웨어 이관 기간(2026-11-23~) 대체
--
-- ✅ 변경 이력
--  - [2026-11-19] 신규 (고지 확정 2026-11-19 "SPACE 내 단독 페이지로 구현")
--      · [A] admin_roles CHECK 에 'shipping' 추가 — 운송내역서(관리자) 메뉴 · 전체 조회 권한 (GA).
--            기존 허용값은 운영 정의(pg_get_constraintdef)를 읽어 그대로 두고 'shipping' 만 덧붙인다
--            (저장소 밖에서 추가된 역할이 있어도 지우지 않도록 목록을 손으로 다시 쓰지 않는다).
--      · [B] admin_set_user_roles — profiles.role 재계산 제외 대상에 'shipping' 추가(1줄 치환).
--            'shipping' 은 어드민 탭이 아닌 일반 뷰 권한이다('workboard' 와 같은 축). 제외하지 않으면
--            GA 담당자가 이 역할 하나만 받아도 profiles.role='ADMIN' 이 되어 에메랄드 승인 권한
--            (20261017: 승인 권한 = ADMIN 전원)까지 따라온다.
--            본문은 운영 배포본(pg_get_functiondef)을 읽어 해당 1줄만 치환 — 손으로 옮겨 적지 않는다.
--      · [C] shipping_no_counters — 항목·등록일별 마지막 순번. 번호 발급 전용.
--            "건수+1" 로 번호를 만들면 ① 동시 등록 시 같은 번호 ② 삭제 후 번호 재사용이 생긴다.
--            순번표를 한 문장(INSERT .. ON CONFLICT DO UPDATE)으로 올리면 둘 다 구조적으로 불가능하다.
--      · [D] shipping_records — 운송내역서 1건 = 1행. 삭제는 행 보존(deleted_at) — 뽑은 라벨의 번호 추적.
--            등록자 이름·사번·메일은 등록 시점 profiles 값을 서버가 옮겨 적는다(클라이언트 입력 아님).
--            profiles 행은 퇴사 시 DELETE 되므로 FK 는 ON DELETE SET NULL, 표시는 스냅샷.
--      · [E] 함수
--            shipping_no_prefix(text)        항목 코드 → 수발신번호 접두어 (택배/우편/퀵). 접두어 SSOT.
--            shipping_fill(jsonb)            입력값 검증·정리 SSOT (등록·수정 공용). 내부 전용.
--            shipping_create(jsonb)          등록 + 수발신번호 발급
--            shipping_update(uuid, jsonb)    수정 — 본인 · 등록 당일(KST) · 항목 변경 불가(번호 접두어와 묶임)
--            shipping_delete(uuid)           삭제 — 본인 · 등록 당일(KST) · 번호는 재사용하지 않는다
--      · [F] RLS — SELECT: 본인의 삭제 안 된 행 또는 has_admin_role('shipping'). 쓰기 정책 없음(RPC 만).
--      · [G] 권한 — 기본 권한 REVOKE 후 필요한 것만 GRANT (쓰기는 전부 DEFINER RPC 경유).
--
-- 수발신번호: 접두어-등록일(KST, YYYYMMDD)-순번 3자리  예) 택배-20261123-001
--            순번은 항목별·등록일별로 001 부터. 신청일자(발송할 날짜)가 아니라 등록일 기준.
-- 코드값(화면 라벨은 src/data/shipping.ts 한 곳):
--   item_type  parcel=택배운송비 · post=우체국 등기우편 · quick=퀵서비스
--   direction  send=발송 · receive=수령 · external=외부
--   unit       document=서류 · box=박스 · vinyl=택배비닐
--   region     seoul=서울 · other=그 외 지역
-- 실행: Supabase SQL Editor 전체 Run 또는 MCP apply_migration (트랜잭션 1개 · 멱등)
-- 시뮬: _sim_shipping_20261119/ (결과 _sim__result_20261119.txt)
-- 순서: 20261022_profiles_employee_no.sql → 이 파일
-- 배포 짝: 프론트 feat/shipping-temp (ShippingPage · shippingApi · adminRoles 'shipping')
-- 롤백: _rollback_20261023_shipping_temp.sql
-- ============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- [A] admin_roles CHECK += 'shipping'
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.admin_roles'::regclass AND conname = 'admin_roles_role_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '[A] admin_roles_role_check 제약을 찾지 못했습니다';
  END IF;
  IF v_def LIKE '%''shipping''%' THEN
    RAISE NOTICE '[A] 이미 반영됨 — 건너뜀';
    RETURN;
  END IF;
  IF v_def NOT LIKE 'CHECK ((role = ANY (ARRAY[%' THEN
    RAISE EXCEPTION '[A] admin_roles_role_check 형태가 예상과 다릅니다: %', v_def;
  END IF;
  v_def := replace(v_def, 'ARRAY[', 'ARRAY[''shipping''::text, ');
  ALTER TABLE public.admin_roles DROP CONSTRAINT admin_roles_role_check;
  EXECUTE 'ALTER TABLE public.admin_roles ADD CONSTRAINT admin_roles_role_check ' || v_def;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [B] admin_set_user_roles — profiles.role 재계산에서 'shipping' 제외 (1줄 치환)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_from text := $s$array_length(array_remove(v_new, 'workboard'), 1) > 0$s$;
  v_to   text := $s$array_length(array_remove(array_remove(v_new, 'workboard'), 'shipping'), 1) > 0$s$;
  v_hits integer;
BEGIN
  SELECT pg_get_functiondef('public.admin_set_user_roles(uuid,text[])'::regprocedure) INTO v_def;
  IF position(v_to IN v_def) > 0 THEN
    RAISE NOTICE '[B] 이미 반영됨 — 건너뜀';
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '[B] admin_set_user_roles 재계산 줄이 %곳 — 1곳이어야 합니다(운영 본문이 예상과 다름)', v_hits;
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END $$;

COMMENT ON FUNCTION public.admin_set_user_roles(uuid, text[]) IS
  '[2026-11-19] profiles.role 재계산 제외 = workboard · shipping (어드민 탭이 아닌 일반 뷰 권한). 그 외 역할이 1개 이상이면 ADMIN';

-- ─────────────────────────────────────────────────────────────────────────────
-- [C] 순번표
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_no_counters (
  item_type text    NOT NULL,
  issued_on date    NOT NULL,                 -- 등록일 (KST)
  last_seq  integer NOT NULL,
  PRIMARY KEY (item_type, issued_on)
);
COMMENT ON TABLE public.shipping_no_counters IS '[2026-11-19] 운송내역서 수발신번호 순번표 — 항목·등록일(KST)별 마지막 순번. shipping_create 만 쓴다. 줄이지 말 것(번호 재사용 금지)';

-- ─────────────────────────────────────────────────────────────────────────────
-- [D] 운송내역서
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_records (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_no      text        NOT NULL UNIQUE,                    -- 수발신번호
  item_type        text        NOT NULL CHECK (item_type IN ('parcel','post','quick')),
  issued_on        date        NOT NULL,                           -- 등록일 (KST) — 번호의 날짜 · 당일 수정 판정 기준
  seq              integer     NOT NULL,
  -- 등록자 (등록 시점 profiles 스냅샷 — 서버가 채운다)
  user_id          uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name        text        NOT NULL,
  user_email       text        NOT NULL DEFAULT '',
  employee_no      text        NOT NULL DEFAULT '',                -- 사번 (profiles.employee_no)
  -- 운송 등록
  project_no       text        NOT NULL,                           -- 프로젝트명 칸 입력값 (예: 24-046, CNR)
  billable         boolean     NOT NULL,                           -- 청구여부 Yes/No
  requested_on     date        NOT NULL,                           -- 신청일자 (발송할 날짜)
  amount           integer     NOT NULL DEFAULT 0,                 -- 사용금액 (입력 불가 — 0)
  direction        text        NOT NULL CHECK (direction IN ('send','receive','external')),
  unit             text                 CHECK (unit IN ('document','box','vinyl')),
  quantity         integer     NOT NULL CHECK (quantity > 0),
  contents         text        NOT NULL DEFAULT '',
  tracking_no      text        NOT NULL DEFAULT '',
  region           text        NOT NULL CHECK (region IN ('seoul','other')),
  weight_g         integer     NOT NULL DEFAULT 0,                 -- 무게 (입력 불가 — 0)
  note             text        NOT NULL DEFAULT '',
  -- 발신처
  sender_company   text        NOT NULL DEFAULT '',
  sender_name      text        NOT NULL,
  sender_phone     text        NOT NULL,
  sender_addr1     text        NOT NULL DEFAULT '',
  sender_addr2     text        NOT NULL DEFAULT '',
  -- 수신처
  receiver_company text        NOT NULL DEFAULT '',
  receiver_name    text        NOT NULL,
  receiver_phone   text        NOT NULL,
  receiver_addr1   text        NOT NULL DEFAULT '',
  receiver_addr2   text        NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  UNIQUE (item_type, issued_on, seq)
);
COMMENT ON TABLE  public.shipping_records IS '[2026-11-19] 운송내역서 임시 등록(#shipping). 쓰기는 shipping_create/update/delete RPC 만. 삭제는 deleted_at 표시(행 보존)';
COMMENT ON COLUMN public.shipping_records.issued_on    IS '등록일(KST date). 수발신번호의 날짜이자 "등록 당일만 수정" 판정 기준';
COMMENT ON COLUMN public.shipping_records.requested_on IS '신청일자 = 발송할 날짜(KST date). 등록일과 다를 수 있다';

CREATE INDEX IF NOT EXISTS idx_shipping_records_user      ON public.shipping_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipping_records_requested ON public.shipping_records (requested_on);

-- ─────────────────────────────────────────────────────────────────────────────
-- [E] 함수
-- ─────────────────────────────────────────────────────────────────────────────

-- 항목 코드 → 수발신번호 접두어 (접두어 SSOT — 화면은 번호를 만들지 않는다)
CREATE OR REPLACE FUNCTION public.shipping_no_prefix(p_item_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_item_type
           WHEN 'parcel' THEN '택배'
           WHEN 'post'   THEN '우편'
           WHEN 'quick'  THEN '퀵'
         END
$function$;

-- 입력값 검증·정리 SSOT (등록·수정 공용). 사용자 입력 칸만 채운 행을 돌려준다.
--   오류 코드: REQUIRED:<칸> / INVALID:<칸>
CREATE OR REPLACE FUNCTION public.shipping_fill(p jsonb)
RETURNS public.shipping_records
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v     public.shipping_records;
  v_txt text;
  k     text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'INVALID:payload' USING ERRCODE = 'P0001';
  END IF;

  -- 필수 텍스트
  FOREACH k IN ARRAY ARRAY['project_no','sender_name','sender_phone','receiver_name','receiver_phone'] LOOP
    IF btrim(COALESCE(p->>k, '')) = '' THEN
      RAISE EXCEPTION 'REQUIRED:%', k USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v.project_no       := btrim(p->>'project_no');
  v.sender_name      := btrim(p->>'sender_name');
  v.sender_phone     := btrim(p->>'sender_phone');
  v.receiver_name    := btrim(p->>'receiver_name');
  v.receiver_phone   := btrim(p->>'receiver_phone');

  -- 선택 텍스트
  v.contents         := btrim(COALESCE(p->>'contents', ''));
  v.tracking_no      := btrim(COALESCE(p->>'tracking_no', ''));
  v.note             := btrim(COALESCE(p->>'note', ''));
  v.sender_company   := btrim(COALESCE(p->>'sender_company', ''));
  v.sender_addr1     := btrim(COALESCE(p->>'sender_addr1', ''));
  v.sender_addr2     := btrim(COALESCE(p->>'sender_addr2', ''));
  v.receiver_company := btrim(COALESCE(p->>'receiver_company', ''));
  v.receiver_addr1   := btrim(COALESCE(p->>'receiver_addr1', ''));
  v.receiver_addr2   := btrim(COALESCE(p->>'receiver_addr2', ''));

  -- 청구여부 (기본값 없음 — 반드시 선택)
  IF jsonb_typeof(p->'billable') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'REQUIRED:billable' USING ERRCODE = 'P0001';
  END IF;
  v.billable := (p->>'billable')::boolean;

  -- 항목
  v_txt := COALESCE(p->>'item_type', '');
  IF v_txt = '' THEN RAISE EXCEPTION 'REQUIRED:item_type' USING ERRCODE = 'P0001'; END IF;
  IF v_txt NOT IN ('parcel','post','quick') THEN RAISE EXCEPTION 'INVALID:item_type' USING ERRCODE = 'P0001'; END IF;
  v.item_type := v_txt;

  -- 수발형태
  v_txt := COALESCE(p->>'direction', '');
  IF v_txt = '' THEN RAISE EXCEPTION 'REQUIRED:direction' USING ERRCODE = 'P0001'; END IF;
  IF v_txt NOT IN ('send','receive','external') THEN RAISE EXCEPTION 'INVALID:direction' USING ERRCODE = 'P0001'; END IF;
  v.direction := v_txt;

  -- 단위 (선택)
  v_txt := COALESCE(p->>'unit', '');
  IF v_txt <> '' AND v_txt NOT IN ('document','box','vinyl') THEN RAISE EXCEPTION 'INVALID:unit' USING ERRCODE = 'P0001'; END IF;
  v.unit := NULLIF(v_txt, '');

  -- 지역 (기본값 없음 — 반드시 선택)
  v_txt := COALESCE(p->>'region', '');
  IF v_txt = '' THEN RAISE EXCEPTION 'REQUIRED:region' USING ERRCODE = 'P0001'; END IF;
  IF v_txt NOT IN ('seoul','other') THEN RAISE EXCEPTION 'INVALID:region' USING ERRCODE = 'P0001'; END IF;
  v.region := v_txt;

  -- 수량 (숫자만 · 1 이상)
  v_txt := btrim(COALESCE(p->>'quantity', ''));
  IF v_txt = '' THEN RAISE EXCEPTION 'REQUIRED:quantity' USING ERRCODE = 'P0001'; END IF;
  IF v_txt !~ '^[1-9][0-9]{0,5}$' THEN RAISE EXCEPTION 'INVALID:quantity' USING ERRCODE = 'P0001'; END IF;
  v.quantity := v_txt::integer;

  -- 신청일자 (비우면 오늘 KST — 그룹웨어 기본값과 동일)
  v_txt := btrim(COALESCE(p->>'requested_on', ''));
  IF v_txt = '' THEN
    v.requested_on := (now() AT TIME ZONE 'Asia/Seoul')::date;
  ELSE
    IF v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID:requested_on' USING ERRCODE = 'P0001'; END IF;
    BEGIN
      v.requested_on := v_txt::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID:requested_on' USING ERRCODE = 'P0001';
    END;
  END IF;

  RETURN v;
END;
$function$;

-- 등록 + 수발신번호 발급
CREATE OR REPLACE FUNCTION public.shipping_create(p jsonb)
RETURNS public.shipping_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_prof  record;
  v       public.shipping_records;
  v_seq   integer;
  v_row   public.shipping_records;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, name, email, employee_no INTO v_prof FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v := public.shipping_fill(p);

  -- 순번 발급 — 한 문장으로 올린다(동시 등록 시 행 잠금으로 직렬화). 삭제해도 줄이지 않는다.
  INSERT INTO public.shipping_no_counters (item_type, issued_on, last_seq)
  VALUES (v.item_type, v_today, 1)
  ON CONFLICT (item_type, issued_on) DO UPDATE SET last_seq = public.shipping_no_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  INSERT INTO public.shipping_records (
    shipping_no, item_type, issued_on, seq,
    user_id, user_name, user_email, employee_no,
    project_no, billable, requested_on, direction, unit, quantity, contents, tracking_no, region, note,
    sender_company, sender_name, sender_phone, sender_addr1, sender_addr2,
    receiver_company, receiver_name, receiver_phone, receiver_addr1, receiver_addr2
  ) VALUES (
    public.shipping_no_prefix(v.item_type) || '-' || to_char(v_today, 'YYYYMMDD') || '-'
      || lpad(v_seq::text, GREATEST(3, length(v_seq::text)), '0'),
    v.item_type, v_today, v_seq,
    v_uid, COALESCE(v_prof.name, ''), COALESCE(v_prof.email, ''), COALESCE(v_prof.employee_no, ''),
    v.project_no, v.billable, v.requested_on, v.direction, v.unit, v.quantity, v.contents, v.tracking_no, v.region, v.note,
    v.sender_company, v.sender_name, v.sender_phone, v.sender_addr1, v.sender_addr2,
    v.receiver_company, v.receiver_name, v.receiver_phone, v.receiver_addr1, v.receiver_addr2
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 수정 — 본인 · 등록 당일(KST) · 항목 변경 불가
CREATE OR REPLACE FUNCTION public.shipping_update(p_id uuid, p jsonb)
RETURNS public.shipping_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_cur   public.shipping_records;
  v       public.shipping_records;
  v_row   public.shipping_records;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cur FROM public.shipping_records WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_cur.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur.issued_on <> v_today THEN
    RAISE EXCEPTION 'EDIT_WINDOW_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  v := public.shipping_fill(p);
  IF v.item_type <> v_cur.item_type THEN
    RAISE EXCEPTION 'ITEM_TYPE_LOCKED' USING ERRCODE = 'P0001';   -- 번호 접두어와 묶임 — 바꾸려면 삭제 후 재등록
  END IF;

  UPDATE public.shipping_records SET
    project_no = v.project_no, billable = v.billable, requested_on = v.requested_on,
    direction = v.direction, unit = v.unit, quantity = v.quantity, contents = v.contents,
    tracking_no = v.tracking_no, region = v.region, note = v.note,
    sender_company = v.sender_company, sender_name = v.sender_name, sender_phone = v.sender_phone,
    sender_addr1 = v.sender_addr1, sender_addr2 = v.sender_addr2,
    receiver_company = v.receiver_company, receiver_name = v.receiver_name, receiver_phone = v.receiver_phone,
    receiver_addr1 = v.receiver_addr1, receiver_addr2 = v.receiver_addr2,
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 삭제 — 본인 · 등록 당일(KST). 행은 남기고 표시만 한다(번호 재사용 금지)
CREATE OR REPLACE FUNCTION public.shipping_delete(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_cur   public.shipping_records;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cur FROM public.shipping_records WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_cur.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur.issued_on <> v_today THEN
    RAISE EXCEPTION 'EDIT_WINDOW_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.shipping_records
     SET deleted_at = now(), deleted_by = v_uid, updated_at = now()
   WHERE id = p_id;
  RETURN p_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [F] RLS — 읽기만. 쓰기 정책이 없으므로 직접 INSERT/UPDATE/DELETE 는 전부 거부된다
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipping_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_no_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipping_records_select ON public.shipping_records;
CREATE POLICY shipping_records_select ON public.shipping_records
  FOR SELECT TO authenticated
  USING ( (user_id = auth.uid() AND deleted_at IS NULL) OR public.has_admin_role('shipping') );

-- ─────────────────────────────────────────────────────────────────────────────
-- [G] 권한 — Supabase 기본 권한(anon/authenticated ALL)을 걷어내고 필요한 것만
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.shipping_records, public.shipping_no_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shipping_records TO authenticated;
GRANT ALL ON public.shipping_records, public.shipping_no_counters TO service_role;

REVOKE ALL ON FUNCTION public.shipping_no_prefix(text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shipping_fill(jsonb)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shipping_create(jsonb)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shipping_update(uuid, jsonb)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shipping_delete(uuid)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shipping_create(jsonb)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shipping_update(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shipping_delete(uuid)        TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 검증 — 하나라도 실패하면 전체 롤백
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_src text;
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.admin_roles'::regclass AND conname = 'admin_roles_role_check') NOT LIKE '%''shipping''%'
    THEN RAISE EXCEPTION '[검증 A] admin_roles CHECK 에 shipping 없음'; END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.admin_set_user_roles(uuid,text[])'::regprocedure;
  IF v_src NOT LIKE '%array_remove(array_remove(v_new, ''workboard''), ''shipping'')%'
    THEN RAISE EXCEPTION '[검증 B] admin_set_user_roles 재계산 제외 미반영'; END IF;
  IF v_src NOT LIKE '%LAST_SUPER%' OR v_src NOT LIKE '%CANNOT_REVOKE_OWN_SUPER%' OR v_src NOT LIKE '%admin_role_grants%'
    THEN RAISE EXCEPTION '[검증 B] admin_set_user_roles 기존 안전장치·감사로그 유실'; END IF;

  IF to_regclass('public.shipping_records') IS NULL OR to_regclass('public.shipping_no_counters') IS NULL
    THEN RAISE EXCEPTION '[검증 C·D] 테이블 없음'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shipping_records'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shipping_no_counters'::regclass)
    THEN RAISE EXCEPTION '[검증 F] RLS 꺼짐'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shipping_records') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shipping_no_counters') <> 0
    THEN RAISE EXCEPTION '[검증 F] 정책 개수 불일치 (records 1 · counters 0 이어야 함)'; END IF;

  IF has_table_privilege('authenticated', 'public.shipping_records', 'INSERT')
     OR has_table_privilege('authenticated', 'public.shipping_records', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.shipping_records', 'DELETE')
     OR has_table_privilege('authenticated', 'public.shipping_no_counters', 'SELECT')
     OR has_table_privilege('anon', 'public.shipping_records', 'SELECT')
    THEN RAISE EXCEPTION '[검증 G] 테이블 직접 쓰기/익명 읽기 권한이 남아 있음'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.shipping_records', 'SELECT')
    THEN RAISE EXCEPTION '[검증 G] authenticated SELECT 없음'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.shipping_create(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.shipping_create(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.shipping_fill(jsonb)', 'EXECUTE')
    THEN RAISE EXCEPTION '[검증 G] 함수 실행 권한 불일치'; END IF;

  IF public.shipping_no_prefix('parcel') <> '택배' OR public.shipping_no_prefix('post') <> '우편' OR public.shipping_no_prefix('quick') <> '퀵'
    THEN RAISE EXCEPTION '[검증 E] 접두어 불일치'; END IF;

  RAISE NOTICE '[20261023] 검증 통과 — shipping 역할 · 재계산 제외 · 테이블 2 · RPC 3 · RLS · 권한';
END $$;

COMMIT;
