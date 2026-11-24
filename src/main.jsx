import React, { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HUMAN, KILLER, ROLES, activeRole, actionsFor, coordinate, createGame, isPlacement,
  play, project, skipKillerTurn, terrain, visibleLog,
} from './game.js'
import { chooseOpponentAction } from './opponent.js'
import './tokens.css'
import './styles.css'

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
    case 'vault': return `从 ${at}${terrain(action.to) === 'window' ? '翻窗' : '翻板'}至 ${coordinate(action.land)}`
    case 'break': return `砸碎 ${at} 的木板`
    case 'sidestep': return `向侧面移动至 ${at}`
    default: return `移动至 ${at}`
  }
}

function Board({ view, actions, onAction }) {
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
                  {type !== 'empty' && <TileIcon type={type} />}
                  {type === 'exit' && <span className="exit-name">{name}</span>}
                  {action && <span className="target-mark" aria-hidden="true" />}
                  {condition === 'repaired' && <span className="tile-check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
            {[KILLER, HUMAN].map(role => {
              const at = view?.positions[role]
              if (at == null) return null
              const shared = view.positions[HUMAN] === view.positions[KILLER]
              return (
                <div key={role} className={`piece-position ${shared ? `shared-${role}` : ''}`}
                  style={{ '--col': at % 5, '--row': Math.floor(at / 5) }} aria-hidden="true">
                  <span className={`piece ${role}`}>{role === HUMAN ? '人' : '屠'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <ul className="legend" aria-label="地图图例">
        {LEGEND.map(type => <li key={type}><TileIcon type={type} />{TILE_NAMES[type]}</li>)}
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

function Controls({ game, view, actions, onAction, onReset }) {
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
        {view.winner && <button type="button" className="primary wide" onClick={onReset}>返回配置 <span aria-hidden="true">→</span></button>}
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
        <h1 id="rules-title">演练规则</h1>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>关闭</button></form>
      </div>
      <div className="rules-body">
        <h3>出生与回合</h3>
        <p>屠夫先在空格出生，人类随后选空格。每轮屠夫先行动两次，人类再行动一次。移动只走上下左右，墙不可穿过。</p>
        <h3>命中与视野</h3>
        <p>屠夫碰到人类会扣除 1 点生命，立即结束行动，并跳过接下来的两个屠夫回合。人类不能主动进入屠夫所在格，生命归零时屠夫获胜。屠夫只能看到人类的生命与修机总数。</p>
        <h3>窗户与木板</h3>
        <p>翻越沿进入方向跨到对面。人类立即到达，屠夫翻窗时先停在原位，跳过下一回合后落地。</p>
        <p>从木板上下左右的相邻格可以放板。砸中板上的屠夫时，屠夫跳过两个回合，恢复后先往左侧或右侧移动。人类可以直接翻越放下的板，屠夫会在板前停下，跳过下一回合砸碎它。</p>
        <h3>修机与撤离</h3>
        <p>站在机器格使用「原地修机」即修好一台机器。修好任意 3 台后，只能经对应木板格进入出口。木板放下时，可以从内侧直接翻入出口。</p>
      </div>
    </dialog>
  )
}

function App() {
  const [selected, setSelected] = useState(HUMAN)
  const [game, setGame] = useState(null)
  const dialog = useRef(null)
  const role = game && activeRole(game)
  const view = game && project(game, game.player)
  const actions = game && role === game.player ? actionsFor(game) : []

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
  const stage = game ? game.winner ? '已结束' : isPlacement(game) ? '选择出生点' : '进行中' : '待开始'
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="product"><span className="product-icon" aria-hidden="true"><i /><i /><i /><i /></span><strong>格区调度台</strong></div>
          <button type="button" className="rules-button" onClick={() => dialog.current.showModal()}>规则说明 <span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>撤离演练</h1>
            <p>选择人类或屠夫，与电脑对手进行回合制对局。</p>
          </div>
          <div className="workspace-tools">
            <span className="stage" data-running={Boolean(game && !game.winner)}><i aria-hidden="true" />{stage}</span>
            {game?.round > 0 && <span className="round mono">第 {String(game.round).padStart(2, '0')} 轮</span>}
            {game && <button type="button" className="secondary" onClick={reset}>重新配置</button>}
          </div>
        </div>
        <div className="workspace-layout">
          <Board view={view} actions={actions} onAction={handleAction} />
          <aside className="sidebar" aria-label="演练控制">
            {game ? <Controls game={game} view={view} actions={actions} onAction={handleAction} onReset={reset} />
              : <Setup selected={selected} onSelect={setSelected} onStart={() => setGame(createGame(selected))} />}
            <Status view={view} />
            <Activity game={game} />
          </aside>
        </div>
      </main>
      <Rules dialog={dialog} />
    </>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
