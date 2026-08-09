export type Novel = {
  id: string
  title: string
  description: string
  author: string
  genre: string
  target_words: number
  status: string
  total_words: number
  chapter_count: number
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

export type Workspace = {
  novel: Novel
  chapters: Chapter[]
}

declare global {
  interface Window {
    mojingDesktop?: {
      platform: string
      getBackendUrl: () => string
    }
  }
}

const API_BASE = window.mojingDesktop?.getBackendUrl() ??
  import.meta.env.VITE_API_URL ??
  'http://127.0.0.1:8765/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail ?? `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

export const workspaceApi = {
  load: () => request<Workspace>('/workspace'),
  createChapter: (novelId: string, title: string) => request<Chapter>(`/novels/${novelId}/chapters`, {
    method: 'POST',
    body: JSON.stringify({ title, content: '' }),
  }),
  updateChapter: (chapterId: string, changes: Partial<Pick<Chapter, 'title' | 'content' | 'status'>>) =>
    request<Chapter>(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify(changes),
    }),
}

