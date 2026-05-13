-- ============================================================
-- C&R Space v2.0 Schema Extension (DRAFT - 검토 완료, 실행 가능)
-- Modules: admin_roles + Zoom + Pointer + Book
-- Date: 2026-05-11
-- Project ref: jjzcqpbwkkujttwxksvy
--
-- 변경 이력:
--   [2026-05-11 r5] Zoom 통합 구조 Option B 확정 (마스터 1개 + 9 sub-user)
--     - 사실 확인: 9개 cnrres#@gmail.com은 마스터 어카운트(knkim@cnrres.com,
--       Account No. 51672994) 아래의 licensed sub-users
--     - 따라서 OAuth 자격증명은 1세트 (마스터 어카운트 레벨)
--     - 변경:
--       · zoom_accounts에서 oauth_client_id, oauth_client_secret_enc,
--         zoom_account_id 컬럼 제거 → Edge Function 환경변수로 이동
--           ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_ACCOUNT_ID
--       · zoom_account_tokens (9 rows 가정) → zoom_oauth_token (singleton, 1 row)
--     - 운영 효과: 9개 secret 관리 → 1개로 단순화. Phase D 소요 1.5h → 30분
--     - pgcrypto 의존성 제거 (DB에 secret 저장 안 함, 환경변수만 사용)
--
--   [2026-05-11 r4] 실행 안전성 보완
--     - set_updated_at() 함수 CREATE OR REPLACE 추가 (idempotent)
--     - 모든 신규 테이블에 ENABLE ROW LEVEL SECURITY 추가
--       (정책 없는 RLS = service_role만 접근 가능, client API 차단)
--     - zoom_accounts seed INSERT 제거
--       → Phase D에서 Marketplace 등록 후 암호화 INSERT
--
--   [2026-05-11 r3] auth.users FK 정책 확정 (기존 bookings 패턴 추적 결과 반영)
--     - sync-all-users/index.ts 코드 추적 결과:
--       ① departed_users INSERT → ② profiles DELETE → ③ auth.users DELETE
--       → ④ cancelFutureBookings (user_id로 bookings 필터링 정상 동작)
--     - 결론: 기존 bookings.user_id는 FK 제약이 없음 (단순 uuid 컬럼)
--     - 반영:
--       · zoom_bookings.user_id        → FK 제거 (단순 uuid)
--       · pointer_checkouts.user_id    → FK 제거
--       · book_checkouts.user_id       → FK 제거
--       · admin_roles.user_id          → ON DELETE CASCADE 유지 (퇴사자는 관리자 박탈)
--       · admin_roles.granted_by       → FK 제거 (granter 퇴사해도 권한 유지)
--     - 사용자 정보 조회: users JOIN (live) → departed_users JOIN (fallback)
--       FK가 없으므로 데이터 무결성은 application 레벨에서 검증
--
--   [2026-05-11 r2] 사용자 정보 snapshot 컬럼 전체 제거
--     - 제거: user_email, user_name, user_department
--       (zoom_bookings, pointer_checkouts, book_checkouts 3개 테이블)
--     - 사유: 사용자 정보는 live 반영 원칙 (기존 회의실 모듈과 동일).
--             DB 컬럼 변경 시 모든 화면에 즉시 반영되어야 함
--     - 조회 패턴: bookings.user_id → users JOIN (live)
--                  → 퇴사자는 departed_users.user_id JOIN (fallback)
--     - 알림 발송 시 메일 주소도 발송 시점에 users 또는 departed_users
--       에서 live 조회 (snapshot 저장 X)
--
-- 적용 전 확인 사항:
--   1) 도서 분류체계 (book_categories) 실제 구조 확인
--   2) 포인터 종류 (pointer_types) 실제 분류 확인
--   3) 기존 회의실 모듈과 admin 권한 충돌 없는지 (현재 is_admin 플래그와 병존 필요)
--   4) RLS 정책 별도 마이그레이션 파일에서 적용
--   5) departed_users 스키마: { id uuid, name, email, dept, employee_id, departed_at }
--      → id가 auth.users.id와 동일하므로 user_id JOIN 가능 ✓ 확인됨
-- ============================================================


-- ============================================================
-- 1) 공통: admin_roles (시스템별 관리자 권한)
-- ============================================================
CREATE TABLE admin_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- ← [r3] 퇴사자는 자동 권한 박탈
  role        text NOT NULL CHECK (role IN ('meeting_room','zoom','pointer','book','super')),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid,  -- ← [r3] FK 제거: granter 퇴사해도 권한 부여 이력 유지
  UNIQUE (user_id, role)  -- 동일 사용자에게 같은 역할 중복 방지
);
CREATE INDEX idx_admin_roles_user ON admin_roles(user_id);
CREATE INDEX idx_admin_roles_role ON admin_roles(role);

COMMENT ON TABLE admin_roles IS '시스템별 관리자 권한. super는 모든 권한 보유';
COMMENT ON COLUMN admin_roles.role IS 'meeting_room | zoom | pointer | book | super';


-- ============================================================
-- 2) Zoom 모듈
-- ============================================================

-- 2-1. zoom_accounts: 9개 sub-user 메타 정보 (마스터 어카운트는 환경변수)
CREATE TABLE zoom_accounts (
  id            int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text NOT NULL UNIQUE,                -- cnrres1@gmail.com 등 (sub-user 이메일)
  display_name  text NOT NULL,                       -- "회사 Zoom 1번"
  host_key      text NOT NULL,                       -- 6자리 PIN (각 sub-user 프로필에서 수집)
  active        boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,              -- UI 표시 순서
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zoom_accounts IS '마스터 어카운트(51672994) 아래 9개 licensed sub-user. OAuth 자격증명은 Edge Function 환경변수에 1세트만 보관 (ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_ACCOUNT_ID)';
COMMENT ON COLUMN zoom_accounts.host_key IS '미팅 중 호스트 권한 클레임용 6자리 PIN. 각 sub-user 프로필에서 사전 설정 후 저장';


-- 2-2. zoom_oauth_token: 마스터 어카운트 OAuth 토큰 캐시 (singleton, 1 row)
CREATE TABLE zoom_oauth_token (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 싱글톤 강제 (1 row만 가능)
  access_token  text NOT NULL,
  expires_at    timestamptz NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zoom_oauth_token IS '마스터 어카운트 Server-to-Server OAuth 토큰 캐시 (1시간 유효). 1 row만 존재. Edge Function이 만료 5분 전부터 갱신';


-- 2-3. zoom_bookings: Zoom 예약
CREATE TABLE zoom_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zoom_account_id   int NOT NULL REFERENCES zoom_accounts(id),
  user_id           uuid NOT NULL,                                -- ← [r3] FK 제거 (기존 bookings 패턴). [r2] users JOIN으로 live 조회
  title             text NOT NULL,
  start_time        timestamptz NOT NULL,
  end_time          timestamptz NOT NULL,
  zoom_meeting_id   text,                                        -- Zoom API 응답값
  join_url          text,
  passcode          text,
  status            text NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed','cancelled','completed')),
  cancelled_by      text CHECK (cancelled_by IN ('user','admin','system','departed')),
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- 충돌 방지용 인덱스 (동일 계정, 동일 시간대 예약 검색)
CREATE INDEX idx_zoom_bookings_account_time
  ON zoom_bookings(zoom_account_id, start_time, end_time)
  WHERE status = 'confirmed';
CREATE INDEX idx_zoom_bookings_user      ON zoom_bookings(user_id);
CREATE INDEX idx_zoom_bookings_start     ON zoom_bookings(start_time);
CREATE INDEX idx_zoom_bookings_status    ON zoom_bookings(status);


-- ============================================================
-- 3) 포인터 모듈
-- ============================================================

-- 3-1. pointer_types: 포인터 종류 마스터
CREATE TABLE pointer_types (
  id          int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text NOT NULL UNIQUE,                              -- 예: "레이저 포인터", "프레젠터겸용"
  description text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3-2. pointer_items: 포인터 개체 (10개)
CREATE TABLE pointer_items (
  id             int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  type_id        int NOT NULL REFERENCES pointer_types(id),
  serial_number  text UNIQUE,                                    -- 제조사 시리얼 (선택)
  asset_tag      text NOT NULL UNIQUE,                           -- 회사 자산번호 (예: "P-001")
  status         text NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available','borrowed','maintenance','lost')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pointer_items_status ON pointer_items(status);
CREATE INDEX idx_pointer_items_type   ON pointer_items(type_id);

-- 3-3. pointer_checkouts: 포인터 대여 기록
CREATE TABLE pointer_checkouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      int NOT NULL REFERENCES pointer_items(id),
  user_id      uuid NOT NULL,                                    -- ← [r3] FK 제거 (기존 bookings 패턴). [r2] users JOIN으로 live 조회
  checkout_at  timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,                             -- 사용자 지정 (표준 +1일)
  returned_at  timestamptz,
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','returned','overdue','lost')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (due_at > checkout_at)
);
CREATE INDEX idx_pointer_checkouts_user   ON pointer_checkouts(user_id);
CREATE INDEX idx_pointer_checkouts_item   ON pointer_checkouts(item_id);
CREATE INDEX idx_pointer_checkouts_status ON pointer_checkouts(status);
CREATE INDEX idx_pointer_checkouts_due
  ON pointer_checkouts(due_at) WHERE status = 'active';

-- 동일 item이 동시에 2개 active 대여를 못 갖도록 partial unique index
CREATE UNIQUE INDEX idx_pointer_checkouts_active_item_unique
  ON pointer_checkouts(item_id) WHERE status = 'active';


-- ============================================================
-- 4) 도서 모듈
-- ============================================================

-- 4-1. book_categories: 도서 분류 (자기참조 트리)
CREATE TABLE book_categories (
  id          int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text NOT NULL,
  parent_id   int REFERENCES book_categories(id) ON DELETE SET NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, name)  -- 같은 부모 아래 동일 이름 중복 방지
);
CREATE INDEX idx_book_categories_parent ON book_categories(parent_id);

-- 4-2. books: 도서 카탈로그 (400권, 복본 없음 → 1책 1행)
CREATE TABLE books (
  id           int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  category_id  int REFERENCES book_categories(id),
  title        text NOT NULL,
  author       text,
  publisher    text,
  isbn         text,
  cover_url    text,
  status       text NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','borrowed','maintenance','lost')),
  notes        text,
  acquired_at  date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_books_status   ON books(status);
CREATE INDEX idx_books_category ON books(category_id);
CREATE INDEX idx_books_title    ON books(title);
CREATE INDEX idx_books_author   ON books(author);

-- 4-3. book_checkouts: 도서 대여 기록
CREATE TABLE book_checkouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id           int NOT NULL REFERENCES books(id),
  user_id           uuid NOT NULL,                               -- ← [r3] FK 제거 (기존 bookings 패턴). [r2] users JOIN으로 live 조회
  checkout_at       timestamptz NOT NULL DEFAULT now(),
  due_at            timestamptz NOT NULL,                         -- 대여 + 7일 (기본)
  returned_at       timestamptz,
  extension_count   int NOT NULL DEFAULT 0 CHECK (extension_count <= 1),  -- 연장 1회 제한
  last_extended_at  timestamptz,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','returned','overdue','lost')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (due_at > checkout_at)
);
CREATE INDEX idx_book_checkouts_user   ON book_checkouts(user_id);
CREATE INDEX idx_book_checkouts_book   ON book_checkouts(book_id);
CREATE INDEX idx_book_checkouts_status ON book_checkouts(status);
CREATE INDEX idx_book_checkouts_due
  ON book_checkouts(due_at) WHERE status = 'active';

-- 동일 book이 동시에 2개 active 대여를 못 갖도록 partial unique index
CREATE UNIQUE INDEX idx_book_checkouts_active_book_unique
  ON book_checkouts(book_id) WHERE status = 'active';


-- ============================================================
-- 5) updated_at 자동 갱신 트리거
-- ============================================================
-- [r4] CREATE OR REPLACE로 idempotent하게 정의 (기존 함수 있어도 안전)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_zoom_accounts_updated_at
  BEFORE UPDATE ON zoom_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_zoom_bookings_updated_at
  BEFORE UPDATE ON zoom_bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pointer_items_updated_at
  BEFORE UPDATE ON pointer_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pointer_checkouts_updated_at
  BEFORE UPDATE ON pointer_checkouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_book_checkouts_updated_at
  BEFORE UPDATE ON book_checkouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 6) Row Level Security 활성화 (정책은 Phase A에서 추가)
-- ============================================================
-- [r4] 정책 없는 RLS 활성화 = service_role(Edge Function)만 접근 가능.
--      client API(anon/authenticated)는 차단된 상태로 시작.
--      Phase A에서 사용자 권한별 정책 추가 시까지 안전 잠금.

ALTER TABLE admin_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_oauth_token       ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pointer_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pointer_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pointer_checkouts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE books                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_checkouts         ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 7) Seed 데이터 (이 마이그레이션에서는 INSERT 안 함)
-- ============================================================
-- [r5] zoom_accounts 9개 seed는 Phase D에서 host_key 수집 후 INSERT.
--      OAuth 자격증명은 DB에 저장하지 않음 (Edge Function 환경변수).
--
-- Phase D INSERT 템플릿 (각 sub-user 로그인 후 host_key 확인 후 사용):
--   INSERT INTO zoom_accounts (email, display_name, host_key, sort_order)
--   VALUES ('cnrres1@gmail.com', '회사 Zoom 1번', '<6자리 PIN>', 1);
--
-- 환경변수 등록 (Supabase Dashboard > Edge Functions > Secrets):
--   ZOOM_ACCOUNT_ID  = 51672994
--   ZOOM_CLIENT_ID   = <knkim 회신 값>
--   ZOOM_CLIENT_SECRET = <knkim 회신 값>


-- ============================================================
-- RLS 정책 (Phase A에서 별도 마이그레이션 파일로 처리)
-- ============================================================
-- 예고:
--   - 일반 사용자: 본인 예약/대여만 SELECT/UPDATE
--   - 시스템별 관리자: admin_roles 체크 후 해당 모듈 전체 권한
--   - super 관리자: 전체 권한
--   - zoom_accounts: 모든 인증 사용자가 SELECT 가능 (예약 시 표시용),
--     INSERT/UPDATE/DELETE는 zoom 관리자 또는 super만
--   - zoom_oauth_token: 어떤 client role도 SELECT 불가 (Edge Function service_role 전용)
