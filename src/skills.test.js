import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HUMAN, KILLER, activeRole, actionsFor, createGame, play, project, skillArea, skippingRole, skipTurn,
  stunRemaining, visibleLog,
} from './game.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'
import { createPracticeGame, killerThreat } from './opponent.js'
import { skillIds, validLoadout } from './skills.js'

function position(killer, human, turn, loadouts, options = {}) {
  return { ...createGame(null, 123, 'normal', loadouts), positions: { [KILLER]: killer, [HUMAN]: human }, turn, round: 1, ...options }
}

function action(game, kind, to, direction) {
  const next = play(game, { kind, to, direction })
  assert.notEqual(next, game, `Action rejected: ${kind} ${to ?? ''} ${direction ?? ''}`)
  return next
}

const wait = game => action(game, 'wait')
const move = (game, to) => action(game, 'move', to)

test('the skill modes enforce exact, distinct loadouts and the solo whitelist', () => {
  assert.equal(validLoadout(HUMAN, 0, []), true)
  assert.equal(validLoadout(HUMAN, 2, ['strong']), false)
  assert.equal(validLoadout(HUMAN, 2, ['strong', 'strong']), false)
  assert.equal(validLoadout(KILLER, 2, ['strong', 'watch']), false)
  assert.equal(validLoadout(KILLER, 3, ['track', 'sabotage', 'slash']), true)
  assert.equal(validLoadout(HUMAN, 3, ['healing', 'trap', 'flare'], true), false)
  assert.deepEqual(skillIds(HUMAN, true), ['strong', 'escape', 'focus', 'blink', 'stealth'])
  assert.deepEqual(skillIds(KILLER, true), ['snipe', 'lockdown', 'frenzy', 'watch', 'blink'])
})

test('strong increases pallet and contact stuns by their stated amounts', () => {
  const stuns = [
    [action(position(7, 6, HUMAN, { human: ['strong'] }), 'drop', 7), 5, 'stun'],
    [wait(move(position(10, 15, KILLER, { human: ['strong'] }), 15)), 3, 'hit'],
  ]
  for (let [game, turns, kind] of stuns) {
    assert.equal(game.recovery.kind, kind)
    for (let remaining = turns; remaining > 0; remaining--) {
      assert.equal(stunRemaining(project(game, KILLER).recovery), remaining)
      assert.equal(skippingRole(game), KILLER)
      assert.deepEqual(actionsFor(game), [])
      game = wait(skipTurn(game))
    }
    assert.equal(skippingRole(game), null)
    if (kind === 'stun') assert.deepEqual(actionsFor(game).map(option => option.to), [6, 8])
  }
})

test('healing counts actions and gives two points for waiting on an unlit lamp', () => {
  let game = position(29, 5, HUMAN, { human: ['healing', 'trap'] }, { health: 1, healing: 4 })
  game = action(game, 'trap')
  assert.equal(game.healing, 5)
  assert.equal(game.turn, HUMAN)
  game = wait(game)
  assert.equal(game.healing, 7)
  assert.equal(game.health, 1)
  game = action(wait(game), 'repair', 5)
  assert.equal(game.health, 2)
  assert.equal(game.healing, 0)
})

test('escape heals at the third lamp and cannot be farmed if the count falls', () => {
  let game = action(position(29, 25, HUMAN, { human: ['escape'] }, { health: 1, repaired: [5, 9] }), 'repair', 25)
  assert.equal(game.health, 2)
  assert.equal(game.repaired.length, 3)
  game = action({ ...game, health: 1, repaired: [5, 9], turn: HUMAN }, 'repair', 25)
  assert.equal(game.health, 1)
})

test('focus hides protected contact from the killer and expires before the next human action', () => {
  let game = action(position(6, 5, HUMAN, { human: ['focus'] }, { health: 1 }), 'repair', 5)
  const contact = move(game, 5)
  const empty = move({ ...game, positions: { human: 8, killer: 6 } }, 5)
  assert.equal(contact.health, 1)
  assert.equal(contact.recovery, null)
  assert.deepEqual(project(contact, KILLER), project(empty, KILLER))
  assert.deepEqual(visibleLog(contact, KILLER), visibleLog(empty, KILLER))
  game = move(contact, 6)
  assert.equal(project(game, HUMAN).focused, false)
  game = move(wait(game), 5)
  assert.equal(game.winner, KILLER)
})

test('a trap is private, costs no movement, fires once and expires at the next human turn', () => {
  let game = action(position(6, 11, HUMAN, { human: ['trap'] }), 'trap')
  assert.equal(game.turn, HUMAN)
  assert.equal(project(game, KILLER).trap, undefined)
  assert.equal(play(game, { kind: 'trap' }), game)
  game = move(move(game, 10), 11)
  assert.equal(game.recovery.kind, 'trap')
  assert.equal(game.recovery.remaining, 2)
  assert.equal(game.trap, null)
  game = skipTurn(wait(game))
  game = action(game, 'trap')
  assert.equal(project(game, KILLER).skills.human.trap, 0)
  game = skipTurn(wait(game))
  assert.equal(game.trap, null)
  assert.equal(play(game, { kind: 'trap' }), game)
})

test('a directed flare fires at the start of the following human turn', () => {
  assert.deepEqual(new Set(skillArea(15, 'east', 'flare')), new Set([16, 12, 17, 22, 13, 18, 23]))
  assert.deepEqual(new Set(skillArea(26, 'north', 'flare')), new Set([21, 15, 16, 17, 10, 11, 12]))
  let game = position(14, 15, HUMAN, { human: ['flare'] })
  assert.equal(play(game, { kind: 'flare', direction: 'invalid' }), game)
  game = action(game, 'flare', undefined, 'east')
  assert.equal(game.turn, KILLER)
  assert.equal(game.recovery, null)
  assert.equal(project(game, KILLER).flare, undefined)
  game = wait(move(game, 13))
  assert.equal(game.turn, HUMAN)
  assert.equal(game.flare, null)
  assert.equal(game.recovery.kind, 'flare')
  assert.equal(game.recovery.remaining, 3)
  assert.equal(project(game, KILLER).skills.human.flare, 0)
})

test('blink crosses obstacles without using movement and rejects occupied or blocked landings', () => {
  let game = position(29, 16, HUMAN, { human: ['blink'], killer: ['blink'] }, { steps: 0 })
  assert.equal(play(game, { kind: 'blink', to: 18, direction: 'west' }), game)
  game = action(game, 'blink', 18, 'east')
  assert.equal(game.positions.human, 18)
  assert.equal(game.turn, HUMAN)
  assert.equal(game.steps, 0)
  assert.equal(play(game, { kind: 'blink', to: 16, direction: 'west' }), game)
  game = action(wait(game), 'blink', 19, 'north')
  assert.equal(game.positions.killer, 19)
  assert.equal(game.steps, 2)
  assert.equal(play(position(18, 16, HUMAN, { human: ['blink'] }), { kind: 'blink', to: 18, direction: 'east' }).positions.human, 16)
  const dropped = position(5, 23, KILLER, { killer: ['blink'] }, { pallets: { 7: 'dropped' } })
  const found = action(dropped, 'blink', 7, 'east')
  assert.equal(found.positions.killer, 5)
  assert.equal(found.skills.killer.blink, 1)
  assert.ok(!actionsFor(found).some(option => option.kind === 'blink' && option.to === 7))
})

test('stealth hides metrics, exit hints and numerical logs for exactly three rounds', () => {
  let game = action(position(26, 25, HUMAN, { human: ['stealth'], killer: ['snipe'] }, { repaired: [5, 9] }), 'stealth')
  game = action(game, 'repair', 25)
  game = move(game, 25)
  for (const round of [2, 3]) {
    assert.equal(game.round, round)
    assert.equal(project(game, KILLER).count, null)
    assert.equal(project(game, KILLER).health, null)
    assert.equal(project(game, KILLER).snipe, null)
    assert.ok(!visibleLog(game, KILLER).some(event => event.metric || event.text.includes('出口门开启')))
    if (round === 2) game = move(game, 20)
    else game = wait(skipTurn(game))
  }
  assert.equal(game.round, 4)
  assert.equal(project(game, KILLER).count, 3)
  assert.equal(project(game, KILLER).health, 1)
  assert.equal(project(game, KILLER).skills.human.stealth, 0)
  assert.ok(!visibleLog(game, KILLER).some(event => event.metric))
})

test('snipe increments from the first killer turn, fires on five and resets on injury', () => {
  let game = createGame(null, 123, 'normal', { killer: ['snipe'] })
  game = action(action(game, 'spawn', 6), 'spawn', 19)
  for (let progress = 1; progress <= 4; progress++) {
    assert.equal(project(game, KILLER).snipe, progress)
    assert.equal(game.health, 2)
    game = wait(wait(game))
  }
  assert.equal(game.round, 5)
  assert.equal(game.health, 1)
  assert.equal(game.snipe, 0)
  assert.equal(wait(wait(game)).snipe, 0)
  const hit = move(position(6, 5, KILLER, { killer: ['snipe'] }, { snipe: 4 }), 5)
  assert.equal(hit.snipe, 0)
})

test('lockdown seals the window after landing and removes only the extra pallet-break turn', () => {
  let game = action(position(16, 15, KILLER, { killer: ['lockdown'] }), 'vault', 17)
  assert.deepEqual(project(game, HUMAN).blockedWindows, [])
  game = skipTurn(wait(game))
  assert.equal(game.positions.killer, 18)
  assert.deepEqual(project(game, HUMAN).blockedWindows, [17])
  game = move(game, 16)
  assert.equal(play(game, { kind: 'vault', to: 17 }), game)
  game = wait(game)
  assert.equal(play(game, { kind: 'vault', to: 17 }), game)
  game = move(position(6, 23, KILLER, { killer: ['lockdown'] }, { pallets: { 7: 'dropped' } }), 7)
  assert.equal(game.pallets[7], 'broken')
  assert.equal(game.steps, 1)
  assert.equal(game.positions.killer, 6)
  assert.equal(game.recovery, null)
  assert.equal(move(game, 7).positions.killer, 7)
})

test('frenzy adds a step and removes hit stun once three lamps are lit', () => {
  let game = position(6, 25, HUMAN, { human: ['strong'], killer: ['frenzy'] }, { repaired: [5, 9] })
  game = action(game, 'repair', 25)
  assert.equal(game.steps, 3)
  game = { ...game, positions: { human: 5, killer: 6 } }
  game = move(game, 5)
  assert.equal(game.health, 1)
  assert.equal(game.recovery, null)
  assert.equal(game.steps, 2)
  game = move(move(game, 6), 5)
  assert.equal(game.health, 1)
  assert.equal(game.turn, HUMAN)
})

test('sabotage spends two charges only on lit lamps and always hides repair totals', () => {
  let game = position(6, 29, KILLER, { killer: ['sabotage'] }, { repaired: [5, 9, 25, 29] })
  assert.equal(project(game, KILLER).count, null)
  game = move(move(game, 5), 10)
  game = wait(game)
  game = move(move(game, 15), 20)
  game = wait(game)
  game = move(move(game, 25), 20)
  assert.deepEqual(game.repaired, [9, 29])
  assert.equal(project(game, HUMAN).skills.killer.sabotage, 0)
  assert.equal(project(game, KILLER).count, null)
  assert.equal(project(game, HUMAN).count, 2)
})

test('watch activates next round and reports the center and diagonals without revealing position', () => {
  let game = position(6, 10, KILLER, { killer: ['watch'] })
  assert.equal(play(move(game, 7), { kind: 'watch' }).watcher, undefined)
  game = action(game, 'watch')
  assert.equal(game.turn, HUMAN)
  assert.equal(project(game, KILLER).watcher.nearby, null)
  for (const at of [6, 10, 11]) {
    const next = wait({ ...game, positions: { human: at, killer: 6 } })
    assert.equal(project(next, KILLER).watcher.nearby, true)
    assert.equal(project(next, KILLER).positions.human, undefined)
  }
  game = move(game, 15)
  assert.equal(project(game, KILLER).watcher.nearby, false)
  assert.equal(project(game, HUMAN).watcher, undefined)
  assert.equal(project(game, HUMAN).skills.killer.watch, 0)
})

test('tracking has four steps per round, can be cancelled and reveals a contact for two rounds', () => {
  const setup = action(position(6, 14, KILLER, { killer: ['track'] }), 'track')
  assert.equal(setup.tracker.started, false)
  let game = wait(setup)
  assert.equal(game.tracker.steps, 4)
  for (const to of [7, 6, 7, 6]) game = action(game, 'trackMove', to)
  assert.equal(game.turn, HUMAN)
  assert.equal(game.tracker.steps, 0)
  const cancelled = action(wait(game), 'trackCancel')
  assert.equal(cancelled.tracker, null)
  assert.equal(cancelled.steps, 2)
  assert.ok(actionsFor(cancelled).some(option => option.kind === 'move'))
  game = wait(game)
  for (const to of [7, 8, 9, 14]) game = action(game, 'trackMove', to)
  assert.equal(game.tracker, null)
  assert.equal(game.positions.killer, 6)
  for (const remaining of [2, 1]) {
    assert.equal(project(game, KILLER).positions.human, 14)
    game = wait(game)
    assert.equal(skippingRole(game), HUMAN)
    assert.equal(game.humanStun, remaining)
    assert.deepEqual(actionsFor(game), [])
    game = skipTurn(game)
  }
  assert.equal(project(game, KILLER).positions.human, undefined)
})

test('a slash has a three-cell arc and uses the same contact and miss rules after moving', () => {
  assert.deepEqual(new Set(skillArea(16, 'north', 'slash')), new Set([10, 11, 12]))
  const before = position(6, 13, KILLER, { killer: ['slash'] })
  assert.equal(play(before, { kind: 'slash', direction: 'east' }), before)
  const moved = move(move(before, 7), 8)
  assert.equal(moved.turn, KILLER)
  assert.equal(moved.steps, 0)
  const hit = action(moved, 'slash', undefined, 'south')
  assert.equal(hit.health, 1)
  assert.equal(hit.recovery.kind, 'hit')
  assert.equal(hit.recovery.remaining, 2)
  const miss = action(moved, 'slash', undefined, 'north')
  assert.equal(miss.health, 2)
  assert.equal(miss.recovery.kind, 'slash')
  assert.equal(miss.recovery.remaining, 1)
  assert.equal(skipTurn(wait(miss)).recovery, null)
})

test('AI selects whitelisted skills and plays games in both roles across all difficulties', () => {
  for (const difficulty of ['normal', 'hard', 'hell']) {
    for (const count of [0, 2, 3]) {
      for (const player of [HUMAN, KILLER]) {
        for (let seed = 0; seed < 12; seed++) {
          const choices = skillIds(player, true)
          const skills = Array.from({ length: count }, (_, index) => choices[(seed + index) % choices.length])
          let game = createPracticeGame(player, count, skills, difficulty, seed)
          for (const role of [HUMAN, KILLER]) assert.ok(validLoadout(role, count, Object.keys(game.skills?.[role] ?? {}), true))
          if (!count) continue
          for (let step = 0; step < 350 && !game.winner; step++) {
            const after = applyMatchAction(game, skippingRole(game) ? null : chooseMatchOpponentAction(game))
            assert.notEqual(game, after, `${difficulty} ${count} ${player} ${seed} ${activeRole(game)}`)
            game = after
          }
          assert.ok(game.winner, `${difficulty} ${count} ${player} ${seed} did not finish`)
        }
      }
    }
  }
})

test('AI plays blink and stealth tactically and reacts only to the watcher signal', () => {
  const escape = position(29, 5, HUMAN, { human: ['blink'] }, { difficulty: 'hard', repaired: [5, 9, 25] })
  assert.deepEqual(chooseMatchOpponentAction(escape), { kind: 'blink', direction: 'south', to: 15, land: 15 })
  const nearThirdLamp = position(26, 25, HUMAN, { human: ['stealth'] }, { difficulty: 'hard', repaired: [5, 9] })
  assert.equal(chooseMatchOpponentAction(nearThirdLamp)?.kind, 'stealth')
  const unplaced = position(6, 25, KILLER, { killer: ['watch'] }, { difficulty: 'hard' })
  assert.equal(chooseMatchOpponentAction(unplaced)?.kind, 'watch')
  const watcher = { at: 6, start: 1 }
  const watch = position(15, 6, KILLER, { killer: ['watch'] }, { watcher })
  const replaceHuman = at => ({ ...watch, positions: { killer: 15, human: at } })
  assert.deepEqual(chooseMatchOpponentAction(watch), chooseMatchOpponentAction(replaceHuman(10)))
  assert.notDeepEqual(chooseMatchOpponentAction(watch), chooseMatchOpponentAction(replaceHuman(25)))
})

test('hard killer uses blink to gain position while preserving its move budget', () => {
  const game = position(10, 29, KILLER, { killer: ['snipe', 'lockdown', 'blink'] },
    { difficulty: 'hard', seed: 0, round: 2, snipe: 2, visits: { 5: 1, 6: 1, 10: 1 } })
  const choice = chooseMatchOpponentAction(game)
  assert.deepEqual(choice, { kind: 'blink', direction: 'south', to: 20, land: 20 })
  const next = applyMatchAction(game, choice)
  assert.equal(next.positions[KILLER], 20)
  assert.equal(next.steps, game.steps)
  assert.equal(next.skills.killer.blink, 0)
})

test('hard killer responds to a pending sniper shot but cannot use information concealed by stealth', () => {
  const game = position(21, 28, KILLER, { human: ['stealth'], killer: ['snipe', 'lockdown', 'watch'] }, {
    difficulty: 'hard', seed: 16, round: 4, steps: 1, killerMoved: true, repaired: [25], snipe: 4,
    visits: { 20: 1, 21: 1, 25: 1, 26: 1, 27: 1, 28: 1 }, watcher: { at: 28, start: 2 },
  })
  assert.equal(chooseMatchOpponentAction(game).to, 26)
  assert.equal(chooseMatchOpponentAction({ ...game, snipe: 0 }).to, 16)
  const hidden = { ...game, stealthUntil: 6, skills: { ...game.skills, human: { stealth: 0 } } }
  const alternative = { ...hidden, health: 1, repaired: [5, 9, 29], snipe: 0, positions: { killer: 21, human: 29 } }
  assert.deepEqual(project(hidden, KILLER), project(alternative, KILLER))
  assert.deepEqual(chooseMatchOpponentAction(hidden), chooseMatchOpponentAction(alternative))
})

test('hard human plans around the remaining stun and the combination of lockdown and frenzy', () => {
  const game = position(7, 5, HUMAN, { human: ['strong', 'escape'], killer: ['lockdown'] }, {
    difficulty: 'hard', seed: 0, round: 11, steps: 0, health: 1, repaired: [29, 5],
    pallets: { 7: 'dropped' }, recovery: { kind: 'stun', remaining: 2 },
  })
  const withoutStrong = { ...game, skills: { ...game.skills, human: { escape: null } }, recovery: { kind: 'stun', remaining: 0 } }
  assert.equal(chooseMatchOpponentAction(game).to, 6)
  assert.equal(chooseMatchOpponentAction(withoutStrong).to, 10)

  for (const killer of [['frenzy'], ['lockdown'], ['lockdown', 'frenzy']]) {
    const view = project(position(6, 8, HUMAN, { killer }, { repaired: [5, 9, 25], pallets: { 7: 'dropped' } }), HUMAN)
    assert.equal(killerThreat(view).has(8), killer.length === 2)
  }
})
