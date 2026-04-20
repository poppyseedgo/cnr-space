// ============================================================================
// C&R Space Pilot Survey - 전체 문항 정의
// Figma 설계 100% 반영 (S1 ~ S4-5, 총 17 슬라이드)
// ============================================================================

export const SURVEY_SLIDES = [
  // ------------------------------------------------------------------
  // S1. Intro
  // ------------------------------------------------------------------
  {
    id: 's1_intro',
    type: 'intro',
    title: 'C&R SPACE',
    subtitle: '파일럿 테스트',
    description: '회의실 예약 시스템 정식 오픈 전, 실사용자 집단의 응답을 수집하는 필수 검증 단계입니다.',
    meta: [
      { label: '소요 시간', value: '15 — 20 min' },
      { label: '총 Task 수', value: '07' },
      { label: '자동 저장', value: '실시간' },
    ],
    nextLabel: '테스트 시작하기',
  },

  // ------------------------------------------------------------------
  // S2-1. 응답자 정보
  // ------------------------------------------------------------------
  {
    id: 's2_respondent',
    type: 'form',
    title: '개인식별 또는 익명 선택',
    fields: [
      {
        key: 'respondent_name',
        type: 'text',
        label: '이름 또는 부서명을 작성해 주세요.',
        placeholder: '예: 홍길동 / 경영기획팀',
      },
      {
        key: 'anonymous',
        type: 'single_checkbox',
        label: '익명으로 참여할게요',
      },
    ],
  },

  // ------------------------------------------------------------------
  // S2-2. 테스트 안내
  // ------------------------------------------------------------------
  {
    id: 's2_guide',
    type: 'notice',
    title: '브라우저에서 cnr-space.pages.dev 접속 후',
    subtitle: '7개의 Task를 순서대로 수행해 주세요.',
  },

  // ------------------------------------------------------------------
  // S3-1. Task 1: Microsoft 365 로그인
  // ------------------------------------------------------------------
  {
    id: 's3_task1',
    type: 'task',
    taskLabel: 'Task 1',
    title: 'Microsoft 365 로그인',
    description: '회사에서 부여한 C&R Microsoft 365 아이디(@cnrres.com)로 로그인 합니다.',
    sections: [
      {
        heading: '기능이 작동 했다면 체크박스를 모두 체크해주세요!',
        items: [
          { key: 't1_login_success', label: '로그인 성공' },
          { key: 't1_profile_visible', label: '상단 프로필 영역에 내 이름 확인' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // S3-2. Task 2-1: 홈 화면 경험
  // ------------------------------------------------------------------
  {
    id: 's3_task2_1',
    type: 'task',
    taskLabel: 'Task 2-1',
    title: '홈 화면 경험',
    description: '실시간 회의실 이용 상태를 한눈에 파악할 수 있는지 확인합니다.',
    sections: [
      {
        heading: '홈 화면에서 아래 기능을 확인하세요.',
        items: [
          { key: 't2_1_available_room', label: '실시간 현황(홈 화면)에서 [예약가능] 회의실 확인' },
          { key: 't2_1_in_use_end_time', label: '[사용중] 회의실의 종료 시각 확인' },
          { key: 't2_1_capacity_6plus', label: '6인 이상 수용 가능한 회의실 확인' },
        ],
      },
      {
        heading: '홈 화면에서 아래 요소들을 확인하세요.',
        items: [
          { key: 't2_1_status_filter', label: '회의실 상태 필터 (전체/예약가능/사용중)' },
          { key: 't2_1_room_info', label: '회의실별 현재 사용 정보와 다음 예약 정보' },
          { key: 't2_1_floor_filter', label: '층별 필터 (1층~6층)' },
          { key: 't2_1_search', label: '회의실 검색 기능 작동 확인' },
          { key: 't2_1_detail_spec', label: '회의실 개별 상세 스펙 및 당일 예약 현황' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // S3-3. Task 2-2: 캘린더 뷰 경험
  // ------------------------------------------------------------------
  {
    id: 's3_task2_2',
    type: 'task',
    taskLabel: 'Task 2-2',
    title: '캘린더 뷰 경험',
    description: '일 Daily Timeline View / 주 Weekly / 월 Monthly 3종 캘린더 뷰타입 확인',
    sections: [
      {
        heading: '기능이 작동 했다면 체크박스를 체크해주세요!',
        items: [
          { key: 't2_2_date_navigation', label: '날짜 이동하며 회의실 별 예약현황 확인' },
          { key: 't2_2_slot_click_book', label: '비어있는 슬롯(시간) 클릭 하여 바로 예약화면 진입' },
          { key: 't2_2_my_booking_filter', label: '전체 예약 현황 중 내 예약만 볼 수 있는 기능 확인' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // S3-4. Task 3: 1분 내 예약 경험
  // ------------------------------------------------------------------
  {
    id: 's3_task3',
    type: 'task',
    taskLabel: 'Task 3',
    title: '1분 내 예약 경험',
    sections: [
      {
        heading: '예약 플로우 체크',
        items: [
          { key: 't3_entry_point', label: '홈 화면 <예약 버튼> 또는 캘린더 뷰 <빈 시간 슬롯> 선택' },
          { key: 't3_title_input', label: '회의 제목을 입력' },
          { key: 't3_today_selected', label: '이미 선택된 오늘 날짜 확인' },
          { key: 't3_book_complete', label: '예약 가능한 회의실 선택 후 예약완료' },
        ],
      },
      {
        heading: '예약 정책 확인',
        items: [
          { key: 't3_hours_7_19', label: '예약 가능 시간 - 오전 7시 ~ 오후 7시' },
          { key: 't3_15min_unit', label: '15분 단위 예약 가능 (ZOOM 예약 시간 정책과 동일)' },
          { key: 't3_auto_current_time', label: '현재 시간 기준 자동으로 예약 가능한 시간으로 설정됨' },
          { key: 't3_auto_filter_rooms', label: '선택 시간대에 예약 가능한 회의실 자동 필터링' },
          { key: 't3_1month_limit', label: '예약 가능 기간 - 오늘부터 1개월 이내 (선점 예약 방어)' },
          { key: 't3_email_notify', label: '예약 알림 메일 수신' },
        ],
      },
    ],
    openFeedback: {
      key: 't3_feedback',
      label: '예약 경험 추가 의견이 있으신가요?',
      placeholder: '필요하신 기능에 대해 적극적인 의견 부탁드립니다.',
    },
  },

  // ------------------------------------------------------------------
  // S3-5. Task 4: 예약 변경 및 취소
  // ------------------------------------------------------------------
  {
    id: 's3_task4',
    type: 'task',
    taskLabel: 'Task 4',
    title: '예약 변경 및 취소',
    sections: [
      {
        heading: '예약 수정 플로우',
        items: [
          { key: 't4_enter_detail', label: 'Task 4에서 생성한 예약 클릭 후 예약상세 진입' },
          { key: 't4_edit_mode', label: '<변경> 버튼을 눌러 수정 모드로 진입' },
          { key: 't4_change_time_title', label: '시간 또는 제목을 자유롭게 변경해 봅니다' },
          { key: 't4_add_attendee', label: '동료에게 동의를 구한 후, 참석자로 동료를 추가해 보세요' },
          { key: 't4_save', label: '변경 사항을 저장합니다' },
        ],
      },
      {
        heading: 'Check!',
        items: [
          { key: 't4_change_email', label: '변경 알림 메일 수신' },
          { key: 't4_attendee_search', label: '참석자 추가시 팀즈와 동일한 이름으로 검색' },
          { key: 't4_attendee_email', label: '참석자로 추가한 동료에게도 메일 알림' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // S3-6. Task 5-1: 체크인 그리고 노쇼 자동취소 정책 이해
  // ------------------------------------------------------------------
  {
    id: 's3_task5_1',
    type: 'task',
    taskLabel: 'Task 5-1 미체크인 노쇼처리',
    title: '체크인 그리고 노쇼 자동취소 정책 이해',
    description: '현재 시각 기준 10분 이내 시작되는 예약을 하나 만드세요.',
    sections: [
      {
        heading: '노쇼 처리 플로우',
        items: [
          { key: 't5_1_start_email', label: '예약 시간이 시작되면 회의 시작을 알리는 <체크인 하세요> 메일이 수신됩니다.' },
          { key: 't5_1_checkin_active', label: '오늘 내 예약 화면에서 <체크인>버튼이 활성화 됩니다.' },
          { key: 't5_1_ignore_checkin', label: '활성화된 체크인 버튼을 누르지 않고 계속 동안 방치합니다.' },
          { key: 't5_1_pending_label', label: '홈 화면에 내가 예약한 회의실 상태가 <사용중> 상태로, <체크인 대기> 라벨이 표시되고 있음을 확인 합니다.' },
          { key: 't5_1_5min_warning', label: '사용시간 5분이 흐르면 미체크인 경고 메일을 수신합니다.' },
          { key: 't5_1_10min_cancel', label: '사용시간 시작 후 10분 동안 체크인 하지 않으면 해당 예약을 시스템이 자동취소 합니다.' },
          { key: 't5_1_noshow_status', label: '미체크인 예약이 <노쇼> 처리되어 화면에 남습니다.' },
          { key: 't5_1_noshow_email', label: '<노쇼> 되었음을 알리는 메일을 수신합니다.' },
        ],
      },
    ],
    policyNote: [
      'C&R SPACE는 예약 시작 시각으로부터 10분 이내에 체크인이 없으면 예약을 자동으로 취소합니다. 자동 취소된 회의실은 즉시 다른 동료가 사용할 수 있도록 예약가능 상태로 전환됩니다. 이 정책은 "예약만 하고 사용하지 않는" 사내 회의실 낭비를 줄이기 위한 핵심 장치입니다.',
      '체크인 누르고 노쇼...할 경우 아이디 정지 및 패널티 부여 정책 검토중',
    ],
    openFeedback: {
      key: 't5_1_feedback',
      label: '체크인 기능과 노쇼 자동취소 기능에 대한 의견이 있으신가요?',
      placeholder: '필요하신 기능에 대해 적극적인 의견 부탁드립니다.',
    },
  },

  // ------------------------------------------------------------------
  // S3-7. Task 5-2: 조기반납 하기
  // ------------------------------------------------------------------
  {
    id: 's3_task5_2',
    type: 'task',
    taskLabel: 'Task 5-2 체크인 후 조기반납 하기',
    title: '조기반납 하기',
    description: '현재 시각 기준 10분 이내 시작되는 예약을 하나 더 만드세요.',
    sections: [
      {
        heading: '조기반납 플로우',
        items: [
          { key: 't5_2_start_email', label: '예약 시간이 시작되면 회의 시작을 알리는 <체크인 하세요> 메일이 수신됩니다.' },
          { key: 't5_2_click_checkin', label: '활성화 된 <체크인>버튼을 누릅니다.' },
          { key: 't5_2_early_end_active', label: '<체크인>을 누르면 <조기 반납>버튼이 활성화 됩니다.' },
          { key: 't5_2_early_end_return', label: '회의를 1분 정도 진행한 뒤, 활성화 된 <조기 반납> 버튼을 클릭하세요. 사용중이던 회의실 예약이 즉시 종료, 바로 시스템으로 반납됩니다.' },
          { key: 't5_2_email_notify', label: '조기 반납 알림 메일 수신' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // S3-8. Task 6: 에메랄드 승인 요청
  // ------------------------------------------------------------------
  {
    id: 's3_task6',
    type: 'task',
    taskLabel: 'Task 6',
    title: '에메랄드 승인 요청',
    sections: [
      {
        heading: '승인 예약 플로우',
        items: [
          { key: 't6_select_emerald', label: '예약 화면에서 비어있는 시간을 찾아 2F Emerald 선택' },
          { key: 't6_request_approval', label: '<승인 요청> 버튼 클릭' },
          { key: 't6_pending_status', label: '<승인 대기>상태로 생성된 예약 확인' },
          { key: 't6_approved_email', label: '관리자가 승인하면 <승인 완료> 메일 수신' },
          { key: 't6_status_confirmed', label: '<승인 완료> 변경된 예약상태 확인' },
        ],
      },
    ],
    openFeedback: {
      key: 't6_feedback',
      label: '에메랄드 룸 승인 기능에 대한 의견을 들려주세요.',
      placeholder: '필요하신 기능에 대해 적극적인 의견 부탁드립니다.',
    },
  },

  // ------------------------------------------------------------------
  // S3-9. Task 7: MY PAGE 탐색
  // ------------------------------------------------------------------
  {
    id: 's3_task7',
    type: 'task',
    taskLabel: 'Task 7',
    title: 'MY PAGE 탐색',
    description: '상단 프로필 클릭 후, My page 진입. 나의 과거, 현재, 미래의 예약을 모두 모아 볼 수 있는 페이지로 현재는 베타버전이 적용되어 있습니다.',
    sections: [
      {
        heading: '현재 구현된 기능 체크',
        items: [
          { key: 't7_month_count', label: '이번 달 예약 건수' },
          { key: 't7_checkin_rate', label: '체크인 율(%)' },
          { key: 't7_monthly_stats', label: '월별 이용 통계' },
          { key: 't7_top_room', label: '가장 많이 사용한 회의실' },
          { key: 't7_date_filter', label: '기간별 예약 조회 및 필터링' },
          { key: 't7_booking_detail', label: '개별 예약 상세 확인' },
        ],
      },
    ],
    openFeedback: {
      key: 't7_feedback',
      label: '마이 페이지에 더 원하는 기능이 있다면 상세하게 의견을 남겨주세요!',
      placeholder: '필요하신 기능에 대해 적극적인 의견 부탁드립니다.',
    },
  },

  // ------------------------------------------------------------------
  // S4-1. 마무리 안내
  // ------------------------------------------------------------------
  {
    id: 's4_wrap_intro',
    type: 'notice',
    title: '테스트는 다 완료 되었습니다!',
    subtitle: '몇 가지 간단한 질문만 남았습니다. 응답 부탁드려요!',
  },

  // ------------------------------------------------------------------
  // S4-2. 정책 효과 평가 (다중 선택)
  // ------------------------------------------------------------------
  {
    id: 's4_policy_effect',
    type: 'multi_choice',
    title: '체크인 / 자동취소 / 조기반납 정책이 사내 회의실 가용률 상승에 도움이 될 것이라 생각하시나요?',
    hint: '모두 선택해 주세요.',
    key: 'q_policy_effect',
    options: [
      { value: 'very_helpful', label: '매우 도움이 될 것 같다' },
      { value: 'somewhat_helpful', label: '지금보다는 도움이 될거라 예상한다' },
      { value: 'workaround_risk', label: '정책을 피해가는 사람들이 있을 것 같다' },
      { value: 'need_stronger', label: '더 강력한 제재가 필요하다' },
      { value: 'no_effect', label: '효과 없다' },
    ],
  },

  // ------------------------------------------------------------------
  // S4-3. Teams 알림 선호 (단일 선택)
  // ------------------------------------------------------------------
  {
    id: 's4_teams_pref',
    type: 'single_choice',
    title: '회의실 예약 관련 알림을 Teams 메신저로 받는다면 더 편리하다 생각하시나요?',
    key: 'q_teams_preference',
    options: [
      { value: 'very_convenient', label: '매우 편리할 것 같다' },
      { value: 'normal', label: '보통이다' },
      { value: 'not_convenient', label: '그닥 편리하지 않을 것 같다' },
      { value: 'email_better', label: '메일이 더 편리하다' },
    ],
  },

  // ------------------------------------------------------------------
  // S4-4. 선호 기능 (다중 선택)
  // ------------------------------------------------------------------
  {
    id: 's4_favorite',
    type: 'multi_choice',
    title: '가장 마음에 드는 기능이 있다면?',
    hint: '모두 선택해 주세요.',
    key: 'q_favorite_features',
    options: [
      { value: 'realtime_status', label: '홈 화면 실시간 회의실 상태' },
      { value: 'calendar_views', label: '다양한 캘린더 뷰' },
      { value: 'quick_booking', label: '빠른 예약' },
      { value: 'emerald_approval', label: '에메랄드룸 예약 승인 플로우' },
      { value: 'noshow_prevention', label: '노쇼 방지 기능' },
      { value: 'attendee_notify', label: '참석자 추가 및 자동 알림' },
    ],
  },

  // ------------------------------------------------------------------
  // S4-5. 종합 만족도 (단일 선택)
  // ------------------------------------------------------------------
  {
    id: 's4_satisfaction',
    type: 'single_choice',
    title: '신규 회의실 서비스 종합 만족도 평가',
    key: 'q_overall_satisfaction',
    options: [
      { value: 'very_helpful', label: '매우 도움이 될 것 같다' },
      { value: 'helpful', label: '도움이 될 것 같다' },
      { value: 'normal', label: '보통이다' },
      { value: 'not_helpful', label: '별로 도움이 안 될 것 같다' },
      { value: 'no_effect', label: '효과 없다' },
    ],
  },

  // ------------------------------------------------------------------
  // S4-6. Thank you
  // ------------------------------------------------------------------
  {
    id: 's4_thanks',
    type: 'thanks',
    title: '테스트가 모두 완료되었습니다!',
    description: '오늘 전달해 주신 의견을 반영하여 4월 22일 수요일 오픈 후 시범 운영 기간동안 더 개선하도록 하겠습니다. ZOOM 예약, 포인터 예약 등 더 확장된 기능도 기대해주세요. 참여해 주셔서 진심으로 감사드립니다.',
    closeLabel: '닫기',
  },
];

// 전체 슬라이드 개수 (프로그레스 바 계산용)
export const TOTAL_SLIDES = SURVEY_SLIDES.length;
