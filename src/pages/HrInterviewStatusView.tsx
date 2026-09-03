// ============================================================
// HrInterviewStatusView — 관리자 '현황' 뷰 (A안) [2026-09-03] 신규
//   · #hr-interview 페이지 안에서 관리자에게만 노출 (인덱스 '현황' 행)
//   · 매트릭스: 행=참여자(답변 행 1개 이상), 열=문항 1~N, 셀=none/draft/submitted 점
//   · 셀 클릭 → 하단 720px 컬럼에 해당 답변을 열람 모드 레이아웃(qhead + vbox) 그대로 표시
//   · 진입 시 1회 로드 + 새로고침 / CSV 내보내기 (long format, BOM)
//   · 권한: 렌더 여부는 부모가 hr_interview_is_admin() 결과로 결정. 데이터 자체도 RLS 가 관리자에게만 전체 반환.
// 종료 시 이 파일 + 부모의 status 분기만 제거.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { HR_INTERVIEW_QUESTIONS } from '../data/hrInterviewQuestions'
import type { HrAnswerWithProfile, HrCellStatus, HrInterviewQuestion } from '../types/hrInterview'
import { fetchAllHrAnswers, signHrImages, buildHrStatusCsv } from '../lib/hrInterviewApi'

interface Participant {
  user_id: string
  name: string
  dept: string
  byQ: Record<string, HrAnswerWithProfile>
  submitted: number
  drafts: number
  lastAt: number
}

const STATUS_LABEL: Record<HrCellStatus, string> = { none: '미답변', draft: '작성중', submitted: '답변완료' }

export default function HrInterviewStatusView() {
  const [rows, setRows] = useState<HrAnswerWithProfile[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<{ uid: string; qid: string } | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setErr(null)
    try { setRows(await fetchAllHrAnswers()) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const questions = HR_INTERVIEW_QUESTIONS
  const participants = useMemo<Participant[]>(() => {
    if (!rows) return []
    const map = new Map<string, Participant>()
    for (const r of rows) {
      let p = map.get(r.user_id)
      if (!p) {
        p = { user_id: r.user_id, name: r.profiles?.name ?? '(이름 없음)', dept: r.profiles?.dept ?? '', byQ: {}, submitted: 0, drafts: 0, lastAt: 0 }
        map.set(r.user_id, p)
      }
      p.byQ[r.question_id] = r
      if (r.status === 'submitted') p.submitted += 1; else p.drafts += 1
      p.lastAt = Math.max(p.lastAt, new Date(r.updated_at).getTime())
    }
    return [...map.values()].sort((a, b) => b.submitted - a.submitted || b.lastAt - a.lastAt || a.name.localeCompare(b.name, 'ko'))
  }, [rows])

  const totalCells = participants.length * questions.length
  const totalSubmitted = participants.reduce((n, p) => n + p.submitted, 0)
  const rate = totalCells ? Math.round((totalSubmitted / totalCells) * 100) : 0

  const cellStatus = (p: Participant, q: HrInterviewQuestion): HrCellStatus => {
    const r = p.byQ[q.id]
    if (!r) return 'none'
    return r.status === 'submitted' ? 'submitted' : (r.content.trim() || r.image_paths.length ? 'draft' : 'none')
  }

  const onCsv = () => {
    if (!rows) return
    const blob = new Blob([buildHrStatusCsv(rows, questions)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr-interview-1st_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selected = sel ? participants.find(p => p.user_id === sel.uid) : undefined
  const selectedQ = sel ? questions.find(q => q.id === sel.qid) : undefined
  const selectedRow = selected && sel ? selected.byQ[sel.qid] : undefined

  return (
    <div className="hri-status-root">
      <header className="hri-qhead">
        <div className="hri-qnum">
          <span className="hri-n hri-n-ko">현황</span>
          <span className="hri-chip">참여 {participants.length}명</span>
          <span className={`hri-chip${rate === 100 && totalCells > 0 ? ' is-done' : ''}`}>완료 {totalSubmitted} / {totalCells} ({rate}%)</span>
          <span className="hri-status-actions">
            <button type="button" className="hri-btn hri-btn-sm" disabled={busy} onClick={() => void load()}>{busy ? '불러오는 중…' : '새로고침'}</button>
            <button type="button" className="hri-btn hri-btn-sm is-pri" disabled={!rows || rows.length === 0} onClick={onCsv}>CSV 내보내기</button>
          </span>
        </div>
        <div className="hri-qtext">
          <p className="hri-purpose" style={{ color: '#919191' }}>
            참여자별 문항 답변 상태. 셀을 클릭하면 아래에 답변이 표시됩니다.
          </p>
          <p className="hri-legend">
            <span className="hri-dot is-none" /> 미답변
            <span className="hri-dot is-draft" /> 작성중
            <span className="hri-dot is-submitted" /> 답변완료
          </p>
        </div>
      </header>

      {err && <p className="hri-status is-err">불러오기 실패: {err}</p>}

      {rows && participants.length === 0 && !err && (
        <p className="hri-status">아직 답변을 시작한 참여자가 없습니다.</p>
      )}

      {participants.length > 0 && (
        <div className="hri-matrix-wrap">
          <table className="hri-matrix">
            <thead>
              <tr>
                <th className="hri-th-name">참여자</th>
                {questions.map(q => <th key={q.id} className="hri-is">{q.no}</th>)}
                <th className="hri-th-sum">완료</th>
                <th className="hri-th-time">최종 수정</th>
              </tr>
            </thead>
            <tbody>
              {participants.map(p => (
                <tr key={p.user_id}>
                  <td className="hri-td-name">
                    <span className="hri-td-name-main">{p.name}</span>
                    {p.dept && <span className="hri-td-name-sub">{p.dept}</span>}
                  </td>
                  {questions.map(q => {
                    const st = cellStatus(p, q)
                    const active = sel?.uid === p.user_id && sel?.qid === q.id
                    return (
                      <td key={q.id}>
                        <button
                          type="button"
                          className={`hri-cell${active ? ' is-active' : ''}`}
                          disabled={st === 'none'}
                          title={`${p.name} · ${q.no}번 · ${STATUS_LABEL[st]}`}
                          aria-label={`${p.name} ${q.no}번 ${STATUS_LABEL[st]}`}
                          onClick={() => setSel({ uid: p.user_id, qid: q.id })}
                        >
                          <span className={`hri-dot is-${st}`} />
                        </button>
                      </td>
                    )
                  })}
                  <td className="hri-td-sum hri-is">{p.submitted}<span className="hri-td-sum-den">/{questions.length}</span></td>
                  <td className="hri-td-time">{fmtKST(p.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && selectedQ && selectedRow && (
        <AnswerReader key={selectedRow.id} participant={selected} question={selectedQ} row={selectedRow}
          onPrev={() => moveSel(-1)} onNext={() => moveSel(1)} />
      )}
    </div>
  )

  function moveSel(delta: number) {
    if (!sel || !selected) return
    const idx = questions.findIndex(q => q.id === sel.qid)
    for (let i = idx + delta; i >= 0 && i < questions.length; i += delta) {
      if (selected.byQ[questions[i].id]) { setSel({ uid: sel.uid, qid: questions[i].id }); return }
    }
  }
}

function fmtKST(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─────────────────────────────────────────────────────────────
// 선택 답변 열람 — 참여자 화면의 열람 모드(qhead + vbox)와 동일 레이아웃
// ─────────────────────────────────────────────────────────────
function AnswerReader({ participant, question: q, row, onPrev, onNext }: {
  participant: Participant; question: HrInterviewQuestion; row: HrAnswerWithProfile; onPrev: () => void; onNext: () => void
}) {
  const [signed, setSigned] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    if (row.image_paths.length === 0) { setSigned({}); return }
    signHrImages(row.image_paths).then(m => { if (alive) setSigned(m) }).catch(() => {})
    return () => { alive = false }
  }, [row.image_paths])

  const submitted = row.status === 'submitted'
  return (
    <section className="hri-reader" aria-label="선택한 답변">
      <header className="hri-qhead">
        <div className="hri-qnum">
          <span className="hri-n hri-is">{q.no}.</span>
          <span className={`hri-chip${submitted ? ' is-done' : ''}`}>{submitted ? '답변완료' : '작성중'}</span>
          <span className="hri-reader-who">{participant.name}{participant.dept ? ` · ${participant.dept}` : ''}</span>
          <span className="hri-status-actions">
            <button type="button" className="hri-btn hri-btn-sm" onClick={onPrev}>←</button>
            <button type="button" className="hri-btn hri-btn-sm" onClick={onNext}>→</button>
          </span>
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
      <div className="hri-view">
        <div className="hri-vbox">
          <p className={`hri-vtext${row.content.trim() ? '' : ' is-empty'}`}>{row.content.trim() ? row.content : '(작성된 내용이 없습니다)'}</p>
          {row.image_paths.map(p => (
            <figure key={p} className="hri-vimg">{signed[p] && <img src={signed[p]} alt="첨부 이미지" />}</figure>
          ))}
        </div>
        <p className="hri-status" style={{ alignSelf: 'flex-end' }}>
          {submitted && row.submitted_at ? `제출 ${fmtKST(new Date(row.submitted_at).getTime())} · ` : ''}최종 수정 {fmtKST(new Date(row.updated_at).getTime())}
        </p>
      </div>
    </section>
  )
}
