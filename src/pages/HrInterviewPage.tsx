// ============================================================
// HrInterviewPage — 근태 APP 내재화 HR 1차 인터뷰 (임시 단독 페이지, #hr-interview)
// [2026-09-03] 신규 — Figma DgaNxRBXRAn65opFAZf3cG / 7:750 (시작 1:7 · 답변전 1:546 · 답변후 5:118)
//
// 구성
//   · 시작 화면(검정) → [인터뷰 답변 하기] → 문항 화면
//   · 좌측 인덱스(0=시작 화면 복귀 + 문항 수만큼 동적) / 우측 720px: 번호+상태칩 → 조사목적 → 질문 → 입력/열람
//   · 상태칩: submitted = 답변완료(#d0ffb7) / 그 외 = 답변하세요 (Figma 2종만 존재)
//   · 편집 모드: textarea(Enter=줄바꿈) + 이미지 첨부(다중) + 미리보기 + 저장하기
//   · 이탈 방지: 입력 즉시 localStorage + 1.5s debounce DB draft + blur/hidden/unmount 시 flush
//   · 저장하기 → status=submitted → 열람 모드 → [답변 편집하기] 로 재편집
//   · 접근: 로그인 사용자 전원 — [2026-09-03 고지 지시] 화이트리스트 게이트 폐기 (RLS 가 본인 행만 허용)
//   · [2026-09-03 A안] 관리자(hr_interview_is_admin() RPC)에게만 인덱스 '현황' 행 → HrInterviewStatusView (참여자×문항 매트릭스)
//   · 문항 7개 — Figma 3·5번 중복으로 3번을 5번 내용으로 대체, 5번 삭제
// 의존: useAuth().currentUser { user_id, ... } / hrInterviewApi / hrInterviewQuestions
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { HR_INTERVIEW_QUESTIONS, HR_INTERVIEW_TITLE_LINE1, HR_INTERVIEW_TITLE_LINE2_EN, HR_INTERVIEW_TITLE_LINE2_KO } from '../data/hrInterviewQuestions'
import type { HrInterviewAnswerRow, HrInterviewQuestion } from '../types/hrInterview'
import HrInterviewStatusView from './HrInterviewStatusView'
import {
  fetchMyHrAnswers, upsertHrAnswer, fetchHrInterviewIsAdmin,
  uploadHrImage, removeHrImage, signHrImages,
  readLocalDraft, writeLocalDraft, clearLocalDraft,
  HR_IMAGE_MIME,
} from '../lib/hrInterviewApi'
import './HrInterviewPage.css'

const DRAFT_DEBOUNCE_MS = 1500
const ASSET_BASE = '/hr-interview'   // public/hr-interview/*.svg (Figma 원본 SVG export)
const STATUS_VIEW_ID = '__status'    // 인덱스 '현황' 행의 currentId 값 (문항 id 와 충돌 없음)

type Mode = 'edit' | 'preview' | 'view'
type AnswerMap = Record<string, HrInterviewAnswerRow>

// ─────────────────────────────────────────────────────────────
// 페이지 루트
// ─────────────────────────────────────────────────────────────
export default function HrInterviewPage() {
  const { currentUser } = useAuth()
  const uid = currentUser?.user_id ?? null

  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)   // ← [A안] RLS 와 동일 RPC 판정 결과
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)  // null = 시작 화면

  useEffect(() => {
    if (!uid) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchMyHrAnswers(uid)
        if (!alive) return
        const map: AnswerMap = {}
        for (const r of rows) map[r.question_id] = r
        setAnswers(map)
        setReady(true)
        // 관리자 판정은 실패해도 페이지 동작에 영향 없음(현황 행만 미노출)
        fetchHrInterviewIsAdmin().then(v => { if (alive) setIsAdmin(v) }).catch(() => {})
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { alive = false }
  }, [uid])

  const onSaved = useCallback((row: HrInterviewAnswerRow) => {
    setAnswers(prev => ({ ...prev, [row.question_id]: row }))
  }, [])

  if (!uid) return null
  if (loadErr) return <Gate msg={`불러오기에 실패했습니다. ${loadErr}`} />
  if (!ready) return <div className="hri-root" />

  if (currentId === null) {
    return <StartScreen onStart={() => setCurrentId(HR_INTERVIEW_QUESTIONS[0].id)} />
  }

  const isStatus = isAdmin && currentId === STATUS_VIEW_ID   // ← [A안] 비관리자가 URL/상태로 진입해도 문항 1 로 폴백
  const q = HR_INTERVIEW_QUESTIONS.find(x => x.id === currentId) ?? HR_INTERVIEW_QUESTIONS[0]

  return (
    <div className="hri-root">
      <div className="hri-body">
        <nav className="hri-side" aria-label="문항 목록">
          {/* ← [2026-09-03 고지 지시] '0' 단계 — 시작 화면으로 복귀 (Figma 인덱스 0 행과 동일 스타일, 항상 비활성 톤) */}
          <button
            type="button"
            className="hri-side-row hri-is"
            onClick={() => setCurrentId(null)}
            aria-label="시작 화면으로"
          >
            <span>0</span><span className="hri-ln" />
          </button>
          {HR_INTERVIEW_QUESTIONS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`hri-side-row hri-is${!isStatus && item.id === q.id ? ' is-on' : ''}`}
              onClick={() => setCurrentId(item.id)}
              aria-current={!isStatus && item.id === q.id ? 'page' : undefined}
            >
              <span>{item.no}</span><span className="hri-ln" />
            </button>
          ))}
          {isAdmin && (
            // ← [A안] 관리자 전용 '현황' 행 — 문항 목록 아래, 동일 스타일
            <button
              type="button"
              className={`hri-side-row hri-side-row-ko${isStatus ? ' is-on' : ''}`}
              onClick={() => setCurrentId(STATUS_VIEW_ID)}
              aria-current={isStatus ? 'page' : undefined}
            >
              <span>현황</span><span className="hri-ln" />
            </button>
          )}
        </nav>

        <main className="hri-main">
          {isStatus
            ? <HrInterviewStatusView />
            : <QuestionBlock
                key={q.id}
                uid={uid}
                question={q}
                row={answers[q.id]}
                onSaved={onSaved}
              />}
        </main>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 시작 화면 (1:7)
// ─────────────────────────────────────────────────────────────
function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="hri-start">
      <h1 className="hri-start-title">
        {HR_INTERVIEW_TITLE_LINE1}<br />
        <span className="hri-is">{HR_INTERVIEW_TITLE_LINE2_EN}</span>{HR_INTERVIEW_TITLE_LINE2_KO}
      </h1>
      <button type="button" className="hri-start-cta" onClick={onStart}>인터뷰 답변 하기</button>
      <div className="hri-start-foot">
        <img className="hri-start-tagline" src={`${ASSET_BASE}/cnr-tagline.svg`} alt="Clinical trial Regulatory Affairs Research" />
        <div className="hri-start-logorow">
          <span className="hri-ln" />
          <span className="hri-start-logos">
            <img src={`${ASSET_BASE}/cnr-logo-mark.svg`} width={94.17} height={29.44} alt="" />
            <img src={`${ASSET_BASE}/cnr-logo-word.svg`} width={222.87} height={30} alt="C&R Research" />
          </span>
          <span className="hri-ln" />
        </div>
      </div>
    </div>
  )
}

function Gate({ msg }: { msg: string }) {
  return (
    <div className="hri-gate">
      <p>{msg}</p>
      <a href="#home">홈으로</a>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 문항 블록 — 헤더(번호/칩/목적/질문) + 편집·미리보기·열람
// ─────────────────────────────────────────────────────────────
interface QuestionBlockProps {
  uid: string
  question: HrInterviewQuestion
  row: HrInterviewAnswerRow | undefined
  onSaved: (row: HrInterviewAnswerRow) => void
}

function QuestionBlock({ uid, question: q, row, onSaved }: QuestionBlockProps) {
  const submitted = row?.status === 'submitted'

  // 초기값: localStorage 임시본이 DB 보다 최신이면 임시본 우선 (이탈 복구)
  const initial = useMemo(() => {
    const local = readLocalDraft(uid, q.id)
    const dbTs = row ? new Date(row.updated_at).getTime() : 0
    if (local && local.saved_at > dbTs) return { content: local.content, images: local.image_paths, fromLocal: true }
    return { content: row?.content ?? '', images: row?.image_paths ?? [], fromLocal: false }
  }, [uid, q.id, row?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  const [mode, setMode] = useState<Mode>(submitted && !initial.fromLocal ? 'view' : 'edit')
  const [content, setContent] = useState(initial.content)
  const [images, setImages] = useState<string[]>(initial.images)
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'' | 'upload' | 'save'>('')
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null)

  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const latestRef = useRef({ content, images })
  latestRef.current = { content, images }

  // 이미지 signed URL
  useEffect(() => {
    let alive = true
    if (images.length === 0) { setSigned({}); return }
    signHrImages(images).then(m => { if (alive) setSigned(m) }).catch(() => { /* 썸네일 실패는 무시 */ })
    return () => { alive = false }
  }, [images])

  // ── DB draft flush ──
  const flushDraft = useCallback(async () => {
    if (!dirtyRef.current) return
    const { content: c, images: im } = latestRef.current
    try {
      const saved = await upsertHrAnswer({ userId: uid, questionId: q.id, content: c, imagePaths: im, status: 'draft' })
      dirtyRef.current = false
      onSaved(saved)
      // DB 반영 후 로컬 임시본은 DB 와 동일 → saved_at 를 DB updated_at 기준으로 재기록(최신 판정 일관성)
      writeLocalDraft(uid, q.id, c, im)
    } catch (e) {
      setNote({ text: `임시 저장 실패: ${e instanceof Error ? e.message : String(e)} (브라우저에는 보관 중)`, err: true })
    }
  }, [uid, q.id, onSaved])

  const scheduleDraft = useCallback(() => {
    dirtyRef.current = true
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void flushDraft() }, DRAFT_DEBOUNCE_MS)
  }, [flushDraft])

  // 탭 이탈/닫기/언마운트 시 flush
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushDraft() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      void flushDraft()
    }
  }, [flushDraft])

  // ── 입력 ──
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setContent(v)
    writeLocalDraft(uid, q.id, v, latestRef.current.images)   // 즉시(동기) — 이탈 복구 1차 안전망
    scheduleDraft()
    if (note) setNote(null)
  }

  // ── 이미지 ──
  const fileRef = useRef<HTMLInputElement>(null)
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setBusy('upload'); setNote(null)
    try {
      const paths: string[] = []
      for (const f of files) paths.push(await uploadHrImage(uid, q.id, f))
      const next = [...latestRef.current.images, ...paths]
      setImages(next)
      writeLocalDraft(uid, q.id, latestRef.current.content, next)
      scheduleDraft()
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), err: true })
    } finally { setBusy('') }
  }
  const onRemoveImage = async (path: string) => {
    const next = latestRef.current.images.filter(p => p !== path)
    setImages(next)
    writeLocalDraft(uid, q.id, latestRef.current.content, next)
    scheduleDraft()
    try { await removeHrImage(path) } catch { /* 참조는 이미 제거됨 — 고아 파일은 무해 */ }
  }

  // ── 저장하기(확정) ──
  const onSubmit = async () => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null }
    setBusy('save'); setNote(null)
    try {
      const saved = await upsertHrAnswer({
        userId: uid, questionId: q.id,
        content: latestRef.current.content, imagePaths: latestRef.current.images, status: 'submitted',
      })
      dirtyRef.current = false
      clearLocalDraft(uid, q.id)
      onSaved(saved)
      setMode('view')
    } catch (e) {
      setNote({ text: `저장 실패: ${e instanceof Error ? e.message : String(e)}`, err: true })
    } finally { setBusy('') }
  }

  const canSubmit = content.trim().length > 0 || images.length > 0

  return (
    <>
      <header className="hri-qhead">
        <div className="hri-qnum">
          <span className="hri-n hri-is">{q.no}.</span>
          <span className={`hri-chip${submitted ? ' is-done' : ''}`}>{submitted ? '답변완료' : '답변하세요'}</span>
        </div>
        <div className="hri-qtext">
          <p className="hri-purpose" style={{ color: q.purposeColor }}>
            {q.purpose.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
          </p>
          <div className="hri-question" style={{ fontWeight: q.weight, lineHeight: q.lineHeight }}>
            {q.lines.map((line, i) => (
              <p key={i}>
                {line.map((seg, j) => seg.hl ? <span key={j} className="hri-hl">{seg.text}</span> : <React.Fragment key={j}>{seg.text}</React.Fragment>)}
              </p>
            ))}
          </div>
        </div>
      </header>

      {mode === 'edit' && (
        <section className="hri-edit" aria-label="답변 입력">
          <div className="hri-box">
            <button type="button" className="hri-attach" disabled={busy !== ''} onClick={() => fileRef.current?.click()}>
              {busy === 'upload' ? '업로드 중…' : '이미지 첨부하기'}
            </button>
            <input ref={fileRef} type="file" accept={HR_IMAGE_MIME.join(',')} multiple hidden onChange={onPickFiles} />
            {images.length > 0 && (
              <div className="hri-thumbs">
                {images.map(p => (
                  <div key={p} className="hri-thumb">
                    {signed[p] && <img src={signed[p]} alt="" />}
                    <button type="button" className="hri-thumb-x" aria-label="이미지 삭제" onClick={() => onRemoveImage(p)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="hri-textarea"
              value={content}
              placeholder={q.placeholder}
              onChange={onChange}
              onBlur={() => void flushDraft()}
              spellCheck={false}
            />
          </div>
          {note && <p className={`hri-status${note.err ? ' is-err' : ''}`}>{note.text}</p>}
          <div className="hri-btns">
            <button type="button" className="hri-btn" disabled={busy !== ''} onClick={() => setMode('preview')}>미리보기</button>
            <button type="button" className="hri-btn is-pri" disabled={busy !== '' || !canSubmit} onClick={onSubmit}>
              {busy === 'save' ? '저장 중…' : '저장하기'}
            </button>
          </div>
        </section>
      )}

      {(mode === 'preview' || mode === 'view') && (
        <section className="hri-view" aria-label={mode === 'preview' ? '답변 미리보기' : '저장된 답변'}>
          <div className="hri-vbox">
            <p className={`hri-vtext${content.trim() ? '' : ' is-empty'}`}>{content.trim() ? content : '(작성된 내용이 없습니다)'}</p>
            {images.map(p => (
              <figure key={p} className="hri-vimg">
                {signed[p] && <img src={signed[p]} alt="첨부 이미지" />}
              </figure>
            ))}
          </div>
          {note && <p className={`hri-status${note.err ? ' is-err' : ''}`}>{note.text}</p>}
          <div className="hri-vbtn">
            {mode === 'preview'
              ? <div className="hri-btns" style={{ width: 'auto' }}>
                  <button type="button" className="hri-btn h52" onClick={() => setMode('edit')}>편집으로 돌아가기</button>
                  <button type="button" className="hri-btn is-pri h52" disabled={busy !== '' || !canSubmit} onClick={onSubmit}>
                    {busy === 'save' ? '저장 중…' : '저장하기'}
                  </button>
                </div>
              : <button type="button" className="hri-btn is-pri h52" onClick={() => setMode('edit')}>답변 편집하기</button>}
          </div>
        </section>
      )}
    </>
  )
}
