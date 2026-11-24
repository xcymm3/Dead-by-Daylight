import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KILLER, WIDTH } from './game.js'

export function TerrainArt({ type, condition, open }) {
  let object
  switch (type) {
    case 'machine':
      object = (
        <>
          <path d="M18 29 44 19 65 27 39 37Z" fill="var(--art-steel-light)" />
          <path d="M18 29 39 37v17L18 45Z" fill="var(--art-steel)" />
          <path d="M39 37 65 27v17L39 54Z" fill="var(--art-steel-dark)" />
          <path d="M25 27V18l13-5 10 4v9l-13 5Z" fill="var(--art-copper)" />
          <path d="m25 18 10 4 13-5M35 22v9M23 35l10 4m-10 1 10 4m-9 6v3m36-7v4"
            stroke="var(--art-line)" fill="none" strokeWidth="1.5" />
          <path d="m47 38 11-4v6l-11 4Z" fill={condition === 'repaired' ? 'var(--art-green)' : 'var(--art-rust)'} />
          <path d="m49 40 7-3" stroke="var(--art-glint)" strokeWidth="1.25" />
          <path d="M49 22c0-5 3-8 7-8 3 0 5 2 5 5v8" fill="none" stroke="var(--art-copper)" strokeWidth="3" />
        </>
      )
      break
    case 'wall':
    case 'window':
      object = (
        <>
          <path d="M12 22 52 8 67 14 27 29Z" fill="var(--art-stone-light)" />
          <path d="M12 22 27 29v27L12 49Z" fill="var(--art-stone-dark)" />
          <path d="M27 29 67 14v27L27 56Z" fill="var(--art-stone)" />
          <path d="m14 32 12 5m-12 4 12 5m2-8 38-14M28 47l38-14m-27-10v11m12-5v10m-13 4v8m19-33v9m2 9v8"
            fill="none" stroke="var(--art-mortar)" strokeWidth="1.1" />
          {type === 'window' && (
            <>
              <path d="m34 30 24-9v18l-24 9Z" fill="var(--art-steel-dark)" stroke="var(--art-wood)" strokeWidth="3" />
              <path d="m37 31 18-7v12l-18 7Z" fill="var(--art-window)" />
              <path d="m46 28 0 12m-9-2 18-7" stroke="var(--art-glint)" strokeWidth="1.2" opacity=".7" />
              <path d="m31 48 28-11 4 2-28 11Z" fill="var(--art-wood-light)" />
            </>
          )}
        </>
      )
      break
    case 'pallet':
      if (condition === 'broken') {
        object = (
          <>
            <path d="m17 44 17-10 7 2-11 6 4 2-14 6Z" fill="var(--art-wood)" />
            <path d="m40 47 15-9 7 4-10 3 3 3-10 3Z" fill="var(--art-wood-light)" />
            <path d="m36 52 8-4-4 7-5 2Zm14-18 11-4-5 7Z" fill="var(--art-wood-dark)" />
          </>
        )
      } else {
        object = (
          <g transform={condition === 'dropped' ? 'translate(-2 33) skewY(-16) scale(1 .52)' : 'translate(1 3) skewY(-15)'}>
            <path d="M16 27h43v31H16Z" fill="var(--art-wood-dark)" />
            <path d="M16 27h43v4H16Z" fill="var(--art-wood-light)" />
            <path d="M19 32h39v6H19Zm0 9h39v6H19Zm0 9h39v6H19Z" fill="var(--art-wood)" />
            <path d="M23 31h5v25h-5Zm25 0h5v25h-5Z" fill="var(--art-wood-light)" />
            <path d="M23 35h5m20 0h5m-30 17h5m20 0h5" stroke="var(--art-line)" strokeWidth="1.4" />
          </g>
        )
      }
      break
    case 'exit':
      object = (
        <>
          <path d="m16 42 36-10 14 7-36 12Z" fill={open ? 'var(--art-gate-glow)' : 'var(--art-steel-dark)'} />
          <path d="M19 45V21L57 9v24M24 48V25l38-12v24" fill="none" stroke="var(--art-steel-dark)" strokeWidth="5" />
          <path d="M24 48V25l38-12v24" fill="none" stroke="var(--art-steel-light)" strokeWidth="2.5" />
          {!open && <path d="m28 26 30-10v22L28 48Zm2 7 27-9m-27 16 27-9m-12-11v21"
            fill="none" stroke="var(--art-mortar)" strokeWidth="2" />}
          <path d="m45 16 7-2v4l-7 2Z" fill={open ? 'var(--art-green)' : 'var(--art-rust)'} />
          {open && <path d="m35 44 14-6m-5-2 6 2-3 6" fill="none" stroke="var(--art-green)" strokeWidth="2" />}
        </>
      )
      break
    default:
      return null
  }

  return (
    <svg className="terrain-art" viewBox="0 0 80 64" aria-hidden="true" focusable="false">
      <path d="M9 47 52 34 74 44 30 59Z" fill="var(--art-shadow)" />
      {object}
    </svg>
  )
}

const MOTION_TIME = { walk: 285, vault: 390, attack: 540, hurt: 525 }

export function CharacterArt({ role, at, health, replayRound }) {
  const prior = useRef({ at, health, replayRound })
  const motionSequence = useRef(0)
  const [motion, setMotion] = useState(null)
  const [facing, setFacing] = useState(1)
  const killer = role === KILLER

  useLayoutEffect(() => {
    const before = prior.current
    prior.current = { at, health, replayRound }
    const dx = at % WIDTH - before.at % WIDTH
    const dy = Math.floor(at / WIDTH) - Math.floor(before.at / WIDTH)
    if (dx) setFacing(Math.sign(dx))
    const forward = replayRound === null || (before.replayRound !== null && replayRound > before.replayRound)
    const hit = forward && health < before.health
    const distance = Math.abs(dx) + Math.abs(dy)
    if (hit || distance) {
      const name = hit ? (killer ? 'attack' : 'hurt') : distance > 1 && replayRound === null ? 'vault' : 'walk'
      setMotion({ name, sequence: (motionSequence.current += 1) })
    }
  }, [at, health, killer, replayRound])

  useEffect(() => {
    if (!motion) return
    const timeout = setTimeout(() => setMotion(null), MOTION_TIME[motion.name])
    return () => clearTimeout(timeout)
  }, [motion])

  return (
    <svg className={`character-art character-${role}`} viewBox="0 0 64 68" aria-hidden="true" focusable="false">
      <ellipse cx="32" cy="60" rx="17" ry="4.7" className="character-shadow" />
      <ellipse cx="32" cy="59" rx="12" ry="3.6" className="character-base" />
      <g transform={facing < 0 ? 'translate(64 0) scale(-1 1)' : undefined}>
        <g key={motion?.sequence ?? 0} className={`character-rig motion-${motion?.name ?? 'idle'}`}>
          <g className="character-limbs" strokeLinecap="round" strokeLinejoin="round">
            <g className="limb leg-back"><path d="M31 42 40 51l3 8h4" /></g>
            <g className="limb leg-front"><path d="m30 42-7 10-3 7h-4" /></g>
            <path d="M29 27 28 37l3 6" className="character-body-line" />
            <g className="limb arm-back"><path d="m28 28-8 7-2 7" /></g>
            <g className="limb arm-front">
              <path d="m30 28 9 6 4 7" />
              {killer && (
                <>
                  <path className="knife-handle" d="m42 43 5-7" />
                  <path className="knife-blade" d="m46 37 8-17 2 3-2 8-5 8Z" />
                  <path className="knife-edge" d="m49 36 5-11" />
                </>
              )}
            </g>
          </g>
          <circle className="character-head" cx="28" cy="19" r="8.5" />
          {killer ? <path className="character-face" d="M24 18h2m5 0h2m-7 5h4" />
            : <path className="character-face" d="M30 19h1.5" />}
        </g>
        {motion?.name === 'attack' && <path key={`swipe-${motion.sequence}`} className="character-swipe" d="M42 16c9 6 14 13 13 22" />}
        {motion?.name === 'hurt' && <path key={`impact-${motion.sequence}`} className="character-impact" d="m37 18 4-6m1 12 7-2m-25 0-7-3" />}
      </g>
    </svg>
  )
}
