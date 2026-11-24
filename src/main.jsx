import React, { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HUMAN, KILLER, ROLES, activeRole, actionsFor, coordinate, createGame, isPlacement,
  play, project, skipKillerTurn, terrain, visibleLog,
} from './game.js'
import { chooseOpponentAction } from './opponent.js'
import { loadLastReplay, saveLastReplay } from './replay.js'
import { CharacterArt, TerrainArt, WallRunArt } from './game-art.jsx'
import './tokens.css'
import './styles.css'
import './game-theme.css'

const TILE_NAMES = { empty: '空格', machine: '机器', window: '窗户', wall: '墙', pallet: '木板', exit: '出口' }
const LEGEND = ['machine', 'wall', 'window', 'pallet', 'exit']
const CELLS = Array.from({ length: 35 }, (_, i) => i)
const ROLES_INFO = {
  [HUMAN]: '修好 3 台机器，再从任一出口撤离。',
  [KILLER]: '根据修机进度巡查，将人类生命降至 0。',
}
const RECOVERY = { hit: '命中后恢复', vault: '翻窗中', break: '砸板中', stun: '木板眩晕' }

function TileIcon({ type }) {
  return <i aria-hidden="true" className={`tile-icon icon-${type}`} />
}

function actionLabel(action) {
  const at = action.to === undefined ? '' : coordinate(action.to)
  switch (action.kind) {
    case 'spawn': return `在 ${at} 出生`
    case 'vault':
      if (terrain(action.land) === 'exit') return `从 ${at} 斜翻进入${coordinate(action.land)}`
      return `从 ${at}${terrain(action.to) === 'window' ? '翻窗' : '翻板'}至 ${coordinate(action.land)}`
    case 'break': return `砸碎 ${at} 的木板`
    case 'sidestep': return `向侧面移动至 ${at}`
    default: return `移动至 ${at}`
  }
}

function Board({ view, actions, onAction, gameStyle, replayRound }) {
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
        <div className="plan">
          <div className="columns mono" aria-hidden="true">
            {[...'ABCDE'].map(letter => <span key={letter}>{letter}</span>)}
          </div>
          <div className="rows mono" aria-hidden="true">
            {[1, 2, 3, 4, 5].map(row => <span key={row} style={{ gridRow: row + 1 }}>{row}</span>)}
          </div>
          <div className="board" aria-label="演练地图">
            {CELLS.map(at => {
              const type = terrain(at)
              if (!type) return <div key={at} aria-hidden="true" />
              const action = byTarget.get(at)
              const condition = view?.pallets[at] ?? (view?.repaired?.includes(at) ? 'repaired' : '')
              const open = type === 'exit' && view?.count >= 3
              const piece = Object.keys(ROLES).filter(role => view?.positions[role] === at)
              const name = type === 'exit' ? coordinate(at) : `${coordinate(at)} ${TILE_NAMES[type]}`
              const status = { repaired: '已修好', dropped: '已放下', broken: '已砸碎' }[condition]
              const label = [name, status, type === 'exit' && (open ? '已开放' : '未开放'),
                ...piece.map(role => ROLES[role]), action && actionLabel(action)].filter(Boolean).join('，')
              return (
                <button key={at} type="button" className={`tile tile-${type} ${condition} ${open ? 'open' : ''}`}
                  aria-label={label} title={label}
                  aria-disabled={!action} tabIndex={action ? 0 : -1}
                  onClick={() => action && onAction(action)}>
                  {gameStyle
                    ? (type === 'machine' || type === 'exit') && <TerrainArt type={type} condition={condition} open={open} />
                    : type !== 'empty' && <TileIcon type={type} />}
                  {type === 'exit' && <span className="exit-name">{name}</span>}
                  {action && <span className="target-mark" aria-hidden="true" />}
                  {condition === 'repaired' && <span className="tile-check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
            {gameStyle && <WallRunArt pallets={view?.pallets} />}
            {[KILLER, HUMAN].map(role => {
              const at = view?.positions[role]
              if (at == null) return null
              const shared = view.positions[HUMAN] === view.positions[KILLER]
              return (
                <div key={role} className={`piece-position ${shared ? `shared-${role}` : ''}`}
                  style={{ '--col': at % 5, '--row': Math.floor(at / 5) }} aria-hidden="true">
                  {gameStyle ? <CharacterArt role={role} at={at} health={view.health} replayRound={replayRound} />
                    : <span className={`piece ${role}`}>{role === HUMAN ? '人' : '屠'}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <ul className="legend" aria-label="地图图例">
        {LEGEND.map(type => (
          <li key={type}>{gameStyle ? <TerrainArt type={type} /> : <TileIcon type={type} />}{TILE_NAMES[type]}</li>
        ))}
      </ul>
    </section>
  )
}

function Status({ view }) {
  const count = view?.count ?? 0
  const health = view?.health ?? 2
  return (
    <section className="panel status-panel" aria-labelledby="status-title">
      <div className="panel-title"><h2 id="status-title">对局状态</h2></div>
      <div className="metrics">
        <div className="metric">
          <div className="metric-heading"><span>已修机器</span><strong className="mono">{count}<small> / 4</small></strong></div>
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
        <div className="exit-status"><TileIcon type="exit" /><span>撤离出口</span><strong>{count >= 3 ? '已开放' : '修好 3 台后开放'}</strong></div>
      </div>
    </section>
  )
}

function Setup({ selected, onSelect, onStart }) {
  return (
    <section className="panel control-panel" aria-labelledby="control-title">
      <div className="panel-title"><h2 id="control-title">演练设置</h2><span className="quiet">单人模式</span></div>
      <div className="panel-body">
        <p className="control-lead">选择你要扮演的角色</p>
        <div className="role-list" role="group" aria-label="选择角色">
          {[HUMAN, KILLER].map(role => (
            <button key={role} type="button" className="role-button" aria-pressed={selected === role} onClick={() => onSelect(role)}>
              <span className={`piece ${role}`}>{role === HUMAN ? '人' : '屠'}</span>
              <span><strong>{ROLES[role]}</strong><small>{ROLES_INFO[role]}</small></span>
              <span className="selection-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" className="primary wide" onClick={onStart}>开始演练 <span aria-hidden="true">→</span></button>
      </div>
    </section>
  )
}

function Controls({ game, view, actions, onAction, onReset, onReplay }) {
  const role = activeRole(game)
  const personal = role === game.player
  const placing = isPlacement(game)
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
    instruction = '木板眩晕结束，先选择移到木板左侧或右侧。'
  } else if (role === KILLER && personal) {
    instruction = '点击高亮格子移动，也可以提前结束行动。'
  }
  if (view.winner) {
    headline = view.winner === game.player ? '演练成功' : '演练结束'
    instruction = view.winner === HUMAN ? '人类修好机器并成功撤离。' : '人类生命归零，屠夫获胜。'
  }
  const extras = actions.filter(action => ['repair', 'drop', 'wait'].includes(action.kind))
  return (
    <section className="panel control-panel" aria-labelledby="control-title">
      <div className="panel-title"><h2 id="control-title">行动面板</h2><span className="quiet">你扮演{ROLES[game.player]}</span></div>
      <div className="panel-body">
        <div className="turn-status" role="status">
          <strong>{headline}</strong>
          <p>{instruction}</p>
        </div>
        {!placing && !view.winner && !skipping && (
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
                {action.kind === 'repair' ? '原地修机' : action.kind === 'drop' ? `放下 ${coordinate(action.to)} 木板`
                  : role === KILLER ? '结束行动' : '原地等待'}
              </button>
            ))}
          </div>
        )}
        {view.winner && (
          <div className="extra-actions">
            <button type="button" className="primary" onClick={onReplay}>查看本局回放</button>
            <button type="button" className="secondary" onClick={onReset}>返回配置</button>
          </div>
        )}
      </div>
    </section>
  )
}

function ReplayPanel({ frame, lastRound, onStep }) {
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
                <dd className="mono">{coordinate(frame.positions[role])}</dd>
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

function Activity({ game }) {
  const events = game ? visibleLog(game).slice(-4).reverse() : []
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
      ) : <p className="empty-log">{game ? '等待可见的行动记录。' : '开始后将在此显示操作记录。'}</p>}
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
          <p>选择人类或屠夫，电脑扮演另一方。屠夫先选一个空格出生，人类再选另一个空格。</p>
          <p>每轮<strong>屠夫先行动，最多 2 次</strong>，然后<strong>人类行动 1 次</strong>。轮到你时，点击高亮格子移动或翻越，其他操作在「行动面板」。普通移动只走上下左右，墙挡路。</p>
        </section>
        <section className="rules-role rules-human" aria-labelledby="rules-human-title">
          <h2 id="rules-human-title"><span className="piece human" aria-hidden="true">人</span>扮演人类</h2>
          <p className="rules-goal">修好任意 <strong>3 台机器</strong>，从地图上方或下方的出口离开即可获胜。你有 <strong>2 点生命</strong>，可以看到屠夫的位置，但不能主动走进他所在的格子。</p>
          <ul className="rules-actions">
            <li><strong>修机</strong>　先走上机器格，下次行动点「原地修机」，就能修好这台机器。</li>
            <li><strong>翻窗和翻板</strong>　点击相邻的窗户或已放下的木板，即可沿原方向跨到对面空格。移动、修机、翻越和放板各用 1 次行动。</li>
            <li><strong>放板</strong>　站在还没放过的木板上下左右任一相邻格，在行动面板点放板按钮，如「放下 C1 木板」。如果屠夫正站在板上，他会被砸晕。</li>
            <li><strong>逃生</strong>　出口开放后，站在对应的木板格，点击出口即可离开。如果木板已放下，从它的左侧或右侧点击木板，会<strong>斜翻进出口</strong>并立即获胜。</li>
          </ul>
        </section>
        <section className="rules-role rules-killer" aria-labelledby="rules-killer-title">
          <h2 id="rules-killer-title"><span className="piece killer" aria-hidden="true">屠</span>扮演屠夫</h2>
          <p className="rules-goal">找到人类，让他的<strong>生命归零</strong>即可获胜。你能看到人类的剩余生命和已修机器数量，人类的位置、行动和修好的具体机器都隐藏。</p>
          <ul className="rules-actions">
            <li><strong>命中</strong>　移动到人类所在格会自动扣除他 1 点生命。你的本轮行动立即结束，并跳过接下来的 <strong>2 个屠夫回合</strong>。</li>
            <li><strong>翻窗</strong>　点击相邻的窗户后先留在原地。跳过下一个屠夫回合，才落到窗对面的空格。</li>
            <li><strong>砸板</strong>　尝试经过已放下的木板时，你会停在板前。跳过下一个屠夫回合，把木板砸碎后便可通行。</li>
            <li><strong>被板砸晕</strong>　如果人类在你站在木板上时放板，你会跳过 2 个屠夫回合。恢复后的第一步必须走到木板左侧或右侧。</li>
          </ul>
        </section>
      </div>
    </dialog>
  )
}

function App() {
  const [selected, setSelected] = useState(HUMAN)
  const [game, setGame] = useState(null)
  const [gameStyle, setGameStyle] = useState(false)
  const [lastReplay, setLastReplay] = useState(loadLastReplay)
  const [replayIndex, setReplayIndex] = useState(null)
  const dialog = useRef(null)
  const completedReplay = game?.winner ? game.replay : null
  const availableReplay = completedReplay ?? lastReplay
  const replayFrame = replayIndex === null ? null : availableReplay?.[replayIndex]
  const role = game && activeRole(game)
  const view = replayFrame ?? (game && project(game, game.player))
  const actions = !replayFrame && game && role === game.player ? actionsFor(game) : []

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
      const next = skipping ? skipKillerTurn(game) : play(game, chooseOpponentAction(game))
      setGame(current => current === game ? next : current)
    }, skipping ? 550 : 420)
    return () => clearTimeout(timeout)
  }, [game, role])

  function handleAction(action) {
    setGame(current => current === game && activeRole(current) === current.player ? play(current, action) : current)
  }

  const reset = () => setGame(null)
  const openReplay = () => setReplayIndex(0)
  function stepReplay(offset) {
    setReplayIndex(index => Math.max(0, Math.min(availableReplay.length - 1, index + offset)))
  }
  const stage = game ? game.winner ? '已结束' : isPlacement(game) ? '选择出生点' : '进行中' : '待开始'
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
                  checked={gameStyle} onChange={event => setGameStyle(event.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <span aria-hidden="true" data-selected={gameStyle}>游戏风</span>
            </label>
            <button type="button" className="rules-button" onClick={() => dialog.current.showModal()}>规则说明 <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>{replayFrame ? '对局回放' : '撤离演练'}</h1>
            <p>{replayFrame ? '从出生位置开始，查看双方在每回合结束时的位置。' : '选择人类或屠夫，与电脑对手进行回合制对局。'}</p>
          </div>
          <div className="workspace-tools">
            {replayFrame ? (
              <button type="button" className="secondary" onClick={() => setReplayIndex(null)}>退出回放</button>
            ) : (
              <>
                <span className="stage" data-running={Boolean(game && !game.winner)}><i aria-hidden="true" />{stage}</span>
                {game?.round > 0 && <span className="round mono">第 {String(game.round).padStart(2, '0')} 轮</span>}
                {game && <button type="button" className="secondary" onClick={reset}>重新配置</button>}
                {!game && availableReplay && <button type="button" className="secondary" onClick={openReplay}>上一局回放</button>}
              </>
            )}
          </div>
        </div>
        <div className="workspace-layout">
          <Board key={Boolean(replayFrame)} view={view} actions={actions} onAction={handleAction}
            gameStyle={gameStyle} replayRound={replayFrame?.round ?? null} />
          <aside className="sidebar" aria-label={replayFrame ? '回放控制' : '演练控制'}>
            {replayFrame ? <ReplayPanel frame={replayFrame} lastRound={availableReplay.length - 1} onStep={stepReplay} />
              : game ? <Controls game={game} view={view} actions={actions} onAction={handleAction} onReset={reset} onReplay={openReplay} />
                : <Setup selected={selected} onSelect={setSelected} onStart={() => setGame(createGame(selected))} />}
            <Status view={view} />
            {!replayFrame && <Activity game={game} />}
          </aside>
        </div>
      </main>
      <Rules dialog={dialog} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
