/**
 * VisitorKiosk.tsx — 방문 등록 키오스크 (공개 라우트 /visit)  [텍스트 전용 개편]
 *
 * ✅ 정책 (2026-07-10)
 *  - 이름/소속 = 텍스트 입력 (이미지 처리 없음).
 *      · 소속: 기존 소속 자동완성(visitor_org_suggest) — 없으면 직접 입력.
 *  - 서명 = 캔버스 필기 → PNG (동의 증빙). 유일한 이미지.
 *  - 카드 필수(1~10). 사용 중(미반납) 카드는 비활성화(visitor_cards_in_use).
 *      · 동시 제출로 중복되면 서버가 CARD_IN_USE(409) → 안내 + 사용중 목록 갱신.
 *  - 저장: visitor-submit Edge Function (익명). 서명만 Storage 업로드 + DB INSERT.
 */

import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react'

const SB_URL  = import.meta.env.VITE_SUPABASE_URL      as string
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const PURPOSES = ['점검', '미팅', '기타'] as const

// 익명 RPC 호출 (anon key)
async function rpc<T>(name: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method:  'POST',
    headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}`)
  return res.json() as Promise<T>
}

// ─── 서명 캔버스 패드 ────────────────────────────────────────────────────────
interface SigPadHandle { getData: () => string | null; reset: () => void }

const SigPad = forwardRef<SigPadHandle, { placeholder: string }>(({ placeholder }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hasRef    = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    const ctx = cv.getContext('2d')!
    let drawing = false
    const resize = () => {
      const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 2
      cv.width = r.width * dpr; cv.height = r.height * dpr
      ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#222'
    }
    resize()
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = cv.getBoundingClientRect()
      const t = (e as TouchEvent).touches ? (e as TouchEvent).touches[0] : (e as MouseEvent)
      return { x: t.clientX - r.left, y: t.clientY - r.top }
    }
    const start = (e: MouseEvent | TouchEvent) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
    const move  = (e: MouseEvent | TouchEvent) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); if (!hasRef.current) { hasRef.current = true; setEmpty(false) } }
    const end   = () => { drawing = false }
    cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move)
    cv.addEventListener('mouseup', end); cv.addEventListener('mouseleave', end)
    cv.addEventListener('touchstart', start, { passive: false })
    cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', end)
    const onResize = () => { if (!hasRef.current) resize() }
    window.addEventListener('resize', onResize)
    return () => {
      cv.removeEventListener('mousedown', start); cv.removeEventListener('mousemove', move)
      cv.removeEventListener('mouseup', end); cv.removeEventListener('mouseleave', end)
      cv.removeEventListener('touchstart', start); cv.removeEventListener('touchmove', move)
      cv.removeEventListener('touchend', end); window.removeEventListener('resize', onResize)
    }
  }, [])

  const clear = () => {
    const cv = canvasRef.current; if (!cv) return
    cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height); hasRef.current = false; setEmpty(true)
  }
  useImperativeHandle(ref, () => ({
    getData: () => (hasRef.current && canvasRef.current) ? canvasRef.current.toDataURL('image/png') : null,
    reset: clear,
  }))

  return (
    <div className="vk-canvas-box tall">
      <canvas ref={canvasRef} />
      <span className={`vk-cv-ph ${empty ? '' : 'hidden'}`}>{placeholder}</span>
      <button type="button" className="vk-cv-clear" onClick={clear}>지우기</button>
    </div>
  )
})
SigPad.displayName = 'SigPad'

// ─── 키오스크 본체 ────────────────────────────────────────────────────────
export function VisitorKiosk() {
  const sigRef = useRef<SigPadHandle>(null)

  const [name, setName]       = useState('')
  const [org, setOrg]         = useState('')
  const [purpose, setPurpose] = useState('')
  const [cardNo, setCardNo]   = useState('')
  const [usedCards, setUsedCards] = useState<number[]>([])

  const [orgSug, setOrgSug]   = useState<string[]>([])
  const [showSug, setShowSug] = useState(false)
  const orgTimer = useRef<number | undefined>(undefined)

  const [submitting, setSubmitting] = useState(false)
  const [showDone, setShowDone]     = useState(false)
  const [toast, setToast]           = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  // 사용 중 카드 로드
  const loadUsedCards = async () => {
    try { setUsedCards(await rpc<number[]>('visitor_cards_in_use')) } catch { /* 무시 */ }
  }
  useEffect(() => { loadUsedCards() }, [])

  // 소속 자동완성 (디바운스 250ms)
  const onOrgChange = (v: string) => {
    setOrg(v)
    if (orgTimer.current) window.clearTimeout(orgTimer.current)
    const q = v.trim()
    if (!q) { setOrgSug([]); setShowSug(false); return }
    orgTimer.current = window.setTimeout(async () => {
      try {
        const list = await rpc<string[]>('visitor_org_suggest', { p_q: q })
        setOrgSug(list); setShowSug(list.length > 0)
      } catch { setOrgSug([]); setShowSug(false) }
    }, 250)
  }
  const pickOrg = (v: string) => { setOrg(v); setShowSug(false); setOrgSug([]) }

  const handleSubmit = async () => {
    const sig = sigRef.current?.getData() ?? null
    if (!name.trim())    { alert('이름을 입력해 주세요.'); return }
    if (!org.trim())     { alert('소속을 입력해 주세요.'); return }
    if (!purpose)        { alert('방문 목적을 선택해 주세요.'); return }
    if (!cardNo)         { alert('Visitor Card를 선택해 주세요.'); return }
    if (!sig)            { alert('서명을 해주세요.'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`${SB_URL}/functions/v1/visitor-submit`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${SB_ANON}`, apikey: SB_ANON, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name_text: name.trim(), org_text: org.trim(), sig_img: sig,
          purpose, card_no: Number(cardNo),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data?.error === 'CARD_IN_USE') {
        showToast(`Card #${data.card_no}는 방금 사용 중이 되었습니다. 다른 카드를 선택해 주세요.`)
        setCardNo(''); await loadUsedCards()
        return
      }
      if (!res.ok || !data.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      // 성공 초기화
      setName(''); setOrg(''); setPurpose(''); setCardNo('')
      setOrgSug([]); setShowSug(false)
      sigRef.current?.reset()
      await loadUsedCards()          // 방금 대여한 카드 반영
      setShowDone(true)
    } catch (e) {
      console.error('[visitor-kiosk] 제출 실패:', e)
      showToast('저장에 실패했습니다. 네트워크를 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="vk-root">
      <style>{VK_STYLES}</style>

      <div className="vk-header">
        <img className="vk-logo" src="/visitor-logo.png" alt="C&R Research" />
        <div className="vk-htext">
          <h1>Visitor Log</h1>
          <div className="vk-sub">기간 경과 시 개인정보 보호법에 따라 파쇄 폐기 (작성일로부터 1년)</div>
        </div>
      </div>

      <div className="vk-form-wrap">
        <div className="vk-section-label">방문객 정보</div>

        <div className="vk-field">
          <label>이름 <span className="vk-req">*</span></label>
          <input className="vk-input" value={name} maxLength={60}
                 placeholder="이름을 입력해 주세요"
                 onChange={e => setName(e.target.value)} />
        </div>

        <div className="vk-field">
          <label>소속 <span className="vk-req">*</span></label>
          <div className="vk-ac">
            <input className="vk-input" value={org} maxLength={60}
                   placeholder="소속을 입력하면 검색됩니다"
                   onChange={e => onOrgChange(e.target.value)}
                   onFocus={() => { if (orgSug.length) setShowSug(true) }}
                   onBlur={() => setTimeout(() => setShowSug(false), 150)} />
            {showSug && (
              <div className="vk-sug">
                {orgSug.map(s => (
                  <div key={s} className="vk-sug-item" onMouseDown={() => pickOrg(s)}>{s}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="vk-field">
          <label>방문 목적 <span className="vk-req">*</span></label>
          <select className="vk-select" value={purpose} onChange={e => setPurpose(e.target.value)}>
            <option value="">선택해 주세요</option>
            {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="vk-field">
          <label>Visitor Card No. <span className="vk-req">*</span></label>
          <select className="vk-select" value={cardNo} onChange={e => setCardNo(e.target.value)}>
            <option value="">선택해 주세요</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
              const used = usedCards.includes(n)
              return <option key={n} value={n} disabled={used}>{n}{used ? ' (사용 중)' : ''}</option>
            })}
          </select>
        </div>

        <div className="vk-divider" />

        <div className="vk-field">
          <div className="vk-section-label">서명</div>
          <SigPad ref={sigRef} placeholder="서명해 주세요" />
        </div>

        <div className="vk-version">
          <span>Visitor Log · C&amp;R Space</span>
          <span>Effective Date: 01-Jul-2026</span>
        </div>
      </div>

      <div className="vk-submit-area">
        <button className="vk-submit-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '저장 중...' : '저장하기'}
        </button>
      </div>

      {showDone && (
        <div className="vk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDone(false) }}>
          <div className="vk-modal-box">
            <div className="vk-icon success">✓</div>
            <h3>저장 완료</h3>
            <p>방문객 서명이 성공적으로 등록되었습니다.</p>
            <button className="vk-modal-ok" onClick={() => setShowDone(false)}>확인</button>
          </div>
        </div>
      )}

      {toast && <div className="vk-toast show">{toast}</div>}
    </div>
  )
}

// ─── 스코프 스타일 ──────────────────────────────────────────────────────────
const VK_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600&display=swap');
.vk-root{--bg:#fff;--surface:#fafafa;--text:#111;--text-2:#666;--text-3:#999;--line:#eee;--line-2:#e0e0e0;--danger:#cc3333;--success:#22883a;--radius:14px;
  font-family:'Inter','Noto Sans KR',-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
.vk-root *{margin:0;padding:0;box-sizing:border-box}
.vk-header{padding:32px 24px 28px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--line)}
.vk-logo{height:44px;width:auto;flex-shrink:0}
.vk-htext{flex:1}
.vk-header h1{font-family:'Inter',sans-serif;font-size:22px;font-weight:700;letter-spacing:-.5px}
.vk-sub{font-size:11px;color:var(--text-3);font-weight:400;margin-top:2px;letter-spacing:.2px}
.vk-form-wrap{padding:32px 24px 120px;max-width:520px;margin:0 auto}
.vk-section-label{font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:24px}
.vk-field{margin-bottom:28px}
.vk-field label{display:block;font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:8px;letter-spacing:.3px}
.vk-req{color:var(--danger);margin-left:2px}
.vk-input{width:100%;padding:14px 16px;font-family:inherit;font-size:15px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text)}
.vk-input:focus{outline:none;border-color:var(--text)}
.vk-select{width:100%;padding:14px 16px;font-family:inherit;font-size:15px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='%23999'%3E%3Cpath d='M5 6L0 0h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;padding-right:40px}
.vk-select:focus{outline:none;border-color:var(--text)}
.vk-ac{position:relative}
.vk-sug{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--line-2);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08);z-index:30;overflow:hidden;max-height:220px;overflow-y:auto}
.vk-sug-item{padding:12px 16px;font-size:14px;cursor:pointer;border-bottom:1px solid var(--line)}
.vk-sug-item:last-child{border-bottom:none}
.vk-sug-item:hover{background:var(--surface)}
.vk-canvas-box{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:border-color .15s}
.vk-canvas-box:focus-within{border-color:var(--text)}
.vk-canvas-box canvas{display:block;width:100%;cursor:crosshair;touch-action:none}
.vk-canvas-box.tall canvas{height:150px}
.vk-cv-ph{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ccc;font-size:13px;pointer-events:none;transition:opacity .2s}
.vk-cv-ph.hidden{opacity:0}
.vk-cv-clear{position:absolute;top:8px;right:8px;background:none;border:1px solid var(--line-2);border-radius:8px;padding:4px 12px;font-family:inherit;font-size:11px;font-weight:500;color:var(--text-3);cursor:pointer}
.vk-divider{height:1px;background:var(--line);margin:8px 0 28px}
.vk-version{display:flex;justify-content:space-between;font-size:10px;color:#ccc;padding:16px 0 0;letter-spacing:.3px}
.vk-submit-area{position:fixed;bottom:0;left:0;right:0;padding:16px 24px;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:40}
.vk-submit-btn{display:block;width:100%;max-width:520px;margin:0 auto;padding:16px;font-family:inherit;font-size:15px;font-weight:600;color:#fff;background:var(--text);border:none;border-radius:var(--radius);cursor:pointer;letter-spacing:.3px}
.vk-submit-btn:active{opacity:.8}
.vk-submit-btn:disabled{opacity:.4;cursor:not-allowed}
.vk-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100;display:flex;justify-content:center;align-items:center}
.vk-modal-box{background:#fff;border-radius:20px;padding:36px 28px 28px;max-width:360px;width:88%;text-align:center}
.vk-icon{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:20px}
.vk-icon.success{background:#eefbf0;color:var(--success)}
.vk-modal-box h3{font-size:16px;font-weight:600;margin-bottom:6px}
.vk-modal-box p{font-size:13px;color:var(--text-3);margin-bottom:24px}
.vk-modal-ok{padding:12px 40px;font-family:inherit;font-size:14px;font-weight:600;color:#fff;background:var(--text);border:none;border-radius:var(--radius);cursor:pointer}
.vk-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:500;z-index:200;opacity:0;transition:opacity .3s;max-width:90%;text-align:center}
.vk-toast.show{opacity:1}
`
