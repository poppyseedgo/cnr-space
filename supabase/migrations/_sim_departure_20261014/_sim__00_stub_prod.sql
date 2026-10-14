-- ============================================================================
-- 퇴사 수정안 7건(2026-10-14) 시뮬 스텁 — 운영 실측(2026-10-14 pg_proc/pg_constraint 덤프) 1:1
--   대상: 20261020_departure_fixes.sql · 20261021_org_departed_names.sql
--   주의: block_cancel_on_checked_in / block_premature_noshow 는 10/8 시뮬(U2·U3)에서
--         process_departure ② 통과가 이미 확정돼 제외. 이번 변경과 상호작용 없음.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sim_service') THEN CREATE ROLE sim_service LOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

-- ── 핵심 테이블 (운영 컬럼 중 이번 경로가 만지는 것만) ──────────────────────
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, email text, name text, dept text, role text DEFAULT 'USER',
  employee_id text, avatar_url text, is_active boolean DEFAULT true,
  employment_status text DEFAULT 'active', departure_scheduled_on date, returned_on date);

CREATE TABLE public.departed_users (
  id uuid PRIMARY KEY, name text, email text, dept text, employee_id text,
  departed_at timestamptz DEFAULT now(), avatar_url text);

CREATE TABLE public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL, granted_at timestamptz DEFAULT now(), granted_by uuid,
  UNIQUE (user_id, role));
CREATE TABLE public.admin_role_grants (
  id bigint GENERATED ALWAYS AS IDENTITY, target_user uuid, role text, action text, actor uuid, created_at timestamptz DEFAULT now());

CREATE TABLE public.bookings (
  id text PRIMARY KEY, user_id uuid, user_email text, start_at timestamptz, end_at timestamptz,
  status text DEFAULT 'confirmed', cancelled_by text, auto_cancelled boolean DEFAULT false, checked_in boolean DEFAULT false);

CREATE TABLE public.resource_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, user_id uuid,
  status text DEFAULT 'confirmed', start_at timestamptz, end_at timestamptz, return_due date,
  returned_at timestamptz, returned_by uuid, cancelled_by text, cancelled_at timestamptz,
  period_changed_at timestamptz, period_changed_by uuid);

CREATE TABLE public.books (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, status text DEFAULT 'available', updated_at timestamptz);
CREATE TABLE public.book_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), book_id uuid, user_id uuid,
  status text DEFAULT 'active', checkout_at timestamptz DEFAULT now(),
  returned_at timestamptz, notes text, processed_at timestamptz, reject_reason text, updated_at timestamptz);

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_id uuid REFERENCES auth.users(id),          -- 운영 실측: ON DELETE 무지정(NO ACTION) — H1 대상
  actor_name text, action text, entity_type text, entity_id text, after_data jsonb, created_at timestamptz DEFAULT now());

-- ── 운영 배포본 함수 (pg_proc 2026-10-14 실측 그대로) ───────────────────────
CREATE OR REPLACE FUNCTION public.is_profile_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.has_admin_role(role_name text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND (role = role_name OR role = 'super'));
END; $$;

-- revoke_roles_on_departure (운영 실측 그대로)
CREATE OR REPLACE FUNCTION public.revoke_roles_on_departure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_super_total integer; v_has_super boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = NEW.id AND role = 'super') INTO v_has_super;
  SELECT count(*) INTO v_super_total FROM public.admin_roles WHERE role = 'super';
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT NEW.id, role, 'revoke', NULL FROM public.admin_roles WHERE user_id = NEW.id AND role <> 'super';
  DELETE FROM public.admin_roles WHERE user_id = NEW.id AND role <> 'super';
  IF v_has_super THEN
    IF v_super_total > 1 THEN
      INSERT INTO public.admin_role_grants (target_user, role, action, actor) VALUES (NEW.id, 'super', 'revoke', NULL);
      DELETE FROM public.admin_roles WHERE user_id = NEW.id AND role = 'super';
    ELSE
      INSERT INTO public.admin_role_grants (target_user, role, action, actor) VALUES (NEW.id, 'super', 'grant', NULL);
      RAISE WARNING '퇴사자(%)가 마지막 super 입니다. 회수하지 않았습니다 — 다른 사람에게 부여 후 정리하세요.', NEW.id;
    END IF;
  END IF;
  UPDATE public.profiles SET role = CASE WHEN EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = NEW.id) THEN 'ADMIN' ELSE 'USER' END WHERE id = NEW.id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_revoke_roles_on_departure AFTER INSERT ON public.departed_users
  FOR EACH ROW EXECUTE FUNCTION public.revoke_roles_on_departure();

-- 구 퇴사 트리거 (M1 제거 대상 — 운영 실측 그대로)
CREATE OR REPLACE FUNCTION public.handle_user_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
declare cancelled_count int;
begin
  update public.bookings set auto_cancelled = true, cancelled_by = 'system'
  where user_id = old.id and auto_cancelled = false and start_at > now();
  get diagnostics cancelled_count = row_count;
  if cancelled_count > 0 then
    insert into public.audit_log (actor_id, actor_name, action, entity_type, entity_id, after_data)
    select null, 'system', 'BOOKING_CANCELLED', 'booking', id::text,
      jsonb_build_object('reason', '퇴사 처리로 인한 자동 취소', 'user_name', old.name, 'cancelled_at', now())
    from public.bookings where user_id = old.id and auto_cancelled = true and cancelled_by = 'system' and start_at > now() - interval '1 minute';
  end if;
  return old;
end; $$;
CREATE TRIGGER on_profile_deleted AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_deletion();

-- resource_bookings_guard_update (운영 배포본 — C2 수정 전 원본. 마이그레이션이 교체)
CREATE OR REPLACE FUNCTION public.resource_bookings_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_admin      boolean := has_admin_role('resource');
  v_today_kst  date    := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_started    boolean := now() >= OLD.start_at;
  v_period_chg boolean := NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at OR NEW.return_due IS DISTINCT FROM OLD.return_due;
BEGIN
  IF session_user = 'postgres' THEN RETURN NEW; END IF;
  IF (NEW.returned_at IS DISTINCT FROM OLD.returned_at OR NEW.returned_by IS DISTINCT FROM OLD.returned_by) AND NOT v_admin THEN
    RAISE EXCEPTION 'RETURN_CONFIRM_ADMIN_ONLY' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_admin AND (NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
  END IF;
  IF v_period_chg THEN
    IF OLD.status <> 'confirmed' OR OLD.returned_at IS NOT NULL THEN RAISE EXCEPTION 'BOOKING_CLOSED' USING ERRCODE = 'P0001'; END IF;
    IF v_started AND NEW.start_at IS DISTINCT FROM OLD.start_at THEN RAISE EXCEPTION 'START_LOCKED' USING ERRCODE = 'P0001'; END IF;
    NEW.period_changed_at := now(); NEW.period_changed_by := auth.uid();
  END IF;
  RETURN NEW;
END; $function$;
CREATE TRIGGER trg_resource_bookings_guard_update BEFORE UPDATE ON public.resource_bookings
  FOR EACH ROW EXECUTE FUNCTION public.resource_bookings_guard_update();

-- process_departure (운영 배포본 — H2·M3 수정 전 원본. 마이그레이션이 교체)
CREATE OR REPLACE FUNCTION public.process_departure(p_user_id uuid, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE; v_now timestamptz := now();
  v_cancelled_rooms int := 0; v_cancelled_res int := 0; v_returned_res int := 0;
  v_returned_books int := 0; v_cancelled_books int := 0; v_revoked_roles int := 0;
BEGIN
  IF NOT ( auth.role() = 'service_role' OR public.is_profile_admin() OR public.has_admin_role('user') ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = '퇴사 처리 권한이 없습니다.';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF FOUND THEN
    INSERT INTO public.departed_users (id, name, email, dept, employee_id, avatar_url, departed_at)
    VALUES (v_profile.id, COALESCE(v_profile.name,''), COALESCE(v_profile.email,''), COALESCE(v_profile.dept,''), COALESCE(v_profile.employee_id,''), v_profile.avatar_url, v_now)
    ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE(EXCLUDED.avatar_url, public.departed_users.avatar_url);
  END IF;
  UPDATE public.bookings SET status='cancelled', cancelled_by='departed', auto_cancelled=true
   WHERE user_id = p_user_id AND start_at > v_now AND status IN ('confirmed','pending');
  GET DIAGNOSTICS v_cancelled_rooms = ROW_COUNT;
  UPDATE public.resource_bookings SET status='cancelled', cancelled_by='departed', cancelled_at=v_now
   WHERE user_id = p_user_id AND start_at > v_now AND status = 'confirmed';
  GET DIAGNOSTICS v_cancelled_res = ROW_COUNT;
  UPDATE public.resource_bookings SET returned_at = v_now, returned_by = p_actor
   WHERE user_id = p_user_id AND status='confirmed' AND start_at <= v_now AND returned_at IS NULL;
  GET DIAGNOSTICS v_returned_res = ROW_COUNT;
  UPDATE public.book_checkouts SET status='returned', returned_at=v_now,
         notes = COALESCE(notes || E'\n','') || '[퇴사 처리 강제 반납 ' || to_char(v_now AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') || ']', updated_at=v_now
   WHERE user_id = p_user_id AND status IN ('active','overdue') AND checkout_at <= v_now;
  GET DIAGNOSTICS v_returned_books = ROW_COUNT;
  UPDATE public.book_checkouts SET status='cancelled', processed_at=v_now, reject_reason='퇴사 처리로 자동 취소되었습니다.', updated_at=v_now
   WHERE user_id = p_user_id AND status='active' AND checkout_at > v_now;
  GET DIAGNOSTICS v_cancelled_books = ROW_COUNT;
  UPDATE public.books b SET status='available', updated_at=v_now
   WHERE b.status='borrowed'
     AND EXISTS (SELECT 1 FROM public.book_checkouts c WHERE c.book_id=b.id AND c.user_id=p_user_id AND c.returned_at=v_now)
     AND NOT EXISTS (SELECT 1 FROM public.book_checkouts c WHERE c.book_id=b.id AND c.status IN ('active','overdue') AND c.checkout_at <= v_now AND c.returned_at IS NULL);
  WITH del AS (DELETE FROM public.admin_roles WHERE user_id = p_user_id RETURNING role)
  INSERT INTO public.admin_role_grants (target_user, role, action, actor) SELECT p_user_id, role, 'revoke', p_actor FROM del;
  GET DIAGNOSTICS v_revoked_roles = ROW_COUNT;
  DELETE FROM public.profiles WHERE id = p_user_id;
  RETURN jsonb_build_object('user_id',p_user_id,'cancelled_bookings',v_cancelled_rooms,'cancelled_resources',v_cancelled_res,
    'returned_resources',v_returned_res,'returned_books',v_returned_books,'cancelled_books',v_cancelled_books,
    'revoked_roles',v_revoked_roles,'processed_at',v_now);
END $function$;

-- ── 조직도 스텁 (운영 실측 — org_cards_guard·lifecycle·log·touch 그대로) ────
CREATE TABLE public.org_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, status text DEFAULT 'draft', updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.org_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_id uuid REFERENCES public.org_files(id) ON DELETE CASCADE, parent_unit_id uuid, name text, sort_order int DEFAULT 0, kind text DEFAULT 'unit', code text);
CREATE TABLE public.org_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.org_files(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  profile_id uuid, person_id uuid, display_name text, rank_id uuid, reports_to_card_id uuid REFERENCES public.org_cards(id) ON DELETE SET NULL,
  is_unit_head boolean DEFAULT false, is_primary boolean DEFAULT true, is_vacancy boolean DEFAULT false,
  employment_type text DEFAULT 'regular', work_location text, fte numeric DEFAULT 1, memo text,
  hidden_at timestamptz, sort_order int DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_display_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,   -- 운영 실측: CASCADE (A 가 제거)
  display_name text NOT NULL, note text, updated_by uuid, updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_change_log (id bigint GENERATED ALWAYS AS IDENTITY, file_id uuid, actor uuid, action text, target_table text, target_id text, before jsonb, after jsonb, created_at timestamptz DEFAULT now());

CREATE OR REPLACE FUNCTION public.org_lifecycle_on() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('org.lifecycle', true), '') = 'on' $$;
CREATE OR REPLACE FUNCTION public.org_file_is_editable(p_file uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_files WHERE id = p_file AND status = 'draft') $$;

CREATE OR REPLACE FUNCTION public.org_cards_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_f uuid; v_n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = OLD.file_id) THEN RETURN OLD; END IF;
    IF NOT public.org_file_is_editable(OLD.file_id) AND NOT public.org_lifecycle_on() THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT public.org_file_is_editable(NEW.file_id) AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.file_id <> NEW.file_id THEN RAISE EXCEPTION 'ORG_CARD_FILE_IMMUTABLE'; END IF;
  SELECT file_id INTO v_f FROM public.org_units WHERE id = NEW.unit_id;
  IF v_f IS NULL OR v_f <> NEW.file_id THEN RAISE EXCEPTION 'ORG_CARD_UNIT_OTHER_FILE'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_org_cards_guard BEFORE INSERT OR UPDATE OR DELETE ON public.org_cards
  FOR EACH ROW EXECUTE FUNCTION public.org_cards_guard();

CREATE OR REPLACE FUNCTION public.org_log_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_old jsonb; v_new jsonb; v_file uuid; v_id text;
  v_noise text[] := ARRAY['updated_at','updated_by','lock_by','lock_at'];
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (v_old - v_noise) = (v_new - v_noise) THEN RETURN NULL; END IF;
  v_id := COALESCE(v_new->>'id', v_old->>'id');
  v_file := COALESCE((v_new->>'file_id')::uuid, (v_old->>'file_id')::uuid);
  INSERT INTO public.org_change_log (file_id, actor, action, target_table, target_id, before, after)
  VALUES (v_file, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP='INSERT' THEN NULL ELSE v_old END, CASE WHEN TG_OP='DELETE' THEN NULL ELSE v_new END);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_org_log AFTER INSERT OR UPDATE OR DELETE ON public.org_cards
  FOR EACH ROW EXECUTE FUNCTION public.org_log_change();

CREATE OR REPLACE FUNCTION public.org_touch_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_file uuid;
BEGIN
  v_file := COALESCE((to_jsonb(NEW)->>'file_id')::uuid, (to_jsonb(OLD)->>'file_id')::uuid);
  IF v_file IS NOT NULL THEN UPDATE public.org_files SET updated_at = now(), updated_by = COALESCE(auth.uid(), updated_by) WHERE id = v_file; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_org_touch AFTER INSERT OR UPDATE OR DELETE ON public.org_cards
  FOR EACH ROW EXECUTE FUNCTION public.org_touch_file();

-- sim_service 권한 (클라이언트/service_role 경로 재현)
GRANT USAGE ON SCHEMA public, auth TO sim_service;
GRANT ALL ON ALL TABLES IN SCHEMA public TO sim_service;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO sim_service;
GRANT SELECT ON auth.users TO sim_service;
