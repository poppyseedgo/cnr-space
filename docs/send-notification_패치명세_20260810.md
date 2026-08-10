# send-notification index.ts 패치 명세 — 노쇼 제재 알림 (Phase 2-2)

> **전제**: 2026-08-05 재구성본 index.ts (SSOT = 공유모듈 3종, generic 이메일 렌더, 인앱 도서 분기 보유).
> 이 문서는 그 파일을 수령하는 즉시 적용할 수정 지점 명세다. **파일 없이 추측 재작성 금지** (7/16 사고 교훈).

## 패치 없이 배포해도 안전한 이유 (degraded 허용 범위)

POLICIES 2종은 `_shared/notification-types.ts`에 있으므로 **send-notification 재배포만으로** 제목·헤더·배너·CTA·수신자(booker_only)·채널 게이트가 전부 정상 동작한다. 배너 문구는 의도적으로 정적 설계(기간 없이 문장 성립 — book_penalty_applied 원칙). 패치 전 상태의 결손은 단 하나: **해제 시각(~8/16 오전 9:00)이 본문에 미표시** — 인앱 클릭 → 예약 모달 배너에서 확인 가능하므로 임시 운영 가능. 패치는 이 결손을 메우는 것.

## 수정 1 — 인앱 본문 분기 (도서 분기 옆)

인앱 body 조립부(도서: `book_title`/`due_date_kst` 분기가 있는 함수)에 제재 분기 추가:

```ts
// ← [2026-08-10 이용제재] 노쇼 제재 인앱 본문 — payload *_kst 는 서버 완성 문자열 (재변환 금지)
if (type === 'noshow_penalty_applied') {
  // 예: "예약 제한 ~2026-08-16 09:00 · 노쇼 3회"
  return `예약 제한 ~${booking.penalty_ends_kst ?? ''} · 노쇼 ${booking.noshow_count ?? 3}회`
}
if (type === 'noshow_penalty_cleared') {
  return '예약 제한이 해제되었습니다'
}
```
(반환/할당 방식은 해당 함수의 기존 도서 분기와 동일한 형태로 맞출 것)

## 수정 2 — 이메일 상세 라인 (generic 렌더의 예외 2종 옆)

generic 이메일 렌더에서 rejected(사유)·cancelled(강제 사유)와 같은 방식의 조건부 라인 추가 — 배너 아래 정보 행:

```ts
// ← [2026-08-10 이용제재] 제한 기간 라인 — 없으면 "언제까지인지" 문의가 관리자에게 간다 (도서 L818 교훈)
if (type === 'noshow_penalty_applied' && booking.penalty_ends_kst) {
  rows.push(['제한 기간', `${booking.penalty_starts_kst ?? ''} ~ ${booking.penalty_ends_kst} (해제 시 자동 안내)`])
}
```
cleared 는 추가 라인 불필요 — 배너 문구로 충분 (도서 cleared 와 동일: "이미 풀렸으므로 until 을 싣지 않는다").

## 수정 금지 사항

- 수신자 해석·채널 게이트·로그는 **무수정** — booker_only 기존 경로 그대로.
- payload `*_kst` 문자열을 Date 로 파싱/재포맷 금지.
- 나머지 29타입 경로 무변경 — 배포 전 기존 검증 스크립트(29+2 정책×렌더 계약검사) 재실행.

## 적용 절차

1. 고지가 로컬 `supabase/functions/send-notification/index.ts` 업로드
2. 위 2개 지점 패치 → deno check → 계약검사 → 파일 전달
3. `supabase functions deploy send-notification --no-verify-jwt`
