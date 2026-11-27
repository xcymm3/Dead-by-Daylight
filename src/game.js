import { boardFor, STANDARD_BOARD } from './maps.js'
import { DIRECTIONS, canUse, hasSkill, makeLoadouts } from './skills.js'

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
export const DIFFICULTIES = { normal: '普通', hard: '困难', hell: '地狱' }
export const RECOVERY_LABELS = {
  hit: '命中后眩晕', vault: '翻窗中', break: '砸板中', stun: '木板砸晕',
  trap: '陷阱眩晕', flare: '信号枪眩晕', slash: '挥刀落空',
}
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

export function createGame(player, seed = Math.floor(Math.random() * 0x100000000), difficulty = 'normal', loadouts = {}) {
  return {
    player,
    difficulty,
    positions: { [KILLER]: null, [HUMAN]: null },
    turn: KILLER,
    round: 0,
    steps: 2,
    ...(Object.values(loadouts).some(ids => ids.length) && { skills: makeLoadouts(loadouts) }),
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

const offsets = { north: [-1, 0], east: [0, 1], south: [1, 0], west: [0, -1] }

function offsetCell(at, rowDelta, colDelta) {
  const row = Math.floor(at / WIDTH) + rowDelta
  const col = at % WIDTH + colDelta
  return row >= 1 && row <= 5 && col >= 0 && col < WIDTH ? row * WIDTH + col : null
}

export function skillArea(at, direction, kind) {
  const [row, col] = offsets[direction]
  const pattern = kind === 'slash' ? [[1, -1], [1, 0], [1, 1]]
    : [[1, 0], [2, -1], [2, 0], [2, 1], [3, -1], [3, 0], [3, 1]]
  return pattern.map(([forward, side]) => offsetCell(at, forward * row + side * col, forward * col - side * row))
    .filter(cell => cell !== null)
}

export function nearby(at, other) {
  return other != null && Math.abs(Math.floor(at / WIDTH) - Math.floor(other / WIDTH)) <= 1 &&
    Math.abs(at % WIDTH - other % WIDTH) <= 1
}

function concealed(game, metric) {
  return (game.stealthUntil ?? 0) > game.round ||
    (metric === 'count' && hasSkill(game, KILLER, 'sabotage'))
}

function frenzy(game) {
  return hasSkill(game, KILLER, 'frenzy') && game.repaired.length >= 3
}

export function stunRemaining(recovery) {
  return ['hit', 'stun', 'trap', 'flare'].includes(recovery?.kind) ? recovery.remaining : 0
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
  if (game.skills) Object.assign(common, {
    skills: game.skills,
    blockedWindows: game.blockedWindows ?? [],
    humanStun: game.humanStun ?? 0,
    tracker: game.tracker ?? null,
    killerMoved: Boolean(game.killerMoved),
    slashed: Boolean(game.slashed),
    ...(viewer === HUMAN && {
      rage: frenzy(game), healing: game.healing ?? 0, trap: game.trap ?? null, flare: game.flare ?? null,
      stealthUntil: game.stealthUntil ?? 0, focused: game.focusRound === game.round,
    }),
  })
  if (viewer === KILLER) {
    const watcher = game.watcher && {
      ...game.watcher, nearby: game.round >= game.watcher.start ? nearby(game.watcher.at, game.positions[HUMAN]) : null,
    }
    return {
      ...common,
      ...(game.skills && { watcher: watcher ?? null, snipe: concealed(game, 'health') ? null : game.snipe ?? 0 }),
      health: concealed(game, 'health') ? null : common.health,
      count: concealed(game, 'count') ? null : common.count,
      positions: { [KILLER]: game.positions[KILLER],
        ...(game.round < game.revealUntil && { [HUMAN]: game.positions[HUMAN] }) },
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
  if (tile === 'window' && view.blockedWindows?.includes(to)) return null
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

function isGround(view, to) {
  return ['empty', 'machine', 'pallet'].includes(terrain(to, view.campaignLevel)) && view.pallets[to] !== 'dropped'
}

export function blinkOptions(view, role) {
  if (!canUse(view, role, 'blink')) return []
  return Object.keys(DIRECTIONS).flatMap(direction => {
    const [row, col] = offsets[direction]
    const to = offsetCell(view.positions[role], 2 * row, 2 * col)
    return isGround(view, to) && (role === KILLER || to !== view.positions[KILLER])
      ? [{ kind: 'blink', direction, to, land: to }] : []
  })
}

function skillOptions(view, role) {
  const options = blinkOptions(view, role)
  if (role === HUMAN) {
    if (canUse(view, HUMAN, 'trap') && !view.trap) options.push({ kind: 'trap' })
    if (canUse(view, HUMAN, 'stealth')) options.push({ kind: 'stealth' })
    if (canUse(view, HUMAN, 'flare')) {
      for (const direction of Object.keys(DIRECTIONS)) options.push({ kind: 'flare', direction })
    }
  } else {
    for (const kind of ['watch', 'track']) {
      if (!view.killerMoved && canUse(view, KILLER, kind)) options.push({ kind })
    }
    if (view.killerMoved && !view.slashed && hasSkill(view, KILLER, 'slash')) {
      for (const direction of Object.keys(DIRECTIONS)) options.push({ kind: 'slash', direction })
    }
  }
  return options
}

export function turnOptions(view, role) {
  const from = view.positions[role]
  if (role === HUMAN && view.humanStun > 0) return []
  if (role === KILLER && view.recovery?.remaining > 0) return []
  if (role === KILLER && view.tracker?.started) {
    const options = [{ kind: 'trackCancel' }, { kind: 'trackWait' }]
    for (const to of adjacent(view.tracker.at)) {
      if (isGround(view, to)) options.push({ kind: 'trackMove', to, land: to })
    }
    return options
  }
  if (role === KILLER && (view.recovery?.kind === 'stun' || view.recovery?.sidestep)) {
    return [from - 1, from + 1].filter(to => adjacent(from).includes(to) && isGround(view, to))
      .map(to => ({ kind: 'sidestep', to, land: to }))
  }

  const options = role === KILLER && view.steps === 0 ? [] : adjacent(from).map(to => movement(view, role, from, to)).filter(Boolean)
  if (role === HUMAN) {
    for (const to of adjacent(from)) {
      if (terrain(to, view.campaignLevel) === 'pallet' && !view.pallets[to]) options.push({ kind: 'drop', to })
    }
    if (terrain(from, view.campaignLevel) === 'machine' && !view.repaired.includes(from)) {
      options.push({ kind: 'repair', to: from })
      if (!(view.health === 1 && hasSkill(view, HUMAN, 'healing'))) return [...options, ...skillOptions(view, role)]
    }
  }
  options.push({ kind: 'wait' })
  return [...options, ...skillOptions(view, role)]
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

function record(game, text, audience = 'public', kind = 'action', metric) {
  const event = { round: game.round, text, audience, kind, ...(metric && { metric }) }
  return { ...game, log: [...game.log.slice(-99), event] }
}

export function visibleLog(game, viewer = game.player) {
  return game.log.filter(event => viewer === HUMAN || (event.audience !== HUMAN &&
    (!event.metric || !concealed(game, event.metric))))
}

export function recentMessages(game, viewer = game.player) {
  return visibleLog(game, viewer).slice(-16)
}

function captureRound(game) {
  const { round, positions, health, repaired, pallets, winner, escapedThrough } = game
  const frame = { layout: GATE_LAYOUT, round, positions, health, repaired, count: repaired.length, pallets, winner, escapedThrough,
    ...(game.skills && { skills: game.skills, blockedWindows: game.blockedWindows }),
    ...(stunRemaining(game.recovery) > 0 && { recovery: game.recovery }),
  }
  if (game.campaignLevel) frame.campaignLevel = game.campaignLevel
  return { ...game, replay: [...game.replay, frame] }
}

function endTurn(game) {
  if (game.turn === KILLER) {
    let next = { ...game, turn: HUMAN, steps: 0 }
    if (game.trap || game.focusRound) next = { ...next, trap: null, focusRound: null }
    if (game.flare) {
      const { at, direction } = game.flare
      const landed = skillArea(at, direction, 'flare').includes(game.positions[KILLER])
      next = record({ ...next, flare: null }, `人类向${DIRECTIONS[direction]}发射信号枪。`, HUMAN)
      if (landed) next = record(stun(next, 'flare', 3), '屠夫被信号枪命中，眩晕 3 回合。')
    }
    return next
  }
  return startKillerTurn({ ...captureRound(game), round: game.round + 1 })
}

function startKillerTurn(game) {
  let next = { ...game, turn: KILLER, steps: frenzy(game) ? 3 : 2 }
  if (game.skills) next = { ...next, killerMoved: false, slashed: false }
  if (hasSkill(game, KILLER, 'snipe') && game.health === 2) {
    const snipe = (game.snipe ?? 0) + 1
    next = { ...next, snipe }
    if (snipe === 5) next = record(wound(next), '狙杀生效，人类失去 1 点生命。', concealed(next, 'health') ? HUMAN : 'public', 'action', 'health')
  }
  if (game.tracker && !(game.recovery?.remaining > 0)) {
    next = { ...next, tracker: { ...game.tracker, started: true, steps: 4 } }
    if (game.tracker.at === game.positions[HUMAN]) return trackerContact(next)
  }
  return next
}

function setPosition(game, role, to) {
  const visits = role === KILLER
    ? { ...game.visits, [to]: (game.visits[to] ?? 0) + 1 }
    : game.visits
  return { ...game, positions: { ...game.positions, [role]: to }, visits }
}

function spend(game, role, id) {
  return { ...game, skills: { ...game.skills, [role]: { ...game.skills[role], [id]: game.skills[role][id] - 1 } } }
}

function stun(game, kind, remaining) {
  if (stunRemaining(game.recovery) > remaining) return game
  const sidestep = kind !== 'stun' && (game.recovery?.kind === 'stun' || game.recovery?.sidestep)
  return { ...game, recovery: { kind, remaining, ...(sidestep && { sidestep: true }) } }
}

function wound(game) {
  return { ...game, health: game.health - 1, ...(game.skills && { healing: 0, snipe: 0 }) }
}

function healthy(game, text) {
  return record({ ...game, health: 2, healing: 0 }, text, HUMAN)
}

function progressHealing(game, kind) {
  if (game.health !== 1 || !hasSkill(game, HUMAN, 'healing')) return game
  const healing = (game.healing ?? 0) + (kind === 'wait' ? 2 : 1)
  return healing >= 8 ? healthy(game, '治疗进度达到 8，人类恢复 1 点生命。') : { ...game, healing }
}

function protectedFromHit(game) {
  return game.focusRound === game.round || game.hitRound === game.round
}

function hit(game, canContinue) {
  const damaged = wound(game)
  const rage = frenzy(game)
  const remaining = 2 + Number(hasSkill(game, HUMAN, 'strong'))
  let next = rage ? { ...damaged, hitRound: game.round } : stun(damaged, 'hit', remaining)
  if (concealed(game, 'health')) next = record(next, '屠夫命中人类。')
  next = record(next, `屠夫命中，人类剩余 ${next.health} 点生命。`, concealed(game, 'health') ? HUMAN : 'public', 'action', 'health')
  if (next.health === 0) return captureRound(record({ ...next, winner: KILLER, steps: 0 }, '屠夫获胜。'))
  return rage && canContinue ? continueKiller(next) : endTurn(next)
}

function trackerContact(game) {
  if (game.focusRound === game.round) return game
  return record({ ...game, tracker: null, humanStun: 2, revealUntil: game.round + 2 },
    '跟踪者接触人类，人类跳过 2 回合并暴露位置。')
}

export function skippingRole(game) {
  if (game.winner || isPlacement(game)) return null
  if (game.turn === KILLER && game.recovery?.remaining > 0) return KILLER
  return game.turn === HUMAN && game.humanStun > 0 ? HUMAN : null
}

export function skipTurn(game) {
  if (skippingRole(game) === HUMAN) {
    const humanStun = game.humanStun - 1
    return endTurn(record({ ...game, humanStun }, `人类因跟踪跳过本回合，剩余 ${humanStun} 回合。`, 'public', 'skip'))
  }
  return skipKillerTurn(game)
}

export function skipKillerTurn(game) {
  if (game.winner || game.turn !== KILLER || !game.recovery?.remaining) return game
  const recovery = { ...game.recovery, remaining: game.recovery.remaining - 1 }
  const reason = RECOVERY_LABELS[recovery.kind]
  const summary = `屠夫跳过本回合（${reason}，剩余 ${recovery.remaining} 回合）。`
  let next = record({ ...game, recovery }, summary, KILLER, 'skip')
  if (recovery.remaining === 0 && recovery.kind !== 'stun' && !recovery.sidestep) {
    next = { ...next, recovery: null }
    if (recovery.kind === 'vault') {
      if (recovery.window !== undefined) next = { ...next, blockedWindows: [...(next.blockedWindows ?? []), recovery.window] }
      next = record(next, `屠夫翻窗抵达 ${coordinate(recovery.to)}。`, KILLER)
      return killerLand(next, recovery.to, false)
    }
    if (recovery.kind === 'break') {
      next = breakPallet(next, recovery.to)
    }
  }
  return endTurn(next)
}

export function play(game, request) {
  if (!request) return game
  const action = actionsFor(game).find(option =>
    option.kind === request.kind && option.to === request.to && option.direction === request.direction)
  if (!action) return game
  const role = activeRole(game)
  const { kind, to } = action
  if (kind === 'spawn') {
    const placement = record(game, `${ROLES[role]}选择出生点。`)
    const placed = record(setPosition(placement, role, to), `${ROLES[role]}在 ${coordinate(to)} 出生。`, role)
    return role === HUMAN ? startKillerTurn({ ...captureRound(placed), round: 1 }) : placed
  }
  if (role === HUMAN) return playHuman(game, action)
  return playKiller(game, action)
}

function playHuman(game, { kind, to, land, direction }) {
  game = progressHealing(game, kind)
  if (kind === 'trap') return record({ ...spend(game, HUMAN, kind), trap: { at: game.positions[HUMAN] } }, '人类在原地布置陷阱。', HUMAN)
  if (kind === 'stealth') return record({ ...spend(game, HUMAN, kind), stealthUntil: game.round + 3 }, '人类发动隐秘，效果持续 3 轮。', HUMAN)
  if (kind === 'flare') {
    const next = { ...spend(game, HUMAN, kind), flare: { at: game.positions[HUMAN], direction } }
    return endTurn(record(next, `人类举起信号枪，瞄向${DIRECTIONS[direction]}。`, HUMAN))
  }
  if (kind === 'blink') return record(setPosition(spend(game, HUMAN, kind), HUMAN, to), `人类闪现至 ${coordinate(to)}。`, HUMAN)
  if (kind === 'repair') {
    const repaired = [...game.repaired, to]
    let next = record({ ...game, repaired }, `人类点亮了 ${coordinate(to)} 的灯。`, HUMAN)
    if (hasSkill(game, HUMAN, 'focus')) next = { ...next, focusRound: game.round + 1 }
    if (repaired.length === 3) {
      next = record(next, '已点亮 3 盏灯，两扇出口门开启。', concealed(game, 'count') ? HUMAN : 'public', 'action', 'count')
      if (hasSkill(game, HUMAN, 'escape') && !game.thirdLamp) {
        next = { ...next, thirdLamp: true }
        if (next.health === 1) next = healthy(next, '逃生生效，人类恢复健康。')
      }
    }
    return endTurn(next)
  }
  if (kind === 'drop') {
    let next = record({ ...game, pallets: { ...game.pallets, [to]: 'dropped' } },
      `人类放下了 ${coordinate(to)} 的木板。`, HUMAN)
    if (game.positions[KILLER] === to) {
      const remaining = hasSkill(game, HUMAN, 'strong') ? 5 : STUN_TURNS
      next = record({
        ...stun(next, 'stun', remaining),
        knownPallets: { ...next.knownPallets, [to]: 'dropped' },
      }, `屠夫被木板砸晕，跳过 ${remaining} 个回合。`, KILLER)
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

function breakPallet(game, to) {
  return record({
    ...game,
    pallets: { ...game.pallets, [to]: 'broken' },
    knownPallets: { ...game.knownPallets, [to]: 'broken' },
  }, `屠夫砸碎了 ${coordinate(to)} 的木板。`, KILLER)
}

function continueKiller(game) {
  return game.steps > 0 || (game.killerMoved && !game.slashed && hasSkill(game, KILLER, 'slash'))
    ? game : endTurn(game)
}

function killerLand(game, to, canContinue = true) {
  let next = setPosition(game, KILLER, to)
  if (canUse(next, KILLER, 'sabotage') && next.repaired.includes(to)) {
    next = record({ ...spend(next, KILLER, 'sabotage'), repaired: next.repaired.filter(at => at !== to) },
      `屠夫破坏了 ${coordinate(to)} 的灯。`)
  }
  if (next.trap?.at === to) {
    next = record(stun({ ...next, trap: null }, 'trap', 2), '屠夫踩中陷阱，眩晕 2 回合。')
    return endTurn(next)
  }
  if (to === game.positions[HUMAN] && !protectedFromHit(next)) return hit(next, canContinue)
  return canContinue ? continueKiller(next) : endTurn(next)
}

function playKiller(game, { kind, to, land, direction }) {
  if (kind === 'wait') return endTurn(record(game, '屠夫结束行动。', KILLER))
  if (kind === 'watch' || kind === 'track') {
    const at = game.positions[KILLER]
    const next = { ...spend(game, KILLER, kind), [kind === 'watch' ? 'watcher' : 'tracker']:
      kind === 'watch' ? { at, start: game.round + 1 } : { at, started: false, steps: 0 } }
    return endTurn(record(next, `屠夫在 ${coordinate(at)} 放置${kind === 'watch' ? '监视者' : '跟踪者'}。`, KILLER))
  }
  if (kind === 'trackCancel') return record({ ...game, tracker: null }, '屠夫收回跟踪者。', KILLER)
  if (kind === 'trackWait') return endTurn(game)
  if ((kind === 'blink' || kind === 'trackMove') && game.pallets[to] === 'dropped') {
    return record({ ...game, knownPallets: { ...game.knownPallets, [to]: 'dropped' } },
      `${coordinate(to)} 的木板已放下，无法抵达。`, KILLER)
  }
  if (kind === 'trackMove') {
    const tracker = { ...game.tracker, at: to, steps: game.tracker.steps - 1 }
    const moved = { ...game, tracker }
    const next = to === game.positions[HUMAN] ? trackerContact(moved) : moved
    return !next.tracker || tracker.steps > 0 ? next : endTurn(next)
  }
  if (kind === 'slash') {
    const next = { ...game, slashed: true }
    const inRange = skillArea(game.positions[KILLER], direction, kind).includes(game.positions[HUMAN])
    if (inRange && !protectedFromHit(next)) return hit(next, true)
    return endTurn(record({ ...next, recovery: { kind: 'slash', remaining: 1 } }, '屠夫挥刀落空，跳过 1 回合。', KILLER))
  }
  if (kind === 'blink') {
    return killerLand(record(spend(game, KILLER, kind), `屠夫闪现至 ${coordinate(to)}。`, KILLER), to)
  }
  if (game.pallets[to] === 'dropped') {
    if (hasSkill(game, KILLER, 'lockdown')) {
      return continueKiller(breakPallet({ ...game, steps: game.steps - 1 }, to))
    }
    return endTurn(record({
      ...game,
      knownPallets: { ...game.knownPallets, [to]: 'dropped' },
      recovery: { kind: 'break', remaining: 1, to },
    }, `屠夫在板前停步，下回合砸碎 ${coordinate(to)} 的木板。`, KILLER))
  }
  if (kind === 'vault') {
    return endTurn(record({
      ...game, recovery: { kind: 'vault', remaining: 1, to: land,
        ...(hasSkill(game, KILLER, 'lockdown') && { window: to }) },
    }, '屠夫开始翻窗，将跳过下一个回合。', KILLER))
  }
  const moved = record({ ...game, steps: game.steps - 1, ...(game.skills && { killerMoved: true }),
    ...(kind === 'sidestep' && { recovery: null }) }, `屠夫移动到 ${coordinate(to)}。`, KILLER)
  return killerLand(moved, to)
}
