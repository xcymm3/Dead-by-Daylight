import { HUMAN, KILLER, EXITS, GATE_LAYOUT, terrain } from './game.js'
import { CAMPAIGN } from './maps.js'

const STORAGE_KEY = 'grid-operations:last-replay'

function isComplete(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return false
  const winner = frames.at(-1)?.winner
  return winner === HUMAN || winner === KILLER
}

export function loadLastReplay(storage) {
  try {
    const frames = JSON.parse((storage ?? globalThis.localStorage).getItem(STORAGE_KEY))
    if (isComplete(frames) && frames.every((frame, index) => frame?.round === index
      && frame.campaignLevel === frames[0].campaignLevel
      && (frame.campaignLevel === undefined || (Number.isInteger(frame.campaignLevel) && CAMPAIGN[frame.campaignLevel - 1]))
      && (terrain(frame.positions?.[HUMAN], frame.campaignLevel) || (frame.layout === GATE_LAYOUT && frame.winner === HUMAN
        && frame.positions?.[HUMAN] === null && EXITS.includes(frame.escapedThrough)))
      && terrain(frame.positions?.[KILLER], frame.campaignLevel)
      && frame.pallets && typeof frame.pallets === 'object'
      && Array.isArray(frame.repaired) && frame.count === frame.repaired.length
      && [0, 1, 2].includes(frame.health)
      && (index === frames.length - 1 || frame.winner === null))) return frames
  } catch {
    // The browser may block storage or have an unreadable record.
  }
  return null
}

export function saveLastReplay(frames, storage) {
  if (!isComplete(frames)) return
  try {
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(frames))
  } catch {
    // The just-finished replay remains available in the current session.
  }
}
