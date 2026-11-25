import {
  HUMAN, KILLER, STUN_TURNS, EXITS, EXIT_APPROACHES, MACHINES, activeRole, actionsFor, adjacent,
  isPlacement, movement, project,
} from './game.js'

function routes(view, role, start) {
  const distance = new Map([[start, 0]])
  const queue = [start]
  for (const from of queue) {
    for (const to of adjacent(from)) {
      const action = movement(view, role, from, to)
      if (!action || distance.has(action.land)) continue
      distance.set(action.land, distance.get(from) + 1)
      queue.push(action.land)
    }
  }
  return distance
}

export function killerThreat(view) {
  const recovery = view.recovery
  if (recovery?.remaining > 0) {
    return new Set(recovery.kind === 'vault' ? [recovery.to] : [])
  }

  const killer = view.positions[KILLER]
  const options = recovery?.kind === 'stun'
    ? [killer - 1, killer + 1]
    : adjacent(killer).filter(to => movement(view, KILLER, killer, to)?.kind === 'move')
  const threatened = new Set(options)
  for (const from of options) {
    for (const to of adjacent(from)) {
      if (movement(view, KILLER, from, to)?.kind === 'move') threatened.add(to)
    }
  }
  return threatened
}

function scoreHuman(view, action) {
  if (EXITS.includes(action.land)) return 100
  const from = view.positions[HUMAN]
  const next = action.land ?? from
  const repaired = action.kind === 'repair' ? [...view.repaired, from] : view.repaired
  const planningView = {
    ...view,
    count: repaired.length,
    pallets: action.kind === 'drop' ? { ...view.pallets, [action.to]: 'dropped' } : view.pallets,
    recovery: action.kind === 'drop' && action.to === view.positions[KILLER]
      ? { kind: 'stun', remaining: STUN_TURNS } : view.recovery,
  }
  const goals = planningView.count >= 3 ? EXITS : MACHINES.filter(at => !repaired.includes(at))
  const distance = routes(planningView, HUMAN, next)
  const progress = Math.min(...goals.map(at => distance.get(at) ?? 22))
  const danger = killerThreat(planningView).has(next) ? (view.health === 1 ? 10 : 4) : 0
  const gain = { repair: 9, drop: planningView.recovery !== view.recovery ? 5 : -1, wait: -1.5 }
  return -progress - danger + (gain[action.kind] ?? 0)
}

function scoreKiller(view, action) {
  if (action.kind === 'wait') return -100
  const next = action.kind === 'break' ? action.to : action.land
  const distance = routes(view, KILLER, next)
  const goals = view.count >= 3 ? EXIT_APPROACHES : MACHINES
  const priority = Math.min(...goals.map(at => (distance.get(at) ?? 10) + (view.visits[at] ?? 0) * 1.3))
  const delay = { break: 1.1, vault: 0.9 }
  return -priority - (view.visits[next] ?? 0) * 1.6 - (delay[action.kind] ?? 0)
}

export function noise(seed, round, steps, to = 0) {
  const value = Math.imul(seed ^ Math.imul(round + 1, 105019) ^ Math.imul(steps + to * 11, 7927), 2654435761)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

export function chooseOpponentAction(game) {
  const role = activeRole(game)
  const view = project(game, role)
  const options = actionsFor(game)
  if (isPlacement(game)) {
    const killer = view.positions[KILLER]
    const distance = role === HUMAN ? routes(view, HUMAN, killer) : null
    return options.reduce((best, action) => {
      const score = option => (distance?.get(option.to) ?? 0) * 0.5 + noise(game.seed, 0, 0, option.to) * 2
      return best && score(best) >= score(action) ? best : action
    }, null)
  }

  const evaluate = role === HUMAN ? scoreHuman : scoreKiller
  let best = null
  let highest = -Infinity
  for (const action of options) {
    const score = evaluate(view, action) + 0.65 * noise(game.seed, view.round, view.steps, action.to)
    if (score > highest) {
      best = action
      highest = score
    }
  }
  return best
}
