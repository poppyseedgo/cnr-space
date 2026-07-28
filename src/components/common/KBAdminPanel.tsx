/**
 * KBAdminPanel.tsx — 어드민 'KB 관리' (GA 챗봇 지식베이스)
 *
 * [2026-07-27] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 판단
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · 원본은 이제 kb_chunks 테이블이다
 *    Notion 가이드 → 정제 → 시드(20260733)까지가 이관이고, 이후의 수정은
 *    전부 이 화면에서 한다. Notion 을 고치고 여기를 안 고치면 챗봇은 모른다.
 *
 *  · 저장은 명시적, 셀 클릭은 초안만 (권한 매트릭스와 같은 원칙)
 *    content 는 챗봇이 그대로 읽는 텍스트라 오타 하나가 그대로 답변이 된다.
 *    dirty 상태를 배지로 보여주고, 저장 없이 다른 청크로 이동하면 확인을 받는다.
 *
 *  · related 는 저장 전에 프론트에서 검증한다
 *    DB 에 FK 를 안 건 이유 — 배열 원소라 FK 불가, 트리거 검증은 청크 삭제
 *    순서를 강제해 편집을 성가시게 한다. 대신 저장 시 존재하지 않는 id 를
 *    경고하고(차단 아님), JSON 내보내기 시 깨진 참조 수를 요약에 표시한다.
 *
 *  · JSON 내보내기는 데모 아티팩트와의 다리
 *    프로덕션 챗봇(service_role 직접 조회) 전환 전까지, 여기서 수정 →
 *    내보내기 → 데모 재빌드 흐름을 쓴다. 포맷은 ga-knowledge-base.json 과 동일.
 *
 *  · status 는 '콘텐츠 결함의 데이터화'
 *    image_only/pdf_only 는 삭제 대상이 아니라 보완 TODO 목록이다. 트리에
 *    배지로 남겨 "챗봇이 이 질문에 약하다"가 화면에서 보이게 한다.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  loadKbChunks, saveKbChunk, deleteKbChunk,
  type KbChunk,
} from '../../lib/api'

const FONT = "'Pretendard', -apple-system, sans-serif"

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #EEF1F6', borderRadius: 16, padding: 18,
}
const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: 12, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 6,
}
const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0',
  fontFamily: FONT, fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box',
}

const STATUS_META: Record<KbChunk['status'], { label: string; badge: string; bg: string; fg: string }> = {
  ok:         { label: '텍스트 완비', badge: '',    bg: '#DCFCE7', fg: '#166534' },
  image_only: { label: '이미지 의존', badge: '🖼', bg: '#FEF3C7', fg: '#92400E' },
  pdf_only:   { label: 'PDF 의존',    badge: '📄', bg: '#FEE2E2', fg: '#B91C1C' },
}

/** 폼 상태 — 배열 필드는 쉼표 구분 문자열로 편집 */
interface FormState {
  id: string
  isNew: boolean
  category: string
  doc: string
  section: string
  content: string
  keywords: string
  contacts: string
  related: string
  status: KbChunk['status']
  sensitive: boolean
}

const toForm = (c: KbChunk): FormState => ({
  id: c.id, isNew: false,
  category: c.category, doc: c.doc, section: c.section, content: c.content,
  keywords: c.keywords.join(', '), contacts: c.contacts.join(', '), related: c.related.join(', '),
  status: c.status, sensitive: c.sensitive,
})

const emptyForm = (): FormState => ({
  id: '', isNew: true,
  category: '', doc: '', section: '', content: '',
  keywords: '', contacts: '', related: '',
  status: 'ok', sensitive: false,
})

/** '쉼표 구분 문자열' → 배열 (공백 제거, 빈 원소 제외) */
const splitCsv = (s: string) =>
  s.split(',').map(x => x.trim()).filter(Boolean)

interface Props {
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  isMobile?: boolean
  /** 봇 식별자 — 추후 Space 이용 가이드 봇('space')을 같은 화면으로 관리 */
  botId?: string
}

export function KBAdminPanel({ showToast, isMobile, botId = 'ga' }: Props) {
  const [chunks,   setChunks]   = useState<KbChunk[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [form,     setForm]     = useState<FormState | null>(null)
  const [baseline, setBaseline] = useState<string>('')   // dirty 판정용 스냅샷 (JSON)
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await loadKbChunks(botId)
      setChunks(rows)
      // RLS 는 권한이 없으면 에러가 아니라 0행을 준다 — 안내로 구분
      if (rows.length === 0) showToast('청크가 없습니다. KB 관리 권한이 있는지 확인하세요.', 'info')
    }
    catch (e: any) { showToast(`지식베이스를 불러오지 못했습니다: ${e.message}`, 'error') }
    finally { setLoading(false) }
  }, [botId, showToast])

  useEffect(() => { load() }, [load])

  // ── 트리 구성: category → doc → chunks (id 순서 유지) ──────────────────────
  const tree = useMemo(() => {
    const cats = new Map<string, Map<string, KbChunk[]>>()
    for (const c of chunks) {
      if (!cats.has(c.category)) cats.set(c.category, new Map())
      const docs = cats.get(c.category)!
      if (!docs.has(c.doc)) docs.set(c.doc, [])
      docs.get(c.doc)!.push(c)
    }
    return cats
  }, [chunks])

  const idSet = useMemo(() => new Set(chunks.map(c => c.id)), [chunks])
  const dirty = form !== null && JSON.stringify(form) !== baseline

  /** 편집 대상 전환 — dirty 면 확인 후 이동 (오이동으로 수정분이 사라지는 사고 방지) */
  function openChunk(c: KbChunk | null) {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 이동할까요?')) return
    const f = c ? toForm(c) : emptyForm()
    setForm(f)
    setBaseline(JSON.stringify(f))
  }

  async function handleSave() {
    if (!form) return
    // 필수값 — content 가 비면 챗봇이 빈 근거로 답하게 된다
    if (!form.id.trim())       { showToast('청크 ID를 입력하세요 (예: ga-3-2-1)', 'error'); return }
    if (!form.category.trim() || !form.doc.trim() || !form.section.trim()) {
      showToast('카테고리 / 문서 / 섹션은 필수입니다', 'error'); return
    }
    if (!form.content.trim())  { showToast('내용을 입력하세요', 'error'); return }
    // 신규인데 기존 ID 와 충돌 — upsert 라 조용히 덮어써지는 것을 차단
    if (form.isNew && idSet.has(form.id.trim())) {
      showToast(`이미 존재하는 ID 입니다: ${form.id.trim()}`, 'error'); return
    }
    // related 검증 — 차단하지 않고 경고 (아직 안 만든 청크를 미리 참조할 수 있다)
    const rel = splitCsv(form.related)
    const broken = rel.filter(r => r !== form.id.trim() && !idSet.has(r))
    if (broken.length > 0) {
      if (!window.confirm(`존재하지 않는 related 참조가 있습니다:\n${broken.join(', ')}\n그대로 저장할까요?`)) return
    }

    setSaving(true)
    const res = await saveKbChunk({
      id: form.id.trim(), bot_id: botId,
      category: form.category.trim(), doc: form.doc.trim(), section: form.section.trim(),
      content: form.content.trim(),
      keywords: splitCsv(form.keywords), contacts: splitCsv(form.contacts), related: rel,
      status: form.status, sensitive: form.sensitive,
    })
    setSaving(false)
    if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
    showToast(form.isNew ? '청크를 추가했습니다' : '저장했습니다', 'success')
    await load()
    if (res.row) { const f = toForm(res.row); setForm(f); setBaseline(JSON.stringify(f)) }
  }

  async function handleDelete() {
    if (!form || form.isNew) return
    // 삭제 전 역참조 확인 — 남는 쪽의 related 가 깨진다는 것을 알려준다
    const referrers = chunks.filter(c => c.related.includes(form.id)).map(c => c.id)
    const warn = referrers.length > 0 ? `\n⚠ 이 청크를 참조 중: ${referrers.join(', ')}` : ''
    if (!window.confirm(`'${form.section}' 청크를 삭제할까요?${warn}`)) return
    setSaving(true)
    const res = await deleteKbChunk(form.id)
    setSaving(false)
    if (!res.ok) { showToast(res.message ?? '삭제 실패', 'error'); return }
    showToast('삭제했습니다', 'success')
    setForm(null); setBaseline('')
    await load()
  }

  /** JSON 내보내기 — 데모 아티팩트/챗봇 프롬프트 소스와 동일 포맷 */
  function handleExport() {
    const categories = [...tree.keys()]
    const brokenRefs = chunks.reduce((n, c) =>
      n + c.related.filter(r => !idSet.has(r)).length, 0)
    const out = {
      meta: {
        name: 'C&R GA 가이드 지식베이스',
        source: `kb_chunks (bot_id=${botId})`,
        exported_at: new Date().toISOString(),
        chunk_unit: '섹션(H2/aside 블록)',
        categories,
      },
      chunks: chunks.map(({ updated_at, updated_by, ...rest }) => rest),
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${botId}-knowledge-base.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast(
      brokenRefs > 0
        ? `내보냈습니다 (${chunks.length}청크 · ⚠ 깨진 related ${brokenRefs}건)`
        : `내보냈습니다 (${chunks.length}청크)`,
      brokenRefs > 0 ? 'info' : 'success',
    )
  }

  const stat = useMemo(() => ({
    total: chunks.length,
    image: chunks.filter(c => c.status === 'image_only').length,
    pdf:   chunks.filter(c => c.status === 'pdf_only').length,
  }), [chunks])

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT }}>
      {/* 헤더 행: 통계 + 액션 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          총 <b style={{ color: '#111' }}>{stat.total}</b>청크
          {stat.image > 0 && <> · 🖼 이미지 의존 <b>{stat.image}</b></>}
          {stat.pdf > 0 && <> · 📄 PDF 의존 <b>{stat.pdf}</b></>}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => openChunk(null)}
          style={{ ...INPUT, width: 'auto', cursor: 'pointer', fontWeight: 700, color: '#111' }}>
          + 청크 추가
        </button>
        <button onClick={handleExport} disabled={chunks.length === 0}
          style={{ ...INPUT, width: 'auto', cursor: 'pointer', fontWeight: 700,
                   background: '#111', color: '#fff', border: '1px solid #111' }}>
          JSON 내보내기
        </button>
      </div>

      <div style={{ display: 'flex', gap: 14, flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start' }}>
        {/* 좌측: 카테고리 › 문서 › 청크 트리 */}
        <div style={{ ...CARD, width: isMobile ? '100%' : 340, flexShrink: 0, padding: 10,
                      maxHeight: isMobile ? 320 : 640, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 14, fontSize: 13, color: '#94A3B8' }}>불러오는 중…</div>}
          {!loading && [...tree.entries()].map(([cat, docs]) => {
            const open = openCats[cat] ?? true
            const catCount = [...docs.values()].reduce((n, arr) => n + arr.length, 0)
            return (
              <div key={cat} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => setOpenCats(p => ({ ...p, [cat]: !open }))}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                           padding: '8px 8px', cursor: 'pointer', fontFamily: FONT,
                           fontSize: 13, fontWeight: 800, color: '#111',
                           display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>{open ? '▼' : '▶'}</span>
                  {cat}
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{catCount}</span>
                </button>
                {open && [...docs.entries()].map(([doc, list]) => (
                  <div key={doc} style={{ paddingLeft: 14, marginBottom: 4 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', padding: '3px 0' }}>{doc}</div>
                    {list.map(c => {
                      const active = form?.id === c.id && !form?.isNew
                      const meta = STATUS_META[c.status]
                      return (
                        <button key={c.id} onClick={() => openChunk(c)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                   textAlign: 'left', border: 'none', cursor: 'pointer',
                                   background: active ? '#111' : 'transparent',
                                   color: active ? '#fff' : '#334155',
                                   borderRadius: 8, padding: '6px 8px', fontFamily: FONT, fontSize: 12.5 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.section}
                          </span>
                          {meta.badge && <span style={{ flexShrink: 0 }}>{meta.badge}</span>}
                          {c.sensitive && <span title="민감 정보 포함" style={{ flexShrink: 0 }}>🔐</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* 우측: 편집 폼 */}
        <div style={{ ...CARD, flex: 1, width: isMobile ? '100%' : undefined }}>
          {form === null ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>
              좌측에서 청크를 선택하거나 [+ 청크 추가]로 새로 만드세요
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>
                  {form.isNew ? '새 청크' : form.id}
                </div>
                {dirty && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#B45309',
                                 background: '#FEF3C7', padding: '2px 8px', borderRadius: 999 }}>
                    저장 안 됨
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL}>청크 ID {form.isNew ? '(예: ga-3-2-3)' : '(수정 불가)'}</label>
                  <input style={{ ...INPUT, background: form.isNew ? '#fff' : '#F8FAFC' }}
                    value={form.id} disabled={!form.isNew}
                    onChange={e => setForm({ ...form, id: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>상태</label>
                  <select style={INPUT} value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as KbChunk['status'] })}>
                    <option value="ok">텍스트 완비 (ok)</option>
                    <option value="image_only">🖼 이미지 의존 — 보완 필요</option>
                    <option value="pdf_only">📄 PDF 의존 — 보완 필요</option>
                  </select>
                </div>
                <div>
                  <label style={LABEL}>카테고리</label>
                  <input style={INPUT} value={form.category} list="kb-cat-list"
                    onChange={e => setForm({ ...form, category: e.target.value })} />
                  <datalist id="kb-cat-list">
                    {[...tree.keys()].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label style={LABEL}>문서</label>
                  <input style={INPUT} value={form.doc}
                    onChange={e => setForm({ ...form, doc: e.target.value })} />
                </div>
                <div style={{ gridColumn: isMobile ? undefined : '1 / -1' }}>
                  <label style={LABEL}>섹션 제목</label>
                  <input style={INPUT} value={form.section}
                    onChange={e => setForm({ ...form, section: e.target.value })} />
                </div>
                <div style={{ gridColumn: isMobile ? undefined : '1 / -1' }}>
                  <label style={LABEL}>내용 — 챗봇이 이 텍스트를 그대로 근거로 읽습니다</label>
                  <textarea style={{ ...INPUT, minHeight: 160, resize: 'vertical', lineHeight: 1.7 }}
                    value={form.content}
                    onChange={e => setForm({ ...form, content: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>키워드 (쉼표 구분)</label>
                  <input style={INPUT} value={form.keywords} placeholder="택배, 일양, 당일발송"
                    onChange={e => setForm({ ...form, keywords: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>담당자 (쉼표 구분)</label>
                  <input style={INPUT} value={form.contacts} placeholder="GA파트 박찬희, GA파트 송보람"
                    onChange={e => setForm({ ...form, contacts: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>관련 청크 ID (쉼표 구분)</label>
                  <input style={INPUT} value={form.related} placeholder="ga-3-2-1, ga-3-3-1"
                    onChange={e => setForm({ ...form, related: e.target.value })} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT,
                                  fontSize: 13, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.sensitive}
                      onChange={e => setForm({ ...form, sensitive: e.target.checked })} />
                    🔐 민감 정보 포함 (계정·비밀번호 등)
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button onClick={handleSave} disabled={saving || !dirty}
                  style={{ ...INPUT, width: 'auto', cursor: saving || !dirty ? 'default' : 'pointer',
                           fontWeight: 700, background: !dirty ? '#E2E8F0' : '#111',
                           color: !dirty ? '#94A3B8' : '#fff',
                           border: '1px solid transparent', padding: '9px 22px' }}>
                  {saving ? '저장 중…' : form.isNew ? '추가' : '저장'}
                </button>
                {!form.isNew && (
                  <button onClick={handleDelete} disabled={saving}
                    style={{ ...INPUT, width: 'auto', cursor: 'pointer', fontWeight: 700,
                             color: '#B91C1C', border: '1px solid #FECACA', background: '#fff' }}>
                    삭제
                  </button>
                )}
                {form && !form.isNew && (
                  <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11.5, color: '#94A3B8' }}>
                    {(() => {
                      const c = chunks.find(x => x.id === form.id)
                      return c?.updated_at
                        ? `마지막 수정 ${new Date(c.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
                        : null
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
