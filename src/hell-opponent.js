import { HUMAN, KILLER, actionsFor, isPlacement, play, skipKillerTurn } from './game.js'
import { noise } from './opponent.js'
import { remainingRoute, threatened } from './hard-planning.js'
import { boardFor } from './maps.js'

const maxRewinds = 2
const isMove = action => action?.kind === 'move' || action?.kind === 'vault'

export function hasHellSight(game) {
  if (game.difficulty !== 'hell' || game.player !== HUMAN || game.winner || game.turn !== KILLER ||
      isPlacement(game) || game.recovery?.remaining > 0) return false
  if (game.hellSightRound === game.round) return true
  return noise(game.seed, game.round, 97, 41) < 1 / 3
}

export function sightBelief(game) {
  const target = game.positions[HUMAN]
  const prior = game.opponentBelief ?? []
  const matches = prior.filter(candidate => candidate.positions[HUMAN] === target)
  const candidates = matches.length ? matches : prior
  if (!candidates.length) return [{
    ...game,
    pallets: game.knownPallets,
    repaired: boardFor(game.campaignLevel).machines.slice(0, game.repaired.length),
    beliefWeight: 1,
  }]
  const weight = candidate => candidate.beliefWeight ?? 1
  const total = candidates.reduce((sum, candidate) => sum + weight(candidate), 0)
  return candidates.map(candidate => ({
    ...candidate, positions: { ...candidate.positions, [HUMAN]: target }, beliefWeight: weight(candidate) / total,
  }))
}

function legalMoves(game, forbidden) {
  return actionsFor(game).filter(action => isMove(action) &&
    !forbidden.includes(action.to) && !forbidden.includes(action.land))
}

function bestMove(game, forbidden) {
  let best = null
  for (const action of legalMoves(game, forbidden)) {
    const next = play(game, action)
    const danger = !next.winner && threatened(next).has(next.positions[HUMAN])
    const score = next.winner === HUMAN ? 100 : -remainingRoute(next) - (danger ? 18 : 0)
    if (!best || score > best.score) best = { action, score }
  }
  return best
}

export function hellFollowUpAction(game) {
  const forbidden = game.hellFollowUp
  if (!forbidden) return null
  return bestMove(game, forbidden)?.action ?? actionsFor(game).find(action => action.kind === 'wait')
}

function affectsBoard(before, after) {
  return before.pallets !== after.pallets || before.knownPallets !== after.knownPallets || before.repaired !== after.repaired
}

function reroute(history, actions) {
  const { before, previous } = history
  const forbidden = [before.positions[KILLER]]
  let best = null

  for (const replacement of legalMoves(before, forbidden)) {
    if (replacement.kind === previous.kind && replacement.to === previous.to) continue
    let next = play(before, replacement)
    if (next.winner) continue
    const occupied = [...forbidden]

    for (const action of actions) {
      if (next.turn !== KILLER) break
      const replayed = action ? play(next, action) : skipKillerTurn(next)
      if (replayed === next || replayed.health !== before.health || affectsBoard(before, replayed)) break
      next = replayed
      occupied.push(next.positions[KILLER])
    }

    if (occupied.length !== actions.length + 1) continue
    // If the original hit ended the killer's first step, that player keeps their remaining step.
    const humanTurn = next.turn === HUMAN ? next : { ...next, turn: HUMAN, steps: 0 }
    const followUp = bestMove(humanTurn, occupied)
    if (followUp && (!best || followUp.score > best.score)) best = { next, occupied, score: followUp.score }
  }

  return best
}

export function advanceHellHuman(game, action, next) {
  if (game.turn === HUMAN) {
    const reversible = (isMove(action) || action?.kind === 'wait') && !next.winner &&
      (game.hellRewindUses ?? 0) < maxRewinds && !affectsBoard(game, next)
    return {
      ...next,
      hellFollowUp: undefined,
      hellRewind: reversible ? {
        before: { ...game, hellFollowUp: undefined, hellRewind: undefined },
        previous: action, killerActions: [],
      } : undefined,
    }
  }

  const history = game.hellRewind
  if (!history) return game.hellFollowUp
    ? { ...next, hellFollowUp: [...game.hellFollowUp, next.positions[KILLER]] } : next

  const unchanged = !affectsBoard(history.before, next)
  const actions = [...history.killerActions, action]
  const hit = next.health < game.health
  if (unchanged && hit && next.positions[KILLER] !== game.positions[KILLER]) {
    const alternate = reroute(history, actions)
    if (alternate) return {
      ...alternate.next,
      observedPatrol: next.observedPatrol,
      hellRewindUses: (game.hellRewindUses ?? 0) + 1,
      hellFollowUp: alternate.occupied,
    }
  }
  return { ...next, hellRewind: unchanged && next.turn === KILLER && !next.winner
    ? { ...history, killerActions: actions } : undefined }
}
