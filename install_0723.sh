#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# install_0723.sh — 다운로드한 전달 파일을 저장소의 제자리로 배치
#
#   사용법
#     bash install_0723.sh                    # 점검만 (DRY RUN — 아무것도 안 바꿈)
#     bash install_0723.sh --apply            # 실제 배치
#     bash install_0723.sh --apply ~/Downloads ~/dev/cnr-space
#                          └ --apply  └ 받은 폴더   └ 저장소 루트
#
#   기본값: 받은 폴더 = ~/Downloads · 저장소 루트 = 현재 디렉터리
#
# ═══════════════════════════════════════════════════════════════════════════
# ★ 찾는 방식 — 이름으로 먼저, 겹치면 내용으로
# ═══════════════════════════════════════════════════════════════════════════
#
#   전달 파일 중 index.ts 가 3개다.
#     src/types/index.ts
#     supabase/functions/send-notification/index.ts
#     supabase/functions/book-due-reminder/index.ts
#
#   브라우저는 같은 이름을 "index.ts / index (1).ts / index (2).ts" 로 저장하고,
#   그 번호는 받은 순서에 따라 매번 달라진다. 이름만 보고 짝을 맞추면
#   Edge Function 파일이 src/types/index.ts 를 덮어써 저장소가 통째로 깨진다.
#
#   그래서 ① 파일명(브라우저가 붙인 "(1)" 은 떼고)으로 후보를 좁히고,
#          ② 이름이 겹치는 경우에만 각 파일에만 있는 문구로 판별한다.
#
#   내용만으로 찾지 않는 이유: 전달 파일끼리 서로를 언급한다.
#   (deploy_0723.sh 는 각 파일의 함수명을 grep 으로 검사하고, 설계서는 SQL
#    함수명을 본문에 싣는다) 그래서 '그 문구를 가진 파일'이 여러 개가 된다.
#
#   ③ 마지막으로 고른 파일이 시그니처를 갖고 있는지 확인한다 — 예전 버전을
#      받아 둔 게 걸리면 여기서 걸러진다.
#
#   압축을 풀어 폴더 구조가 남아 있든, 한 폴더에 평평하게 흩어져 있든 동일하게 동작한다.
#
# ═══════════════════════════════════════════════════════════════════════════
# 안전장치
# ═══════════════════════════════════════════════════════════════════════════
#   · 기본이 DRY RUN — --apply 없이는 한 글자도 바꾸지 않는다
#   · 저장소 루트가 cnr-space 가 맞는지 먼저 확인 (아니면 즉시 중단)
#   · 덮어쓰기 전 원본을 .backup_<시각>/ 에 경로째 보관
#   · 하나라도 못 찾거나 중복이면 **아무것도 복사하지 않고** 중단
#     (절반만 배치되면 무엇이 반영됐는지 알 수 없어 더 위험하다)
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && { APPLY=1; shift; }

SRC_DIR="${1:-$HOME/Downloads}"
REPO="${2:-$PWD}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'

echo "받은 폴더 : $SRC_DIR"
echo "저장소    : $REPO"
echo "모드      : $([ $APPLY -eq 1 ] && echo '실제 배치 (--apply)' || echo '점검만 (DRY RUN)')"
echo

# ── 0) 입력 검증 ──────────────────────────────────────────────────────────
[ -d "$SRC_DIR" ] || { echo "${RED}받은 폴더가 없습니다: $SRC_DIR${OFF}"; exit 1; }
[ -d "$REPO" ]    || { echo "${RED}저장소 경로가 없습니다: $REPO${OFF}"; exit 1; }

# 저장소가 맞는지 확인 — 엉뚱한 폴더에 쏟아붓는 사고 방지
for probe in src/lib/api.ts src/pages/AdminPage.tsx supabase/functions/send-notification/index.ts; do
  [ -f "$REPO/$probe" ] || {
    echo "${RED}cnr-space 저장소가 아닌 것 같습니다 — $probe 가 없습니다.${OFF}"
    echo "저장소 루트를 두 번째 인자로 넘겨주세요:"
    echo "  bash install_0723.sh --apply \"$SRC_DIR\" ~/dev/cnr-space"
    exit 1
  }
done

# ── 1) 배치표 —  <저장소 경로>|<그 파일에만 있는 문구> ────────────────────
#   ※ 파일을 추가/교체할 때 이 표만 고치면 된다.
MAP=$(cat <<'TABLE'
src/pages/AdminPage.tsx|activeTab==='notifications'
src/pages/LibraryPage.tsx|hasCheckoutStarted(c.checkout_at
src/lib/api.ts|notifyBookAdminsCheckoutCreated
src/types/index.ts|export type BookCheckoutStatus
src/utils/bookLoan.ts|export function hasCheckoutStarted
src/data/notificationMeta.ts|NOTIFICATION_TYPE_COLORS
src/data/notificationCatalog.ts|NOTIFICATION_CATALOG
src/components/library/BookAdminPanel.tsx|LOAN_DATE_FIELD_META
src/components/common/NotificationSettingsPanel.tsx|export function NotificationSettingsPanel
src/components/layout/AdminSideNav.tsx|const MENU_ITEMS
src/components/icons/AdminMenuIcons.tsx|export function BellIcon
supabase/functions/_shared/notification-types.ts|export const POLICIES
supabase/functions/_shared/recipient-resolver.ts|fetchDesignatedRecipients
supabase/functions/_shared/notification-inapp.ts|export function buildInAppBody
supabase/functions/_shared/email-templates.ts|function renderInfoCard
supabase/functions/send-notification/index.ts|async function loadChannelFlags
supabase/functions/book-due-reminder/index.ts|kstStartedUpperBoundISO
supabase/migrations/20260727_book_start_boundary.sql|book_checkout_started
supabase/migrations/20260728_notification_settings.sql|admin_set_notification_recipients
supabase/migrations/_diagnose_book_notify_20260723.sql|_diagnose_book_notify_20260723
docs/NOTIFICATION_DESIGN_20260723.md|알림 시스템 전수조사
deploy_0723.sh|도서 모듈 3건 배포
TABLE
)

# ── 2) 후보 수집 (확장자 기준, 하위 폴더 포함) ────────────────────────────
#   ※ 이 스크립트 자신은 후보에서 제외한다. 아래 배치표에 모든 시그니처 문구가
#     그대로 적혀 있어서, 제외하지 않으면 전 항목이 '중복'으로 잡힌다.
CAND=$(mktemp)
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
find "$SRC_DIR" \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name '*.md' -o -name '*.sh' \) \
  -type f ! -name 'install_*.sh' -print 2>/dev/null \
  | grep -vF "$SELF" > "$CAND"
echo "${DIM}후보 파일 $(wc -l < "$CAND" | tr -d ' ')개 검색됨${OFF}"
echo

# ── 3) 이름 → (겹치면) 내용 순으로 매칭 ──────────────────────────────────
PLAN=$(mktemp); MISSING=0; AMBIG=0

# 브라우저가 붙인 중복 표시 제거: "index (1).ts" / "index(1).ts" / "index-1.ts" → "index.ts"
norm_base() {
  b=$(basename "$1"); ext="${b##*.}"; stem="${b%.*}"
  stem=$(printf '%s' "$stem" | sed -E 's/ ?\(([0-9]{1,2})\)$//; s/-[0-9]{1,2}$//')
  printf '%s.%s' "$stem" "$ext"
}

while IFS='|' read -r dest sig; do
  [ -z "$dest" ] && continue
  want=$(basename "$dest")

  # ① 파일명으로 후보 수집
  hits=""
  while IFS= read -r f; do
    [ "$(norm_base "$f")" = "$want" ] && hits="${hits}${f}"$'\n'
  done < "$CAND"
  hits=$(printf '%s' "$hits" | sed '/^$/d')
  n=$(printf '%s' "$hits" | grep -c . || true)

  # ② 이름이 겹치면(index.ts 3종) 시그니처로 좁힌다
  if [ "$n" -gt 1 ]; then
    narrowed=""
    while IFS= read -r f; do
      grep -qF -- "$sig" "$f" 2>/dev/null && narrowed="${narrowed}${f}"$'\n'
    done <<< "$hits"
    narrowed=$(printf '%s' "$narrowed" | sed '/^$/d')
    m=$(printf '%s' "$narrowed" | grep -c . || true)
    [ "$m" -ge 1 ] && { hits="$narrowed"; n="$m"; }
  fi

  if [ "$n" -eq 0 ]; then
    printf "  %s못찾음%s  %s\n" "$RED" "$OFF" "$dest"
    MISSING=$((MISSING+1)); continue
  fi

  first=$(printf '%s' "$hits" | head -1)

  if [ "$n" -gt 1 ]; then
    # 같은 파일을 두 번 받은 경우는 통과, 내용이 다르면 중단
    same=1
    while IFS= read -r f; do cmp -s "$first" "$f" || same=0; done <<< "$hits"
    if [ "$same" -eq 0 ]; then
      printf "  %s중복%s    %s\n" "$RED" "$OFF" "$dest"
      printf '%s\n' "$hits" | sed "s/^/            /"
      echo "            ${DIM}→ 내용이 서로 다릅니다. 예전에 받은 파일을 지우고 다시 받으세요.${OFF}"
      AMBIG=$((AMBIG+1)); continue
    fi
  fi

  # ③ 최종 확인 — 고른 파일이 이번 버전이 맞는가
  if ! grep -qF -- "$sig" "$first" 2>/dev/null; then
    printf "  %s구버전%s  %s\n" "$RED" "$OFF" "$dest"
    echo "            $first"
    echo "            ${DIM}→ '$sig' 가 없습니다. 이번에 전달한 파일이 맞는지 확인하세요.${OFF}"
    MISSING=$((MISSING+1)); continue
  fi

  if [ "$n" -gt 1 ]; then printf "  %sOK(중복 동일)%s %s\n" "$YEL" "$OFF" "$dest"
  else                    printf "  %sOK%s      %s\n" "$GRN" "$OFF" "$dest"; fi
  printf '%s|%s\n' "$first" "$dest" >> "$PLAN"
done <<< "$MAP"

echo
TOTAL=$(printf '%s' "$MAP" | grep -c . )
FOUND=$(grep -c . "$PLAN" 2>/dev/null || echo 0)
echo "확인 결과: ${FOUND}/${TOTAL} 매칭"

if [ "$MISSING" -gt 0 ] || [ "$AMBIG" -gt 0 ]; then
  echo "${RED}못 찾음 ${MISSING}건 / 중복 ${AMBIG}건 — 아무것도 배치하지 않고 중단합니다.${OFF}"
  echo "${DIM}전달 파일을 모두 받았는지, 압축을 $SRC_DIR 아래에 풀었는지 확인해 주세요.${OFF}"
  rm -f "$CAND" "$PLAN"; exit 1
fi

if [ $APPLY -eq 0 ]; then
  echo
  echo "${YEL}DRY RUN — 실제로 배치하려면 --apply 를 붙여 다시 실행하세요.${OFF}"
  echo "  bash install_0723.sh --apply \"$SRC_DIR\" \"$REPO\""
  rm -f "$CAND" "$PLAN"; exit 0
fi

# ── 4) 백업 후 배치 ───────────────────────────────────────────────────────
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP="$REPO/.backup_$STAMP"
echo
echo "백업 위치: $BACKUP"
echo

while IFS='|' read -r src dest; do
  target="$REPO/$dest"
  mkdir -p "$(dirname "$target")"
  if [ -f "$target" ]; then
    mkdir -p "$BACKUP/$(dirname "$dest")"
    cp -p "$target" "$BACKUP/$dest"
  fi
  cp "$src" "$target"
  printf "  %s배치%s  %s\n" "$GRN" "$OFF" "$dest"
done < "$PLAN"

chmod +x "$REPO/deploy_0723.sh" 2>/dev/null || true
rm -f "$CAND" "$PLAN"

# ── 5) 배치 후 점검 ───────────────────────────────────────────────────────
echo
echo "════════ 배치 후 점검 ════════"
cd "$REPO" || exit 1

# ★ AdminPage 가 참조하는 회의실별 가동률 카드 — 로컬에 없으면 빌드가 깨진다
if grep -q "RoomUtilizationByRoomCard" src/components/admin/RoomUtilizationCard.tsx 2>/dev/null; then
  echo "  ${GRN}OK${OFF}      RoomUtilizationByRoomCard export 존재"
else
  echo "  ${RED}주의${OFF}    src/components/admin/RoomUtilizationCard.tsx 에"
  echo "          RoomUtilizationByRoomCard export 가 없습니다."
  echo "          ${DIM}AdminPage 가 이 컴포넌트를 import 하므로 빌드가 TS2724 로 실패합니다.${OFF}"
fi

echo
echo "다음 순서로 진행하세요:"
echo "  1) npx tsc --noEmit && npm run build      ${DIM}# 컴파일 확인${OFF}"
echo "  2) git diff --stat                        ${DIM}# 바뀐 파일 확인${OFF}"
echo "  3) bash deploy_0723.sh                    ${DIM}# 진단 → DB → Edge → 프론트${OFF}"
echo
echo "${DIM}되돌리려면: cp -R \"$BACKUP\"/* \"$REPO\"/${OFF}"
