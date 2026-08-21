-- ═══════════════════════════════════════════════════════════════════════════
-- 20260750_seed_pointer_icon.sql — 레이저 포인터 카테고리 아이콘 시드
--
-- [2026-08-21] 고지 확정: 자원명 전역에 'SVG 아이콘 + 자원명' 공통 표기.
--   포인터는 "기존에 업로드된 svg" 적용 — ResourceDropdown/AppDrawer 의 IcoPointer
--   (2026-05-13 v9 사용자 제공, 그라데이션 포함) 원문을 resource_categories.icon 에 시드.
--
-- 📌 원문 대비 변환 2가지 (렌더 필수 — 임시방편 아님):
--   ① JSX 속성 → 표준 SVG 속성 (stopColor→stop-color, stopOpacity→stop-opacity)
--      : camelCase 는 SVG 파서가 무효 속성으로 무시해 그라데이션이 소실된다.
--   ② width/height="24" 명시 — img-SVG 는 고유 크기가 없으면 일부 브라우저에서 0 렌더.
--
-- 실행: Supabase SQL Editor. 멱등 — 재실행 시 같은 값으로 덮어쓸 뿐.
-- 스피커 카테고리는 지시 없음 — 어드민 '자원 관리 > 카테고리 관리' 아이콘 필드에서 등록.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE resource_categories
     SET icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.9873 6.71281C20.8089 4.67186 19.1141 2.97704 17.0732 1.79869C15.0322 0.620348 12.717 2.9302e-07 10.3604 0L10.3604 13.4256L21.9873 6.71281Z" fill="url(#paint0_lin_resource_pointer)"/><path d="M11.0554 6.85101L15.7061 9.53614L13.3567 13.6056L7.65077 23.4885L3 20.8033L8.70589 10.9204L11.0554 6.85101Z" fill="white"/><path d="M15.7061 9.53614L7.65077 23.4885L3 20.8033L11.0554 6.85101L15.7061 9.53614ZM9.82179 10.9876L12.7404 12.6727L14.34 9.9021L11.4214 8.21704L9.82179 10.9876ZM4.36623 20.437L7.28483 22.122L12.2404 13.5387L9.32179 11.8537L4.36623 20.437Z" fill="black"/><defs><linearGradient id="paint0_lin_resource_pointer" x1="16.6857" y1="2.46997" x2="3.64759" y2="25.0526" gradientUnits="userSpaceOnUse"><stop stop-color="#737373" stop-opacity="0"/><stop offset="0.560639" stop-color="#D9D9D9"/></linearGradient></defs></svg>'
   WHERE name = '레이저 포인터';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE NOTICE '⚠ 대상 카테고리("레이저 포인터")를 찾지 못했습니다 — 실제 카테고리명 확인 후 WHERE 절 수정 필요';
  ELSE
    RAISE NOTICE '✅ 레이저 포인터 아이콘 시드 완료 (% 행)', v_count;
  END IF;
END $$;

-- 검증
SELECT id, name,
       (icon IS NOT NULL)                              AS has_icon,
       length(icon)                                    AS icon_bytes,
       left(icon, 4) = '<svg'                          AS is_svg
  FROM resource_categories
 ORDER BY sort_order, id;
