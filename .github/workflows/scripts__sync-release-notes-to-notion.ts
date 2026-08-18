// ============================================================
// scripts/sync-release-notes-to-notion.ts
// ------------------------------------------------------------
// releaseNotes.ts(SSOT) → Notion DB 멱등 동기화
//   1) Notion DB 스키마 조회 (존재하는 속성만 기록)
//   2) DB 전체 페이지의 ID 속성 수집
//   3) RELEASE_NOTES 중 Notion에 없는 id만 삽입
//   - 오늘(KST) 날짜 엔트리에만 커밋 링크 + CF 배포 URL 부착
//   - 몇 번을 재실행해도 중복 생성 없음
// 실행: npx tsx scripts/sync-release-notes-to-notion.ts
// ============================================================
import { RELEASE_NOTES, type ReleaseNote } from '../src/data/releaseNotes'

const NOTION_TOKEN = process.env.NOTION_TOKEN
const DB_ID = process.env.NOTION_DATABASE_ID
if (!NOTION_TOKEN || !DB_ID) {
  console.error('⛔ NOTION_TOKEN / NOTION_DATABASE_ID 누락')
  process.exit(1)
}

const SINCE_DATE = process.env.SINCE_DATE ?? ''
const COMMIT_SHA = process.env.COMMIT_SHA ?? ''
const REPO = process.env.REPO ?? ''
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ''
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
const CF_PROJECT = process.env.CF_PAGES_PROJECT ?? ''

const NOTION = 'https://api.notion.com/v1'
const HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
}

const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function notion(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${NOTION}${path}`, { headers: HEADERS, ...init })
  const json = await res.json()
  if (!res.ok) throw new Error(`Notion ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ── 1) DB 스키마 조회 ─────────────────────────────────────────
async function getSchema(): Promise<Record<string, string>> {
  const db = await notion(`/databases/${DB_ID}`)
  const schema: Record<string, string> = {}
  for (const [name, def] of Object.entries<any>(db.properties)) schema[name] = def.type
  return schema
}

// ── 1.5) 필수 속성 자동 생성 (없으면 PATCH로 추가) ────────────
const REQUIRED_PROPS: Record<string, any> = {
  '날짜': { date: {} },
  '유형': { select: { options: [{ name: 'Release', color: 'blue' }, { name: 'Hotfix', color: 'red' }] } },
  '모듈': { select: {} },
  'ID': { rich_text: {} },
  '커밋': { url: {} },
  '배포 URL': { url: {} },
}
async function ensureSchema(schema: Record<string, string>): Promise<Record<string, string>> {
  const missing = Object.entries(REQUIRED_PROPS).filter(([name]) => !(name in schema))
  if (missing.length === 0) return schema
  await notion(`/databases/${DB_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: Object.fromEntries(missing) }),
  })
  console.log(`🔧 Notion DB 속성 자동 생성: ${missing.map(([n]) => n).join(', ')}`)
  return getSchema()
}

// ── 2) 기존 ID 전수 수집 (페이지네이션) ───────────────────────
async function getExistingIds(idProp: string | null): Promise<Set<string>> {
  const ids = new Set<string>()
  let cursor: string | undefined
  do {
    const body: any = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await notion(`/databases/${DB_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    for (const page of res.results) {
      if (idProp) {
        const rt = page.properties[idProp]?.rich_text ?? []
        const v = rt.map((t: any) => t.plain_text).join('')
        if (v) ids.add(v)
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return ids
}

// ── 3) 오늘 커밋의 CF Pages 프로덕션 배포 URL (최대 4분 폴링) ──
async function findDeployUrl(): Promise<string> {
  if (!CF_TOKEN || !CF_ACCOUNT || !CF_PROJECT || !COMMIT_SHA) return ''
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/pages/projects/${CF_PROJECT}/deployments`
  for (let i = 0; i < 16; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${CF_TOKEN}` } })
      const json: any = await res.json()
      const hit = (json.result ?? []).find(
        (d: any) =>
          d.environment === 'production' &&
          d.deployment_trigger?.metadata?.commit_hash === COMMIT_SHA,
      )
      if (hit?.url) return hit.url
    } catch {
      /* 폴링 계속 */
    }
    await sleep(15_000)
  }
  console.warn('⚠️ CF 배포 매칭 실패 — 배포 URL 없이 기록 진행')
  return ''
}

// ── 4) 페이지 생성 ────────────────────────────────────────────
function buildProperties(
  note: ReleaseNote,
  schema: Record<string, string>,
  deployUrl: string,
): Record<string, any> {
  const isToday = note.date === todayKST
  const props: Record<string, any> = {}
  const has = (name: string, type: string) => schema[name] === type

  // title 속성은 이름과 무관하게 type === 'title'인 속성을 찾음
  const titleProp = Object.entries(schema).find(([, t]) => t === 'title')?.[0]
  if (titleProp) props[titleProp] = { title: [{ text: { content: note.title } }] }

  if (has('날짜', 'date')) props['날짜'] = { date: { start: note.date } }
  if (has('유형', 'select'))
    props['유형'] = { select: { name: note.type === 'hotfix' ? 'Hotfix' : 'Release' } }
  if (has('모듈', 'select')) props['모듈'] = { select: { name: note.module } }
  if (has('ID', 'rich_text')) props['ID'] = { rich_text: [{ text: { content: note.id } }] }
  if (isToday && COMMIT_SHA && REPO && has('커밋', 'url'))
    props['커밋'] = { url: `https://github.com/${REPO}/commit/${COMMIT_SHA}` }
  if (isToday && deployUrl && has('배포 URL', 'url')) props['배포 URL'] = { url: deployUrl }

  return props
}

function buildChildren(note: ReleaseNote): any[] {
  const children: any[] = []
  if (note.dateLabel)
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: `기간: ${note.dateLabel}` } }] },
    })
  for (const item of note.items)
    children.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ text: { content: item } }] },
    })
  return children
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  const schema = await ensureSchema(await getSchema())

  const existing = await getExistingIds('ID')
  const targets = RELEASE_NOTES.filter(
    (n) => !existing.has(n.id) && (!SINCE_DATE || n.date >= SINCE_DATE),
  ).reverse() // 오래된 것부터 삽입 → Notion 생성순 정렬 자연스러움

  if (targets.length === 0) {
    console.log('✅ 신규 엔트리 없음 — 동기화 완료 상태')
    return
  }

  const hasTodayEntry = targets.some((n) => n.date === todayKST)
  const deployUrl = hasTodayEntry ? await findDeployUrl() : ''

  for (const note of targets) {
    await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties: buildProperties(note, schema, deployUrl),
        children: buildChildren(note),
      }),
    })
    console.log(`📝 기록: [${note.date}] ${note.title}`)
    await sleep(350) // Notion rate limit(3req/s) 준수
  }
  console.log(`✅ ${targets.length}건 Notion 기록 완료`)
}

main().catch((e) => {
  console.error('⛔ 동기화 실패:', e.message)
  process.exit(1)
})
