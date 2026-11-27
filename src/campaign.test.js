import test from 'node:test'
import assert from 'node:assert/strict'
import { CAMPAIGN, STANDARD_BOARD } from './maps.js'
import { completeCampaignLevel, createCampaignGame, loadCampaignProgress } from './campaign.js'
import { HUMAN, KILLER, EXITS, EXIT_APPROACHES, actionsFor, adjacent, movement, play, project, terrain } from './game.js'
import { killerTravel, remainingRoute } from './hard-planning.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'
import { loadLastReplay, saveLastReplay } from './replay.js'

test('all ten boards have reachable lamps and gates from every spawn and safe pallet sidesteps', () => {
  assert.equal(CAMPAIGN.length, 10)
  assert.equal(new Set(CAMPAIGN.map(stage => stage.board.tiles.join('/'))).size, 10)
  assert.equal(CAMPAIGN[6].board, STANDARD_BOARD)
  assert.deepEqual(STANDARD_BOARD.machines, [5, 9, 25, 29])
  assert.deepEqual(STANDARD_BOARD.pallets, [7, 27])
  assert.deepEqual(STANDARD_BOARD.walls, [12, 22])
  assert.equal(STANDARD_BOARD.window, 17)
  for (const [index, { board }] of CAMPAIGN.entries()) {
    const level = index + 1
    const game = createCampaignGame(level, 5)
    assert.equal(game.player, HUMAN)
    assert.equal(board.tiles.length, 25)
    assert.equal(board.machines.length, 4)
    assert.deepEqual(actionsFor(game).map(action => action.to), board.spawns)
    const view = { ...project(game, HUMAN), count: 3 }
    assert.equal(view.campaignLevel, level)
    for (const at of board.pallets) for (const side of [at - 1, at + 1]) {
      assert.ok(adjacent(at).includes(side))
      assert.equal(terrain(side, level), 'empty')
    }
    for (const start of board.spawns) {
      const reached = new Set([start])
      for (const from of reached) {
        if (EXITS.includes(from)) continue
        for (const to of adjacent(from)) {
          const step = movement(view, HUMAN, from, to)
          if (step) reached.add(step.land)
        }
      }
      assert.ok([...board.playable, ...EXITS].every(at => reached.has(at)), `level ${level}, spawn ${start}`)
      assert.ok(remainingRoute({ ...game, positions: { human: start, killer: null } }) < 60)
    }
    assert.ok(board.playable.some(from => adjacent(from).includes(board.window)
      && movement(view, HUMAN, from, board.window)?.kind === 'vault'))
  }
})

test('AI planning caches, hidden positions and second-step patrols respect the selected level', () => {
  const early = createCampaignGame(1, 17)
  const late = createCampaignGame(10, 17)
  assert.ok(killerTravel({}, 1)[6][7] < killerTravel({}, 10)[6][7])
  for (const game of [early, late]) {
    const spawned = applyMatchAction(game, chooseMatchOpponentAction(game))
    const options = actionsFor(spawned)
    const left = applyMatchAction(spawned, options[0])
    const right = applyMatchAction(spawned, options[1])
    assert.deepEqual(project(left, KILLER), project(right, KILLER))
    const decision = chooseMatchOpponentAction(left)
    assert.deepEqual(decision, chooseMatchOpponentAction(right))
    assert.ok(actionsFor(left).some(action => action.to === decision.to && action.kind === decision.kind))
    if (game === early) assert.deepEqual(chooseMatchOpponentAction({ ...left, steps: 1 }), { kind: 'wait' })
  }
})

test('campaign skill mode uses the selected stage and the solo skill pool', () => {
  const game = createCampaignGame(10, 17, ['escape', 'focus', 'blink'])
  assert.equal(game.skills.human.blink, 1)
  assert.equal(Object.keys(game.skills.killer).length, 3)
  assert.equal(project(game, HUMAN).campaignLevel, 10)
  assert.throws(() => createCampaignGame(10, 17, ['healing', 'tracking']), RangeError)
  const decision = chooseMatchOpponentAction(game)
  assert.ok(CAMPAIGN[9].board.spawns.includes(decision.to))
  assert.notEqual(applyMatchAction(game, decision), game)
})

test('only consecutive human victories unlock stages and replays keep their map', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  let cleared = loadCampaignProgress(storage)
  assert.equal(cleared, 0)
  assert.equal(completeCampaignLevel(0, { campaignLevel: 2, winner: HUMAN }, storage), 0)
  for (let level = 1; level <= CAMPAIGN.length; level++) {
    const game = createCampaignGame(level)
    assert.equal(completeCampaignLevel(cleared, { ...game, winner: KILLER }, storage), cleared)
    const spawned = play(game, actionsFor(game)[0])
    const ready = play(spawned, actionsFor(spawned)[0])
    const won = play({ ...ready, turn: HUMAN, positions: { killer: 5, human: EXIT_APPROACHES[0] },
      repaired: CAMPAIGN[level - 1].board.machines.slice(0, 3) }, { kind: 'move', to: EXITS[0] })
    cleared = completeCampaignLevel(cleared, won, storage)
    assert.equal(cleared, level)
    assert.equal(loadCampaignProgress(storage), level)
    assert.equal(completeCampaignLevel(cleared, won, storage), level)
    saveLastReplay(won.replay, storage)
    const frames = loadLastReplay(storage)
    assert.ok(frames.every(frame => frame.campaignLevel === level))
    assert.equal(frames.at(-1).winner, HUMAN)
  }
  assert.throws(() => createCampaignGame(11), RangeError)
})
