// ============================================================================
// Supabase 연동 - 실시간 응답 저장
// ----------------------------------------------------------------------------
// 설계 원칙:
// 1. session_id는 localStorage에 저장 → 탭/브라우저 재진입 시 이어서 응답
// 2. 응답 변경 시 500ms 디바운스 후 upsert → 네트워크 과부하 방지
// 3. 네트워크 실패 시에도 localStorage에 백업 → 데이터 유실 방지 (근본 해결)
// ============================================================================

const SUPABASE_URL = 'https://jjzcqpbwkkujttwxksvy.supabase.co';
// ANON_KEY는 환경변수에서 주입 (빌드 시 Vite가 치환)
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const LS_SESSION_KEY = 'cnr_pilot_session_id';
const LS_BACKUP_KEY = 'cnr_pilot_backup';

// ----------------------------------------------------------------------------
// 세션 ID 관리
// ----------------------------------------------------------------------------
export function getOrCreateSessionId() {
  let sid = localStorage.getItem(LS_SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(LS_SESSION_KEY, sid);
  }
  return sid;
}

export function resetSession() {
  localStorage.removeItem(LS_SESSION_KEY);
  localStorage.removeItem(LS_BACKUP_KEY);
}

// ----------------------------------------------------------------------------
// localStorage 백업 (네트워크 실패 대비)
// ----------------------------------------------------------------------------
export function saveBackup(state) {
  try {
    localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('localStorage 백업 실패', e);
  }
}

export function loadBackup() {
  try {
    const raw = localStorage.getItem(LS_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Supabase REST API 직접 호출 (경량화, 라이브러리 의존성 제거)
// ----------------------------------------------------------------------------
async function supabaseRequest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase ${res.status}: ${errText}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ----------------------------------------------------------------------------
// 응답 저장 (upsert, 디바운스)
// ----------------------------------------------------------------------------
let saveTimer = null;
let saveInProgress = false;
let pendingSave = null; // 저장 중에 추가로 들어온 최신 상태

// 상태 리스너 (UI에서 "저장 중..." 표시용)
const statusListeners = new Set();
export function onSaveStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
function notifyStatus(status) {
  // status: 'idle' | 'saving' | 'saved' | 'error'
  statusListeners.forEach((fn) => fn(status));
}

async function doSave(state) {
  saveInProgress = true;
  notifyStatus('saving');

  // 즉시 localStorage 백업 (근본 해결: 네트워크 실패해도 데이터 보존)
  saveBackup(state);

  const sessionId = getOrCreateSessionId();
  const payload = {
    session_id: sessionId,
    respondent_name: state.anonymous ? null : (state.respondent_name || null),
    anonymous: !!state.anonymous,
    answers: state.answers || {},
    current_step: state.current_step || 0,
    is_completed: !!state.is_completed,
    user_agent: navigator.userAgent.substring(0, 500),
  };

  try {
    // upsert: session_id가 있으면 update, 없으면 insert
    await supabaseRequest(
      'POST',
      'survey_responses',
      payload,
      { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    );
    notifyStatus('saved');
  } catch (err) {
    console.error('서버 저장 실패 (localStorage 백업은 유지됨)', err);
    notifyStatus('error');
  } finally {
    saveInProgress = false;
    // 저장 중에 들어온 최신 상태가 있으면 재시도
    if (pendingSave) {
      const next = pendingSave;
      pendingSave = null;
      doSave(next);
    }
  }
}

/**
 * 응답 저장 (디바운스 500ms)
 * - 타이핑 중엔 저장하지 않고, 멈춘 뒤 500ms 후 저장
 * - 라디오/체크박스는 즉시 저장되길 바라면 saveNow 사용
 */
export function saveDebounced(state, delay = 500) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (saveInProgress) {
      pendingSave = state; // 저장 중이면 대기열에 넣음
    } else {
      doSave(state);
    }
  }, delay);
}

/**
 * 즉시 저장 (디바운스 우회)
 * - 다음 슬라이드로 넘어갈 때, 완료 버튼 누를 때 사용
 */
export function saveNow(state) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveInProgress) {
    pendingSave = state;
    return Promise.resolve();
  }
  return doSave(state);
}

// ----------------------------------------------------------------------------
// 기존 세션 복구 (이어서 응답)
// ----------------------------------------------------------------------------
export async function loadExistingSession() {
  const sessionId = localStorage.getItem(LS_SESSION_KEY);
  if (!sessionId) return null;

  try {
    const rows = await supabaseRequest(
      'GET',
      `survey_responses?session_id=eq.${sessionId}&select=*`
    );
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn('세션 복구 실패, localStorage 백업 사용', err);
  }

  // 서버 복구 실패 시 localStorage 백업에서 복구
  return loadBackup();
}
