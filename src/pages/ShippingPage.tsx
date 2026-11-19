// ============================================================
// ShippingPage — 운송내역서 임시 등록 (단독 페이지, #shipping)
// [2026-11-19] 신규 — 그룹웨어 이관 기간(2026-11-23~) 대체. 고지 확정 "SPACE 내 단독 페이지로 구현"
//
// 구성 (그룹웨어 '확장기능 > 운송내역서' 3메뉴와 동일)
//   · 운송내역서 조회   본인 등록 건 목록(최신순) → [등록하기] / 수발신번호 클릭 → 신청 화면
//   · 운송내역서 신청   조회에서 진입. 버튼: 목록 / 계속등록 / 등록 / 취소 (우측 상단, 그룹웨어와 동일)
//   · 운송내역서 인쇄   본인 건 선택 → A4 가로 라벨 인쇄 (1건당 1장)
//   · 운송내역서(관리자) shipping 역할(GA)에게만 노출 — 전체 건 검색 · 엑셀다운로드
// 규칙
//   · 수발신번호·등록자(이름·사번)는 DB 가 채운다 — 화면은 RPC 응답을 그대로 반영(낙관적 갱신 없음)
//   · 수정·삭제 = 본인 · 등록 당일(KST). 최종 판정은 RPC, 화면의 canEdit 는 버튼 노출용
//   · 접근: 로그인 사용자 전원 (App.tsx authUser 게이트 뒤). 관리자 메뉴는 has_admin_role('shipping')
// 의존: useAuth().currentUser / shippingApi / data/shipping(SSOT) / utils/shippingExcel
// 종료 시: 이 파일 + ShippingPage.css + shippingApi + shippingExcel + data·types/shipping, App.tsx 의 #shipping 블록 제거
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../hooks/useAuth'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { todayStr } from '../utils/time'
import type { ShippingRecord, ShippingPayload, ShippingAdminFilter } from '../types/shipping'
import {
  SHIPPING_ITEM_TYPES, SHIPPING_DIRECTIONS, SHIPPING_UNITS, SHIPPING_REGIONS,
  SHIPPING_DEFAULT_DIRECTION, SHIPPING_DEFAULT_UNIT,
  SHIPPING_SENDER_PRESETS, SHIPPING_SENDER_CUSTOM, SHIPPING_DEFAULT_SENDER,
  SHIPPING_REQUIRED_FIELDS, SHIPPING_QUANTITY_RE, SHIPPING_FIELD_LABELS,
  SHIPPING_LABEL_LAYOUT, SHIPPING_ADMIN_COLUMNS, SHIPPING_GUIDE,
  itemTypeLabel, directionLabel, unitLabel, regionLabel, billableMark, joinAddress, shippingErrorMessage,
} from '../data/shipping'
import {
  fetchMyShipping, fetchAllShipping, createShipping, updateShipping, deleteShipping, fetchShippingIsAdmin,
} from '../lib/shippingApi'
import { downloadShippingExcel } from '../utils/shippingExcel'
import './ShippingPage.css'

type Tab = 'list' | 'form' | 'print' | 'admin'
type FormMode = 'new' | 'edit' | 'view'
interface FormState extends ShippingPayload { senderKey: string }
type Errors = Partial<Record<keyof ShippingPayload, string>>

const errText = (e: unknown) => shippingErrorMessage(e instanceof Error ? e.message : String(e))

/** 등록 당일(KST)인 본인 건만 수정·삭제 버튼을 보여준다 — 최종 판정은 RPC */
const canEdit = (r: ShippingRecord) => r.issued_on === todayStr()

function presetOf(key: string) { return SHIPPING_SENDER_PRESETS.find(p => p.key === key) }

function emptyForm(): FormState {
  const p = presetOf(SHIPPING_DEFAULT_SENDER)!
  return {
    project_no: '', billable: null, item_type: '', requested_on: todayStr(),
    direction: SHIPPING_DEFAULT_DIRECTION, unit: SHIPPING_DEFAULT_UNIT, quantity: '',
    contents: '', tracking_no: '', region: '', note: '',
    senderKey: p.key, sender_company: p.company, sender_name: '', sender_phone: '', sender_addr1: p.addr1, sender_addr2: p.addr2,
    receiver_company: '', receiver_name: '', receiver_phone: '', receiver_addr1: '', receiver_addr2: '',
  }
}

function formFromRecord(r: ShippingRecord): FormState {
  const preset = SHIPPING_SENDER_PRESETS.find(p => p.company === r.sender_company)
  return {
    project_no: r.project_no, billable: r.billable, item_type: r.item_type, requested_on: r.requested_on,
    direction: r.direction, unit: r.unit ?? '', quantity: String(r.quantity),
    contents: r.contents, tracking_no: r.tracking_no, region: r.region, note: r.note,
    senderKey: preset ? preset.key : SHIPPING_SENDER_CUSTOM,
    sender_company: r.sender_company, sender_name: r.sender_name, sender_phone: r.sender_phone,
    sender_addr1: r.sender_addr1, sender_addr2: r.sender_addr2,
    receiver_company: r.receiver_company, receiver_name: r.receiver_name, receiver_phone: r.receiver_phone,
    receiver_addr1: r.receiver_addr1, receiver_addr2: r.receiver_addr2,
  }
}

function toPayload(f: FormState): ShippingPayload {
  const { senderKey: _omit, ...rest } = f
  return rest
}

/** 화면 안내용 검증 — DB shipping_fill 과 같은 목록·식 */
function validate(f: FormState): Errors {
  const e: Errors = {}
  for (const k of SHIPPING_REQUIRED_FIELDS) {
    const v = f[k]
    const blank = k === 'billable' ? v === null : String(v ?? '').trim() === ''
    if (blank) e[k] = k === 'billable' || k === 'item_type' || k === 'region' || k === 'direction' ? '선택해 주세요' : '필수 항목입니다'
  }
  if (!e.quantity && !SHIPPING_QUANTITY_RE.test(f.quantity.trim())) e.quantity = '1 이상의 숫자만 입력해 주세요'
  return e
}

// ─────────────────────────────────────────────────────────────
// 페이지 루트
// ─────────────────────────────────────────────────────────────
export default function ShippingPage() {
  const { currentUser } = useAuth()
  const uid = currentUser?.user_id ?? null

  const [tab, setTab] = useState<Tab>('list')
  const [isAdmin, setIsAdmin] = useState(false)
  const [mine, setMine] = useState<ShippingRecord[] | null>(null)   // null = 로딩 중
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [target, setTarget] = useState<ShippingRecord | null>(null)  // 신청 화면 대상 (null = 신규)
  const [printIds, setPrintIds] = useState<string[]>([])
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)

  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => setToast({ msg, kind }), [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), toast.kind === 'err' ? 5000 : 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const reload = useCallback(async () => {
    if (!uid) return
    try {
      setLoadErr(null)
      setMine(await fetchMyShipping(uid))
    } catch (e) {
      setLoadErr(errText(e))
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    let alive = true
    reload()
    // 관리자 판정은 실패해도 페이지 동작에 영향 없음(관리자 메뉴만 미노출)
    fetchShippingIsAdmin().then(v => { if (alive) setIsAdmin(v) }).catch(() => {})
    return () => { alive = false }
  }, [uid, reload])

  // 관리자 메뉴가 닫힌 상태에서 admin 탭에 머물지 않게 한다
  useEffect(() => { if (tab === 'admin' && !isAdmin) setTab('list') }, [tab, isAdmin])

  const openNew = () => { setTarget(null); setTab('form') }
  const openRecord = (r: ShippingRecord) => { setTarget(r); setTab('form') }
  const openPrint = (r: ShippingRecord) => { setPrintIds([r.id]); setTab('print') }

  /** RPC 응답 행을 목록에 반영 (등록 = 맨 앞 추가, 수정 = 교체) */
  const applySaved = (row: ShippingRecord) => {
    setMine(prev => {
      const list = prev ?? []
      return list.some(x => x.id === row.id) ? list.map(x => (x.id === row.id ? row : x)) : [row, ...list]
    })
  }
  const applyDeleted = (id: string) => {
    setMine(prev => (prev ?? []).filter(x => x.id !== id))
    setPrintIds(prev => prev.filter(x => x !== id))
  }

  const goSpace = () => { window.location.hash = 'home'; window.location.reload() }

  return (
    <div className="shp-root">
      <header className="shp-top">
        <div className="shp-top-in">
          <div className="shp-brand">
            <b>운송내역서</b>
            <span className="shp-chip">임시 등록</span>
          </div>
          <div className="shp-top-right">
            <span className="shp-me">{currentUser?.name ?? ''}</span>
            <button type="button" className="shp-btn shp-btn-ghost" onClick={goSpace}>C&amp;R SPACE로 이동</button>
          </div>
        </div>
      </header>

      <main className="shp-main">
        <nav className="shp-tabs" aria-label="운송내역서 메뉴">
          <button type="button" className={tab === 'list' || tab === 'form' ? 'on' : ''} onClick={() => setTab('list')}>운송내역서 조회</button>
          <button type="button" className={tab === 'print' ? 'on' : ''} onClick={() => setTab('print')}>운송내역서 인쇄</button>
          {isAdmin && (
            <button type="button" className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>운송내역서(관리자)</button>
          )}
        </nav>

        {tab === 'list' && (
          <ListView
            rows={mine} loadErr={loadErr} onRetry={reload}
            onNew={openNew} onOpen={openRecord} onPrint={openPrint}
            onDeleted={(r) => { applyDeleted(r.id); notify(`${r.shipping_no} 삭제됨 — 이 번호는 다시 쓰지 않습니다`) }}
            onError={(m) => notify(m, 'err')}
          />
        )}
        {tab === 'form' && (
          <FormView
            key={target?.id ?? 'new'}
            userName={currentUser?.name ?? ''}
            target={target}
            onList={() => setTab('list')}
            onSaved={(row, keep, isNew) => {
              applySaved(row)
              notify(isNew ? `${row.shipping_no} 등록됨` : `${row.shipping_no} 수정됨`)
              if (!keep) setTab('list')
            }}
            onError={(m) => notify(m, 'err')}
          />
        )}
        {tab === 'print' && (
          <PrintView rows={mine} loadErr={loadErr} onRetry={reload} selected={printIds} onSelect={setPrintIds} />
        )}
        {tab === 'admin' && isAdmin && <AdminView onError={(m) => notify(m, 'err')} />}
      </main>

      {toast && <div className={`shp-toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">{toast.msg}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 공용 조각
// ─────────────────────────────────────────────────────────────
function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="shp-skel" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="sk-block shp-skel-row" />)}
    </div>
  )
}

function LoadError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="shp-empty">
      <p>목록을 불러오지 못했습니다. {msg}</p>
      <button type="button" className="shp-btn" onClick={onRetry}>다시 시도</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 1. 운송내역서 조회
// ─────────────────────────────────────────────────────────────
function ListView({ rows, loadErr, onRetry, onNew, onOpen, onPrint, onDeleted, onError }: {
  rows: ShippingRecord[] | null; loadErr: string | null; onRetry: () => void
  onNew: () => void; onOpen: (r: ShippingRecord) => void; onPrint: (r: ShippingRecord) => void
  onDeleted: (r: ShippingRecord) => void; onError: (m: string) => void
}) {
  const [confirm, setConfirm] = useState<ShippingRecord | null>(null)
  const [busy, setBusy] = useState(false)

  const doDelete = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      await deleteShipping(confirm.id)
      onDeleted(confirm)
      setConfirm(null)
    } catch (e) {
      onError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="shp-card">
      <div className="shp-bar">
        <h2>운송내역서 조회</h2>
        <span className="shp-sub">본인이 등록한 건만 보입니다</span>
        <button type="button" className="shp-btn shp-btn-primary shp-right" onClick={onNew}>등록하기</button>
      </div>

      {loadErr ? <LoadError msg={loadErr} onRetry={onRetry} />
        : rows === null ? <SkeletonRows />
        : rows.length === 0 ? (
          <div className="shp-empty">
            <p>등록한 운송내역서가 없습니다.</p>
            <button type="button" className="shp-btn" onClick={onNew}>등록하기</button>
          </div>
        ) : (
          <div className="shp-scroll">
            <table className="shp-table">
              <thead>
                <tr>
                  <th>수발신번호</th><th>항목</th><th>수발형태</th><th>수신처</th><th>수신인</th>
                  <th>신청일자</th><th>수량</th><th>프로젝트 번호</th><th aria-label="작업" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td><button type="button" className="shp-link" onClick={() => onOpen(r)}>{r.shipping_no}</button></td>
                    <td>{itemTypeLabel(r.item_type)}</td>
                    <td>{directionLabel(r.direction)}</td>
                    <td>{r.receiver_company}</td>
                    <td>{r.receiver_name}</td>
                    <td>{r.requested_on}</td>
                    <td className="num">{r.quantity}</td>
                    <td>{r.project_no}</td>
                    <td className="act">
                      <button type="button" className="shp-btn shp-btn-sm" onClick={() => onPrint(r)}>인쇄</button>
                      {canEdit(r) && <>
                        <button type="button" className="shp-btn shp-btn-sm" onClick={() => onOpen(r)}>수정</button>
                        <button type="button" className="shp-btn shp-btn-sm shp-btn-danger" onClick={() => setConfirm(r)}>삭제</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="shp-note">수정·삭제는 등록한 당일에만 본인이 직접 할 수 있습니다.</p>

      {confirm && (
        <ConfirmDialog
          title="운송내역서를 삭제할까요?"
          message={<>{confirm.shipping_no} 건을 삭제합니다.<br />삭제한 수발신번호는 다시 쓰이지 않으며, 이미 인쇄한 라벨은 폐기해 주세요.</>}
          confirmLabel="삭제"
          variant="danger"
          loading={busy}
          onConfirm={doDelete}
          onClose={() => { if (!busy) setConfirm(null) }}
        />
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 2. 운송내역서 신청 (신규 · 수정 · 열람)
// ─────────────────────────────────────────────────────────────
function FormView({ userName, target, onList, onSaved, onError }: {
  userName: string; target: ShippingRecord | null
  onList: () => void
  onSaved: (row: ShippingRecord, keep: boolean, isNew: boolean) => void
  onError: (m: string) => void
}) {
  const mode: FormMode = !target ? 'new' : canEdit(target) ? 'edit' : 'view'
  const ro = mode === 'view'
  const [f, setF] = useState<FormState>(() => (target ? formFromRecord(target) : emptyForm()))
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF(prev => ({ ...prev, [k]: v }))
    setErrors(prev => (prev[k as keyof ShippingPayload] ? { ...prev, [k]: undefined } : prev))
  }

  const pickSender = (key: string) => {
    const p = presetOf(key)
    setF(prev => p
      ? { ...prev, senderKey: key, sender_company: p.company, sender_addr1: p.addr1, sender_addr2: p.addr2 }
      : { ...prev, senderKey: SHIPPING_SENDER_CUSTOM, sender_company: '', sender_addr1: '', sender_addr2: '' })
  }

  const submit = async (keep: boolean) => {
    if (busy || ro) return
    const e = validate(f)
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      const first = Object.keys(e)[0]
      onError(`${SHIPPING_FIELD_LABELS[first] ?? first}: ${e[first as keyof ShippingPayload]}`)
      return
    }
    setBusy(true)
    try {
      const isNew = mode === 'new'
      const row = isNew ? await createShipping(toPayload(f)) : await updateShipping(target!.id, toPayload(f))
      onSaved(row, keep, isNew)
      if (keep) {
        // 계속등록 — 발신처만 남기고 비운다
        setF(prev => ({ ...emptyForm(), senderKey: prev.senderKey, sender_company: prev.sender_company,
          sender_name: prev.sender_name, sender_phone: prev.sender_phone, sender_addr1: prev.sender_addr1, sender_addr2: prev.sender_addr2 }))
        setErrors({})
        window.scrollTo({ top: 0 })
      }
    } catch (err) {
      onError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const E = ({ k }: { k: keyof ShippingPayload }) => (errors[k] ? <p className="shp-err">{errors[k]}</p> : null)

  return (
    <section className="shp-card">
      <div className="shp-bar">
        <h2>{mode === 'new' ? '운송내역서 신청' : mode === 'edit' ? '운송내역서 수정' : '운송내역서 상세'}</h2>
        {mode === 'view' && <span className="shp-sub">등록한 당일이 지나 수정할 수 없습니다</span>}
        <div className="shp-right shp-actions">
          <button type="button" className="shp-btn" onClick={onList} disabled={busy}>목록</button>
          {mode === 'new' && <button type="button" className="shp-btn" onClick={() => submit(true)} disabled={busy}>계속등록</button>}
          {!ro && <button type="button" className="shp-btn shp-btn-primary" onClick={() => submit(false)} disabled={busy}>{busy ? '저장 중…' : mode === 'new' ? '등록' : '저장'}</button>}
          {!ro && <button type="button" className="shp-btn" onClick={onList} disabled={busy}>취소</button>}
        </div>
      </div>

      <fieldset className="shp-fs" disabled={ro || busy}>
        <h3 className="shp-h">운송 등록</h3>
        <div className="shp-grid">
          <div className="shp-f"><label>사원</label><input value={target ? target.user_name : userName} disabled readOnly /></div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-project">프로젝트명</label>
            <input id="shp-project" value={f.project_no} onChange={e => set('project_no', e.target.value)} placeholder="프로젝트 번호 (예: 24-046, 과제가 없으면 CNR)" />
            <E k="project_no" />
          </div>
          <div className="shp-f">
            <label className="req">청구여부</label>
            <div className="shp-radios" role="radiogroup" aria-label="청구여부">
              <label><input type="radio" name="shp-billable" checked={f.billable === true} onChange={() => set('billable', true)} /> Yes</label>
              <label><input type="radio" name="shp-billable" checked={f.billable === false} onChange={() => set('billable', false)} /> No</label>
            </div>
            <E k="billable" />
          </div>

          <div className="shp-f">
            <label className="req" htmlFor="shp-item">항목</label>
            <select id="shp-item" value={f.item_type} disabled={mode !== 'new'} onChange={e => set('item_type', e.target.value as FormState['item_type'])}>
              <option value="">선택</option>
              {SHIPPING_ITEM_TYPES.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
            {mode === 'edit' && <p className="shp-hint">항목은 수발신번호와 묶여 있어 바꿀 수 없습니다</p>}
            <E k="item_type" />
          </div>
          <div className="shp-f">
            <label htmlFor="shp-date">신청일자</label>
            <input id="shp-date" type="date" value={f.requested_on} onChange={e => set('requested_on', e.target.value)} />
            <p className="shp-hint">발송할 날짜</p>
          </div>
          <div className="shp-f"><label>사용금액</label><input className="num" value={target ? target.amount : 0} disabled readOnly /></div>

          <div className="shp-f">
            <label className="req">수발형태</label>
            <div className="shp-radios" role="radiogroup" aria-label="수발형태">
              {SHIPPING_DIRECTIONS.map(o => (
                <label key={o.code}><input type="radio" name="shp-direction" checked={f.direction === o.code} onChange={() => set('direction', o.code)} /> {o.label}</label>
              ))}
            </div>
            <E k="direction" />
          </div>
          <div className="shp-f">
            <label>단위</label>
            <div className="shp-radios" role="radiogroup" aria-label="단위">
              {SHIPPING_UNITS.map(o => (
                <label key={o.code}><input type="radio" name="shp-unit" checked={f.unit === o.code} onChange={() => set('unit', o.code)} /> {o.label}</label>
              ))}
            </div>
          </div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-qty">수량</label>
            <input id="shp-qty" inputMode="numeric" value={f.quantity} onChange={e => set('quantity', e.target.value)} placeholder="숫자만" />
            <E k="quantity" />
          </div>

          <div className="shp-f"><label htmlFor="shp-contents">내용물</label><input id="shp-contents" value={f.contents} onChange={e => set('contents', e.target.value)} /></div>
          <div className="shp-f"><label>수발신번호</label><input value={target ? target.shipping_no : ''} placeholder="등록 시 자동 부여" disabled readOnly /></div>
          <div className="shp-f"><label htmlFor="shp-track">운송장번호</label><input id="shp-track" value={f.tracking_no} onChange={e => set('tracking_no', e.target.value)} placeholder="수령 건만 입력" /></div>

          <div className="shp-f">
            <label className="req">지역</label>
            <div className="shp-radios" role="radiogroup" aria-label="지역">
              {SHIPPING_REGIONS.map(o => (
                <label key={o.code}><input type="radio" name="shp-region" checked={f.region === o.code} onChange={() => set('region', o.code)} /> {o.label}</label>
              ))}
            </div>
            <E k="region" />
          </div>
          <div className="shp-f"><label>무게(g)</label><input className="num" value={target ? target.weight_g : 0} disabled readOnly /></div>
          <div className="shp-f"><label htmlFor="shp-note">비고</label><input id="shp-note" value={f.note} onChange={e => set('note', e.target.value)} /></div>
        </div>

        <h3 className="shp-h">발신처</h3>
        <div className="shp-grid">
          <div className="shp-f shp-span3">
            <label>회사</label>
            <div className="shp-radios" role="radiogroup" aria-label="발신처 회사">
              {SHIPPING_SENDER_PRESETS.map(p => (
                <label key={p.key}><input type="radio" name="shp-sender" checked={f.senderKey === p.key} onChange={() => pickSender(p.key)} /> {p.company}</label>
              ))}
              <label><input type="radio" name="shp-sender" checked={f.senderKey === SHIPPING_SENDER_CUSTOM} onChange={() => pickSender(SHIPPING_SENDER_CUSTOM)} /> 직접 입력</label>
              <input className="shp-inline" aria-label="발신처 회사명" value={f.sender_company} disabled={f.senderKey !== SHIPPING_SENDER_CUSTOM}
                onChange={e => set('sender_company', e.target.value)} placeholder="회사명" />
            </div>
          </div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-sname">담당자</label>
            <input id="shp-sname" value={f.sender_name} onChange={e => set('sender_name', e.target.value)} placeholder="직책 없이 성함만" />
            <E k="sender_name" />
          </div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-sphone">전화번호</label>
            <input id="shp-sphone" value={f.sender_phone} onChange={e => set('sender_phone', e.target.value)} />
            <E k="sender_phone" />
          </div>
          <div />
          <div className="shp-f shp-span2"><label htmlFor="shp-saddr1">주소</label><input id="shp-saddr1" value={f.sender_addr1} onChange={e => set('sender_addr1', e.target.value)} placeholder="기본주소" /></div>
          <div className="shp-f"><label htmlFor="shp-saddr2">상세주소</label><input id="shp-saddr2" value={f.sender_addr2} onChange={e => set('sender_addr2', e.target.value)} /></div>
        </div>

        <h3 className="shp-h">수신처</h3>
        <div className="shp-grid">
          <div className="shp-f"><label htmlFor="shp-rco">회사</label><input id="shp-rco" value={f.receiver_company} onChange={e => set('receiver_company', e.target.value)} /></div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-rname">담당자</label>
            <input id="shp-rname" value={f.receiver_name} onChange={e => set('receiver_name', e.target.value)} placeholder="직책 없이 성함만" />
            <E k="receiver_name" />
          </div>
          <div className="shp-f">
            <label className="req" htmlFor="shp-rphone">전화번호</label>
            <input id="shp-rphone" value={f.receiver_phone} onChange={e => set('receiver_phone', e.target.value)} />
            <E k="receiver_phone" />
          </div>
          <div className="shp-f shp-span2"><label htmlFor="shp-raddr1">주소</label><input id="shp-raddr1" value={f.receiver_addr1} onChange={e => set('receiver_addr1', e.target.value)} placeholder="기본주소 (자세하고 정확하게)" /></div>
          <div className="shp-f"><label htmlFor="shp-raddr2">상세주소</label><input id="shp-raddr2" value={f.receiver_addr2} onChange={e => set('receiver_addr2', e.target.value)} /></div>
        </div>
      </fieldset>

      <aside className="shp-guide" aria-label="참고사항">
        <h3>참고사항</h3>
        {SHIPPING_GUIDE.map(g => (
          <div key={g.title} className="shp-guide-blk">
            <b>{g.title}</b>
            <ul>
              {g.lines.map((l, i) => <li key={i} className={`${l.strong ? 'strong' : ''} ${l.warn ? 'warn' : ''}`}>{l.text}</li>)}
            </ul>
          </div>
        ))}
      </aside>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 3. 운송내역서 인쇄 — A4 가로, 1건당 1장
// ─────────────────────────────────────────────────────────────
const L = SHIPPING_LABEL_LAYOUT

/** 라벨 1장 — 화면 미리보기와 인쇄가 같은 컴포넌트를 쓴다(mm 단위) */
function LabelSheet({ r }: { r: ShippingRecord }) {
  const block = (title: string, addr: string, company: string, name: string, phone: string) => (
    <>
      <div>{title}</div>
      <div>{addr}</div>
      <div>{company}</div>
      <div>{name}</div>
      <div>{phone}</div>
    </>
  )
  return (
    <div className="shp-sheet" style={{ width: `${L.pageWidthMm}mm`, height: `${L.pageHeightMm}mm`, fontSize: `${L.fontPt}pt`, ['--shp-pitch' as any]: `${L.linePitchMm}mm` }}>
      <div className="shp-sheet-blk" style={{ left: `${L.senderLeftMm}mm`, top: `${L.senderTopMm}mm`, width: `${L.numberLeftMm - L.senderLeftMm - 3}mm` }}>
        {block('보내는 사람', joinAddress(r.sender_addr1, r.sender_addr2), r.sender_company, r.sender_name, r.sender_phone)}
      </div>
      <div className="shp-sheet-blk" style={{ left: `${L.numberLeftMm}mm`, top: `${L.numberTopMm}mm` }}>{r.shipping_no}</div>
      <div className="shp-sheet-blk" style={{ left: `${L.receiverLeftMm}mm`, top: `${L.receiverTopMm}mm`, width: `${L.pageWidthMm - L.receiverLeftMm - 5}mm` }}>
        {block('받는 사람', joinAddress(r.receiver_addr1, r.receiver_addr2), r.receiver_company, r.receiver_name, r.receiver_phone)}
      </div>
    </div>
  )
}

function PrintView({ rows, loadErr, onRetry, selected, onSelect }: {
  rows: ShippingRecord[] | null; loadErr: string | null; onRetry: () => void
  selected: string[]; onSelect: (ids: string[]) => void
}) {
  const picked = useMemo(() => (rows ?? []).filter(r => selected.includes(r.id)), [rows, selected])
  const allOn = !!rows && rows.length > 0 && picked.length === rows.length

  const toggle = (id: string) => onSelect(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  /** 인쇄하는 동안만 A4 가로·여백 0 을 건다 — @page 를 CSS 파일에 두면 SPACE 다른 화면 인쇄까지 가로가 된다 */
  const print = () => {
    if (picked.length === 0) return
    const style = document.createElement('style')
    style.textContent = '@page { size: A4 landscape; margin: 0; }'
    document.head.appendChild(style)
    document.documentElement.classList.add('shp-printing')
    const cleanup = () => {
      document.documentElement.classList.remove('shp-printing')
      style.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  return (
    <section className="shp-card">
      <div className="shp-bar">
        <h2>운송내역서 인쇄</h2>
        <span className="shp-sub">A4 가로 · 1건당 1장</span>
        <button type="button" className="shp-btn shp-btn-primary shp-right" onClick={print} disabled={picked.length === 0}>
          인쇄{picked.length > 0 ? ` (${picked.length}건)` : ''}
        </button>
      </div>

      {loadErr ? <LoadError msg={loadErr} onRetry={onRetry} />
        : rows === null ? <SkeletonRows />
        : rows.length === 0 ? <div className="shp-empty"><p>등록한 운송내역서가 없습니다.</p></div>
        : (
          <>
            <div className="shp-scroll">
              <table className="shp-table">
                <thead>
                  <tr>
                    <th className="chk"><input type="checkbox" aria-label="전체 선택" checked={allOn} onChange={() => onSelect(allOn ? [] : rows.map(r => r.id))} /></th>
                    <th>수발신번호</th><th>항목</th><th>수신처</th><th>수신인</th><th>신청일자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className={selected.includes(r.id) ? 'sel' : ''} onClick={() => toggle(r.id)}>
                      <td className="chk"><input type="checkbox" aria-label={`${r.shipping_no} 선택`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} /></td>
                      <td>{r.shipping_no}</td><td>{itemTypeLabel(r.item_type)}</td><td>{r.receiver_company}</td><td>{r.receiver_name}</td><td>{r.requested_on}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="shp-h">미리보기</h3>
            {picked.length === 0 ? <p className="shp-note">인쇄할 건을 선택하면 라벨이 보입니다.</p> : (
              <div className="shp-preview">
                {picked.map(r => <div key={r.id} className="shp-preview-crop"><LabelSheet r={r} /></div>)}
              </div>
            )}
            <p className="shp-note">미리보기는 실제 크기이며 종이 위쪽만 보여줍니다. 글자 위치·크기는 그룹웨어 인쇄 서식과 같습니다.</p>
          </>
        )}

      {createPortal(<div className="shp-print-root">{picked.map(r => <LabelSheet key={r.id} r={r} />)}</div>, document.body)}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// 4. 운송내역서(관리자) — 전체 건 검색 · 엑셀다운로드
// ─────────────────────────────────────────────────────────────
const PAGE_SIZES = [10, 20, 50]

function AdminView({ onError }: { onError: (m: string) => void }) {
  const today = todayStr()
  const [filter, setFilter] = useState<ShippingAdminFilter>({ projectNo: '', userName: '', itemType: '', direction: '', trackingNo: '', from: today, to: today })
  const [applied, setApplied] = useState<ShippingAdminFilter>(filter)   // 마지막으로 검색한 조건 (엑셀 파일명 · 재조회)
  const [rows, setRows] = useState<ShippingRecord[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(PAGE_SIZES[0])
  const [exporting, setExporting] = useState(false)

  const search = useCallback(async (f: ShippingAdminFilter) => {
    setRows(null); setLoadErr(null); setPage(1); setApplied(f)
    try {
      setRows(await fetchAllShipping(f))
    } catch (e) {
      setLoadErr(errText(e))
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(filter) }, [])

  const setK = <K extends keyof ShippingAdminFilter>(k: K, v: ShippingAdminFilter[K]) => setFilter(prev => ({ ...prev, [k]: v }))
  const total = rows?.length ?? 0
  const pages = Math.max(1, Math.ceil(total / size))
  const view = (rows ?? []).slice((page - 1) * size, page * size)

  const exportExcel = async () => {
    if (!rows || rows.length === 0 || exporting) return
    setExporting(true)
    try {
      const label = applied.from && applied.to ? (applied.from === applied.to ? applied.from : `${applied.from}_${applied.to}`) : today
      await downloadShippingExcel(rows, label)
    } catch (e) {
      onError(errText(e))
    } finally {
      setExporting(false)
    }
  }

  const cells = (r: ShippingRecord, n: number): (string | number)[] => [
    n, r.user_name, r.employee_no, r.shipping_no, r.receiver_company, r.receiver_name, r.receiver_phone,
    joinAddress(r.receiver_addr1, r.receiver_addr2), directionLabel(r.direction), itemTypeLabel(r.item_type), unitLabel(r.unit),
    r.contents, r.quantity, r.sender_company, r.sender_name, r.sender_phone, joinAddress(r.sender_addr1, r.sender_addr2),
    r.requested_on, regionLabel(r.region), r.amount, r.weight_g, r.tracking_no, r.project_no, billableMark(r.billable),
  ]
  const LONG = [7, 11, 16]         // 주소·내용물 — 말줄임
  const NUM = [12, 19, 20]         // 수량·사용금액·무게 — 오른쪽 정렬

  return (
    <section className="shp-card">
      <div className="shp-bar">
        <h2>운송내역서(관리자)</h2>
        <span className="shp-sub">전 직원 등록 건</span>
      </div>

      <form className="shp-filter" onSubmit={e => { e.preventDefault(); search(filter) }}>
        <div className="shp-f"><label htmlFor="shp-a-proj">프로젝트번호</label><input id="shp-a-proj" value={filter.projectNo} onChange={e => setK('projectNo', e.target.value)} /></div>
        <div className="shp-f"><label htmlFor="shp-a-emp">사원명</label><input id="shp-a-emp" value={filter.userName} onChange={e => setK('userName', e.target.value)} /></div>
        <div className="shp-f">
          <label htmlFor="shp-a-item">항목</label>
          <select id="shp-a-item" value={filter.itemType} onChange={e => setK('itemType', e.target.value as ShippingAdminFilter['itemType'])}>
            <option value="">전체</option>
            {SHIPPING_ITEM_TYPES.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </div>
        <div className="shp-f">
          <label htmlFor="shp-a-dir">수발형태</label>
          <select id="shp-a-dir" value={filter.direction} onChange={e => setK('direction', e.target.value as ShippingAdminFilter['direction'])}>
            <option value="">전체</option>
            {SHIPPING_DIRECTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </div>
        <div className="shp-f"><label htmlFor="shp-a-track">운송장번호</label><input id="shp-a-track" value={filter.trackingNo} onChange={e => setK('trackingNo', e.target.value)} /></div>
        <div className="shp-f">
          <label htmlFor="shp-a-from">조회기간 (신청일자)</label>
          <div className="shp-range">
            <input id="shp-a-from" type="date" aria-label="시작일" value={filter.from} onChange={e => setK('from', e.target.value)} />
            <span>~</span>
            <input type="date" aria-label="종료일" value={filter.to} onChange={e => setK('to', e.target.value)} />
          </div>
        </div>
        <div className="shp-filter-act">
          <button type="submit" className="shp-btn shp-btn-primary">검색</button>
          <button type="button" className="shp-btn" onClick={exportExcel} disabled={!rows || rows.length === 0 || exporting}>{exporting ? '만드는 중…' : '엑셀다운로드'}</button>
        </div>
      </form>

      {loadErr ? <LoadError msg={loadErr} onRetry={() => search(applied)} />
        : rows === null ? <SkeletonRows rows={6} />
        : rows.length === 0 ? <div className="shp-empty"><p>조건에 맞는 운송내역서가 없습니다.</p></div>
        : (
          <>
            <p className="shp-count">조회 {total}건 · 엑셀은 조회된 전체 건이 내려받아집니다</p>
            <div className="shp-scroll">
              <table className="shp-table shp-table-admin">
                <thead><tr>{SHIPPING_ADMIN_COLUMNS.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {view.map((r, i) => (
                    <tr key={r.id}>
                      {cells(r, (page - 1) * size + i + 1).map((v, ci) => (
                        <td key={ci} className={`${LONG.includes(ci) ? 'long' : ''} ${NUM.includes(ci) ? 'num' : ''}`} title={LONG.includes(ci) ? String(v) : undefined}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="shp-pager">
              <button type="button" className="shp-btn shp-btn-sm" onClick={() => setPage(1)} disabled={page === 1} aria-label="첫 페이지">«</button>
              <button type="button" className="shp-btn shp-btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} aria-label="이전 페이지">‹</button>
              <span>{page} / {pages}</span>
              <button type="button" className="shp-btn shp-btn-sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} aria-label="다음 페이지">›</button>
              <button type="button" className="shp-btn shp-btn-sm" onClick={() => setPage(pages)} disabled={page === pages} aria-label="마지막 페이지">»</button>
              <select aria-label="페이지당 건수" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1) }}>
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </>
        )}
    </section>
  )
}
