import { useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react'
import type { Skill } from '../types'

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void     // called when Enter (without shift/meta) should submit
  submitOnEnter?: boolean   // if true, plain Enter submits (chat mode); default false
  skills: Skill[]
}

function getSlashQuery(value: string, pos: number): { query: string; start: number } | null {
  const before = value.slice(0, pos)
  const match = before.match(/(^|\s)\/(\w*)$/)
  if (!match) return null
  const start = before.lastIndexOf('/')
  return { query: match[2], start }
}

export default function SkillPicker({
  value, onChange, onSubmit, submitOnEnter = false, skills, className, ...rest
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [pickerIndex, setPickerIndex] = useState(0)
  const [slashInfo, setSlashInfo] = useState<{ query: string; start: number } | null>(null)

  const filtered = slashInfo
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().startsWith(slashInfo.query.toLowerCase()) ||
          s.description.toLowerCase().includes(slashInfo.query.toLowerCase()),
      )
    : []

  const isOpen = slashInfo !== null && filtered.length > 0

  function applySkill(skill: Skill) {
    if (!slashInfo) return
    const before = value.slice(0, slashInfo.start)
    const after = value.slice((textareaRef.current?.selectionStart ?? value.length))
    onChange(before + skill.body + after)
    setSlashInfo(null)
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      const pos = before.length + skill.body.length
      ta.setSelectionRange(pos, pos)
    }, 0)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const pos = e.target.selectionStart ?? val.length
    const info = getSlashQuery(val, pos)
    setSlashInfo(info)
    setPickerIndex(0)
    onChange(val)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex((i) => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Escape')    { e.preventDefault(); setSlashInfo(null); return }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        applySkill(filtered[pickerIndex])
        return
      }
    }

    if (submitOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit?.()
      return
    }

    const externalKeyDown = rest.onKeyDown as ((e: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined
    externalKeyDown?.(e)
  }

  return (
    <div className="relative flex-1 min-w-0">
      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50 max-h-52 overflow-y-auto">
          {filtered.map((skill, i) => (
            <button
              key={skill.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applySkill(skill) }}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                i === pickerIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <span className="text-xs font-mono font-semibold text-blue-600 shrink-0 mt-px">/{skill.name}</span>
              <span className="text-xs text-gray-500 leading-relaxed">{skill.description}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={className}
        {...rest}
      />
    </div>
  )
}
