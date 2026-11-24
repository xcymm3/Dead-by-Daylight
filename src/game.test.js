import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HUMAN, KILLER, activeRole, actionsFor, createGame, play, project, skipKillerTurn, terrain, visibleLog,
} from './game.js'
import { chooseOpponentAction } from './opponent.js'

const move = (game, to) => play(game, { kind: 'move', to })
const wait = game => play(game, { kind: 'wait' })

function position(killer, human, turn = KILLER, options = {}) {
  return { ...createGame(KILLER, 123), positions: { [KILLER]: killer, [HUMAN]: human }, round: 1, turn, ...options }
}

test('the killer places first and cannot see the human spawn or move', () => {
  let game = createGame(KILLER, 1)
  assert.equal(activeRole(game), KILLER)
  assert.equal(play(game, { kind: 'spawn', to: 5 }), game)
  game = play(game, { kind: 'spawn', to: 6 })
  assert.equal(activeRole(game), HUMAN)
  assert.equal(play(game, { kind: 'spawn', to: 6 }), game)
  game = play(game, { kind: 'spawn', to: 8 })
  assert.equal(game.round, 1)
  assert.equal(activeRole(game), KILLER)
  game = move(wait(game), 13)
  assert.deepEqual(project(game, KILLER).positions, { [KILLER]: 6 })
  assert.ok(visibleLog(game).every(event => !event.text.includes('人类')))
})

test('the killer stops after a hit and skips exactly two turns', () => {
  let game = move(position(10, 15), 15)
  assert.equal(game.health, 1)
  assert.equal(game.turn, HUMAN)
  assert.equal(game.steps, 0)
  assert.equal(game.recovery.remaining, 2)
  game = skipKillerTurn(wait(game))
  assert.equal(game.recovery.remaining, 1)
  game = move(game, 16)
  game = skipKillerTurn(game)
  assert.equal(game.recovery, null)
  game = move(wait(game), 16)
  assert.equal(game.winner, KILLER)
  assert.equal(game.health, 0)
  assert.deepEqual(actionsFor(game), [])
})

test('movement is orthogonal and the human cannot enter the killer square', () => {
  const game = position(16, 21, HUMAN)
  for (const target of [16, 17, 22]) assert.equal(move(game, target), game)
  const nextToWall = position(13, 6, HUMAN)
  assert.equal(move(nextToWall, 11).positions[HUMAN], 11)
  assert.equal(terrain(12), 'wall')
  assert.equal(terrain(22), 'wall')
  const blockedVault = position(18, 16, HUMAN)
  assert.equal(play(blockedVault, { kind: 'vault', to: 17 }), blockedVault)
})

test('the human vaults immediately and the killer lands after the skipped turn', () => {
  const vault = game => play(game, { kind: 'vault', to: 17 })
  assert.equal(vault(position(9, 16, HUMAN)).positions[HUMAN], 18)
  let game = vault(position(16, 13))
  assert.equal(game.positions[KILLER], 16)
  assert.equal(game.turn, HUMAN)
  game = skipKillerTurn(move(game, 18))
  assert.equal(game.positions[KILLER], 18)
  assert.equal(game.health, 1)
  assert.deepEqual(game.recovery, { kind: 'hit', remaining: 2 })
})

test('a pallet stun forces the first move after recovery to either side', () => {
  const drop = game => play(game, { kind: 'drop', to: 7 })
  const overlapping = position(7, 7, HUMAN)
  assert.equal(drop(overlapping), overlapping)
  const diagonal = position(7, 13, HUMAN)
  assert.equal(drop(diagonal), diagonal)
  let game = drop(position(7, 6, HUMAN))
  assert.equal(game.pallets[7], 'dropped')
  assert.equal(game.recovery.remaining, 2)
  game = skipKillerTurn(game)
  game = skipKillerTurn(wait(game))
  game = wait(game)
  assert.deepEqual(actionsFor(game).map(action => action.to), [6, 8])
  game = play(game, { kind: 'sidestep', to: 8 })
  assert.equal(game.positions[KILLER], 8)
  assert.equal(game.steps, 1)
  assert.equal(game.recovery, null)
})

test('a remotely dropped pallet stays hidden until the killer attempts to cross', () => {
  const before = position(6, 8, HUMAN, { repaired: [5] })
  let game = play(before, { kind: 'drop', to: 7 })
  const alternate = { ...wait(before), positions: { [KILLER]: 6, [HUMAN]: 15 }, repaired: [9] }
  assert.deepEqual(project(game, KILLER), project(alternate, KILLER))
  assert.deepEqual(chooseOpponentAction(game), chooseOpponentAction(alternate))
  game = move(game, 7)
  assert.equal(game.positions[KILLER], 6)
  assert.equal(game.turn, HUMAN)
  assert.equal(game.recovery.kind, 'break')
  game = skipKillerTurn(wait(game))
  assert.equal(game.positions[KILLER], 6)
  assert.equal(game.pallets[7], 'broken')
  assert.equal(project(game, KILLER).pallets[7], 'broken')
})

test('repair consumes one human turn and exit access starts at three repairs', () => {
  const nearExit = position(29, 7, HUMAN, { repaired: [5, 9] })
  assert.equal(move(nearExit, 2), nearExit)
  let game = position(29, 25, HUMAN, { repaired: [5, 9] })
  assert.equal(wait(game), game)
  game = play(game, { kind: 'repair', to: 25 })
  assert.equal(game.turn, KILLER)
  assert.equal(project(game, KILLER).count, 3)
  assert.equal(project(game, KILLER).repaired, undefined)
  assert.equal(move({ ...nearExit, repaired: game.repaired }, 2).winner, HUMAN)
})

test('a side vault into either open exit wins immediately', () => {
  for (const [pallet, exit] of [[7, 2], [27, 32]]) {
    for (const side of [-1, 1]) {
      const request = { kind: 'vault', to: pallet }
      const locked = position(29, pallet + side, HUMAN, { repaired: [5, 9], pallets: { [pallet]: 'dropped' } })
      assert.equal(move(locked, exit), locked)
      const horizontal = play(locked, request)
      assert.equal(horizontal.positions[HUMAN], pallet - side)
      assert.equal(horizontal.winner, null)

      const open = { ...locked, repaired: [5, 9, 25] }
      assert.equal(move(open, exit), open)
      assert.deepEqual(chooseOpponentAction(open), { ...request, land: exit })
      const escaped = play(open, request)
      assert.equal(escaped.positions[HUMAN], exit)
      assert.equal(escaped.winner, HUMAN)
      assert.equal(escaped.replay.at(-1).positions[HUMAN], exit)
      assert.equal(escaped.replay.at(-1).winner, HUMAN)
    }
  }
})

test('replay records spawns, completed rounds and the final hit', () => {
  let game = play(createGame(KILLER), { kind: 'spawn', to: 6 })
  assert.equal(game.replay.length, 0)
  game = play(game, { kind: 'spawn', to: 8 })
  game = move(move(game, 7), 8)
  assert.equal(game.replay.length, 1)
  assert.equal(project(game, KILLER).replay, undefined)

  game = move(game, 13)
  game = wait(skipKillerTurn(game))
  game = wait(skipKillerTurn(game))
  assert.equal(game.round, 4)
  game = move(game, 13)
  assert.equal(game.winner, KILLER)
  assert.deepEqual(game.replay.map(frame => frame.round), [0, 1, 2, 3, 4])
  assert.deepEqual(game.replay.map(frame => frame.positions), [
    { killer: 6, human: 8 },
    { killer: 8, human: 13 },
    { killer: 8, human: 13 },
    { killer: 8, human: 13 },
    { killer: 13, human: 13 },
  ])
  assert.equal(game.replay.at(-1).winner, KILLER)
})

test('both computer roles can play complete games through the normal actions', () => {
  const winners = new Set()
  for (let seed = 0; seed < 30; seed++) {
    let game = createGame(seed % 2 ? HUMAN : KILLER, seed)
    for (let step = 0; step < 250 && !game.winner; step++) {
      const next = activeRole(game) === KILLER && game.recovery?.remaining > 0
        ? skipKillerTurn(game)
        : play(game, chooseOpponentAction(game))
      assert.notEqual(next, game)
      game = next
    }
    assert.ok(game.winner, `Seed ${seed} did not finish`)
    winners.add(game.winner)
  }
  assert.deepEqual(winners, new Set([HUMAN, KILLER]))
})
