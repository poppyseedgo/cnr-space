/**
 * AnnouncementPanel.tsx — 어드민 '공지 배너' 관리
 *
 * [2026-07-24] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 판단
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · 게시 기간을 **필수**로 받는다
 *    기존 공지는 기간이 없어서 5/12 핫픽스 안내가 두 달 넘게 떠 있었다.
 *    "내리는 것"을 사람 기억에 맡기면 반드시 남는다. 종료일 없이는 저장이 안 된다.
 *
 *  · 미리보기를 폼 바로 위에 둔다
 *    배경색·글씨색을 숫자로 고르는 화면이라, 실제 대비를 눈으로 확인하지 못하면
 *    "연한 배경 + 흰 글씨" 같은 조합이 그대로 배포된다(가동률 카드에서 겪은 그 문제).
 *
 *  · 색은 프리셋 + 직접 입력 둘 다
 *    프리셋만 두면 브랜드 색을 못 쓰고, 입력만 두면 매번 hex 를 찾아야 한다.
 *
 *  · 상태를 '게시 중 / 예정 / 종료 / 비활성' 네 가지로 표시한다
 *    is_active 토글과 기간이 따로 놀기 때문에, 켜져 있어도 기간이 지나면 안 보인다.
 *    목록에서 그 이유가 바로 보이지 않으면 "왜 안 뜨지" 를 코드에서 찾게 된다.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  loadAllAnnouncements, saveAnnouncement, deleteAnnouncement,
  notifyAnnouncementSync,  // ← [2026-07-27 공지 리얼타임] 저장/삭제 성공 시 전 클라이언트 재조회 신호
  kstDayStart, kstDayEnd, toKstDayStr,
  type Announcement,
} from '../../lib/api'
import { todayStr, addDays } from '../../utils/time'

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

/** 자주 쓰는 조합 — 배경/글씨를 쌍으로 둔다. 색을 따로 고르면 대비가 깨진 조합이 나온다 */
const COLOR_PRESETS: { label: string; bg: string; fg: string }[] = [
  { label: '안내',  bg: '#E6F2FF', fg: '#1E1E1E' },
  { label: '주의',  bg: '#FEF3C7', fg: '#92400E' },
  { label: '긴급',  bg: '#FEE2E2', fg: '#B91C1C' },
  { label: '완료',  bg: '#DCFCE7', fg: '#166534' },
  { label: '강조',  bg: '#111111', fg: '#FFFFFF' },
]

type Status = 'live' | 'scheduled' | 'ended' | 'off'

function statusOf(a: Announcement, now = Date.now()): Status {
  if (!a.is_active) return 'off'
  const s = new Date(a.starts_at).getTime()
  const e = new Date(a.ends_at).getTime()
  if (now < s) return 'scheduled'
  if (now > e) return 'ended'
  return 'live'
}

const STATUS_META: Record<Status, { label: string; bg: string; fg: string }> = {
  live:      { label: '게시 중',  bg: '#DCFCE7', fg: '#166534' },
  scheduled: { label: '게시 예정', bg: '#EEF2FF', fg: '#4338CA' },
  ended:     { label: '종료',     bg: '#F1F5F9', fg: '#64748B' },
  off:       { label: '비활성',   bg: '#F1F5F9', fg: '#94A3B8' },
}

interface FormState {
  id: string | null
  message: string
  bg: string
  fg: string
  from: string
  to: string
  active: boolean
}

const emptyForm = (): FormState => ({
  id: null, message: '', bg: '#E6F2FF', fg: '#1E1E1E',
  from: todayStr(), to: addDays(todayStr(), 6), active: true,
})

interface Props {
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  isMobile?: boolean
}

export function AnnouncementPanel({ showToast, isMobile }: Props) {
  const [list,    setList]    = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [form,    setForm]    = useState<FormState>(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    try { setList(await loadAllAnnouncements()) }
    catch (e: any) { showToast(`공지 목록을 불러오지 못했습니다: ${e.message}`, 'error') }
    finally { setLoading(false) }
  }, [showToast])

  useEffect(() => { load() }, [load])

  const dirty = form.message.trim().length > 0
  const editing = form.id !== null

  async function handleSave() {
    if (!form.message.trim()) { showToast('공지 내용을 입력하세요', 'error'); return }
    if (form.to < form.from)  { showToast('종료일이 시작일보다 빠릅니다', 'error'); return }
    setSaving(true)
    try {
      const res = await saveAnnouncement({
        id: form.id,
        message: form.message,
        bg_color: form.bg,
        text_color: form.fg,
        starts_at: kstDayStart(form.from),
        ends_at:   kstDayEnd(form.to),
        is_active: form.active,
      })
      if (!res.ok) { showToast(res.message ?? '저장 실패', 'error'); return }
      showToast(editing ? '공지를 수정했습니다' : '공지를 등록했습니다', 'success')
      setForm(emptyForm())
      void notifyAnnouncementSync()   // ← [2026-07-27 공지 리얼타임] 전 클라이언트 배너 즉시 갱신 (fire & forget)
      await load()
    } finally { setSaving(false) }
  }

  async function handleDelete(a: Announcement) {
    if (!window.confirm('이 공지를 삭제할까요? 되돌릴 수 없습니다.')) return
    const res = await deleteAnnouncement(a.id)
    if (!res.ok) { showToast(res.message ?? '삭제 실패', 'error'); return }
    showToast('공지를 삭제했습니다', 'info')
    if (form.id === a.id) setForm(emptyForm())
    void notifyAnnouncementSync()   // ← [2026-07-27 공지 리얼타임] 삭제도 즉시 반영 (내리는 케이스가 핵심)
    await load()
  }

  function handleEdit(a: Announcement) {
    setForm({
      id: a.id, message: a.message, bg: a.bg_color, fg: a.text_color,
      from: toKstDayStr(a.starts_at), to: toKstDayStr(a.ends_at), active: a.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** 지금 실제로 헤더에 뜨는 공지 — 목록 위에 명시해 "왜 저게 떠 있지"를 없앤다 */
  const liveOne = useMemo(() => list.find(a => statusOf(a) === 'live') ?? null, [list])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── 안내 ─────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: '#1E1E1E' }}>공지 배너</div>
        <div style={{ fontFamily: FONT, fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
          헤더 맨 위에 뜨는 한 줄 배너입니다. <b>게시 기간이 지나면 자동으로 사라집니다.</b>
          <br />
          기간이 겹치는 공지가 여럿이면 <b>가장 최근에 시작한 공지</b> 하나만 표시됩니다.
          사용자가 X로 닫으면 그 브라우저 세션 동안만 숨겨지고, 새 공지를 등록하면 다시 나타납니다.
        </div>
        <div style={{ fontFamily: FONT, fontSize: 12, color: '#94A3B8' }}>
          현재 게시 중: {liveOne ? `“${liveOne.message.slice(0, 40)}${liveOne.message.length > 40 ? '…' : ''}”` : '없음'}
        </div>
      </div>

      {/* ── 미리보기 + 폼 ────────────────────────────────────────────── */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: '#1E1E1E' }}>
          {editing ? '공지 수정' : '새 공지 등록'}
        </div>

        {/* 미리보기 — 실제 NoticeBar 와 같은 치수(padding 10/0 · 14px SemiBold) */}
        <div>
          <span style={LABEL}>미리보기</span>
          <div style={{
            background: form.bg, color: form.fg, padding: '10px 0', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT, fontSize: 14, fontWeight: 600, lineHeight: 1.5,
            minHeight: 41, textAlign: 'center',
          }}>
            {form.message.trim() || '공지 내용을 입력하면 여기에 표시됩니다'}
          </div>
        </div>

        <div>
          <span style={LABEL}>공지 내용</span>
          <textarea
            value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            rows={2}
            placeholder="예) 7/28(월) 09:00~11:00 시스템 점검이 있습니다."
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {/* 색상 */}
        <div>
          <span style={LABEL}>색상</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {COLOR_PRESETS.map(p => {
              const on = form.bg.toUpperCase() === p.bg && form.fg.toUpperCase() === p.fg
              return (
                <button key={p.label} className="btn"
                  onClick={() => setForm(f => ({ ...f, bg: p.bg, fg: p.fg }))}
                  style={{
                    background: p.bg, color: p.fg, border: on ? '2px solid #111' : '1px solid #E2E8F0',
                    borderRadius: 999, padding: '6px 14px', cursor: 'pointer',
                    fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  }}>{p.label}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {([['bg', '배경색'], ['fg', '글씨색']] as const).map(([k, label]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: FONT, fontSize: 12, color: '#64748B' }}>{label}</span>
                <input type="color" value={form[k]}
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value.toUpperCase() }))}
                  style={{ width: 36, height: 30, border: '1px solid #E2E8F0', borderRadius: 6, padding: 2, background: '#fff', cursor: 'pointer' }} />
                <input value={form[k]}
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value.toUpperCase() }))}
                  style={{ ...INPUT, width: 104, fontFamily: 'ui-monospace, monospace' }} />
              </div>
            ))}
          </div>
        </div>

        {/* 게시 기간 */}
        <div>
          <span style={LABEL}>게시 기간 <span style={{ color: '#DC2626' }}>*</span></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={form.from} max={form.to}
              onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
              style={{ ...INPUT, width: 160 }} />
            <span style={{ color: '#94A3B8' }}>~</span>
            <input type="date" value={form.to} min={form.from}
              onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
              style={{ ...INPUT, width: 160 }} />
            {[['오늘 하루', 0], ['1주일', 6], ['2주일', 13]].map(([label, d]) => (
              <button key={label as string} className="btn"
                onClick={() => setForm(f => ({ ...f, from: todayStr(), to: addDays(todayStr(), d as number) }))}
                style={{
                  padding: '7px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC',
                  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer',
                }}>{label as string}</button>
            ))}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
            시작일 00:00 부터 종료일 23:59(KST)까지 노출됩니다.
          </div>
        </div>

        {/* 활성 + 저장 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 13, color: '#374151' }}>
            <input type="checkbox" checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            활성화 (끄면 기간 안이어도 표시되지 않습니다)
          </label>
          <div style={{ flex: 1 }} />
          {editing && (
            <button className="btn" onClick={() => setForm(emptyForm())}
              style={{
                padding: '9px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
                fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#64748B', cursor: 'pointer',
              }}>취소</button>
          )}
          <button className="btn" onClick={handleSave} disabled={!dirty || saving}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: dirty && !saving ? '#111' : '#E2E8F0',
              color:      dirty && !saving ? '#fff' : '#94A3B8',
              fontFamily: FONT, fontSize: 13, fontWeight: 700,
              cursor: dirty && !saving ? 'pointer' : 'default',
            }}>{saving ? '저장 중…' : editing ? '수정 저장' : '공지 등록'}</button>
        </div>
      </div>

      {/* ── 목록 ─────────────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: '#1E1E1E', marginBottom: 10 }}>
          공지 목록 {loading ? '' : `(${list.length})`}
        </div>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#A5AEC0', fontSize: 13 }}>불러오는 중…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#CBD5E1', fontSize: 13 }}>등록된 공지가 없습니다</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map(a => {
              const st = statusOf(a)
              const meta = STATUS_META[st]
              return (
                <div key={a.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
                    borderBottom: '1px solid #F5F7FA', flexWrap: isMobile ? 'wrap' : 'nowrap',
                  }}>
                  <span style={{
                    flexShrink: 0, padding: '3px 10px', borderRadius: 999,
                    background: meta.bg, color: meta.fg,
                    fontFamily: FONT, fontSize: 11, fontWeight: 700,
                  }}>{meta.label}</span>

                  {/* 실제 색으로 렌더 — 목록에서 조합을 바로 확인할 수 있어야 한다 */}
                  <span style={{
                    flex: 1, minWidth: 0, background: a.bg_color, color: a.text_color,
                    borderRadius: 6, padding: '6px 10px',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{a.message}</span>

                  <span style={{ flexShrink: 0, fontFamily: FONT, fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                    {toKstDayStr(a.starts_at)} ~ {toKstDayStr(a.ends_at)}
                  </span>

                  <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => handleEdit(a)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>수정</button>
                    <button className="btn" onClick={() => handleDelete(a)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>삭제</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
