/**
 * AnnouncementsPage.tsx — 공지사항 페이지 (2026-08-19 고지 확정, 미리보기 승인분)
 *
 * 데이터: announcements 테이블 그대로 (헤더 배너 NoticeBar 와 동일 원천).
 *  - 게시중: is_active + 기간 내 — 관리자가 지정한 배너 색으로 강조
 *  - 지난 공지: 게시가 시작됐던 활성 공지 중 기간 종료분 (최근 시작순, 6개월)
 *  - 철회(is_active=false)·예약(미래 시작) 공지는 RLS 가 숨긴다 (20260749)
 *  - 상세·검색 없음 — 한 줄 공지 특성상 목록이 전부 (승인분)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Announcement } from '../lib/api'

const FONT = "'Pretendard', -apple-system, sans-serif"

const DOW = ['일', '월', '화', '수', '목', '금', '토']
function fmtD(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`
}

interface Props {
  showToast: (m: string) => void
}

export function AnnouncementsPage({ showToast }: Props) {
  const [rows, setRows] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const since = new Date(Date.now() - 183 * 24 * 3600 * 1000).toISOString()  // 최근 6개월
    supabase
      .from('announcements')
      .select('*')
      .gte('starts_at', since)
      .order('starts_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) showToast(error.message)
        else setRows((data ?? []) as Announcement[])
        setLoading(false)
      })
  }, [showToast])

  const now = Date.now()
  // RLS 가 활성+게시시작분만 주지만, 방어적으로 클라에서도 동일 기준 분류
  const active = rows.filter(a => a.is_active && Date.parse(a.starts_at) <= now && now <= Date.parse(a.ends_at))
  const past   = rows.filter(a => !active.includes(a))

  return (
    <div style={{ maxWidth: 860 /* ← [2026-08-19 고지 지시] 680 좁음 — Release Note 와 동일 텍스트 페이지 폭 */, margin: '0 auto', padding: '24px 16px 60px', fontFamily: FONT, color: '#111' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 16px' }}>공지사항</h1>

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748B' }}>불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#64748B' }}>최근 6개월 공지가 없습니다.</p>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 6px' }}>게시중</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                {active.map(a => (
                  <div key={a.id}
                    style={{ background: a.bg_color, color: a.text_color,
                             borderRadius: 10, padding: '12px 14px' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{a.message}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.75 }}>
                      게시기간 {fmtD(a.starts_at)} ~ {fmtD(a.ends_at)} · 지금 헤더 배너에 표시 중
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 6px' }}>지난 공지</p>
          {past.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94A3B8' }}>지난 공지가 없습니다.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {past.map(a => (
                <div key={a.id}
                  style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                           padding: '11px 14px' }}>
                  <p style={{ margin: 0, fontSize: 14 }}>{a.message}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: '#B0B8C1' }}>
                    {fmtD(a.starts_at)} ~ {fmtD(a.ends_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: '12px 0 0', fontSize: 11, color: '#B0B8C1' }}>최근 6개월 공지를 표시합니다</p>
        </>
      )}
    </div>
  )
}
