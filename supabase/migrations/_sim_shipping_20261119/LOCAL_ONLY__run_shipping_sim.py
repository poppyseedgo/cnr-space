#!/usr/bin/env python3
# ⚠ LOCAL_ONLY — 로컬 PG 시뮬 전용. 운영 실행 금지.
# 사용: python3 LOCAL_ONLY__run_shipping_sim.py  (로컬 PG: -h /tmp/pgsim -p 55432, DB simship 에 스텁+20261023+20261024 적용 후)
import subprocess, json, sys, datetime, concurrent.futures as cf
PSQL = ["psql", "-h", "/tmp/pgsim", "-p", "55432", "-U", "postgres", "-d", "simship", "-At", "-v", "ON_ERROR_STOP=1", "-q"]
A, B, GA, SUPER, NOSABUN = [f"00000000-0000-0000-0000-00000000000{c}" for c in "abcde"]
results = []

def run(sql, uid=None, role="authenticated"):
    pre = ""
    if role:
        claims = json.dumps({"sub": uid} if uid else {})
        pre = f"SET ROLE {role}; SELECT set_config('request.jwt.claims', '{claims}', false) \\gset x_\n"
    p = subprocess.run(PSQL, input=pre + sql, capture_output=True, text=True)
    out = p.stdout.strip()
    err = p.stderr.strip()
    return (p.returncode == 0, out if p.returncode == 0 else err)

def check(name, got, want):
    ok = (want(got) if callable(want) else got == want)
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "→", got if len(str(got)) < 160 else str(got)[:160] + "…")

def payload(**over):
    p = dict(project_no="24-046", billable=True, item_type="parcel", requested_on="", direction="send", unit="document",
             quantity="1", contents="서류", tracking_no="", region="seoul", note="",
             sender_company="씨엔알리서치(본사)", sender_name="김발신", sender_phone="010-0000-0001",
             sender_addr1="서울특별시 강남구 역삼로 412", sender_addr2="",
             receiver_company="예시병원", receiver_name="이수신", receiver_phone="02-000-0002",
             receiver_addr1="서울시 예시구 예시길 2", receiver_addr2="101호")
    p.update(over)
    for k in [k for k, v in p.items() if v is None]: del p[k]
    return json.dumps(p, ensure_ascii=False).replace("'", "''")

def create(uid, **over):
    return run(f"SELECT shipping_no FROM shipping_create('{payload(**over)}'::jsonb);", uid)

def errcode(res):  # 예외 메시지에서 코드만
    ok, out = res
    if ok: return "OK:" + out
    for line in out.splitlines():
        if "ERROR:" in line: return line.split("ERROR:")[1].strip()
    return out

kst = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).strftime("%Y%m%d")
kst_d = kst[:4] + "-" + kst[4:6] + "-" + kst[6:]

print("== N1 번호 발급: 항목별·등록일별 001부터")
check("N1-1 A 택배 첫 건", create(A)[1], f"택배-{kst}-001")
check("N1-2 B 택배 둘째", create(B)[1], f"택배-{kst}-002")
check("N1-3 A 퀵 첫 건", create(A, item_type="quick")[1], f"퀵-{kst}-001")
check("N1-4 A 우편 첫 건", create(A, item_type="post")[1], f"우편-{kst}-001")
check("N1-5 등록일=KST 오늘, 신청일자 공란→오늘", run(f"SELECT issued_on||'|'||requested_on FROM shipping_records WHERE shipping_no='택배-{kst}-001'", A)[1], f"{kst_d}|{kst_d}")
check("N1-6 신청일자 지정(등록일과 다름)", run(f"SELECT shipping_no||'|'||requested_on FROM shipping_create('{payload(requested_on='2026-12-01')}'::jsonb)", A)[1], f"택배-{kst}-003|2026-12-01")

print("== N2 삭제한 번호는 다시 쓰지 않는다")
rid3 = run(f"SELECT id FROM shipping_records WHERE shipping_no='택배-{kst}-003'", A)[1]
check("N2-1 A 가 003 삭제", errcode(run(f"SELECT shipping_delete('{rid3}')", A)), "OK:" + rid3)
check("N2-2 삭제 후 새 등록 = 004", create(A)[1], f"택배-{kst}-004")
check("N2-3 삭제 건은 본인 목록에서 사라짐", run(f"SELECT count(*) FROM shipping_records WHERE shipping_no='택배-{kst}-003'", A)[1], "0")
check("N2-4 행은 보존(postgres 직접 조회)", run(f"SELECT (deleted_at IS NOT NULL)::text||'|'||(deleted_by='{A}')::text FROM shipping_records WHERE shipping_no='택배-{kst}-003'", role=None)[1], "true|true")
check("N2-5 이미 삭제한 건 재삭제", errcode(run(f"SELECT shipping_delete('{rid3}')", A)), "NOT_FOUND")

print("== N3 필수·형식 검증 (실패 시 번호를 소모하지 않는다)")
before = run("SELECT last_seq FROM shipping_no_counters WHERE item_type='parcel'", role=None)[1]
for k in ["project_no", "sender_name", "sender_phone", "receiver_name", "receiver_phone", "item_type", "direction", "region", "quantity"]:
    check(f"N3 {k} 공란", errcode(create(A, **{k: ""})), f"REQUIRED:{k}")
check("N3 청구여부 미선택", errcode(create(A, billable=None)), "REQUIRED:billable")
check("N3 청구여부 문자열", errcode(create(A, billable="Y")), "REQUIRED:billable")
check("N3 수량 문자", errcode(create(A, quantity="두개")), "INVALID:quantity")
check("N3 수량 0", errcode(create(A, quantity="0")), "INVALID:quantity")
check("N3 수량 소수", errcode(create(A, quantity="1.5")), "INVALID:quantity")
check("N3 항목 엉뚱한 값", errcode(create(A, item_type="bike")), "INVALID:item_type")
check("N3 지역 엉뚱한 값", errcode(create(A, region="busan")), "INVALID:region")
check("N3 단위 엉뚱한 값", errcode(create(A, unit="pallet")), "INVALID:unit")
check("N3 신청일자 형식", errcode(create(A, requested_on="2026/11/23")), "INVALID:requested_on")
check("N3 신청일자 없는 날짜", errcode(create(A, requested_on="2026-02-30")), "INVALID:requested_on")
check("N3 단위 공란 허용", create(A, unit="")[0], True)
after = run("SELECT last_seq FROM shipping_no_counters WHERE item_type='parcel'", role=None)[1]
check("N3 실패 20건은 순번 미소모(성공 1건만 +1)", f"{before}->{after}", f"{before}->{int(before)+1}")

print("== N4 등록자 정보는 서버가 profiles 에서 채운다")
check("N4-1 이름·사번·메일 스냅샷", run(f"SELECT user_name||'|'||employee_no||'|'||user_email FROM shipping_records WHERE shipping_no='택배-{kst}-002'", B)[1], "시뮬B_Sim B_DM|20990002|b@sim.local")
check("N4-2 payload 로 등록자 위조 불가", run(f"SELECT user_name||'|'||employee_no||'|'||(user_id='{A}')::text FROM shipping_create('{payload(user_name='위조', employee_no='11111111', user_id=SUPER)}'::jsonb)", A)[1], "시뮬A|20990001|true")
check("N4-3 사번 없는 직원도 등록(사번 빈칸)", run(f"SELECT user_name||'|['||employee_no||']' FROM shipping_create('{payload()}'::jsonb)", NOSABUN)[1], "시뮬사번없음|[]")

print("== N5 조회 권한 (RLS)")
total = run("SELECT count(*) FROM shipping_records WHERE deleted_at IS NULL", role=None)[1]
mineA = run(f"SELECT count(*) FROM shipping_records WHERE deleted_at IS NULL AND user_id='{A}'", role=None)[1]
check("N5-1 A 는 본인 건만", run("SELECT count(*) FROM shipping_records", A)[1], mineA)
check("N5-2 A 는 B 건을 못 본다", run(f"SELECT count(*) FROM shipping_records WHERE user_id='{B}'", A)[1], "0")
check("N5-3 GA(역할 없음)는 본인 건 0", run("SELECT count(*) FROM shipping_records", GA)[1], "0")
check("N5-4 super 가 GA 에게 shipping 부여", run(f"SELECT admin_set_user_roles('{GA}', ARRAY['shipping'])", SUPER)[1], "{shipping}")
check("N5-5 GA(shipping) 전체 조회", run("SELECT count(*) FROM shipping_records WHERE deleted_at IS NULL", GA)[1], total)
check("N5-6 super 전체 조회", run("SELECT count(*) FROM shipping_records WHERE deleted_at IS NULL", SUPER)[1], total)
check("N5-7 비로그인(anon) 조회 거부", errcode(run("SELECT count(*) FROM shipping_records", None, "anon")), lambda s: "permission denied" in s)
check("N5-8 로그인 사용자도 순번표는 못 읽는다", errcode(run("SELECT count(*) FROM shipping_no_counters", A)), lambda s: "permission denied" in s)

print("== N6 직접 쓰기 차단 (RPC 만 허용)")
check("N6-1 직접 INSERT", errcode(run("INSERT INTO shipping_records (shipping_no,item_type,issued_on,seq,user_name,project_no,billable,requested_on,direction,quantity,region,sender_name,sender_phone,receiver_name,receiver_phone) VALUES ('택배-29990101-001','parcel','2999-01-01',1,'x','x',true,'2999-01-01','send',1,'seoul','x','x','x','x')", A)), lambda s: "permission denied" in s)
check("N6-2 직접 UPDATE", errcode(run("UPDATE shipping_records SET quantity=99", A)), lambda s: "permission denied" in s)
check("N6-3 직접 DELETE", errcode(run("DELETE FROM shipping_records", A)), lambda s: "permission denied" in s)
check("N6-4 GA(shipping)도 직접 UPDATE 불가", errcode(run("UPDATE shipping_records SET quantity=99", GA)), lambda s: "permission denied" in s)
check("N6-5 순번표 직접 조작 불가", errcode(run("UPDATE shipping_no_counters SET last_seq=0", A)), lambda s: "permission denied" in s)
check("N6-6 내부 함수 직접 호출 불가", errcode(run(f"SELECT (shipping_fill('{payload()}'::jsonb)).project_no", A)), lambda s: "permission denied" in s)
check("N6-7 anon RPC 호출 불가", errcode(run(f"SELECT shipping_create('{payload()}'::jsonb)", None, "anon")), lambda s: "permission denied" in s)
check("N6-8 sub 없는 세션은 NOT_AUTHENTICATED", errcode(run(f"SELECT shipping_create('{payload()}'::jsonb)", None)), "NOT_AUTHENTICATED")

print("== N7 수정: 본인 · 당일 · 항목 잠금")
rid1 = run(f"SELECT id FROM shipping_records WHERE shipping_no='택배-{kst}-001'", A)[1]
check("N7-1 본인 당일 수정", run(f"SELECT shipping_no||'|'||quantity||'|'||receiver_name||'|'||unit FROM shipping_update('{rid1}', '{payload(quantity='5', receiver_name='박변경', unit='box')}'::jsonb)", A)[1], f"택배-{kst}-001|5|박변경|box")
check("N7-2 항목 변경 시도", errcode(run(f"SELECT shipping_update('{rid1}', '{payload(item_type='quick')}'::jsonb)", A)), "ITEM_TYPE_LOCKED")
check("N7-3 타인 건 수정", errcode(run(f"SELECT shipping_update('{rid1}', '{payload()}'::jsonb)", B)), "NOT_OWNER")
check("N7-4 타인 건 삭제", errcode(run(f"SELECT shipping_delete('{rid1}')", B)), "NOT_OWNER")
check("N7-5 GA(shipping)도 타인 건 수정 불가", errcode(run(f"SELECT shipping_update('{rid1}', '{payload()}'::jsonb)", GA)), "NOT_OWNER")
check("N7-6 수정 시 필수 검증 동일", errcode(run(f"SELECT shipping_update('{rid1}', '{payload(region='')}'::jsonb)", A)), "REQUIRED:region")
check("N7-7 없는 id", errcode(run(f"SELECT shipping_update('00000000-0000-0000-0000-0000000000ff', '{payload()}'::jsonb)", A)), "NOT_FOUND")
run(f"UPDATE shipping_records SET issued_on = issued_on - 1 WHERE id='{rid1}'", role=None)   # 어제 등록한 건으로 만든다
check("N7-8 다음 날 수정", errcode(run(f"SELECT shipping_update('{rid1}', '{payload()}'::jsonb)", A)), "EDIT_WINDOW_CLOSED")
check("N7-9 다음 날 삭제", errcode(run(f"SELECT shipping_delete('{rid1}')", A)), "EDIT_WINDOW_CLOSED")
check("N7-10 수정 실패는 값을 바꾸지 않는다", run(f"SELECT quantity||'|'||receiver_name FROM shipping_records WHERE id='{rid1}'", A)[1], "5|박변경")
run(f"UPDATE shipping_records SET issued_on = issued_on + 1 WHERE id='{rid1}'", role=None)

print("== N8 admin_set_user_roles 재계산 (shipping 은 ADMIN 을 만들지 않는다)")
def role_of(u): return run(f"SELECT role FROM profiles WHERE id='{u}'", role=None)[1]
check("N8-1 shipping 만 → USER", role_of(GA), "USER")
run(f"SELECT admin_set_user_roles('{GA}', ARRAY['shipping','workboard'])", SUPER); check("N8-2 shipping+workboard → USER", role_of(GA), "USER")
run(f"SELECT admin_set_user_roles('{GA}', ARRAY['workboard'])", SUPER); check("N8-3 workboard 만 → USER (기존 동작)", role_of(GA), "USER")
run(f"SELECT admin_set_user_roles('{GA}', ARRAY['shipping','book'])", SUPER); check("N8-4 shipping+book → ADMIN", role_of(GA), "ADMIN")
run(f"SELECT admin_set_user_roles('{GA}', ARRAY['book'])", SUPER); check("N8-5 book 만 → ADMIN (기존 동작)", role_of(GA), "ADMIN")
run(f"SELECT admin_set_user_roles('{GA}', ARRAY[]::text[])", SUPER); check("N8-6 역할 0개 → USER (기존 동작)", role_of(GA), "USER")
check("N8-7 비 super 호출 거부 (기존 동작)", errcode(run(f"SELECT admin_set_user_roles('{GA}', ARRAY['shipping'])", A)), "NOT_SUPER")
check("N8-8 본인 super 회수 금지 (기존 동작)", errcode(run(f"SELECT admin_set_user_roles('{SUPER}', ARRAY['shipping'])", SUPER)), "CANNOT_REVOKE_OWN_SUPER")
check("N8-9 감사 로그 기록 (기존 동작)", run(f"SELECT string_agg(action||':'||role, ',' ORDER BY created_at, role) FROM admin_role_grants WHERE target_user='{GA}' AND role='shipping'", role=None)[1], lambda s: s.startswith("grant:shipping") and "revoke:shipping" in s)
check("N8-10 CHECK 기존 허용값 보존 + shipping", run("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='admin_roles_role_check'", role=None)[1], lambda s: all(f"'{r}'" in s for r in "org workboard dashboard booking approval room user visitor book notification notice resource super kb zoom meeting_room shipping".split()))
check("N8-11 없는 역할은 여전히 거부", errcode(run(f"SELECT admin_set_user_roles('{GA}', ARRAY['nonsense'])", SUPER)), lambda s: "admin_roles_role_check" in s)
run(f"SELECT admin_set_user_roles('{GA}', ARRAY['shipping'])", SUPER)

print("== N9 동시 등록 40건 — 번호 중복·누락 없음")
before = int(run("SELECT last_seq FROM shipping_no_counters WHERE item_type='quick'", role=None)[1])
with cf.ThreadPoolExecutor(max_workers=20) as ex:
    outs = list(ex.map(lambda i: create(A if i % 2 else B, item_type="quick"), range(40)))
nos = sorted(o[1] for o in outs if o[0])
want = [f"퀵-{kst}-{n:03d}" for n in range(before + 1, before + 41)]
check("N9-1 40건 전부 성공", len(nos), 40)
check("N9-2 번호가 연속이고 중복 없음", nos == want, True)

print("== N10 퇴사(profiles DELETE) 후에도 기록 보존")
run(f"DELETE FROM profiles WHERE id='{B}'", role=None)
check("N10-1 B 건 보존 + user_id NULL + 이름·사번 스냅샷 유지", run("SELECT count(*)||'|'||count(user_id)||'|'||min(user_name)||'|'||min(employee_no) FROM shipping_records WHERE user_email='b@sim.local'", role=None)[1], lambda s: s.split("|")[1:] == ["0", "시뮬B_Sim B_DM", "20990002"] and int(s.split("|")[0]) > 0)
check("N10-2 GA 는 퇴사자 건도 조회", run("SELECT count(*) > 0 FROM shipping_records WHERE user_email='b@sim.local'", GA)[1], "t")

print("== N11 순번 1000 이상에서도 번호가 잘리지 않는다")
run("UPDATE shipping_no_counters SET last_seq = 999 WHERE item_type='post'", role=None)
check("N11-1 1000번째", create(A, item_type="post")[1], f"우편-{kst}-1000")

print("== Z 우편번호 (20261024) — 저장 전용 칸")
check("Z1 우편번호 없이 등록(이전 화면 호환) → 빈 값", run(f"SELECT '['||sender_zip||']['||receiver_zip||']' FROM shipping_create('{payload()}'::jsonb)", A)[1], "[][]")
check("Z2 우편번호 5자리 저장", run(f"SELECT sender_zip||'|'||receiver_zip FROM shipping_create('{payload(sender_zip='06236', receiver_zip='48733')}'::jsonb)", A)[1], "06236|48733")
check("Z3 한쪽만 있어도 저장", run(f"SELECT '['||sender_zip||']|'||receiver_zip FROM shipping_create('{payload(receiver_zip='13494')}'::jsonb)", A)[1], "[]|13494")
check("Z4 4자리 거부", errcode(create(A, receiver_zip='1234')), "INVALID:receiver_zip")
check("Z5 문자 섞임 거부", errcode(create(A, sender_zip='0623A')), "INVALID:sender_zip")
check("Z6 구 우편번호(6자리, 하이픈) 거부", errcode(create(A, receiver_zip='135-080')), "INVALID:receiver_zip")
ridz = run(f"SELECT id FROM shipping_records WHERE receiver_zip='48733'", A)[1]
check("Z7 수정으로 우편번호 변경·비우기", run(f"SELECT '['||sender_zip||']|'||receiver_zip FROM shipping_update('{ridz}', '{payload(sender_zip='', receiver_zip='04524')}'::jsonb)", A)[1], "[]|04524")
check("Z8 수정 시 형식 검사 동일", errcode(run(f"SELECT shipping_update('{ridz}', '{payload(receiver_zip='abcde')}'::jsonb)", A)), "INVALID:receiver_zip")
check("Z9 권한 그대로: 직접 UPDATE 로 우편번호 변경 불가", errcode(run("UPDATE shipping_records SET receiver_zip='00000'", A)), lambda s: "permission denied" in s)

print()
print(f"결과: {sum(results)}/{len(results)} PASS")
sys.exit(0 if all(results) else 1)
