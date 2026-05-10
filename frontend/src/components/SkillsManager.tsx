import { useState } from 'react'
import { Plus, Pencil, Trash2, Zap } from 'lucide-react'
import type { Skill } from '../types'
import { useSkills } from '../stores/skills'
import { useI18n } from '../i18n'

interface Props {
  onClose: () => void
}

const EMPTY_DRAFT = { name: '', description: '', body: '' }

export default function SkillsManager({ onClose }: Props) {
  const { msg } = useI18n()
  const { skills, addSkill, updateSkill, deleteSkill } = useSkills()
  const [editing, setEditing] = useState<string | null>(null) // skill id or 'new'
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [nameError, setNameError] = useState<string | null>(null)

  function startNew() {
    setDraft(EMPTY_DRAFT)
    setNameError(null)
    setEditing('new')
  }

  function startEdit(skill: Skill) {
    setDraft({ name: skill.name, description: skill.description, body: skill.body })
    setNameError(null)
    setEditing(skill.id)
  }

  function cancel() {
    setEditing(null)
    setNameError(null)
  }

  function validateName(name: string): string | null {
    if (!name.trim()) return msg('skillNameRequired')
    if (!/^\w+$/.test(name)) return msg('skillNameInvalid')
    const conflict = skills.find(
      (s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== editing,
    )
    if (conflict) return msg('skillNameTaken')
    return null
  }

  function save() {
    const err = validateName(draft.name)
    if (err) { setNameError(err); return }
    if (!draft.body.trim()) return

    if (editing === 'new') {
      addSkill({ name: draft.name.trim(), description: draft.description.trim(), body: draft.body.trim() })
    } else if (editing) {
      updateSkill(editing, { name: draft.name.trim(), description: draft.description.trim(), body: draft.body.trim() })
    }
    setEditing(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Skills list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {/* New skill form */}
        {editing === 'new' && (
          <SkillForm
            draft={draft}
            nameError={nameError}
            onChange={(patch) => { setDraft((d) => ({ ...d, ...patch })); setNameError(null) }}
            onSave={save}
            onCancel={cancel}
          />
        )}

        {skills.length === 0 && editing !== 'new' && (
          <div className="flex flex-col items-center justify-center text-center py-12 gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <Zap size={18} className="text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-600">{msg('noSkills')}</p>
            <p className="text-xs text-gray-400 leading-relaxed">{msg('noSkillsHint')}</p>
          </div>
        )}

        {skills.map((skill) =>
          editing === skill.id ? (
            <SkillForm
              key={skill.id}
              draft={draft}
              nameError={nameError}
              onChange={(patch) => { setDraft((d) => ({ ...d, ...patch })); setNameError(null) }}
              onSave={save}
              onCancel={cancel}
            />
          ) : (
            <div
              key={skill.id}
              className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 hover:border-gray-300 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono font-semibold text-blue-600">/{skill.name}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{skill.description || <span className="italic text-gray-300">{msg('noDescription')}</span>}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => startEdit(skill)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title={msg('edit')}
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => deleteSkill(skill.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title={msg('delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {/* Add button */}
      {editing === null && (
        <div className="flex-shrink-0 border-t border-gray-200 p-3">
          <button
            onClick={startNew}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Plus size={14} />
            {msg('addSkill')}
          </button>
        </div>
      )}
    </div>
  )
}

function SkillForm({
  draft, nameError, onChange, onSave, onCancel,
}: {
  draft: { name: string; description: string; body: string }
  nameError: string | null
  onChange: (patch: Partial<typeof draft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { msg } = useI18n()

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 flex flex-col gap-2.5">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            {msg('skillName')}
          </label>
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-300">
            <span className="text-xs text-gray-400 font-mono">/</span>
            <input
              type="text"
              className="flex-1 text-sm bg-transparent outline-none placeholder-gray-300 font-mono"
              placeholder="formalize"
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value.replace(/[^\w]/g, '').toLowerCase() })}
            />
          </div>
          {nameError && <p className="text-[10px] text-red-500 mt-0.5">{nameError}</p>}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
          {msg('skillDescription')}
        </label>
        <input
          type="text"
          className="w-full border border-gray-200 rounded-lg bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder-gray-300"
          placeholder={msg('skillDescriptionPlaceholder')}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
          {msg('skillBody')}
        </label>
        <textarea
          className="w-full border border-gray-200 rounded-lg bg-white px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder-gray-300"
          rows={4}
          placeholder={msg('skillBodyPlaceholder')}
          value={draft.body}
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <p className="text-[10px] text-gray-400 mt-0.5">{msg('skillBodyHint')}</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={!draft.name.trim() || !draft.body.trim()}
          className="flex-1 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {msg('saveSkill')}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          {msg('cancel')}
        </button>
      </div>
    </div>
  )
}
