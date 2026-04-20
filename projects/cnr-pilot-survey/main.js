// ============================================================================
// C&R Space Pilot Survey - Main App
// ============================================================================

import { SURVEY_SLIDES, TOTAL_SLIDES } from './survey-data.js';
import {
  getOrCreateSessionId,
  saveDebounced,
  saveNow,
  loadExistingSession,
  onSaveStatus,
  resetSession,
} from './supabase-client.js';

// ----------------------------------------------------------------------------
// 전역 상태
// ----------------------------------------------------------------------------
const state = {
  current_step: 0,
  respondent_name: '',
  anonymous: false,
  answers: {},            // { [fieldKey]: value }
  is_completed: false,
};

// ----------------------------------------------------------------------------
// DOM 참조
// ----------------------------------------------------------------------------
const $root = document.getElementById('app');
const $progressBar = document.getElementById('progress-bar');
const $progressLabel = document.getElementById('progress-label');
const $saveStatus = document.getElementById('save-status');

// ----------------------------------------------------------------------------
// HTML escape (XSS 방지 - 근본 해결: 모든 사용자 입력은 escape)
// ----------------------------------------------------------------------------
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----------------------------------------------------------------------------
// 저장 상태 UI
// ----------------------------------------------------------------------------
onSaveStatus((status) => {
  if (!$saveStatus) return;
  const map = {
    idle: '',
    saving: '저장 중...',
    saved: '✓ 저장됨',
    error: '⚠ 저장 실패 (기기에 백업됨)',
  };
  $saveStatus.textContent = map[status] || '';
  $saveStatus.className = `save-status save-status--${status}`;

  if (status === 'saved') {
    setTimeout(() => {
      if ($saveStatus.textContent === '✓ 저장됨') {
        $saveStatus.textContent = '';
      }
    }, 2000);
  }
});

// ----------------------------------------------------------------------------
// 프로그레스 바 업데이트
// ----------------------------------------------------------------------------
function updateProgress() {
  const pct = (state.current_step / (TOTAL_SLIDES - 1)) * 100;
  $progressBar.style.width = `${pct}%`;
}

// ----------------------------------------------------------------------------
// 슬라이드 렌더러
// ----------------------------------------------------------------------------
function renderSlide(slide) {
  switch (slide.type) {
    case 'intro':       return renderIntro(slide);
    case 'form':        return renderForm(slide);
    case 'notice':      return renderNotice(slide);
    case 'task':        return renderTask(slide);
    case 'single_choice': return renderSingleChoice(slide);
    case 'multi_choice':  return renderMultiChoice(slide);
    case 'thanks':      return renderThanks(slide);
    default:            return `<div>Unknown slide: ${slide.type}</div>`;
  }
}

function renderIntro(slide) {
  const metaHtml = slide.meta.map(m => `
    <div class="meta-item">
      <div class="meta-label">${esc(m.label)}</div>
      <div class="meta-value">${esc(m.value)}</div>
    </div>
  `).join('');

  return `
    <div class="slide slide--intro">
      <div class="intro-head">
        <h1 class="intro-title">${esc(slide.title)}</h1>
        <p class="intro-subtitle">${esc(slide.subtitle)}</p>
      </div>
      <p class="intro-desc">${esc(slide.description)}</p>
      <div class="meta-list">${metaHtml}</div>
    </div>
  `;
}

function renderForm(slide) {
  const fieldsHtml = slide.fields.map(f => {
    if (f.type === 'text') {
      return `
        <div class="field">
          <label class="field-label" for="${esc(f.key)}">${esc(f.label)}</label>
          <input
            type="text"
            id="${esc(f.key)}"
            data-field="${esc(f.key)}"
            class="text-input"
            placeholder="${esc(f.placeholder || '')}"
            value="${esc(state.respondent_name || '')}"
            ${state.anonymous ? 'disabled' : ''}
          />
        </div>
      `;
    }
    if (f.type === 'single_checkbox') {
      return `
        <label class="checkbox-row">
          <input
            type="checkbox"
            data-single-check="${esc(f.key)}"
            ${state.anonymous ? 'checked' : ''}
          />
          <span class="check-box" aria-hidden="true"></span>
          <span class="check-label">${esc(f.label)}</span>
        </label>
      `;
    }
    return '';
  }).join('');

  return `
    <div class="slide slide--form">
      <h2 class="slide-title">${esc(slide.title)}</h2>
      <div class="form-fields">${fieldsHtml}</div>
    </div>
  `;
}

function renderNotice(slide) {
  return `
    <div class="slide slide--notice">
      <h2 class="notice-title">${esc(slide.title)}</h2>
      ${slide.subtitle ? `<p class="notice-subtitle">${esc(slide.subtitle)}</p>` : ''}
    </div>
  `;
}

function renderTask(slide) {
  const sectionsHtml = slide.sections.map(sec => `
    <div class="task-section">
      <p class="section-heading">${esc(sec.heading)}</p>
      <div class="checklist">
        ${sec.items.map(item => `
          <label class="checkbox-row">
            <input
              type="checkbox"
              data-answer="${esc(item.key)}"
              ${state.answers[item.key] ? 'checked' : ''}
            />
            <span class="check-box" aria-hidden="true"></span>
            <span class="check-label">${esc(item.label)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  const policyNoteHtml = slide.policyNote ? `
    <div class="policy-note">
      ${slide.policyNote.map(p => `<p>${esc(p)}</p>`).join('')}
    </div>
  ` : '';

  const feedbackHtml = slide.openFeedback ? `
    <div class="feedback-block">
      <label class="field-label" for="${esc(slide.openFeedback.key)}">
        ${esc(slide.openFeedback.label)}
      </label>
      <textarea
        id="${esc(slide.openFeedback.key)}"
        data-answer="${esc(slide.openFeedback.key)}"
        data-textarea
        class="textarea-input"
        placeholder="${esc(slide.openFeedback.placeholder)}"
        rows="4"
      >${esc(state.answers[slide.openFeedback.key] || '')}</textarea>
    </div>
  ` : '';

  return `
    <div class="slide slide--task">
      <div class="task-head">
        <span class="task-pill">${esc(slide.taskLabel)}</span>
        <h2 class="task-title">${esc(slide.title)}</h2>
        ${slide.description ? `<p class="task-desc">${esc(slide.description)}</p>` : ''}
      </div>
      ${sectionsHtml}
      ${policyNoteHtml}
      ${feedbackHtml}
    </div>
  `;
}

function renderSingleChoice(slide) {
  const optionsHtml = slide.options.map(opt => `
    <label class="radio-row">
      <input
        type="radio"
        name="${esc(slide.key)}"
        value="${esc(opt.value)}"
        data-single-answer="${esc(slide.key)}"
        ${state.answers[slide.key] === opt.value ? 'checked' : ''}
      />
      <span class="check-box" aria-hidden="true"></span>
      <span class="check-label">${esc(opt.label)}</span>
    </label>
  `).join('');

  return `
    <div class="slide slide--choice">
      <h2 class="slide-title">${esc(slide.title)}</h2>
      ${slide.hint ? `<p class="slide-hint">${esc(slide.hint)}</p>` : ''}
      <div class="choices">${optionsHtml}</div>
    </div>
  `;
}

function renderMultiChoice(slide) {
  const selected = Array.isArray(state.answers[slide.key])
    ? state.answers[slide.key]
    : [];

  const optionsHtml = slide.options.map(opt => `
    <label class="checkbox-row">
      <input
        type="checkbox"
        data-multi-answer="${esc(slide.key)}"
        value="${esc(opt.value)}"
        ${selected.includes(opt.value) ? 'checked' : ''}
      />
      <span class="check-box" aria-hidden="true"></span>
      <span class="check-label">${esc(opt.label)}</span>
    </label>
  `).join('');

  return `
    <div class="slide slide--choice">
      <h2 class="slide-title">${esc(slide.title)}</h2>
      ${slide.hint ? `<p class="slide-hint">${esc(slide.hint)}</p>` : ''}
      <div class="choices">${optionsHtml}</div>
    </div>
  `;
}

function renderThanks(slide) {
  return `
    <div class="slide slide--thanks">
      <h2 class="thanks-title">${esc(slide.title)}</h2>
      <p class="thanks-desc">${esc(slide.description)}</p>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 네비게이션 버튼 렌더링
// ----------------------------------------------------------------------------
function renderNav(slide) {
  const isFirst = state.current_step === 0;
  const isLast = state.current_step === TOTAL_SLIDES - 1;

  // Intro 화면은 단일 버튼
  if (slide.type === 'intro') {
    return `
      <div class="nav nav--single">
        <button type="button" id="btn-next" class="btn btn--primary">
          ${esc(slide.nextLabel || '다음')}
        </button>
      </div>
    `;
  }

  // Thanks 화면은 닫기 버튼
  if (slide.type === 'thanks') {
    return `
      <div class="nav nav--single">
        <button type="button" id="btn-close" class="btn btn--primary">
          ${esc(slide.closeLabel || '닫기')}
        </button>
      </div>
    `;
  }

  // 일반 슬라이드: 이전 + 다음
  return `
    <div class="nav nav--dual">
      <button type="button" id="btn-prev" class="btn btn--secondary" ${isFirst ? 'disabled' : ''}>
        이전
      </button>
      <button type="button" id="btn-next" class="btn btn--primary">
        ${isLast ? '제출' : '다음'}
      </button>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 전체 화면 렌더
// ----------------------------------------------------------------------------
function render() {
  const slide = SURVEY_SLIDES[state.current_step];
  $root.innerHTML = `
    ${renderSlide(slide)}
    ${renderNav(slide)}
  `;
  updateProgress();
  bindSlideEvents(slide);
  // 스크롤을 맨 위로
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ----------------------------------------------------------------------------
// 이벤트 바인딩
// ----------------------------------------------------------------------------
function bindSlideEvents(slide) {
  // 이름 입력
  const nameInput = $root.querySelector('[data-field="respondent_name"]');
  if (nameInput) {
    nameInput.addEventListener('input', (e) => {
      state.respondent_name = e.target.value;
      saveDebounced(state);
    });
  }

  // 익명 체크박스
  const anonCheck = $root.querySelector('[data-single-check="anonymous"]');
  if (anonCheck) {
    anonCheck.addEventListener('change', (e) => {
      state.anonymous = e.target.checked;
      // 익명이면 이름 입력 비활성화
      const nameIn = $root.querySelector('[data-field="respondent_name"]');
      if (nameIn) nameIn.disabled = state.anonymous;
      saveNow(state);
    });
  }

  // 일반 체크박스 (task 체크리스트)
  $root.querySelectorAll('[data-answer]:not([data-textarea])').forEach((el) => {
    if (el.type === 'checkbox') {
      el.addEventListener('change', (e) => {
        const key = e.target.dataset.answer;
        state.answers[key] = e.target.checked;
        saveNow(state);
      });
    }
  });

  // 텍스트영역 (오픈 피드백)
  $root.querySelectorAll('textarea[data-answer]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const key = e.target.dataset.answer;
      state.answers[key] = e.target.value;
      saveDebounced(state);
    });
  });

  // 단일 선택 라디오
  $root.querySelectorAll('[data-single-answer]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const key = e.target.dataset.singleAnswer;
      state.answers[key] = e.target.value;
      saveNow(state);
    });
  });

  // 다중 선택 체크박스
  $root.querySelectorAll('[data-multi-answer]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const key = e.target.dataset.multiAnswer;
      const current = Array.isArray(state.answers[key]) ? state.answers[key] : [];
      if (e.target.checked) {
        if (!current.includes(e.target.value)) current.push(e.target.value);
      } else {
        const idx = current.indexOf(e.target.value);
        if (idx > -1) current.splice(idx, 1);
      }
      state.answers[key] = current;
      saveNow(state);
    });
  });

  // 네비게이션
  const $prev = document.getElementById('btn-prev');
  const $next = document.getElementById('btn-next');
  const $close = document.getElementById('btn-close');

  if ($prev) $prev.addEventListener('click', goPrev);
  if ($next) $next.addEventListener('click', goNext);
  if ($close) $close.addEventListener('click', goClose);
}

// ----------------------------------------------------------------------------
// 네비게이션 핸들러
// ----------------------------------------------------------------------------
async function goPrev() {
  if (state.current_step <= 0) return;
  state.current_step -= 1;
  await saveNow(state);
  render();
}

async function goNext() {
  const isLast = state.current_step === TOTAL_SLIDES - 1;
  if (isLast) {
    // 제출
    state.is_completed = true;
    await saveNow(state);
    return;
  }
  // 마지막 바로 앞 슬라이드(S4-5 만족도)에서 다음 누르면 완료 플래그 세팅
  if (state.current_step === TOTAL_SLIDES - 2) {
    state.is_completed = true;
  }
  state.current_step += 1;
  await saveNow(state);
  render();
}

async function goClose() {
  state.is_completed = true;
  await saveNow(state);
  // 제출 완료 메시지
  $root.innerHTML = `
    <div class="slide slide--thanks">
      <h2 class="thanks-title">제출 완료</h2>
      <p class="thanks-desc">응답이 안전하게 저장되었습니다.<br>이 창을 닫으셔도 됩니다.</p>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// 초기화 - 기존 세션 복구
// ----------------------------------------------------------------------------
async function init() {
  // session_id 확보
  getOrCreateSessionId();

  // 기존 세션 불러오기
  const existing = await loadExistingSession();
  if (existing) {
    state.respondent_name = existing.respondent_name || '';
    state.anonymous = !!existing.anonymous;
    state.answers = existing.answers || {};
    state.current_step = existing.current_step || 0;
    state.is_completed = !!existing.is_completed;
  }

  render();
}

// URL 파라미터로 세션 리셋 (?reset=1)
if (new URLSearchParams(window.location.search).get('reset') === '1') {
  resetSession();
  window.location.replace(window.location.pathname);
} else {
  init();
}
