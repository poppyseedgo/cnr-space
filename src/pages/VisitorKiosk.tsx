/**
 * VisitorKiosk.tsx — 방문 등록 키오스크 (공개 라우트 /visit)
 *
 * ✅ 설계 (2026-07-10, Phase 3)
 *  - 동료가 만든 단일 HTML(visitor-log-secure.html)의 "방문" 폼만 React로 이식.
 *    · 제거: 방문 기록 탭 / 관리자 비밀번호 게이트 / 직접 INSERT / RPC / Excel
 *            → 기록 관리는 Space 관리자 대시보드(Phase 5)로 이관
 *  - 익명 공개: 로그인 불필요. main.tsx가 /visit 경로에서 AuthProvider·로그인 게이트를
 *    거치지 않고 이 컴포넌트를 단독 렌더 (App과 분리된 트리).
 *  - 저장: 직접 Supabase INSERT → visitor-submit Edge Function 호출로 전환.
 *    · Edge Function이 service_role로 Storage 업로드 + visitor_logs INSERT를 원자 처리.
 *    · 익명 클라이언트는 테이블/버킷에 직접 접근하지 않음.
 *  - 디자인: 원본 aesthetic 보존 (Inter/Noto Sans KR, 캔버스 필기 3종, 고정 저장 바,
 *            성공 모달, 토스트). 스타일은 .vk- 접두어로 스코프.
 *  - 로고: 원본 base64 → public/visitor-logo.png 로 추출해 참조.
 *
 * 환경변수: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (게이트웨이 통과용 anon 키)
 */

import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react'

const SB_URL  = import.meta.env.VITE_SUPABASE_URL      as string
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const PURPOSES = ['점검', '미팅', '기타'] as const

// ─── 필기/서명 캔버스 패드 ────────────────────────────────────────────────
//   부모가 ref로 getData()(비었으면 null) / reset() 호출.
interface SigPadHandle {
  getData: () => string | null
  reset:   () => void
}
interface SigPadProps {
  placeholder: string
  tall?:       boolean   // 서명은 tall(150px), 이름/소속은 short(72px)
}

const SigPad = forwardRef<SigPadHandle, SigPadProps>(({ placeholder, tall }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hasRef    = useRef(false)          // 획이 있는지 (렌더 밖 즉시 참조용)
  const [empty, setEmpty] = useState(true) // placeholder 표시용 state

  // ── 캔버스 초기화 + 그리기 이벤트 (마운트 1회) ──
  useEffect(() => {
    const cv  = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    let drawing = false

    // DPR 대응 리사이즈 — 표시폭 기준으로 내부 해상도 스케일
    const resize = () => {
      const r   = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 2
      cv.width  = r.width  * dpr
      cv.height = r.height * dpr
      ctx.scale(dpr, dpr)
      ctx.lineCap  = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth   = 1.6
      ctx.strokeStyle = '#222'
    }
    resize()

    const pos = (e: MouseEvent | TouchEvent) => {
      const r = cv.getBoundingClientRect()
      const t = (e as TouchEvent).touches ? (e as TouchEvent).touches[0] : (e as MouseEvent)
      return { x: t.clientX - r.left, y: t.clientY - r.top }
    }
    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); drawing = true
      const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }
    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return
      e.preventDefault()
      const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke()
      if (!hasRef.current) { hasRef.current = true; setEmpty(false) }
    }
    const end = () => { drawing = false }

    cv.addEventListener('mousedown', start)
    cv.addEventListener('mousemove', move)
    cv.addEventListener('mouseup', end)
    cv.addEventListener('mouseleave', end)
    cv.addEventListener('touchstart', start, { passive: false })
    cv.addEventListener('touchmove', move, { passive: false })
    cv.addEventListener('touchend', end)

    // 빈 상태에서만 리사이즈 재적용 (그린 뒤 리사이즈하면 내용 지워지므로)
    const onResize = () => { if (!hasRef.current) resize() }
    window.addEventListener('resize', onResize)

    return () => {
      cv.removeEventListener('mousedown', start)
      cv.removeEventListener('mousemove', move)
      cv.removeEventListener('mouseup', end)
      cv.removeEventListener('mouseleave', end)
      cv.removeEventListener('touchstart', start)
      cv.removeEventListener('touchmove', move)
      cv.removeEventListener('touchend', end)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const clear = () => {
    const cv = canvasRef.current; if (!cv) return
    cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height)
    hasRef.current = false; setEmpty(true)
  }

  useImperativeHandle(ref, () => ({
    getData: () => (hasRef.current && canvasRef.current)
      ? canvasRef.current.toDataURL('image/png')
      : null,
    reset: clear,
  }))

  return (
    <div className={`vk-canvas-box ${tall ? 'tall' : 'short'}`}>
      <canvas ref={canvasRef} />
      <span className={`vk-cv-ph ${empty ? '' : 'hidden'}`}>{placeholder}</span>
      <button type="button" className="vk-cv-clear" onClick={clear}>지우기</button>
    </div>
  )
})
SigPad.displayName = 'SigPad'

// ─── 키오스크 본체 ────────────────────────────────────────────────────────
export function VisitorKiosk() {
  const nameRef = useRef<SigPadHandle>(null)
  const orgRef  = useRef<SigPadHandle>(null)
  const sigRef  = useRef<SigPadHandle>(null)

  const [purpose, setPurpose] = useState('')
  const [cardNo,  setCardNo]  = useState('')       // '' = 미대여
  const [submitting, setSubmitting] = useState(false)
  const [showDone,   setShowDone]   = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 2500)
  }

  const handleSubmit = async () => {
    const n = nameRef.current?.getData() ?? null
    const o = orgRef.current?.getData()  ?? null
    const s = sigRef.current?.getData()  ?? null

    if (!n) { alert('이름을 작성해 주세요.'); return }
    if (!o) { alert('소속을 작성해 주세요.'); return }
    if (!purpose) { alert('방문 목적을 선택해 주세요.'); return }
    if (!s) { alert('서명을 해주세요.'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`${SB_URL}/functions/v1/visitor-submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SB_ANON}`,
          'apikey':        SB_ANON,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          name_img: n,
          org_img:  o,
          sig_img:  s,
          purpose,
          card_no:  cardNo === '' ? null : Number(cardNo),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      // 초기화 + 성공 모달
      nameRef.current?.reset(); orgRef.current?.reset(); sigRef.current?.reset()
      setPurpose(''); setCardNo('')
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

      {/* 헤더 */}
      <div className="vk-header">
        <img className="vk-logo" src="/visitor-logo.png" alt="C&R Research" />
        <div className="vk-htext">
          <h1>Visitor Log</h1>
          <div className="vk-sub">기간 경과 시 개인정보 보호법에 따라 파쇄 폐기 (작성일로부터 1년)</div>
        </div>
      </div>

      {/* 폼 */}
      <div className="vk-form-wrap">
        <div className="vk-section-label">방문객 정보</div>

        <div className="vk-field">
          <label>이름 <span className="vk-req">*</span></label>
          <SigPad ref={nameRef} placeholder="이름을 작성해 주세요" />
        </div>

        <div className="vk-field">
          <label>소속 <span className="vk-req">*</span></label>
          <SigPad ref={orgRef} placeholder="소속을 작성해 주세요" />
        </div>

        <div className="vk-field">
          <label>방문 목적 <span className="vk-req">*</span></label>
          <select className="vk-select" value={purpose} onChange={e => setPurpose(e.target.value)}>
            <option value="">선택해 주세요</option>
            {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="vk-field">
          <label>Visitor Card No.</label>
          <select className="vk-select" value={cardNo} onChange={e => setCardNo(e.target.value)}>
            <option value="">선택하지 않음</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
              <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="vk-divider" />

        <div className="vk-field">
          <div className="vk-section-label">서명</div>
          <SigPad ref={sigRef} placeholder="서명해 주세요" tall />
        </div>

        <div className="vk-version">
          <span>Visitor Log · C&amp;R Space</span>
          <span>Effective Date: 01-Jul-2026</span>
        </div>
      </div>

      {/* 고정 저장 바 */}
      <div className="vk-submit-area">
        <button className="vk-submit-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '저장 중...' : '저장하기'}
        </button>
      </div>

      {/* 성공 모달 */}
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

      {/* 토스트 */}
      {toast && <div className="vk-toast show">{toast}</div>}
    </div>
  )
}

// ─── 스코프 스타일 (.vk- 접두어) — 원본 aesthetic 보존 ──────────────────────
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
.vk-select{width:100%;padding:14px 16px;font-family:inherit;font-size:15px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='%23999'%3E%3Cpath d='M5 6L0 0h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;padding-right:40px}
.vk-select:focus{outline:none;border-color:var(--text)}
.vk-canvas-box{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:border-color .15s}
.vk-canvas-box:focus-within{border-color:var(--text)}
.vk-canvas-box canvas{display:block;width:100%;cursor:crosshair;touch-action:none}
.vk-canvas-box.short canvas{height:72px}
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
.vk-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:500;z-index:200;opacity:0;transition:opacity .3s}
.vk-toast.show{opacity:1}
`
