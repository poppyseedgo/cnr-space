#!/usr/bin/env python3
# ⚠ LOCAL_ONLY — 20261019_announcement_read_functions.sql 시뮬 (로컬 PG16, 운영과 무관)
#
#   준비:  initdb -D /tmp/pgsim -A trust -U postgres && pg_ctl -D /tmp/pgsim -o "-p 5544" -w start
#   실행:  python3 LOCAL_ONLY__run_sim_20261019.py
#
# PostgREST 와 같은 방식: authenticator 접속 → 트랜잭션 안에서 SET LOCAL ROLE + request.jwt.claims (요청마다 ROLLBACK).
# 시작 상태 = 운영 현재(스텁 + 20261018 적용). 데이터 2벌로 각각 5단계를 돈다.
#   D1 운영 그대로   : 공지 8건 전부 종료 (지금 게시 중 0건)
#   D2 판정 경계 포함 : D1 + 게시중A / 게시중B(더 최근 시작) / 방금종료(1초 전) / 게시예정 / 비활성
# 단계: ① 적용 전 ② 적용 ③ 재실행(멱등) ④ 롤백(함수 삭제) ⑤ 다시 적용
# 케이스 두 종류:
#   · 이전 프론트 쿼리(테이블 직접 조회) — 적용 전·후 결과가 같아야 한다 (열려 있던 탭 회귀 없음)
#   · 새 프론트 쿼리(RPC)               — 적용 전에는 함수가 없고, 적용 후 기대값과 일치해야 한다
import json, os, subprocess, sys
PORT = os.environ.get("PGPORT", "5544")
HERE = os.path.dirname(os.path.abspath(__file__))
STUB = os.path.join(HERE, "LOCAL_ONLY__00_stub_prod.sql")
MIG18 = os.path.join(HERE, "..", "20261018_announcements_authenticated_only.sql")
MIG19 = os.path.join(HERE, "..", "20261019_announcement_read_functions.sql")
DB = "sim_announcements_19"
U = {"user": "aaaaaaaa-0000-4000-8000-000000000001", "notice": "aaaaaaaa-0000-4000-8000-000000000002",
     "super": "aaaaaaaa-0000-4000-8000-000000000003", "book": "aaaaaaaa-0000-4000-8000-000000000004"}

def psql(db, sql, user="postgres", stop=True):
    p = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PORT, "-U", user, "-d", db, "-X", "-q", "-At", "-v", f"ON_ERROR_STOP={1 if stop else 0}", "-f", "-"],
                       input=sql, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def as_client(who, stmt):
    role = "anon" if who == "anon" else "authenticated"
    claims = {"role": "anon"} if who == "anon" else {"sub": U[who], "role": "authenticated", "email": f"{who}@cnrres.com"}
    sql = f"""\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE {role};
SELECT set_config('request.jwt.claims', '{json.dumps(claims)}', true) \\gset _x
{stmt}
ROLLBACK;
"""
    rc, out, err = psql(DB, sql, "authenticator")
    if rc != 0:
        line = next((l for l in err.splitlines() if "ERROR" in l), err)
        return "ERR " + line.split("ERROR:", 1)[-1].strip()
    return "OK " + " ".join(out.splitlines())

# ── 이전 프론트(운영 main 16f6038 ~ 838263e)가 보내는 쿼리 ──
OLD_BANNER  = "SELECT coalesce((SELECT message FROM public.announcements WHERE is_active = true ORDER BY starts_at DESC, created_at DESC LIMIT 1), '(없음)');"   # api.ts loadActiveAnnouncement
OLD_HISTORY = "SELECT count(*) FROM public.announcements WHERE starts_at >= now() - interval '183 days';"                                                     # AnnouncementsPage
# ── 새 프론트가 보내는 쿼리 ──
NEW_BANNER  = "SELECT coalesce((SELECT message FROM public.get_active_announcement()), '(없음)');"
NEW_BANNER_N = "SELECT count(*) FROM public.get_active_announcement();"
NEW_HISTORY = "SELECT count(*) FROM public.get_announcement_history() WHERE starts_at >= now() - interval '183 days';"
NEW_HISTORY_SIM = "SELECT coalesce(string_agg(message, ',' ORDER BY starts_at), '(없음)') FROM public.get_announcement_history() WHERE message LIKE '시뮬-%';"   # 무엇이 섞여 나오는지(예약·비활성 누출 확인)

E_NOFN_A = "ERR 42883: function public.get_active_announcement() does not exist"
E_NOFN_H = "ERR 42883: function public.get_announcement_history() does not exist"
E_DENY_A = "ERR 42501: permission denied for function get_active_announcement"
E_DENY_H = "ERR 42501: permission denied for function get_announcement_history"
E_TBL    = None   # anon 의 테이블 직접 조회: 20261018 적용 상태라 0행

D1 = ""   # 운영 8행 그대로
D2 = """INSERT INTO public.announcements (is_active, starts_at, ends_at, message) VALUES
  ('t', now() - interval '3 days',     now() + interval '1 day',    '시뮬-게시중A'),
  ('t', now() - interval '1 hour',     now() + interval '1 day',    '시뮬-게시중B'),
  ('t', now() - interval '30 minutes', now() - interval '1 second', '시뮬-방금종료'),
  ('t', now() + interval '1 day',      now() + interval '2 days',   '시뮬-게시예정'),
  ('f', now() - interval '10 minutes', now() + interval '1 day',    '시뮬-비활성');"""

AUTH = ["user", "book", "notice", "super"]
def cases(ds):
    c = []   # (누가, 무엇을, 쿼리, 적용 전 기대, 적용 후 기대)
    if ds == "D1":
        # 이전 프론트 — 적용 전·후 동일
        c += [("anon", "이전 배너", OLD_BANNER, "OK (없음)", "OK (없음)"), ("anon", "이전 이력", OLD_HISTORY, "OK 0", "OK 0")]
        c += [(w, "이전 배너", OLD_BANNER, "OK (없음)", "OK (없음)") for w in ("user", "book")]
        c += [(w, "이전 배너", OLD_BANNER, "OK 운영8", "OK 운영8") for w in ("notice", "super")]          # 문제 ②: 관리자에게 종료 공지
        c += [(w, "이전 이력", OLD_HISTORY, "OK 0", "OK 0") for w in ("user", "book")]                    # 문제 ①: 일반 직원 0건
        c += [(w, "이전 이력", OLD_HISTORY, "OK 8", "OK 8") for w in ("notice", "super")]
        # 새 프론트
        c += [("anon", "새 배너", NEW_BANNER, E_NOFN_A, E_DENY_A), ("anon", "새 이력", NEW_HISTORY, E_NOFN_H, E_DENY_H)]
        c += [(w, "새 배너", NEW_BANNER, E_NOFN_A, "OK (없음)") for w in AUTH]                            # 지금 게시 중 0건 → 관리자도 배너 없음
        c += [(w, "새 이력", NEW_HISTORY, E_NOFN_H, "OK 8") for w in AUTH]                                # 전 직원 8건
    else:
        c += [("anon", "이전 배너", OLD_BANNER, "OK (없음)", "OK (없음)"), ("anon", "이전 이력", OLD_HISTORY, "OK 0", "OK 0")]
        c += [(w, "이전 배너", OLD_BANNER, "OK 시뮬-게시중B", "OK 시뮬-게시중B") for w in ("user", "book")]
        c += [(w, "이전 배너", OLD_BANNER, "OK 시뮬-게시예정", "OK 시뮬-게시예정") for w in ("notice", "super")]   # 문제 ②: 관리자에게 게시 전 공지
        c += [(w, "이전 이력", OLD_HISTORY, "OK 2", "OK 2") for w in ("user", "book")]                    # 게시 중 2건만
        c += [(w, "이전 이력", OLD_HISTORY, "OK 13", "OK 13") for w in ("notice", "super")]               # 예약·비활성까지 전부
        c += [("anon", "새 배너", NEW_BANNER, E_NOFN_A, E_DENY_A), ("anon", "새 이력", NEW_HISTORY, E_NOFN_H, E_DENY_H)]
        c += [(w, "새 배너", NEW_BANNER, E_NOFN_A, "OK 시뮬-게시중B") for w in AUTH]                      # 게시 중 2건 중 최근 시작 — 권한과 무관하게 같은 1건
        c += [(w, "새 배너 행수", NEW_BANNER_N, E_NOFN_A, "OK 1") for w in AUTH]
        c += [(w, "새 이력", NEW_HISTORY, E_NOFN_H, "OK 11") for w in AUTH]                               # 8 + 게시중A·B + 방금종료
        c += [(w, "새 이력 구성", NEW_HISTORY_SIM, E_NOFN_H, "OK 시뮬-게시중A,시뮬-게시중B,시뮬-방금종료") for w in AUTH]   # 예약·비활성 누출 없음
    return c

def run_phase(name, cs, col):
    ok = 0; bad = []
    for who, what, stmt, before, after in cs:
        got = as_client(who, stmt); want = (before, after)[col]
        if got == want: ok += 1
        else: bad.append(f"    FAIL {who:6} {what}: 기대 [{want}] / 실제 [{got}]")
    print(f"  {name}: {ok}/{len(cs)} 일치"); [print(b) for b in bad]
    return not bad

def setup(extra):
    psql("postgres", f"DROP DATABASE IF EXISTS {DB};"); psql("postgres", "DROP DATABASE IF EXISTS sim_announcements;")   # 롤은 클러스터 공용 — 다른 시뮬 DB 가 남아 있으면 DROP ROLE 이 실패한다
    psql("postgres", "DROP ROLE IF EXISTS authenticator; DROP ROLE IF EXISTS anon; DROP ROLE IF EXISTS authenticated; DROP ROLE IF EXISTS service_role;", stop=False)
    rc, out, err = psql("postgres", f"CREATE DATABASE {DB};"); assert rc == 0, err
    rc, out, err = psql(DB, open(STUB, encoding="utf-8").read()); assert rc == 0, "스텁 실패: " + err
    rc, out, err = psql(DB, "DELETE FROM public.announcements WHERE message LIKE '시뮬-%';" + extra); assert rc == 0, err     # 스텁의 20261018용 3행 제거 → 운영 8행
    rc, out, err = psql(DB, open(MIG18, encoding="utf-8").read()); assert rc == 0, "20261018 실패: " + err                   # 운영 현재 상태

def main():
    mig = open(MIG19, encoding="utf-8").read()
    rb = "\n".join(l[3:] for l in mig.splitlines() if l.startswith("-- DROP FUNCTION"))
    assert rb.count("DROP FUNCTION") == 2, "롤백 2줄을 찾지 못함"
    allok = True
    for ds, extra in (("D1", D1), ("D2", D2)):
        setup(extra); cs = cases(ds)
        print(f"[{ds}] {'운영 그대로 (8건 전부 종료)' if ds == 'D1' else '판정 경계 포함 (13건)'}")
        allok &= run_phase("① 적용 전", cs, 0)
        rc, out, err = psql(DB, mig); assert rc == 0, "마이그레이션 실패: " + err
        allok &= run_phase("② 적용 후", cs, 1)
        rc, out, err = psql(DB, mig); assert rc == 0, "재실행 실패: " + err
        allok &= run_phase("③ 재실행 후", cs, 1)
        rc, out, err = psql(DB, rb); assert rc == 0, "롤백 실패: " + err
        allok &= run_phase("④ 롤백 후(= 적용 전)", cs, 0)
        rc, out, err = psql(DB, mig); assert rc == 0, err
        allok &= run_phase("⑤ 다시 적용 후", cs, 1)
        old_changed = [x for x in cs if x[1].startswith("이전") and x[3] != x[4]]
        print(f"  이전 프론트 쿼리 중 적용 전·후 기대가 다른 것: {len(old_changed)}건 (0 이어야 함)"); allok &= not old_changed
        pol = psql(DB, "SELECT string_agg(policyname || '=' || roles::text || ' ' || md5(coalesce(qual,'') || coalesce(with_check,'')), ' | ' ORDER BY policyname) FROM pg_policies WHERE tablename='announcements';")[1]
        print("  테이블 정책(변경 없음 확인):", pol)
    print("결과:", "전부 일치" if allok else "불일치 있음")
    sys.exit(0 if allok else 1)

if __name__ == "__main__":
    main()
