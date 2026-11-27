import assert from 'node:assert/strict'
import test from 'node:test'
import { HUMAN, KILLER, actionsFor, createGame, play, project, visibleLog } from './game.js'
import { hasHellSight } from './hell-opponent.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'

const attack = to => ({ kind: 'move', to })
const move = attack
const setup = ({ player = KILLER, human = 11, killer = 5, turn = HUMAN, seed = 17, ...rest } = {}) => ({
  ...createGame(player, seed, 'hell'), positions: { [HUMAN]: human, [KILLER]: killer },
  turn, round: 4, steps: turn === KILLER ? 2 : 0, ...rest,
})

test('Hell killer rolls sight once per actionable turn and can see the human more than twice', () => {
  const state = setup({ player: HUMAN, turn: KILLER, human: 6 })
  const seeds = Array.from({ length: 3000 }, (_, seed) => seed)
  const visible = seeds.filter(seed => hasHellSight({ ...state, seed }))
  assert.ok(visible.length > 850 && visible.length < 1150, 'the deterministic rolls are near one third')
  const game = { ...state, seed: visible[0] }
  assert.deepEqual(chooseMatchOpponentAction(game), actionsFor(game).find(action => action.to === 6))
  const hit = applyMatchAction(game, attack(6))
  assert.equal(hit.hellSightRound, state.round)
  const sameRound = { ...game, hellSightRound: game.round }
  assert.equal(hasHellSight(sameRound), true)
  const rolls = Array.from({ length: 20 }, (_, offset) => ({ ...sameRound, round: 5 + offset }))
  const successes = rolls.filter(hasHellSight)
  assert.ok(successes.length > 2)
  assert.ok(successes.length < rolls.length)
  for (const round of successes) assert.equal(applyMatchAction(round, attack(6)).hellSightRound, round.round)
  assert.equal(hasHellSight({ ...game, player: KILLER }), false)
  assert.equal(hasHellSight({ ...game, difficulty: 'hard' }), false)
  assert.equal(hasHellSight({ ...game, recovery: { kind: 'hit', remaining: 1 } }), false)
  assert.equal(hasHellSight(createGame(HUMAN, game.seed, 'hell')), false)
  assert.ok(!Object.hasOwn(project(hit, HUMAN), 'hellSightRound'))
  assert.doesNotMatch(JSON.stringify(visibleLog(hit, HUMAN)), /地狱|视野/)
})

test('Hell human keeps the killer’s second step after rerouting a first-step hit', () => {
  const base = setup({ health: 1 })
  const original = applyMatchAction(base, move(6))
  const unchanged = play(original, attack(6))
  assert.equal(unchanged.winner, KILLER)
  const revised = applyMatchAction(original, attack(6))

  assert.equal(revised.positions[KILLER], 6)
  assert.notEqual(revised.positions[HUMAN], 6)
  assert.equal(revised.health, 1)
  assert.equal(revised.winner, null)
  assert.equal(revised.turn, KILLER)
  assert.equal(revised.steps, 1)
  assert.equal(revised.hellRewindUses, 1)
  assert.equal(revised.replay.at(-1).positions[HUMAN], revised.positions[HUMAN])
  assert.doesNotMatch(JSON.stringify(revised.log), /命中|反悔|回退/)
  const end = applyMatchAction(revised, { kind: 'wait' })
  const follow = chooseMatchOpponentAction(end)
  assert.ok(['move', 'vault'].includes(follow.kind))
  assert.ok(![5, 6].includes(follow.land))
  const after = applyMatchAction(end, follow)
  assert.equal(after.replay.at(-1).positions[HUMAN], after.positions[HUMAN])
  assert.equal(after.hellFollowUp, undefined)
  assert.doesNotMatch(JSON.stringify(after.replay), /hell|反悔|回退/)
})

test('Hell human replays both real killer moves and stops at two rewinds', () => {
  const base = setup({ human: 16, hellRewindUses: 1 })
  function run(game) {
    return applyMatchAction(applyMatchAction(applyMatchAction(game, move(11)), attack(6)), attack(11))
  }
  const revised = run(base)
  assert.equal(revised.hellRewindUses, 2)
  assert.equal(revised.health, 2)
  assert.equal(revised.turn, HUMAN)
  assert.equal(revised.positions[KILLER], 11)
  assert.equal(revised.visits[6], 1)
  assert.equal(revised.visits[11], 1)
  assert.ok(![5, 6, 11].includes(revised.positions[HUMAN]))
  assert.equal(revised.replay.at(-1).positions[HUMAN], revised.positions[HUMAN])
  const capped = run({ ...base, hellRewindUses: 2 })
  assert.equal(capped.hellRewindUses, 2)
  assert.equal(capped.health, 1)
})

test('repairing a lamp or dropping a pallet makes the human’s prior turn irreversible', () => {
  const repaired = applyMatchAction(setup({ human: 5, killer: 6 }), { kind: 'repair', to: 5 })
  const hitRepair = applyMatchAction(repaired, attack(5))
  assert.deepEqual(hitRepair.repaired, [5])
  assert.equal(hitRepair.health, 1)
  assert.equal(hitRepair.hellRewindUses, undefined)

  const dropped = applyMatchAction(setup({ human: 6 }), { kind: 'drop', to: 7 })
  const hitDrop = applyMatchAction(dropped, attack(6))
  assert.equal(hitDrop.pallets[7], 'dropped')
  assert.equal(hitDrop.health, 1)
  assert.equal(hitDrop.hellRewindUses, undefined)
})

test('human-controlled human and non-Hell opponents never reroute', () => {
  for (const changes of [{ difficulty: 'hard' }, { player: HUMAN }]) {
    const before = { ...setup(), ...changes }
    const human = applyMatchAction(before, move(6))
    const hit = applyMatchAction(human, attack(6))
    assert.equal(hit.health, 1)
    assert.equal(hit.hellRewindUses, undefined)
  }
})
