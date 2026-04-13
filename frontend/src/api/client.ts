import type { LLMConfig, Revision, RevisionScope, ReviseResponse, UploadResponse, ChatMessage } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
  const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', body: form })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function reviseDocument(params: {
  file_id: string
  scope: RevisionScope
  instruction: string
  llm: LLMConfig
}): Promise<ReviseResponse> {
  const res = await fetch(`${BASE_URL}/api/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: params.file_id,
      scope: params.scope,
      instruction: params.instruction,
      llm: {
        provider: params.llm.provider,
        base_url: params.llm.baseUrl,
        api_key: params.llm.apiKey,
        model: params.llm.model,
        timeout: params.llm.timeout,
      },
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
}): Promise<string> {
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
    }),
  })
  if (!res.ok) throw await apiError(res)
  const data = await res.json()
  return data.reply as string
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/files/${fileId}`, { method: 'DELETE' })
}
