#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# P2 v6: pending_expired 알림 누락 버그 해결 (Race Condition)
# ═══════════════════════════════════════════════════════════════════════════
#
# 변경 파일 (2개):
#   1. src/App.tsx
#      · useEffect에서 expirePendingBooking() 호출 제거 (프론트 DB 쓰기 중단)
#      · unused import 정리
#   2. supabase/functions/auto-cancel-bookings/index.ts
#      · pending_expired 쿼리 보강: auto_cancelled 필터 제거 + cancelled_by OR 조건
#      · UPDATE에 원자적 조건(status='pending') + .select('id') 재발송 방지
#
# 근본 원인:
#   Race Condition — 프론트 useEffect가 start_at-1분 시점에 expirePendingBooking()
#   호출하여 DB에 auto_cancelled=true 선점. cron의 기존 쿼리 필터에서 배제되어
#   send-notification('pending_expired') 호출 안 됨 → 이메일/인앱 알림 누락
#
# DB 쿼리 검증:
#   · status=pending + auto_cancelled=true 행 17건 누적 (쿼리 1 증거)
#   · notifications의 pending_expired 알림 04-18 이후 0건 (쿼리 2 증거)
#
# ⚠️ 배포 순서 엄수:
#   Step 1. 파일 2개 배치
#   Step 2. Frontend 빌드 + Git push + Cloudflare Pages 배포
#   Step 3. auto-cancel-bookings Edge Function 재배포
#   Step 4. Supabase SQL Editor에서 backfill_p2v6.sql 실행 (신버전 Edge Fn 배포 후!)
#   Step 5. 5분 후 검증 쿼리로 복구 확인
# ═══════════════════════════════════════════════════════════════════════════

set -e

if [ ! -d "supabase/functions" ] || [ ! -f "src/App.tsx" ]; then
  echo "❌ 오류: 프로젝트 루트(cnr-space/)에서 실행해 주세요."
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "  P2 v6: pending_expired 알림 누락 버그 해결"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# 1. 필수 파일 확인
# ═══════════════════════════════════════════════════════════════════════
echo "▶ 1/4  필수 파일 존재 확인"

REQUIRED_FILES=(
  "src/App.tsx"
  "supabase/functions/auto-cancel-bookings/index.ts"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "   ❌ 누락: $f"
    MISSING=1
  fi
done
if [ $MISSING -eq 1 ]; then
  echo "   파일을 먼저 배치하세요."
  exit 1
fi

# App.tsx에서 expirePendingBooking 실제 호출이 제거됐는지 검증
CALL_COUNT=$(grep -cE "^\s*expirePendingBooking\(" src/App.tsx || echo 0)
if [ "$CALL_COUNT" -gt 0 ]; then
  echo "   ❌ App.tsx에 expirePendingBooking() 실제 호출 $CALL_COUNT 개 남아있음"
  echo "      이걸 제거한 버전이어야 합니다."
  exit 1
fi
echo "   ✅ App.tsx expirePendingBooking() 호출 제거됨"

# auto-cancel에 cancelled_by 조건 추가됐는지 검증
if ! grep -q "cancelled_by.is.null,cancelled_by.eq.system" supabase/functions/auto-cancel-bookings/index.ts; then
  echo "   ❌ auto-cancel-bookings에 cancelled_by OR 조건 없음"
  exit 1
fi
echo "   ✅ auto-cancel-bookings cancelled_by 방어막 확인됨"

# 원자적 UPDATE 조건 검증
if ! grep -qE "\.eq\(\s*'status'\s*,\s*'pending'\s*\)\s*\.select" supabase/functions/auto-cancel-bookings/index.ts; then
  echo "   ⚠️  auto-cancel-bookings에 원자적 UPDATE 조건(.eq('status','pending').select) 못 찾음"
  echo "      이 부분은 선택 사항이지만 재발송 방지를 위해 권장됩니다."
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# 2. Supabase 프로젝트 링크 확인
# ═══════════════════════════════════════════════════════════════════════
echo "▶ 2/4  Supabase 프로젝트 링크 확인"
EXPECTED_REF="jjzcqpbwkkujttwxksvy"
PROJECT_REF_FILE="supabase/.temp/project-ref"

if [ -f "$PROJECT_REF_FILE" ]; then
  CURRENT_REF=$(cat "$PROJECT_REF_FILE" | tr -d ' \n')
  if [ "$CURRENT_REF" != "$EXPECTED_REF" ]; then
    echo "   ⚠️  현재 링크: $CURRENT_REF (기대: $EXPECTED_REF)"
    read -p "   재링크할까요? (y/N): " confirm
    if [ "$confirm" == "y" ] || [ "$confirm" == "Y" ]; then
      supabase link --project-ref $EXPECTED_REF
    else
      exit 1
    fi
  else
    echo "   ✅ 프로젝트 링크 OK: $EXPECTED_REF"
  fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# 3. Git status + 사용자 승인
# ═══════════════════════════════════════════════════════════════════════
echo "▶ 3/4  변경사항 확인"
git status --short | head -10
echo ""
read -p "   위 변경사항으로 진행할까요? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "   중단합니다."
  exit 0
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# 4. 빌드 + 배포 (순서 중요)
# ═══════════════════════════════════════════════════════════════════════
echo "▶ 4/4  빌드 + 배포"
echo ""

# 4-1. Frontend 빌드
echo "   4-1. Frontend 빌드"
npm run build
echo "        ✅ 빌드 완료"
echo ""

# 4-2. Git commit + push
echo "   4-2. Git commit + push"
git add -A
git commit -m "fix(notify): P2 v6 — pending_expired 알림 누락 버그 해결 (Race Condition)

원인:
- App.tsx의 useEffect가 start_at-1분 시점에 expirePendingBooking() 호출
  → DB에 auto_cancelled=true 선점 (status는 'pending' 유지)
- auto-cancel-bookings cron의 \`auto_cancelled=false\` 필터에 배제됨
- send-notification('pending_expired') 호출 안 됨 → 이메일/인앱 알림 누락

DB 검증:
- bookings 테이블: status=pending + auto_cancelled=true 17건 누적
- notifications 테이블: pending_expired 알림 04-18 이후 0건

해결:
1. App.tsx: useEffect에서 expirePendingBooking() 호출 제거 (낙관적 UI만 유지)
2. auto-cancel-bookings: 쿼리 필터 auto_cancelled 제거 + cancelled_by 방어막
3. UPDATE에 원자적 조건(.eq('status','pending')) + .select('id') 재발송 방지

노쇼는 정상 작동 중이므로 건드리지 않음 (start_at+10분 시점 감지로 cron이 먼저 선점됨)."
git push
echo "        ✅ push 완료"
echo ""

# 4-3. Cloudflare Pages
echo "   4-3. Cloudflare Pages 배포 (App.tsx 반영)"
npx wrangler pages deploy dist --project-name cnr-space
echo "        ✅ Cloudflare Pages 배포 완료"
echo ""

# 4-4. Supabase Edge Function
echo "   4-4. auto-cancel-bookings Edge Function 재배포"
supabase functions deploy auto-cancel-bookings --no-verify-jwt
echo "        ✅ Edge Function 재배포 완료"
echo ""

# 참고: send-notification/checkin-reminder/daily-reminder는 수정 없음 → 재배포 불필요
echo "   ℹ️  send-notification/checkin-reminder/daily-reminder는 수정 없음 → 재배포 불필요"
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "  🎉 코드 배포 완료 — 이제 Backfill 진행"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "다음 단계 (수동 실행):"
echo ""
echo "  [1] Supabase SQL Editor 열기"
echo "      https://supabase.com/dashboard/project/jjzcqpbwkkujttwxksvy/sql/new"
echo ""
echo "  [2] backfill_p2v6.sql 내용을 Step 1부터 순서대로 실행"
echo "      · Step 1: 사전 확인 (17건 정도 나와야 함)"
echo "      · Step 2: Option A (3일 이내 건 → auto_cancelled 되돌림, 알림 재발송)"
echo "      · Step 3: 3일 이상 건 → status=cancelled 조용히 확정"
echo ""
echo "  [3] 5분 대기 (cron 실행 주기)"
echo ""
echo "  [4] Step 4 검증 쿼리 실행"
echo "      · (a) remaining_stuck = 0 확인"
echo "      · (b) recent_notifs = 10건 이상 확인"
echo ""
echo "  [5] 새 pending 예약 1건 생성해 라이브 테스트"
echo "      · 에메랄드룸 예약 → 승인 기한 초과까지 대기 (또는 start_at 수동 조작)"
echo "      · 5분 내 이메일 수신 + 인앱 벨 알림 표시 확인"
echo ""
echo "문제 발생 시 롤백:"
echo "  git revert HEAD && git push"
echo "  npx wrangler pages deploy dist --project-name cnr-space"
echo "  supabase functions deploy auto-cancel-bookings --no-verify-jwt"
echo ""
