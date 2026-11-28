import React, { useId } from 'react'
import { coordinate, HUMAN, KILLER, ROLES } from './game.js'
import { DIRECTIONS, hasSkill, SKILL_MODES, SKILLS, skillIds } from './skills.js'
import { SkillGlyph } from './skill-art.jsx'

export function SkillModes({ count, onChange, disabled }) {
  const name = useId()
  return (
    <fieldset className="difficulty-options skill-modes" disabled={disabled}>
      <legend>技能模式</legend>
      <div>
        {SKILL_MODES.map(([size, label]) => (
          <label key={size}>
            <input type="radio" name={name} value={size} checked={count === size} onChange={() => onChange(size)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function SkillPicker({ role, count, selected, onToggle, solo = false, disabled = false }) {
  if (!role || !count) return null
  return (
    <fieldset className="skill-picker" disabled={disabled}>
      <legend>{ROLES[role]}技能 <span className="quiet" role="status">{selected.length} / {count}</span></legend>
      {skillIds(role, solo).map(id => {
        const skill = SKILLS[role][id]
        const checked = selected.includes(id)
        return (
          <label key={id}>
            <input type="checkbox" name="skills" value={id} checked={checked} disabled={!checked && selected.length >= count}
              onChange={event => onToggle(id, event.target.checked)} />
            <SkillGlyph skill={id} role={role} />
            <span>
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

export function SkillSummary({ view, player }) {
  if (!view?.skills) return null
  return (
    <div className="skill-summary">
      {[player, player === HUMAN ? KILLER : HUMAN].map(role => (
        <section key={role}>
          <h3>{role === player ? '你的技能' : '对手技能'} · {ROLES[role]}</h3>
          <ul>
            {Object.entries(view.skills[role]).map(([id, remaining]) => {
              const skill = SKILLS[role][id]
              const uses = remaining === null ? (skill.uses === Infinity ? '不限次数' : '') : `剩余 ${remaining} 次`
              return <li key={id} title={skill.description}><SkillGlyph skill={id} role={role} />
                <strong>{skill.name}</strong>{uses && <small>{uses}</small>}</li>
            })}
          </ul>
        </section>
      ))}
      {player === HUMAN && hasSkill(view, HUMAN, 'healing') && view.health === 1 && <p>治疗进度 {view.healing} / 8</p>}
      {player === HUMAN && view.stealthUntil > view.round && <p>隐秘 · 剩余 {view.stealthUntil - view.round} 轮</p>}
      {player === HUMAN && view.flare && <p>信号枪 · 下次行动前向{DIRECTIONS[view.flare.direction]}发射</p>}
      {player === HUMAN && view.focused && <p>专注保护中</p>}
      {player === KILLER && hasSkill(view, KILLER, 'snipe') && <p>狙杀进度 {view.snipe === null ? '隐藏' : `${view.snipe} / 5`}</p>}
      {player === KILLER && view.watcher && <p>监视者 · {view.watcher.nearby === null ? '下轮启用'
        : view.watcher.nearby ? '附近有人' : '附近无人'}</p>}
    </div>
  )
}

export function SkillActions({ actions, role, onAction, onPreview }) {
  const options = actions.filter(action => Object.hasOwn(SKILLS[role], action.kind) ||
    action.kind === 'trackWait' || action.kind === 'trackCancel')
  if (!options.length) return null
  const groups = new Map()
  for (const action of options) {
    if (!groups.has(action.kind)) groups.set(action.kind, [])
    groups.get(action.kind).push(action)
  }
  return (
    <div className="turn-actions skill-actions" role="group" aria-label="可用技能">
      {[...groups].map(([kind, choices]) => {
        const name = SKILLS[role][kind]?.name ?? (kind === 'trackWait' ? '结束本轮跟踪' : '收回跟踪者')
        if (!choices[0].direction) {
          return <button type="button" className="secondary" key={kind} onClick={() => onAction(choices[0])}>
            <SkillGlyph skill={SKILLS[role][kind] ? kind : 'track'} role={role} />{name}
          </button>
        }
        return (
          <details key={kind} onToggle={event => { if (!event.currentTarget.open) onPreview(null) }}>
            <summary><SkillGlyph skill={kind} role={role} />{name} · 选择方向</summary>
            <div className="skill-directions">
              {choices.map(action => (
                <button type="button" className="secondary" key={action.direction}
                  onPointerEnter={() => onPreview(action)} onPointerLeave={() => onPreview(null)}
                  onFocus={() => onPreview(action)} onBlur={() => onPreview(null)}
                  onClick={() => onAction(action)}>
                  向{DIRECTIONS[action.direction]}{kind === 'blink' && ` · ${coordinate(action.to)}`}
                </button>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
