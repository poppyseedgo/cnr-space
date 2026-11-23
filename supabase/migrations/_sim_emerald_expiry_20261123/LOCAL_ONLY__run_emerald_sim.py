#!/usr/bin/env python3
"""⚠ LOCAL_ONLY — 에메랄드 기한초과(20261123) 로컬 시뮬. 운영 실행 금지.

저장소의 마이그레이션/롤백 파일을 수정 없이 그대로 적용해
  적용 전(운영 현재 상태 재현) → 적용 → 재실행(멱등) → 롤백 → 재적용
단계마다 기대와 일치하는지 본다.

PostgREST 와 같은 방식: authenticator 로 접속 → 트랜잭션 안에서 SET LOCAL ROLE + request.jwt.claims.
pg_cron·SQL Editor 경로는 postgres 접속(session_user='postgres')으로 재현.
각 테스트는 독립 트랜잭션에서 실행 후 ROLLBACK.

실행 (로컬 PostgreSQL 16, trust 인증, 포트 5544, 슈퍼유저 이름 postgres):
  python3 LOCAL_ONLY__run_emerald_sim.py
"""
import json, os, subprocess, sys

PORT = "5544"
HERE = os.path.dirname(os.path.abspath(__file__))
MIGS = os.path.dirname(HERE)
STUB      = os.path.join(MIGS, "_sim_booking_guard", "LOCAL_ONLY__00_stub_prod.sql")
GUARD     = os.path.join(MIGS, "20261017_booking_write_guard.sql")
EXTRA     = os.path.join(HERE, "LOCAL_ONLY__01_stub_extra.sql")
MIG       = os.path.join(MIGS, "20261123_emerald_pending_expiry.sql")
ROLLBACK  = os.path.join(MIGS, "_rollback_20261123_emerald_pending_expiry.sql")

U1 = "11111111-1111-1111-1111-111111111111"
A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ACTORS = {
    "U1(일반)":     ("authenticated", {"sub": U1, "email": "u1@cnrres.com", "role": "authenticated"}),
    "A1(관리자)":   ("authenticated", {"sub": A1, "email": "a1@cnrres.com", "role": "authenticated"}),
    "service_role": ("service_role",  {"role": "service_role"}),
    "postgres":     (None, None),
}
OK = ("OK",)
def RET(s):   return ("RET", s)
def BLOCK(s): return ("BLOCK", s)

def psql(db, sql, user="postgres"):
    p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", user, "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input=sql, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def run_test(db, actor, sql):
    role, claims = ACTORS[actor]
    if role is None:
        script = f"BEGIN;\n\\echo ---S---\n{sql};\n\\echo ---E---\nROLLBACK;\n"
        rc, out, err = psql(db, script, "postgres")
    else:
        cj = json.dumps(claims).replace("'", "''")
        script = (f"BEGIN;\nSET LOCAL ROLE {role};\nSELECT set_config('request.jwt.claims', '{cj}', true) IS NOT NULL;\n"
                  f"\\echo ---S---\n{sql};\n\\echo ---E---\nROLLBACK;\n")
        rc, out, err = psql(db, script, "authenticator")
    body = out.split("---S---")[-1].split("---E---")[0].strip() if "---S---" in out else ""
    errline = next((l for l in err.splitlines() if "ERROR:" in l), "")
    return rc, body, errline

def judge(expect, rc, body, errline):
    kind = expect[0]
    if kind == "BLOCK":
        return (rc != 0 and expect[1] in errline), (errline or f"(오류 없음) {body}")
    if rc != 0:
        return False, errline
    if kind == "RET":
        last = body.splitlines()[-1] if body else ""
        return (last == expect[1]), body
    tags = [l for l in body.splitlines() if l.startswith(("UPDATE ", "INSERT "))]
    return (bool(tags) and all(int(t.split()[-1]) >= 1 for t in tags)), body

# ── 공통 SQL ────────────────────────────────────────────────────────────────
# bookingToRow 컬럼 목록 그대로 (api.ts) — 프론트가 실제로 보내는 INSERT
def ins(id_, room, uid, email, status, start, end):
    return (f"INSERT INTO bookings (id, room_id, title, memo, start_at, end_at, user_id, user_email, user_name, user_dept, "
            f"checked_in, auto_cancelled, cancelled_by, early_ended, original_end_at, recur_group_id, status, purpose, purpose_detail) "
            f"VALUES ('{id_}', {room}, 't', '', now()+interval '{start}', now()+interval '{end}', '{uid}', '{email}', 'n', 'd', "
            f"false, false, NULL, false, NULL, NULL, '{status}', NULL, NULL)")
# App.tsx updateBooking → api.updateBooking SET 목록
def EDIT(b, room, start, end, status):
    return (f"UPDATE bookings SET room_id={room}, title='수정', memo='', purpose=NULL, purpose_detail=NULL, "
            f"start_at=now()+interval '{start}', end_at=now()+interval '{end}', status='{status}' WHERE id = '{b}'")
# api.cancelBooking
CANCEL = ("UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='user', cancelled_by_user_id='{u}' "
          "WHERE id = '{b}' AND cancelled_by IS NULL AND status IN ('confirmed','pending')")

# 시드(트리거 우회 — 과거·임박 시각을 직접 넣기 위해) → 원복 후 본 동작 실행
def seed(rows):
    vals = ",\n".join(
        f"('{i}', {room}, 't', now()+interval '{s}', now()+interval '{e}', '{U1}','U1','CDI','u1@cnrres.com','{st}', false)"
        for (i, room, s, e, st) in rows)
    return ("SET LOCAL session_replication_role = replica;\n"
            "DELETE FROM net._calls;\n"
            f"INSERT INTO bookings (id, room_id, title, start_at, end_at, user_id, user_name, user_dept, user_email, status, checked_in) VALUES\n{vals};\n"
            "SET LOCAL session_replication_role = origin")
def check(cond, dump="''"):
    return f"SELECT CASE WHEN ({cond}) THEN 'PASS' ELSE 'FAIL ' || ({dump})::text END"
def row(id_):
    return f"(SELECT row_to_json(b) FROM (SELECT status, auto_cancelled, cancelled_by, end_at-start_at AS dur, noshow_closed_at, pending_expired_notified, approval_reminder_sent FROM bookings WHERE id='{id_}') b)"
EXPIRE = "SELECT public.expire_pending_bookings()"
def is_expired(i): return f"(SELECT status='cancelled' AND auto_cancelled AND cancelled_by='system' FROM bookings WHERE id='{i}')"
def is_pending(i): return f"(SELECT status='pending' AND auto_cancelled IS NOT TRUE AND cancelled_by IS NULL FROM bookings WHERE id='{i}')"
WOKE = "(SELECT count(*) FROM net._calls WHERE body->>'task'='pending' AND url LIKE '%/functions/v1/auto-cancel-bookings')"

# ── [P] 적용 전: 운영 현재 상태 재현 ────────────────────────────────────────
PRE = [
 ("잔여 승인 대기 2건이 pending 그대로 남아 있음(깜빡임의 DB 쪽 원인)", "postgres",
  check("(SELECT count(*) FROM bookings WHERE id IN ('L1','L2') AND status='pending' AND auto_cancelled IS NOT TRUE)=2"), RET("PASS")),
 ("잔여 건이 DB 겹침 제약을 계속 점유 — 같은 시간 새 예약 거절", "postgres",
  ins("X1", 3, U1, "u1@cnrres.com", "pending", "20 minutes", "50 minutes"), BLOCK("bookings_no_overlap")),
 ("★[C] 필요성: 기한초과 전환이 노쇼 종결 트리거에 걸려 종료시각이 시작+15분으로 잘림", "postgres",
  seed([("T1", 3, "4 hours", "5 hours", "pending")]) + ";\n"
  "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='system' WHERE id='T1';\n"
  + check("(SELECT end_at-start_at = interval '15 minutes' AND noshow_closed_at IS NOT NULL FROM bookings WHERE id='T1')"), RET("PASS")),  # 적용 전엔 신규 컬럼이 없어 row() 덤프 미사용
 ("일반 사용자가 시작 1분 전에 에메랄드 신청 — 통과(운영 잔여 건이 생긴 경로)", "U1(일반)",
  ins("X2", 3, U1, "u1@cnrres.com", "pending", "61 minutes", "75 minutes").replace("61 minutes", "60 minutes 50 seconds"), OK),
]

# ── [D] 마이그레이션 직후 1회 정리 결과 (적용 직후에만 확인) ───────────────────
CLEANUP = [
 ("잔여 2건 → 기한초과 취소로 기록", "postgres", check(f"{is_expired('L1')} AND {is_expired('L2')}", row("L1")), RET("PASS")),
 ("잔여 2건 종료시각 그대로(노쇼 종결 미적용) · noshow_closed_at 없음", "postgres",
  check("(SELECT count(*) FROM bookings WHERE id IN ('L1','L2') AND noshow_closed_at IS NULL AND original_end_at IS NULL "
        "AND end_at-start_at IN (interval '150 minutes', interval '90 minutes'))=2", row("L1")), RET("PASS")),
 ("잔여 2건 + 기존 기한초과 건 알림 발송 대상에서 제외(통지 완료 표시)", "postgres",
  check("(SELECT count(*) FROM bookings WHERE id IN ('L1','L2','L3') AND pending_expired_notified)=3"), RET("PASS")),
 ("정리 뒤 첫 실행: 전환 0건 · 알림 호출 없음(뒤늦은 메일 없음)", "postgres",
  "DELETE FROM net._calls;\n" + EXPIRE + ";\n" + check(f"{WOKE}=0"), RET("PASS")),
 ("잔여 건이 풀려 같은 시간 새 예약 가능", "postgres", ins("X1", 3, U1, "u1@cnrres.com", "pending", "20 minutes", "50 minutes"), OK),
 ("다른 승인 대기(E1, 2시간 뒤)는 그대로", "postgres", check(is_pending("E1"), row("E1")), RET("PASS")),
]

# ── [E] expire_pending_bookings() ───────────────────────────────────────────
EXPIRY = [
 ("마감 직후(시작 59초 전) 승인 대기 → 기한초과 취소", "postgres",
  seed([("T1", 3, "59 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(is_expired("T1"), row("T1")), RET("PASS")),
 ("종료시각 그대로 · noshow_closed_at 없음 · 원본 종료 미기록", "postgres",
  seed([("T1", 3, "59 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  + check("(SELECT end_at-start_at > interval '59 minutes' AND noshow_closed_at IS NULL AND original_end_at IS NULL FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 ("전환 직후 알림 깨움 1회(task=pending) · 처리 이력 1행", "postgres",
  seed([("T1", 3, "59 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  + check(f"{WOKE}=1 AND (SELECT count(*) FROM audit_log WHERE entity_id='T1' AND action='BOOKING_CANCELLED' AND actor_name='system')=1"), RET("PASS")),
 ("마감 직전(시작 61초 전)은 전환 안 함", "postgres",
  seed([("T1", 3, "61 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(is_pending("T1"), row("T1")), RET("PASS")),
 ("이미 시작한 승인 대기(시작 5분 경과)도 전환", "postgres",
  seed([("T1", 3, "-5 minutes", "55 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(is_expired("T1"), row("T1")), RET("PASS")),
 ("승인 완료 건(confirmed)은 손대지 않음", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "confirmed")]) + ";\n" + EXPIRE + ";\n"
  + check("(SELECT status='confirmed' AND auto_cancelled IS NOT TRUE AND cancelled_by IS NULL FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 ("사용자가 먼저 취소한 건은 손대지 않음(cancelled_by='user' 유지)", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n"
  "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='user' WHERE id='T1';\n" + EXPIRE + ";\n"
  + check("(SELECT cancelled_by='user' FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 ("거절된 건은 손대지 않음", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n"
  "UPDATE bookings SET status='rejected', auto_cancelled=true, cancelled_by='admin' WHERE id='T1';\n" + EXPIRE + ";\n"
  + check("(SELECT status='rejected' AND cancelled_by='admin' FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 ("에메랄드가 아닌 방의 pending 은 대상 아님(확정 판정식 room_id=3)", "postgres",
  seed([("T1", 1, "30 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(is_pending("T1"), row("T1")), RET("PASS")),
 ("재실행해도 추가 전환 없음(멱등) · 반환 expired=0", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  + check("(SELECT (public.expire_pending_bookings()->>'expired')::int)=0"), RET("PASS")),
 ("여러 건 동시 전환 · 반환 expired=2", "postgres",
  seed([("T1", 3, "30 seconds", "31 minutes", "pending"), ("T2", 3, "-40 minutes", "-10 minutes", "pending")]) + ";\n"
  + check("(SELECT (public.expire_pending_bookings()->>'expired')::int)=2"), RET("PASS")),
 ("전환되면 겹침 제약에서 빠져 같은 시간 새 예약 가능", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  + ins("X1", 3, U1, "u1@cnrres.com", "confirmed", "30 seconds", "61 minutes"), OK),
 ("전환 전에는 겹침 제약이 막음(대조)", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n"
  + ins("X1", 3, U1, "u1@cnrres.com", "confirmed", "30 seconds", "61 minutes"), BLOCK("bookings_no_overlap")),
 # ── 승인 마감 임박(5분 전) 알림 깨움 ──
 ("승인 마감 5분 전 구간(시작 5분 전) · 미통지 → 깨움, 전환 없음", "postgres",
  seed([("T1", 3, "5 minutes", "65 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(f"{WOKE}=1 AND {is_pending('T1')}", row("T1")), RET("PASS")),
 ("구간 시작 경계: 시작 6분 전 직후(5분 59초 전) → 깨움", "postgres",
  seed([("T1", 3, "5 minutes 59 seconds", "65 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(f"{WOKE}=1"), RET("PASS")),
 ("구간 이전(시작 7분 전) → 깨우지 않음", "postgres",
  seed([("T1", 3, "7 minutes", "65 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + check(f"{WOKE}=0"), RET("PASS")),
 ("이미 통지한 건(approval_reminder_sent) → 깨우지 않음", "postgres",
  seed([("T1", 3, "5 minutes", "65 minutes", "pending")]) + ";\nUPDATE bookings SET approval_reminder_sent=true WHERE id='T1';\n"
  + EXPIRE + ";\n" + check(f"{WOKE}=0"), RET("PASS")),
 ("기한초과 알림 미발송 건이 남아 있으면 다음 분에도 다시 깨움(재시도)", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n" + EXPIRE + ";\n" + check(f"{WOKE}=2"), RET("PASS")),
 ("알림 발송 완료 표시 후에는 깨우지 않음", "postgres",
  seed([("T1", 3, "30 seconds", "61 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  "UPDATE bookings SET pending_expired_notified=true WHERE id='T1';\nDELETE FROM net._calls;\n" + EXPIRE + ";\n" + check(f"{WOKE}=0"), RET("PASS")),
 ("시작한 지 1시간 넘은 미통지 건은 깨우지 않음(뒤늦은 메일 방지)", "postgres",
  seed([("T1", 3, "-61 minutes", "-1 minutes", "pending")]) + ";\n" + EXPIRE + ";\n"
  + check(f"{WOKE}=0 AND {is_expired('T1')}", row("T1")), RET("PASS")),
 # ── 노쇼 회귀 ([C] 가 노쇼 동작을 바꾸지 않는지) ──
 ("노쇼 전환은 종전대로 시작+15분 종결 · noshow_closed_at 기록", "postgres",
  seed([("T1", 1, "-20 minutes", "40 minutes", "confirmed")]) + ";\n"
  "UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id='T1';\n"
  + check("(SELECT end_at-start_at = interval '15 minutes' AND noshow_closed_at IS NOT NULL AND original_end_at IS NOT NULL AND status='confirmed' FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 ("에메랄드 승인 완료 건의 노쇼도 종전대로 종결", "postgres",
  seed([("T1", 3, "-20 minutes", "40 minutes", "confirmed")]) + ";\n"
  "UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id='T1';\n"
  + check("(SELECT end_at-start_at = interval '15 minutes' AND noshow_closed_at IS NOT NULL FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
 # ── 실행 권한 ──
 ("일반 사용자는 함수 실행 불가", "U1(일반)", EXPIRE, BLOCK("permission denied")),
 ("관리자(클라이언트)도 함수 실행 불가", "A1(관리자)", EXPIRE, BLOCK("permission denied")),
 ("service_role 도 함수 실행 불가(pg_cron 전용)", "service_role", EXPIRE, BLOCK("permission denied")),
]

# ── [F] 직전 신청 차단 ──────────────────────────────────────────────────────
LEAD = [
 ("일반: 시작 16분 전 에메랄드 신청", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "16 minutes", "46 minutes"), OK),
 ("일반: 시작 15분 5초 전(경계 안쪽) 신청", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "15 minutes 5 seconds", "46 minutes"), OK),
 ("일반: 시작 14분 55초 전 신청 → 차단", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "14 minutes 55 seconds", "46 minutes"), BLOCK("APPROVAL_ROOM_LEAD_TIME:15")),
 ("★운영 잔여 건 경로: 일반이 시작 44초 전 신청 → 차단", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "44 seconds", "46 minutes"), BLOCK("APPROVAL_ROOM_LEAD_TIME:15")),
 ("일반: 이미 시작한 시간대 에메랄드 신청 → 차단", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "-2 minutes", "46 minutes"), BLOCK("APPROVAL_ROOM_LEAD_TIME:15")),
 ("일반: 일반 회의실은 시작 2분 전에도 예약 가능(대상 아님)", "U1(일반)", ins("X1", 6, U1, "u1@cnrres.com", "confirmed", "2 minutes", "32 minutes"), OK),
 ("일반: 일반 회의실은 방금 시작한 시간대도 예약 가능(대상 아님)", "U1(일반)", ins("X1", 6, U1, "u1@cnrres.com", "confirmed", "-2 minutes", "32 minutes"), OK),
 ("관리자: 시작 2분 전 에메랄드 즉시 확정 생성", "A1(관리자)", ins("X1", 3, A1, "a1@cnrres.com", "confirmed", "2 minutes", "32 minutes"), OK),
 ("관리자: 시작 1분 5초 전(경계 안쪽) 생성", "A1(관리자)", ins("X1", 3, A1, "a1@cnrres.com", "confirmed", "1 minute 5 seconds", "32 minutes"), OK),
 ("관리자: 시작 55초 전 생성 → 차단", "A1(관리자)", ins("X1", 3, A1, "a1@cnrres.com", "confirmed", "55 seconds", "32 minutes"), BLOCK("APPROVAL_ROOM_LEAD_TIME:1")),
 ("관리자: 대리 예약(일반 사용자 명의) 시작 10분 전 → 관리자 기준 통과", "A1(관리자)", ins("X1", 3, U1, "u1@cnrres.com", "confirmed", "10 minutes", "40 minutes"), OK),
 ("관리자: 대리 예약 시작 30초 전 → 차단", "A1(관리자)", ins("X1", 3, U1, "u1@cnrres.com", "confirmed", "30 seconds", "40 minutes"), BLOCK("APPROVAL_ROOM_LEAD_TIME:1")),
 ("관리자: 일반 회의실은 대상 아님", "A1(관리자)", ins("X1", 6, A1, "a1@cnrres.com", "confirmed", "20 seconds", "32 minutes"), OK),
 ("일반: 일반 예약(N1)을 에메랄드 시작 10분 전으로 이동 → 차단", "U1(일반)", EDIT("N1", 3, "10 minutes", "40 minutes", "pending"), BLOCK("APPROVAL_ROOM_LEAD_TIME:15")),
 ("일반: 일반 예약(N1)을 에메랄드 시작 20분 전으로 이동", "U1(일반)", EDIT("N1", 3, "20 minutes", "50 minutes", "pending"), OK),
 ("일반: 임박한 본인 승인 대기 취소는 대상 아님", "postgres",
  seed([("T1", 3, "5 minutes", "35 minutes", "pending")]) + ";\n"
  "SET LOCAL ROLE authenticated;\n"
  f"SELECT set_config('request.jwt.claims', '{json.dumps(ACTORS['U1(일반)'][1])}', true) IS NOT NULL;\n"
  + CANCEL.format(b="T1", u=U1), OK),
 ("관리자: 임박한 에메랄드 승인 완료 건(E2 → 30초 뒤 시작으로) 변경은 대상 아님", "A1(관리자)", EDIT("E2", 3, "30 seconds", "40 minutes", "confirmed"), OK),
 ("관리자: 임박한 승인 대기 승인 처리는 대상 아님", "postgres",
  seed([("T1", 3, "90 seconds", "35 minutes", "pending")]) + ";\n"
  "SET LOCAL ROLE authenticated;\n"
  f"SELECT set_config('request.jwt.claims', '{json.dumps(ACTORS['A1(관리자)'][1])}', true) IS NOT NULL;\n"
  "UPDATE bookings SET status='confirmed', processed_by_name='처리자', processed_by_avatar=NULL WHERE id = 'T1'", OK),
 ("service_role(Edge/cron) 직접 생성은 대상 아님", "service_role", ins("X1", 3, U1, "u1@cnrres.com", "pending", "30 seconds", "40 minutes"), OK),
 ("postgres(SQL Editor) 직접 생성은 대상 아님", "postgres", ins("X1", 3, U1, "u1@cnrres.com", "pending", "30 seconds", "40 minutes"), OK),
]
# 롤백 뒤: 차단이 풀려 '적용 전' 동작으로 돌아가는지 (대표 케이스)
LEAD_ROLLED_BACK = [
 ("롤백 후: 일반이 시작 44초 전 신청 → 다시 통과", "U1(일반)", ins("X1", 3, U1, "u1@cnrres.com", "pending", "44 seconds", "46 minutes"), OK),
 ("롤백 후: 전환 함수 없음", "postgres", EXPIRE, BLOCK("does not exist")),
 ("롤백 후: 노쇼 종결 트리거 원문 복귀(기한초과 전환도 잘림)", "postgres",
  seed([("T1", 3, "4 hours", "5 hours", "pending")]) + ";\n"
  "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='system' WHERE id='T1';\n"
  + check("(SELECT end_at-start_at = interval '15 minutes' FROM bookings WHERE id='T1')", row("T1")), RET("PASS")),
]

def run_suite(db, tests, label):
    fails = 0
    for name, actor, sql, expect in tests:
        rc, body, errline = run_test(db, actor, sql)
        ok, detail = judge(expect, rc, body, errline)
        if not ok:
            fails += 1
            print(f"    FAIL [{actor}] {name} — 기대 {expect} / 실제: {detail[-300:]}")
    print(f"  {label}: {len(tests) - fails}/{len(tests)} 일치" + ("" if fails == 0 else f"  ← FAIL {fails}"))
    return fails

def apply(db, path, label):
    p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", path],
                       capture_output=True, text=True)
    errs = [l for l in p.stderr.splitlines() if "ERROR" in l]
    last = [l for l in p.stdout.splitlines() if "|" in l][-1:] or ["(확인 행 없음)"]
    print(f"  {label}: rc={p.returncode} 확인행={last[0]}" + (f" 오류={errs[0][:300]}" if errs else ""))
    return 0 if p.returncode == 0 else 1

def fresh(db):
    psql("postgres", f"DROP DATABASE IF EXISTS {db};")
    psql("postgres", f"CREATE DATABASE {db};")
    for path in (STUB, GUARD, EXTRA):
        p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", path],
                           capture_output=True, text=True)
        if p.returncode != 0:
            print("스텁 적용 실패:", path, p.stderr[:500]); sys.exit(2)

total = 0
db = "emerald_sim"
print("[1] 적용 전(운영 현재 상태) 재현")
fresh(db); total += run_suite(db, PRE, "적용 전")
print("[2] 20261123 적용")
total += apply(db, MIG, "마이그레이션 적용")
total += run_suite(db, CLEANUP, "잔여 건 1회 정리")
total += run_suite(db, EXPIRY, "기한초과 전환")
total += run_suite(db, LEAD, "직전 신청 차단")
print("[3] 재실행(멱등)")
total += apply(db, MIG, "마이그레이션 재실행")
total += run_suite(db, EXPIRY, "기한초과 전환")
total += run_suite(db, LEAD, "직전 신청 차단")
print("[4] 롤백")
total += apply(db, ROLLBACK, "롤백 적용")
total += run_suite(db, LEAD_ROLLED_BACK, "롤백 후")
print("[5] 재적용")
total += apply(db, MIG, "마이그레이션 재적용")
total += run_suite(db, EXPIRY, "기한초과 전환")
total += run_suite(db, LEAD, "직전 신청 차단")
print("\n결과:", "전부 일치" if total == 0 else f"불일치 {total}건")
sys.exit(0 if total == 0 else 1)
