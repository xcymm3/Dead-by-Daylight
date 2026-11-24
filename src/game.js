export const HUMAN = 'human'
export const KILLER = 'killer'
export const ROLES = { [HUMAN]: '人类', [KILLER]: '屠夫' }
export const WIDTH = 5
export const MACHINES = [5, 9, 25, 29]
export const PALLETS = [7, 27]
export const EXITS = [2, 32]
export const WINDOW = 17
export const WALLS = [12, 22]

export function terrain(at) {
  if (EXITS.includes(at)) return 'exit'
  if (at < 5 || at >= 30 || !Number.isInteger(at)) return null
  if (MACHINES.includes(at)) return 'machine'
  if (PALLETS.includes(at)) return 'pallet'
  if (WALLS.includes(at)) return 'wall'
  if (at === WINDOW) return 'window'
  return 'empty'
}

export const SPAWNS = Array.from({ length: 25 }, (_, i) => i + 5)
  .filter(at => terrain(at) === 'empty')

export function coordinate(at) {
  if (at === EXITS[0]) return '北出口'
  if (at === EXITS[1]) return '南出口'
  return `${'ABCDE'[at % WIDTH]}${Math.floor(at / WIDTH)}`
}

export function adjacent(at) {
  const column = at % WIDTH
  return [at - WIDTH, column > 0 ? at - 1 : null, column < 4 ? at + 1 : null, at + WIDTH]
    .filter(next => next !== null && terrain(next))
}

export function createGame(player, seed = Math.floor(Math.random() * 0x100000000)) {
  return {
    player,
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
    seed,
    visits: {},
    log: [],
  }
}

export function project(game, viewer) {
  const common = {
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
  if (game.positions[KILLER] === null) return KILLER
  if (game.positions[HUMAN] === null) return HUMAN
  return game.turn
}

export function isPlacement(game) {
  return game.positions[HUMAN] === null
}

export function movement(view, role, from, to) {
  const tile = terrain(to)
  if (tile === 'wall' || !tile) return null
  const exitAllowed = at => role === HUMAN && view.count >= 3
    && from === at + (at === EXITS[0] ? WIDTH : -WIDTH)
  if (tile === 'exit' && !exitAllowed(to)) return null

  const droppedPallet = tile === 'pallet' && view.pallets[to] === 'dropped'
  if (droppedPallet && role === KILLER) {
    return { kind: 'break', to, land: from }
  }
  if (droppedPallet && view.count >= 3 && Math.abs(from - to) === 1) {
    const exit = EXITS.find(at => Math.abs(at - to) === WIDTH)
    if (exit !== undefined) return { kind: 'vault', to, land: exit }
  }

  const vault = tile === 'window' || droppedPallet
  const land = vault ? to + (to - from) : to
  if (vault) {
    const landing = terrain(land)
    if (!adjacent(to).includes(land)) return null
    if (landing !== 'empty' && !(tile === 'pallet' && landing === 'exit' && view.count >= 3)) return null
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
      if (PALLETS.includes(to) && !view.pallets[to]) options.push({ kind: 'drop', to })
    }
    if (MACHINES.includes(from) && !view.repaired.includes(from)) {
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
    return SPAWNS.filter(to => role === KILLER || to !== game.positions[KILLER])
      .map(to => ({ kind: 'spawn', to }))
  }
  return turnOptions(project(game, role), role)
}

function record(game, text, audience = 'public') {
  const event = { round: game.round, text, audience }
  return { ...game, log: [...game.log.slice(-99), event] }
}

export function visibleLog(game) {
  return game.log.filter(event => game.player === HUMAN || event.audience !== HUMAN)
}

function endTurn(game) {
  if (game.turn === KILLER) return { ...game, turn: HUMAN, steps: 0 }
  return { ...game, turn: KILLER, round: game.round + 1, steps: 2 }
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
    ? record({ ...next, winner: KILLER, steps: 0 }, '屠夫获胜。')
    : endTurn(next)
}

export function skipKillerTurn(game) {
  if (game.winner || game.turn !== KILLER || !game.recovery?.remaining) return game
  const recovery = { ...game.recovery, remaining: game.recovery.remaining - 1 }
  let next = record({ ...game, recovery }, '屠夫跳过本回合。', KILLER)
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
    const placed = record(setPosition(game, role, to), `${ROLES[role]}在 ${coordinate(to)} 出生。`, role)
    return role === HUMAN ? { ...placed, round: 1 } : placed
  }
  if (role === HUMAN) return playHuman(game, action)
  return playKiller(game, action)
}

function playHuman(game, { kind, to, land }) {
  if (kind === 'repair') {
    const repaired = [...game.repaired, to]
    const next = record({ ...game, repaired }, `人类修好了 ${coordinate(to)} 的机器。`, HUMAN)
    return endTurn(repaired.length === 3 ? record(next, '已修好 3 台机器，出口开放。') : next)
  }
  if (kind === 'drop') {
    let next = record({ ...game, pallets: { ...game.pallets, [to]: 'dropped' } },
      `人类放下了 ${coordinate(to)} 的木板。`, HUMAN)
    if (game.positions[KILLER] === to) {
      next = record({
        ...next,
        knownPallets: { ...next.knownPallets, [to]: 'dropped' },
        recovery: { kind: 'stun', remaining: 2 },
      }, '屠夫被木板砸晕，跳过 2 个回合。', KILLER)
    }
    return endTurn(next)
  }
  if (kind === 'wait') return endTurn(record(game, '人类原地等待。', HUMAN))

  const moved = setPosition(game, HUMAN, land)
  if (EXITS.includes(land)) return record({ ...moved, winner: HUMAN }, '人类成功从出口撤离。')
  const verb = kind === 'move' ? '移动到' : terrain(to) === 'window' ? '翻窗抵达' : '翻板抵达'
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
