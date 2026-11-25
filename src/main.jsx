import React, { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HUMAN, KILLER, ROLES, STUN_TURNS, WIDTH, EXITS, COURTYARD_LAYOUT, GATE_LAYOUT, DIFFICULTIES,
  activeRole, actionsFor, coordinate, createGame, isPlacement, project, terrain, visibleLog,
} from './game.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'
import { loadOnlineSession, useOnlineRoom } from './online-client.js'
import { OnlineLobby } from './online-lobby.jsx'
import { loadLastReplay, saveLastReplay } from './replay.js'
import { CharacterArt, GateArt, PerimeterArt, TerrainArt, WallRunArt } from './game-art.jsx'
import './tokens.css'
import './styles.css'
import './game-theme.css'

const TILE_NAMES = { empty: '空格', machine: '灯', window: '窗户', wall: '墙', pallet: '木板', exit: '地窖' }
const LEGACY_NAMES = { machine: '机器', exit: '出口' }
const ART_TYPES = { machine: 'lamp', exit: 'hatch' }
const LEGEND = ['machine', 'wall', 'window', 'pallet', 'exit']
const LEGACY_CELLS = Array.from({ length: 35 }, (_, i) => i)
const GATE_CELLS = Array.from({ length: 25 }, (_, i) => i + WIDTH)
const COURTYARD_CELLS = Array.from({ length: 35 }, (_, slot) => {
  const row = Math.floor(slot / 7)
  const column = slot % 7
  if (column === 0 || column === 6) return row === 2 ? EXITS[Number(column === 6)] : null
  return (row + 1) * WIDTH + column - 1
})
const ROLES_INFO = {
  [HUMAN]: '点亮 3 盏灯，再从任一出口门撤离。',
  [KILLER]: '根据亮灯数量巡查，将人类生命降至 0。',
}
const RECOVERY = { hit: '命中后恢复', vault: '翻窗中', break: '砸板中', stun: '木板砸晕' }

function TileIcon({ type }) {
  return <i aria-hidden="true" className={`tile-icon icon-${type}`} />
}

function actionLabel(action) {
  const at = action.to === undefined ? '' : coordinate(action.to)
  switch (action.kind) {
    case 'spawn': return `在 ${at} 出生`
    case 'vault':
      return `从 ${at}${terrain(action.to) === 'window' ? '翻窗' : '翻板'}至 ${coordinate(action.land)}`
    case 'break': return `砸碎 ${at} 的木板`
    case 'sidestep': return `向侧面移动至 ${at}`
    default: return terrain(action.to) === 'exit' ? `进入${at}` : `移动至 ${at}`
  }
}

function Board({ view, actions, onAction, gameStyle, replayRound, layout }) {
  const gated = layout === GATE_LAYOUT
  const legacy = !gated && layout !== COURTYARD_LAYOUT
  const cells = gated ? GATE_CELLS : legacy ? LEGACY_CELLS : COURTYARD_CELLS
  const columnCount = gated || legacy ? 5 : 7
  const tileName = type => (gated && type === 'exit' ? '出口门' : (legacy && LEGACY_NAMES[type]) || TILE_NAMES[type])
  const artType = type => (legacy ? type : ART_TYPES[type]) ?? type
  const byTarget = new Map(actions
    .filter(action => ['spawn', 'move', 'vault', 'break', 'sidestep'].includes(action.kind))
    .map(action => [action.to, action]))
  return (
    <section className="panel map-panel" aria-labelledby="map-title">
      <div className="panel-title map-title">
        <h2 id="map-title">区域地图</h2>
        <span className="mono map-size">5 × 5</span>
      </div>
      <div className="map-surface">
        <div className={`plan ${legacy ? 'legacy-plan' : 'courtyard-plan'} ${gated ? 'gate-plan' : ''}`}>
          <div className="columns mono" aria-hidden="true">
            {[...'ABCDE'].map((letter, i) => <span key={letter} style={{ gridColumn: i + (columnCount === 5 ? 1 : 2) }}>{letter}</span>)}
          </div>
          <div className="rows mono" aria-hidden="true">
            {[1, 2, 3, 4, 5].map(row => <span key={row} style={{ gridRow: row + (legacy ? 1 : 0) }}>{row}</span>)}
          </div>
          <div className="board" aria-label="演练地图">
            {cells.map((at, slot) => {
              const type = terrain(at)
              if (!type) return <div key={slot} aria-hidden="true" />
              const action = byTarget.get(at)
              const condition = view?.pallets[at] ?? (view?.repaired?.includes(at) ? 'repaired' : '')
              const open = type === 'exit' && view?.count >= 3
              const piece = Object.keys(ROLES).filter(role => view?.positions[role] === at)
              const name = type === 'exit' ? coordinate(at, layout) : `${coordinate(at)} ${tileName(type)}`
              const status = legacy ? { repaired: '已修好', dropped: '已放下', broken: '已砸碎' }[condition]
                : { repaired: '已点亮', dropped: '已放下', broken: '已砸碎' }[condition] ??
                  (type === 'pallet' ? '靠墙，可通行' : type === 'machine' ? '未点亮' : null)
              const label = [name, status, type === 'exit' && (open ? '已开放' : '未开放'),
                ...piece.map(role => ROLES[role]), action && actionLabel(action)].filter(Boolean).join('，')
              return (
                <button key={slot} type="button" className={`tile tile-${type} ${condition} ${open ? 'open' : ''}`}
                  aria-label={label} title={label}
                  aria-disabled={!action} tabIndex={action ? 0 : -1}
                  onClick={() => action && onAction(action)}>
                  {gameStyle
                    ? (type === 'machine' || type === 'exit') && <TerrainArt type={artType(type)} condition={condition} open={open} />
                    : type !== 'empty' && <TileIcon type={artType(type)} />}
                  {type === 'exit' && <span className="exit-name">{name}</span>}
                  {action && <span className="target-mark" aria-hidden="true" />}
                  {condition === 'repaired' && <span className="tile-check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
            {gameStyle && !legacy && <PerimeterArt />}
            {gameStyle && <WallRunArt pallets={view?.pallets} legacy={legacy} />}
            {[KILLER, HUMAN].map(role => {
              const at = view?.positions[role]
              if (at == null) return null
              const shared = view.positions[HUMAN] === view.positions[KILLER]
              const slot = cells.indexOf(at)
              return (
                <div key={role} className={`piece-position ${shared ? `shared-${role}` : ''}`}
                  style={{ '--col': slot % columnCount, '--row': Math.floor(slot / columnCount) }} aria-hidden="true">
                  {gameStyle ? <CharacterArt role={role} at={slot} columns={columnCount} health={view.health} replayRound={replayRound} />
                    : <span className={`piece ${role}`}>{role === HUMAN ? '人' : '屠'}</span>}
                </div>
              )
            })}
            {gameStyle && !legacy && <PerimeterArt foreground />}
            {gated && EXITS.map((exit, index) => {
              const action = byTarget.get(exit)
              const open = (view?.count ?? 0) >= 3
              const name = coordinate(exit)
              const label = `${name}，${open ? '已开启' : '未开启'}${action ? '，可撤离' : ''}`
              return (
                <button key={exit} type="button" className={`wall-gate ${index ? 'wall-gate-east' : 'wall-gate-west'} ${open ? 'open' : ''}`}
                  aria-label={label} title={label} aria-disabled={!action} tabIndex={action ? 0 : -1}
                  onClick={() => action && onAction(action)}>
                  {gameStyle ? <GateArt open={open} east={Boolean(index)} /> : <TileIcon type="exit" />}
                  <span className="gate-label">{name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <ul className="legend" aria-label="地图图例">
        {LEGEND.map(type => (
          <li key={type}>{gated && type === 'exit' ? <TileIcon type="exit" />
            : gameStyle ? <TerrainArt type={artType(type)} /> : <TileIcon type={artType(type)} />}{tileName(type)}</li>
        ))}
      </ul>
    </section>
  )
}

function Status({ view, layout }) {
  const count = view?.count ?? 0
  const health = view?.health ?? 2
  const legacy = layout !== GATE_LAYOUT && layout !== COURTYARD_LAYOUT
  const cellar = layout === COURTYARD_LAYOUT
  return (
    <section className="panel status-panel" aria-labelledby="status-title">
      <div className="panel-title"><h2 id="status-title">对局状态</h2></div>
      <div className="metrics">
        <div className="metric">
          <div className="metric-heading"><span>{legacy ? '已修机器' : '已点亮的灯'}</span><strong className="mono">{count}<small> / 4</small></strong></div>
          <div className="meter" aria-hidden="true">
            {[1, 2, 3, 4].map(value => <span key={value} className={count >= value ? 'filled' : ''} />)}
          </div>
        </div>
        <div className="metric">
          <div className="metric-heading"><span>人类生命</span><strong className="mono">{health}<small> / 2</small></strong></div>
          <div className="meter health-meter" aria-hidden="true">
            {[1, 2].map(value => <span key={value} className={health >= value ? 'filled' : ''} />)}
          </div>
        </div>
        <div className="exit-status"><TileIcon type={cellar ? 'hatch' : 'exit'} /><span>{cellar ? '撤离地窖' : '撤离出口'}</span><strong>{count >= 3 ? '已开启' : legacy ? '修好 3 台后开放' : '点亮 3 盏后开启'}</strong></div>
      </div>
    </section>
  )
}

function Choices({ label, name, choices, value, onChange, disabled = false, descriptions = {} }) {
  return (
    <fieldset className="difficulty-options" disabled={disabled}>
      <legend>{label}</legend>
      <div>
        {choices.map(([id, text]) => (
          <label key={id}>
            <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} />
            <span>{text}{descriptions[id] && <small>{descriptions[id]}</small>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function RulesButton({ onOpen }) {
  return <button type="button" className="primary rules-button" aria-haspopup="dialog" onClick={onOpen}>规则说明</button>
}

function SetupDialog({ gameStyle, onStyle, mode, onMode, online, selected, onSelect,
  difficulty, onDifficulty, onStart, onRules, onReplay }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const modal = ref.current
    modal.showModal()
    return () => modal.close()
  }, [])
  return (
    <dialog ref={ref} className="rules setup-dialog" aria-labelledby="setup-title"
      onCancel={event => event.preventDefault()}>
      <div className="panel-title">
        <h2 id="setup-title">开局设置</h2>
        <RulesButton onOpen={onRules} />
      </div>
      <div className="setup-body">
        <Choices label="界面风格" name="style" choices={[[false, '工作风'], [true, '游戏风']]}
          descriptions={{ false: '浅色图标棋盘', true: '深色庭院棋盘' }} value={gameStyle} onChange={onStyle} />
        {gameStyle !== null && <>
          <Choices label="对局模式" name="mode" choices={[['solo', '单人演练'], ['online', '好友联机']]}
            value={mode} onChange={onMode} disabled={Boolean(online.room) || online.entering} />
          {mode === 'solo' && (
            <form onSubmit={event => {
              event.preventDefault()
              if (selected && difficulty) onStart()
            }}>
              <Choices label="你的角色" name="role" choices={Object.entries(ROLES)} descriptions={ROLES_INFO}
                value={selected} onChange={onSelect} />
              <Choices label="人机难度" name="difficulty" choices={Object.entries(DIFFICULTIES)}
                value={difficulty} onChange={onDifficulty} />
              <button type="submit" className="primary wide" disabled={!selected || !difficulty}>开始演练 <span aria-hidden="true">→</span></button>
            </form>
          )}
          {mode === 'online' && <OnlineLobby online={online} />}
        </>}
        {onReplay && <button type="button" className="secondary replay-link" onClick={onReplay}>上一局回放</button>}
      </div>
    </dialog>
  )
}

function Controls({ game, room, paused, view, actions, onAction, onReset, onReplay, onRematch }) {
  const player = room ? room.role : game.player
  const role = room ? room.match.role : activeRole(game)
  const personal = role === player
  const placing = room ? room.match.placing : isPlacement(game)
  const recovery = view.recovery
  const skipping = !placing && role === KILLER && recovery?.remaining > 0
  const sidestep = actions.some(action => action.kind === 'sidestep')
  let headline = `${ROLES[role]}行动`
  let instruction = personal ? '点击高亮格子移动，或在下方使用原地行动。' : '正在等待对手完成行动。'
  if (placing) {
    headline = `${ROLES[role]}选择出生点`
    instruction = personal ? '点击地图中标出的空格出生。' : '正在等待对手选择出生点。'
  } else if (skipping) {
    headline = `屠夫跳过本回合`
    instruction = `${RECOVERY[recovery.kind]}，还需跳过 ${recovery.remaining} 个屠夫回合。`
  } else if (sidestep) {
    instruction = '眩晕结束，先选择移到木板左侧或右侧。'
  } else if (role === KILLER && personal) {
    instruction = '点击高亮格子移动，也可以提前结束行动。'
  }
  if (view.winner) {
    headline = view.winner === player ? (room ? '你获胜了' : '演练成功') : (room ? '对局结束' : '演练结束')
    const exit = room ? room.match.escapedThrough : game.escapedThrough
    instruction = view.winner === HUMAN ? `人类成功从${coordinate(exit)}撤离。` : '人类生命归零，屠夫获胜。'
  } else if (paused) {
    headline = '对局暂停'
    instruction = '正在等待双方重新连接。'
  }
  const extras = actions.filter(action => ['repair', 'drop', 'wait'].includes(action.kind))
  return (
    <section className="panel control-panel" aria-labelledby="control-title">
      <div className="panel-title"><h2 id="control-title">行动面板</h2><span className="quiet">你扮演{ROLES[player]} · {room ? '联机' : DIFFICULTIES[game.difficulty]}</span></div>
      <div className="panel-body">
        <div className="turn-status" role="status">
          <strong>{headline}</strong>
          <p>{instruction}</p>
        </div>
        {!placing && !view.winner && !skipping && !paused && (
          <div className="action-budget">
            <span>{personal ? '你的' : '对手'}剩余行动</span>
            <strong className="mono">{role === KILLER ? view.steps : 1}</strong>
          </div>
        )}
        {extras.length > 0 && (
          <div className="extra-actions">
            {extras.map(action => (
              <button key={`${action.kind}-${action.to}`} type="button"
                className={action.kind === 'repair' ? 'primary' : 'secondary'}
                onClick={() => onAction(action)}>
                {action.kind === 'repair' ? '原地点灯' : action.kind === 'drop' ? `放下 ${coordinate(action.to)} 的木板`
                  : role === KILLER ? '结束行动' : '原地等待'}
              </button>
            ))}
          </div>
        )}
        {view.winner && (
          <div className="extra-actions">
            {room?.host && <button type="button" className="primary" disabled={paused} onClick={onRematch}>开始下一局</button>}
            <button type="button" className={room?.host ? 'secondary' : 'primary'} onClick={onReplay}>查看本局回放</button>
            <button type="button" className="secondary" onClick={onReset}>{room ? '退出房间' : '返回配置'}</button>
          </div>
        )}
      </div>
    </section>
  )
}

function ReplayPanel({ frame, lastRound, onStep, layout }) {
  return (
    <section className="panel control-panel" aria-labelledby="replay-title">
      <div className="panel-title">
        <h2 id="replay-title">回合记录</h2>
        <span className="quiet">共 {lastRound} 回合</span>
      </div>
      <div className="panel-body">
        <div className="replay-round" role="status">
          <strong>{frame.round === 0 ? '出生位置' : `第 ${frame.round} 回合结束`}</strong>
          <dl className="replay-positions">
            {[HUMAN, KILLER].map(role => (
              <div key={role}>
                <dt><span className={`piece ${role}`} aria-hidden="true">{ROLES[role][0]}</span>{ROLES[role]}</dt>
                <dd className="mono">{role === HUMAN && frame.escapedThrough
                  ? `已从${coordinate(frame.escapedThrough)}撤离` : coordinate(frame.positions[role], layout)}</dd>
              </div>
            ))}
          </dl>
          {frame.winner && <p className="replay-result">{ROLES[frame.winner]}获胜</p>}
        </div>
        <div className="extra-actions replay-actions">
          <button type="button" className="secondary" disabled={frame.round === 0} onClick={() => onStep(-1)}>上一回合</button>
          <button type="button" className="secondary" disabled={frame.round === lastRound} onClick={() => onStep(1)}>下一回合</button>
        </div>
      </div>
    </section>
  )
}

function Activity({ game, room }) {
  const events = (room ? room.match?.log ?? [] : game ? visibleLog(game) : []).slice(-4).reverse()
  return (
    <section className="panel activity-panel" aria-labelledby="activity-title">
      <div className="panel-title"><h2 id="activity-title">操作记录</h2></div>
      {events.length ? (
        <ul className="event-list">
          {events.map((event, index) => (
            <li key={`${event.round}-${event.text}-${index}`} className={index === 0 ? 'latest' : ''}>
              <span className="mono">{event.round ? `R${String(event.round).padStart(2, '0')}` : '配置'}</span>
              <span>{event.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="empty-log">{game || room?.match ? '等待可见的行动记录。' : '开始后将在此显示操作记录。'}</p>}
    </section>
  )
}

function Rules({ dialog }) {
  return (
    <dialog ref={dialog} className="rules" aria-labelledby="rules-title">
      <div className="panel-title">
        <h1 id="rules-title">新手玩法</h1>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>关闭</button></form>
      </div>
      <div className="rules-body">
        <section className="rules-start" aria-labelledby="rules-start-title">
          <h2 id="rules-start-title">怎么开始</h2>
          <p>单人演练由电脑扮演另一方。好友联机时，房主先选角色，来宾扮演另一方并确认准备。开局后，屠夫先选出生空格，人类再选另一个空格。</p>
          <p>每轮<strong>屠夫先行动，最多 2 次</strong>，然后<strong>人类行动 1 次</strong>。轮到你时，点击高亮格子移动或翻越，其他操作在「行动面板」。普通移动只走上下左右，墙挡路。</p>
        </section>
        <section className="rules-role rules-human" aria-labelledby="rules-human-title">
          <h2 id="rules-human-title"><span className="piece human" aria-hidden="true">人</span>扮演人类</h2>
          <p className="rules-goal">点亮任意 <strong>3 盏灯</strong>，再从任一<strong>出口门</strong>撤离即可获胜。你有 <strong>2 点生命</strong>，可以看到屠夫的位置，但不能主动走进他所在的格子。</p>
          <ul className="rules-actions">
            <li><strong>点灯</strong>　先走到灯所在格，下次行动点「原地点灯」。</li>
            <li><strong>放板</strong>　开局木板靠在墙上，双方可以直接走过木板格。站在木板上下左右任一相邻格，可以在行动面板放板。木板会搭到另一侧墙上挡住通道，若屠夫正站在木板格，他会被砸晕。</li>
            <li><strong>翻窗和翻板</strong>　点击相邻的窗户或已放下的木板，即可沿原方向跨到对面的空格。移动、点灯、翻越和放板各用 1 次行动。</li>
            <li><strong>从出口门撤离</strong>　点亮 3 盏灯后，两扇墙上的出口门都会开启。在 <strong>A3</strong> 点西门，或在 <strong>E3</strong> 点东门，人类就会离开地图，本局立即结束。</li>
          </ul>
        </section>
        <section className="rules-role rules-killer" aria-labelledby="rules-killer-title">
          <h2 id="rules-killer-title"><span className="piece killer" aria-hidden="true">屠</span>扮演屠夫</h2>
          <p className="rules-goal">找到人类，让他的<strong>生命归零</strong>即可获胜。你能看到人类的剩余生命和亮灯总数。人类的位置、行动和具体哪盏灯亮起都隐藏。</p>
          <ul className="rules-actions">
            <li><strong>命中</strong>　移动到人类所在格会自动扣除他 1 点生命。你的本轮行动立即结束，并跳过接下来的 <strong>2 个屠夫回合</strong>。</li>
            <li><strong>翻窗</strong>　点击相邻的窗户后先留在原地。跳过下一个屠夫回合，才落到窗对面的空格。</li>
            <li><strong>砸板</strong>　尝试经过已放下的木板时，你会停在板前。跳过下一个屠夫回合，把木板砸碎后便可通行。</li>
            <li><strong>被板砸晕</strong>　站在木板格时被人类放板砸中，你会跳过 {STUN_TURNS} 个屠夫回合。恢复后的第一步必须走到木板左侧或右侧。</li>
          </ul>
        </section>
      </div>
    </dialog>
  )
}

function App() {
  const [selected, setSelected] = useState(null)
  const [difficulty, setDifficulty] = useState(null)
  const [game, setGame] = useState(null)
  const [gameStyle, setGameStyle] = useState(null)
  const [mode, setMode] = useState(() => loadOnlineSession() ? 'online' : null)
  const onlineMode = mode === 'online'
  const online = useOnlineRoom(onlineMode)
  const room = onlineMode ? online.room : null
  const match = room?.match
  const [lastReplay, setLastReplay] = useState(loadLastReplay)
  const [replayIndex, setReplayIndex] = useState(null)
  const dialog = useRef(null)
  const completedReplay = match?.replay ?? (game?.winner ? game.replay : null)
  const availableReplay = completedReplay ?? lastReplay
  const liveOnlineMatch = Boolean(match && !match.view.winner)
  const replayFrame = replayIndex === null || liveOnlineMatch ? null : availableReplay?.[replayIndex]
  useEffect(() => {
    if (liveOnlineMatch) setReplayIndex(null)
  }, [liveOnlineMatch])
  const mapLayout = replayFrame ? replayFrame.layout ?? 'original' : GATE_LAYOUT
  const role = game && activeRole(game)
  const liveView = match?.view ?? (game && project(game, game.player))
  const view = replayFrame ?? liveView
  const paused = Boolean(match && (online.connection !== 'connected' || !room.opponentOnline))
  const actions = replayFrame ? [] : onlineMode ? (!paused && match?.actions) || []
    : game && role === game.player ? actionsFor(game) : []

  useEffect(() => {
    if (completedReplay) {
      saveLastReplay(completedReplay)
      setLastReplay(completedReplay)
    }
  }, [completedReplay])

  useEffect(() => {
    if (!game || game.winner) return
    const skipping = !isPlacement(game) && role === KILLER && game.recovery?.remaining > 0
    if (!skipping && role === game.player) return
    const timeout = setTimeout(() => {
      const next = applyMatchAction(game, skipping ? null : chooseMatchOpponentAction(game))
      setGame(current => current === game ? next : current)
    }, skipping ? 550 : 420)
    return () => clearTimeout(timeout)
  }, [game, role])

  function handleAction(action) {
    if (onlineMode) {
      if (match && !paused) online.send({ type: 'action', revision: room.revision, action: { kind: action.kind, to: action.to } })
      return
    }
    setGame(current => current === game && activeRole(current) === current.player ? applyMatchAction(current, action) : current)
  }

  function changeMode(nextMode) {
    if (onlineMode && nextMode !== mode) online.leave()
    setMode(nextMode)
  }

  const reset = () => onlineMode ? online.leave() : setGame(null)
  const openReplay = () => setReplayIndex(0)
  function stepReplay(offset) {
    setReplayIndex(index => Math.max(0, Math.min(availableReplay.length - 1, index + offset)))
  }
  const placing = match?.placing ?? (game && isPlacement(game))
  const stage = liveView ? liveView.winner ? '已结束' : paused ? '已暂停' : placing ? '选择出生点' : '进行中'
    : room ? '等待开局' : '待开始'
  return (
    <div className={gameStyle ? 'game-theme' : undefined}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="product"><span className="product-icon" aria-hidden="true"><i /><i /><i /><i /></span><strong>格区调度台</strong></div>
          <div className="topbar-tools">
            <label className="theme-switch">
              <span aria-hidden="true" data-selected={!gameStyle}>工作风</span>
              <span className="switch-control">
                <input type="checkbox" switch="" role="switch" aria-label="游戏风"
                  checked={gameStyle === true} onChange={event => setGameStyle(event.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <span aria-hidden="true" data-selected={gameStyle}>游戏风</span>
            </label>
            <RulesButton onOpen={() => dialog.current.showModal()} />
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>{replayFrame ? '对局回放' : '撤离演练'}</h1>
            <p>{mapLayout !== GATE_LAYOUT ? '旧地图回放，显示原对局的地形和出口位置。'
              : replayFrame ? '从出生位置开始，查看双方在每回合结束时的位置。'
                : onlineMode ? '创建房间或输入房间码，和朋友在线对战。' : '选择人类或屠夫，与电脑对手进行回合制对局。'}</p>
          </div>
          <div className="workspace-tools">
            {replayFrame ? (
              <button type="button" className="secondary" onClick={() => setReplayIndex(null)}>退出回放</button>
            ) : (
              <>
                <span className="stage" data-running={Boolean(liveView && !liveView.winner && !paused)}><i aria-hidden="true" />{stage}</span>
                {liveView?.round > 0 && <span className="round mono">第 {String(liveView.round).padStart(2, '0')} 轮</span>}
                {room && <span className="round mono">房间 {room.code}</span>}
                {game && <button type="button" className="secondary" onClick={reset}>重新配置</button>}
                {match && !liveView.winner && <button type="button" className="secondary" onClick={reset}>退出房间</button>}
              </>
            )}
          </div>
        </div>
        <div className="workspace-layout">
          <Board key={Boolean(replayFrame)} view={view} actions={actions} onAction={handleAction}
            gameStyle={gameStyle} replayRound={replayFrame?.round ?? null} layout={mapLayout} />
          <aside className="sidebar" aria-label={replayFrame ? '回放控制' : '演练控制'}>
            {replayFrame ? <ReplayPanel frame={replayFrame} lastRound={availableReplay.length - 1} onStep={stepReplay} layout={mapLayout} />
              : liveView ? <Controls game={game} room={room} paused={paused} view={view} actions={actions}
                onAction={handleAction} onReset={reset} onReplay={openReplay}
                onRematch={() => online.send({ type: 'rematch', revision: room.revision })} />
                : null}
            {!replayFrame && match && online.error && <p className="online-error" role="alert">{online.error}</p>}
            <Status view={view} layout={mapLayout} />
            {!replayFrame && <Activity game={game} room={room} />}
          </aside>
        </div>
      </main>
      {!replayFrame && !game && (!match || gameStyle === null) && (
        <SetupDialog gameStyle={gameStyle} onStyle={setGameStyle} mode={mode} onMode={changeMode} online={online}
          selected={selected} onSelect={setSelected} difficulty={difficulty} onDifficulty={setDifficulty}
          onStart={() => setGame(createGame(selected, undefined, difficulty))}
          onRules={() => dialog.current.showModal()} onReplay={availableReplay && !room && !online.entering ? openReplay : null} />
      )}
      <Rules dialog={dialog} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
