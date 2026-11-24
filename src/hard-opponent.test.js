import assert from 'node:assert/strict'
import test from 'node:test'
import { HUMAN, KILLER, createGame } from './game.js'
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
