# RESOURCE_DESIGN_20260812.md — 자원예약(통합 자원등록 관리) 설계서

> 작성: 2026-08-12 · 갱신: 2026-08-19 (DB 실측 반영) · 기준 코드: 0812AM10 트리
> 관련 마이그레이션: 20260734_resource_phase1.sql — **2026-07-28 DB 실행 완료** (감사로그 07-28 06:58 실증)

---

## 0. 경위 요약

| 날짜 | 내용 |
|---|---|
| 2026-05-11 | v2 확장 스키마에 pointer_types/items/checkouts (대여모델) 생성 — 화면 미구현 |
| 2026-07-21 | A안(시간대 예약) 확정 — 대여모델 폐기 방향 |
| 2026-07-28 | ①스키마 일반화(포인터→자원) ②rename ③점유 규칙 ④반납 확인 확정. 진단 결과 pointer_* 전부 0행 → 이관 없이 DROP 확정. 20260734 마이그레이션 전달 |
| 2026-07-28 06:58 | **20260734 DB 실행 완료** (당시 실행 사실이 기록에서 누락 → 8/19 감사로그 타임스탬프로 확인). 프론트 adminRoles.ts만 미배포로 중단 |
| 2026-08-12 | 재개, 본 설계서 작성. 미배포로 오인해 20260746 재발급 |
| 2026-08-19 | MCP 실측으로 기적용 확인 → **20260746 폐기, 20260734 유지**(실행된 사실 기록). 잔여 작업 = 프론트 배포뿐 |

## 1. 확정 정책 (2026-07-28, 고지 확정)

1. **일반화** — 포인터 전용이 아닌 "자원 종류(카테고리) × 개체 × 예약" 3계층. 통합 자원등록 관리 어드민에서 카테고리를 코드 수정 없이 추가
2. **권한 rename** — admin_roles `'pointer'` → `'resource'`. 미구현 시점이 유일한 무비용 rename 기회 (is_profile_admin "이름≠의미" 전철 방지)
3. **점유 규칙** — 사용시간(같은 KST 날짜의 start~end) + 반납일(date). 반납일 > 사용일이면 **반납일 19:00(KST)까지 해당 개체 독점**. 당일 반납이면 사용시간만 점유
4. **반납 확인 필수** — 물리적 물건 수령이 필요하므로 자동 해제 불가(회의실과 다름). 관리자의 명시적 "반납 확인" 액션으로만 종결

**통합 범위**: "시간대 예약형 물리 자원"만. 도서(승인·연체·페널티 별도 도메인)와 회의실은 통합하지 않음.

## 2. 데이터 모델

### 2-1. resource_categories — 자원 종류 + 종류별 예약 정책

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | int identity PK | |
| name | text UNIQUE | 예: "레이저 포인터", "노트북" |
| description / icon | text | icon = 프론트 아이콘 키(선택) |
| slot_step_minutes | int, CHECK IN (15,30,60), 기본 60 | 시간 선택 단위 |
| allow_multi_day | boolean, 기본 true | false = 모달에서 반납일 숨김(당일 반납 강제) |
| open_time / close_time | time, 기본 07:00/19:00 | KST. 회의실 tOpts 관례 |
| is_active | boolean | 삭제 대신 비활성 (예약 이력 보존) |
| sort_order / created_at | | |

> **정책이 카테고리 컬럼인 이유**: "1시간 단위"는 포인터의 속성이지 자원예약의 속성이 아니다. 하드코딩하면 카테고리 추가 때마다 코드 수정 → 통합 어드민의 의미 상실.

### 2-2. resource_items — 개별 개체

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | int identity PK | |
| category_id | int FK → categories | |
| label | text, UNIQUE(category_id, label) | 표시명 "P-01" |
| asset_code | text UNIQUE nullable | 회사 자산번호 |
| status | CHECK: available / maintenance / retired | **'borrowed' 없음** — 점유는 예약에서 파생(상태 저장 금지 원칙, 회의실 getRoomStatus 동일). retired = 삭제 대체 |
| memo / sort_order / created_at | | |

### 2-3. resource_bookings — 예약 (회의실 bookings 구조 준용)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK | 클라 생성 `r{epoch_ms}_{n}` (bookings `b...` 관례) |
| item_id | int FK → items | 예약 1건 = 개체 1개 (확정) |
| user_id / user_email | uuid / text NOT NULL | UUID OR email 이중 식별 규칙. user_id FK 없음(bookings 패턴) |
| user_name / user_dept | text | 스냅샷 — **퇴사자 폴백 전용**, live는 users JOIN |
| start_at / end_at | timestamptz | 사용시간. 같은 KST 날짜 강제(트리거) |
| return_due | date | 반납일(KST) |
| occupied_until | timestamptz | **트리거 계산 — 클라 값 무시** |
| status | confirmed / cancelled | |
| returned_at / returned_by | timestamptz / uuid | 관리자 반납 확인 |
| cancelled_at / cancelled_by | | cancelled_by: 'user'/'admin'/'departed' |
| memo | text ≤100자 | |

## 3. 무결성 계층 (DB가 보장하는 것)

| 계층 | 내용 |
|---|---|
| EXCLUDE gist | `(item_id WITH =, tstzrange(start_at, occupied_until) WITH &&) WHERE (status='confirmed')` — 겹침 원천 차단, 취소 건 제외(partial). btree_gist 설치 확인됨 |
| 트리거 ① occupancy | BEFORE INSERT/UPDATE OF start_at,end_at,return_due,**occupied_until**. 검증: 같은 KST 날짜(`USAGE_MUST_BE_SAME_DAY`), return_due ≥ 사용일(`RETURN_BEFORE_START`). 계산: 당일 반납→end_at, 아니면 `(return_due+19h) AT TIME ZONE 'Asia/Seoul'`. occupied_until을 UPDATE OF에 넣어 클라가 직접 바꿔도 재계산으로 덮어씀 |
| 트리거 ③ employment guard | `assert_employment_can_create(user_id, start_at)` — 퇴사(예정)자 예약 차단. **퇴사자 정책 작업에서 별도 추가됨**(2026-08 실측 확인, 회의실·도서와 동일 게이트) |
| 트리거 ② return guard | returned_at/by 변경은 `has_admin_role('resource')`만 (`RETURN_CONFIRM_ADMIN_ONLY`). RLS는 컬럼 구분 불가 → 본인이 연체를 셀프 소거하는 조작을 DB가 차단 |

**프론트 에러 매핑**: 23P01(exclusion_violation) → "이미 예약된 시간입니다" / P0001 세 코드 → 각 안내문구. RPC 에러코드 매핑 관례(EXPIRED/LIMIT 등)와 동일 방식.

## 4. 권한 · RLS

- rename: CHECK 선해제 → `UPDATE role='pointer'→'resource'` → 새 CHECK(pointer 제거, 레거시 zoom/meeting_room 유지, kb 포함). 감사로그에 revoke/grant 쌍 기록(actor NULL=시스템)
- RLS (처음부터 `has_admin_role('resource')` 단독 — is_profile_admin은 [LEGACY]):
  - categories/items: SELECT authenticated / 쓰기 admin
  - bookings: SELECT authenticated(가용성 표시) / INSERT 본인 or admin(**booker override 대리예약** — 회의실 insertBooking 패턴, SECURITY DEFINER 불필요) / UPDATE 본인 or admin / DELETE admin
- 프론트: adminRoles.ts에 `'resource'`(라벨 "자원예약") 추가, 구 `'pointer'`는 deprecated 보존(zoom 전례 — admin_role_grants 이력 라벨 렌더링용)

## 5. 연체 (파생 상태)

- 정의: `status='confirmed' AND returned_at IS NULL AND now() > occupied_until` — **DB status 저장 안 함**, 도서 연체와 동일하게 계산 기준(SSOT 유틸 `isResourceOverdue()`)
- 부분 인덱스 `idx_resource_bookings_overdue`로 조회·알림 배치 대비
- 연체 중 개체에 다음 예약이 이미 있는 경우: **자동 취소하지 않음**. 관리자 연체 알림으로 회수 유도(기본). 다음 예약자 화면에는 "전 사용자 미반납" 뱃지 표시 검토 — Phase 3에서 재논의

## 6. 어드민 — '자원예약' 탭 (역할 resource 1:1)

AdminTabId `'resources'` 신설. 서브 구성 4개(도서관리 탭의 서브탭 패턴):

1. **카테고리 관리** — 등록/수정/비활성(is_active), 정책 필드(단위·복수일·운영시간) 편집. 삭제 없음
2. **개체 관리** — 카테고리 선택 → 개체 CRUD, 상태 변경. 예약 이력 있는 개체는 삭제 차단 → retired 유도(도서관 lost 패턴)
3. **예약 현황** — 전 카테고리 통합 리스트, 카테고리/기간/상태(예약중·사용중·연체·반납완료·취소) 필터, **반납 확인 버튼**(핵심 액션), 관리자 취소(사유→memo), CSV
4. **대리예약** — 회의실 대리예약과 동일한 사용자 검색 UI 재사용

확인 UX: 반납 확인·관리자 취소·retired 전환은 ConfirmDialog 기준 적용(파괴적/되돌리기 어려움 단계).

## 7. 사용자 화면

- 진입: ResourceDropdown "포인터 대여"(placeholder) → **"자원예약"** 활성화, App view 라우팅 추가
- 흐름: 카테고리 칩/탭 → 개체 카드 그리드(오늘 기준 가용 뱃지) → 예약 모달(Figma 410:7197 구조. 사용일 1일 + 시작~종료(slot_step 단위) + 반납일(allow_multi_day 시) + 메모 100자)
- 시간 옵션: 기존 BookingModal tOpts(15분 하드코딩)를 step 파라미터로 일반화해 재사용
- 마이페이지 "나의 예약 조회"에 세그먼트 추가: [회의실|도서|**자원**] — 취소(사용 시작 전만), 연체 뱃지 표시
- 예약 화면 자체는 회의실 예약과 별개 흐름(달력 비활성 표기는 도서 예약기간 공개(20260737) 패턴 참고)

## 8. 알림 (Phase 4)

notification_settings 체계(현 29종)에 추가 — 채널·수신자 결정 로직 준수:
- 예약 완료(본인) / 대리예약 통지(대상자) / 반납일 아침 리마인드(본인, 도서 due-reminder cron 패턴) / **연체 발생(관리자+본인)** / 반납 확인 완료(본인)
- 구체 종류·기본 on/off는 Phase 4에서 알림 전수조사 문서에 이어서 확정

## 9. Phase 계획 · 현재 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | DB: rename + pointer_* 폐기 + resource_* 3테이블 + 트리거 + RLS · adminRoles.ts | **DB 완료(7/28)** · adminRoles.ts 배포만 잔여 |
| 2 | api.ts(loadResourceCategories/Items/Bookings, insert/cancel) + 타입 + 사용자 화면 + 라우팅 | 미착수 |
| 3 | 어드민 탭 4종 (카테고리→개체→현황(반납확인)→대리예약 순) | 미착수 |
| 4 | 알림 + 마이페이지 자원 탭 + 연체 운영 정책 확정 | 미착수 |

**Phase 1 적용 실측 (2026-08-19, MCP)**: pointer_* 3테이블 부재 / resource_* 3테이블 컬럼 설계 일치 / CHECK 14종(resource 포함·pointer 제거) / resource 보유 11명 / EXCLUDE·트리거 함수 본문·RLS 8개 설계와 동일 / 구 RPC 부재 / 감사로그 22건(07-28 06:58). 추가로 employment_guard 트리거 1개가 퇴사자 정책 작업에서 얹혀 있음(§3).

## 10. 미결 (구현 전 확정 불필요, 해당 Phase에서 결정)

- 1인 동시 보유(예약) 한도 — 무제한이면 독점 우려 (Phase 2 모달 정책)
- 선행 예약 가능 기간(며칠 앞까지) — 회의실은 제한 있음 (Phase 2)
- 연체 중 다음 예약 충돌 시 다음 예약자 안내 방식 (Phase 3, §5)
- 자원에도 노쇼 개념 적용 여부 — 미수령 예약 처리 (Phase 4)
- 초기 카테고리·개체 시드 — DB 시드 없이 어드민 화면에서 등록 (Phase 3 완료 후 운영)
