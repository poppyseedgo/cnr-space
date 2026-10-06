#!/usr/bin/env python3
"""⚠ LOCAL_ONLY — 예약 쓰기 가드(20261017) 로컬 시뮬. 운영 실행 금지.

저장소의 마이그레이션/롤백 파일을 수정 없이 그대로 적용해, 적용 전 → 적용 후 → 재실행 → 롤백 → 재적용
5단계에서 66개 경로(주체 × 실제 프론트/Edge SQL)의 통과/차단이 기대와 일치하는지 본다.

PostgREST 와 같은 방식으로 실행: authenticator 로 접속 → 트랜잭션 안에서 SET LOCAL ROLE + request.jwt.claims.
각 테스트는 독립 트랜잭션에서 실행 후 ROLLBACK (서로 영향 없음).
SQL 은 프론트(api.ts / App.tsx)·Edge(auto-cancel-bookings)가 실제로 보내는 SET 목록·필터를 그대로 옮겼다.

실행 (로컬 PostgreSQL, trust 인증, 포트 5544, 슈퍼유저 이름 postgres):
  initdb -D /tmp/pgsim -A trust -U postgres && pg_ctl -D /tmp/pgsim -o "-p 5544" -w start
  python3 LOCAL_ONLY__run_guard_sim.py LOCAL_ONLY__00_stub_prod.sql ../20261017_booking_write_guard.sql ../_rollback_20261017_booking_write_guard.sql
"""
import json, subprocess, sys

PORT = "5544"
STUB, MIG, ROLLBACK = sys.argv[1], sys.argv[2], sys.argv[3]

U1 = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"
U3 = "33333333-3333-3333-3333-333333333333"
A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ACTORS = {
    "U1(예약자)":  ("authenticated", {"sub": U1, "email": "u1@cnrres.com", "role": "authenticated"}),
    "U2(참석자)":  ("authenticated", {"sub": U2, "email": "u2@cnrres.com", "role": "authenticated"}),
    "U3(외부인)":  ("authenticated", {"sub": U3, "email": "u3@cnrres.com", "role": "authenticated"}),
    "A1(관리자)":  ("authenticated", {"sub": A1, "email": "a1@cnrres.com", "role": "authenticated"}),
    "anon":        ("anon",          {"role": "anon"}),
    "service_role": ("service_role", {"role": "service_role"}),
    "postgres":    (None, None),
}

OK = ("OK",)
ZERO = ("ZERO",)
def RET(s):   return ("RET", s)
def BLOCK(s): return ("BLOCK", s)

# bookingToRow 컬럼 목록 그대로 (api.ts L224)
def ins(id_, room, uid, email, status, extra_cols="", extra_vals="", start="8 hours", end="9 hours"):
    return (f"INSERT INTO bookings (id, room_id, title, memo, start_at, end_at, user_id, user_email, user_name, user_dept, "
            f"checked_in, auto_cancelled, cancelled_by, early_ended, original_end_at, recur_group_id, status, purpose, purpose_detail{extra_cols}) "
            f"VALUES ('{id_}', {room}, 't', '', now()+interval '{start}', now()+interval '{end}', '{uid}', '{email}', 'n', 'd', "
            f"false, false, NULL, false, NULL, NULL, '{status}', NULL, NULL{extra_vals})")

CHECKIN   = "UPDATE bookings SET checked_in = true WHERE id = '{b}'"                                                    # App.tsx checkIn
EARLYEND  = "UPDATE bookings SET early_ended = true, end_at = now(), original_end_at = end_at WHERE id = '{b}'"          # App.tsx earlyEnd
CANCEL    = ("UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='user', cancelled_by_user_id='{u}' "
             "WHERE id = '{b}' AND cancelled_by IS NULL AND status IN ('confirmed','pending')")                        # api.cancelBooking
FORCE     = "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='admin', cancelled_by_user_id='{u}' WHERE id = '{b}'"  # api.adminForceCancel
APPROVE   = "UPDATE bookings SET status='confirmed', processed_by_name='처리자', processed_by_avatar=NULL WHERE id = '{b}'"  # api.approveBooking
REJECT    = ("UPDATE bookings SET status='rejected', auto_cancelled=true, cancelled_by='admin', reject_reason='사유', "
             "processed_by_name='처리자', processed_by_avatar=NULL WHERE id = '{b}'")                                   # api.rejectBooking
def EDIT(b, room, start, end, status):                                                                                  # App.tsx updateBooking → api.updateBooking
    return (f"UPDATE bookings SET room_id={room}, title='수정', memo='', purpose=NULL, purpose_detail=NULL, "
            f"start_at=now()+interval '{start}', end_at=now()+interval '{end}', status='{status}' WHERE id = '{b}'")
ATT = '[{"email":"u2@cnrres.com","name":"U2"},{"email":"new@cnrres.com","name":"N"}]'

# (이름, 주체, SQL, 적용 전 기대, 적용 후 기대)
T = [
 # ── 정상 흐름: 적용 전후 모두 통과해야 한다 ─────────────────────────────────────────────
 ("생성: 본인·일반룸·confirmed",            "U1(예약자)", ins("X1", 2, U1, "u1@cnrres.com", "confirmed", start="10 hours", end="11 hours"), OK, OK),
 ("생성: 본인·승인룸·pending",              "U1(예약자)", ins("X2", 3, U1, "u1@cnrres.com", "pending", start="10 hours", end="11 hours"), OK, OK),
 ("체크인: 예약자",                         "U1(예약자)", CHECKIN.format(b="N5"), OK, OK),
 ("체크인: 참석자(이메일 대소문자·공백)",   "U2(참석자)", CHECKIN.format(b="N1"), OK, OK),
 ("체크인: 승인 완료 승인룸",               "U1(예약자)", CHECKIN.format(b="E2"), OK, OK),
 ("조기반납: 예약자",                       "U1(예약자)", EARLYEND.format(b="N3"), OK, OK),
 ("조기반납: 승인룸 진행중",                "U1(예약자)", EARLYEND.format(b="E3"), OK, OK),
 ("취소: 예약자",                           "U1(예약자)", CANCEL.format(b="N1", u=U1), OK, OK),
 ("취소: 참석자",                           "U2(참석자)", CANCEL.format(b="N1", u=U2), OK, OK),
 ("취소: 승인 대기 건(예약자)",             "U1(예약자)", CANCEL.format(b="E1", u=U1), OK, OK),
 ("취소: 승인 완료 건(참석자)",             "U2(참석자)", CANCEL.format(b="E2", u=U2), OK, OK),
 ("취소: user_email 경로 예약자(user_id 불일치)", "U1(예약자)", CANCEL.format(b="N6", u=U1), OK, OK),
 ("수정: 예약자·일반룸 시간 변경",          "U1(예약자)", EDIT("N1", 1, "150 minutes", "210 minutes", "confirmed"), OK, OK),
 ("수정: 참석자·일반룸 시간 변경",          "U2(참석자)", EDIT("N1", 1, "150 minutes", "210 minutes", "confirmed"), OK, OK),
 ("수정: 일반룸→승인룸 이동(pending 재설정)", "U1(예약자)", EDIT("N1", 3, "9 hours", "10 hours", "pending"), OK, OK),
 ("수정: 승인 완료 건 제목만(시간·룸 동일)", "U1(예약자)", "UPDATE bookings SET title='제목만', status='confirmed' WHERE id='E2'", OK, OK),
 ("수정: 승인 완료 건 시간 변경 + pending 재요청", "U1(예약자)", "UPDATE bookings SET start_at=now()+interval '8 hours', end_at=now()+interval '9 hours', status='pending' WHERE id='E2'", OK, OK),
 ("수정: 참석자·예약자 프로필 삭제 건(user_id NULL)", "U2(참석자)", "UPDATE bookings SET title='x' WHERE id='N7'", OK, OK),
 ("노쇼 tick: 외부인 브라우저의 mark_noshow RPC", "U3(외부인)", "SELECT mark_noshow('N4')", RET("1"), RET("1")),
 ("노쇼 tick: 미래 예약은 0 (서버 시간가드)", "U3(외부인)", "SELECT mark_noshow('N1')", RET("0"), RET("0")),
 ("참석자 동기화 RPC: 예약자",              "U1(예약자)", f"SELECT sync_booking_attendees('N1', '{ATT}'::jsonb)", RET('"inserted": 2'), RET('"inserted": 2')),
 ("관리자: 승인",                           "A1(관리자)", APPROVE.format(b="E1"), OK, OK),
 ("관리자: 거절",                           "A1(관리자)", REJECT.format(b="E1"), OK, OK),
 ("관리자: 타인 예약 강제취소",             "A1(관리자)", FORCE.format(b="N1", u=A1), OK, OK),
 ("관리자: 타인 예약 수정",                 "A1(관리자)", EDIT("N1", 1, "150 minutes", "210 minutes", "confirmed"), OK, OK),
 ("관리자: 승인 완료 건 시간 변경(confirmed 유지)", "A1(관리자)", EDIT("E2", 3, "8 hours", "9 hours", "confirmed"), OK, OK),
 ("관리자: 대리 예약(승인룸 즉시 확정)",    "A1(관리자)", ins("X3", 3, U2, "u2@cnrres.com", "confirmed", start="10 hours", end="11 hours"), OK, OK),
 ("관리자: 예약자 변경 RPC",                "A1(관리자)", f"SELECT admin_change_booking_owner('N1', '{U3}')", RET('"ok": true'), RET('"ok": true')),
 ("관리자: 타인 프로필 이름·부서 수정",     "A1(관리자)", f"UPDATE profiles SET name='새이름', dept='새부서' WHERE id='{U1}'", OK, OK),
 ("관리자(super): 권한 부여 RPC → role 재계산", "A1(관리자)", f"SELECT admin_set_user_roles('{U3}', ARRAY['book']); SELECT 'role=' || role FROM profiles WHERE id='{U3}'", RET("role=ADMIN"), RET("role=ADMIN")),
 ("본인 프로필 부서 저장(SSO 첫 로그인)",   "U1(예약자)", f"UPDATE profiles SET dept='새부서' WHERE id='{U1}'", OK, OK),
 ("본인 프로필 저장에 role 동일값 포함",    "U1(예약자)", f"UPDATE profiles SET role='USER', dept='Y' WHERE id='{U1}'", OK, OK),
 ("service_role(cron ①): 노쇼 마킹 — index.ts L257 페이로드·가드5종", "service_role", "UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id='N4' AND status='confirmed' AND checked_in=false AND early_ended=false AND auto_cancelled=false AND cancelled_by IS NULL", OK, OK),
 ("service_role(cron ①): noshow_notified 마킹 — L311", "service_role", "UPDATE bookings SET noshow_notified=true WHERE id='N4' AND noshow_notified=false", OK, OK),
 ("service_role(cron ②): approval_reminder_sent — L361", "service_role", "UPDATE bookings SET approval_reminder_sent=true WHERE id='E1'", OK, OK),
 ("service_role(cron ④): 승인 기한 초과 처리 — L412 (시작+10분 경과 건)", "service_role", "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='system' WHERE id='E4' AND status='pending'", OK, OK),
 ("service_role(cron ④): 같은 페이로드·시작 전 건 → 기존 트리거(block_premature_noshow)가 0행 처리(현행 동작 그대로)", "service_role", "UPDATE bookings SET status='cancelled', auto_cancelled=true, cancelled_by='system' WHERE id='E1' AND status='pending'", ZERO, ZERO),
 ("service_role: role 변경(sync-all-users)", "service_role", f"UPDATE profiles SET role='ADMIN' WHERE id='{U3}'", OK, OK),
 ("postgres(SQL Editor): 임의 복구",        "postgres", "UPDATE bookings SET status='confirmed', cancelled_by='admin', user_id=NULL WHERE id='E1'", OK, OK),
 # ── 기존에도 막히던 것: 그대로 막혀야 한다 ─────────────────────────────────────────────
 ("참석자 동기화 RPC: 외부인",              "U3(외부인)", f"SELECT sync_booking_attendees('N1', '{ATT}'::jsonb)", BLOCK("permission denied"), BLOCK("permission denied")),
 ("예약자 변경 RPC: 비관리자",              "U1(예약자)", f"SELECT admin_change_booking_owner('N1', '{U3}')", BLOCK("FORBIDDEN_NOT_ADMIN"), BLOCK("FORBIDDEN_NOT_ADMIN")),
 ("비로그인 생성",                          "anon", ins("X9", 2, U1, "u1@cnrres.com", "confirmed", start="12 hours", end="13 hours"), BLOCK("row-level security"), BLOCK("NOT_AUTHENTICATED")),
 # ── 구멍: 적용 전에는 통과(재현), 적용 후에는 차단 ─────────────────────────────────────
 ("★사고 재현: 예약자가 본인 승인룸 예약 직접 승인", "U1(예약자)", APPROVE.format(b="E1"), OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("본인 승인(처리자 표식 없이 status 만)",   "U1(예약자)", "UPDATE bookings SET status='confirmed' WHERE id='E1'", OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("외부인이 타인 예약 승인",                "U3(외부인)", APPROVE.format(b="E1"), OK, BLOCK("NOT_PARTICIPANT")),
 ("예약자가 본인 예약 거절 처리",           "U1(예약자)", REJECT.format(b="E1"), OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("외부인이 타인 예약 강제취소",            "U3(외부인)", FORCE.format(b="N1", u=U3), OK, BLOCK("NOT_PARTICIPANT")),
 ("예약자가 강제취소 표식으로 취소",        "U1(예약자)", FORCE.format(b="N1", u=U1), OK, BLOCK("CANCEL_MARK_ADMIN_ONLY")),
 ("외부인이 타인 예약 취소",                "U3(외부인)", CANCEL.format(b="N1", u=U3), OK, BLOCK("NOT_PARTICIPANT")),
 ("외부인이 타인 예약 체크인",              "U3(외부인)", CHECKIN.format(b="N5"), OK, BLOCK("NOT_PARTICIPANT")),
 ("외부인이 타인 예약 수정",                "U3(외부인)", EDIT("N1", 1, "150 minutes", "210 minutes", "confirmed"), OK, BLOCK("NOT_PARTICIPANT")),
 ("외부인이 예약자 없는 건(user_id NULL) 수정", "U3(외부인)", "UPDATE bookings SET title='x' WHERE id='N7'", OK, BLOCK("NOT_PARTICIPANT")),
 ("외부인 upsert 로 타인 예약 덮어쓰기",    "U3(외부인)", ins("N1", 1, U3, "u3@cnrres.com", "confirmed") + " ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title", OK, BLOCK("NOT_PARTICIPANT")),
 ("일반룸→승인룸 이동을 confirmed 로(승인 우회)", "U1(예약자)", EDIT("N1", 3, "9 hours", "10 hours", "confirmed"), OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("승인 완료 건 시간 변경(confirmed 유지)", "U1(예약자)", EDIT("E2", 3, "8 hours", "9 hours", "confirmed"), OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("승인 완료 건 종료시각 연장",             "U1(예약자)", "UPDATE bookings SET end_at = end_at + interval '30 minutes' WHERE id='E2'", OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("승인룸을 confirmed 로 직접 생성",        "U1(예약자)", ins("X4", 3, U1, "u1@cnrres.com", "confirmed", start="10 hours", end="11 hours"), OK, BLOCK("APPROVAL_ADMIN_ONLY")),
 ("타인 명의 예약 생성(대리 예약)",         "U1(예약자)", ins("X5", 2, U2, "u2@cnrres.com", "confirmed", start="10 hours", end="11 hours"), OK, BLOCK("PROXY_ADMIN_ONLY")),
 ("처리자 표식을 단 채 생성",               "U1(예약자)", ins("X6", 2, U1, "u1@cnrres.com", "confirmed", ", processed_by_name", ", '가짜'", start="10 hours", end="11 hours"), OK, BLOCK("ADMIN_MARK_ONLY")),
 ("예약자 직접 변경(예약자 스냅샷 수정)",   "U1(예약자)", f"UPDATE bookings SET user_id='{U3}', user_email='u3@cnrres.com', user_name='U3', user_dept='BD' WHERE id='N1'", OK, BLOCK("OWNER_CHANGE_ADMIN_ONLY")),
 ("노쇼(system) 표식 직접 기록",            "U1(예약자)", "UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id='N4'", OK, BLOCK("CANCEL_MARK_ADMIN_ONLY")),
 ("참석자로 자가 등록",                     "U3(외부인)", "INSERT INTO booking_attendees (booking_id, email, name) VALUES ('N1', 'u3@cnrres.com', 'U3')", OK, BLOCK("row-level security")),
 ("자가 등록 후 타인 예약 취소(연쇄)",      "U3(외부인)", "INSERT INTO booking_attendees (booking_id, email, name) VALUES ('N1', 'u3@cnrres.com', 'U3'); " + CANCEL.format(b="N1", u=U3), OK, BLOCK("row-level security")),
 ("본인 role 을 ADMIN 으로 변경",           "U3(외부인)", f"UPDATE profiles SET role='ADMIN' WHERE id='{U3}'", OK, BLOCK("ROLE_READONLY")),
 ("자가 승격 후 타인 예약 승인(연쇄)",      "U3(외부인)", f"UPDATE profiles SET role='ADMIN' WHERE id='{U3}'; " + APPROVE.format(b="E1"), OK, BLOCK("ROLE_READONLY")),
 ("관리자가 RPC 없이 타인 role 직접 변경",  "A1(관리자)", f"UPDATE profiles SET role='ADMIN' WHERE id='{U3}'", OK, BLOCK("ROLE_READONLY")),
]

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
        return (expect[1] in body), body
    tags = [l for l in body.splitlines() if l.startswith(("UPDATE ", "INSERT "))]
    if kind == "ZERO":
        return (bool(tags) and all(int(t.split()[-1]) == 0 for t in tags)), body
    ok = bool(tags) and all(int(t.split()[-1]) >= 1 for t in tags)
    return ok, body

def run_suite(db, which, label):
    idx = 3 if which == "pre" else 4
    fails = 0
    for t in T:
        rc, body, errline = run_test(db, t[1], t[2])
        ok, detail = judge(t[idx], rc, body, errline)
        if not ok:
            fails += 1
            print(f"    FAIL [{t[1]}] {t[0]} — 기대 {t[idx]} / 실제: {detail[:160]}")
    n_block = sum(1 for t in T if t[idx][0] == "BLOCK")
    print(f"  {label}: {len(T) - fails}/{len(T)} 일치 (통과 기대 {len(T) - n_block} · 차단 기대 {n_block})" + ("" if fails == 0 else f"  ← FAIL {fails}"))
    return fails

def fresh(db):
    psql("postgres", f"DROP DATABASE IF EXISTS {db};")
    psql("postgres", f"CREATE DATABASE {db};")
    rc, out, err = psql(db, open(STUB).read())
    if rc != 0: print("스텁 적용 실패:", err[:500]); sys.exit(2)

def apply(db, path, label):
    # SQL Editor 와 같은 방식: 파일 전체를 postgres 로 실행
    p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", path],
                       capture_output=True, text=True)
    errs = [l for l in p.stderr.splitlines() if "ERROR" in l]
    last = [l for l in p.stdout.splitlines() if "|" in l][-1:] or ["(확인 행 없음)"]
    print(f"  {label}: rc={p.returncode} 확인행={last[0]}" + (f" 오류={errs[0][:200]}" if errs else ""))
    return p.returncode

total = 0
print("[1] 적용 전(운영 현재 상태) — 구멍이 그대로 재현되는지")
fresh("g1"); total += run_suite("g1", "pre", "적용 전")
print("[2] 20261017 적용 후")
total += apply("g1", MIG, "마이그레이션 적용"); total += run_suite("g1", "post", "적용 후")
print("[3] 재실행(멱등)")
total += apply("g1", MIG, "마이그레이션 재실행"); total += run_suite("g1", "post", "재실행 후")
print("[4] 롤백 → 적용 전 동작으로 복귀하는지")
total += apply("g1", ROLLBACK, "롤백 적용"); total += run_suite("g1", "pre", "롤백 후")
print("[5] 롤백 뒤 재적용")
total += apply("g1", MIG, "마이그레이션 재적용"); total += run_suite("g1", "post", "재적용 후")
print(f"총 불일치: {total}")
sys.exit(0 if total == 0 else 1)
