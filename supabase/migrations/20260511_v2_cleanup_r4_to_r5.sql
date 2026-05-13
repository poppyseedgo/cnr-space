-- ============================================================
-- C&R Space v2.0 Schema Cleanup (r4 → r5 정리)
-- Date: 2026-05-11
-- File: 20260511_v2_cleanup_r4_to_r5.sql
--
-- 현재 DB 상태 진단:
--   - r4 실행 후 r5 누적 실행됨
--   - r5의 신규 객체 (zoom_oauth_token)는 정상 생성됨
--   - r4의 구버전 객체가 일부 남아있음:
--       · zoom_accounts에 oauth_client_id, oauth_client_secret_enc,
--         zoom_account_id 3개 컬럼 잔존 (r5에서는 환경변수로 이동, DB에서 제거)
--       · zoom_account_tokens 테이블 잔존 (r5에서는 zoom_oauth_token으로 대체)
--
-- 이 마이그레이션은 위 잔존물을 정리하여 r5 최종 상태로 맞춥니다.
--
-- 안전성:
--   - zoom_accounts는 현재 0 rows (Phase D 진행 전이므로)
--   - zoom_account_tokens는 사용 코드 없음 (Edge Function 미구현 상태)
--   - 데이터 손실 위험 0
-- ============================================================

BEGIN;

-- ============================================================
-- 1) zoom_account_tokens 테이블 제거
-- ============================================================
-- 이유: r5에서 zoom_oauth_token (singleton, 1 row)으로 대체됨.
--       마스터 어카운트 1개 = 토큰 1개라 9-row 설계가 불필요.
DROP TABLE IF EXISTS zoom_account_tokens CASCADE;


-- ============================================================
-- 2) zoom_accounts에서 secret 컬럼 3개 제거
-- ============================================================
-- 이유: Option B 확정 (마스터 1개 + 9 sub-user) → OAuth 자격증명은
--       마스터 어카운트 1세트만 필요. Edge Function 환경변수로 이동:
--         ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
ALTER TABLE zoom_accounts DROP COLUMN IF EXISTS oauth_client_id;
ALTER TABLE zoom_accounts DROP COLUMN IF EXISTS oauth_client_secret_enc;
ALTER TABLE zoom_accounts DROP COLUMN IF EXISTS zoom_account_id;


-- ============================================================
-- 3) zoom_accounts COMMENT 갱신
-- ============================================================
COMMENT ON TABLE zoom_accounts IS '마스터 어카운트(51672994) 아래 9개 licensed sub-user. OAuth 자격증명은 Edge Function 환경변수에 1세트만 보관 (ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_ACCOUNT_ID)';

COMMIT;


-- ============================================================
-- 정리 후 검증 쿼리 (정리가 잘 됐는지 확인)
-- ============================================================
-- 아래 3개 쿼리를 실행해서 기대값과 일치하는지 확인하세요.

-- ① zoom_account_tokens 제거됐는지 (기대값: false)
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'zoom_account_tokens'
) AS still_exists;

-- ② zoom_accounts 컬럼 개수 (기대값: 8)
SELECT count(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zoom_accounts';

-- ③ zoom_accounts에 secret 컬럼이 남아있는지 (기대값: 0 rows)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'zoom_accounts'
  AND column_name IN ('oauth_client_id', 'oauth_client_secret_enc', 'zoom_account_id');
