"""
build_stage.py — 2026.10.01 조직도.xlsx 파싱 결과(orgchart_2026-10-01_parsed.json) → org_import_stage 적재 SQL 생성
  · 직무 토큰: 운영 org_jobs(code+aliases) 기준 최장 접두 매칭 (공백·대소문자 무시)
  · 이름: 직무 제거 후 남는 한글 2~4자 (+ 동명이인 구분 접미 A/B/C 는 hint 로 분리)
  · (0.5) → fte, flag 계약 → contract, 'Intern' 직무 → intern, 퇴사예정 flag → memo (날짜 없음 → 상태 미등록)
  · 단위장: "JOB 이름(직급)" / "이름(직급)" / "JOB 이름(겸)"  → is_head, rank, concurrent(겸)
"""
import json, re, sys
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'orgchart_2026-10-01_parsed.json'))   # 파서(parse_orgchart_xlsx.py) 산출 JSON

JOBS = [("CPO",[]),("CCO",[]),("CDO",[]),("DXM",[]),("HBO",[]),("HRA",[]),("CDIM",[]),("HBS",[]),("HCO",[]),("HCTM",[]),("MSM",[]),("CRM",[]),("DMPM",[]),("Mgr",[]),("CTMM",[]),("CDMM",[]),("COM",[]),("FNM",[]),("PMgr",[]),("BSPM",[]),("DMTM",[]),("MM",[]),("MPM",[]),("SPPM",[]),("BDM",[]),("RAM",[]),("SSUM",[]),("BSM",[]),("CSS Mgr",[]),("DSPM",[]),("ISS",[]),("MDM",[]),("PVM",[]),("PVPM",[]),("QMM",[]),("SAPM",[]),("SPM",[]),("SQA",[]),("BS Advisor",[]),("Principal SIS",[]),("Principal CRA",[]),("Sr.CRA",[]),("Sr.DMA",[]),("Sr.CDMA",[]),("Sr.BSI",["Sr.BS1","Sr.BSⅠ"]),("Sr.MW",[]),("Sr.PL",[]),("Sr.SP",[]),("Sr.SIS",["SR.SIS"]),("Sr.DMAII",["Sr.DMAⅡ"]),("Sr.BDA",[]),("Sr.CDMAII",["Sr.CDMAⅡ"]),("Sr.BS",[]),("Sr.BSII",["Sr.BSⅡ"]),("Sr.BSIII",["Sr.BSⅢ"]),("Sr.CSS",["Sr. CSS"]),("Sr.QMA",[]),("Sr.QML",[]),("Sr.SA",[]),("Sr.SE",[]),("CRAII",["CRA II","CRAⅡ"]),("PLII",["PLⅡ"]),("BDAII",[]),("BDAI",[]),("PLI",["PLⅠ"]),("PL",[]),("CRA",[]),("PCRA",[]),("DMA",[]),("CSS",[]),("RAA",[]),("SE",[]),("PVA",[]),("APD",[]),("SP",[]),("CDMA",[]),("FNA",[]),("MW",[]),("PVS",[]),("CMS",[]),("MMA",[]),("SIS",[]),("BMS",[]),("MSA",[]),("Remote PL",[]),("AXE",[]),("BDA",[]),("Biostat",[]),("DSS",[]),("GAA",[]),("QMA",[]),("RAS",[]),("BSDH",[]),("MA",[]),("MAA",[]),("QML",[]),("인턴",[]),("CRA Intern",[]),("PV Intern",[])]
norm = lambda s: re.sub(r'\s+', '', s).upper()
TOK = sorted([(norm(t), code) for code, al in JOBS for t in [code] + al], key=lambda x: -len(x[0]))
RANKS = {'사장':'president','부사장':'vice_president','전무':'evp','상무':'svp','이사':'director','실장':'office_head'}

def split(raw):
    """raw → (job_code|None, name, hint, fte, extras)"""
    s = raw.strip()
    fte = 1.0
    m = re.search(r'\((\d(?:\.\d+)?)\)', s)
    if m: fte = float(m.group(1)); s = s.replace(m.group(0), '').strip()
    loc = None
    m = re.search(r'\(([가-힣]{2,4})\)', s)
    if m: loc = m.group(1); s = s.replace(m.group(0), '').strip()
    ns = norm(s)
    job = None
    for t, code in TOK:
        if ns.startswith(t):
            # 접두 뒤가 한글(이름 시작)이어야 함 — 'PL' 이 'PLII' 를 먹지 않도록 최장 우선 + 경계 검사
            rest = ns[len(t):]
            if rest and re.match(r'^[가-힣]', rest): job = code; ns = rest; break
    name_m = re.match(r'^([가-힣]{2,4})([A-Z]?)$', ns)
    if not name_m: return job, s, '', fte, loc, 'VACANCY' if not re.search(r'[가-힣]', s) else f'UNPARSED:{raw}'
    return job, name_m.group(1), name_m.group(2), fte, loc, ''

units, cards = [], []
# 사람 박스가 단위로 잡힌 케이스: AL18 'SQA 김한나B' (DX 전략 아래, AX·EA 의 상위 박스) → 단위 제거, AX·EA 는 DX 전략(AL15) 직속, 본인은 DX 전략 카드
PERSON_BOX = {'AL18': 'AL15'}
for b in d['boxes']:
    if b['id'] in PERSON_BOX:
        d['members'].append({'row': b['r1'], 'col': '', 'raw': b['name'].strip(), 'unit': PERSON_BOX[b['id']], 'flag': None}); continue
    if b['parent'] in PERSON_BOX: b['parent'] = PERSON_BOX[b['parent']]
    name = b['name'].split('\n')[0].strip()
    units.append({'k': b['id'], 'parent': b['parent'], 'name': name, 'sort': (b['r1'], b['c1'])})
    if b['head']:
        h = b['head'].strip()
        rank = None; conc = False
        m = re.search(r'\((.*?)\)\s*$', h)
        if m:
            tag = m.group(1); h = h[:m.start()].strip()
            if tag == '겸': conc = True
            else: rank = RANKS.get(tag); assert rank, (b['id'], tag)
        job, nm, hint, fte, loc, err = split(h)
        cards.append({'u': b['id'], 'job': job, 'name': nm, 'hint': hint, 'fte': fte, 'loc': loc, 'head': True, 'conc': conc, 'rank': rank, 'flag': None, 'raw': b['head'], 'err': err})
for mbr in d['members']:
    job, nm, hint, fte, loc, err = split(mbr['raw'])
    cards.append({'u': mbr['unit'], 'job': job, 'name': nm, 'hint': hint, 'fte': fte, 'loc': loc, 'head': False, 'conc': False, 'rank': None, 'flag': mbr['flag'], 'raw': mbr['raw'], 'err': err})

# 단위 sort_order: 같은 부모 안에서 열(c1) 순
by_parent = {}
for u in units: by_parent.setdefault(u['parent'], []).append(u)
for sibs in by_parent.values():
    for i, u in enumerate(sorted(sibs, key=lambda x: x['sort'])): u['sort_order'] = i
print('units', len(units), 'cards', len(cards), 'heads', sum(c['head'] for c in cards), 'concurrent', sum(c['conc'] for c in cards), file=sys.stderr)
print('no-job', sum(1 for c in cards if not c['job']), 'unparsed', [c['raw'] for c in cards if c['err'] and c['err']!='VACANCY'], 'vacancy', [c['raw'] for c in cards if c['err']=='VACANCY'], 'loc', sum(1 for c in cards if c['loc']), file=sys.stderr)
print('hints', [(c['raw']) for c in cards if c['hint']], file=sys.stderr)
print('flags', {f: sum(1 for c in cards if c['flag']==f) for f in set(c['flag'] for c in cards)}, file=sys.stderr)

q = lambda s: "'" + str(s).replace("'", "''") + "'" if s is not None else 'NULL'
sql = ["CREATE UNLOGGED TABLE IF NOT EXISTS public.org_import_stage_units (k text PRIMARY KEY, parent_k text, name text NOT NULL, sort_order int NOT NULL);",
       "CREATE UNLOGGED TABLE IF NOT EXISTS public.org_import_stage_cards (n serial PRIMARY KEY, unit_k text NOT NULL, job_code text, name text NOT NULL, hint text, fte numeric NOT NULL DEFAULT 1, is_head boolean NOT NULL, concurrent boolean NOT NULL, rank_code text, flag text, raw text NOT NULL, work_location text, is_vacancy boolean NOT NULL DEFAULT false);",
       "TRUNCATE public.org_import_stage_units, public.org_import_stage_cards;",
       "INSERT INTO public.org_import_stage_units (k, parent_k, name, sort_order) VALUES\n" + ",\n".join(f"({q(u['k'])},{q(u['parent'])},{q(u['name'])},{u['sort_order']})" for u in units) + ";",
       "INSERT INTO public.org_import_stage_cards (unit_k, job_code, name, hint, fte, is_head, concurrent, rank_code, flag, raw, work_location, is_vacancy) VALUES\n" + ",\n".join(f"({q(c['u'])},{q(c['job'])},{q(c['name'])},{q(c['hint'] or None)},{c['fte']},{str(c['head']).lower()},{str(c['conc']).lower()},{q(c['rank'])},{q(c['flag'])},{q(c['raw'])},{q(c['loc'])},{str(c['err']=='VACANCY').lower()})" for c in cards) + ";"]
open('org_import_stage.sql', 'w').write("-- generated by build_stage.py — 2026.10.01 조직도.xlsx → stage\n" + "\n".join(sql) + "\n")
print('bytes', len(open('org_import_stage.sql').read().encode()), file=sys.stderr)
