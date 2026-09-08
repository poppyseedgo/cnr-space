/**
 * LobbyNoticePanel.tsx — 어드민 'CANTEEN DP' (로비 디스플레이 공지 관리)
 *
 * [2026-09-08] 신규 — cnr-res 단독 admin.html 을 SPACE 어드민으로 이식.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 판단
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · 권한은 별도 역할을 신설하지 않고 **notice 역할을 공유**한다 (고지 확정).
 *    RLS(lobby_notices·스토리지)도 has_admin_role('notice') 기준이라 탭 게이트와
 *    데이터 권한이 같은 역할 — 도서관에서 겪은 관리자 이중분리 사고가 구조적으로 불가능.
 *
 *  · 등록 한도(LOBBY_NOTICE_LIMIT)는 UI(버튼 차단)와 DB 트리거(enforce_lobby_notice_limit) 이중.
 *    화면만 믿으면 탭 두 개를 동시에 열고 각각 올리는 경우가 뚫린다.
 *
 *  · Storage 키는 ASCII 생성 규칙({timestamp}_{rand}.{ext}, ext는 MIME 기준).
 *    한글 원본 파일명을 키에 넣으면 400 Invalid key (2026-09-03 실사고 규칙).
 *    원본 파일명은 file_name 컬럼에만 보존해 목록에 표시한다.
 *
 *  · 디스플레이 반영은 별도 신호 없이 로비 페이지의 30초 폴링에 맡긴다.
 *    공지 배너의 Broadcast 방식을 안 쓴 이유 — 수신자가 사내 임직원 N명이 아니라
 *    로비 키오스크 1대뿐이고, 폴링이 이미 있어 신호 채널은 중복 장치가 된다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { DateField } from './DateField'
import {
  loadLobbyNotices, uploadLobbyNotice, updateLobbyNotice,
  reorderLobbyNotices, deleteLobbyNotice, lobbyNoticePublicUrl,
  LOBBY_NOTICE_LIMIT, type LobbyNotice,
} from '../../lib/api'

const FONT = "'Pretendard', -apple-system, sans-serif"

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #EEF1F6', borderRadius: 16, padding: 18,
}
const SMALL_BTN: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
  cursor: 'pointer', fontSize: 13, color: '#475569', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
}

/** 목록 행 상태 라벨 — is_visible 과 기간이 따로 놀아 "왜 안 뜨지"가 생기는 걸 방지 (공지 배너와 동일 원칙) */
function statusOf(n: LobbyNotice, today: string): { label: string; color: string } {
  if (!n.is_visible) return { label: '숨김', color: '#94A3B8' }
  if (n.starts_at && n.starts_at > today) return { label: '게시 예정', color: '#B45309' }
  if (n.ends_at && n.ends_at < today) return { label: '기간 종료', color: '#94A3B8' }
  return { label: '노출 중', color: '#15803D' }
}

function todayStrLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

interface Props {
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  isMobile: boolean
}

export function LobbyNoticePanel({ showToast, isMobile }: Props) {
  const [items, setItems] = useState<LobbyNotice[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LobbyNotice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const today = todayStrLocal()

  const load = useCallback(() => {
    loadLobbyNotices()
      .then(setItems)
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [showToast])

  useEffect(() => { load() }, [load])

  // ── 업로드 ────────────────────────────────────────────────────────────────
  const handleFile = (file: File | undefined | null) => {
    if (!file || uploading) return
    setUploading(true)
    uploadLobbyNotice(file, items)
      .then(() => { showToast('업로드 완료 — 로비 화면에 30초 내 반영됩니다.', 'success'); load() })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setUploading(false))
  }

  // ── 순서 변경: 배열 스왑 후 전체 sort_order 재부여 (인접 스왑만 하면 초기값 0 중복에서 순서가 안 바뀐다) ──
  const move = (i: number, dir: -1 | 1) => {
    if (reordering) return
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setReordering(true)
    reorderLobbyNotices(next.map(n => n.id))
      .then(() => setItems(next))
      .catch(e => { showToast(e.message, 'error'); load() })
      .finally(() => setReordering(false))
  }

  const toggleVisible = (n: LobbyNotice) => {
    updateLobbyNotice(n.id, { is_visible: !n.is_visible })
      .then(load)
      .catch(e => showToast(e.message, 'error'))
  }

  const savePeriod = (n: LobbyNotice, starts: string, ends: string) => {
    if (starts && ends && starts > ends) { showToast('종료일이 시작일보다 빠릅니다.', 'error'); return }
    updateLobbyNotice(n.id, { starts_at: starts || null, ends_at: ends || null })
      .then(() => { showToast('게시기간 저장됨', 'success'); load() })
      .catch(e => showToast(e.message, 'error'))
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    setDeleting(true)
    deleteLobbyNotice(deleteTarget)
      .then(() => { showToast('삭제됨', 'success'); setDeleteTarget(null); load() })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setDeleting(false))
  }

  const full = items.length >= LOBBY_NOTICE_LIMIT

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT }}>
      {/* ── 업로드 카드 ── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>CANTEEN DP</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
              로비 디스플레이(쇼츠 옆 공지 영역)에 순환 재생되는 이미지/GIF를 관리합니다.
              정지 이미지 5초, GIF는 자체 길이만큼 재생 후 다음으로 넘어갑니다.
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: full ? '#B91C1C' : '#64748B', whiteSpace: 'nowrap', marginLeft: 12 }}>
            {items.length} / {LOBBY_NOTICE_LIMIT}
          </div>
        </div>
        <div
          onClick={() => { if (!full && !uploading) fileRef.current?.click() }}
          onDragOver={e => { e.preventDefault(); if (!full) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (!full) handleFile(e.dataTransfer.files?.[0]) }}
          style={{
            border: `1.5px dashed ${dragOver ? '#00A551' : '#CBD5E1'}`,
            background: dragOver ? '#F0FDF6' : (full ? '#F8FAFC' : '#fff'),
            borderRadius: 12, padding: '22px 14px', textAlign: 'center',
            cursor: full || uploading ? 'not-allowed' : 'pointer', transition: 'background .15s',
          }}
        >
          <div style={{ fontSize: 13, color: full ? '#94A3B8' : '#475569', fontWeight: 500 }}>
            {uploading ? '업로드 중...'
              : full ? `최대 ${LOBBY_NOTICE_LIMIT}개 — 삭제 후 업로드할 수 있습니다`
              : '이미지/GIF 끌어다 놓기 또는 클릭해 업로드 (PNG · JPG · GIF · WEBP)'}
          </div>
        </div>
        <input
          ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }}
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>

      {/* ── 목록 카드 ── */}
      <div style={CARD}>
        {loading ? (
          <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '18px 0' }}>불러오는 중...</div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '18px 0' }}>
            등록된 공지가 없습니다. 로비 화면에는 브랜드 마크가 표시됩니다.
          </div>
        ) : items.map((n, i) => (
          <NoticeRow
            key={n.id} n={n} idx={i} total={items.length} today={today}
            isMobile={isMobile} busy={reordering}
            onMove={move} onToggle={toggleVisible} onSavePeriod={savePeriod}
            onDelete={() => setDeleteTarget(n)}
          />
        ))}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="공지 삭제"
          message={<>"{deleteTarget.file_name}" 을(를) 삭제합니다.<br/>로비 화면에서 30초 내 제거되며 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          variant="danger"
          loading={deleting}
          onConfirm={confirmDelete}
          onClose={() => { if (!deleting) setDeleteTarget(null) }}
        />
      )}
    </div>
  )
}

/** 행 — 게시기간 초안은 행 내부 상태 (저장 버튼은 변경이 생겼을 때만 노출) */
function NoticeRow({ n, idx, total, today, isMobile, busy, onMove, onToggle, onSavePeriod, onDelete }: {
  n: LobbyNotice; idx: number; total: number; today: string; isMobile: boolean; busy: boolean
  onMove: (i: number, dir: -1 | 1) => void
  onToggle: (n: LobbyNotice) => void
  onSavePeriod: (n: LobbyNotice, starts: string, ends: string) => void
  onDelete: () => void
}) {
  const [starts, setStarts] = useState(n.starts_at ?? '')
  const [ends, setEnds] = useState(n.ends_at ?? '')
  const dirty = starts !== (n.starts_at ?? '') || ends !== (n.ends_at ?? '')
  const st = statusOf(n, today)

  return (
    <div style={{
      border: '1px solid #EEF1F6', borderRadius: 12, padding: '10px 12px', marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 12, opacity: n.is_visible ? 1 : 0.6,
      flexWrap: isMobile ? 'wrap' : 'nowrap',
    }}>
      <div style={{
        width: 84, height: 47, borderRadius: 6, flexShrink: 0, border: '1px solid #E2E8F0',
        background: `#000 url("${lobbyNoticePublicUrl(n.file_path)}") center/contain no-repeat`,
      }}/>
      <div style={{ flex: 1, minWidth: isMobile ? '100%' : 0, order: isMobile ? 3 : 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {n.file_name}
          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, marginLeft: 8 }}>{st.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <DateField value={starts} onChange={setStarts} placeholder="시작일" ariaLabel="게시 시작일"
            style={{ width: 118, fontSize: 12 }}/>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>~</span>
          <DateField value={ends} onChange={setEnds} placeholder="종료일" ariaLabel="게시 종료일"
            style={{ width: 118, fontSize: 12 }}/>
          {dirty && (
            <button
              onClick={() => onSavePeriod(n, starts, ends)}
              style={{ ...SMALL_BTN, width: 'auto', padding: '0 10px', color: '#15803D', borderColor: '#BBE7C9', fontWeight: 700, fontSize: 12 }}
            >기간 저장</button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
        <button style={SMALL_BTN} disabled={idx === 0 || busy} onClick={() => onMove(idx, -1)} aria-label="위로">↑</button>
        <button style={SMALL_BTN} disabled={idx === total - 1 || busy} onClick={() => onMove(idx, 1)} aria-label="아래로">↓</button>
        <button style={SMALL_BTN} onClick={() => onToggle(n)} aria-label={n.is_visible ? '숨기기' : '노출하기'}>
          {n.is_visible ? '◉' : '○'}
        </button>
        <button style={{ ...SMALL_BTN, color: '#B91C1C', borderColor: '#F3CACA' }} onClick={onDelete} aria-label="삭제">✕</button>
      </div>
    </div>
  )
}
