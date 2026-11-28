import React, { useLayoutEffect, useRef, useState, useEffect } from 'react'
import { HUMAN, KILLER, skillArea } from './game.js'
import { hasSkill } from './skills.js'

const glyphs = {
  strong: 'M7 12V7a1.5 1.5 0 0 1 3 0v3-5a1.5 1.5 0 0 1 3 0v5-5a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v8l-3 5H9l-4-6a1.5 1.5 0 0 1 2-2Z M9 16h6',
  healing: 'M8 20V4h8v16z M12 7v10 M10 10h4 M10 14h4 M4 9h2m-1-1v2m12 5h3m-1.5-1.5v3',
  escape: 'M12 21H4V3h10v7 M4 21l7-3V6L4 3 M10 13h10m-3-3 3 3-3 3',
  focus: 'M12 3 4 6v6c0 4 5 7 8 9 3-2 8-5 8-9V6z M9 12l3-3 3 3-3 3z',
  trap: 'M3 9h18v6H3z M4 8l3 4 3-4 2 4 2-4 3 4 3-4 M4 16l3-4 3 4 2-4 2 4 3-4 3 4',
  flare: 'm5 15 8-8 4 4-5 5v4H9l-2-3Z M16 5l2-2m0 5h4m-2-3 2-1 M8 17l3-3',
  blink: 'M9 3a9 9 0 0 0 0 18m6-18a9 9 0 0 1 0 18 M13 5l-5 8h4l-1 6 5-8h-4z',
  stealth: 'M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Z M12 9a3 3 0 1 0 3 3 M5 20 19 4',
  snipe: 'M12 2v5m0 10v5M2 12h5m10 0h5 M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M12 11v2m-1-1h2',
  lockdown: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3 M12 14v3m-9-7 3 2m12 5 3 2m-3-9 3-2M3 19l3-2',
  frenzy: 'M13 2c0 4-4 5-4 8l-2-2c-2 2-3 5-2 8 1 3 4 5 7 5 5 0 8-3 8-7 0-3-2-6-4-7 0 3-2 4-2 4 1-4 0-7-1-9Z M12 20c-3-3-2-5 1-8 0 3 3 3 2 6l-1 2',
  sabotage: 'M9 19h6m-5 3h4 M7 15a6 6 0 1 1 10 0l-2 2H9z M13 6l-4 5h4l-2 5 M3 4l2 2m14 0 2-2',
  watch: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z M12 3v2m0 14v2',
  track: 'm12 3 8 9-8 9-8-9z M9 12l2 2 4-4 M2 9V6h3m14 0h3v3M2 15v3h3m14 0h3v-3',
  slash: 'M5 20l7-7m0 0 3-5 6-5-4 8-5 2Z M8 14l2 2 M4 11C7 5 12 3 17 3 M3 15c1 3 4 5 8 6',
}

export function SkillGlyph({ skill, role, state }) {
  const shape = skill === 'watch' && state === 'clear' ? 'M3 10q9 10 18 0 M6 14l-2 3m8 0v4m6-7 2 3' : glyphs[skill]
  return (
    <svg className="skill-glyph" data-skill={skill} data-role={role} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={shape} />
    </svg>
  )
}

const angle = { east: 0, south: 90, west: 180, north: 270 }
const effectLife = 920

function point(cells, columns, at) {
  if (!Number.isInteger(at)) return null
  const i = cells.indexOf(at)
  return i < 0 ? null : [i % columns * 100 + 50, Math.floor(i / columns) * 100 + 50]
}

function Crest({ skill, size = 44 }) {
  return (
    <svg x={-size / 2} y={-size / 2} width={size} height={size} viewBox="0 0 24 24" className="fx-crest">
      <path d={glyphs[skill]} />
    </svg>
  )
}

function Shock({ skill, muted = false }) {
  return (
    <>
      <g className="fx-ring">
        <circle r="33" className="fx-wash" />
        <circle r="35" className="fx-fine" strokeDasharray="5 6" />
        <circle r="26" className="fx-line" />
      </g>
      <g className={muted ? 'fx-mark fx-muted' : 'fx-mark'}><Crest skill={skill} /></g>
    </>
  )
}

function Sparks() {
  return (
    <path className="fx-sparks" d="m-20-20-11-8m37 6 4-13m11 20 12-5m-11 26 14 4m-21 10 3 13m-26-13-3 12m-11-21-15 8m14-26-15-2" />
  )
}

function SkillImpact({ skill, stage }) {
  switch (skill) {
    case 'snipe':
    case 'track':
      return <g className="fx-lock"><Crest skill={skill} size={skill === 'snipe' ? 76 : 58} />
        <path className="fx-fine" d="M-38-23v-15h15m46 0h15v15m0 46v15H23m-46 0h-15V23" />
        {stage === 'impact' && <Sparks />}
      </g>
    case 'frenzy':
      return <><g className="fx-mist">
        <path className="fx-blade" d="M-44 23q-7-22 10-42l4 15 13-35q12 17 11 24L11-47l6 24L26-36q4 18 14 26 12 11 4 33Q6 44-44 23Z" />
        <path className="fx-fine" d="M-29 21q0-9 12-21m9 29Q0 21 7 5m14 20 8-10" />
      </g><g className="fx-lift"><Crest skill={skill} /></g></>
    case 'lockdown':
      if (stage !== 'seal') break
      return <><g className="fx-lock">
        <path className="fx-line" strokeDasharray="8 5" d="M-43-40 43 40M43-40-43 40" />
        <rect x="-34" y="-34" width="68" height="68" rx="7" className="fx-wash" />
        <Crest skill={skill} size={49} />
      </g><Sparks /></>
    case 'sabotage':
      return <>
        <g className="fx-ring"><Crest skill={skill} size={48} /><Sparks /></g>
        <path className="fx-fragments" d="m-39-14 13 10-14 5Zm17-24 9 13-14 3Zm53-1 4 15-12-6Zm12 52-11 4 3-13Zm-20 25-14 5 7-15Zm-51-7 12-5-5 15Z" />
      </>
    case 'watch':
      return <><g className="fx-ring"><circle r="46" className="fx-wash" /><circle r="44" className="fx-fine" strokeDasharray="4 8" />
        <ellipse rx="42" ry="23" className="fx-line" /></g><g className="fx-mark"><Crest skill={skill} size={56} /></g></>
    case 'focus':
      return <g className="fx-lock">
        <path className="fx-wash" d="M0-43-37-28v24c0 19 12 29 37 46 25-17 37-27 37-46v-24Z" />
        <path className="fx-line" d="M-27-21 0-32l27 11M-27 7q5 12 27 26Q22 19 27 7" />
        <Crest skill={skill} size={44} />{stage === 'block' && <Sparks />}
      </g>
  }
  return <><Shock skill={skill} muted={stage === 'place'} />{['impact', 'break'].includes(stage) && <Sparks />}</>
}

function Portal({ arrival }) {
  return (
    <g className={`fx-portal ${arrival ? 'fx-arrival' : ''}`}>
      <ellipse rx="37" ry="29" className="fx-wash" />
      <ellipse rx="35" ry="28" className="fx-line" strokeDasharray="30 8 11 6" />
      <ellipse rx="27" ry="20" className="fx-fine" />
      <path className="fx-line" d="M-39-10h12m-1 32h20m29-42h17m-1 23h9" />
      <Crest skill="blink" size={39} />
    </g>
  )
}

function EffectArt({ event, cells, columns }) {
  const { skill, stage, at, to, role, direction } = event
  const start = point(cells, columns, at)
  if (!start) return null
  const offset = `translate(${start.join(' ')})`

  if (skill === 'blink' || (skill === 'track' && stage === 'move')) {
    const end = point(cells, columns, to)
    if (!end) return null
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    return (
      <g data-skill={skill} data-role={role} className="fx-event" transform={offset}>
        <path className="fx-trail" d={`M0 0 L${dx} ${dy}`} />
        {skill === 'blink' ? <><Portal /><g transform={`translate(${dx} ${dy})`}><Portal arrival /></g></>
          : <g transform={`translate(${dx} ${dy})`}><g className="fx-mark"><Crest skill={skill} size={30} /></g></g>}
      </g>
    )
  }

  if ((skill === 'flare' && direction) || skill === 'slash') {
    const area = skillArea(at, direction, skill).map(cell => point(cells, columns, cell)).filter(Boolean)
    const reach = Math.max(28, ...area.map(([x, y]) => Math.max(Math.abs(x - start[0]), Math.abs(y - start[1])))) + 18
    return (
      <g data-skill={skill} className="fx-event" data-stage={stage} transform={offset}>
        {stage !== 'aim' && area.map(([x, y], index) => (
          <rect key={index} className="fx-area" x={x - start[0] - 38} y={y - start[1] - 38} width="76" height="76" rx="9" />
        ))}
        <g transform={`rotate(${angle[direction]})`}>
          {skill === 'slash' ? (
            <g className="fx-sweep">
              <path className="fx-blade" d="M24-126Q210-106 123 80Q86 122 15 132Q121 60 105-17Q94-80 24-126Z" />
              <path className="fx-line" d="M24-126Q210-106 123 80Q86 122 15 132" />
              <path className="fx-fine" d="M43-94Q132-72 99 48m-59-116 17-22m47 135 15 11" />
            </g>
          ) : stage === 'aim' ? (
            <g className="fx-mark"><path className="fx-line" d="M-18 0h49m-12-11L31 0 19 11" /><path className="fx-fine" d="M-27-16v32" /></g>
          ) : (
            <g className="fx-beam">
              <path className="fx-blade" d={`M0-7 ${reach} 0 0 7Z`} />
              <path className="fx-line" d={`M4 0H${reach}`} />
              <path className="fx-fine" d={`M0-16 ${reach * 0.8} 0 0 16`} />
              <path d="M0-12 3-3 12 0 3 3 0 13-3 3-12 0-3-3Z" fill="currentColor" />
            </g>
          )}
        </g>
      </g>
    )
  }

  return (
    <g data-skill={skill} className="fx-event" data-stage={stage} transform={offset}>
      {skill === 'escape' || skill === 'healing' ? (
        <>
          <g className="fx-ring"><circle r={stage === 'mend' ? 24 : 38} className="fx-wash" /><circle r="27" className="fx-fine" /></g>
          <g className="fx-lift"><Crest skill={skill} size={stage === 'mend' ? 30 : 46} />
            <path className="fx-line" d="M-26-15v12m-6-6h12m44 8v16m-8-8h16M7-34v12m-6-6h12" />
          </g>
        </>
      ) : skill === 'stealth' ? (
        <g className="fx-mist"><ellipse rx="48" ry="31" className="fx-wash" />
          <path className="fx-line" d="M-44 6c17-24 25 15 46-7s29-14 45-3M-38 15c15-15 26 15 45-5 14-15 22-11 31-6" />
          <Crest skill={skill} size={35} />
        </g>
      ) : skill === 'trap' && stage === 'snap' ? (
        <>
          <g className="fx-jaw-top"><path className="fx-line" d="M-38-23-27-7-17-20-6-7 5-20 16-7 26-20 38-7" /></g>
          <g className="fx-jaw-bottom"><path className="fx-line" d="M-38 23-27 7-17 20-6 7 5 20 16 7 26 20 38 7" /></g>
          <Sparks />
        </>
      ) : <SkillImpact skill={skill} stage={stage} />}
    </g>
  )
}

export function SkillEffectsLayer({ events, cells, columns }) {
  const newest = events.at(-1)?.id ?? 0
  const cursor = useRef(newest)
  const [active, setActive] = useState([])

  useLayoutEffect(() => {
    const last = cursor.current
    cursor.current = newest
    if (newest < last) setActive([])
    if (newest <= last) return
    const expires = performance.now() + effectLife
    const incoming = events.filter(event => event.id > last).map(event => ({ event, expires }))
    setActive(current => [...current, ...incoming].slice(-12))
  }, [events, newest])

  useEffect(() => {
    if (!active.length) return
    const deadline = active[0].expires
    const timer = setTimeout(() => setActive(current => current.filter(item => item.expires > deadline)),
      Math.max(0, deadline - performance.now()))
    return () => clearTimeout(timer)
  }, [active])

  if (!active.length) return null
  return (
    <svg className="skill-board-fx" viewBox={`0 0 ${columns * 100} ${cells.length / columns * 100}`}
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {active.map(({ event }) => <EffectArt key={event.id} event={event} cells={cells} columns={columns} />)}
    </svg>
  )
}

export function SkillProps({ view, cells, columns }) {
  const { trap, watcher, tracker, flare } = view ?? {}
  const props = [
    ...(view?.blockedWindows ?? []).map(at => ({ at, skill: 'lockdown' })),
    trap && { at: trap.at, skill: 'trap' },
    tracker && { at: tracker.at, skill: 'track', state: tracker.started ? 'active' : 'pending' },
    watcher && { at: watcher.at, skill: 'watch', state: watcher.nearby === null ? 'pending' : watcher.nearby ? 'near' : 'clear' },
    flare && { at: flare.at, skill: 'flare', state: 'pending', direction: flare.direction },
  ].filter(Boolean)
  return props.map(({ at, skill, state, direction }) => {
    const slot = cells.indexOf(at)
    if (slot < 0) return null
    return (
      <div key={`${skill}-${at}`} className="skill-prop-slot" data-skill={skill} data-state={state}
        style={{ '--col': slot % columns, '--row': Math.floor(slot / columns) }} aria-hidden="true">
        {skill === 'lockdown' && <svg className="skill-seal" viewBox="0 0 100 100">
          <path d="M19 19 81 81M81 19 19 81" />
          <path d="M19 69v12h12m38 0h12V69M19 31V19h12m38 0h12v12" />
        </svg>}
        {direction && <svg className="skill-aim" viewBox="0 0 100 100">
          <path d="M58 50h29m-9-7 9 7-9 7" transform={`rotate(${angle[direction]} 50 50)`} />
        </svg>}
        <span key={state} className="skill-prop"><SkillGlyph skill={skill} state={state} /></span>
      </div>
    )
  })
}

export function SkillAura({ view, role }) {
  if (!view?.skills || view.winner) return null
  const focus = role === HUMAN && view.focused
  const stealth = role === HUMAN && view.stealthUntil > view.round
  const rage = role === KILLER && (view.rage || (view.count >= 3 && hasSkill(view, KILLER, 'frenzy')))
  const tracked = role === HUMAN && view.humanStun > 0
  if (!focus && !stealth && !rage && !tracked) return null
  return (
    <svg className="skill-aura" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {stealth && <g data-skill="stealth"><ellipse cx="50" cy="66" rx="44" ry="24" className="fx-wash" />
        <path className="fx-line" d="M8 66c13-11 19 9 37 3s27-17 46-6M17 77c13-10 17 6 36 0s19-6 30-3" /></g>}
      {rage && <g data-skill="frenzy"><ellipse cx="50" cy="69" rx="43" ry="24" className="fx-wash" />
        <path className="fx-line" d="M8 71 17 59l5 5 9-20 2 14 8-9m15 4 8 9 5-17 9 18 6-7 8 13M22 77q28 19 56 0" /></g>}
      {focus && <g data-skill="focus"><path className="fx-wash" d="M50 7 19 19v29c0 22 16 33 31 42 15-9 31-20 31-42V19Z" />
        <path className="fx-line" d="M28 23 50 14l22 9m-49 32q3 15 27 30 24-15 27-30" /></g>}
      {tracked && <g data-skill="track"><ellipse cx="50" cy="66" rx="43" ry="23" className="fx-line" strokeDasharray="8 5" />
        <path className="fx-fine" d="M50 38v9m0 37v9M2 66h13m70 0h13" /></g>}
    </svg>
  )
}
