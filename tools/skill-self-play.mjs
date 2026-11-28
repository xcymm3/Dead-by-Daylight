import assert from 'node:assert/strict'
import { HUMAN, KILLER, activeRole, actionsFor, createGame, isPlacement, project, skippingRole } from '../src/game.js'
import { applyMatchAction, chooseMatchOpponentAction } from '../src/hard-opponent.js'
import { SKILLS, hasSkill, skillIds } from '../src/skills.js'

function combinations(items, count) {
  if (count === 0) return [[]]
  return items.flatMap((item, index) => combinations(items.slice(index + 1), count - 1).map(rest => [item, ...rest]))
}

function actionKey(action) {
  return [action?.kind, action?.to, action?.direction].join(':')
}

function withoutSkill(game, role, id) {
  const { [id]: removed, ...remaining } = game.skills[role]
  const recovery = game.recovery
  const extraStun = ['hit', 'snipe'].includes(recovery?.kind) ? 1 : recovery?.kind === 'stun' ? 2 : 0
  const effects = role === HUMAN ? {
    strong: extraStun ? { recovery: { ...recovery, remaining: Math.max(0, recovery.remaining - extraStun) } } : {},
    stealth: { stealthUntil: 0 },
    focus: { focusRound: null },
  } : {
    watch: { watcher: null },
    lockdown: { blockedWindows: [] },
    snipe: { snipe: 0, ...(recovery?.kind === 'snipe' && {
      recovery: recovery.deferred ?? (recovery.sidestep ? { kind: 'stun', remaining: 0 } : null),
    }) },
    frenzy: { steps: Math.min(game.steps, 2) },
  }
  return { ...game, ...effects[id], skills: { ...game.skills, [role]: remaining } }
}

const actors = [HUMAN, KILLER]
const stats = Object.fromEntries(actors.flatMap(role => skillIds(role, true).map(id => {
  const skill = SKILLS[role][id]
  return [`${role}/${id}`, { skill: skill.name, active: skill.uses !== undefined, used: 0, effect: 0, compared: 0, changed: 0, other: 0 }]
})))

function compareDecisions(game, role, action) {
  for (const owner of actors) {
    for (const id of Object.keys(game.skills[owner])) {
      const alternative = chooseMatchOpponentAction(withoutSkill(game, owner, id))
      const stat = stats[`${owner}/${id}`]
      stat.compared++
      if (actionKey(action) === actionKey(alternative)) continue
      stat.changed++
      if (role !== owner || action.kind !== id) stat.other++
    }
  }
}

function recordEffects(before, after, role, action) {
  for (const owner of actors) {
    for (const [id, remaining] of Object.entries(before.skills[owner])) {
      if (typeof remaining === 'number') stats[`${owner}/${id}`].used += remaining - after.skills[owner][id]
    }
  }
  if (action?.kind === 'blink' && before.positions[role] !== after.positions[role]) stats[`${role}/blink`].effect++
  if (action?.kind === 'stealth') {
    const view = project(after, KILLER)
    if (view.count === null && view.health === null) stats['human/stealth'].effect++
  }
  if (after.watcher && before.round < after.watcher.start && after.round >= after.watcher.start) stats['killer/watch'].effect++
  if (hasSkill(before, HUMAN, 'strong') && after.recovery !== before.recovery &&
      ((['hit', 'snipe'].includes(after.recovery?.kind) && after.recovery.remaining === 3) ||
       (after.recovery?.kind === 'stun' && after.recovery.remaining === 5))) stats['human/strong'].effect++
  if (before.health === 1 && after.health === 2) stats['human/escape'].effect++
  if (role === KILLER && before.focusRound === before.round && after.health === before.health &&
      applyMatchAction({ ...before, focusRound: null }, action).health < after.health) stats['human/focus'].effect++
  if (after.round !== before.round) {
    if (before.snipe === 4 && after.health === 1 && before.health === 2) stats['killer/snipe'].effect++
    if (after.steps === 3) stats['killer/frenzy'].effect++
  }
  if ((after.blockedWindows?.length ?? 0) > (before.blockedWindows?.length ?? 0) ||
      (action && before.pallets[action.to] === 'dropped' && after.pallets[action.to] === 'broken')) stats['killer/lockdown'].effect++
}

const totals = { games: 0, completed: 0, humanWins: 0, killerWins: 0, comparedGames: 0, maxActions: 0 }
function simulate(seed, human, killer, compare) {
  totals.games++
  if (compare) totals.comparedGames++
  let game = createGame(null, seed, 'hard', { human, killer })
  let steps = 0
  for (; !game.winner && steps < 400; steps++) {
    const role = activeRole(game)
    const skipped = skippingRole(game)
    const action = skipped ? null : chooseMatchOpponentAction(game)
    if (!skipped) {
      assert.ok(action && actionsFor(game).some(option => actionKey(option) === actionKey(action)),
        `Illegal decision at seed ${seed}, round ${game.round}, ${role}: ${JSON.stringify(action)}`)
      if (compare && !isPlacement(game)) compareDecisions(game, role, action)
    }
    const next = applyMatchAction(game, action)
    assert.notEqual(next, game, `Game stalled at seed ${seed}, round ${game.round}, ${role}`)
    recordEffects(game, next, role, action)
    game = next
  }
  assert.ok(game.winner, `Game exceeded 400 actions: ${JSON.stringify({ seed, human, killer, round: game.round })}`)
  totals.completed++
  totals[`${game.winner}Wins`]++
  totals.maxActions = Math.max(totals.maxActions, steps)
}

const [humanPool, killerPool] = actors.map(role => skillIds(role, true))
for (const count of [2, 3]) {
  for (const human of combinations(humanPool, count)) {
    for (const killer of combinations(killerPool, count)) {
      for (let seed = 0; seed < 20; seed++) simulate(seed, human, killer, seed % 4 === 0)
    }
  }
}

console.log(totals)
console.table(stats)
for (const [id, stat] of Object.entries(stats)) {
  if (stat.active) {
    assert.ok(stat.used > 0, `${id} was never used`)
  }
  assert.ok(stat.effect > 0, `${id} never produced its intended effect`)
}
assert.ok(Object.values(stats).filter(stat => stat.changed > 0).length > Object.keys(stats).length / 2,
  'A majority of skills must change an AI decision in the counterfactual')
assert.ok(Object.values(stats).filter(stat => stat.other > 0).length > Object.keys(stats).length / 2,
  'A majority of skills must affect decisions beyond directly selecting the skill')
