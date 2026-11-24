import {
  HUMAN, KILLER, MACHINES, EXITS, PALLETS, activeRole, actionsFor, adjacent,
  isPlacement, movement, play, project, skipKillerTurn, terrain,
} from './game.js'
import { chooseOpponentAction } from './opponent.js'

const PLAYABLE = Array.from({ length: 25 }, (_, i) => i + 5)
  .filter(at => ['empty', 'machine', 'pallet'].includes(terrain(at)))
const PATROL_SAMPLES = [1049, 2081, 3907, 6067, 8237]
const routeTables = new Map()
const lampMask = lamps => MACHINES.reduce((mask, at, i) => mask | (lamps.includes(at) ? 1 << i : 0), 0)
const palletKey = pallets => PALLETS.map(at => pallets[at] ?? '').join(',')
const simulate = (game, action) => action ? play(game, action) : skipKillerTurn(game)
const compact = game => ({ ...game, log: [], replay: [], visits: {}, opponentBelief: undefined })

function visibleKey(game) {
  const view = project(game, KILLER)
  const { recovery } = view
  return [view.positions[KILLER], view.health, view.count, view.turn, view.steps, view.winner,
    palletKey(view.pallets), recovery?.kind, recovery?.remaining, recovery?.to].join('/')
}

function hiddenKey(game) {
  return [game.positions[HUMAN], lampMask(game.repaired), palletKey(game.pallets)].join('/')
}

export function applyMatchAction(game, action) {
  const next = simulate(game, action)
  if (next === game || next.winner || game.difficulty !== 'hard' || game.player !== HUMAN) return next
  const role = activeRole(game)
  const wanted = visibleKey(next)
  const candidates = new Map()
  const add = candidate => {
    if (visibleKey(candidate) === wanted) candidates.set(hiddenKey(candidate), compact(candidate))
  }
  if (isPlacement(game) && role === HUMAN) {
    for (const spawn of actionsFor(game)) add(play(game, spawn))
  } else {
    for (const candidate of game.opponentBelief ?? []) {
      if (role === KILLER) add(simulate(candidate, action))
      else for (const reply of actionsFor(candidate)) add(play(candidate, reply))
    }
  }
  return { ...next, opponentBelief: [...candidates.values()] }
}

function remainingRoute(game) {
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

function forecastHit(game, seed) {
  let state = { ...game, seed }
  if (state.recovery?.remaining) state = skipKillerTurn(state)
  else while (!state.winner && state.turn === KILLER) state = play(state, chooseOpponentAction(state))
  return state.health < game.health ? 1 : 0
}

function canForceNextEscape(game) {
  if (game.winner) return game.winner === HUMAN
  if (game.turn === HUMAN) return actionsFor(game).some(action => EXITS.includes(action.to))
  if (game.recovery?.remaining) return canForceNextEscape(skipKillerTurn(game))
  return actionsFor(game).every(action => canForceNextEscape(play(game, action)))
}

function hardHuman(game) {
  let best
  let highest = -Infinity
  for (const action of actionsFor(game)) {
    const next = play(game, action)
    if (next.winner === HUMAN) return action
    if (next.repaired.length >= 3 && remainingRoute(next) === 1 && canForceNextEscape(next)) return action
    const risk = PATROL_SAMPLES.reduce((sum, seed) => sum + forecastHit(next, seed), 0) / PATROL_SAMPLES.length
    const repeated = game.replay.slice(-8).filter(frame =>
      frame.positions[HUMAN] === next.positions[HUMAN] && frame.positions[KILLER] === next.positions[KILLER]
      && frame.count === next.repaired.length && frame.health === next.health).length
    const score = -remainingRoute(next) - risk * (game.health === 1 ? 15 : 8) - repeated * .55
      + (action.kind === 'repair' ? 1 : 0) + (action.kind === 'drop' && next.recovery?.kind === 'stun' ? 2 : 0)
    if (score > highest) {
      best = action
      highest = score
    }
  }
  return best
}

function postActionGroups(states, action) {
  const outcomes = new Map()
  for (const state of states) {
    const after = simulate(state, action)
    const replies = !after.winner && after.turn === HUMAN
      ? actionsFor(after).map(reply => play(after, reply)) : [after]
    for (const reply of replies) {
      if (reply.winner === HUMAN) return null
      if (reply.winner === KILLER) continue
      const visible = visibleKey(reply)
      if (!outcomes.has(visible)) outcomes.set(visible, new Map())
      const group = outcomes.get(visible)
      group.set(hiddenKey(reply), compact(reply))
    }
  }
  return [...outcomes.values()].map(group => [...group.values()])
}

function forcedKillerAction(states, options) {
  let budget = 1100
  function forcesWin(belief, action, remaining) {
    budget -= belief.length
    if (budget < 0) return false
    const outcomes = postActionGroups(belief, action)
    if (!outcomes) return false
    if (outcomes.length === 0) return true
    if (remaining === 1) return false
    return outcomes.every(group => {
      const moves = group[0].recovery?.remaining ? [null] : actionsFor(group[0])
      return moves.some(move => forcesWin(group, move, remaining - 1))
    })
  }
  for (let depth = 1; depth <= 5 && budget > 0; depth++) {
    const win = options.find(action => forcesWin(states, action, depth))
    if (win) return win
  }
  return null
}

function hitCoverage(states, action) {
  const after = states.map(state => play(state, action))
  const hits = after.filter((state, i) => state.health < states[i].health).length
  const next = after.filter(state => !state.winner && state.turn === KILLER)
  const followUp = next.length ? Math.max(...actionsFor(next[0]).map(move =>
    next.filter(state => play(state, move).health < state.health).length), 0) : 0
  return (hits + followUp * .8) / states.length
}

export function chooseMatchOpponentAction(game) {
  if (game.difficulty !== 'hard') return chooseOpponentAction(game)
  if (activeRole(game) === HUMAN) return hardHuman(game)
  const patrol = chooseOpponentAction(game)
  const belief = game.opponentBelief
  if (!belief?.length || !patrol) return patrol
  const options = actionsFor(game)
  const proved = forcedKillerAction(belief, options)
  if (proved) return proved

  const baseline = hitCoverage(belief, patrol)
  let best = patrol
  let value = baseline + .22
  for (const move of options) {
    const coverage = hitCoverage(belief, move)
    if (coverage > value) {
      best = move
      value = coverage
    }
  }
  return best
}
