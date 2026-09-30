/**
 * WbPersonPicker.tsx — Work Space 사람 선택 공용 컴포넌트 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-F] 신규 — 세 자리(담당자 필터 · 업무 담당자 · 주/부 담당)의 사람 선택을 한 컴포넌트로 통일
 *      · 풀 = members(wb_list_members: workboard·super 보유 재직자). 전 직원 500명 드롭다운 폐지
 *      · 포커스만 해도(타이핑 전) 멤버 전체 리스트 → 타이핑하면 이름·부서·이메일 앞부분 매칭(대소문자 무시), 매칭 글자 하이라이트
 *      · 정렬: 나 → 이름 가나다. super 는 배지만(정렬 영향 없음). 휴직자는 canPickUser(SSOT) 로 제외
 *      · 키보드 ↑↓ Enter Esc, multi 는 빈 입력에서 ⌫ 로 마지막 칩 제거. 외부 클릭 닫힘. 리스트 max 320px 스크롤
 *      · 풀에 없는 기존 값(퇴사·권한 회수)은 표시 전용 칩(회색·점선) — 제거 가능, 재선택 불가
 *      · exclude: 다른 필드가 고른 사람을 비활성(주 ↔ 부 상호 제외 → INVALID_OWNER_SAME 원천 차단)
 *      · extras: 풀 밖이지만 선택 허용할 사람(필터 전용 — 담당 이력만 있는 퇴사자를 하단 구분선 아래 표시)
 *
 * 값은 uuid. 표시는 lookup(WbPerson) — 이름/아바타/퇴사 여부의 SSOT 는 wbShared.useUserLookup
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { X, ChevronDown } from 'lucide-react'
import type { WbMember } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { canPickUser } from '../../utils/employment'
import { WB, type WbPerson } from './wbShared'

interface BaseProps {
  members:     WbMember[]
  lookup:      (id: string | null | undefined) => WbPerson
  authUserId:  string
  exclude?:    { id: string; label: string }[]     // 비활성 표시 (예: 주 담당 → 부 담당 리스트)
  extras?:     { id: string; note: string }[]      // 풀 밖 선택 허용 항목 (하단 구분선 아래)
  placeholder?: string
  disabled?:   boolean
  ariaLabel?:  string
  style?:      CSSProperties
  /** 필터용 첫 항목 — '전체' (값 null) */
  allowAll?:   { label: string; note?: string }
  autoFocus?:  boolean
}
interface SingleProps extends BaseProps { mode: 'single'; value: string | null; onChange: (id: string | null) => void }
interface MultiProps  extends BaseProps { mode: 'multi';  value: string[];      onChange: (ids: string[], changed: { id: string; added: boolean }) => void }
type Props = SingleProps | MultiProps

type Row = { kind: 'all' } | { kind: 'member'; m: WbMember } | { kind: 'extra'; id: string; note: string }

const LIST_MAX = 320

export function WbPersonPicker(props: Props) {
  const { members, lookup, authUserId, exclude = [], extras = [], placeholder, disabled, ariaLabel, style, allowAll, autoFocus } = props
  const isMulti = props.mode === 'multi'
  const selected: string[] = isMulti ? props.value : props.value ? [props.value] : []
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState('')
  const [hi, setHi]       = useState(0)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  // 풀: 나 → 가나다. 휴직자 제외(canPickUser)
  const pool = useMemo(() => members
    .filter(m => canPickUser({ employment_status: m.employment_status ?? undefined, is_active: true }))
    .sort((a, b) => (a.user_id === authUserId ? -1 : b.user_id === authUserId ? 1 : 0) || a.name.localeCompare(b.name, 'ko')), [members, authUserId])
  const memberIds = useMemo(() => new Set(members.map(m => m.user_id)), [members])
  const excludeMap = useMemo(() => new Map(exclude.map(e => [e.id, e.label])), [exclude])

  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase()
  const query = q.trim().toLowerCase()
  const matches = (m: WbMember) => !query || norm(m.name).startsWith(query) || norm(m.dept).startsWith(query) || norm(m.email).startsWith(query) || norm(m.name).includes(query)
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (allowAll && !query) out.push({ kind: 'all' })
    for (const m of pool) if (matches(m)) out.push({ kind: 'member', m })
    for (const e of extras) if (!memberIds.has(e.id) && (!query || norm(lookup(e.id).name).includes(query))) out.push({ kind: 'extra', id: e.id, note: e.note })
    return out
  }, [pool, extras, query, allowAll, memberIds, lookup])  // eslint-disable-line react-hooks/exhaustive-deps

  const isDisabledRow = (r: Row) => r.kind === 'member' ? (excludeMap.has(r.m.user_id) || (isMulti && selected.includes(r.m.user_id))) : r.kind === 'extra' ? (isMulti && selected.includes(r.id)) : false
  const rowId = (r: Row) => r.kind === 'all' ? null : r.kind === 'member' ? r.m.user_id : r.id

  useEffect(() => { setHi(0) }, [q, open])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = listRef.current?.children[hi] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [hi])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  const close = () => { setOpen(false); setQ('') }
  const pick = (r: Row) => {
    if (isDisabledRow(r)) return
    const id = rowId(r)
    if (isMulti) {
      if (!id) return
      ;(props as MultiProps).onChange([...selected, id], { id, added: true }); setQ(''); inputRef.current?.focus()
    } else {
      ;(props as SingleProps).onChange(id); close(); inputRef.current?.blur()
    }
  }
  const remove = (id: string) => {
    if (isMulti) (props as MultiProps).onChange(selected.filter(x => x !== id), { id, added: false })
    else (props as SingleProps).onChange(null)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); inputRef.current?.blur(); return }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(rows.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[hi]; if (r) pick(r) }
    else if (e.key === 'Backspace' && isMulti && !q && selected.length) { remove(selected[selected.length - 1]) }
  }

  // ── 표시 ──
  const singleShown = !isMulti && selected[0] ? lookup(selected[0]) : null
  const showInput = isMulti || !singleShown
  const field: CSSProperties = {
    borderWidth: 1, borderStyle: 'solid', borderColor: open ? WB.ink : '#D1D7E1', boxShadow: open ? '0 0 0 2px rgba(17,17,17,.08)' : 'none', borderRadius: 8, background: disabled ? '#F8FAFC' : '#fff',
    padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 36, position: 'relative', cursor: disabled ? 'not-allowed' : 'text', fontFamily: WB.font, ...style,
  }
  const chipStyle = (p: WbPerson, gone: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px ${gone ? 'dashed' : 'solid'} ${WB.cardBorder}`, background: gone ? '#fff' : '#F8FAFC', borderRadius: 999, padding: '2px 6px 2px 3px', fontSize: 12, color: gone ? WB.faint : WB.ink, fontWeight: 500,
  })
  const hilite = (name: string) => {
    if (!query) return name
    const i = name.toLowerCase().indexOf(query); if (i < 0) return name
    return <>{name.slice(0, i)}<mark style={{ background: '#FEF3C7', padding: '0 1px', borderRadius: 2, color: 'inherit' }}>{name.slice(i, i + query.length)}</mark>{name.slice(i + query.length)}</>
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={field} onClick={() => { if (disabled) return; setOpen(true); inputRef.current?.focus() }} aria-disabled={disabled}>
        {selected.map(id => {
          const p = lookup(id); const gone = !memberIds.has(id)
          return (
            <span key={id} style={chipStyle(p, gone)} data-wb-chip={id}>
              <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={18} fontSize={8.5} bgColor={gone ? '#CBD5E1' : undefined} />
              {p.name}{gone && <span style={{ fontSize: 10 }}>{p.departed ? '(퇴사)' : '(멤버 아님)'}</span>}
              {!disabled && <button className="btn" onClick={e => { e.stopPropagation(); remove(id) }} aria-label={`${p.name} 제외`} style={{ border: 'none', background: 'transparent', padding: 0, color: WB.faint, cursor: 'pointer', display: 'flex' }}><X size={11} /></button>}
            </span>
          )
        })}
        {showInput && (
          <input ref={inputRef} value={q} disabled={disabled} aria-label={ariaLabel ?? placeholder ?? '사람 검색'}
            onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey}
            placeholder={selected.length && isMulti ? '+ 담당자' : placeholder ?? '이름 · 부서 검색'}
            style={{ border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, flex: 1, minWidth: 70, padding: '3px 2px', color: WB.ink, background: 'transparent' }} />
        )}
        {!isMulti && <ChevronDown size={14} style={{ marginLeft: 'auto', color: WB.faint, flexShrink: 0 }} />}
      </div>

      {open && !disabled && (
        <div data-wb-picker-list style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', minWidth: 260, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,.14)', padding: 6, zIndex: 40 }}>
          <div style={{ fontSize: 10.5, color: WB.faint, fontWeight: 600, padding: '4px 8px 6px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{query ? `"${q.trim()}" ${rows.filter(r => r.kind !== 'all').length}명` : `멤버 ${pool.length}`}</span>
            <span><Kbd>↑↓</Kbd> 이동 · <Kbd>Enter</Kbd> 선택 · <Kbd>Esc</Kbd></span>
          </div>
          <div ref={listRef} style={{ maxHeight: LIST_MAX, overflowY: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: '10px 8px', fontSize: 12, color: WB.faint, lineHeight: 1.5 }}>"{q.trim()}" 에 맞는 멤버가 없습니다 — 멤버는 권한 매트릭스에서 Work Space 권한을 부여해야 보입니다</div>}
            {rows.map((r, i) => {
              const dis = isDisabledRow(r); const on = i === hi
              const base: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, fontSize: 12.5, cursor: dis ? 'default' : 'pointer', background: on && !dis ? '#F1F5F9' : 'transparent', color: dis ? WB.faint : WB.ink }
              if (r.kind === 'all') return (
                <div key="__all" style={base} onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(r)} data-wb-row="all">
                  <span style={{ width: 20, textAlign: 'center', color: WB.muted }}>∗</span>{allowAll!.label}<span style={{ marginLeft: 'auto', color: WB.faint, fontSize: 11.5 }}>{allowAll!.note ?? ''}</span>
                </div>
              )
              if (r.kind === 'extra') {
                const p = lookup(r.id); const prevExtra = i > 0 && rows[i - 1].kind !== 'extra'
                return (
                  <div key={r.id}>
                    {prevExtra && <div style={{ borderTop: `1px solid ${WB.line}`, margin: '4px 0' }}><div style={{ fontSize: 10.5, color: WB.faint, fontWeight: 600, padding: '6px 8px 2px' }}>담당 이력만 · 멤버 아님</div></div>}
                    <div style={{ ...base, color: WB.faint }} onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(r)} data-wb-row={r.id}>
                      <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={20} fontSize={9} bgColor="#CBD5E1" />
                      <span>{p.name} <span style={{ fontSize: 10.5 }}>{p.departed ? '(퇴사)' : '(멤버 아님)'}</span></span><span style={{ marginLeft: 'auto', fontSize: 11.5 }}>{r.note}</span>
                    </div>
                  </div>
                )
              }
              const m = r.m; const me = m.user_id === authUserId; const ex = excludeMap.get(m.user_id); const already = isMulti && selected.includes(m.user_id)
              return (
                <div key={m.user_id} style={base} onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(r)} data-wb-row={m.user_id} aria-disabled={dis}>
                  <UserAvatar name={m.name} avatarUrl={m.avatar_url} size={20} fontSize={9} />
                  <span>{hilite(m.name)}</span>
                  {me && <Badge muted>나</Badge>}{m.is_super && <Badge>super</Badge>}
                  <span style={{ marginLeft: 'auto', color: WB.faint, fontSize: 11.5, display: 'flex', gap: 8 }}>
                    {m.dept}{ex && <b style={{ color: WB.accent }}>{ex}</b>}{already && <b style={{ color: WB.accent }}>✓</b>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return <span style={{ display: 'inline-block', border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '0 4px', fontSize: 10, color: WB.muted, background: '#F8FAFC' }}>{children}</span>
}
function Badge({ children, muted }: { children: string; muted?: boolean }) {
  return <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: '1px 5px', background: muted ? '#F1F5F9' : WB.accentBg, color: muted ? '#475569' : WB.accent }}>{children}</span>
}
