import React, { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HUMAN, KILLER, ROLES, RECOVERY_LABELS, STUN_TURNS, WIDTH, EXITS, COURTYARD_LAYOUT, GATE_LAYOUT, DIFFICULTIES,
  activeRole, actionsFor, coordinate, isPlacement, project, terrain, recentMessages, skillArea, skippingRole, stunRemaining,
} from './game.js'
import { applyMatchAction, chooseMatchOpponentAction } from './hard-opponent.js'
import { createPracticeGame } from './opponent.js'
import { loadOnlineSession, useOnlineRoom } from './online-client.js'
import { OnlineLobby } from './online-lobby.jsx'
import { loadLastReplay, saveLastReplay } from './replay.js'
import { boardFor, CAMPAIGN, STANDARD_BOARD } from './maps.js'
import { completeCampaignLevel, createCampaignGame, loadCampaignProgress } from './campaign.js'
import { CharacterArt, GateArt, PerimeterArt, TerrainArt, WallRunArt } from './game-art.jsx'
import { SkillAura, SkillEffectsLayer, SkillProps } from './skill-art.jsx'
import { SkillActions, SkillModes, SkillPicker, SkillSummary } from './skill-ui.jsx'
import { validLoadout } from './skills.js'
import './tokens.css'
import './styles.css'
import './game-theme.css'
import './skill-art.css'

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

function TileIcon({ type }) {
  return <i aria-hidden="true" className={`tile-icon icon-${type}`} />
}

function actionLabel(action, role, level) {
  const at = action.to === undefined ? '' : coordinate(action.to)
  switch (action.kind) {
    case 'wait': return role === KILLER ? '结束行动' : '原地等待'
    case 'repair': return `在 ${at} 点灯`
    case 'drop': return `放下 ${at} 的木板`
    case 'spawn': return `在 ${at} 出生`
    case 'vault':
      return `从 ${at}${terrain(action.to, level) === 'window' ? '翻窗' : '翻板'}至 ${coordinate(action.land)}`
    case 'break': return `砸碎 ${at} 的木板`
    case 'sidestep': return `向侧面移动至 ${at}`
    case 'trackMove': return `跟踪者移动至 ${at}`
    default: return terrain(action.to) === 'exit' ? `进入${at}` : `移动至 ${at}`
  }
}

const boardActions = new Set(['spawn', 'move', 'vault', 'sidestep', 'trackMove'])

function panelIcon(action, level) {
  if (action.kind === 'vault') return terrain(action.to, level)
  if (action.kind === 'move' && EXITS.includes(action.to)) return 'exit'
  return { repair: 'lamp', drop: 'pallet', break: 'break', wait: 'wait' }[action.kind]
}

function ActionIcon({ type }) {
  if (type === 'wait' || type === 'break') {
    const path = type === 'wait' ? 'M8 5v14m8-14v14' : 'm5 20 10-11m-5-3 4-4 8 7-4 4z'
    return (
      <svg className="turn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d={path} />
      </svg>
    )
  }
  return <TerrainArt type={type} open={type === 'exit'} />
}

function Board({ view, actions, onAction, gameStyle, replayRound, layout, preview }) {
  const level = view?.campaignLevel
  const classic = boardFor(level) === STANDARD_BOARD
  const gated = layout === GATE_LAYOUT
  const legacy = !gated && layout !== COURTYARD_LAYOUT
  const cells = gated ? GATE_CELLS : legacy ? LEGACY_CELLS : COURTYARD_CELLS
  const columnCount = gated || legacy ? 5 : 7
  const tileName = type => (gated && type === 'exit' ? '出口门' : (legacy && LEGACY_NAMES[type]) || TILE_NAMES[type])
  const artType = type => (legacy ? type : ART_TYPES[type]) ?? type
  const targets = actions.filter(action => boardActions.has(action.kind))
  const highlighted = new Set(!preview ? [] : preview.kind === 'blink' ? [preview.to]
    : skillArea(view.positions[view.turn], preview.direction, preview.kind))
  const killerDazed = stunRemaining(view?.recovery) > 0
  const humanDazed = view?.humanStun > 0
  const tracked = view?.tracker
  const watcher = view?.watcher
  const sniperEffect = view?.effects?.findLast(effect => effect.skill === 'snipe')?.id
  const watcherLabel = watcher?.nearby === null ? '监视者待启用' : watcher?.nearby ? '监视者附近有人' : '监视者附近无人'
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
              const type = terrain(at, level)
              if (!type) return <div key={slot} aria-hidden="true" />
              const action = targets.find(option => option.to === at)
              const badge = action?.kind === 'vault' ? (type === 'window' ? '翻窗' : '翻板')
                : action?.kind === 'sidestep' ? '侧移' : null
              const sealed = view?.blockedWindows?.includes(at)
              const condition = view?.pallets[at] ?? (sealed ? 'sealed' : view?.repaired?.includes(at) ? 'repaired' : '')
              const open = type === 'exit' && view?.count >= 3
              const piece = Object.keys(ROLES).filter(role => view?.positions[role] === at)
              const name = type === 'exit' ? coordinate(at, layout) : `${coordinate(at)} ${tileName(type)}`
              const status = { repaired: legacy ? '已修好' : '已点亮', dropped: '已放下', broken: '已砸碎', sealed: '已封锁' }[condition]
                ?? (type === 'pallet' ? '靠墙，可通行' : type === 'machine' ? (view && !view.repaired ? '亮灯位置隐藏' : '未点亮') : null)
              const label = [name, status, type === 'exit' && (view?.count === null ? '状态隐藏' : open ? '已开放' : '未开放'),
                ...piece.map(role => ROLES[role] + ((role === KILLER ? killerDazed : humanDazed) ? '眩晕中' : '')),
                view?.trap?.at === at && '陷阱', tracked?.at === at && '跟踪者', watcher?.at === at && watcherLabel,
                view?.flare?.at === at && '信号枪瞄准中',
                action && actionLabel(action, undefined, level)].filter(Boolean).join('，')
              return (
                <React.Fragment key={slot}>
                  <button type="button" className={`tile tile-${type} ${condition} ${open ? 'open' : ''}`}
                    data-skill-target={highlighted.has(at) || undefined}
                    data-skill={highlighted.has(at) ? preview.kind : undefined}
                    data-role={highlighted.has(at) ? view.turn : undefined}
                    aria-label={label} title={label}
                    aria-disabled={!action} tabIndex={action ? 0 : -1}
                    onClick={() => action && onAction(action)}>
                    {gameStyle
                      ? (!classic || type === 'machine' || type === 'exit') && type !== 'empty' && <TerrainArt type={artType(type)} condition={condition} open={open} />
                      : type !== 'empty' && <TileIcon type={artType(type)} />}
                    {type === 'exit' && <span className="exit-name">{name}</span>}
                    {action && !badge && <span className="target-mark" aria-hidden="true" />}
                    {condition === 'repaired' && <span className="tile-check" aria-hidden="true">✓</span>}
                  </button>
                  {badge && <span className="tile-action-label" aria-hidden="true"
                    style={{ gridColumnStart: slot % columnCount + 1, gridRowStart: Math.floor(slot / columnCount) + 1 }}>
                    <b>{badge}</b>
                  </span>}
                </React.Fragment>
              )
            })}
            {gameStyle && !legacy && <PerimeterArt />}
            {gameStyle && classic && <WallRunArt pallets={view?.pallets} legacy={legacy} />}
            <SkillProps view={view} cells={cells} columns={columnCount} />
            {[KILLER, HUMAN].map(role => {
              const at = view?.positions[role]
              if (at == null) return null
              const shared = view.positions[HUMAN] === view.positions[KILLER]
              const slot = cells.indexOf(at)
              const dazed = role === KILLER ? killerDazed : humanDazed
              const teleported = view.teleported?.[role]
              return (
                <div key={role} className={`piece-position ${shared ? `shared-${role}` : ''}`} data-dazed={dazed || undefined}
                  data-teleported={teleported || undefined}
                  style={{ '--col': slot % columnCount, '--row': Math.floor(slot / columnCount) }} aria-hidden="true">
                  <SkillAura view={view} role={role} />
                  {gameStyle ? <CharacterArt role={role} at={slot} columns={columnCount} health={view.health}
                    replayRound={replayRound} teleported={teleported} sniperEffect={sniperEffect} />
                    : <span className={`piece ${role}`}>{role === HUMAN ? '人' : '屠'}</span>}
                  {dazed && <span className="stun-mark"><span>✦ ✧</span>眩晕</span>}
                </div>
              )
            })}
            {gameStyle && !legacy && <PerimeterArt foreground />}
            {view?.effects && <SkillEffectsLayer events={view.effects} cells={cells} columns={columnCount} />}
            {gated && EXITS.map((exit, index) => {
              const action = actions.find(option => option.to === exit)
              const open = view?.count >= 3
              const hidden = view?.count === null
              const name = coordinate(exit)
              const label = `${name}，${hidden ? '状态隐藏' : open ? '已开启' : '未开启'}${action ? '，可撤离' : ''}`
              return (
                <button key={exit} type="button" className={`wall-gate ${index ? 'wall-gate-east' : 'wall-gate-west'} ${open ? 'open' : ''}`}
                  aria-label={label} title={label} aria-disabled={!action} tabIndex={action ? 0 : -1}
                  onClick={() => action && onAction(action)}>
                  {gameStyle ? <GateArt open={open} east={Boolean(index)} /> : <TileIcon type="exit" />}
                  <span className="gate-label">{action ? `${name}撤离` : hidden ? `${name} · 隐藏` : name}</span>
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

function Status({ view, layout, player }) {
  const count = view ? view.count : 0
  const health = view ? view.health : 2
  const legacy = layout !== GATE_LAYOUT && layout !== COURTYARD_LAYOUT
  const cellar = layout === COURTYARD_LAYOUT
  return (
    <section className="panel status-panel" aria-labelledby="status-title">
      <div className="panel-title"><h2 id="status-title">对局状态</h2></div>
      <div className="metrics">
        <div className="metric">
          <div className="metric-heading"><span>{legacy ? '已修机器' : '已点亮的灯'}</span><strong className="mono">{count === null ? '隐藏' : <>{count}<small> / 4</small></>}</strong></div>
          {count !== null && <div className="meter" aria-hidden="true">
            {[1, 2, 3, 4].map(value => <span key={value} className={count >= value ? 'filled' : ''} />)}
          </div>}
        </div>
        <div className="metric">
          <div className="metric-heading"><span>人类生命</span><strong className="mono">{health === null ? '隐藏' : <>{health}<small> / 2</small></>}</strong></div>
          {health !== null && <div className="meter health-meter" aria-hidden="true">
            {[1, 2].map(value => <span key={value} className={health >= value ? 'filled' : ''} />)}
          </div>}
        </div>
        <div className="exit-status"><TileIcon type={cellar ? 'hatch' : 'exit'} /><span>{cellar ? '撤离地窖' : '撤离出口'}</span><strong>{count === null ? '隐藏' : count >= 3 ? '已开启' : legacy ? '修好 3 台后开放' : '点亮 3 盏后开启'}</strong></div>
        {player && <SkillSummary view={view} player={player} />}
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
  difficulty, onDifficulty, skillCount, skillSelection, onSkillCount, onSkillToggle, onStart, onRules, onReplay, onCampaign }) {
  const ref = useRef(null)
  const ready = selected && difficulty && validLoadout(selected, skillCount, skillSelection, true)
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
              if (ready) onStart()
            }}>
              <Choices label="你的角色" name="role" choices={Object.entries(ROLES)} descriptions={ROLES_INFO}
                value={selected} onChange={onSelect} />
              <Choices label="人机难度" name="difficulty" choices={Object.entries(DIFFICULTIES)}
                value={difficulty} onChange={onDifficulty} />
              <SkillModes count={skillCount} onChange={onSkillCount} />
              <SkillPicker role={selected} count={skillCount} selected={skillSelection} onToggle={onSkillToggle} solo />
              <button type="submit" className="primary wide" disabled={!ready}>开始演练 <span aria-hidden="true">→</span></button>
            </form>
          )}
          {mode === 'online' && <OnlineLobby online={online} />}
        </>}
        {onCampaign && <CampaignButton onOpen={onCampaign} />}
        {onReplay && <button type="button" className="secondary replay-link" onClick={onReplay}>上一局回放</button>}
      </div>
    </dialog>
  )
}

function CampaignButton({ onOpen, disabled }) {
  return <button type="button" className="campaign-link" aria-haspopup="dialog" onClick={onOpen}
    disabled={disabled}>战役（测试）</button>
}

function changeSkillSelection(selection, limit, id, checked) {
  if (!checked) return selection.filter(skill => skill !== id)
  return selection.length < limit && !selection.includes(id) ? [...selection, id] : selection
}

function CampaignDialog({ cleared, currentLevel, inMatch, gameStyle, onStyle, skills, onClose, onStart }) {
  const [selected, setSelected] = useState(currentLevel ?? Math.min(cleared + 1, CAMPAIGN.length))
  const [chooseStyle] = useState(gameStyle === null)
  const [skillCount, setSkillCount] = useState(skills.length)
  const [skillSelection, setSkillSelection] = useState(skills)
  const ref = useRef(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog ref={ref} className="rules setup-dialog" aria-labelledby="campaign-title"
      onCancel={event => { event.preventDefault(); onClose() }}>
      <div className="panel-title">
        <h2 id="campaign-title">单人战役</h2>
        <button type="button" className="secondary" onClick={onClose}>返回</button>
      </div>
      <div className="setup-body campaign-body">
        <p>你将以人类身份挑战十张地图。每关点亮三盏灯并成功撤离，即可解锁下一关。</p>
        {chooseStyle && <Choices label="界面风格" name="campaign-style" choices={[[false, '工作风'], [true, '游戏风']]}
          value={gameStyle} onChange={onStyle} />}
        <fieldset className="campaign-levels">
          <legend>选择关卡 · 已通关 {cleared} / {CAMPAIGN.length}</legend>
          <div>
            {CAMPAIGN.map(({ name }, index) => {
              const level = index + 1
              const locked = index > cleared
              return (
                <label key={level} htmlFor={`level-${level}`}>
                  <input id={`level-${level}`} type="radio" name="campaign-level" checked={selected === level}
                    disabled={locked} onChange={() => setSelected(level)} />
                  <span><b className="mono">{String(level).padStart(2, '0')}</b> {name}
                    <small>{locked ? '未解锁' : level <= cleared ? '已通关' : '待挑战'}</small>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <p>{CAMPAIGN[selected - 1].hint}</p>
        <SkillModes count={skillCount} onChange={count => { setSkillCount(count); setSkillSelection([]) }} />
        <SkillPicker role={HUMAN} count={skillCount} selected={skillSelection} solo
          onToggle={(id, checked) => setSkillSelection(selection => changeSkillSelection(selection, skillCount, id, checked))} />
        {inMatch && <p>开始挑战将结束当前对局。</p>}
        <button type="button" className="primary wide"
          disabled={gameStyle === null || !validLoadout(HUMAN, skillCount, skillSelection, true)}
          onClick={() => onStart(selected, skillSelection)}>挑战第 {selected} 关</button>
      </div>
    </dialog>
  )
}

function Controls({ game, gameStyle, room, paused, view, actions, onAction, onPreview, onReset, onReplay, onRematch, onCampaignStart }) {
  const player = room ? room.role : game.player
  const role = room ? room.match.role : activeRole(game)
  const personal = role === player
  const placing = room ? room.match.placing : isPlacement(game)
  const recovery = view.recovery
  const skipping = !placing && (role === KILLER ? recovery?.remaining > 0 : view.humanStun > 0)
  const sidestep = actions.some(action => action.kind === 'sidestep')
  const level = view.campaignLevel
  const options = actions.filter(action => panelIcon(action, level))
  let headline = `${ROLES[role]}行动`
  let instruction = personal ? '点击高亮格子移动，或选择下方行动。' : '正在等待对手完成行动。'
  if (placing) {
    headline = `${ROLES[role]}选择出生点`
    instruction = personal ? '点击地图中标出的空格出生。' : '正在等待对手选择出生点。'
  } else if (skipping) {
    headline = `${ROLES[role]}跳过本回合`
    instruction = role === KILLER ? `${RECOVERY_LABELS[recovery.kind]}，还需跳过 ${recovery.remaining} 个屠夫回合。`
      : `被跟踪者抓到，还需跳过 ${view.humanStun} 个人类回合。`
  } else if (sidestep) {
    instruction = '眩晕结束，先选择移到木板左侧或右侧。'
  } else if (role === KILLER && personal && view.tracker?.started) {
    headline = '操控跟踪者'
    instruction = '点击高亮格子移动跟踪者，或收回跟踪者继续本轮行动。'
  } else if (role === KILLER && personal && view.steps === 0) {
    instruction = '移动已用完。可以选择剩余技能或结束行动。'
  } else if (role === KILLER && personal) {
    instruction = '点击高亮格子移动，也可以提前结束行动。'
  }
  if (view.winner) {
    headline = view.winner === player ? (room ? '你获胜了' : '演练成功') : (room ? '对局结束' : '演练结束')
    if (level) headline = view.winner === KILLER ? `第 ${level} 关挑战失败`
      : level === CAMPAIGN.length ? '十关全部通关' : `第 ${level} 关通关`
    const exit = room ? room.match.escapedThrough : game.escapedThrough
    instruction = view.winner === HUMAN ? `人类成功从${coordinate(exit)}撤离。` : '人类生命归零，屠夫获胜。'
  } else if (paused) {
    headline = '对局暂停'
    instruction = '正在等待双方重新连接。'
  }
  return (
    <section className="panel control-panel" aria-labelledby="control-title">
      <div className="panel-title"><h2 id="control-title">行动面板</h2><span className="quiet">你扮演{ROLES[player]} · {room ? '联机' : level ? '单人战役' : DIFFICULTIES[game.difficulty]}</span></div>
      <div className="panel-body">
        <TurnMessages headline={headline} instruction={instruction}
          events={room ? room.match.log : recentMessages(game)} />
        {options.length > 0 && (
          <div className="turn-actions" role="group" aria-label="本回合可选行动">
            {options.map(action => (
              <button type="button" className="secondary" key={`${action.kind}-${action.to ?? ''}`}
                onClick={() => onAction(action)}>
                {gameStyle && <ActionIcon type={panelIcon(action, level)} />}
                {actionLabel(action, role, level)}
              </button>
            ))}
          </div>
        )}
        <SkillActions actions={actions} role={role} onAction={onAction} onPreview={onPreview} />
        {!placing && !view.winner && !skipping && !paused && (
          <div className="action-budget">
            <span>{role === KILLER && view.tracker?.started ? '跟踪者' : personal ? '你的' : '对手'}剩余行动</span>
            <strong className="mono">{role === KILLER ? (view.tracker?.started ? view.tracker.steps : view.steps) : 1}</strong>
          </div>
        )}
        {view.winner && (
          <div className="extra-actions">
            {room?.host && <button type="button" className="primary" disabled={paused} onClick={onRematch}>设置下一局</button>}
            {level && view.winner === KILLER && <button type="button" className="primary" onClick={() => onCampaignStart(level)}>重试本关</button>}
            {level && level < CAMPAIGN.length && view.winner === HUMAN &&
              <button type="button" className="primary" onClick={() => onCampaignStart(level + 1)}>挑战第 {level + 1} 关</button>}
            <button type="button" className={room?.host || level ? 'secondary' : 'primary'} onClick={onReplay}>查看本局回放</button>
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

function TurnMessages({ headline, instruction, events }) {
  const history = useRef(null)
  const followLatest = useRef(true)
  const last = events.at(-1)
  useLayoutEffect(() => {
    if (!last) followLatest.current = true
    const box = history.current
    if (box && followLatest.current) box.scrollTop = box.scrollHeight
  }, [last?.round, last?.text])

  return (
    <section className="turn-messages" aria-label="对局消息">
      <div className="turn-status" role="status">
        <strong>{headline}</strong>
        <p>{instruction}</p>
      </div>
      <div className="turn-history" role="log" aria-label="最近对局消息" tabIndex={0} ref={history}
        onScroll={event => {
          const box = event.currentTarget
          followLatest.current = box.scrollHeight - box.clientHeight - box.scrollTop <= 2
        }}>
        {events.map((event, index) => (
          <div className="turn-event" key={`${event.round}-${event.text}-${index}`} data-kind={event.kind}>
            <span className="mono">{event.round ? `第 ${event.round} 轮` : '开局'}</span>
            <span>{event.text}</span>
          </div>
        ))}
      </div>
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
          <p>开局可选无技能、2 技能或 3 技能。联机时每方从 8 项技能中自选，单人演练从精简列表中选择。开局后可查看双方技能和主动技能剩余次数。</p>
          <p>每轮<strong>屠夫先行动，默认最多 2 次</strong>，然后<strong>人类行动 1 次</strong>。轮到你时，点击高亮格子移动。点灯、放板、翻越、等待和技能等操作列在行动面板中。普通移动只走上下左右，墙挡路。</p>
        </section>
        <section className="rules-role rules-human" aria-labelledby="rules-human-title">
          <h2 id="rules-human-title"><span className="piece human" aria-hidden="true">人</span>扮演人类</h2>
          <p className="rules-goal">点亮任意 <strong>3 盏灯</strong>，再从任一<strong>出口门</strong>撤离即可获胜。你有 <strong>2 点生命</strong>，可以看到屠夫的位置，但不能主动走进他所在的格子。</p>
          <ul className="rules-actions">
            <li><strong>点灯</strong>　先走到灯所在格，下次行动在行动面板选择点灯。</li>
            <li><strong>放板</strong>　开局木板靠在墙上，双方可以直接走过木板格。站在木板上下左右任一相邻格，可以在行动面板选择放下对应坐标的木板。点击可通行的木板格会走上木板。木板会搭到另一侧墙上挡住通道，若屠夫正站在木板格，他会被砸晕。</li>
            <li><strong>翻窗和翻板</strong>　点击相邻的窗户或已放下的木板，即可沿原方向跨到对面的空格。移动、点灯、翻越和放板各用 1 次行动。</li>
            <li><strong>从出口门撤离</strong>　点亮 3 盏灯后，两扇墙上的出口门都会开启。在 <strong>A3</strong> 点西门，或在 <strong>E3</strong> 点东门，人类就会离开地图，本局立即结束。</li>
          </ul>
        </section>
        <section className="rules-role rules-killer" aria-labelledby="rules-killer-title">
          <h2 id="rules-killer-title"><span className="piece killer" aria-hidden="true">屠</span>扮演屠夫</h2>
          <p className="rules-goal">找到人类，让他的<strong>生命归零</strong>即可获胜。默认可看到人类的剩余生命和亮灯总数。人类的位置、行动和具体哪盏灯亮起都隐藏。</p>
          <ul className="rules-actions">
            <li><strong>命中与眩晕</strong>　移动到人类所在格会自动扣除他 1 点生命。默认你的本轮行动立即结束，并眩晕 2 回合。每剩 1 回合眩晕就跳过 1 次自己的行动。</li>
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
  const [skillCount, setSkillCount] = useState(0)
  const [skillSelection, setSkillSelection] = useState([])
  const [preview, setPreview] = useState(null)
  const [game, setGame] = useState(null)
  const [gameStyle, setGameStyle] = useState(null)
  const [mode, setMode] = useState(() => loadOnlineSession() ? 'online' : null)
  const onlineMode = mode === 'online'
  const online = useOnlineRoom(onlineMode)
  const room = onlineMode ? online.room : null
  const match = room?.match
  const [lastReplay, setLastReplay] = useState(loadLastReplay)
  const [replayIndex, setReplayIndex] = useState(null)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [campaignSkills, setCampaignSkills] = useState([])
  const [cleared, setCleared] = useState(loadCampaignProgress)
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
  const level = view?.campaignLevel
  const stageInfo = CAMPAIGN[level - 1]
  const campaignUnavailable = Boolean(room || online.entering ||
    (onlineMode && online.connection !== 'connected' && loadOnlineSession()))
  const paused = Boolean(match && (online.connection !== 'connected' || !room.opponentOnline))
  const actions = replayFrame ? [] : onlineMode ? (!paused && match?.actions) || []
    : game && role === game.player ? actionsFor(game) : []
  const legalPreview = preview && actions.some(action =>
    action.kind === preview.kind && action.direction === preview.direction && action.to === preview.to) ? preview : null

  useEffect(() => {
    if (completedReplay) {
      saveLastReplay(completedReplay)
      setLastReplay(completedReplay)
    }
  }, [completedReplay])

  useEffect(() => {
    if (game?.campaignLevel && game.winner === HUMAN) setCleared(completeCampaignLevel(cleared, game))
  }, [game, cleared])

  useEffect(() => {
    if (!game || game.winner || campaignOpen) return
    const skipping = skippingRole(game)
    if (!skipping && role === game.player) return
    const timeout = setTimeout(() => {
      const next = applyMatchAction(game, skipping ? null : chooseMatchOpponentAction(game))
      setGame(current => current === game ? next : current)
    }, skipping ? 550 : 420)
    return () => clearTimeout(timeout)
  }, [game, role, campaignOpen])

  function handleAction(action) {
    setPreview(null)
    if (onlineMode) {
      if (match && !paused) online.send({ type: 'action', revision: room.revision,
        action: { kind: action.kind, to: action.to, direction: action.direction } })
      return
    }
    setGame(current => current === game && activeRole(current) === current.player ? applyMatchAction(current, action) : current)
  }

  function changeMode(nextMode) {
    if (onlineMode && nextMode !== mode) online.leave()
    setMode(nextMode)
  }

  function toggleSkill(id, checked) {
    setSkillSelection(selection => changeSkillSelection(selection, skillCount, id, checked))
  }

  function startCampaign(level, skills = campaignSkills) {
    if (campaignUnavailable || level > cleared + 1 || level > CAMPAIGN.length) return
    changeMode('solo')
    setReplayIndex(null)
    setCampaignOpen(false)
    setCampaignSkills(skills)
    setGame(createCampaignGame(level, undefined, skills))
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
            <CampaignButton onOpen={() => setCampaignOpen(true)} disabled={campaignUnavailable} />
            <RulesButton onOpen={() => dialog.current.showModal()} />
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <h1>{stageInfo ? `${replayFrame ? '回放' : '战役'} · 第 ${level} 关　${stageInfo.name}` : replayFrame ? '对局回放' : '撤离演练'}</h1>
            <p>{mapLayout !== GATE_LAYOUT ? '旧地图回放，显示原对局的地形和出口位置。'
              : replayFrame ? '从出生位置开始，查看双方在每回合结束时的位置。'
                : stageInfo ? stageInfo.hint : onlineMode ? '创建房间或输入房间码，和朋友在线对战。' : '选择人类或屠夫，与电脑对手进行回合制对局。'}</p>
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
          <Board key={Boolean(replayFrame)} view={view} actions={actions} onAction={handleAction} preview={legalPreview}
            gameStyle={gameStyle} replayRound={replayFrame?.round ?? null} layout={mapLayout} />
          <aside className="sidebar" aria-label={replayFrame ? '回放控制' : '演练控制'}>
            {replayFrame ? <ReplayPanel frame={replayFrame} lastRound={availableReplay.length - 1} onStep={stepReplay} layout={mapLayout} />
              : liveView ? <Controls game={game} gameStyle={gameStyle} room={room} paused={paused} view={view} actions={actions}
                onAction={handleAction} onPreview={setPreview} onReset={reset} onReplay={openReplay} onCampaignStart={startCampaign}
                onRematch={() => online.send({ type: 'rematch', revision: room.revision, configure: true })} />
                : null}
            {!replayFrame && match && online.error && <p className="online-error" role="alert">{online.error}</p>}
            <Status view={view} layout={mapLayout} player={room?.role ?? game?.player} />
          </aside>
        </div>
      </main>
      {!replayFrame && !game && (!match || gameStyle === null) && (
        <SetupDialog gameStyle={gameStyle} onStyle={setGameStyle} mode={mode} onMode={changeMode} online={online}
          selected={selected} onSelect={role => { setSelected(role); setSkillSelection([]) }} difficulty={difficulty} onDifficulty={setDifficulty}
          skillCount={skillCount} skillSelection={skillSelection} onSkillToggle={toggleSkill}
          onSkillCount={count => { setSkillCount(count); setSkillSelection([]) }}
          onStart={() => setGame(createPracticeGame(selected, skillCount, skillSelection, difficulty))}
          onCampaign={campaignUnavailable ? null : () => setCampaignOpen(true)}
          onRules={() => dialog.current.showModal()} onReplay={availableReplay && !room && !online.entering ? openReplay : null} />
      )}
      {campaignOpen && <CampaignDialog cleared={cleared} currentLevel={game?.winner === HUMAN ? undefined : game?.campaignLevel}
        gameStyle={gameStyle} onStyle={setGameStyle} inMatch={Boolean(game && !game.winner)}
        skills={campaignSkills} onClose={() => setCampaignOpen(false)} onStart={startCampaign} />}
      <Rules dialog={dialog} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
