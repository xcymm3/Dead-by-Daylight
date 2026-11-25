import { HUMAN, KILLER, MACHINES, EXITS, PALLETS, adjacent, movement, project, terrain } from './game.js'
import { killerThreat } from './opponent.js'

export const PLAYABLE = Array.from({ length: 25 }, (_, i) => i + 5)
  .filter(at => ['empty', 'machine', 'pallet'].includes(terrain(at)))
const threatTables = new Map()
const routeTables = new Map()
const lampMask = lamps => MACHINES.reduce((mask, at, i) => mask | (lamps.includes(at) ? 1 << i : 0), 0)
export const palletKey = pallets => PALLETS.map(at => pallets[at] ?? '').join(',')

export function visibleKey(game) {
  const view = project(game, KILLER)
  const { recovery } = view
  return [view.positions[KILLER], view.health, view.count, view.turn, view.steps, view.winner,
    palletKey(view.pallets), recovery?.kind, recovery?.remaining, recovery?.to].join('/')
}

export function hiddenKey(game) {
  return [game.positions[HUMAN], lampMask(game.repaired), palletKey(game.pallets)].join('/')
}

export function remainingRoute(game) {
  const key = palletKey(game.pallets)
  if (!routeTables.has(key)) {
    const incoming = Array.from({ length: 35 * 16 }, () => [])
    const distances = new Int8Array(incoming.length).fill(60)
    const queue = []
    for (let mask = 0; mask < 16; mask++) {
      const count = MACHINES.filter((_, index) => mask & (1 << index)).length
      const view = { count, positions: { [KILLER]: null }, pallets: game.pallets }
      if (count >= 3) {
        for (const exit of EXITS) {
          const id = exit * 16 + mask
          distances[id] = 0
          queue.push(id)
        }
      }
      for (const from of PLAYABLE) {
        const id = from * 16 + mask
        for (const to of adjacent(from)) {
          const action = movement(view, HUMAN, from, to)
          if (action) incoming[action.land * 16 + mask].push(id)
        }
        const lamp = MACHINES.indexOf(from)
        if (lamp !== -1 && !(mask & (1 << lamp))) incoming[from * 16 + (mask | (1 << lamp))].push(id)
      }
    }
    for (const id of queue) for (const from of incoming[id]) {
      if (distances[from] !== 60) continue
      distances[from] = distances[id] + 1
      queue.push(from)
    }
    routeTables.set(key, distances)
  }
  return routeTables.get(key)[game.positions[HUMAN] * 16 + lampMask(game.repaired)]
}

// The human knows the real boards. A killer prediction calls this only on a hypothesis.
export function threatened(game) {
  const { recovery } = game
  const key = [palletKey(game.pallets), game.positions[KILLER], recovery?.kind,
    recovery?.remaining, recovery?.to].join('/')
  if (!threatTables.has(key)) threatTables.set(key, killerThreat(project(game, HUMAN)))
  return threatTables.get(key)
}

const travelTables = new Map()

export function killerTravel(pallets) {
  const key = palletKey(pallets)
  if (travelTables.has(key)) return travelTables.get(key)
  const distances = Array.from({ length: 35 }, () => new Float32Array(35).fill(40))
  const view = { positions: {}, pallets, count: 0 }
  for (const from of PLAYABLE) {
    distances[from][from] = 0
    for (const to of adjacent(from)) {
      const step = movement(view, KILLER, from, to)
      if (!step) continue
      if (step.kind === 'break') distances[from][to] = 4
      else distances[from][step.land] = step.kind === 'vault' ? 3 : 1
    }
  }
  for (const via of PLAYABLE) for (const from of PLAYABLE) for (const to of PLAYABLE) {
    distances[from][to] = Math.min(distances[from][to], distances[from][via] + distances[via][to])
  }
  travelTables.set(key, distances)
  return distances
}
