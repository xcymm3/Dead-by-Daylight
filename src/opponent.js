import {
  HUMAN, KILLER, STUN_TURNS, EXITS, EXIT_APPROACHES, activeRole, actionsFor, adjacent,
  blinkOptions, createGame, isPlacement, movement, nearby, play, project,
} from './game.js'
import { boardFor, CAMPAIGN } from './maps.js'
import { hasSkill, skillIds, validLoadout } from './skills.js'

export function createPracticeGame(player, count, selected, difficulty, seed = Math.floor(Math.random() * 0x100000000)) {
  if (!validLoadout(player, count, selected, true)) throw new RangeError('人机对局技能选择无效')
  const opponent = player === HUMAN ? KILLER : HUMAN
  const ordered = skillIds(opponent, true).map((id, index) => ({ id, score: noise(seed, 0, 2, index) }))
    .sort((a, b) => a.score - b.score)
  return createGame(player, seed, difficulty, { [player]: selected, [opponent]: ordered.slice(0, count).map(({ id }) => id) })
}

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
  const sideStep = recovery?.kind === 'stun' || recovery?.sidestep
  let frontier = [{ at: killer, blink: !sideStep, forced: Boolean(sideStep) }]
  const threatened = new Set()
  const budget = view.rage ? 3 : 2
  for (let step = 0; step < budget; step++) {
    const flashed = frontier.flatMap(entry => {
      if (!entry.blink) return []
      const fromView = { ...view, positions: { [KILLER]: entry.at } }
      return blinkOptions(fromView, KILLER).map(({ land }) => {
        threatened.add(land)
        return { at: land, blink: false, forced: false }
      })
    })
    const next = new Map()
    for (const entry of [...frontier, ...flashed]) {
      const moves = entry.forced ? [entry.at - 1, entry.at + 1]
        : adjacent(entry.at).filter(to => movement(view, KILLER, entry.at, to)?.kind === 'move')
      for (const at of moves) {
        threatened.add(at)
        const blink = entry.blink || entry.forced
        next.set(`${at}:${blink}`, { at, blink, forced: false })
      }
    }
    frontier = [...next.values()]
  }
  return threatened
}

function scoreHuman(view, action, pressure = 1) {
  if (EXITS.includes(action.land)) return 100
  const from = view.positions[HUMAN]
  const next = action.land ?? from
  const repaired = action.kind === 'repair' ? [...view.repaired, from] : view.repaired
  const planningView = {
    ...view,
    count: repaired.length,
    rage: repaired.length >= 3 && hasSkill(view, KILLER, 'frenzy'),
    pallets: action.kind === 'drop' ? { ...view.pallets, [action.to]: 'dropped' } : view.pallets,
    recovery: action.kind === 'drop' && action.to === view.positions[KILLER]
      ? { kind: 'stun', remaining: hasSkill(view, HUMAN, 'strong') ? 5 : STUN_TURNS } : view.recovery,
  }
  const goals = planningView.count >= 3 ? EXITS : boardFor(view.campaignLevel).machines.filter(at => !repaired.includes(at))
  const distance = routes(planningView, HUMAN, next)
  const progress = Math.min(...goals.map(at => distance.get(at) ?? 22))
  const protectedRepair = action.kind === 'repair' && hasSkill(view, HUMAN, 'focus')
  const healsOnRepair = repaired.length === 3 && view.count === 2 && hasSkill(view, HUMAN, 'escape')
  const danger = !protectedRepair && killerThreat(planningView).has(next)
    ? (view.health === 1 && !healsOnRepair ? 10 : 4) * pressure : 0
  const gain = { repair: 9, drop: planningView.recovery !== view.recovery ? 5 : -1, wait: -1.5 }
  return -progress - danger + (gain[action.kind] ?? 0)
}

function scoreKiller(view, action, pressure = 1) {
  if (action.kind === 'wait') return -100
  const next = action.kind === 'break' ? action.to : action.land
  const distance = routes(view, KILLER, next)
  let goals = view.count >= 3 ? EXIT_APPROACHES : boardFor(view.campaignLevel).machines
  const tracked = view.positions[HUMAN]
  if (tracked != null) goals = [tracked]
  else if (view.watcher?.nearby === true) {
    goals = boardFor(view.campaignLevel).playable.filter(at => nearby(view.watcher.at, at))
  } else if (view.watcher?.nearby === false) {
    const outside = goals.filter(at => !nearby(view.watcher.at, at))
    if (outside.length) goals = outside
  }
  const priority = Math.min(...goals.map(at => (distance.get(at) ?? 10) + (view.visits[at] ?? 0) * 1.3))
  const delay = { break: hasSkill(view, KILLER, 'lockdown') ? 0.15 : 1.1, vault: 0.9 }
  const sight = tracked === next && action.kind !== 'break' ? 25 : 0
  return sight - priority * pressure - (view.visits[next] ?? 0) * 1.6 - (delay[action.kind] ?? 0)
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

  if (game.skills) return chooseSkillAction(game, view, role, options)
  const patrol = CAMPAIGN[game.campaignLevel - 1]?.patrol
  if (role === KILLER && view.steps === 1 && patrol !== undefined && noise(game.seed, view.round, 1) >= patrol) {
    return options.find(action => action.kind === 'wait')
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

const tacticalSkills = new Set(['blink', 'watch', 'stealth'])
const patrolActions = new Set(['move', 'vault', 'sidestep', 'break', 'wait', 'repair', 'drop'])

function chooseSkillAction(game, view, role, options) {
  const pressure = { normal: 1, hard: 1.35, hell: 1.65 }[game.difficulty] ?? 1
  const evaluate = role === HUMAN ? scoreHuman : scoreKiller
  const regular = options.filter(action => patrolActions.has(action.kind))
  const tactical = options.filter(action => tacticalSkills.has(action.kind))
  const rank = (state, choices) => choices.reduce((best, action) => {
    const score = evaluate(state, action, pressure) + 0.65 * noise(game.seed, view.round, view.steps, action.to)
    return !best || score > best.score ? { action, score } : best
  }, null)
  const baseline = rank(view, regular)
  if (role === HUMAN) {
    if (EXITS.includes(baseline?.action.land)) return baseline.action
    if (view.count === 2 && regular.some(action => action.kind === 'repair')) {
      const stealth = tactical.find(action => action.kind === 'stealth')
      if (stealth) return stealth
    }
    let best = baseline
    for (const action of tactical.filter(action => action.kind === 'blink')) {
      const moved = play(game, action)
      const followUp = rank(project(moved, HUMAN), actionsFor(moved).filter(option => patrolActions.has(option.kind)))
      if (followUp && (!best || followUp.score - 2 > best.score)) best = { action, score: followUp.score - 2 }
    }
    if (best?.action.kind !== 'blink' && view.health === 1 && view.count >= 2) {
      const stealth = tactical.find(action => action.kind === 'stealth')
      if (stealth) return stealth
    }
    return best?.action
  }

  const watch = tactical.find(action => action.kind === 'watch')
  const at = view.positions[KILLER]
  if (watch && view.positions[HUMAN] == null && (view.count === null || view.count < 3) &&
      boardFor(view.campaignLevel).machines.some(lamp => nearby(at, lamp))) return watch

  let best = baseline
  for (const action of tactical.filter(action => action.kind === 'blink')) {
    // Score legal destinations from the information available to the killer.
    const landing = scoreKiller(view, action, pressure)
    const moved = { ...view, positions: { ...view.positions, [KILLER]: action.land } }
    const after = rank(moved, adjacent(action.land).map(to => movement(moved, KILLER, action.land, to)).filter(Boolean))
    const score = Math.max(landing, after?.score ?? -Infinity) - 1.8
    if (!best || score > best.score) best = { action, score }
  }
  return best?.action
}
