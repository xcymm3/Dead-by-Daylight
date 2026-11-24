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

function act(client, state, kind, to) {
  client.send({ type: 'action', revision: state.revision, action: { kind, to } })
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
  assert.ok(firstMove.match.log.every(event => !event.text.includes('人类')))
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
  assert.deepEqual(guestResult.match.replay[0].positions, { [KILLER]: 6, [HUMAN]: 8 })
  assert.equal(guestResult.match.replay.at(-1).winner, KILLER)
})
