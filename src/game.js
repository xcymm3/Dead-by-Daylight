import { boardFor, STANDARD_BOARD } from './maps.js'

export const HUMAN = 'human'
export const KILLER = 'killer'
export const ROLES = { [HUMAN]: '人类', [KILLER]: '屠夫' }
export const WIDTH = 5
export const MACHINES = STANDARD_BOARD.machines
export const PALLETS = STANDARD_BOARD.pallets
export const EXITS = [2, 32]
export const EXIT_APPROACHES = [15, 19]
export const COURTYARD_LAYOUT = 'courtyard'
export const GATE_LAYOUT = 'courtyard-gates'
export const DIFFICULTIES = { normal: '普通', hard: '困难' }
export const RECOVERY_LABELS = { hit: '命中后恢复', vault: '翻窗中', break: '砸板中', stun: '木板砸晕' }
export const STUN_TURNS = 3
export const WINDOW = STANDARD_BOARD.window
export const WALLS = STANDARD_BOARD.walls

export function terrain(at, campaignLevel) {
  if (EXITS.includes(at)) return 'exit'
  if (at < 5 || at >= 30 || !Number.isInteger(at)) return null
  return boardFor(campaignLevel).tiles[at - 5]
}

export const SPAWNS = STANDARD_BOARD.spawns

export function coordinate(at, layout = GATE_LAYOUT) {
  const exit = EXITS.indexOf(at)
  if (exit !== -1) {
    if (layout === GATE_LAYOUT) return ['西门', '东门'][exit]
    return (layout === COURTYARD_LAYOUT ? ['西地窖', '东地窖'] : ['北出口', '南出口'])[exit]
  }
  return `${'ABCDE'[at % WIDTH]}${Math.floor(at / WIDTH)}`
}

export function adjacent(at) {
  const exit = EXITS.indexOf(at)
  if (exit !== -1) return [EXIT_APPROACHES[exit]]
  const column = at % WIDTH
  return [
    at >= 10 ? at - WIDTH : null,
    column > 0 ? at - 1 : at === EXIT_APPROACHES[0] ? EXITS[0] : null,
    column < 4 ? at + 1 : at === EXIT_APPROACHES[1] ? EXITS[1] : null,
    at < 25 ? at + WIDTH : null,
  ]
    .filter(next => next !== null && terrain(next))
}

export function createGame(player, seed = Math.floor(Math.random() * 0x100000000), difficulty = 'normal') {
  return {
    player,
    difficulty,
    positions: { [KILLER]: null, [HUMAN]: null },
    turn: KILLER,
    round: 0,
    steps: 2,
    health: 2,
    repaired: [],
    pallets: {},
    knownPallets: {},
    recovery: null,
    winner: null,
    escapedThrough: null,
    seed,
    visits: {},
    log: [],
    replay: [],
  }
}

export function project(game, viewer) {
  const common = {
    ...(game.campaignLevel && { campaignLevel: game.campaignLevel }),
    round: game.round,
    turn: game.turn,
    steps: game.steps,
    health: game.health,
    count: game.repaired.length,
    recovery: game.recovery,
    winner: game.winner,
  }
  if (viewer === KILLER) {
    return {
      ...common,
      positions: { [KILLER]: game.positions[KILLER] },
      pallets: game.knownPallets,
      visits: game.visits,
    }
  }
  return { ...common, positions: game.positions, pallets: game.pallets, repaired: game.repaired }
}

export function activeRole(game) {
  if (game.winner) return game.turn
  if (game.positions[KILLER] === null) return KILLER
  if (game.positions[HUMAN] === null) return HUMAN
  return game.turn
}

export function isPlacement(game) {
  return !game.winner && game.positions[HUMAN] === null
}

export function movement(view, role, from, to) {
  const tile = terrain(to, view.campaignLevel)
  if (tile === 'wall' || !tile) return null
  if (tile === 'exit' && (role !== HUMAN || view.count < 3 || from !== EXIT_APPROACHES[EXITS.indexOf(to)])) return null

  const droppedPallet = tile === 'pallet' && view.pallets[to] === 'dropped'
  if (droppedPallet && role === KILLER) {
    return { kind: 'break', to, land: from }
  }
  const vault = tile === 'window' || droppedPallet
  const land = vault ? to + (to - from) : to
  if (vault) {
    const landing = terrain(land, view.campaignLevel)
    if (!adjacent(to).includes(land)) return null
    if (landing !== 'empty') return null
  }
  if (role === HUMAN && land === view.positions[KILLER]) return null
  return { kind: vault ? 'vault' : 'move', to, land }
}

export function turnOptions(view, role) {
  const from = view.positions[role]
  if (role === KILLER && view.recovery?.remaining > 0) return []
  if (role === KILLER && view.recovery?.kind === 'stun') {
    return [from - 1, from + 1].map(to => ({ kind: 'sidestep', to, land: to }))
  }

  const options = adjacent(from).map(to => movement(view, role, from, to)).filter(Boolean)
  if (role === HUMAN) {
    for (const to of adjacent(from)) {
      if (terrain(to, view.campaignLevel) === 'pallet' && !view.pallets[to]) options.push({ kind: 'drop', to })
    }
    if (terrain(from, view.campaignLevel) === 'machine' && !view.repaired.includes(from)) {
      return [...options, { kind: 'repair', to: from }]
    }
  }
  options.push({ kind: 'wait' })
  return options
}

export function actionsFor(game) {
  if (game.winner) return []
  const role = activeRole(game)
  if (isPlacement(game)) {
    return boardFor(game.campaignLevel).spawns.filter(to => role === KILLER || to !== game.positions[KILLER])
      .map(to => ({ kind: 'spawn', to }))
  }
  return turnOptions(project(game, role), role)
}

function record(game, text, audience = 'public', kind = 'action') {
  const event = { round: game.round, text, audience, kind }
  return { ...game, log: [...game.log.slice(-99), event] }
}

export function visibleLog(game, viewer = game.player) {
  return game.log.filter(event => viewer === HUMAN || event.audience !== HUMAN)
}

export function recentMessages(game, viewer = game.player) {
  return visibleLog(game, viewer).slice(-16)
}

function captureRound(game) {
  const { round, positions, health, repaired, pallets, winner, escapedThrough } = game
  const frame = { layout: GATE_LAYOUT, round, positions, health, repaired, count: repaired.length, pallets, winner, escapedThrough }
  if (game.campaignLevel) frame.campaignLevel = game.campaignLevel
  return { ...game, replay: [...game.replay, frame] }
}

function endTurn(game) {
  if (game.turn === KILLER) return { ...game, turn: HUMAN, steps: 0 }
  return { ...captureRound(game), turn: KILLER, round: game.round + 1, steps: 2 }
}

function setPosition(game, role, to) {
  const visits = role === KILLER
    ? { ...game.visits, [to]: (game.visits[to] ?? 0) + 1 }
    : game.visits
  return { ...game, positions: { ...game.positions, [role]: to }, visits }
}

function hit(game) {
  const health = game.health - 1
  const next = record(
    { ...game, health, recovery: { kind: 'hit', remaining: 2 } },
    `屠夫命中，人类剩余 ${health} 点生命。`,
  )
  return health === 0
    ? captureRound(record({ ...next, winner: KILLER, steps: 0 }, '屠夫获胜。'))
    : endTurn(next)
}

export function skipKillerTurn(game) {
  if (game.winner || game.turn !== KILLER || !game.recovery?.remaining) return game
  const recovery = { ...game.recovery, remaining: game.recovery.remaining - 1 }
  const reason = RECOVERY_LABELS[recovery.kind]
  const summary = `屠夫跳过本回合（${reason}，剩余 ${recovery.remaining} 回合）。`
  let next = record({ ...game, recovery }, summary, KILLER, 'skip')
  if (recovery.remaining === 0 && recovery.kind !== 'stun') {
    next = { ...next, recovery: null }
    if (recovery.kind === 'vault') {
      next = record(setPosition(next, KILLER, recovery.to), `屠夫翻窗抵达 ${coordinate(recovery.to)}。`, KILLER)
      if (recovery.to === next.positions[HUMAN]) return hit(next)
    }
    if (recovery.kind === 'break') {
      next = record({
        ...next,
        pallets: { ...next.pallets, [recovery.to]: 'broken' },
        knownPallets: { ...next.knownPallets, [recovery.to]: 'broken' },
      }, `屠夫砸碎了 ${coordinate(recovery.to)} 的木板。`, KILLER)
    }
  }
  return endTurn(next)
}

export function play(game, request) {
  const action = actionsFor(game).find(option => option.kind === request.kind && option.to === request.to)
  if (!action) return game
  const role = activeRole(game)
  const { kind, to } = action
  if (kind === 'spawn') {
    const placement = record(game, `${ROLES[role]}选择出生点。`)
    const placed = record(setPosition(placement, role, to), `${ROLES[role]}在 ${coordinate(to)} 出生。`, role)
    return role === HUMAN ? { ...captureRound(placed), round: 1 } : placed
  }
  if (role === HUMAN) return playHuman(game, action)
  return playKiller(game, action)
}

function playHuman(game, { kind, to, land }) {
  if (kind === 'repair') {
    const repaired = [...game.repaired, to]
    const next = record({ ...game, repaired }, `人类点亮了 ${coordinate(to)} 的灯。`, HUMAN)
    return endTurn(repaired.length === 3 ? record(next, '已点亮 3 盏灯，两扇出口门开启。') : next)
  }
  if (kind === 'drop') {
    let next = record({ ...game, pallets: { ...game.pallets, [to]: 'dropped' } },
      `人类放下了 ${coordinate(to)} 的木板。`, HUMAN)
    if (game.positions[KILLER] === to) {
      next = record({
        ...next,
        knownPallets: { ...next.knownPallets, [to]: 'dropped' },
        recovery: { kind: 'stun', remaining: STUN_TURNS },
      }, `屠夫被木板砸晕，跳过 ${STUN_TURNS} 个回合。`, KILLER)
    }
    return endTurn(next)
  }
  if (kind === 'wait') return endTurn(record(game, '人类原地等待。', HUMAN))

  if (EXITS.includes(land)) {
    const escaped = setPosition(game, HUMAN, null)
    return captureRound(record({ ...escaped, winner: HUMAN, escapedThrough: land }, `人类从${coordinate(land)}撤离。`))
  }
  const moved = setPosition(game, HUMAN, land)
  const verb = kind === 'move' ? '移动到' : terrain(to, game.campaignLevel) === 'window' ? '翻窗抵达' : '翻板抵达'
  return endTurn(record(moved, `人类${verb} ${coordinate(land)}。`, HUMAN))
}

function playKiller(game, { kind, to, land }) {
  if (kind === 'wait') return endTurn(record(game, '屠夫结束行动。', KILLER))
  if (game.pallets[to] === 'dropped') {
    return endTurn(record({
      ...game,
      knownPallets: { ...game.knownPallets, [to]: 'dropped' },
      recovery: { kind: 'break', remaining: 1, to },
    }, `屠夫在板前停步，下回合砸碎 ${coordinate(to)} 的木板。`, KILLER))
  }
  if (kind === 'vault') {
    return endTurn(record({
      ...game, recovery: { kind: 'vault', remaining: 1, to: land },
    }, '屠夫开始翻窗，将跳过下一个回合。', KILLER))
  }
  let moved = setPosition(game, KILLER, to)
  if (kind === 'sidestep') moved = { ...moved, recovery: null }
  moved = record(moved, `屠夫移动到 ${coordinate(to)}。`, KILLER)
  if (to === game.positions[HUMAN]) return hit(moved)
  return game.steps === 1 ? endTurn(moved) : { ...moved, steps: game.steps - 1 }
}
