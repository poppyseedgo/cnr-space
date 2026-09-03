// ============================================================
// HR Interview 타입 — [2026-09-03] 신규
// 문항 SSOT: src/data/hrInterviewQuestions.ts / 답변 DB: hr_interview_answers
// ============================================================

/** 질문 본문의 한 조각 — Figma 하이라이트(#ff542e) 구간을 표현 */
export interface HrTextSegment {
  text: string
  /** true면 #ff542e 강조색 */
  hl?: boolean
}

/** 질문 본문의 한 줄. 빈 배열([])은 빈 줄(줄 간격 확보용) */
export type HrQuestionLine = HrTextSegment[]

export interface HrInterviewQuestion {
  /** DB question_id 로 저장되는 안정 식별자 */
  id: string
  /** 화면 표시 번호(1부터) */
  no: number
  /** 조사 목적 스크립트(여러 줄 가능) */
  purpose: string[]
  /** 조사 목적 색상 — Figma: 대부분 #ff542e, 4번 문항만 #919191 */
  purposeColor: '#ff542e' | '#919191'
  /** 질문 본문 굵기 — Figma: SemiBold(600) 또는 Medium(500) */
  weight: 500 | 600
  /** 질문 본문 행간 — Figma: 1.45 (4번 문항만 1.4) */
  lineHeight: 1.4 | 1.45
  /** 질문 본문 */
  lines: HrQuestionLine[]
  /** 입력창 placeholder */
  placeholder: string
}

export type HrAnswerStatus = 'draft' | 'submitted'

/** hr_interview_answers 행 (snake_case = DB 컬럼명) */
export interface HrInterviewAnswerRow {
  id: string
  question_id: string
  user_id: string
  content: string
  image_paths: string[]
  status: HrAnswerStatus
  submitted_at: string | null
  created_at: string
  updated_at: string
}

/** 브라우저 localStorage 임시본 */
export interface HrLocalDraft {
  content: string
  image_paths: string[]
  /** epoch ms — DB updated_at 과 비교해 최신본 판정 */
  saved_at: number
}

/** [2026-09-03 A안] 관리자 현황용 — profiles 조인 행 */
export interface HrAnswerWithProfile extends HrInterviewAnswerRow {
  profiles: { name: string | null; dept: string | null; email: string | null } | null
}

/** 매트릭스 셀 상태 */
export type HrCellStatus = 'none' | 'draft' | 'submitted'
