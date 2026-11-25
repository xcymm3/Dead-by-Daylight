import {
  HUMAN, KILLER, EXIT_APPROACHES, activeRole, actionsFor, isPlacement,
  play, project, skipKillerTurn, turnOptions,
} from './game.js'
import { chooseOpponentAction, noise } from './opponent.js'
import { hardHuman } from './hard-human.js'
import {
  hiddenKey, killerTravel, palletKey, remainingRoute, threatened, visibleKey,
} from './hard-planning.js'
import { boardFor, CAMPAIGN } from './maps.js'

const simulate = (game, action) => action ? play(game, action) : skipKillerTurn(game)
const compact = game => ({ ...game, log: [], replay: [], visits: {}, opponentBelief: undefined })

export function applyMatchAction(game, action) {
  const next = simulate(game, action)
  if (next === game || next.winner || game.difficulty !== 'hard') return next
  const role = activeRole(game)
  if (game.player === KILLER) {
    if (!action || role !== KILLER || isPlacement(game)) return next
    const observed = { from: game.positions[KILLER], steps: game.steps, gates: game.repaired.length >= 3,
      kind: action.kind, to: action.to }
    return { ...next, observedPatrol: [...(game.observedPatrol ?? []).slice(-47), observed] }
  }
  const wanted = visibleKey(next)
  const candidates = new Map()
  let total = 0
  const add = (candidate, weight) => {
    if (candidate.winner || visibleKey(candidate) !== wanted) return
    const key = hiddenKey(candidate)
    const prior = candidates.get(key)
    if (prior) prior.beliefWeight += weight
    else candidates.set(key, { ...compact(candidate), beliefWeight: weight })
    total += weight
  }
  if (isPlacement(game) && role === HUMAN) {
    for (const spawn of actionsFor(game)) {
      const candidate = play(game, spawn)
      add(candidate, threatened(candidate).has(spawn.to) ? 1 : 4)
    }
  } else {
    for (const candidate of game.opponentBelief ?? []) {
      const weight = candidate.beliefWeight ?? 1
      if (role === KILLER) add(simulate(candidate, action), weight)
      else {
        for (const { next, probability } of humanPredictions(candidate)) {
          add(next, weight * probability)
        }
      }
    }
  }
  const belief = [...candidates.values()]
  // A player may change tactics mid-match. Give every still-legal hypothesis a small floor.
  for (const candidate of belief) {
    candidate.beliefWeight = .995 * candidate.beliefWeight / total + .005 / belief.length
  }
  return { ...next, opponentBelief: belief }
}

function humanPredictions(game) {
  const before = remainingRoute(game)
  const replies = actionsFor(game).map(action => {
    const next = play(game, action)
    const progress = next.winner ? 2 : before - remainingRoute(next)
    let score = 1.4 * progress
    if (next.winner) score += 4
    else if (threatened(next).has(next.positions[HUMAN])) score -= next.health === 1 ? 3 : 1
    if (action.kind === 'repair') score += .8
    if (action.kind === 'drop' && action.to === game.positions[KILLER]) score += 2
    return { next, weight: Math.exp(score) }
  })
  const total = replies.reduce((sum, reply) => sum + reply.weight, 0)
  // Keep cautious, stationary and deliberately misleading humans in the belief too.
  return replies.map(({ next, weight }) => ({
    next, probability: .85 * weight / total + .15 / replies.length,
  }))
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

function pursuitMaps(belief, level) {
  const groups = new Map()
  for (const candidate of belief) {
    const key = palletKey(candidate.pallets, level)
    if (!groups.has(key)) groups.set(key, {
      pallets: candidate.pallets, current: new Float64Array(35),
      future: new Float64Array(35), pressure: new Float64Array(35), mass: 0,
    })
    const group = groups.get(key)
    const weight = candidate.beliefWeight ?? 1 / belief.length
    const h = candidate.positions[HUMAN]
    group.mass += weight
    // With the gates open, a wounded human on an approach can leave this turn.
    const atOpenGate = candidate.repaired.length >= 3 && EXIT_APPROACHES.includes(h)
    group.current[h] += weight * (atOpenGate && candidate.health === 1 ? 6 : 1)
    const humanTurn = { ...candidate, turn: HUMAN, steps: 0 }
    for (const { next, probability } of humanPredictions(humanTurn)) {
      const at = next.positions[HUMAN] ?? h
      group.future[at] += weight * probability
    }
  }
  for (const group of groups.values()) {
    const distance = killerTravel(group.pallets, level)
    const { playable } = boardFor(level)
    for (const k of playable) for (const h of playable) {
      group.pressure[k] += group.future[h] / (1 + distance[k][h])
    }
  }
  return [...groups.values()]
}

function intercept(game, belief, options) {
  const view = project(game, KILLER)
  const from = view.positions[KILLER]
  const maps = pursuitMaps(belief, game.campaignLevel)
  function scorePath(first, second) {
    let score = 0
    for (const map of maps) {
      let at = from
      let hits = 0
      for (const step of [first, second]) {
        if (!step || step.kind === 'wait') break
        if (map.pallets[step.to] === 'dropped') {
          score -= .28 * map.mass
          break
        }
        if (step.kind === 'vault') {
          score += map.future[step.land] * 3 - .32 * map.mass
          at = step.land
          break
        }
        at = step.land
        hits += map.current[at]
      }
      score += hits * (view.health === 1 ? 14 : 10) + map.pressure[at] * 7
      score += map.future[at] * 2
    }
    return score
  }
  let best
  let highest = -Infinity
  for (const action of options) {
    let score = scorePath(action)
    if (view.steps === 2 && ['move', 'sidestep'].includes(action.kind)) {
      const nextView = { ...view, positions: { [KILLER]: action.land }, recovery: null }
      for (const second of turnOptions(nextView, KILLER)) {
        score = Math.max(score, scorePath(action, second))
      }
    }
    const visits = view.visits[action.land ?? from] ?? 0
    score += .65 * noise(game.seed, view.round, view.steps, action.to)
      - .28 * Math.log1p(visits) - (action.kind === 'wait' ? .55 : 0)
    if (score > highest) {
      best = action
      highest = score
    }
  }
  return best
}

export function chooseMatchOpponentAction(game) {
  if (game.difficulty !== 'hard') return chooseOpponentAction(game)
  if (activeRole(game) === HUMAN) return hardHuman(game)
  const tracking = CAMPAIGN[game.campaignLevel - 1]?.tracking ?? 1
  if (tracking < 1 && noise(game.seed, game.round, 0, 41) >= tracking) return chooseOpponentAction(game)
  const belief = game.opponentBelief
  if (!belief?.length) return chooseOpponentAction(game)
  const options = actionsFor(game)
  if (!options.length) return null
  if (belief.length <= 16) {
    const proved = forcedKillerAction(belief, options)
    if (proved) return proved
  }
  return intercept(game, belief, options)
}
