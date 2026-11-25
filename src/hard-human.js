import { HUMAN, KILLER, EXITS, actionsFor, play, skipKillerTurn } from './game.js'
import { chooseOpponentAction, noise } from './opponent.js'
import { hiddenKey, killerTravel, remainingRoute, threatened, visibleKey } from './hard-planning.js'

const ESCAPE_VALUE = 45

function escapeValue(game) {
  if (game.winner) return game.winner === HUMAN ? ESCAPE_VALUE : -55
  const danger = threatened(game).has(game.positions[HUMAN])
  const cooldown = game.recovery?.remaining ?? 0
  const distance = killerTravel(game.pallets)[game.positions[KILLER]][game.positions[HUMAN]]
  const reserve = game.repaired.length < 2 ? 14 : 8
  return -remainingRoute(game) + (game.health === 2 ? reserve : 0)
    - (danger ? (game.health === 1 ? 11 : 6) : 0)
    - Math.max(0, 5 - distance - cooldown * 2) * 1.4 + .5 * cooldown
}

// Compare a full killer turn followed by the human's best response. Two paths
// ending in the same position, health and recovery give the same tactical reply.
function pursuitOutcomes(game) {
  const outcomes = new Map()
  function explore(state) {
    if (state.turn === HUMAN || state.winner) {
      outcomes.set(visibleKey(state), state)
      return
    }
    if (state.recovery?.remaining) explore(skipKillerTurn(state))
    else for (const action of actionsFor(state)) explore(play(state, action))
  }
  explore(game)
  return [...outcomes.values()]
}

function habitualAction(game, observations) {
  const options = actionsFor(game)
  const votes = new Map()
  let best
  let highest = 2
  for (const seen of observations) {
    if (seen.from !== game.positions[KILLER] || seen.steps !== game.steps
      || seen.gates !== (game.repaired.length >= 3)) continue
    const action = options.find(option => option.kind === seen.kind && option.to === seen.to)
    if (!action) continue
    const count = (votes.get(action) ?? 0) + 1
    votes.set(action, count)
    if (count >= highest) {
      highest = count
      best = action
    }
  }
  return best
}

// Plan beyond the next lamp against several plausible patrols. Cache patrol decisions
// by their visible inputs so alternative human routes share the same forecast.
function patrolValue(start, seed, decisions, observations) {
  let frontier = [{ ...start, seed }]
  let best = -Infinity
  for (let depth = 0; depth < 3; depth++) {
    const replies = new Map()
    for (let game of frontier) {
      while (!game.winner && game.turn === KILLER) {
        if (game.recovery?.remaining) game = skipKillerTurn(game)
        else {
          const key = [seed, game.round, visibleKey(game), JSON.stringify(game.visits)].join(':')
          if (!decisions.has(key)) {
            decisions.set(key, (observations && habitualAction(game, observations)) ?? chooseOpponentAction(game))
          }
          game = play(game, decisions.get(key))
        }
      }
      if (game.winner) continue
      for (const action of actionsFor(game)) {
        const next = play(game, action)
        if (next.winner === HUMAN) return 30 - depth
        const key = [hiddenKey(next), visibleKey(next), JSON.stringify(next.visits)].join('/')
        if (!replies.has(key)) replies.set(key, next)
      }
    }
    if (!replies.size) return -40
    const ranked = [...replies.values()].map(game => ({
      game, value: -remainingRoute(game) + (game.health === 2 ? 6 : 0)
        - (threatened(game).has(game.positions[HUMAN]) ? .9 : 0),
    })).sort((a, b) => b.value - a.value)
    best = ranked[0].value
    frontier = ranked.slice(0, 3).map(item => item.game)
  }
  return best
}

export function hardHuman(game) {
  let best
  let highest = -Infinity
  const recent = game.replay.slice(-8)
  const position = { ...game, log: [], replay: [], opponentBelief: undefined }
  const decisions = new Map()
  const options = actionsFor(position)
  const escape = options.find(action => EXITS.includes(action.land))
  if (escape) return escape
  const candidates = options.map(action => ({ action, next: play(position, action) }))
  const safe = candidates.filter(({ next }) => !threatened(next).has(next.positions[HUMAN]))
  const surviving = position.health === 1 && safe.length ? safe : candidates
  for (const { action, next } of surviving) {
    const outcomes = pursuitOutcomes(next)
    const values = outcomes.map(state => {
      if (state.winner) return escapeValue(state)
      return Math.max(...actionsFor(state).map(reply => escapeValue(play(state, reply))))
    })
    if (values.every(value => value === ESCAPE_VALUE)) return action
    const worst = Math.min(...values)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const repeats = recent.filter(frame => frame.positions[HUMAN] === next.positions[HUMAN]
      && frame.count === next.repaired.length && frame.health === next.health).length
    const forecasts = [1049, 3907, 8237].map((seed, i) =>
      patrolValue(next, seed, decisions, i === 0 ? undefined : game.observedPatrol))
    const forecast = forecasts.reduce((sum, value) => sum + value, 0) / forecasts.length
    const score = forecast + .09 * worst + .14 * mean - .58 * remainingRoute(next)
      - repeats * .8 + noise(game.seed, game.round, game.steps, action.to) * .9
      + (action.kind === 'repair' ? .9 : 0)
    if (score > highest) {
      best = action
      highest = score
    }
  }
  return best
}
