/**
 * OrgStepper.tsx — 조직 개편 4단계 스텝퍼 + '캔버스' (설계서 §15.2, 2026-10-02 확정)
 *  - [2026-10-02 ORG 8-A] 신규. ① 구조 설계만 활성. ② 단위 바인드(8-B) · ③ 인원 배치(8-C) · ④ 검토·확정(8-E) 은 준비 중(비활성)
 *  - 초안에서만 표시. 캔버스(조직 트리/노드/목록)는 어느 단계에서든 열 수 있는 미리보기·미세 조정 화면
 */
import { OG } from './orgShared'

export type OrgStep = 1 | 2 | 3 | 4 | 'canvas'
const STEPS: { id: OrgStep; label: string; ready: boolean; hint: string }[] = [
  { id: 1, label: '① 구조 설계', ready: true,  hint: '단위(조직) 트리를 아웃라이너와 상세 패널로 편집' },
  { id: 2, label: '② 단위 바인드', ready: false, hint: '준비 중 (8-B) — 이전 조직도 단위 · Azure 부서 · 단위장 포지션 연결' },
  { id: 3, label: '③ 인원 배치', ready: false, hint: '준비 중 (8-C) — 인원 풀에서 저장된 트리로 배치' },
  { id: 4, label: '④ 검토·확정', ready: false, hint: '준비 중 (8-E) — 변경 요약 · 검증 · 활성화' },
]

export function OrgStepper({ step, onChange }: { step: OrgStep; onChange: (s: OrgStep) => void }) {
  const seg = (active: boolean, disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px', fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
    background: active ? OG.ink : '#fff', color: active ? '#fff' : disabled ? OG.faint : OG.quiet, borderLeft: `1px solid ${OG.line}`,
  })
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${OG.line}`, borderRadius: 8, overflow: 'hidden', fontFamily: OG.font }} aria-label="조직 개편 단계">
      {STEPS.map((s, i) => (
        <div key={String(s.id)} title={s.hint} onClick={() => s.ready && onChange(s.id)} style={{ ...seg(step === s.id, !s.ready), borderLeft: i === 0 ? 'none' : `1px solid ${OG.line}` }}>
          {s.label}{!s.ready && <span style={{ fontSize: 10, marginLeft: 4, opacity: .8 }}>준비 중</span>}
        </div>
      ))}
      <div title="조직 트리 · 노드 캔버스 · 단위별 리스트 — 어느 단계에서든 미리보기·미세 조정" onClick={() => onChange('canvas')} style={{ ...seg(step === 'canvas', false), borderLeft: `2px solid ${OG.line}` }}>캔버스</div>
    </div>
  )
}
