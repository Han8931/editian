import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { testLlmConnection } from '../api/client'
import type { LLMConfig, LanguageCode, LLMConnectionResult } from '../types'
import { useI18n } from '../i18n'

interface Props {
  llm: LLMConfig
  language: LanguageCode
  onChange: (llm: LLMConfig) => void
  onLanguageChange: (language: LanguageCode) => void
}

const PROVIDERS: { value: LLMConfig['provider']; label: string }[] = [
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'compatible', label: 'Custom (OpenAI-compatible)' },
]

const DEFAULT_MODELS: Record<string, string> = {
  ollama: 'llama3.2',
  openai: 'gpt-4o',
  compatible: 'mistral',
}

const DEFAULT_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  compatible: '',
}

const LANGUAGES: { value: LanguageCode; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
]

export default function Settings({ llm, language, onChange, onLanguageChange }: Props) {
  const { msg } = useI18n()
  const [draft, setDraft] = useState<LLMConfig>(llm)
  const [draftLanguage, setDraftLanguage] = useState<LanguageCode>(language)
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<LLMConnectionResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const set = (patch: Partial<LLMConfig>) => setDraft((prev) => ({ ...prev, ...patch }))

  const isDirty = JSON.stringify(draft) !== JSON.stringify(llm) || draftLanguage !== language

  useEffect(() => {
    setTestResult(null)
    setTestError(null)
  }, [draft, draftLanguage])

  function handleSave() {
    onChange(draft)
    onLanguageChange(draftLanguage)
    try {
      localStorage.setItem('editian_llm', JSON.stringify(draft))
    } catch {}
  }

  async function handleTestConnection() {
    setTestLoading(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await testLlmConnection(draft)
      setTestResult(result)
    } catch (e) {
      setTestError(e instanceof Error ? e.message : msg('connectionFailed'))
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-5">
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          {msg('preferredLanguage')}
        </label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={draftLanguage}
          onChange={(e) => setDraftLanguage(e.target.value as LanguageCode)}
        >
          {LANGUAGES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">{msg('languageHelp')}</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          {msg('provider')}
        </label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={draft.provider}
          onChange={(e) => {
            const provider = e.target.value as LLMConfig['provider']
            set({
              provider,
              model: DEFAULT_MODELS[provider],
              baseUrl: DEFAULT_URLS[provider],
            })
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          {msg('model')}
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={draft.model}
          placeholder="e.g. llama3.2, gpt-4o"
          onChange={(e) => set({ model: e.target.value })}
        />
      </div>

      {(draft.provider === 'ollama' || draft.provider === 'compatible') && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            {msg('baseUrl')}
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            value={draft.baseUrl ?? ''}
            placeholder={
              draft.provider === 'ollama'
                ? 'http://localhost:11434/v1'
                : 'https://api.example.com/v1'
            }
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </div>
      )}

      {draft.provider !== 'ollama' && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            {msg('apiKey')}
          </label>
          <input
            type="password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            value={draft.apiKey ?? ''}
            placeholder="sk-…"
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          {msg('timeoutSeconds')}
        </label>
        <input
          type="number"
          min={10}
          max={3600}
          step={10}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={draft.timeout}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (!isNaN(val) && val >= 10) set({ timeout: val })
          }}
        />
        <p className="text-xs text-gray-400 mt-1">{msg('timeoutHelp')}</p>
      </div>

      {(testResult || testError) && (
        <div className={`rounded-lg px-3 py-2 text-sm ${testError ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {testError ? (
            <p>{testError}</p>
          ) : (
            <p>
              {msg('connectedToModel', {
                provider: testResult?.provider ?? draft.provider,
                model: testResult?.model ?? draft.model,
              })}
            </p>
          )}
          {!testError && testResult?.base_url && (
            <p className="mt-1 text-xs opacity-80">
              {msg('baseUrl')}: {testResult.base_url}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testLoading}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testLoading ? <Loader2 size={14} className="animate-spin" /> : null}
          {testLoading ? msg('testingConnection') : msg('testConnection')}
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium text-sm hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isDirty ? msg('saveSettings') : msg('saved')}
        </button>
      </div>
    </div>
  )
}
