/**
 * Module-level store for long-running background tasks.
 * Tasks survive component unmount — results are recovered on remount.
 */
import { useEffect, useState } from 'react'

export type TaskState<T> =
  | { status: 'pending' }
  | { status: 'done'; result: T }
  | { status: 'error'; error: string }

const store = new Map<string, TaskState<unknown>>()
const subs = new Map<string, Set<() => void>>()
const globalSubs = new Set<() => void>()

function notify(key: string) {
  subs.get(key)?.forEach((cb) => cb())
  globalSubs.forEach((cb) => cb())
}

export function subscribeAny(cb: () => void): () => void {
  globalSubs.add(cb)
  return () => globalSubs.delete(cb)
}

export function hasAnyPending(): boolean {
  for (const state of store.values()) {
    if (state.status === 'pending') return true
  }
  return false
}

export function useAnyPending(): boolean {
  const [anyPending, setAnyPending] = useState(() => hasAnyPending())
  useEffect(() => {
    setAnyPending(hasAnyPending())
    return subscribeAny(() => setAnyPending(hasAnyPending()))
  }, [])
  return anyPending
}

export function getTask<T>(key: string): TaskState<T> | undefined {
  return store.get(key) as TaskState<T> | undefined
}

export function clearTask(key: string) {
  store.delete(key)
  notify(key)
}

export function subscribe(key: string, cb: () => void): () => void {
  if (!subs.has(key)) subs.set(key, new Set())
  subs.get(key)!.add(cb)
  return () => subs.get(key)?.delete(cb)
}

/**
 * Run a task and store the result. If the same key is already pending,
 * the caller will wait for the existing promise instead of starting a new one.
 * If already done, returns the cached result immediately.
 */
const pending = new Map<string, Promise<unknown>>()

export async function runTask<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = store.get(key)
  if (existing?.status === 'done') return existing.result as T
  if (existing?.status === 'error') throw new Error(existing.error)

  if (pending.has(key)) return pending.get(key) as Promise<T>

  store.set(key, { status: 'pending' })
  notify(key)

  const promise = fn().then(
    (result) => {
      store.set(key, { status: 'done', result })
      pending.delete(key)
      notify(key)
      return result
    },
    (e: unknown) => {
      const error = e instanceof Error ? e.message : String(e)
      store.set(key, { status: 'error', error })
      pending.delete(key)
      notify(key)
      throw e
    },
  )

  pending.set(key, promise as Promise<unknown>)
  return promise
}

/** React hook — subscribes to a task and re-renders on state change. */
export function useTask<T>(key: string): TaskState<T> | undefined {
  const [state, setState] = useState<TaskState<T> | undefined>(() => getTask<T>(key))

  useEffect(() => {
    setState(getTask<T>(key))
    return subscribe(key, () => setState(getTask<T>(key)))
  }, [key])

  return state
}
