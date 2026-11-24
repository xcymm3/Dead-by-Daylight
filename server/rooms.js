import { randomBytes, randomInt } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  HUMAN, KILLER, activeRole, actionsFor, createGame, isPlacement, play, project,
  skipKillerTurn, visibleLog,
} from '../src/game.js'

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const ROOM_GRACE = 10 * 60_000
const HEARTBEAT = 25_000
const opposite = role => role === HUMAN ? KILLER : HUMAN

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function seat(socket) {
  return { socket, token: randomBytes(24).toString('base64url'), role: null, ready: false }
}

const connected = player => player?.socket?.readyState === WebSocket.OPEN
const bothOnline = room => connected(room.host) && connected(room.guest)

export function createOnlineServer({ allowedOrigins = [], skipDelay = 550, reconnectWindow = ROOM_GRACE } = {}) {
  const rooms = new Map()
  const http = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('ok')
      return
    }
    response.writeHead(404).end()
  })
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 })

  http.on('upgrade', (request, socket, head) => {
    const path = request.url?.split('?')[0]
    if (path !== '/online' || (allowedOrigins.length && !allowedOrigins.includes(request.headers.origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws))
  })

  function warn(socket, message, code = 'invalid') {
    send(socket, { type: 'error', code, message })
  }

  function publish(room) {
    const game = room.game
    const active = game && activeRole(game)
    const online = bothOnline(room)
    for (const player of [room.host, room.guest]) {
      if (!player) continue
      const host = player === room.host
      send(player.socket, {
        type: 'room',
        code: room.code,
        host,
        role: player.role,
        guestJoined: Boolean(room.guest),
        guestReady: Boolean(room.guest?.ready),
        opponentOnline: Boolean(connected(host ? room.guest : room.host)),
        revision: room.revision,
        match: game ? {
          role: active,
          placing: isPlacement(game),
          view: project(game, player.role),
          actions: online && active === player.role ? actionsFor(game) : [],
          log: visibleLog(game, player.role).slice(-4),
          ...(game.winner ? { escapedThrough: game.escapedThrough, replay: game.replay } : {}),
        } : null,
      })
    }
  }

  function advance(room, next) {
    room.game = next
    room.revision++
    if (next.winner) room.expiresAt = Date.now() + reconnectWindow
    publish(room)
    scheduleSkip(room)
  }

  function scheduleSkip(room) {
    clearTimeout(room.skipTimer)
    const game = room.game
    if (!game || game.winner || !bothOnline(room) || activeRole(game) !== KILLER || !game.recovery?.remaining) return
    room.skipTimer = setTimeout(() => {
      if (bothOnline(room) && room.game === game) advance(room, skipKillerTurn(game))
    }, skipDelay)
  }

  function release(room, message) {
    clearTimeout(room.skipTimer)
    rooms.delete(room.code)
    for (const player of [room.host, room.guest]) {
      if (!player) continue
      send(player.socket, { type: 'roomClosed', message })
      player.socket = null
    }
  }

  function attach(client, room, player) {
    const old = player.socket
    player.socket = client.socket
    client.room = room
    client.player = player
    if (old && old !== client.socket) old.close(4001, 'Seat resumed')
    if (connected(room.host) && (!room.guest || connected(room.guest)) && !room.game?.winner) room.expiresAt = null
    send(client.socket, { type: 'session', code: room.code, token: player.token })
    publish(room)
    scheduleSkip(room)
  }

  function openSession(client, request) {
    const { socket } = client
    if (request.type === 'create') {
      if (rooms.size >= 1000) return warn(socket, '房间已满，请稍后再试。')
      let code
      do {
        code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('')
      } while (rooms.has(code))
      const room = { code, host: seat(socket), guest: null, revision: 0, game: null, expiresAt: null }
      rooms.set(code, room)
      return attach(client, room, room.host)
    }
    let room = typeof request.code === 'string' && rooms.get(request.code.trim().toUpperCase())
    if (room?.expiresAt && room.expiresAt <= Date.now()) {
      release(room, '房间已过期。')
      room = null
    }
    if (request.type === 'resume') {
      const player = room && typeof request.token === 'string'
        && [room.host, room.guest].find(member => member?.token === request.token)
      if (!player) return warn(socket, '房间已结束，或重连凭证已失效。', 'sessionExpired')
      return attach(client, room, player)
    }
    if (request.type === 'join') {
      if (!room) return warn(socket, '找不到该房间，请核对房间码。')
      if (room.guest || room.game) return warn(socket, '该房间已有两位玩家。')
      room.guest = seat(socket)
      if (room.host.role) room.guest.role = opposite(room.host.role)
      return attach(client, room, room.guest)
    }
    return warn(socket, '请先创建或加入房间。')
  }

  function handleLobby(client, request) {
    const { room, player, socket } = client
    if (request.type === 'chooseRole' && player === room.host && [HUMAN, KILLER].includes(request.role)) {
      if (room.host.role !== request.role) {
        room.host.role = request.role
        if (room.guest) {
          room.guest.role = opposite(request.role)
          room.guest.ready = false
        }
      }
      return publish(room)
    }
    if (request.type === 'ready' && player === room.guest && player.role && request.role === player.role && typeof request.ready === 'boolean') {
      player.ready = request.ready
      return publish(room)
    }
    if (request.type === 'start' && player === room.host && room.host.role && room.guest?.ready && bothOnline(room)) {
      return advance(room, createGame(null))
    }
    return warn(socket, '房主先选角色，来宾准备后才能开始。')
  }

  function handleMessage(client, request) {
    const { room, player, socket } = client
    if (!room || rooms.get(room.code) !== room || !player.socket) return openSession(client, request)
    if (player.socket !== socket) return
    if (request.type === 'leave') {
      if (!room.game?.winner) return release(room, '有玩家退出，房间已关闭。')
      player.socket = null
      send(socket, { type: 'roomClosed' })
      return publish(room)
    }
    const game = room.game
    if (!game) return handleLobby(client, request)
    if (request.type !== 'action' || game.winner || !bothOnline(room) || activeRole(game) !== player.role) {
      return warn(socket, '现在无法提交行动。')
    }
    if (request.revision !== room.revision) return warn(socket, '局面已变化，请按当前提示行动。')
    const action = request.action
    if (!action || typeof action.kind !== 'string') return warn(socket, '无效的行动。')
    const next = play(game, action)
    if (next === game) return warn(socket, '这一步不符合当前规则。')
    return advance(room, next)
  }

  sockets.on('connection', socket => {
    const client = { socket, alive: true, room: null, player: null }
    socket.on('pong', () => { client.alive = true })
    socket.on('error', () => socket.terminate())
    socket.on('message', (data, binary) => {
      let request
      try {
        if (!binary) request = JSON.parse(data.toString())
      } catch {
        return warn(socket, '消息格式无效。')
      }
      if (!request || typeof request.type !== 'string') return warn(socket, '消息格式无效。')
      handleMessage(client, request)
    })
    socket.on('close', () => {
      const { room, player } = client
      if (!room || !rooms.has(room.code) || player.socket !== socket) return
      player.socket = null
      room.expiresAt ??= Date.now() + reconnectWindow
      scheduleSkip(room)
      publish(room)
    })
    socket.checkAlive = () => {
      if (!client.alive) return socket.terminate()
      client.alive = false
      if (socket.readyState === WebSocket.OPEN) socket.ping()
    }
  })

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) socket.checkAlive()
    for (const room of rooms.values()) {
      if (room.expiresAt && room.expiresAt <= Date.now()) release(room, '房间已过期。')
    }
  }, HEARTBEAT)
  heartbeat.unref()

  function close(callback) {
    clearInterval(heartbeat)
    for (const room of rooms.values()) clearTimeout(room.skipTimer)
    rooms.clear()
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    http.close(callback)
  }

  return { http, close }
}
