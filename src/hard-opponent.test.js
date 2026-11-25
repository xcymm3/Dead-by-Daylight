import assert from 'node:assert/strict'
import test from 'node:test'
import { HUMAN, KILLER, actionsFor, createGame, play } from './game.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'
import { chooseOpponentAction } from './opponent.js'

test('normal difficulty keeps the original opponent strategy', () => {
  const game = createGame(HUMAN, 34)
  assert.equal(game.difficulty, 'normal')
  assert.deepEqual(chooseMatchOpponentAction(game), chooseOpponentAction(game))
})

test('hard killer decisions agree when its observations agree', () => {
  const start = applyMatchAction(createGame(HUMAN, 34, 'hard'), { kind: 'spawn', to: 6 })
  const left = applyMatchAction(start, { kind: 'spawn', to: 8 })
  const right = applyMatchAction(start, { kind: 'spawn', to: 13 })
  assert.notEqual(left.positions[HUMAN], right.positions[HUMAN])
  assert.deepEqual(left.opponentBelief, right.opponentBelief)
  assert.deepEqual(chooseMatchOpponentAction(left), chooseMatchOpponentAction(right))
  const after = applyMatchAction(left, { kind: 'move', to: 7 })
  assert.ok(after.opponentBelief.every(candidate => candidate.positions[HUMAN] !== 7))
})

test('hard killer takes a visible-information guaranteed hit', () => {
  const game = { ...createGame(HUMAN, 7, 'hard'), round: 12,
    health: 1, positions: { killer: 6, human: 7 } }
  const action = chooseMatchOpponentAction({ ...game, opponentBelief: [game] })
  assert.deepEqual(action, { kind: 'move', to: 7, land: 7 })
  assert.equal(applyMatchAction(game, action).winner, KILLER)
})

test('hard human takes an available wall gate immediately', () => {
  const game = { ...createGame(KILLER, 7, 'hard'), round: 12, turn: HUMAN,
    repaired: [5, 9, 25], positions: { killer: 16, human: 15 } }
  const action = chooseMatchOpponentAction(game)
  assert.equal(action.to, 2)
  assert.equal(applyMatchAction(game, action).winner, HUMAN)
})

test('a wounded hard human avoids a two-step kill when it can move to safety', () => {
  const game = { ...createGame(KILLER, 21, 'hard'), round: 11, turn: HUMAN,
    positions: { killer: 6, human: 13 }, health: 1, repaired: [5, 29] }
  function canKill(state) {
    if (state.winner || state.turn !== KILLER) return state.winner === KILLER
    return actionsFor(state).some(action => canKill(play(state, action)))
  }
  assert.ok(canKill(play(game, { kind: 'move', to: 8 })))
  assert.equal(canKill(play(game, chooseMatchOpponentAction(game))), false)
})

test('hard human changes gates against a killer camping the west approach', () => {
  let game = { ...createGame(KILLER, 7, 'hard'), round: 12, health: 1,
    repaired: [5, 9, 25], positions: { killer: 15, human: 10 } }
  while (!game.winner && game.round < 35) {
    const action = game.turn === KILLER ? { kind: 'wait' } : chooseMatchOpponentAction(game)
    game = applyMatchAction(game, action)
  }
  assert.equal(game.winner, HUMAN)
  assert.equal(game.escapedThrough, 32)
})

test('hard killer uses the relative likelihood of two otherwise indistinguishable targets', () => {
  const game = { ...createGame(HUMAN, 31, 'hard'), round: 10, steps: 1, health: 1,
    positions: { killer: 11, human: 6 } }
  for (const likely of [6, 16]) {
    const opponentBelief = [6, 16].map(human => ({ ...game, positions: { killer: 11, human },
      beliefWeight: human === likely ? .95 : .05 }))
    assert.equal(chooseMatchOpponentAction({ ...game, opponentBelief }).to, likely)
  }
})

test('hidden pallet drops and waits give the killer the same normalized belief', () => {
  let game = applyMatchAction(createGame(HUMAN, 17, 'hard'), { kind: 'spawn', to: 15 })
  game = applyMatchAction(game, { kind: 'spawn', to: 6 })
  game = applyMatchAction(game, { kind: 'wait' })
  const dropped = applyMatchAction(game, { kind: 'drop', to: 7 })
  const waited = applyMatchAction(game, { kind: 'wait' })
  assert.deepEqual(dropped.opponentBelief, waited.opponentBelief)
  assert.deepEqual(chooseMatchOpponentAction(dropped), chooseMatchOpponentAction(waited))
  const belief = dropped.opponentBelief
  assert.ok(belief.some(state => state.pallets[7] === 'dropped'))
  assert.ok(belief.some(state => !state.pallets[7]))
  assert.ok(belief.every(state => state.beliefWeight > 0))
  assert.ok(Math.abs(belief.reduce((sum, state) => sum + state.beliefWeight, 0) - 1) < 1e-10)
})
