import React, { useState } from 'react'
import { HUMAN, KILLER, ROLES } from './game.js'

const unavailableMessage = import.meta.env.DEV
  ? '无法连接联机服务。请在项目目录运行 npm run online:server，页面会自动重试。'
  : '无法连接联机服务，页面会自动重试。请确认站点的房间服务已启动，且 WebSocket 地址配置正确。'

export function OnlineLobby({ online }) {
  const [code, setCode] = useState('')
  const { room, connection, error, send, leave } = online
  const connected = connection === 'connected'
  const readyToStart = connected && room?.role && room.guestReady && room.opponentOnline
  const roleName = room?.role && ROLES[room.role]

  function join(event) {
    event.preventDefault()
    send({ type: 'join', code })
  }

  return (
    <section className="panel control-panel online-lobby" aria-labelledby="control-title">
      <div className="panel-title">
        <h2 id="control-title">{room ? '房间设置' : '好友联机'}</h2>
        <span className="quiet">{room ? (room.host ? '房主' : '来宾') : '双人模式'}</span>
      </div>
      <div className="panel-body">
        {connection === 'connecting' && <p className="online-message">正在连接联机服务…</p>}
        <div role="status">
          {connection === 'reconnecting' && <p className="online-message">正在重新连接房间…</p>}
          {connection === 'unavailable' && !error && <p className="online-message">{unavailableMessage}</p>}
        </div>
        {error && <p className="online-error" role="alert">{error}</p>}
        {room ? (
          <>
            <div className="room-code"><span>房间码</span><strong className="mono">{room.code}</strong></div>
            <p className="online-message" role="status">{room.guestJoined
              ? room.opponentOnline ? '对手已连接。' : '正在等待对手重连。' : '把房间码发给朋友，等待加入。'}</p>
            {room.host ? (
              <>
                <p className="control-lead">房主先选角色</p>
                <div className="role-list" role="group" aria-label="选择角色">
                  {[HUMAN, KILLER].map(role => (
                    <button key={role} type="button" className="role-button" aria-pressed={room.role === role} disabled={!connected}
                      onClick={() => send({ type: 'chooseRole', role })}>
                      <span className={`piece ${role}`} aria-hidden="true">{ROLES[role][0]}</span>
                      <strong>{ROLES[role]}</strong>
                      <span className="selection-dot" aria-hidden="true" />
                    </button>
                  ))}
                </div>
                {roleName && room.guestJoined && <p className="online-message">{room.guestReady ? '对手已准备。' : '等待对手确认准备。'}</p>}
                <button type="button" className="primary wide" disabled={!readyToStart} onClick={() => send({ type: 'start' })}>开始对战</button>
              </>
            ) : (
              <>
                <p className="online-message" role="status">{roleName ? `你的角色是${roleName}。` : '等待房主选好角色。'}</p>
                <button type="button" className="primary wide" disabled={!connected || !roleName}
                  onClick={() => send({ type: 'ready', role: room.role, ready: !room.guestReady })}>
                  {room.guestReady ? '取消准备' : '确认准备'}
                </button>
              </>
            )}
            <button type="button" className="secondary wide" onClick={leave}>退出房间</button>
          </>
        ) : (
          <>
            <button type="button" className="primary wide room-create" disabled={!connected} onClick={() => send({ type: 'create' })}>创建房间</button>
            <form className="room-join" onSubmit={join}>
              <label htmlFor="room-code">加入好友的房间</label>
              <div>
                <input id="room-code" name="roomCode" className="mono" value={code} disabled={!connected}
                  required pattern="[A-Z2-9]{6}" maxLength={6} autoCapitalize="characters" autoComplete="off"
                  placeholder="6 位房间码"
                  onChange={event => setCode(event.target.value.toUpperCase().replace(/\s/g, ''))} />
                <button type="submit" className="secondary" disabled={!connected}>加入</button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  )
}
