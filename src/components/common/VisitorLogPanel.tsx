/**
 * VisitorLogPanel.tsx — 방문로그 관리 (Admin '방문 기록' 탭)
 *
 * ✅ 설계 (2026-07-10, Phase 5)
 *  - Space 관리자 대시보드에 통합. AdminView가 activeTab==='visitors'일 때 렌더.
 *  - 2단계 인증: 이미 role=ADMIN 게이트 안(Admin 페이지) + 여기서 2차 비밀번호 잠금해제.
 *    · 잠금해제/조회/반납/삭제 모두 서버(RPC/Edge)에서 visitor_verify_access로 재검증.
 *    · pw는 잠금해제 후 메모리 state로 유지, 매 호출에 첨부 (stateless 검증).
 *  - 이미지: Storage 경로 → signed URL(만료 10분) 일괄 생성 후 표시/모달 확대.
 *  - 반납: visitor_admin_return_card / 삭제: visitor-admin-delete(Edge, Storage+DB 원자).
 *  - Excel: exceljs 지연 로드(별도 청크). 이름/소속/서명 이미지 임베드 (원본 HTML 로직 이식).
 *  - 스타일: 원본 record-card aesthetic 보존, .vlp- 접두어로 스코프.
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

// visited_at(UTC) → KST 기준 표시 (관리자 브라우저 로컬=KST 가정, 원본 동작과 동일)
function kstDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function kstTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function VisitorLogPanel({ showToast }: Props) {
  const [unlocked, setUnlocked] = useState(false)
  const [pw, setPw]             = useState('')       // 잠금해제 성공 후 유지
  const [pwInput, setPwInput]   = useState('')
  const [pwErr, setPwErr]       = useState(false)
  const [verifying, setVerifying] = useState(false)

  const [logs, setLogs]     = useState<VisitorLog[]>([])
  const [urls, setUrls]     = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const [viewImg, setViewImg] = useState<{ title: string; url: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  // ── 잠금해제 ──
  const unlock = async () => {
    if (!pwInput) return
    setVerifying(true); setPwErr(false)
    try {
      const ok = await visitorVerifyAccess(pwInput)
      if (!ok) { setPwErr(true); return }
      setPw(pwInput); setUnlocked(true)
      await loadLogs(pwInput)
    } catch {
      setPwErr(true)
    } finally {
      setVerifying(false)
    }
  }

  // ── 목록 로드 + signed URL 생성 ──
  const loadLogs = async (pwArg: string) => {
    setLoading(true)
    try {
      const rows = await visitorListLogs(pwArg)
      setLogs(rows)
      const paths = rows.flatMap(r => [r.name_img_path, r.org_img_path, r.sig_img_path])
      setUrls(await visitorSignedUrls(paths))
    } catch (e) {
      console.error('[visitor-panel] 로드 실패:', e)
      showToast('방문 기록을 불러오지 못했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── 카드 반납 ──
  const retCard = async (id: string) => {
    try {
      const done = await visitorReturnCard(pw, id)
      if (done) {
        setLogs(prev => prev.map(r => r.id === id
          ? { ...r, returned: true, returned_at: new Date().toISOString() } : r))
        showToast('반납 처리되었습니다.')
      } else {
        showToast('이미 반납되었거나 카드가 없는 기록입니다.', 'info')
      }
    } catch {
      showToast('처리에 실패했습니다.', 'error')
    }
  }

  // ── 삭제 ──
  const delRec = async (id: string) => {
    if (!window.confirm('이 기록을 삭제하시겠습니까? (이미지도 함께 삭제됩니다)')) return
    try {
      await visitorDeleteLog(pw, id)
      setLogs(prev => prev.filter(r => r.id !== id))
      showToast('삭제되었습니다.')
    } catch {
      showToast('삭제에 실패했습니다.', 'error')
    }
  }

  // ── Excel 내보내기 (exceljs 지연 로드) ──
  const exportExcel = async () => {
    if (logs.length === 0) { showToast('기록이 없습니다.', 'info'); return }
    setExporting(true)
    try {
      const mod: any = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Visitor Log')

      const headers = ['No.', '이름', '소속', '방문 목적', 'Card No.', '서명', '방문 일시', '반납여부']
      const hr = ws.addRow(headers)
      hr.height = 24
      hr.alignment = { horizontal: 'center', vertical: 'middle' }
      headers.forEach((_, i) => {
        const c = hr.getCell(i + 1)
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } }
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      })
      const widths = [6, 22, 22, 12, 10, 26, 18, 10]
      widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

      // signed URL → base64 (임베드용)
      const toB64 = async (path: string): Promise<string | null> => {
        const url = urls[path]
        if (!url) return null
        try {
          const res = await fetch(url)
          const buf = await res.arrayBuffer()
          let bin = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          return btoa(bin)
        } catch { return null }
      }

      for (let i = 0; i < logs.length; i++) {
        const r = logs[i]
        const ts = `${kstDate(r.visited_at)} ${kstTime(r.visited_at)}`
        const rowIdx = i + 2
        const row = ws.addRow([i + 1, '', '', r.purpose, r.card_no ?? '', '', ts, r.returned ? 'Y' : 'N'])
        row.height = 45
        row.alignment = { vertical: 'middle', horizontal: 'center' }
        const [n, o, s] = await Promise.all([
          toB64(r.name_img_path), toB64(r.org_img_path), toB64(r.sig_img_path),
        ])
        if (n) { const id = wb.addImage({ base64: n, extension: 'png' }); ws.addImage(id, { tl: { col: 1, row: rowIdx - 1 }, ext: { width: 140, height: 38 } }) }
        if (o) { const id = wb.addImage({ base64: o, extension: 'png' }); ws.addImage(id, { tl: { col: 2, row: rowIdx - 1 }, ext: { width: 140, height: 38 } }) }
        if (s) { const id = wb.addImage({ base64: s, extension: 'png' }); ws.addImage(id, { tl: { col: 5, row: rowIdx - 1 }, ext: { width: 160, height: 38 } }) }
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
    } finally {
      setExporting(false)
    }
  }

  // ── 날짜별 그룹 ──
  const groups: Record<string, VisitorLog[]> = {}
  for (const r of logs) {
    const k = kstDate(r.visited_at);
    (groups[k] = groups[k] || []).push(r)
  }
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  // ── 잠금 화면 ──
  if (!unlocked) {
    return (
      <div className="vlp-root">
        <style>{VLP_STYLES}</style>
        <div className="vlp-gate">
          <h3>방문 기록 열람</h3>
          <p>방문로그 전용 비밀번호를 입력해 주세요</p>
          <div className="vlp-pw-row">
            <input
              type="password"
              value={pwInput}
              placeholder="비밀번호"
              onChange={e => { setPwInput(e.target.value); setPwErr(false) }}
              onKeyDown={e => { if (e.key === 'Enter') unlock() }}
              autoFocus
            />
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

      <div className="vlp-header">
        <div className="vlp-count">총 <strong>{logs.length}</strong>건</div>
        <button className="vlp-dl" onClick={exportExcel} disabled={exporting || logs.length === 0}>
          {exporting ? '생성 중...' : '↓ Excel'}
        </button>
      </div>

      {loading ? (
        <div className="vlp-empty">불러오는 중...</div>
      ) : logs.length === 0 ? (
        <div className="vlp-empty">아직 방문 기록이 없습니다.</div>
      ) : (
        dates.map(date => (
          <div key={date}>
            <div className="vlp-date">{date}</div>
            {groups[date].map(r => (
              <div key={r.id} className="vlp-card">
                <div className="vlp-row">
                  <span className="vlp-label">이름</span>
                  <img className="vlp-hw" src={urls[r.name_img_path]} alt="이름"
                       onClick={() => setViewImg({ title: '이름', url: urls[r.name_img_path] })} />
                  <span className="vlp-time">{kstTime(r.visited_at)}</span>
                </div>
                <div className="vlp-row">
                  <span className="vlp-label">소속</span>
                  <img className="vlp-hw" src={urls[r.org_img_path]} alt="소속"
                       onClick={() => setViewImg({ title: '소속', url: urls[r.org_img_path] })} />
                </div>
                <div className="vlp-meta">
                  <span className="vlp-badge purpose">{r.purpose}</span>
                  {r.card_no != null && <span className="vlp-badge card">Card #{r.card_no}</span>}
                  {r.returned && <span className="vlp-badge returned">반납완료</span>}
                </div>
                <div className="vlp-row">
                  <span className="vlp-label">서명</span>
                  <img className="vlp-hw sig" src={urls[r.sig_img_path]} alt="서명"
                       onClick={() => setViewImg({ title: '서명', url: urls[r.sig_img_path] })} />
                </div>
                <div className="vlp-actions">
                  {r.card_no != null && !r.returned &&
                    <button className="vlp-ret" onClick={() => retCard(r.id)}>카드 반납</button>}
                  <button className="vlp-del" onClick={() => delRec(r.id)}>삭제</button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {/* 이미지 확대 모달 */}
      {viewImg && (
        <div className="vlp-modal" onClick={e => { if (e.target === e.currentTarget) setViewImg(null) }}>
          <div className="vlp-modal-box">
            <h3>{viewImg.title} 확인</h3>
            <img src={viewImg.url} alt={viewImg.title} />
            <button onClick={() => setViewImg(null)}>확인</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 스코프 스타일 ──────────────────────────────────────────────────────────
const VLP_STYLES = `
.vlp-root{--line:#eee;--surface:#fafafa;--t2:#666;--t3:#999;--danger:#cc3333;--success:#22883a;--radius:14px;max-width:640px}
.vlp-gate{text-align:center;padding:48px 20px}
.vlp-gate h3{font-size:15px;font-weight:600;margin-bottom:8px}
.vlp-gate p{font-size:13px;color:var(--t3);margin-bottom:20px}
.vlp-pw-row{display:flex;gap:8px;max-width:280px;margin:0 auto}
.vlp-pw-row input{flex:1;padding:12px 16px;font-size:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.vlp-pw-row input:focus{outline:none;border-color:#111}
.vlp-pw-row button{padding:12px 20px;font-size:14px;font-weight:600;color:#fff;background:#111;border:none;border-radius:var(--radius);cursor:pointer}
.vlp-pw-row button:disabled{opacity:.5;cursor:not-allowed}
.vlp-pw-err{color:var(--danger);font-size:12px;margin-top:10px}
.vlp-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.vlp-count{font-size:13px;color:var(--t3)}
.vlp-count strong{color:#111;font-weight:600}
.vlp-dl{padding:8px 16px;font-size:12px;font-weight:500;color:var(--t2);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-dl:disabled{opacity:.5;cursor:not-allowed}
.vlp-date{font-size:12px;font-weight:600;color:var(--t3);padding:16px 0 8px;letter-spacing:.5px}
.vlp-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:10px}
.vlp-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.vlp-label{font-size:11px;color:var(--t3);font-weight:500;min-width:32px;letter-spacing:.3px}
.vlp-hw{height:28px;border:1px solid var(--line);border-radius:6px;background:var(--surface);cursor:pointer}
.vlp-hw.sig{height:36px;width:96px;object-fit:contain}
.vlp-time{font-size:11px;color:var(--t3);margin-left:auto;font-variant-numeric:tabular-nums}
.vlp-meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.vlp-badge{font-size:11px;padding:3px 10px;border-radius:6px;background:var(--surface);color:var(--t2);font-weight:500}
.vlp-badge.purpose{background:#f0f4ff;color:#3366aa}
.vlp-badge.card{background:#fef9ee;color:#997722}
.vlp-badge.returned{background:#eefbf0;color:var(--success)}
.vlp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.vlp-ret{padding:6px 14px;font-size:12px;font-weight:500;color:var(--success);background:#eefbf0;border:none;border-radius:8px;cursor:pointer}
.vlp-del{padding:6px 14px;font-size:12px;font-weight:500;color:var(--t3);background:var(--surface);border:1px solid var(--line);border-radius:8px;cursor:pointer}
.vlp-empty{text-align:center;padding:60px 20px;color:var(--t3);font-size:14px}
.vlp-modal{position:fixed;inset:0;background:rgba(0,0,0,.3);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:1000;display:flex;justify-content:center;align-items:center}
.vlp-modal-box{background:#fff;border-radius:20px;padding:28px;max-width:360px;width:88%;text-align:center}
.vlp-modal-box h3{font-size:16px;font-weight:600;margin-bottom:16px}
.vlp-modal-box img{max-width:100%;border:1px solid var(--line);border-radius:10px;margin-bottom:20px}
.vlp-modal-box button{padding:12px 40px;font-size:14px;font-weight:600;color:#fff;background:#111;border:none;border-radius:var(--radius);cursor:pointer}
`
