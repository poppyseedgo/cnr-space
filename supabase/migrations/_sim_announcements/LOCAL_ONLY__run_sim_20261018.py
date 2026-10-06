#!/usr/bin/env python3
# ⚠ LOCAL_ONLY — 20261018_announcements_authenticated_only.sql 시뮬 (로컬 PG16, 운영과 무관)
#
#   준비:  initdb -D /tmp/pgsim -A trust -U postgres && pg_ctl -D /tmp/pgsim -o "-p 5544" -w start
#   실행:  python3 LOCAL_ONLY__run_sim_20261018.py
#
# PostgREST 와 같은 방식으로 실행한다: authenticator 로 접속 → 트랜잭션 안에서 SET LOCAL ROLE + request.jwt.claims.
# 단계: ① 적용 전(운영 현재 상태 재현) ② 마이그레이션 적용 ③ 재실행(멱등) ④ 롤백 2줄 ⑤ 다시 적용
# 판정: 기대값은 "적용 전" 과 "적용 후" 를 각각 따로 적어 두고 실제 결과와 대조한다.
#       authenticated 4종(일반·notice·super·다른 역할)은 적용 전·후 결과가 같아야 하고, anon 만 달라져야 한다.
import json, os, subprocess, sys
PORT = os.environ.get("PGPORT", "5544")
HERE = os.path.dirname(os.path.abspath(__file__))
STUB = os.path.join(HERE, "LOCAL_ONLY__00_stub_prod.sql")
MIG  = os.path.join(HERE, "..", "20261018_announcements_authenticated_only.sql")
DB = "sim_announcements"
U = {"user": "aaaaaaaa-0000-4000-8000-000000000001", "notice": "aaaaaaaa-0000-4000-8000-000000000002",
     "super": "aaaaaaaa-0000-4000-8000-000000000003", "book": "aaaaaaaa-0000-4000-8000-000000000004"}

def psql(db, sql, user="postgres", stop=True):
    # -q: 명령 태그(BEGIN · INSERT 0 1 등)를 출력하지 않는다 — 결과 행만 비교하기 위함
    p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", user, "-d", db, "-X", "-q", "-At", "-v", f"ON_ERROR_STOP={1 if stop else 0}", "-f", "-"],
                       input=sql, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def as_client(who, stmt):
    """PostgREST 방식 1요청 = 1트랜잭션(항상 ROLLBACK — 다음 케이스에 영향 없음). 반환: 'OK <결과>' 또는 'ERR <sqlstate 메시지>'"""
    role = "anon" if who == "anon" else "authenticated"
    claims = {"role": "anon"} if who == "anon" else {"sub": U[who], "role": "authenticated", "email": f"{who}@cnrres.com"}
    sql = f"""\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE {role};
SELECT set_config('request.jwt.claims', '{json.dumps(claims)}', true) \\gset _x
{stmt}
ROLLBACK;
"""
    rc, out, err = psql(DB, sql, "authenticator", stop=True)
    if rc != 0:
        line = next((l for l in err.splitlines() if "ERROR" in l), err)
        return "ERR " + line.split("ERROR:", 1)[-1].strip()
    return "OK " + " ".join(out.splitlines())

SEL_COUNT = "SELECT count(*) FROM public.announcements;"
SEL_BANNER = "SELECT coalesce((SELECT message FROM public.announcements WHERE is_active = true ORDER BY starts_at DESC, created_at DESC LIMIT 1), '(없음)');"   # api.ts loadActiveAnnouncement 와 같은 조건·정렬
INS = "INSERT INTO public.announcements (message, starts_at, ends_at) VALUES ('x', now(), now() + interval '1 day') RETURNING 'inserted';"
UPD = "WITH u AS (UPDATE public.announcements SET message = message || '!' RETURNING 1) SELECT count(*) FROM u;"
DEL = "WITH d AS (DELETE FROM public.announcements RETURNING 1) SELECT count(*) FROM d;"

E_FN  = "ERR 42501: permission denied for function has_admin_role"
E_RLS = 'ERR 42501: new row violates row-level security policy for table "announcements"'
# (누가, 무엇을, 적용 전 기대, 적용 후 기대)
CASES = [
    ("anon",   "조회(건수)",  SEL_COUNT,  E_FN,          "OK 0"),
    ("anon",   "헤더 공지",   SEL_BANNER, E_FN,          "OK (없음)"),
    ("anon",   "등록",        INS,        E_FN,          E_RLS),
    ("anon",   "수정",        UPD,        E_FN,          "OK 0"),
    ("anon",   "삭제",        DEL,        E_FN,          "OK 0"),
    ("user",   "조회(건수)",  SEL_COUNT,  "OK 1",        "OK 1"),            # 게시 중 1건만
    ("user",   "헤더 공지",   SEL_BANNER, "OK 시뮬-게시중", "OK 시뮬-게시중"),
    ("user",   "등록",        INS,        E_RLS,         E_RLS),
    ("user",   "수정",        UPD,        "OK 0",        "OK 0"),
    ("user",   "삭제",        DEL,        "OK 0",        "OK 0"),
    ("book",   "조회(건수)",  SEL_COUNT,  "OK 1",        "OK 1"),            # notice 역할이 없으면 일반 사용자와 같다
    ("book",   "등록",        INS,        E_RLS,         E_RLS),
    ("notice", "조회(건수)",  SEL_COUNT,  "OK 11",       "OK 11"),           # 관리자 = 전체
    ("notice", "등록",        INS,        "OK inserted", "OK inserted"),
    ("notice", "수정",        UPD,        "OK 11",       "OK 11"),
    ("notice", "삭제",        DEL,        "OK 11",       "OK 11"),
    ("super",  "조회(건수)",  SEL_COUNT,  "OK 11",       "OK 11"),
    ("super",  "등록",        INS,        "OK inserted", "OK inserted"),
    ("super",  "수정",        UPD,        "OK 11",       "OK 11"),
    ("super",  "삭제",        DEL,        "OK 11",       "OK 11"),
]

def run_phase(name, col):
    ok = 0; bad = []
    for who, what, stmt, before, after in CASES:
        got = as_client(who, stmt); want = (before, after)[col]
        if got == want: ok += 1
        else: bad.append(f"    FAIL {who:6} {what}: 기대 [{want}] / 실제 [{got}]")
    print(f"  {name}: {ok}/{len(CASES)} 일치"); [print(b) for b in bad]
    return not bad

def roles():
    return psql(DB, "SELECT string_agg(policyname || '=' || roles::text, ' ' ORDER BY policyname) FROM pg_policies WHERE tablename='announcements';")[1]

def main():
    psql("postgres", f"DROP DATABASE IF EXISTS {DB};"); psql("postgres", "DROP DATABASE IF EXISTS sim_announcements_19;")   # 롤은 클러스터 공용 — 다른 시뮬 DB 가 남아 있으면 DROP ROLE 이 실패한다
    psql("postgres", "DROP ROLE IF EXISTS authenticator; DROP ROLE IF EXISTS anon; DROP ROLE IF EXISTS authenticated; DROP ROLE IF EXISTS service_role;", stop=False)
    rc, out, err = psql("postgres", f"CREATE DATABASE {DB};"); assert rc == 0, err
    rc, out, err = psql(DB, open(STUB, encoding="utf-8").read()); assert rc == 0, "스텁 실패: " + err
    mig = open(MIG, encoding="utf-8").read()
    results = []
    print("① 적용 전 (운영 현재 상태 재현)", roles()); results.append(run_phase("적용 전", 0))
    rc, out, err = psql(DB, mig); assert rc == 0, "마이그레이션 실패: " + err
    print("② 적용", roles()); results.append(run_phase("적용 후", 1))
    rc, out, err = psql(DB, mig); assert rc == 0, "재실행 실패: " + err
    print("③ 재실행(멱등)", roles()); results.append(run_phase("재실행 후", 1))
    rb = "\n".join(l[3:] for l in mig.splitlines() if l.startswith("-- ALTER POLICY"))
    assert rb.count("ALTER POLICY") == 2, "롤백 2줄을 찾지 못함"
    rc, out, err = psql(DB, rb); assert rc == 0, "롤백 실패: " + err
    print("④ 롤백", roles()); results.append(run_phase("롤백 후(= 적용 전)", 0))
    rc, out, err = psql(DB, mig); assert rc == 0, err
    print("⑤ 다시 적용", roles()); results.append(run_phase("다시 적용 후", 1))
    same = [c for c in CASES if c[0] != "anon" and c[3] != c[4]]
    print(f"로그인 사용자 케이스 중 적용 전·후 기대가 다른 것: {len(same)}건 (0 이어야 함)")
    print("결과:", "전부 일치" if all(results) and not same else "불일치 있음")
    sys.exit(0 if all(results) and not same else 1)

if __name__ == "__main__":
    main()
