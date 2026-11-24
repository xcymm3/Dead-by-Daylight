import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KILLER, PALLETS } from './game.js'

function PalletBoards() {
  return (
    <>
      <path d="M-11-18 9-20l4 37-21 4Z" fill="var(--art-wood-dark)" />
      <path d="M-10-17-5-18l3 36-5 1Zm7-2 5-1L5 16l-5 1Zm7-1 5-1 3 36-5 1Z" fill="var(--art-wood)" />
      <path d="m-11-12 21-3 1 5-21 3Zm2 20 21-3 1 5-21 4Z" fill="var(--art-wood-light)" />
      <path d="M-7-10h1m12-2h1M-5 10h1m12-2h1" stroke="var(--art-line)" strokeWidth="1.4" strokeLinecap="round" />
    </>
  )
}

function LegacyWallSection({ from, to, sill = false }) {
  const near = 30
  const thickness = 14
  const rise = sill ? 4 : 24
  const lift = sill ? 6 : 43
  const topX = near + rise
  const bottomFar = near + thickness
  const topFar = topX + thickness
  const topFrom = from - lift
  const topTo = to - lift
  return (
    <>
      <path d={`M${topX} ${topFrom}H${topFar}L${bottomFar} ${from}H${near}Z`} fill="var(--art-stone-dark)" />
      <path d={`M${topX} ${topFrom}V${topTo}L${near} ${to}V${from}Z`} fill="var(--art-stone)" />
      <path d={`M${topX} ${topTo}H${topFar}L${bottomFar} ${to}H${near}Z`} fill="var(--art-stone-dark)" />
      <path d={`M${topX} ${topFrom}H${topFar}V${topTo}H${topX}Z`} fill="var(--art-stone-light)" />
      {!sill && (
        <>
          <path d={`M${near + rise / 2} ${from - lift / 2}V${to - lift / 2}`}
            stroke="var(--art-mortar)" strokeWidth="1.25" />
          <path d={Array.from({ length: 4 }, (_, i) => {
            const joint = from + 11 + i * 15
            const upper = i % 2 === 0
            return upper
              ? `M${topX} ${joint - lift}l${-rise / 2} ${lift / 2}`
              : `M${near + rise / 2} ${joint - lift / 2}l${-rise / 2} ${lift / 2}`
          }).join(' ')} fill="none" stroke="var(--art-mortar)" strokeWidth="1.15" />
          <path d={`M${topX + 1} ${topFrom + 2}V${topTo - 2}`}
            stroke="var(--art-glint)" strokeWidth="1" opacity=".6" />
        </>
      )}
    </>
  )
}

function LegacyPallet({ condition = 'ready', south = false }) {
  return (
    <g className="passage-pallet" data-state={condition} data-south={south}
      transform={south ? 'translate(37 288)' : 'translate(37 32)'}>
      {condition === 'broken' ? (
        <>
          <path d="m-20 5 12-10 5 1-7 5 2 2-10 6Zm18 5 11-10 5 3-7 4 2 2-9 4Z" fill="var(--art-wood)" />
          <path d="m14-4 9-3-4 7Zm-19 17 7-1-3 5Z" fill="var(--art-wood-light)" />
        </>
      ) : (
        <g className="passage-pallet-pose">
          <ellipse cx="2" cy="5" rx="13" ry="18" fill="var(--art-shadow)" />
          <PalletBoards />
        </g>
      )}
    </g>
  )
}

const WALL_HEIGHT = 20
const TILE_SIZE = 64
const COURTYARD_SIZE = TILE_SIZE * 5
const PALLET_BASE_OFFSET = 3
const PALLET_BASE_HEIGHT = 5
const PALLET_SPAN = TILE_SIZE + 1 - PALLET_BASE_OFFSET
const PALLET_LANDING_RISE = WALL_HEIGHT - PALLET_BASE_HEIGHT
const PALLET_LENGTH_RATIO = Math.hypot(PALLET_SPAN, PALLET_LANDING_RISE) / TILE_SIZE
const PALLET_LANDING_ANGLE = Math.atan2(PALLET_LANDING_RISE, PALLET_SPAN)
const points = (...vertices) => vertices.map(vertex => vertex.join(',')).join(' ')

// Equal X and opposite Y offsets project straight up under the courtyard camera.
function raise([x, y], height) {
  return [x + height, y - height]
}

function CourtyardPallet({ condition = 'ready', south = false }) {
  const base = [30, (south ? TILE_SIZE * 4 : 0) + PALLET_BASE_OFFSET]
  const pivot = raise(base, PALLET_BASE_HEIGHT)
  return (
    <g className="courtyard-pallet" data-state={condition} data-edge={south ? 'south' : 'north'}>
      {condition === 'broken' ? (
        <g transform={`translate(${base[0]} ${base[1] + 29})`}>
          <path d="m-15 0 10-14 4 5-6 14Zm13 11 12-8 4 5-13 8Z" fill="var(--art-wood)" />
          <path d="m4-4 11-9-6 13Zm11 19 5-2-2 5Z" fill="var(--art-wood-light)" />
        </g>
      ) : (
        <g className="courtyard-pallet-rig" transform={`translate(${pivot.join(' ')})`}
          style={{ '--pallet-length-ratio': PALLET_LENGTH_RATIO,
            '--pallet-angle': condition === 'dropped' ? `${PALLET_LANDING_ANGLE}rad` : '100deg' }}>
          <g transform="translate(-11 0)">
            <rect className="courtyard-pallet-side" width="1" height={TILE_SIZE} fill="var(--art-wood-dark)" />
          </g>
          <g transform="translate(11 0)">
            <rect className="courtyard-pallet-side" width="1" height={TILE_SIZE} fill="var(--art-wood-light)" />
          </g>
          <g className="courtyard-pallet-planks">
            <path d="M-11 0H11V64H-11Z" fill="var(--art-wood-dark)" />
            <path d="M-10 0h5v64h-5Zm7 0h6v64h-6Zm8 0h5v64H5Z" fill="var(--art-wood)" />
            <path d="M-12 8H12v6h-24ZM-12 49H12v6h-24Z" fill="var(--art-wood-light)" />
            <path d="M-8 11h1m14 0h1M-8 52h1m14 0h1" stroke="var(--art-line)" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </g>
      )}
    </g>
  )
}

export function WallRunArt({ pallets, legacy }) {
  const [north, south] = PALLETS
  if (legacy) {
    return (
      <svg className="wall-run-art" viewBox="0 0 80 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M27 69 44 64 51 254 25 260Z" fill="var(--art-shadow)" />
        <LegacyWallSection from={143} to={181} sill />
        <LegacyWallSection from={67} to={143} />
        <LegacyWallSection from={181} to={255} />
        <LegacyPallet condition={pallets?.[north]} />
        <LegacyPallet condition={pallets?.[south]} south />
      </svg>
    )
  }

  return (
    <svg className="wall-run-art" viewBox={`0 0 ${TILE_SIZE} ${COURTYARD_SIZE}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <StoneWall bounds={[27, 64, 38, 142]} />
      <StoneWall bounds={[27, 142, 38, 178]} height={6} />
      <StoneWall bounds={[27, 178, 38, 256]} />
      <CourtyardPallet condition={pallets?.[north]} />
      <CourtyardPallet condition={pallets?.[south]} south />
    </svg>
  )
}

function WallFace({ from, to, height, fill }) {
  const joints = Math.floor(Math.hypot(to[0] - from[0], to[1] - from[1]) / 25)
  return (
    <>
      <polygon points={points(from, to, raise(to, height), raise(from, height))} fill={fill} />
      {joints > 0 && height > 6 && (
        <polyline points={points(raise(from, height / 2), raise(to, height / 2))}
          fill="none" stroke="var(--art-mortar)" strokeWidth=".9" />
      )}
      {Array.from({ length: joints }, (_, index) => {
        const fraction = (index + 1) / (joints + 1)
        const joint = [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]
        return <polyline key={index} points={points(joint, raise(joint, height))}
          fill="none" stroke="var(--art-mortar)" strokeWidth=".9" />
      })}
    </>
  )
}

function StoneWall({ bounds, height = WALL_HEIGHT }) {
  const [left, top, right, bottom] = bounds
  const nw = [left, top]
  const ne = [right, top]
  const se = [right, bottom]
  const sw = [left, bottom]
  return (
    <g className="courtyard-wall">
      <WallFace from={nw} to={sw} height={height} fill="var(--art-stone-dark)" />
      <WallFace from={sw} to={se} height={height} fill="var(--art-stone)" />
      <polygon points={points(...[nw, ne, se, sw].map(vertex => raise(vertex, height)))}
        fill="var(--art-stone-light)" stroke="var(--art-mortar)" strokeWidth=".85" />
    </g>
  )
}

export function PerimeterArt({ foreground = false }) {
  return (
    <svg className={`perimeter-art ${foreground ? 'perimeter-front' : ''}`}
      viewBox={`0 0 ${COURTYARD_SIZE} ${COURTYARD_SIZE}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {foreground ? (
        <>
          <StoneWall bounds={[-9, 0, 0, 135]} />
          <StoneWall bounds={[-9, 185, 0, 320]} />
          <StoneWall bounds={[-9, 320, 329, 329]} />
        </>
      ) : (
        <>
          <path d="M0 143h-11v34H0m320-34h11v34h-11" fill="var(--art-stone-light)" />
          <StoneWall bounds={[-9, -9, 329, 0]} />
          <StoneWall bounds={[320, 0, 329, 135]} />
          <StoneWall bounds={[320, 185, 329, 320]} />
        </>
      )}
    </svg>
  )
}

export function GateArt({ open, east }) {
  const near = [0, -22]
  const far = [0, 22]
  const height = 30
  const swing = east ? 16 : -16
  const leafEnd = [swing, -17]
  return (
    <svg className="wall-gate-art" viewBox="-32 -32 64 64" aria-hidden="true" focusable="false">
      <polygon points={points([-8, -23], [8, -23], [8, 23], [-8, 23])} fill="var(--art-stone-light)" />
      <polygon points={points(near, far, raise(far, height), raise(near, height))}
        fill={open ? 'var(--art-hatch-well)' : 'var(--art-wood)'} />
      <polyline points={points(near, raise(near, height), raise(far, height), far)}
        fill="none" stroke="var(--art-stone-light)" strokeWidth="4" strokeLinejoin="round" />
      {open ? (
        <>
          <polygon points={points(near, leafEnd, raise(leafEnd, 26), raise(near, 26))}
            fill="var(--art-wood)" stroke="var(--art-wood-dark)" strokeWidth="1.4" />
          <polyline points={points([1, -17], [1, 15])} stroke="var(--art-green)" strokeWidth="2" />
        </>
      ) : (
        <>
          <path d="M8-27v42m8-50V6m7-48V0" stroke="var(--art-wood-dark)" strokeWidth="1.25" />
          <path d="m0 9 27-27M0-11l27-27" stroke="var(--art-wood-light)" strokeWidth="2" />
          <circle cx="15" cy="1" r="2" fill="var(--art-glint)" />
        </>
      )}
    </svg>
  )
}

export function TerrainArt({ type, condition, open }) {
  let object
  switch (type) {
    case 'lamp': {
      const lit = condition === 'repaired'
      object = (
        <g className="lantern-art" data-state={lit ? 'lit' : 'unlit'}>
          {lit && <ellipse cx="41" cy="37" rx="28" ry="22" fill="var(--art-lamp-glow)" />}
          <path d="M25 50 42 44l12 5-17 6Z" fill="var(--art-stone-light)" />
          <path d="m37 55 17-6v5l-17 6-12-5v-5Z" fill="var(--art-stone-dark)" />
          <path d="M39 26v26l5-2V24Z" fill="var(--art-steel-dark)" />
          <path d="M32 22 44 16l10 5v14l-12 6-10-5Z" fill="var(--art-steel-dark)" stroke="var(--art-mortar)" strokeWidth="1.4" />
          <path d="m35 24 7 3v10l-7-3Zm10 3 6-3v9l-6 3Z" fill={lit ? 'var(--art-lamp-lit)' : 'var(--art-window)'} />
          <path d="m31 22 7-9 10-3 8 11-13 6Z" fill="var(--art-steel-light)" />
          {lit && <path d="m29 28-6 1m8 10-5 4m27-3 6 2m-2-14 6-3" stroke="var(--art-lamp-lit)" strokeWidth="1.5" strokeLinecap="round" />}
        </g>
      )
      break
    }
    case 'hatch':
      object = (
        <g className="hatch-art" data-state={open ? 'open' : 'closed'}>
          <path d="M9 39 46 22l25 10-37 20Z" fill="var(--art-stone-light)" />
          <path d="M9 39 34 52l37-20v7L34 60 9 47Z" fill="var(--art-stone-dark)" />
          <path d="M16 39 46 25l18 8-30 16Z" fill="var(--art-hatch-well)" />
          {open ? (
            <>
              <path d="M45 26V8l20 8v16Z" fill="var(--art-wood)" stroke="var(--art-wood-dark)" strokeWidth="2" />
              <path d="M50 12v13m5-11v13m5-11v13" stroke="var(--art-wood-light)" strokeWidth="1.2" />
              <path d="m23 40 18 8m-12-12 18 7m-11-11 18 7" stroke="var(--art-steel-light)" strokeWidth="1.6" />
              <path d="m18 39 27-13m-11 23 29-15" stroke="var(--art-green)" strokeWidth="1.5" />
            </>
          ) : (
            <>
              <path d="M16 39 46 25l18 8-30 16Z" fill="var(--art-wood)" stroke="var(--art-wood-dark)" strokeWidth="1.7" />
              <path d="m22 41 30-14m-24 17 30-14m-22 11 6-3" stroke="var(--art-wood-light)" strokeWidth="1.25" />
              <path d="m36 41 5-3" stroke="var(--art-line)" strokeLinecap="round" strokeWidth="2.6" />
            </>
          )}
        </g>
      )
      break
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
      object = <g transform="translate(42 33) rotate(-50)"><PalletBoards /></g>
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

export function CharacterArt({ role, at, columns, health, replayRound }) {
  const prior = useRef({ at, health, replayRound })
  const motionSequence = useRef(0)
  const [motion, setMotion] = useState(null)
  const [facing, setFacing] = useState(1)
  const killer = role === KILLER

  useLayoutEffect(() => {
    const before = prior.current
    prior.current = { at, health, replayRound }
    const dx = at % columns - before.at % columns
    const dy = Math.floor(at / columns) - Math.floor(before.at / columns)
    if (dx) setFacing(Math.sign(dx))
    const forward = replayRound === null || (before.replayRound !== null && replayRound > before.replayRound)
    const hit = forward && health < before.health
    const distance = Math.abs(dx) + Math.abs(dy)
    if (hit || distance) {
      const name = hit ? (killer ? 'attack' : 'hurt') : distance > 1 && replayRound === null ? 'vault' : 'walk'
      setMotion({ name, sequence: (motionSequence.current += 1) })
    }
  }, [at, columns, health, killer, replayRound])

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
