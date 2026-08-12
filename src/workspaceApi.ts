// ---------- types ----------
export type Novel = {
  id: string
  title: string
  description: string
  author: string
  genre: string
  target_words: number
  status: 'planning' | 'writing' | 'completed'
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
  created_at: string
  updated_at: string
}

/** Chapter metadata without the (potentially large) body. The workspace payload
 * returns summaries; full content is loaded on demand via getChapter(). */
export type ChapterSummary = Omit<Chapter, 'content'>

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
  points: [number, number][]
}

/** A map canvas inside a novel — different maps are different realms/areas
 *  (凡界 / 灵界 after an ascension), each with its own doodles + terrains. */
export type StoryMap = {
  id: string
  novel_id: string
  name: string
  description: string
  doodles: Doodle[]
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

export type Workspace = {
  novel: Novel
  chapters: ChapterSummary[]
  scenes: SceneSummary[]
  characters: Character[]
  locations: Location[]
  world_settings: WorldSetting[]
  plot_threads: PlotThread[]
  graph_edges: GraphEdge[]
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
}

export type AIGenerateRequest = {
  novel_id: string
  chapter_id?: string | null
  instruction?: string
  mode?: 'continue' | 'polish' | 'expand' | 'worldsetting' | 'setting_expand'
  target_words?: number
  // Pick a specific AI config (model); omit to use the active one.
  config_id?: number | null
  context?: Partial<AIContextOptions>
}

declare global {
  interface Window {
    mojingDesktop?: {
      platform: string
      getBackendUrl: () => string
      getAuthToken: () => string
      chooseDataDir?: (defaultPath?: string) => Promise<string | null>
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? `请求失败（${response.status}）`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

// ---------- SSE streaming for AI ----------
// `signal` lets the caller abort a runaway generation (user clicks "stop").
export async function* streamAI(
  path: string,
  body: AIGenerateRequest,
  signal?: AbortSignal,
): AsyncGenerator<{ text: string; model: string }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
    body: JSON.stringify(body),
    signal,
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
      try {
        const parsed = JSON.parse(data)
        // The backend turns upstream failures into a `{"error": "..."}` SSE
        // event. Surface it as a throw so callers actually see *why* it failed
        // (429 / 401 / read-timeout / 5xx) instead of a generic "no content".
        if (parsed.error) {
          throw new Error(typeof parsed.error === 'string' ? parsed.error : 'AI 生成失败')
        }
        if (parsed.text) yield { text: parsed.text, model: parsed.model ?? '' }
      } catch (e) {
        // Re-throw real errors (from the `if (parsed.error)` branch above);
        // only swallow JSON parse failures of partial chunks.
        if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e
        /* keep partial */
      }
    }
  }
}

const api = {
  // storage / data location
  getStorage: () => request<StorageInfo>('/storage'),
  setStoragePath: (dataDir: string) =>
    request<StorageInfo>('/storage/path', { method: 'POST', body: JSON.stringify({ data_dir: dataDir }) }),
  resetStorage: () => request<StorageInfo>('/storage/reset', { method: 'POST' }),

  // workspace / novels
  load: () => request<Workspace>('/workspace'),
  getNovel: (id: string) => request<Workspace>(`/novels/${id}`),
  listNovels: () => request<Novel[]>('/novels'),
  createNovel: (data: Partial<Novel>) =>
    request<Novel>('/novels', { method: 'POST', body: JSON.stringify(data) }),
  updateNovel: (id: string, data: Partial<Novel>) =>
    request<Novel>(`/novels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNovel: (id: string) => request<void>(`/novels/${id}`, { method: 'DELETE' }),

  // chapters
  createChapter: (novelId: string, title: string, content = '') =>
    request<Chapter>(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title, content }) }),
  getChapter: (id: string) => request<Chapter>(`/chapters/${id}`),
  updateChapter: (id: string, changes: Partial<Pick<Chapter, 'title' | 'content' | 'status'>>) =>
    request<Chapter>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(changes) }),
  deleteChapter: (id: string) => request<void>(`/chapters/${id}`, { method: 'DELETE' }),
  listVersions: (chapterId: string) =>
    request<ChapterVersion[]>(`/chapters/${chapterId}/versions`),
  rollback: (chapterId: string, versionId: string) =>
    request<Chapter>(`/chapters/${chapterId}/rollback/${versionId}`, { method: 'POST' }),

  // scenes (outline mind-map leaf nodes)
  createScene: (novelId: string, chapterId: string, title: string) =>
    request<SceneSummary>(`/novels/${novelId}/chapters/${chapterId}/scenes`, { method: 'POST', body: JSON.stringify({ title }) }),
  renameScene: (id: string, title: string) =>
    request<SceneSummary>(`/scenes/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteScene: (id: string) => request<void>(`/scenes/${id}`, { method: 'DELETE' }),

  // graph edges (manual mind-map connectors)
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
      body: JSON.stringify(data ?? {}),
    }),
  /** Fetch the provider's model list (with context windows) via the backend. */
  listAIModels: (data: { base_url?: string; api_key?: string; config_id?: number }) =>
    request<{ ok: boolean; detail: string; models?: { id: string; context_length: number | null }[] }>(`/ai/models`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** Export the active config (key decrypted server-side) into the .env file. */
  exportAIEnv: () =>
    request<{ ok: boolean; detail: string; path?: string }>(`/ai/export-env`, { method: 'POST' }),
  aiModels: () =>
    request<{ active: AIConfig | null; configs: AIConfig[]; provider: string; offline_fallback: boolean }>('/ai/models'),
  suggestThreads: (novelId: string) =>
    request<{ suggestions: { thread_id: string; title: string; priority: string; advice: string }[]; unresolved_count: number }>(
      '/ai/suggest-threads',
      { method: 'POST', body: JSON.stringify({ novel_id: novelId }) },
    ),
  checkConsistency: (novelId: string) =>
    request<{ findings: { level: string; message: string }[]; unresolved: number; chapters: number }>(
      '/ai/check-consistency',
      { method: 'POST', body: JSON.stringify({ novel_id: novelId }) },
    ),

  // search + export
  search: (novelId: string, q: string) =>
    request<{ chapters: { id: string; title: string; order: number; word_count: number }[]; characters: { id: string; name: string; role: string }[]; threads: { id: string; title: string; status: string }[]; total: number }>(
      `/novels/${novelId}/search?q=${encodeURIComponent(q)}`,
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
  exportNovel: async (novelId: string, format: 'txt' | 'markdown' | 'docx', chapterIds?: string[]) => {
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

