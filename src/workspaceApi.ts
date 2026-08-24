// ---------- types ----------
export type Novel = {
  id: string
  title: string
  description: string
  author: string
  genre: string
  target_words: number
  status: 'planning' | 'writing' | 'completed'
  /** F11 文风画像（服务端统计，客户端只读）。 */
  style_profile: Record<string, number> | null
  /** 封面图文件名（空 = 未设置）；图片本体经 getNovelCover 取 blob。 */
  cover_image: string
  total_words: number
  chapter_count: number
  created_at: string
  updated_at: string
}

export type Chapter = {
  id: string
  novel_id: string
  title: string
  content: string
  order: number
  word_count: number
  status: 'draft' | 'writing' | 'completed'
  /** F1 章节摘要链：剧情摘要（手写或 AI 生成后落库）。 */
  summary: string
  summary_updated_at: string | null
  created_at: string
  updated_at: string
}

/** Chapter metadata without the (potentially large) body. The workspace payload
 * returns summaries; full content is loaded on demand via getChapter(). */
export type ChapterSummary = Omit<Chapter, 'content' | 'summary' | 'summary_updated_at'>

export type ChapterVersion = {
  id: string
  chapter_id: string
  content: string
  word_count: number
  version_number: number
  label: string
  created_at: string
}

export type Character = {
  id: string
  novel_id: string
  name: string
  aliases: string
  role: string
  color: string
  description: string
  personality: string
  background: string
  appearance: string
  abilities: string
  relationships: Record<string, unknown>
  first_appearance_chapter_id: string | null
  created_at: string
  updated_at: string
}

/** F2 角色登场追踪：每角色的登场统计。gap = 距最新章的空窗章数。 */
export type CharacterPresence = {
  character_id: string
  name: string
  role: string
  first_chapter: number | null
  last_chapter: number | null
  gap: number | null
  chapter_count: number
  hits: number
}

/** F3 发布前自检：本地检查结果（敏感词来自用户手动维护的词库）。 */
export type LintIssue = {
  type: 'sensitive' | 'duplicate' | 'punct'
  word: string
  offset: number
  message: string
}

/** F5 灵感收集箱：碎片想法，可转化为角色/伏笔/章节。novel_id 空 = 全局。 */
export type Idea = {
  id: number
  novel_id: string | null
  content: string
  status: 'inbox' | 'converted' | 'discarded'
  converted_kind: 'character' | 'thread' | 'chapter' | ''
  converted_id: string
  created_at: string
  updated_at: string
}

/** F6 自定义 Prompt 模板：常用 AI 写作指令预设，点击填入写作要求。 */
export type PromptTemplate = {
  id: number
  name: string
  content: string
  created_at: string
  updated_at: string
}

/** F8 时间线/大事记：按章节锚点排序的故事事件；chapter_id 空 = 计划中。 */
export type TimelineEvent = {
  id: string
  novel_id: string
  title: string
  description: string
  story_time: string
  chapter_id: string | null
  order_hint: number
  created_at: string
  updated_at: string
}

export type Location = {
  id: string
  novel_id: string
  name: string
  description: string
  type: string
  parent_location_id: string | null
  map_id: string | null
  first_appearance_chapter_id: string | null
  created_at: string
  updated_at: string
}

/** One free-hand stroke on a map canvas; points are 0-100 percentages. */
export type Doodle = {
  color: string
  width: number
  eraser?: boolean
  /** 'path' = free-hand line (points are [x,y] pairs along the stroke);
   *  'rect' = grid-fill brush (points are [x1,y1,x2,y2] rectangle corners). */
  shape?: 'path' | 'rect'
  /** path: [[x,y],...]; rect: [[x1,y1,x2,y2],...] — kept as number[][] so both fit. */
  points: number[][]
}

/** A map canvas inside a novel — different maps are different realms/areas
 *  (凡界 / 灵界 after an ascension), each with its own doodles + terrains. */
export type StoryMap = {
  id: string
  novel_id: string
  name: string
  description: string
  doodles: Doodle[]
  /** Filename of an optional uploaded background image (empty = default). */
  background_image: string
  created_at: string
  updated_at: string
}

/** A named doodle color acting as terrain (绿色=草地, 紫色=沼泽, ...). */
export type Terrain = {
  id: string
  map_id: string
  name: string
  color: string
  created_at: string
}

/** A persisted doodle stroke (one row per stroke, stored incrementally). */
export type Stroke = {
  id: string
  map_id: string
  color: string
  width: number
  eraser: boolean
  shape: 'path' | 'rect'
  points: number[][]
  seq: number
  created_at: string
}

export type WorldSetting = {
  id: string
  novel_id: string
  name: string
  category: string
  description: string
  related_settings: Record<string, unknown>
  chapter_references: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ThreadStatus = 'planted' | 'hinted' | 'developing' | 'resolved'
export type ThreadPriority = 'major' | 'minor' | 'detail'

export type PlotThread = {
  id: string
  novel_id: string
  title: string
  description: string
  status: ThreadStatus
  priority: ThreadPriority
  planted_chapter_id: string | null
  resolved_chapter_id: string | null
  related_characters: string[]
  related_locations: string[]
  related_threads: string[]
  notes: string
  created_at: string
  updated_at: string
}

/** A beat/scene node under a chapter — second level of the outline mind map. */
export type SceneSummary = {
  id: string
  chapter_id: string
  title: string
  order: number
  created_at: string
  updated_at: string
}

/** A manual connector between two mind-map nodes (one of chapters/threads/
 *  characters), with an optional small text label. Auto-edges (a thread's
 *  related_threads, shared-伏笔 between characters) are never stored. */
export type GraphEdge = {
  id: string
  novel_id: string
  kind: 'chapters' | 'threads' | 'characters'
  from_id: string
  to_id: string
  label: string
  created_at: string
}

export type AIConfig = {  id: number
  provider: string
  name: string
  model: string
  base_url: string
  // The API key itself is never returned. has_key tells the UI a key is on file;
  // key_hint is a masked hint like "••••••••5678" for display.
  has_key: boolean
  key_hint: string
  temperature: number
  max_tokens: number
  // Model context window (tokens) fetched from the provider's /models metadata.
  context_length?: number | null
  is_active: boolean
  created_at: string
}

/** 资料库文档（RAG 素材） */
export type LibraryDoc = {
  id: number
  novel_id: string | null
  name: string
  category: string
  source: string
  size_chars: number
  chunks: number
  created_at: string
}

/** Sidebar/statusbar badge counts — the slim workspace (#2 懒加载) no longer
 * carries entity rows; entity pages fetch their own lists on demand. */
export type WorkspaceCounts = {
  scenes: number
  characters: number
  locations: number
  world_settings: number
  plot_threads: number
  unresolved_threads: number
  unresolved_major: number
  graph_edges: number
}

export type Workspace = {
  novel: Novel
  chapters: ChapterSummary[]
  counts: WorkspaceCounts
}

export type StorageInfo = {
  data_dir: string
  default_dir: string
  db_path: string
  db_file: string
  db_size_kb: number
  exists: boolean
  is_default: boolean
}

export type AIContextOptions = {
  characters: boolean
  locations: boolean
  settings: boolean
  threads: boolean
  recent_chapters: number
  /** RAG 检索增强（后端未启用 embedding 时静默跳过） */
  prior_chapters?: boolean
  library?: boolean
  /** F1 前情提要：更早章节摘要串注入 */
  recap?: boolean
  /** F8 时间线：当前章前后挂载的大事记事件注入（默认关闭） */
  timeline?: boolean
}

export type AIGenerateRequest = {
  novel_id: string
  chapter_id?: string | null
  instruction?: string
  mode?: 'continue' | 'polish' | 'expand' | 'worldsetting' | 'setting_expand' | 'summarize' | 'dialogue'
  target_words?: number
  // Pick a specific AI config (model); omit to use the active one.
  config_id?: number | null
  context?: Partial<AIContextOptions>
  /** F10 对话生成专用字段（/ai/dialogue） */
  character_ids?: string[]
  scene?: string
}

declare global {
  interface Window {
    mojingDesktop?: {
      platform: string
      getBackendUrl: () => string
      getAuthToken: () => string
      chooseDataDir?: (defaultPath?: string) => Promise<string | null>
      // Frameless-window controls (titlebar buttons).
      windowMinimize?: () => void
      windowToggleMaximize?: () => void
      windowClose?: () => void
      windowIsMaximized?: () => Promise<boolean>
      /** Maximize-state push events from the main process (titlebar glyph). */
      onMaximizeChanged?: (cb: (maximized: boolean) => void) => (() => void) | undefined
      // Auto-update (#10): status events from the main process; install = restart.
      onUpdateStatus?: (cb: (status: { state: string; version: string }) => void) => (() => void) | undefined
      installUpdate?: () => Promise<void>
    }
  }
}

const API_BASE = window.mojingDesktop?.getBackendUrl() ??
  import.meta.env.VITE_API_URL ??
  'http://127.0.0.1:8765/api'

// Bearer token injected by the desktop shell. Empty in browser-dev (the backend
// relaxes the token check for trusted dev origins).
const AUTH_TOKEN = window.mojingDesktop?.getAuthToken?.() ?? ''

function authHeaders(): Record<string, string> {
  return AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}
}

/** request() 的默认超时。AI 流式走 runAIStream（不设超时，靠 AbortController）；
 * 上传/下载等大包路径各自显式传 timeoutMs: 0 关闭。 */
const DEFAULT_TIMEOUT_MS = 30_000

type RequestOptions = RequestInit & { timeoutMs?: number }

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {}
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      signal: fetchInit.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined),
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...fetchInit.headers },
    })
  } catch (e) {
    // 没有超时的请求会无限挂起（后端卡死时 UI 永远转圈）——统一转成可读错误。
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new Error('请求超时，请重试', { cause: e })
    throw e
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? `请求失败（${response.status}）`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

// ---------- SSE streaming for AI ----------
/** Callback-style AI stream: `onChunk` receives each text delta as it arrives.
 * Resolves when the stream completes; throws with the backend's real error
 * message (429 / 401 / timeout…) when the stream fails.
 *
 * Replaces the old async-generator streamAI(): consuming a fetch
 * ReadableStream through `for await` stalled in the packaged Chromium (the
 * generator never resumed after its first yield), so streaming silently hung.
 * The plain async/await loop below reads the same stream reliably. */
export async function runAIStream(
  path: string,
  body: AIGenerateRequest,
  opts: { signal?: AbortSignal; onChunk: (text: string, model: string) => void },
): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? `AI 请求失败（${response.status}）`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trimStart()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      // JSON.parse isolated in its own try — a partial chunk is skipped, while
      // backend `{"error"}` events are surfaced as real throws (no sniffing
      // the engine's parse-error message text).
      let parsed: { error?: unknown; text?: string; model?: string }
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      if (parsed.error) {
        throw new Error(typeof parsed.error === 'string' ? parsed.error : 'AI 生成失败')
      }
      if (parsed.text) opts.onChunk(parsed.text, parsed.model ?? '')
    }
  }
}

const api = {
  // storage / data location
  getStorage: () => request<StorageInfo>('/storage'),
  setStoragePath: (dataDir: string) =>
    request<StorageInfo>('/storage/path', { method: 'POST', body: JSON.stringify({ data_dir: dataDir }) }),
  resetStorage: () => request<StorageInfo>('/storage/reset', { method: 'POST' }),
  // cross-device export/import — a zip of the whole data dir (#8). Blob/raw
  // paths (not request<T>) because the payload isn't JSON.
  exportData: async (): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/storage/export`, { headers: authHeaders() })
    if (!res.ok) throw new Error('导出失败')
    return res.blob()
  },
  importData: async (file: Blob): Promise<StorageInfo> => {
    const res = await fetch(`${API_BASE}/storage/import`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/zip' },
      body: file,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.detail ?? `导入失败（${res.status}）`)
    }
    return res.json()
  },

  // workspace / novels
  load: () => request<Workspace>('/workspace'),
  getNovel: (id: string) => request<Workspace>(`/novels/${id}`),
  listNovels: () => request<Novel[]>('/novels'),  createNovel: (data: Partial<Novel>) =>
    request<Novel>('/novels', { method: 'POST', body: JSON.stringify(data) }),
  updateNovel: (id: string, data: Partial<Novel>) =>
    request<Novel>(`/novels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNovel: (id: string) => request<void>(`/novels/${id}`, { method: 'DELETE' }),
  // cover image — raw blob paths (not request<T>) since payloads aren't JSON.
  // GET needs auth, so callers fetch the blob and turn it into an object URL.
  uploadNovelCover: async (novelId: string, file: Blob, contentType: string): Promise<Novel> => {
    const res = await fetch(`${API_BASE}/novels/${novelId}/cover`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body: file,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.detail ?? `封面上传失败（${res.status}）`)
    }
    return res.json()
  },
  getNovelCover: async (novelId: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/novels/${novelId}/cover`, { headers: authHeaders() })
    if (!res.ok) throw new Error('No cover')
    return res.blob()
  },
  deleteNovelCover: (novelId: string) =>
    request<Novel>(`/novels/${novelId}/cover`, { method: 'DELETE' }),

  // chapters（#2 懒加载：独立的章节元数据列表端点）
  listChapters: (novelId: string) => request<ChapterSummary[]>(`/novels/${novelId}/chapters`),
  createChapter: (novelId: string, title: string, content = '') =>
    request<Chapter>(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title, content }) }),
  getChapter: (id: string) => request<Chapter>(`/chapters/${id}`),
  // init 透传（如 keepalive）供写作页的 beforeunload 兜底保存使用。
  updateChapter: (id: string, changes: Partial<Pick<Chapter, 'title' | 'content' | 'status' | 'summary'>>, init?: RequestInit) =>
    request<Chapter>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(changes), ...init }),
  deleteChapter: (id: string) => request<void>(`/chapters/${id}`, { method: 'DELETE' }),
  listVersions: (chapterId: string) =>
    request<ChapterVersion[]>(`/chapters/${chapterId}/versions`),
  rollback: (chapterId: string, versionId: string) =>
    request<Chapter>(`/chapters/${chapterId}/rollback/${versionId}`, { method: 'POST' }),
  /** F1 滚动前情提要：beforeChapterId 之前的"摘要串 + 最近章结尾"。 */
  getRecap: (novelId: string, beforeChapterId?: string | null) =>
    request<{ recap: string; chapters: number; missing_summaries: number }>(
      `/novels/${novelId}/recap${beforeChapterId ? `?before_chapter_id=${beforeChapterId}` : ''}`,
    ),
  // F3 发布前自检：本地 lint + 用户手动维护的敏感词库
  lintChapter: (novelId: string, chapterId: string) =>
    request<{ chapter_id: string; issues: LintIssue[]; word_count: number; counts: { sensitive: number; duplicate: number; punct: number } }>(
      `/novels/${novelId}/chapters/${chapterId}/lint`, { method: 'POST' },
    ),
  getSensitiveWords: () =>
    request<{ words: string[]; count: number }>('/wordlists/sensitive'),
  saveSensitiveWords: (words: string[]) =>
    request<{ words: string[]; count: number }>('/wordlists/sensitive', {
      method: 'PUT', body: JSON.stringify({ words }),
    }),
  importSensitiveWords: (content: string) =>
    request<{ count: number; added: number }>('/wordlists/sensitive/import', {
      method: 'POST', body: JSON.stringify({ content }),
    }),
  // F5 灵感收集箱
  listIdeas: (novelId?: string | null) =>
    request<Idea[]>(`/ideas${novelId ? `?novel_id=${novelId}` : ''}`),
  createIdea: (content: string, novelId?: string | null) =>
    request<Idea>('/ideas', { method: 'POST', body: JSON.stringify({ content, novel_id: novelId ?? null }) }),
  updateIdea: (id: number, data: { content?: string; status?: 'inbox' | 'discarded' }) =>
    request<Idea>(`/ideas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIdea: (id: number) => request<void>(`/ideas/${id}`, { method: 'DELETE' }),
  convertIdea: (id: number, kind: 'character' | 'thread' | 'chapter', novelId: string, title?: string) =>
    request<Idea>(`/ideas/${id}/convert`, {
      method: 'POST', body: JSON.stringify({ kind, novel_id: novelId, title: title ?? null }),
    }),
  // F6 自定义 Prompt 模板
  listPromptTemplates: () => request<PromptTemplate[]>('/prompt-templates'),
  createPromptTemplate: (name: string, content: string) =>
    request<PromptTemplate>('/prompt-templates', { method: 'POST', body: JSON.stringify({ name, content }) }),
  updatePromptTemplate: (id: number, data: { name?: string; content?: string }) =>
    request<PromptTemplate>(`/prompt-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePromptTemplate: (id: number) => request<void>(`/prompt-templates/${id}`, { method: 'DELETE' }),
  // F8 时间线/大事记
  listTimelineEvents: (novelId: string) =>
    request<TimelineEvent[]>(`/novels/${novelId}/timeline-events`),
  createTimelineEvent: (novelId: string, data: { title: string; description?: string; story_time?: string; chapter_id?: string | null }) =>
    request<TimelineEvent>(`/novels/${novelId}/timeline-events`, { method: 'POST', body: JSON.stringify(data) }),
  updateTimelineEvent: (id: string, data: { title?: string; description?: string; story_time?: string; chapter_id?: string | null }) =>
    request<TimelineEvent>(`/timeline-events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTimelineEvent: (id: string) => request<void>(`/timeline-events/${id}`, { method: 'DELETE' }),
  // F9 命名生成器（本地词库，零 AI）
  generateNames: (kind: string, count = 10) =>
    request<{ kind: string; label: string; names: string[] }>(
      `/tools/names?kind=${encodeURIComponent(kind)}&count=${count}`,
    ),
  // F11 文风画像：统计最近 N 章并写回 novel.style_profile
  buildStyleProfile: (novelId: string, scope = 20) =>
    request<Record<string, number>>(`/novels/${novelId}/style-profile?scope=${scope}`, { method: 'POST' }),
  // F12 WebDAV 备份
  getWebdavConfig: () =>
    request<{ configured: boolean; url: string; username: string; has_password: boolean; keep: number }>('/webdav/config'),
  saveWebdavConfig: (data: { url?: string; username?: string; password?: string | null; keep?: number }) =>
    request<{ configured: boolean; url: string; username: string; has_password: boolean; keep: number }>('/webdav/config', {
      method: 'PUT', body: JSON.stringify(data),
    }),
  testWebdavConfig: () =>
    request<{ ok: boolean; detail: string }>('/webdav/config/test', { method: 'POST', timeoutMs: 60_000 }),
  uploadWebdavBackup: () =>
    request<{ ok: boolean; detail: string; name: string; size_kb: number }>('/webdav/backup/upload', {
      method: 'POST', timeoutMs: 300_000,
    }),

  // scenes (outline mind-map leaf nodes；#2 懒加载独立列表端点)
  listScenes: (novelId: string) => request<SceneSummary[]>(`/novels/${novelId}/scenes`),
  createScene: (novelId: string, chapterId: string, title: string) =>
    request<SceneSummary>(`/novels/${novelId}/chapters/${chapterId}/scenes`, { method: 'POST', body: JSON.stringify({ title }) }),
  renameScene: (id: string, title: string) =>
    request<SceneSummary>(`/scenes/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteScene: (id: string) => request<void>(`/scenes/${id}`, { method: 'DELETE' }),

  // graph edges (manual mind-map connectors；#2 懒加载独立列表端点)
  listGraphEdges: (novelId: string) => request<GraphEdge[]>(`/novels/${novelId}/graph-edges`),
  createGraphEdge: (novelId: string, kind: GraphEdge['kind'], fromId: string, toId: string, label = '') =>
    request<GraphEdge>(`/novels/${novelId}/graph-edges`, { method: 'POST', body: JSON.stringify({ kind, from_id: fromId, to_id: toId, label }) }),
  setGraphEdgeLabel: (id: string, label: string) =>
    request<GraphEdge>(`/graph-edges/${id}`, { method: 'PUT', body: JSON.stringify({ label }) }),
  deleteGraphEdge: (id: string) => request<void>(`/graph-edges/${id}`, { method: 'DELETE' }),

  // backups (#2): on-demand snapshot + recent backup list
  createBackup: () => request<{ name: string; path: string; size_kb: number }>(`/backup`, { method: 'POST' }),
  listBackups: () => request<{ backups: { name: string; size_kb: number; modified: string }[]; daily_due: boolean }>(`/backups`),

  // characters
  listCharacters: (novelId: string) => request<Character[]>(`/novels/${novelId}/characters`),
  createCharacter: (novelId: string, data: Partial<Character>) =>
    request<Character>(`/novels/${novelId}/characters`, { method: 'POST', body: JSON.stringify(data) }),
  updateCharacter: (id: string, data: Partial<Character>) =>
    request<Character>(`/characters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCharacter: (id: string) => request<void>(`/characters/${id}`, { method: 'DELETE' }),
  // F2 角色登场追踪
  characterPresence: (novelId: string) =>
    request<{ latest_chapter: number; characters: CharacterPresence[] }>(
      `/novels/${novelId}/characters/presence`,
    ),
  rescanPresence: (novelId: string) =>
    request<{ novel_id: string; appearances: number }>(
      `/novels/${novelId}/characters/rescan`, { method: 'POST', timeoutMs: 120_000 },
    ),

  // locations
  listLocations: (novelId: string) => request<Location[]>(`/novels/${novelId}/locations`),
  createLocation: (novelId: string, data: Partial<Location>) =>
    request<Location>(`/novels/${novelId}/locations`, { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: Partial<Location>) =>
    request<Location>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) => request<void>(`/locations/${id}`, { method: 'DELETE' }),

  // story maps (realms) + terrains (named doodle colors)
  listMaps: (novelId: string) => request<StoryMap[]>(`/novels/${novelId}/maps`),
  createMap: (novelId: string, data: Partial<StoryMap>) =>
    request<StoryMap>(`/novels/${novelId}/maps`, { method: 'POST', body: JSON.stringify(data) }),
  updateMap: (id: string, data: Partial<StoryMap>) =>
    request<StoryMap>(`/maps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMap: (id: string) => request<void>(`/maps/${id}`, { method: 'DELETE' }),
  // background image — raw blob paths (not request<T>) since payloads aren't JSON.
  // GET needs auth, so callers fetch the blob and turn it into an object URL.
  uploadMapBackground: async (mapId: string, file: Blob, contentType: string): Promise<StoryMap> => {
    const res = await fetch(`${API_BASE}/maps/${mapId}/background`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body: file,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.detail ?? `上传失败（${res.status}）`)
    }
    return res.json()
  },
  getMapBackground: async (mapId: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/maps/${mapId}/background`, { headers: authHeaders() })
    if (!res.ok) throw new Error('No background')
    return res.blob()
  },
  deleteMapBackground: (mapId: string) =>
    request<StoryMap>(`/maps/${mapId}/background`, { method: 'DELETE' }),
  listTerrains: (mapId: string) => request<Terrain[]>(`/maps/${mapId}/terrains`),
  createTerrain: (mapId: string, data: Partial<Terrain>) =>
    request<Terrain>(`/maps/${mapId}/terrains`, { method: 'POST', body: JSON.stringify(data) }),
  updateTerrain: (id: string, data: Partial<Terrain>) =>
    request<Terrain>(`/terrains/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTerrain: (id: string) => request<void>(`/terrains/${id}`, { method: 'DELETE' }),
  // map strokes — incremental doodle persistence (one row per stroke)
  listStrokes: (mapId: string) => request<Stroke[]>(`/maps/${mapId}/strokes`),
  createStroke: (mapId: string, data: Omit<Stroke, 'id' | 'map_id' | 'seq' | 'created_at'>) =>
    request<Stroke>(`/maps/${mapId}/strokes`, { method: 'POST', body: JSON.stringify(data) }),
  undoLastStroke: (mapId: string) => request<void>(`/maps/${mapId}/strokes/last`, { method: 'DELETE' }),
  clearStrokes: (mapId: string) => request<void>(`/maps/${mapId}/strokes`, { method: 'DELETE' }),
  deleteStrokesByColor: (mapId: string, color: string) =>
    request<{ deleted: number }>(`/maps/${mapId}/strokes/by-color?color=${encodeURIComponent(color)}`, { method: 'DELETE' }),

  // world settings
  listSettings: (novelId: string) => request<WorldSetting[]>(`/novels/${novelId}/settings`),
  createSetting: (novelId: string, data: Partial<WorldSetting>) =>
    request<WorldSetting>(`/novels/${novelId}/settings`, { method: 'POST', body: JSON.stringify(data) }),
  updateSetting: (id: string, data: Partial<WorldSetting>) =>
    request<WorldSetting>(`/settings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSetting: (id: string) => request<void>(`/settings/${id}`, { method: 'DELETE' }),

  // plot threads
  listThreads: (novelId: string, status?: string) => {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<PlotThread[]>(`/novels/${novelId}/plot-threads${query}`)
  },
  listUnresolvedThreads: (novelId: string) =>
    request<PlotThread[]>(`/novels/${novelId}/plot-threads/unresolved`),
  threadWeb: (novelId: string) =>
    request<{ nodes: { id: string; title: string; status: string; priority: string }[]; edges: { from: string; to: string }[] }>(
      `/novels/${novelId}/plot-thread-web`,
    ),
  createThread: (novelId: string, data: Partial<PlotThread>) =>
    request<PlotThread>(`/novels/${novelId}/plot-threads`, { method: 'POST', body: JSON.stringify(data) }),
  updateThread: (id: string, data: Partial<PlotThread>) =>
    request<PlotThread>(`/plot-threads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resolveThread: (id: string, resolvedChapterId?: string | null) =>
    request<PlotThread>(`/plot-threads/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({ resolved_chapter_id: resolvedChapterId ?? null }),
    }),
  deleteThread: (id: string) => request<void>(`/plot-threads/${id}`, { method: 'DELETE' }),

  // AI configs. The key is write-only: create/update send it, responses never
  // contain it. updateAIConfig with api_key omitted keeps the stored key; sending
  // '' clears it.
  listAIConfigs: () => request<AIConfig[]>('/ai/configs'),
  createAIConfig: (data: Partial<AIConfig> & { api_key?: string }) =>
    request<AIConfig>('/ai/configs', { method: 'POST', body: JSON.stringify(data) }),
  updateAIConfig: (id: number, data: Partial<AIConfig> & { api_key?: string | null }) =>
    request<AIConfig>(`/ai/configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAIConfig: (id: number) => request<void>(`/ai/configs/${id}`, { method: 'DELETE' }),
  // Server-side connectivity check so the key stays off the client. Pass
  // api_key/model/base_url to test a not-yet-saved config; omit to test stored.
  testAIConfig: (id: number, data?: { model?: string; base_url?: string; api_key?: string }) =>
    request<{ ok: boolean; detail: string; model?: string }>(`/ai/configs/${id}/test`, {
      method: 'POST',
      timeoutMs: 90_000,
      body: JSON.stringify(data ?? {}),
    }),
  /** Fetch the provider's model list (with context windows) via the backend. */
  listAIModels: (data: { base_url?: string; api_key?: string; config_id?: number }) =>
    request<{ ok: boolean; detail: string; models?: { id: string; context_length: number | null }[] }>(`/ai/models`, {
      method: 'POST',
      timeoutMs: 90_000,
      body: JSON.stringify(data),
    }),
  /** Export the active config (key decrypted server-side) into the .env file. */
  exportAIEnv: () =>
    request<{ ok: boolean; detail: string; path?: string }>(`/ai/export-env`, { method: 'POST' }),
  // ── RAG / 资料库（RAG设计方案.md）──
  ragStatus: () => request<{
    enabled: boolean; embed_model: string;
    chunks: { total: number; chapter: number; library: number; pending: number };
    stale_model_chunks: number;
  }>('/rag/status'),
  // 重建 = 全量重切 + 批量 embedding，大库耗时以分钟计。
  ragRebuild: () => request<{ chunks: number; pending: number }>('/rag/rebuild', { method: 'POST', timeoutMs: 600_000 }),
  ragTestSearch: (query: string, novelId?: string | null, sourceTypes?: string[]) =>
    request<{
      enabled: boolean; embed_model?: string; detail?: string;
      results: { title: string; source_type: string; text: string; score: number }[];
    }>('/rag/test-search', {
      method: 'POST',
      timeoutMs: 90_000,
      body: JSON.stringify({ query, novel_id: novelId ?? null, source_types: sourceTypes ?? ['chapter', 'library'] }),
    }),
  listLibraryDocs: () => request<LibraryDoc[]>('/library/docs'),
  /** RAG 独立配置（与写作模型解耦）读写与连通测试。 */
  getRagConfig: () => request<{ configured: boolean; model: string; base_url: string; has_key: boolean; key_hint: string }>('/rag/config'),
  saveRagConfig: (data: { model?: string; base_url?: string; api_key?: string | null }) =>
    request<{ configured: boolean; model: string; base_url: string; has_key: boolean; key_hint: string }>('/rag/config', {
      method: 'PUT', body: JSON.stringify(data),
    }),
  testRagConfig: (data?: { model?: string; base_url?: string; api_key?: string }) =>
    request<{ ok: boolean; detail: string; dim?: number }>('/rag/config/test', {
      method: 'POST', timeoutMs: 90_000, body: JSON.stringify(data ?? {}),
    }),
  importLibraryDoc: (data: { name: string; content: string; category?: string; novel_id?: string | null }) =>
    request<LibraryDoc>('/library/docs', { method: 'POST', timeoutMs: 600_000, body: JSON.stringify(data) }),
  deleteLibraryDoc: (id: number) => request<void>(`/library/docs/${id}`, { method: 'DELETE' }),
  aiModels: () =>
    request<{ active: AIConfig | null; configs: AIConfig[]; provider: string; offline_fallback: boolean }>('/ai/models'),
  /** 3 AI-suggested continuation directions for the current chapter (+fallback). */
  aiDirections: (novelId: string, chapterId?: string | null) =>
    request<{ directions: { title: string; desc: string }[]; source: 'ai' | 'fallback' }>(
      '/ai/directions',
      { method: 'POST', timeoutMs: 120_000, body: JSON.stringify({ novel_id: novelId, chapter_id: chapterId ?? null }) },
    ),
  suggestThreads: (novelId: string) =>
    request<{ suggestions: { thread_id: string; title: string; priority: string; advice: string }[]; unresolved_count: number }>(
      '/ai/suggest-threads',
      { method: 'POST', timeoutMs: 120_000, body: JSON.stringify({ novel_id: novelId }) },
    ),
  checkConsistency: (novelId: string) =>
    request<{ findings: { level: string; message: string }[]; unresolved: number; chapters: number }>(
      '/ai/check-consistency',
      { method: 'POST', timeoutMs: 120_000, body: JSON.stringify({ novel_id: novelId }) },
    ),

  // search + export
  search: (novelId: string, q: string) =>
    request<{ semantic: boolean; chapters: { id: string; title: string; order: number; word_count: number; snippet: string; score: number; semantic: boolean }[]; characters: { id: string; name: string; role: string }[]; threads: { id: string; title: string; status: string }[]; total: number }>(
      `/novels/${novelId}/search?q=${encodeURIComponent(q)}`,
      { timeoutMs: 90_000 },
    ),
  /** Daily writing activity for the heatmap / week bars on the overview page. */
  activity: (novelId: string, days = 119) =>
    request<{
      novel_id: string
      days: number
      series: { date: string; words: number }[]
      total_words_written: number
      active_days: number
      longest_streak: number
    }>(`/novels/${novelId}/activity?days=${days}`),
  /** Token usage stats for the overview usage panel (daily + per-model). */
  aiUsage: (novelId: string, days = 30) =>
    request<{
      novel_id: string
      days: number
      series: { date: string; prompt: number; completion: number; total: number; calls: number }[]
      total_tokens: number
      total_calls: number
      by_model: { model: string; total_tokens: number; calls: number; prompt: number; completion: number }[]
    }>(`/novels/${novelId}/ai/usage?days=${days}`),
  exportNovel: async (novelId: string, format: 'txt' | 'markdown' | 'docx' | 'epub', chapterIds?: string[]) => {
    const response = await fetch(`${API_BASE}/novels/${novelId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ format, chapter_ids: chapterIds ?? null }),
    })
    if (!response.ok) throw new Error('导出失败')
    return response.blob()
  },
}

export { api as workspaceApi }

/**
 * Open a folder picker and return an absolute path, or null if cancelled.
 * Uses the Electron native dialog when running in the desktop app; otherwise
 * (browser dev) it falls back to a manual prompt, since browsers don't expose
 * real filesystem paths. The picker defaults to `defaultPath`.
 */
export async function chooseDataDirectory(defaultPath: string): Promise<string | null> {
  if (window.mojingDesktop?.chooseDataDir) {
    try {
      return await window.mojingDesktop.chooseDataDir(defaultPath)
    } catch {
      return null
    }
  }
  const picked = window.prompt('请输入数据保存文件夹的绝对路径：', defaultPath)
  return picked && picked.trim() ? picked.trim() : null
}

