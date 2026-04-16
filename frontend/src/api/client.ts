import type { LLMConfig, Revision, RevisionScope, ReviseResponse, UploadResponse, ChatMessage, LanguageCode } from '../types'

// In production use a reverse proxy that routes /api → backend.
// In development Vite proxies /api → localhost:8000 (see vite.config.ts).
// VITE_API_URL can still override both (e.g. for a remote dev backend).
const BASE_URL = import.meta.env.VITE_API_URL ?? ''
const UPLOAD_TIMEOUT_MS = 60_000

async function apiError(res: Response): Promise<Error> {
  try {
    const body = await res.json()
    return new Error(body.detail ?? 'Something went wrong.')
  } catch {
    return new Error(await res.text() || 'Something went wrong.')
  }
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Upload timed out while processing this file.')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function reviseDocument(params: {
  file_id: string
  scope: RevisionScope
  instruction: string
  llm: LLMConfig
  current_slide?: number
  preferred_language?: LanguageCode
}): Promise<ReviseResponse> {
  const res = await fetch(`${BASE_URL}/api/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: params.file_id,
      scope: params.scope,
      instruction: params.instruction,
      current_slide: params.current_slide,
      llm: {
        provider: params.llm.provider,
        base_url: params.llm.baseUrl,
        api_key: params.llm.apiKey,
        model: params.llm.model,
        timeout: params.llm.timeout,
      },
      preferred_language: params.preferred_language,
    }),
  })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function applyRevisions(
  fileId: string,
  revisions: Revision[],
): Promise<UploadResponse> {
  const res = await fetch(`${BASE_URL}/api/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, revisions }),
  })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function branchFile(fileId: string): Promise<UploadResponse> {
  const res = await fetch(`${BASE_URL}/api/files/${fileId}/branch`, { method: 'POST' })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function getFile(fileId: string): Promise<UploadResponse> {
  const res = await fetch(`${BASE_URL}/api/files/${fileId}`)
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function undoRevision(fileId: string): Promise<UploadResponse> {
  const res = await fetch(`${BASE_URL}/api/undo/${fileId}`, { method: 'POST' })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function redoRevision(fileId: string): Promise<UploadResponse> {
  const res = await fetch(`${BASE_URL}/api/redo/${fileId}`, { method: 'POST' })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export function getDownloadUrl(fileId: string): string {
  return `${BASE_URL}/api/download/${fileId}`
}

export async function chatWithDocument(params: {
  file_id: string
  messages: ChatMessage[]
  llm: LLMConfig
  scope?: RevisionScope
  preferred_language?: LanguageCode
  onChunk: (chunk: string) => void
  signal?: AbortSignal
}): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: params.file_id,
      messages: params.messages,
      scope: params.scope ?? null,
      llm: {
        provider: params.llm.provider,
        base_url: params.llm.baseUrl,
        api_key: params.llm.apiKey,
        model: params.llm.model,
        timeout: params.llm.timeout,
      },
      preferred_language: params.preferred_language,
    }),
    signal: params.signal,
  })
  if (!res.ok) throw await apiError(res)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload)
        if (typeof parsed === 'string') {
          params.onChunk(parsed)
        } else if (parsed && typeof parsed.error === 'string') {
          throw new Error(parsed.error)
        }
      } catch (e) {
        if (e instanceof Error && e.message !== payload) throw e
      }
    }
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/files/${fileId}`, { method: 'DELETE' })
}
