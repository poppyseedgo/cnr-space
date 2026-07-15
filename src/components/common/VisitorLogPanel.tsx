/**
 * VisitorLogPanel.tsx — 방문로그 관리 (Admin '방문 기록' 탭)  [텍스트/필터 개편]
 *
 * ✅ 개편 (2026-07-10)
 *  - 이름/소속: 텍스트 표시 (이미지 제거). 서명만 이미지(signed URL).
 *  - status: 방문중(미반납) / 반납완료. 상단 요약 카운트.
 *  - 검색/필터: 이름·소속 검색 + 상태 + 방문유형 + 날짜(from~to, 프리셋).
 *  - 반납/삭제/Excel 유지. Excel은 이름·소속 텍스트 셀 + 서명 이미지 임베드.
 *  - 인증: 2차 비밀번호 잠금 → 서버(RPC/Edge)에서 매 호출 재검증.
 */

import { useState } from 'react'
import {
  visitorVerifyAccess, visitorListLogs, visitorReturnCard, visitorDeleteLog,
  visitorSignedUrls, type VisitorLog,
} from '../../lib/api'

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
// 오늘 기준 n일 전 yyyy-mm-dd
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return kstDate(d.toISOString())
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

  // 필터 상태
  const [q, setQ]                 = useState('')
  const [statusF, setStatusF]     = useState<StatusFilter>('all')
  const [purposeF, setPurposeF]   = useState<PurposeFilter>('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')

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

  const retCard = async (id: string) => {
    try {
      const done = await visitorReturnCard(pw, id)
      if (done) {
        setLogs(prev => prev.map(r => r.id === id
          ? { ...r, returned: true, returned_at: new Date().toISOString() } : r))
        showToast('반납 처리되었습니다.')
      } else {
        showToast('이미 반납된 기록입니다.', 'info')
      }
    } catch { showToast('처리에 실패했습니다.', 'error') }
  }

  const delRec = async (id: string) => {
    if (!window.confirm('이 기록을 삭제하시겠습니까? (서명 이미지도 함께 삭제됩니다)')) return
    try {
      await visitorDeleteLog(pw, id)
      setLogs(prev => prev.filter(r => r.id !== id))
      showToast('삭제되었습니다.')
    } catch { showToast('삭제에 실패했습니다.', 'error') }
  }

  // ── 필터 적용 ──
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

  // 날짜별 그룹
  const groups: Record<string, VisitorLog[]> = {}
  for (const r of filtered) { const k = kstDate(r.visited_at); (groups[k] = groups[k] || []).push(r) }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  // ── Excel ──
  const exportExcel = async () => {
    if (filtered.length === 0) { showToast('내보낼 기록이 없습니다.', 'info'); return }
    setExporting(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Visitor Log')

      const headers = ['No.', '이름', '소속', '방문 목적', 'Card No.', '서명', '방문 일시', '상태']
      const hr = ws.addRow(headers); hr.height = 24
      hr.alignment = { horizontal: 'center', vertical: 'middle' }
      headers.forEach((_, i) => {
        const c = hr.getCell(i + 1)
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } }
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      })
      ;[6, 16, 20, 12, 10, 26, 18, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w })

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
        const status = r.returned ? '반납완료' : '방문중'
        const row = ws.addRow([i + 1, r.name_text, r.org_text, r.purpose, r.card_no ?? '', '', ts, status])
        row.height = 42
        row.alignment = { vertical: 'middle', horizontal: 'center' }
        const sig = await toB64(r.sig_img_path)
        if (sig) {
          const imgId = wb.addImage({ base64: sig, extension: 'png' })
          ws.addImage(imgId, { tl: { col: 5, row: i + 1 }, ext: { width: 160, height: 36 } })
        }
      }

      const buf = await wb.xlsx.writeBuffer()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `visitor_log_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      showToast('다운로드 완료')
    } catch (e) {
      console.error('[visitor-panel] Excel 실패:', e)
      showToast('Excel 생성에 실패했습니다.', 'error')
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

      {/* 요약 */}
      <div className="vlp-summary">
        <div className="vlp-stat"><span className="n">{filtered.length}</span><span className="l">총 기록</span></div>
        <div className="vlp-stat active"><span className="n">{cntActive}</span><span className="l">방문중</span></div>
        <div className="vlp-stat done"><span className="n">{cntReturned}</span><span className="l">반납완료</span></div>
        <button className="vlp-dl" onClick={exportExcel} disabled={exporting || filtered.length === 0}>
          {exporting ? '생성 중...' : '↓ Excel'}
        </button>
      </div>

      {/* 필터 바 */}
      <div className="vlp-filters">
        <input className="vlp-search" value={q} placeholder="이름·소속 검색"
               onChange={e => setQ(e.target.value)} />
        <div className="vlp-frow">
          <select value={statusF} onChange={e => setStatusF(e.target.value as StatusFilter)}>
            <option value="all">상태 전체</option>
            <option value="active">방문중</option>
            <option value="returned">반납완료</option>
          </select>
          <select value={purposeF} onChange={e => setPurposeF(e.target.value as PurposeFilter)}>
            <option value="all">유형 전체</option>
            <option value="점검">점검</option>
            <option value="미팅">미팅</option>
            <option value="기타">기타</option>
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
                  {r.card_no != null && <span className="vlp-badge card">Card #{r.card_no}</span>}
                  <span className={`vlp-badge ${r.returned ? 'returned' : 'inuse'}`}>
                    {r.returned ? '반납완료' : '방문중'}
                  </span>
                </div>
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

// ─── 스코프 스타일 ──────────────────────────────────────────────────────────
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
.vlp-summary{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.vlp-stat{display:flex;flex-direction:column;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;min-width:72px}
.vlp-stat .n{font-size:18px;font-weight:700;color:#111}
.vlp-stat .l{font-size:11px;color:var(--t3);margin-top:2px}
.vlp-stat.active .n{color:#3366aa}
.vlp-stat.done .n{color:var(--success)}
.vlp-dl{margin-left:auto;padding:8px 16px;font-size:12px;font-weight:500;color:var(--t2);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-dl:disabled{opacity:.5;cursor:not-allowed}
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
.vlp-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.vlp-badge{font-size:11px;padding:3px 10px;border-radius:6px;background:var(--surface);color:var(--t2);font-weight:500}
.vlp-badge.purpose{background:#f0f4ff;color:#3366aa}
.vlp-badge.card{background:#fef9ee;color:#997722}
.vlp-badge.inuse{background:#eef4ff;color:#3366aa}
.vlp-badge.returned{background:#eefbf0;color:var(--success)}
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
