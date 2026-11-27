import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'
import { HUMAN, KILLER } from '../src/game.js'
import { createOnlineServer } from './rooms.js'

const roomState = message => message.type === 'room'
const session = message => message.type === 'session'
const error = message => message.type === 'error'

async function fixture(t, options) {
  const { http, close } = createOnlineServer({ skipDelay: 10, ...options })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(() => new Promise(resolve => close(resolve)))

  return async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}/online`)
    const inbox = []
    ws.on('message', data => inbox.push(JSON.parse(data)))
    await once(ws, 'open')

    return {
      ws,
      send: request => ws.send(JSON.stringify(request)),
      async next(predicate) {
        const start = Date.now()
        while (Date.now() - start < 3000) {
          const index = inbox.findIndex(predicate)
          if (index >= 0) return inbox.splice(0, index + 1).at(-1)
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        assert.fail(`No matching message. Inbox: ${JSON.stringify(inbox)}`)
      },
    }
  }
}

function act(client, state, kind, to, direction) {
  client.send({ type: 'action', revision: state.revision, action: { kind, to, direction } })
}

test('room codes, host-first selection, private moves, reconnection and settlement replay', async t => {
  const connect = await fixture(t)
  const [host, guest] = await Promise.all([connect(), connect()])
  host.send({ type: 'create' })
  const hostSeat = await host.next(session)
  assert.match(hostSeat.code, /^[23456789A-HJ-NP-Z]{6}$/)
  assert.equal((await host.next(roomState)).host, true)

  guest.send({ type: 'join', code: hostSeat.code.toLowerCase() })
  const guestSeat = await guest.next(session)
  assert.notEqual(guestSeat.token, hostSeat.token)
  assert.equal((await guest.next(roomState)).role, null)
  assert.equal((await host.next(roomState)).guestJoined, true)
  guest.send({ type: 'chooseRole', role: KILLER })
  await guest.next(error)
  host.send({ type: 'start' })
  await host.next(error)

  host.send({ type: 'chooseRole', role: KILLER })
  assert.equal((await guest.next(roomState)).role, HUMAN)
  guest.send({ type: 'ready', role: HUMAN, ready: true })
  await host.next(message => roomState(message) && message.guestReady)
  host.send({ type: 'chooseRole', role: HUMAN })
  const changed = await guest.next(message => roomState(message) && message.role === KILLER)
  assert.equal(changed.guestReady, false)
  guest.send({ type: 'ready', role: HUMAN, ready: true })
  await guest.next(error)
  guest.send({ type: 'ready', role: KILLER, ready: true })
  await host.next(message => roomState(message) && message.guestReady)
  guest.send({ type: 'start' })
  await guest.next(error)
  host.send({ type: 'start' })
  const start = await guest.next(message => roomState(message) && message.match?.placing)
  assert.equal(start.match.role, KILLER)
  act(guest, start, 'spawn', 6)
  const humanSpawn = await host.next(message => roomState(message) && message.match?.role === HUMAN)
  assert.ok(humanSpawn.match.actions.some(action => action.kind === 'spawn'))
  act(host, humanSpawn, 'spawn', 8)

  const firstMove = await guest.next(message => roomState(message) && message.match?.view.round === 1)
  assert.deepEqual(firstMove.match.view.positions, { [KILLER]: 6 })
  assert.equal(firstMove.match.view.repaired, undefined)
  assert.equal(firstMove.match.replay, undefined)
  assert.deepEqual(firstMove.match.log.map(event => event.text),
    ['屠夫选择出生点。', '屠夫在 B1 出生。', '人类选择出生点。'])
  act(host, firstMove, 'wait')
  await host.next(error)
  act(guest, firstMove, 'move', 7)
  const secondMove = await guest.next(message => roomState(message) && message.revision > firstMove.revision)
  act(guest, firstMove, 'move', 8)
  await guest.next(error)

  guest.ws.terminate()
  const paused = await host.next(message => roomState(message) && message.match && !message.opponentOnline)
  assert.deepEqual(paused.match.actions, [])
  const returningGuest = await connect()
  returningGuest.send({ type: 'resume', code: guestSeat.code, token: 'invalid-token' })
  assert.equal((await returningGuest.next(error)).code, 'sessionExpired')
  returningGuest.send({ type: 'resume', code: guestSeat.code, token: guestSeat.token })
  assert.deepEqual(await returningGuest.next(session), guestSeat)
  const resumed = await returningGuest.next(roomState)
  assert.equal(resumed.role, KILLER)
  assert.equal(resumed.revision, secondMove.revision)
  assert.deepEqual(resumed.match.view.positions, { [KILLER]: 7 })

  act(returningGuest, resumed, 'move', 8)
  const hit = await host.next(message => roomState(message) && message.match?.view.health === 1)
  act(host, hit, 'move', 13)
  for (const round of [2, 3]) {
    const turn = await host.next(message => roomState(message) && message.match?.role === HUMAN && message.match.view.round === round)
    act(host, turn, 'wait')
  }
  const lastMove = await returningGuest.next(message => roomState(message) && message.match?.view.round === 4)
  act(returningGuest, lastMove, 'move', 13)
  const ended = message => roomState(message) && message.match?.view.winner === KILLER
  const [hostResult, guestResult] = await Promise.all([host.next(ended), returningGuest.next(ended)])
  assert.deepEqual(hostResult.match.replay, guestResult.match.replay)
  assert.deepEqual(hostResult.match.replay.map(frame => frame.round), [0, 1, 2, 3, 4])
  assert.deepEqual(hostResult.match.log.filter(event => event.kind === 'skip').map(event => event.round), [2, 3])
  assert.deepEqual(guestResult.match.log.filter(event => event.kind === 'skip').map(event => event.round), [2, 3])
  assert.deepEqual(guestResult.match.replay[0].positions, { [KILLER]: 6, [HUMAN]: 8 })
  assert.equal(guestResult.match.replay.at(-1).winner, KILLER)

  const rematch = { type: 'rematch', revision: hostResult.revision }
  returningGuest.send(rematch)
  await returningGuest.next(error)
  returningGuest.ws.terminate()
  await host.next(message => ended(message) && !message.opponentOnline)
  host.send(rematch)
  await host.next(error)

  const nextGuest = await connect()
  nextGuest.send({ type: 'resume', code: guestSeat.code, token: guestSeat.token })
  await nextGuest.next(session)
  assert.deepEqual((await nextGuest.next(ended)).match.log, guestResult.match.log)
  await host.next(message => ended(message) && message.opponentOnline)
  host.send({ ...rematch, revision: lastMove.revision })
  await host.next(error)
  host.send(rematch)
  const newMatch = message => roomState(message) && message.match?.placing && message.revision > rematch.revision
  const [hostNext, guestNext] = await Promise.all([host.next(newMatch), nextGuest.next(newMatch)])
  assert.equal(hostNext.code, hostSeat.code)
  assert.equal(hostNext.role, HUMAN)
  assert.equal(guestNext.role, KILLER)
  assert.equal(guestNext.match.view.health, 2)
  assert.equal(guestNext.match.view.count, 0)
  assert.equal(guestNext.match.view.round, 0)
  assert.equal(guestNext.match.replay, undefined)
  assert.deepEqual(guestNext.match.log, [])
  assert.equal(hostNext.match.actions.length, 0)
  host.send(rematch)
  await host.next(error)
  act(nextGuest, guestNext, 'spawn', 6)
  const nextPlacement = await host.next(message => newMatch(message) && message.match.role === HUMAN)
  assert.ok(nextPlacement.match.actions.some(action => action.kind === 'spawn'))
})

test('skill rooms keep selections private, validate actions and schedule tracking stuns', async t => {
  const connect = await fixture(t)
  const [host, guest] = await Promise.all([connect(), connect()])
  host.send({ type: 'create' })
  const seat = await host.next(session)
  guest.send({ type: 'join', code: seat.code })
  await guest.next(session)
  host.send({ type: 'chooseRole', role: KILLER })
  await guest.next(message => roomState(message) && message.role === HUMAN)
  host.send({ type: 'chooseSkillCount', count: 3 })
  await guest.next(message => roomState(message) && message.skillCount === 3)

  const toggle = (client, role, skillCount, id) => client.send({ type: 'toggleSkill', role, skillCount, id, selected: true })
  const ready = skillCount => guest.send({ type: 'ready', role: HUMAN, skillCount, ready: true })
  toggle(guest, HUMAN, 3, 'slash')
  await guest.next(error)
  toggle(guest, HUMAN, 3, 'trap')
  toggle(guest, HUMAN, 3, 'flare')
  toggle(guest, HUMAN, 3, 'stealth')
  toggle(guest, HUMAN, 3, 'focus')
  await guest.next(error)
  ready(3)
  const before = await host.next(message => roomState(message) && message.guestReady)
  assert.deepEqual(before.selectedSkills, [])
  assert.equal(before.match, null)
  assert.ok(!JSON.stringify(before).includes('stealth'))
  host.send({ type: 'start' })
  await host.next(error)

  host.send({ type: 'chooseSkillCount', count: 2 })
  const reset = await guest.next(message => roomState(message) && message.skillCount === 2)
  assert.deepEqual(reset.selectedSkills, [])
  assert.equal(reset.guestReady, false)
  ready(3)
  await guest.next(error)
  toggle(host, KILLER, 2, 'sabotage')
  toggle(host, KILLER, 2, 'track')
  toggle(guest, HUMAN, 2, 'flare')
  toggle(guest, HUMAN, 2, 'stealth')
  ready(2)
  await host.next(message => roomState(message) && message.skillCount === 2 && message.guestReady)
  host.send({ type: 'start' })
  const placing = await host.next(message => message.match?.placing && message.match.role === KILLER)
  assert.deepEqual(placing.match.view.skills, { human: { flare: 1, stealth: 1 }, killer: { sabotage: 2, track: 1 } })
  assert.equal(placing.match.view.count, null)
  act(host, placing, 'spawn', 6)
  const survivor = await guest.next(message => message.match?.placing && message.match.role === HUMAN)
  act(guest, survivor, 'spawn', 10)
  const first = await host.next(message => message.match?.view.round === 1 && message.match.role === KILLER)
  act(host, first, 'track')
  const turn = await guest.next(message => message.match?.view.round === 1 && message.match.role === HUMAN)
  assert.equal(turn.match.view.skills.killer.track, 0)
  act(guest, turn, 'flare', undefined, 'invalid')
  await guest.next(error)
  act(guest, turn, 'stealth')
  const aiming = await guest.next(message => message.match?.view.skills.human.stealth === 0)
  act(guest, aiming, 'flare', undefined, 'east')
  const tracking = await host.next(message => message.match?.view.tracker?.steps === 4)
  assert.equal(tracking.match.view.count, null)
  assert.equal(tracking.match.view.health, null)
  assert.equal(tracking.match.view.positions.human, undefined)
  assert.equal(tracking.match.view.flare, undefined)
  assert.equal(tracking.match.view.skills.human.flare, 0)

  act(host, tracking, 'trackMove', 11)
  const moved = await host.next(message => message.match?.view.tracker?.at === 11)
  act(host, moved, 'trackMove', 10)
  const caught = await host.next(message => message.match?.view.humanStun === 2)
  assert.equal(caught.match.view.positions.human, 10)
  act(host, caught, 'wait')
  const skipped = await host.next(message => message.match?.view.round === 3 && message.match.view.humanStun === 1)
  assert.ok(skipped.match.log.some(event => event.kind === 'skip' && event.text.includes('人类因跟踪')))
  act(host, skipped, 'wait')
  const expired = await host.next(message => message.match?.view.round === 4)
  assert.equal(expired.match.view.positions.human, undefined)
  assert.equal(expired.match.view.count, null)
  assert.equal(expired.match.view.health, 2)
})
