# markNoshow → RPC 전환 패치 명세 (api.ts / App.tsx)

실물 파일이 없어 명세로 전달. 파일 업로드 시 적용본+tsc/build 검증본으로 재전달.

## 1. src/lib/api.ts — markNoshow 교체

```ts
// BEFORE (가드 5종 PATCH — 시간 조건 없음, 클라이언트 시계 의존)
export async function markNoshow(id: string): Promise<void> {
  await supabase.from('bookings')
    .update({ auto_cancelled: true, cancelled_by: 'system' })
    .eq('id', id).eq('status', 'confirmed').eq('checked_in', false)
    .eq('early_ended', false).eq('auto_cancelled', false).is('cancelled_by', null)
}

// AFTER — 서버 시계 단일 판정. 반환 = 실제 갱신 행 수(0|1)
export async function markNoshow(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('mark_noshow', { p_booking_id: id })
  if (error) throw error
  return Number(data ?? 0)
}
```

## 2. src/App.tsx — 노쇼 tick 블록 (L1083~1133 부근, `Promise.all(...markNoshow)`)

- `markNoshow(b.id)` 반환값이 `1`일 때만 `logAudit('BOOKING_NOSHOW', ...)` 호출 (0 = 서버가 거부 → 로그 남기지 않음. 8/27 사고의 '가짜 audit 9건' 재발 방지)
- 낙관적 마킹(setBookings로 즉시 노쇼 표시)도 반환 1일 때만 적용. 0이면 상태 미변경 → 다음 tick/Realtime 이 진실을 반영

```ts
const results = await Promise.allSettled(toNoshow.map(async (b) => {
  const n = await markNoshow(b.id)
  if (n === 1) {
    await logAudit({ action: 'BOOKING_NOSHOW', entityType: 'booking', entityId: b.id,
      after: { status: 'confirmed', cancelledBy: 'system', autoCancelled: true } })
    return b.id
  }
  return null
}))
const marked = new Set(results.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
if (marked.size) setBookings(prev => prev.map(b => marked.has(b.id) ? { ...b, autoCancelled: true, cancelledBy: 'system' } : b))
```

- `Promise.all` → `Promise.allSettled`: 한 건 예외(NOT_AUTHENTICATED 등)가 나머지 마킹을 중단시키지 않게

## 3. 후보 산출(toNoshow 필터)의 시계 보정 — 선택(보조)
서버 가드가 최종 판정이므로 안전성엔 무관. 헛호출 감소용:
로그인 직후 `supabase.rpc('server_now')` 1회(또는 `select now()`)로 `serverOffsetMs = serverNow - Date.now()` 를 잡고
tick 의 `now` 를 `Date.now() + serverOffsetMs` 로 계산. (RPC 추가 필요 시 다음 마이그레이션에서)
