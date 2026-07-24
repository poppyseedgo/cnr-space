-- ═══════════════════════════════════════════════════════════════════════════
-- 20260730_admin_roles_phase1.sql — 관리자 권한 세분화 Phase 1
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 배경
-- ═══════════════════════════════════════════════════════════════════════════
--
--   권한 체계가 두 벌로 갈라져 있었다.
--     · profiles.role = 'ADMIN' (11명)  → 프론트 isAdmin, 어드민 진입
--     · admin_roles(role)               → 도서·포인터 RLS (has_admin_role)
--   같은 질문("이 사람이 관리자인가")에 답이 둘이라 도서관 RLS 차단, 포인터 예정,
--   알림 수신자 11명 문제가 같은 뿌리에서 세 번 났다.
--   게다가 **부여 화면이 아예 없어** SQL 을 직접 실행해야 했고, granted_by 는 비어 있었다.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 동기화 방식 — 트리거가 아니라 RPC 안에서 재계산한다 (고지 확정)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   admin_roles 쓰기는 RLS 상 super 만 가능하고 화면에서는 아래 RPC 하나로 강제되므로,
--   트리거의 이점(모든 경로 커버)이 실제로는 거의 없다. 반면 트리거는
--     · 다건 저장 시 n+1 회 발동
--     · 호출부가 코드에 안 보여 추적 불가
--     · 감사 로그와 트랜잭션이 갈림
--   이라는 대가가 분명하다(이 프로젝트는 block_cancel_on_checked_in 트리거에서
--   session_user='postgres' 우회를 따로 뚫어야 했던 전례가 있다).
--
--   대신 SQL 직접 조작으로 어긋날 가능성은 **정합성 점검 쿼리**로 잡는다(파일 하단).
--
-- 실행: Supabase SQL Editor (BEGIN..COMMIT · 멱등 · 재실행 안전)
-- 선행: 20260511_v2_phase_a_rls_policies.sql (admin_roles, has_admin_role)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1) 역할 값 고정
--
--    프론트 src/data/adminRoles.ts 의 id 와 **정확히 같아야 한다.**
--    RLS 정책들이 has_admin_role('book') 처럼 문자열로 참조하므로,
--    이름이 어긋나면 정책이 조용히 false 를 돌려준다(에러가 안 난다).
--
--    'zoom' 은 사내 사용 종료(2026-07-21)라 신규 부여 대상이 아니지만,
--    기존 행을 지우면 되돌릴 수 없으므로 허용값에는 남긴다.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_roles DROP CONSTRAINT IF EXISTS admin_roles_role_check;
ALTER TABLE public.admin_roles ADD CONSTRAINT admin_roles_role_check
  CHECK (role IN (
    'dashboard','booking','approval','room','user','visitor',
    'book','notification','notice','pointer','super',
    -- ── 레거시 값 (신규 부여 금지 · 기존 행 보존용) ──────────────────────
    --   ⚠ 원본 정의(20260511_v2_extension_schema.sql:66)의 CHECK 는
    --     ('meeting_room','zoom','pointer','book','super') 였다.
    --     이 둘을 빼면 **기존 행이 있을 때 ALTER 자체가 실패**하고
    --     BEGIN..COMMIT 이 통째로 롤백된다. 값 목록에서 지우기 전에
    --     아래 [E] 쿼리로 실제 사용 여부를 먼저 확인할 것.
    'zoom', 'meeting_room'
  ));

-- 같은 사람에게 같은 역할이 두 번 들어가지 않게
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_roles_user_role
  ON public.admin_roles (user_id, role);

-- ────────────────────────────────────────────────────────────────────────
-- 2) 감사 로그
--
--    admin_roles.granted_by 만으로는 **회수 이력이 남지 않는다**(행이 사라지므로).
--    "언제부터 이 사람이 도서 관리를 못 하게 됐나" 를 물었을 때 답할 수 있어야 한다.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_role_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user uuid        NOT NULL,
  role        text        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('grant','revoke')),
  actor       uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_role_grants_target
  ON public.admin_role_grants (target_user, created_at DESC);

ALTER TABLE public.admin_role_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_role_grants_read ON public.admin_role_grants;
CREATE POLICY admin_role_grants_read
  ON public.admin_role_grants FOR SELECT
  USING (public.has_admin_role('super'));

-- ────────────────────────────────────────────────────────────────────────
-- 3) admin_roles SELECT 정책 완화
--
--    기존: 본인 것 + super 만 전체 조회.
--    그런데 사용자 관리 화면에서 "누가 어떤 역할인지" 목록을 봐야 하고,
--    그 화면은 'user' 역할 보유자만 들어온다. 일반 사용자에게 노출되는 게 아니라
--    **관리자에게만** 보이므로 원래의 보안 원칙("누가 admin인지 노출 안 함")은 지켜진다.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_roles_select_self_or_super" ON public.admin_roles;
DROP POLICY IF EXISTS admin_roles_select_self_or_admin ON public.admin_roles;
CREATE POLICY admin_roles_select_self_or_admin
  ON public.admin_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role('super')
    OR public.has_admin_role('user')
  );

-- ────────────────────────────────────────────────────────────────────────
-- 4) 역할 저장 — admin_set_user_roles
--
--    한 사람의 역할 **전체를 교체**한다. 부분 add/remove 로 두면 화면이 보여준
--    체크 상태와 결과가 갈리고, 두 관리자가 동시에 편집할 때 한쪽이 조용히 사라진다.
--
--    ★ 안전장치 3가지
--      ① super 만 실행 — 일반 관리자가 자기 권한을 올리는 경로 차단
--      ② 자기 자신의 super 회수 금지 — 실수로 스스로를 잠그는 사고 방지
--      ③ 마지막 super 회수 금지 — super 가 0명이 되면 아무도 권한을 못 준다.
--         이 상태는 화면으로 복구가 불가능하고 DB 직접 접근만 남는다.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_roles(
  p_user_id uuid,
  p_roles   text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_new       text[] := COALESCE(p_roles, ARRAY[]::text[]);
  v_had_super boolean;
  v_will_super boolean;
  v_super_cnt integer;
  r           text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_admin_role('super') THEN
    RAISE EXCEPTION 'NOT_SUPER' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 'zoom' 은 폐기라 신규 부여 금지 (기존 행은 아래 교체로 자연 정리된다)
  IF 'zoom' = ANY(v_new) THEN
    RAISE EXCEPTION 'DEPRECATED_ROLE:zoom' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_user_id AND role = 'super')
    INTO v_had_super;
  v_will_super := 'super' = ANY(v_new);

  -- ② 자기 자신의 super 회수 금지
  IF p_user_id = v_uid AND v_had_super AND NOT v_will_super THEN
    RAISE EXCEPTION 'CANNOT_REVOKE_OWN_SUPER' USING ERRCODE = 'P0001';
  END IF;

  -- ③ 마지막 super 보호
  IF v_had_super AND NOT v_will_super THEN
    SELECT count(*) INTO v_super_cnt FROM public.admin_roles WHERE role = 'super';
    IF v_super_cnt <= 1 THEN
      RAISE EXCEPTION 'LAST_SUPER' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 감사 로그 (교체 전후 차집합) ──────────────────────────────────────
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'revoke', v_uid
    FROM (SELECT role AS x FROM public.admin_roles WHERE user_id = p_user_id) old
   WHERE x <> ALL(v_new);

  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'grant', v_uid
    FROM unnest(v_new) AS x
   WHERE x NOT IN (SELECT role FROM public.admin_roles WHERE user_id = p_user_id);

  -- ── 교체 ──────────────────────────────────────────────────────────────
  DELETE FROM public.admin_roles WHERE user_id = p_user_id;

  FOREACH r IN ARRAY v_new LOOP
    INSERT INTO public.admin_roles (user_id, role, granted_by, granted_at)
    VALUES (p_user_id, r, v_uid, now())
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  -- ── profiles.role 재계산 (트리거 대신 여기서 1회) ────────────────────
  --   역할이 하나라도 있으면 ADMIN, 없으면 USER.
  --   어드민 진입 자체가 profiles.role 로 판정되므로, 역할 0개 = 진입 차단이 된다.
  UPDATE public.profiles
     SET role = CASE WHEN array_length(v_new, 1) > 0 THEN 'ADMIN' ELSE 'USER' END
   WHERE id = p_user_id;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_roles(uuid, text[]) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5) 목록 조회 — 사용자별 역할 배열
--    화면이 사용자 목록에 역할 배지를 붙이려면 N+1 없이 한 번에 받아야 한다.
-- ────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_user_roles();

CREATE FUNCTION public.admin_list_user_roles()
RETURNS TABLE (user_id uuid, roles text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.has_admin_role('super') OR public.has_admin_role('user')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT a.user_id, array_agg(a.role ORDER BY a.role)
    FROM public.admin_roles a
   GROUP BY a.user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_user_roles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_user_roles() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 6) 백필 — 기존 ADMIN 전원에게 일반 역할 전부 (고지 확정 ④안)
--
--    배포 순간에는 아무것도 달라지지 않는다(무중단). 그 뒤 사용자 관리 화면에서
--    담당별로 빼면서 탭이 점진적으로 숨겨진다.
--
--    ⚠ super 는 부여하지 않는다 — 권한 부여 권한까지 11명에게 넘기는 셈이 된다.
--    ⚠ 정리를 사람 기억에 맡기면 그대로 남는다(공지 배너가 두 달 방치된 그 패턴).
--       화면에 '전 역할 보유 N명' 을 띄워 눈에 보이게 한다.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_roles (user_id, role, granted_by, granted_at)
SELECT p.id, r.role, NULL, now()
  FROM public.profiles p
 CROSS JOIN (VALUES
   ('dashboard'),('booking'),('approval'),('room'),('user'),
   ('visitor'),('book'),('notification'),('notice'),('pointer')
 ) AS r(role)
 WHERE p.role = 'ADMIN'
   AND p.is_active IS DISTINCT FROM false
ON CONFLICT (user_id, role) DO NOTHING;

-- 백필 기록도 남긴다 (actor NULL = 시스템 마이그레이션)
INSERT INTO public.admin_role_grants (target_user, role, action, actor)
SELECT a.user_id, a.role, 'grant', NULL
  FROM public.admin_roles a
 WHERE a.granted_by IS NULL AND a.role <> 'super'
   AND NOT EXISTS (
     SELECT 1 FROM public.admin_role_grants g
      WHERE g.target_user = a.user_id AND g.role = a.role AND g.action = 'grant'
   );

-- 역방향 정합화 — 역할은 있는데 profiles.role 이 USER 인 계정 (있으면 안 되지만 방어)
UPDATE public.profiles p
   SET role = 'ADMIN'
 WHERE p.role <> 'ADMIN'
   AND EXISTS (SELECT 1 FROM public.admin_roles a WHERE a.user_id = p.id);

DO $$
DECLARE v_admins integer; v_super integer;
BEGIN
  SELECT count(*) INTO v_admins FROM public.profiles WHERE role = 'ADMIN';
  SELECT count(*) INTO v_super  FROM public.admin_roles WHERE role = 'super';
  IF v_super = 0 THEN
    RAISE EXCEPTION 'super 보유자가 0명입니다 — 이 상태로 커밋하면 아무도 권한을 부여할 수 없습니다';
  END IF;
  RAISE NOTICE '백필 완료 — ADMIN %명 / super %명', v_admins, v_super;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 배포 후 확인
-- ═══════════════════════════════════════════════════════════════════════════
--
-- -- [A] ★정합성 점검 — 평시 0행이어야 정상 (트리거 대신 이 쿼리가 감시자다)
-- SELECT p.id, p.name, p.role,
--        (SELECT count(*) FROM public.admin_roles a WHERE a.user_id = p.id) AS role_count
--   FROM public.profiles p
--  WHERE (p.role = 'ADMIN')
--        <> EXISTS (SELECT 1 FROM public.admin_roles a WHERE a.user_id = p.id);
--
-- -- [B] 현재 권한 분포
-- SELECT p.name, p.dept, array_agg(a.role ORDER BY a.role) AS roles
--   FROM public.admin_roles a JOIN public.profiles p ON p.id = a.user_id
--  GROUP BY p.id, p.name, p.dept ORDER BY p.name;
--
-- -- [C] 최근 권한 변경 이력
-- SELECT g.created_at, t.name AS 대상, g.role, g.action, a.name AS 처리자
--   FROM public.admin_role_grants g
--   LEFT JOIN public.profiles t ON t.id = g.target_user
--   LEFT JOIN public.profiles a ON a.id = g.actor
--  ORDER BY g.created_at DESC LIMIT 50;
--
-- -- [E] 레거시 역할 사용 현황 — 'meeting_room' / 'zoom' 이 0 이면 CHECK 에서 빼도 된다
-- SELECT role, count(*) FROM public.admin_roles GROUP BY role ORDER BY role;
--
-- -- [D] 퇴사자가 역할을 들고 있는지 (Phase 2 에서 자동화 예정)
-- SELECT p.name, array_agg(a.role) FROM public.admin_roles a
--   JOIN public.profiles p ON p.id = a.user_id
--  WHERE p.is_active = false GROUP BY p.id, p.name;
