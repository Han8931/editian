import { useState } from 'react'
import type { Skill } from '../types'

const LS_KEY = 'editian_skills'

export function loadSkills(): Skill[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
  } catch {
    return []
  }
}

function persist(skills: Skill[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(skills))
  } catch {}
}

export function useSkills() {
  const [skills, setSkillsState] = useState<Skill[]>(loadSkills)

  function setSkills(next: Skill[]) {
    setSkillsState(next)
    persist(next)
  }

  function addSkill(draft: Omit<Skill, 'id'>): Skill {
    const skill: Skill = { ...draft, id: crypto.randomUUID() }
    setSkills([...skills, skill])
    return skill
  }

  function updateSkill(id: string, patch: Partial<Omit<Skill, 'id'>>) {
    setSkills(skills.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function deleteSkill(id: string) {
    setSkills(skills.filter((s) => s.id !== id))
  }

  return { skills, addSkill, updateSkill, deleteSkill }
}
