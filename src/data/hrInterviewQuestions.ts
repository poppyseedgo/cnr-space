// ============================================================
// HR 1차 인터뷰 문항 SSOT — [2026-09-03] 신규
// 출처: Figma DgaNxRBXRAn65opFAZf3cG / node 7:750 "HR 1차 인터뷰" (확정본, 1:1 전사)
//   · hl:true = Figma #ff542e 강조 구간
//   · [] = 빈 줄
//   · 문항 텍스트 변경은 이 파일만 수정 (DB 무관)
// ============================================================
import type { HrInterviewQuestion } from '../types/hrInterview'

export const HR_INTERVIEW_TITLE_LINE1 = '근태 APP 내재화를 위한'
export const HR_INTERVIEW_TITLE_LINE2_EN = 'HR'          // Instrument Sans
export const HR_INTERVIEW_TITLE_LINE2_KO = ' Interview 1차'

export const HR_INTERVIEW_QUESTIONS: HrInterviewQuestion[] = [
  {
    id: 'q1', no: 1,
    purpose: ['현재 시프티에 대한 AS-IS'], purposeColor: '#ff542e',
    weight: 600, lineHeight: 1.45,
    lines: [
      [{ text: '현재 사용중인 근태 서비스 <시프티>를 사용하며' }],
      [{ text: '가장 불편하다고 생각하는 기능', hl: true }, { text: '이 있나요? ' }],
      [],
      [{ text: '체감되는 불편함을 정량화 한다 가정하고' }],
      [{ text: '불편사항 5개 이상을 나열해주세요.' }],
    ],
    placeholder: '의견을 자유롭게 작성해주세요.',
  },
  {
    id: 'q2', no: 2,
    purpose: ['현재 시프티에 대한 AS-IS'], purposeColor: '#ff542e',
    weight: 600, lineHeight: 1.45,
    lines: [
      [{ text: '근태 앱이 지녀야할 기능 중 ' }],
      [{ text: '가장 필요하다 생각하는 기능', hl: true }, { text: '은 무엇인가요?' }],
      [],
      [{ text: '중요도와 우선순위를 고려하여 ' }],
      [{ text: '5개 이상의 아이디어를 나열해주세요.' }],
    ],
    placeholder: '의견을 작성해주세요.',
  },
  {
    id: 'q3', no: 3,
    purpose: ['AS-IS + TO-BE'], purposeColor: '#ff542e',
    weight: 600, lineHeight: 1.45,
    lines: [
      [{ text: '현재 시프티에 누적된 근태 기록으로' }],
      [{ text: '어떠한 데이터 인사이트를 얻고 있나요?' }],
      [],
      [{ text: '그리고 앞으로 더 확장된 데이터 인사이트를 위해 ', hl: true }],
      [{ text: '필요한 기능', hl: true }, { text: '에 대해 자세하게 설명해 주세요.' }],
    ],
    placeholder: '의견을 작성해주세요.',
  },
  {
    id: 'q4', no: 4,
    purpose: ['상위권자 및 조직도 자동 반영에 대한 API 설계 관련', '기존 시프티 조직도 관리 체계 및 기능 확인'],
    purposeColor: '#919191',
    weight: 600, lineHeight: 1.4,
    lines: [
      [{ text: '시프티에 어떠한 방식으로 조직도를 반영하고 있나요?' }],
      [],
      [{ text: '현재 그룹내 조직도 관리 및 업데이트에 대한 불편사항', hl: true }, { text: '과' }],
      [{ text: '일원화된 조직도 정보 관리에 필요한 기능있다면' }],
      [{ text: '자세하게 설명해주세요.' }],
    ],
    placeholder: '의견을 작성해주세요.',
  },
  {
    id: 'q5', no: 5,
    purpose: ['AS-IS + TO-BE'], purposeColor: '#ff542e',
    weight: 600, lineHeight: 1.45,
    lines: [
      [{ text: '현재 시프티에 누적된 근태 기록으로' }],
      [{ text: '어떠한 데이터 인사이트를 얻고 있나요?' }],
      [],
      [{ text: '그리고 앞으로 더 확장된 데이터 인사이트를 위해 ', hl: true }],
      [{ text: '필요한 기능 또는 Needs', hl: true }, { text: ' 대해 자세하게 설명해 주세요.' }],
    ],
    placeholder: '의견을 작성해주세요.',
  },
  {
    id: 'q6', no: 6,
    purpose: ['근무 규정 관련'], purposeColor: '#ff542e',
    weight: 500, lineHeight: 1.45,
    lines: [
      [{ text: '결근, 지각, 조퇴 등 다양한 근태 상태를 ' }],
      [{ text: '내규에 따라 자동으로 적용되는 기능도 구현하려 합니다. ' }],
      [{ text: '지각 및 조퇴 기준에 대한 내규 정보가 있나요? (예: 지각 몇 분 유예 규칙 등)' }],
      [],
      [{ text: '임직원의 ' }, { text: '직무별, 직급별 개개인의 근태 상태를 ', hl: true }],
      [{ text: '세부적으로 관리하기 위한 아이디어를 작성', hl: true }, { text: '해주세요.' }],
    ],
    placeholder: '의견을 작성해주세요.',
  },
  {
    id: 'q7', no: 7,
    purpose: ['확장 기능 설계안에 대한 의견'], purposeColor: '#ff542e',
    weight: 600, lineHeight: 1.45,
    lines: [
      [{ text: '근태 기록 및 휴가 생성, 경조사 관련 결재를 LM(관리자)이 승인하고, ' }],
      [{ text: '임직원의 재직 및 휴가 ‘상태’가 그룹웨어로 연동되어 ' }],
      [{ text: '단 한 번의 결재 프로세스로 관리하려고 합니다. ' }],
      [],
      [{ text: '해당 아이디어에 동의하시나요? ' }],
      [{ text: '또는 더 좋은 아이디어가 있다면 자유롭게 서술해주세요. ' }],
    ],
    placeholder: '의견을 자유롭게 작성해주세요.',
  },
  {
    id: 'q8', no: 8,
    purpose: ['핵심 사용자 목소리'], purposeColor: '#ff542e',
    weight: 500, lineHeight: 1.45,
    lines: [
      [{ text: '근태앱을 더 편리하게 사용할 수 있도록', hl: true }],
      [{ text: '추가적인 번뜩이는 아이디어가 있다면 ' }],
      [{ text: '편하게 작성해주세요!' }],
    ],
    placeholder: '의견을 자유롭게 작성해주세요.',
  },
]
