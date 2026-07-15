/**
 * VisitorLogPanel.tsx — 방문로그 관리 (Admin '방문 기록' 탭)
 *
 * ✅ 이번 개편 (2026-07-10, Step 4)
 *  - 카드 관리: 추가/삭제(사용중 삭제 차단) — visitor_admin_list_cards/add/delete.
 *  - 어드민 메모: 기록별 내부 메모 편집(visitor_admin_set_memo).
 *  - 방문자 메모(visitor_memo) 표시. 카드(card_no)는 라벨로 표시.
 *  - 리얼타임: visitor-logs 채널 구독 → 신규 방문/반납/삭제/카드변경 시 새로고침 없이 목록 갱신.
 *  - 이전 유지: 2차 비번 잠금, status(방문중/반납완료), 요약, 검색·상태·유형·날짜 필터, Excel.
 */

import { useState, useEffect, useRef } from 'react'
import {
  visitorVerifyAccess, visitorListLogs, visitorReturnCard, visitorDeleteLog,
  visitorSignedUrls, visitorListCards, visitorAddCard, visitorDeleteCard, visitorSetMemo,
  type VisitorLog, type VisitorCard,
} from '../../lib/api'
import { supabase } from '../../lib/supabase'

interface Props {
  showToast: (msg: string, type?: string) => void
  isMobile?: boolean
}

function kstDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function kstTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return kstDate(d.toISOString())
}

type StatusFilter = 'all' | 'active' | 'returned'
type PurposeFilter = 'all' | '점검' | '미팅' | '기타'

export function VisitorLogPanel({ showToast }: Props) {
  const [unlocked, setUnlocked]   = useState(false)
  const [pw, setPw]               = useState('')
  const [pwInput, setPwInput]     = useState('')
  const [pwErr, setPwErr]         = useState(false)
  const [verifying, setVerifying] = useState(false)

  const [logs, setLogs]     = useState<VisitorLog[]>([])
  const [urls, setUrls]     = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const [viewImg, setViewImg]     = useState<{ url: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  // 필터
  const [q, setQ]               = useState('')
  const [statusF, setStatusF]   = useState<StatusFilter>('all')
  const [purposeF, setPurposeF] = useState<PurposeFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  // 카드 관리
  const [showCards, setShowCards]   = useState(false)
  const [cards, setCards]           = useState<VisitorCard[]>([])
  const [newCard, setNewCard]       = useState('')

  // 메모 편집
  const [editMemo, setEditMemo] = useState<{ id: string; value: string } | null>(null)

  // 최신 pw/상태를 리얼타임 콜백에서 참조하기 위한 ref
  const pwRef = useRef('')
  const showCardsRef = useRef(false)
  useEffect(() => { pwRef.current = pw }, [pw])
  useEffect(() => { showCardsRef.current = showCards }, [showCards])
  const reloadTimer = useRef<number | undefined>(undefined)

  const unlock = async () => {
    if (!pwInput) return
    setVerifying(true); setPwErr(false)
    try {
      const ok = await visitorVerifyAccess(pwInput)
      if (!ok) { setPwErr(true); return }
      setPw(pwInput); setUnlocked(true)
      await loadLogs(pwInput)
    } catch { setPwErr(true) } finally { setVerifying(false) }
  }

  const loadLogs = async (pwArg: string) => {
    setLoading(true)
    try {
      const rows = await visitorListLogs(pwArg)
      setLogs(rows)
      setUrls(await visitorSignedUrls(rows.map(r => r.sig_img_path)))
    } catch (e) {
      console.error('[visitor-panel] 로드 실패:', e)
      showToast('방문 기록을 불러오지 못했습니다.', 'error')
    } finally { setLoading(false) }
  }

  const loadCards = async (pwArg: string) => {
    try { setCards(await visitorListCards(pwArg)) }
    catch (e) { console.error('[visitor-panel] 카드 로드 실패:', e) }
  }

  // 리얼타임 구독 (잠금해제 후)
  useEffect(() => {
    if (!unlocked) return
    const ch = supabase.channel('visitor-logs')
      .on('broadcast', { event: 'changed' }, () => {
        // 버스트 병합: 300ms 디바운스 후 재조회
        if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
        reloadTimer.current = window.setTimeout(() => {
          const p = pwRef.current
          if (!p) return
          loadLogs(p)
          if (showCardsRef.current) loadCards(p)
        }, 300)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [unlocked])

  const toggleCards = async () => {
    const next = !showCards; setShowCards(next)
    if (next && cards.length === 0) await loadCards(pw)
  }

  const addCard = async () => {
    const label = newCard.trim()
    if (!label) return
    try { await visitorAddCard(pw, label); setNewCard(''); await loadCards(pw); showToast('카드가 추가되었습니다.') }
    catch { showToast('카드 추가에 실패했습니다.', 'error') }
  }

  const deleteCard = async (label: string) => {
    if (!window.confirm(`카드 '${label}'를 삭제하시겠습니까?`)) return
    try { await visitorDeleteCard(pw, label); await loadCards(pw); showToast('카드가 삭제되었습니다.') }
    catch (e: any) {
      if (String(e?.message ?? '').includes('CARD_IN_USE')) showToast('사용 중인 카드는 삭제할 수 없습니다.', 'error')
      else showToast('카드 삭제에 실패했습니다.', 'error')
    }
  }

  const retCard = async (id: string) => {
    try {
      const done = await visitorReturnCard(pw, id)
      if (done) {
        setLogs(prev => prev.map(r => r.id === id ? { ...r, returned: true, returned_at: new Date().toISOString() } : r))
        showToast('반납 처리되었습니다.')
      } else showToast('이미 반납된 기록입니다.', 'info')
    } catch { showToast('처리에 실패했습니다.', 'error') }
  }

  const delRec = async (id: string) => {
    if (!window.confirm('이 기록을 삭제하시겠습니까? (서명 이미지도 함께 삭제됩니다)')) return
    try { await visitorDeleteLog(pw, id); setLogs(prev => prev.filter(r => r.id !== id)); showToast('삭제되었습니다.') }
    catch { showToast('삭제에 실패했습니다.', 'error') }
  }

  const saveMemo = async () => {
    if (!editMemo) return
    const { id, value } = editMemo
    try {
      await visitorSetMemo(pw, id, value)
      const memo = value.trim() || null
      setLogs(prev => prev.map(r => r.id === id ? { ...r, admin_memo: memo } : r))
      setEditMemo(null); showToast('메모가 저장되었습니다.')
    } catch { showToast('메모 저장에 실패했습니다.', 'error') }
  }

  // 필터 적용
  const filtered = logs.filter(r => {
    if (q) {
      const t = `${r.name_text} ${r.org_text}`.toLowerCase()
      if (!t.includes(q.trim().toLowerCase())) return false
    }
    if (statusF === 'active' && r.returned) return false
    if (statusF === 'returned' && !r.returned) return false
    if (purposeF !== 'all' && r.purpose !== purposeF) return false
    const d = kstDate(r.visited_at)
    if (dateFrom && d < dateFrom) return false
    if (dateTo && d > dateTo) return false
    return true
  })
  const cntActive   = filtered.filter(r => !r.returned).length
  const cntReturned = filtered.length - cntActive
  const setPreset = (from: string, to: string) => { setDateFrom(from); setDateTo(to) }

  const groups: Record<string, VisitorLog[]> = {}
  for (const r of filtered) { const k = kstDate(r.visited_at); (groups[k] = groups[k] || []).push(r) }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  const exportExcel = async () => {
    if (filtered.length === 0) { showToast('내보낼 기록이 없습니다.', 'info'); return }
    setExporting(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Visitor Log')
      const headers = ['No.', '이름', '소속', '방문 목적', 'Card', '서명', '방문 일시', '상태', '방문자 메모', '관리자 메모']
      const hr = ws.addRow(headers); hr.height = 24
      hr.alignment = { horizontal: 'center', vertical: 'middle' }
      headers.forEach((_, i) => {
        const c = hr.getCell(i + 1)
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } }
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      })
      ;[6, 14, 18, 10, 10, 24, 16, 10, 22, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w })

      const toB64 = async (path: string): Promise<string | null> => {
        const url = urls[path]; if (!url) return null
        try {
          const buf = await (await fetch(url)).arrayBuffer()
          let bin = ''; const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          return btoa(bin)
        } catch { return null }
      }
      for (let i = 0; i < filtered.length; i++) {
        const r = filtered[i]
        const ts = `${kstDate(r.visited_at)} ${kstTime(r.visited_at)}`
        const row = ws.addRow([i + 1, r.name_text, r.org_text, r.purpose, r.card_no ?? '', '', ts,
          r.returned ? '반납완료' : '방문중', r.visitor_memo ?? '', r.admin_memo ?? ''])
        row.height = 42
        row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        const sig = await toB64(r.sig_img_path)
        if (sig) { const id = wb.addImage({ base64: sig, extension: 'png' }); ws.addImage(id, { tl: { col: 5, row: i + 1 }, ext: { width: 150, height: 36 } }) }
      }
      const buf = await wb.xlsx.writeBuffer()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `visitor_log_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click()
      showToast('다운로드 완료')
    } catch (e) {
      console.error('[visitor-panel] Excel 실패:', e); showToast('Excel 생성에 실패했습니다.', 'error')
    } finally { setExporting(false) }
  }

  // ── 잠금 화면 ──
  if (!unlocked) {
    return (
      <div className="vlp-root">
        <style>{VLP_STYLES}</style>
        <div className="vlp-gate">
          <h3>방문 기록 열람</h3>
          <p>방문로그 전용 비밀번호를 입력해 주세요</p>
          <div className="vlp-pw-row">
            <input type="password" value={pwInput} placeholder="비밀번호"
                   onChange={e => { setPwInput(e.target.value); setPwErr(false) }}
                   onKeyDown={e => { if (e.key === 'Enter') unlock() }} autoFocus />
            <button onClick={unlock} disabled={verifying}>{verifying ? '확인 중...' : '확인'}</button>
          </div>
          {pwErr && <div className="vlp-pw-err">비밀번호가 올바르지 않습니다.</div>}
        </div>
      </div>
    )
  }

  // ── 목록 화면 ──
  return (
    <div className="vlp-root">
      <style>{VLP_STYLES}</style>

      <div className="vlp-summary">
        <div className="vlp-stat"><span className="n">{filtered.length}</span><span className="l">총 기록</span></div>
        <div className="vlp-stat active"><span className="n">{cntActive}</span><span className="l">방문중</span></div>
        <div className="vlp-stat done"><span className="n">{cntReturned}</span><span className="l">반납완료</span></div>
        <div className="vlp-hbtns">
          <button className="vlp-mgmt" onClick={toggleCards}>카드 관리</button>
          <button className="vlp-dl" onClick={exportExcel} disabled={exporting || filtered.length === 0}>{exporting ? '생성 중...' : '↓ Excel'}</button>
        </div>
      </div>

      {/* 카드 관리 */}
      {showCards && (
        <div className="vlp-cards">
          <div className="vlp-cards-add">
            <input value={newCard} maxLength={40} placeholder="새 카드 라벨 (예: VIP-1)"
                   onChange={e => setNewCard(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') addCard() }} />
            <button onClick={addCard} disabled={!newCard.trim()}>추가</button>
          </div>
          <div className="vlp-cards-list">
            {cards.length === 0 ? <div className="vlp-cards-empty">등록된 카드가 없습니다.</div> :
              cards.map(c => (
                <div key={c.label} className="vlp-card-chip">
                  <span className="lbl">{c.label}</span>
                  {c.in_use && <span className="use">사용중</span>}
                  <button className="del" onClick={() => deleteCard(c.label)} disabled={c.in_use}
                          title={c.in_use ? '사용 중인 카드는 삭제할 수 없습니다' : '삭제'}>×</button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="vlp-filters">
        <input className="vlp-search" value={q} placeholder="이름·소속 검색" onChange={e => setQ(e.target.value)} />
        <div className="vlp-frow">
          <select value={statusF} onChange={e => setStatusF(e.target.value as StatusFilter)}>
            <option value="all">상태 전체</option><option value="active">방문중</option><option value="returned">반납완료</option>
          </select>
          <select value={purposeF} onChange={e => setPurposeF(e.target.value as PurposeFilter)}>
            <option value="all">유형 전체</option><option value="점검">점검</option><option value="미팅">미팅</option><option value="기타">기타</option>
          </select>
        </div>
        <div className="vlp-frow">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="vlp-tilde">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="vlp-presets">
          <button onClick={() => setPreset('', '')}>전체</button>
          <button onClick={() => setPreset(daysAgo(0), daysAgo(0))}>오늘</button>
          <button onClick={() => setPreset(daysAgo(6), daysAgo(0))}>7일</button>
          <button onClick={() => setPreset(daysAgo(29), daysAgo(0))}>30일</button>
        </div>
      </div>

      {loading ? (
        <div className="vlp-empty">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="vlp-empty">{logs.length === 0 ? '아직 방문 기록이 없습니다.' : '조건에 맞는 기록이 없습니다.'}</div>
      ) : (
        dates.map(date => (
          <div key={date}>
            <div className="vlp-date">{date}</div>
            {groups[date].map(r => (
              <div key={r.id} className="vlp-card">
                <div className="vlp-top">
                  <div className="vlp-idn">
                    <span className="vlp-name">{r.name_text}</span>
                    <span className="vlp-org">{r.org_text}</span>
                  </div>
                  <span className="vlp-time">{kstTime(r.visited_at)}</span>
                </div>
                <div className="vlp-meta">
                  <span className="vlp-badge purpose">{r.purpose}</span>
                  {r.card_no != null && <span className="vlp-badge card">Card {r.card_no}</span>}
                  <span className={`vlp-badge ${r.returned ? 'returned' : 'inuse'}`}>{r.returned ? '반납완료' : '방문중'}</span>
                </div>
                {r.visitor_memo && <div className="vlp-vmemo">방문자 메모: {r.visitor_memo}</div>}

                {/* 어드민 메모 */}
                {editMemo?.id === r.id ? (
                  <div className="vlp-memo-edit">
                    <textarea value={editMemo.value} rows={2} placeholder="관리자 메모"
                              onChange={e => setEditMemo({ id: r.id, value: e.target.value })} autoFocus />
                    <div className="vlp-memo-btns">
                      <button className="save" onClick={saveMemo}>저장</button>
                      <button className="cancel" onClick={() => setEditMemo(null)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div className="vlp-amemo" onClick={() => setEditMemo({ id: r.id, value: r.admin_memo ?? '' })}>
                    <span className="k">관리자 메모</span>
                    <span className="v">{r.admin_memo || '＋ 추가'}</span>
                  </div>
                )}

                <div className="vlp-bottom">
                  <div className="vlp-sig-wrap" onClick={() => urls[r.sig_img_path] && setViewImg({ url: urls[r.sig_img_path] })}>
                    <span className="vlp-siglabel">서명</span>
                    {urls[r.sig_img_path] && <img className="vlp-sig" src={urls[r.sig_img_path]} alt="서명" />}
                  </div>
                  <div className="vlp-actions">
                    {!r.returned && <button className="vlp-ret" onClick={() => retCard(r.id)}>카드 반납</button>}
                    <button className="vlp-del" onClick={() => delRec(r.id)}>삭제</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {viewImg && (
        <div className="vlp-modal" onClick={e => { if (e.target === e.currentTarget) setViewImg(null) }}>
          <div className="vlp-modal-box">
            <h3>서명 확인</h3>
            <img src={viewImg.url} alt="서명" />
            <button onClick={() => setViewImg(null)}>확인</button>
          </div>
        </div>
      )}
    </div>
  )
}

const VLP_STYLES = `
.vlp-root{--line:#eee;--surface:#fafafa;--t2:#666;--t3:#999;--danger:#cc3333;--success:#22883a;--radius:14px;max-width:680px}
.vlp-gate{text-align:center;padding:48px 20px}
.vlp-gate h3{font-size:15px;font-weight:600;margin-bottom:8px}
.vlp-gate p{font-size:13px;color:var(--t3);margin-bottom:20px}
.vlp-pw-row{display:flex;gap:8px;max-width:280px;margin:0 auto}
.vlp-pw-row input{flex:1;padding:12px 16px;font-size:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.vlp-pw-row input:focus{outline:none;border-color:#111}
.vlp-pw-row button{padding:12px 20px;font-size:14px;font-weight:600;color:#fff;background:#111;border:none;border-radius:var(--radius);cursor:pointer}
.vlp-pw-row button:disabled{opacity:.5;cursor:not-allowed}
.vlp-pw-err{color:var(--danger);font-size:12px;margin-top:10px}
.vlp-summary{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.vlp-stat{display:flex;flex-direction:column;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;min-width:72px}
.vlp-stat .n{font-size:18px;font-weight:700;color:#111}
.vlp-stat .l{font-size:11px;color:var(--t3);margin-top:2px}
.vlp-stat.active .n{color:#3366aa}
.vlp-stat.done .n{color:var(--success)}
.vlp-hbtns{margin-left:auto;display:flex;gap:8px}
.vlp-mgmt,.vlp-dl{padding:8px 16px;font-size:12px;font-weight:500;color:var(--t2);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-dl:disabled{opacity:.5;cursor:not-allowed}
.vlp-cards{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px}
.vlp-cards-add{display:flex;gap:8px;margin-bottom:12px}
.vlp-cards-add input{flex:1;padding:9px 12px;font-size:13px;border:1px solid var(--line);border-radius:10px;background:#fff}
.vlp-cards-add input:focus{outline:none;border-color:#111}
.vlp-cards-add button{padding:9px 18px;font-size:13px;font-weight:600;color:#fff;background:#111;border:none;border-radius:10px;cursor:pointer}
.vlp-cards-add button:disabled{opacity:.4;cursor:not-allowed}
.vlp-cards-list{display:flex;flex-wrap:wrap;gap:8px}
.vlp-cards-empty{font-size:12px;color:var(--t3);padding:4px}
.vlp-card-chip{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;background:#fff;border:1px solid var(--line);border-radius:10px}
.vlp-card-chip .lbl{font-size:13px;font-weight:600;color:#111}
.vlp-card-chip .use{font-size:10px;color:#3366aa;background:#eef4ff;padding:2px 6px;border-radius:5px}
.vlp-card-chip .del{width:20px;height:20px;line-height:1;font-size:15px;color:var(--t3);background:none;border:none;cursor:pointer;border-radius:5px}
.vlp-card-chip .del:disabled{opacity:.3;cursor:not-allowed}
.vlp-card-chip .del:not(:disabled):hover{background:#fdeaea;color:var(--danger)}
.vlp-filters{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px}
.vlp-search{width:100%;padding:10px 14px;font-size:14px;border:1px solid var(--line);border-radius:10px;background:#fff}
.vlp-search:focus{outline:none;border-color:#111}
.vlp-frow{display:flex;gap:8px;align-items:center}
.vlp-frow select,.vlp-frow input[type=date]{flex:1;padding:9px 12px;font-size:13px;border:1px solid var(--line);border-radius:10px;background:#fff;color:#111;font-family:inherit}
.vlp-frow select:focus,.vlp-frow input:focus{outline:none;border-color:#111}
.vlp-tilde{color:var(--t3);flex:none}
.vlp-presets{display:flex;gap:6px}
.vlp-presets button{flex:1;padding:8px;font-size:12px;font-weight:500;color:var(--t2);background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-presets button:hover{border-color:#111;color:#111}
.vlp-date{font-size:12px;font-weight:600;color:var(--t3);padding:16px 0 8px;letter-spacing:.5px}
.vlp-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:10px}
.vlp-top{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.vlp-idn{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.vlp-name{font-size:15px;font-weight:600;color:#111}
.vlp-org{font-size:13px;color:var(--t2)}
.vlp-time{font-size:11px;color:var(--t3);margin-left:auto;font-variant-numeric:tabular-nums}
.vlp-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.vlp-badge{font-size:11px;padding:3px 10px;border-radius:6px;background:var(--surface);color:var(--t2);font-weight:500}
.vlp-badge.purpose{background:#f0f4ff;color:#3366aa}
.vlp-badge.card{background:#fef9ee;color:#997722}
.vlp-badge.inuse{background:#eef4ff;color:#3366aa}
.vlp-badge.returned{background:#eefbf0;color:var(--success)}
.vlp-vmemo{font-size:12px;color:var(--t2);background:var(--surface);border-radius:8px;padding:8px 10px;margin-bottom:8px;line-height:1.5}
.vlp-amemo{display:flex;gap:8px;align-items:center;font-size:12px;padding:8px 10px;border:1px dashed var(--line);border-radius:8px;margin-bottom:12px;cursor:pointer}
.vlp-amemo:hover{border-color:#bbb}
.vlp-amemo .k{color:var(--t3);flex:none}
.vlp-amemo .v{color:#111}
.vlp-memo-edit{margin-bottom:12px}
.vlp-memo-edit textarea{width:100%;padding:10px 12px;font-size:13px;font-family:inherit;border:1px solid #111;border-radius:8px;resize:vertical;line-height:1.5}
.vlp-memo-edit textarea:focus{outline:none}
.vlp-memo-btns{display:flex;gap:8px;margin-top:6px;justify-content:flex-end}
.vlp-memo-btns .save{padding:6px 16px;font-size:12px;font-weight:600;color:#fff;background:#111;border:none;border-radius:8px;cursor:pointer}
.vlp-memo-btns .cancel{padding:6px 16px;font-size:12px;font-weight:500;color:var(--t2);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:12px}
.vlp-sig-wrap{display:flex;align-items:center;gap:8px;cursor:pointer}
.vlp-siglabel{font-size:11px;color:var(--t3)}
.vlp-sig{height:32px;width:88px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.vlp-actions{display:flex;gap:8px}
.vlp-ret{padding:6px 14px;font-size:12px;font-weight:500;color:var(--success);background:#eefbf0;border:none;border-radius:8px;cursor:pointer}
.vlp-del{padding:6px 14px;font-size:12px;font-weight:500;color:var(--t3);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-empty{text-align:center;padding:60px 20px;color:var(--t3);font-size:14px}
.vlp-modal{position:fixed;inset:0;background:rgba(0,0,0,.3);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:1000;display:flex;justify-content:center;align-items:center}
.vlp-modal-box{background:#fff;border-radius:20px;padding:28px;max-width:360px;width:88%;text-align:center}
.vlp-modal-box h3{font-size:16px;font-weight:600;margin-bottom:16px}
.vlp-modal-box img{max-width:100%;border:1px solid var(--line);border-radius:10px;margin-bottom:20px}
.vlp-modal-box button{padding:12px 40px;font-size:14px;font-weight:600;color:#fff;background:#111;border:none;border-radius:var(--radius);cursor:pointer}
`
