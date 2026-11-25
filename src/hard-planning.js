import { HUMAN, KILLER, EXITS, adjacent, movement, project } from './game.js'
import { boardFor } from './maps.js'
import { killerThreat } from './opponent.js'

const threatTables = new Map()
const routeTables = new Map()
const lampMask = game => boardFor(game.campaignLevel).machines.reduce((mask, at, i) =>
  mask | (game.repaired.includes(at) ? 1 << i : 0), 0)
export const palletKey = (pallets, level) =>
  [level ?? 0, ...boardFor(level).pallets.map(at => pallets[at] ?? '')].join(',')

export function visibleKey(game) {
  const view = project(game, KILLER)
  const { recovery } = view
  return [view.positions[KILLER], view.health, view.count, view.turn, view.steps, view.winner,
    palletKey(view.pallets, game.campaignLevel), recovery?.kind, recovery?.remaining, recovery?.to].join('/')
}

export function hiddenKey(game) {
  return [game.positions[HUMAN], lampMask(game), palletKey(game.pallets, game.campaignLevel)].join('/')
}

export function remainingRoute(game) {
  const key = palletKey(game.pallets, game.campaignLevel)
  if (!routeTables.has(key)) {
    const { machines, playable } = boardFor(game.campaignLevel)
    const incoming = Array.from({ length: 35 * 16 }, () => [])
    const distances = new Int8Array(incoming.length).fill(60)
    const queue = []
    for (let mask = 0; mask < 16; mask++) {
      const count = machines.filter((_, index) => mask & (1 << index)).length
      const view = { count, campaignLevel: game.campaignLevel, positions: { [KILLER]: null }, pallets: game.pallets }
      if (count >= 3) {
        for (const exit of EXITS) {
          const id = exit * 16 + mask
          distances[id] = 0
          queue.push(id)
        }
      }
      for (const from of playable) {
        const id = from * 16 + mask
        for (const to of adjacent(from)) {
          const action = movement(view, HUMAN, from, to)
          if (action) incoming[action.land * 16 + mask].push(id)
        }
        const lamp = machines.indexOf(from)
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
  return routeTables.get(key)[game.positions[HUMAN] * 16 + lampMask(game)]
}

// The human knows the real boards. A killer prediction calls this only on a hypothesis.
export function threatened(game) {
  const { recovery } = game
  const key = [palletKey(game.pallets, game.campaignLevel), game.positions[KILLER], recovery?.kind,
    recovery?.remaining, recovery?.to].join('/')
  if (!threatTables.has(key)) threatTables.set(key, killerThreat(project(game, HUMAN)))
  return threatTables.get(key)
}

const travelTables = new Map()

export function killerTravel(pallets, level) {
  const key = palletKey(pallets, level)
  if (travelTables.has(key)) return travelTables.get(key)
  const distances = Array.from({ length: 35 }, () => new Float32Array(35).fill(40))
  const view = { positions: {}, pallets, count: 0, campaignLevel: level }
  const { playable } = boardFor(level)
  for (const from of playable) {
    distances[from][from] = 0
    for (const to of adjacent(from)) {
      const step = movement(view, KILLER, from, to)
      if (!step) continue
      if (step.kind === 'break') distances[from][to] = 4
      else distances[from][step.land] = step.kind === 'vault' ? 3 : 1
    }
  }
  for (const via of playable) for (const from of playable) for (const to of playable) {
    distances[from][to] = Math.min(distances[from][to], distances[from][via] + distances[via][to])
  }
  travelTables.set(key, distances)
  return distances
}
