import openpyxl, json, re, collections
from openpyxl.utils import get_column_letter as L
wb=openpyxl.load_workbook('orgchart.xlsx')
ws=wb['Org']
MAXR,MAXC=40,ws.max_column
merged={}
for rng in ws.merged_cells.ranges:
    for r in range(rng.min_row,rng.max_row+1):
        for c in range(rng.min_col,rng.max_col+1):
            merged[(r,c)]=(rng.min_row,rng.min_col,rng.max_row,rng.max_col)
def rng_of(r,c): return merged.get((r,c),(r,c,r,c))
def txt(r,c):
    v=ws.cell(r,c).value
    return None if v in (None,'') else str(v).strip()
def is_person(s): return bool(re.search(r'[가-힣]{2,4}',s)) and not re.search(r'본부|실$|팀$|Division|연구소|Support|Sciences|Programming|Advisor|Device|전략|Research|계약|퇴사예정|Part',s)
# boxes = text cells rows 3..22 (non numeric, not formula)
boxes=[]
seen=set()
for r in range(1,23):
    for c in range(1,MAXC+1):
        s=txt(r,c)
        if not s or re.fullmatch(r'[\d=].*',s): continue
        if (r,c) in seen or (c==2 and r in (4,5,6)): continue
        r1,c1,r2,c2=rng_of(r,c)
        name=s; head=None
        # head = text in row r2+1 within same columns
        hr=r2+1; hs=txt(hr,c1)
        if hs and is_person(hs) and not is_person(name):
            hr1,hc1,hr2,hc2=rng_of(hr,c1); head=hs; r2=hr2; c2=max(c2,hc2)
            for rr in range(hr1,hr2+1):
                for cc in range(hc1,hc2+1): seen.add((rr,cc))
        for rr in range(r1,r2+1):
            for cc in range(c1,c2+1): seen.add((rr,cc))
        boxes.append(dict(id=f'{L(c1)}{r1}',name=name,head=head,r1=r1,c1=c1,r2=r2,c2=c2,person_box=is_person(name) and head is None))
print('boxes',len(boxes))
boxcells={}
for b in boxes:
    for rr in range(b['r1'],b['r2']+1):
        for cc in range(b['c1'],b['c2']+1): boxcells[(rr,cc)]=b['id']
# segments: use node coords (x=col index line, y=row index line). bottom border of (r,c): H segment at y=r+1 from x=c..c+1 ; top: y=r ; left: V at x=c, y=r..r+1 ; right: x=c+1
H=set(); V=set()
for r in range(1,MAXR+1):
    for c in range(1,MAXC+1):
        b=ws.cell(r,c).border
        inbox=(r,c) in boxcells
        if b.bottom.style and not (inbox and ((r+1,c) not in boxcells or boxcells.get((r+1,c))!=boxcells[(r,c)])): H.add((r+1,c))
        elif b.bottom.style and not inbox: H.add((r+1,c))
        if b.top.style and not inbox: H.add((r,c))
        if b.left.style and not inbox: V.add((c,r))
        if b.right.style and not inbox: V.add((c+1,r))
# also borders inside boxes are box outlines -> excluded above. Build graph on nodes (x,y) grid points
adj=collections.defaultdict(set)
for (y,c) in H: adj[(c,y)].add((c+1,y)); adj[(c+1,y)].add((c,y))
for (x,r) in V: adj[(x,r)].add((x,r+1)); adj[(x,r+1)].add((x,r))
comp={}; cid=0
for n in list(adj):
    if n in comp: continue
    cid+=1; st=[n]; comp[n]=cid
    while st:
        u=st.pop()
        for w in adj[u]:
            if w not in comp: comp[w]=cid; st.append(w)
# box touch: parent if component has node on box bottom edge y=r2+1 with x in [c1,c2+1]; child if node on top edge y=r1
parents=collections.defaultdict(set); children=collections.defaultdict(set)
for b in boxes:
    for x in range(b['c1'],b['c2']+2):
        n=(x,b['r2']+1)
        if n in comp: parents[comp[n]].add(b['id'])
        n=(x,b['r1'])
        if n in comp: children[comp[n]].add(b['id'])
    for y in range(b['r1'],b['r2']+2):
        for x in (b['c1'],b['c2']+1):
            n=(x,y)
            if n in comp and y!=b['r1']: parents[comp[n]].add(b['id'])
byid={b['id']:b for b in boxes}
for b in boxes: b['parent']=None
amb=[]
for cidx in set(list(parents)+list(children)):
    ps=parents.get(cidx,set()); cs=children.get(cidx,set())-ps
    if len(ps)==1:
        p=next(iter(ps))
        for ch in cs: byid[ch]['parent']=p
    elif len(ps)>1: amb.append((cidx,ps,cs))
print('ambiguous comps',amb)
# members rows 23+ -> nearest box above whose col range contains col; else nearest center
members=[]
def color(cell):
    col=cell.font.color
    if col is not None and col.type=='rgb':
        return {'FFFF0000':'퇴사예정','FF0066FF':'계약','FF7030A0':'Part timer'}.get(col.rgb)
    return None
for r in range(23,ws.max_row+1):
    for c in range(1,MAXC+1):
        s=txt(r,c)
        if not s or re.fullmatch(r'[\d=].*',s): continue
        r1,c1,r2,c2=rng_of(r,c); mid=(c1+c2)/2
        cands=[b for b in boxes if b['r2']<r and b['c1']<=mid<=b['c2']+0.5 and not b['person_box']]
        if cands: u=max(cands,key=lambda b:b['r2'])
        else:
            cands=[b for b in boxes if b['r2']<r and not b['person_box']]
            u=min(cands,key=lambda b:(abs((b['c1']+b['c2'])/2-mid)+ (r-b['r2'])*0.1))
        members.append(dict(row=r,col=L(c1),raw=s,unit=u['id'],flag=color(ws.cell(r,c))))
kids=collections.defaultdict(list)
for b in boxes: kids[b['parent']].append(b)
mem=collections.defaultdict(list)
for m in members: mem[m['unit']].append(m)
def subtree(i):
    b=byid[i]; n=len(mem[i])+(1 if b['head'] or b['person_box'] else 0)
    return n+sum(subtree(k['id']) for k in kids[i])
def show(p,d=0):
    for b in sorted(kids[p],key=lambda x:(x['r1'],x['c1'])):
        print('  '*d+f"{b['name']} [{b['head']}] own={len(mem[b['id']])} sub={subtree(b['id'])}  ({b['id']})")
        show(b['id'],d+1)
show(None)
json.dump(dict(boxes=boxes,members=members),open('org_parsed3.json','w'),ensure_ascii=False,indent=1)
print('members',len(members),'roots',[b['name'] for b in kids[None]])
