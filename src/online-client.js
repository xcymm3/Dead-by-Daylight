import { useEffect, useRef, useState } from 'react'

const SESSION_KEY = 'grid-operations:online-seat'

export function loadOnlineSession() {
  try {
    const seat = JSON.parse(sessionStorage.getItem(SESSION_KEY))
    return typeof seat?.code === 'string' && typeof seat.token === 'string' ? seat : null
  } catch {
    return null
  }
}

function storeSession(seat) {
  try {
    if (seat) sessionStorage.setItem(SESSION_KEY, JSON.stringify(seat))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Keep the seat in memory when tab storage is unavailable.
  }
}

function onlineUrl() {
  const url = new URL(import.meta.env.VITE_ONLINE_URL || '/online', window.location.href)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  return url.href
}

export function useOnlineRoom(enabled) {
  const [room, setRoom] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [error, setError] = useState('')
  const [savedSeat] = useState(loadOnlineSession)
  const [entering, setEntering] = useState(false)
  const seat = useRef(savedSeat)
  const socket = useRef(null)

  function setSeat(value) {
    seat.current = value
    storeSession(value)
  }

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let retryTimer
    let delay = 750

    function connect() {
      if (stopped) return
      let ws
      try {
        ws = new WebSocket(onlineUrl())
      } catch {
        setConnection('unavailable')
        setError('联机服务地址无效。')
        return
      }
      socket.current = ws
      ws.addEventListener('open', () => {
        if (stopped || socket.current !== ws) return
        delay = 750
        setError('')
        if (seat.current) {
          setEntering(true)
          ws.send(JSON.stringify({ type: 'resume', ...seat.current }))
        } else setConnection('connected')
      })
      ws.addEventListener('message', ({ data }) => {
        if (stopped || socket.current !== ws) return
        let message
        try {
          message = JSON.parse(data)
        } catch {
          return
        }
        if (!message || typeof message.type !== 'string') return
        if (message.type === 'session') {
          setSeat({ code: message.code, token: message.token })
        } else if (message.type === 'room' && seat.current?.code === message.code) {
          setEntering(false)
          setRoom(message)
          setConnection('connected')
        } else if (message.type === 'roomClosed' || message.code === 'sessionExpired') {
          setEntering(false)
          setSeat(null)
          setRoom(null)
          setConnection('connected')
          setError(message.message ?? '')
        } else if (message.type === 'error') {
          setEntering(false)
          setError(message.message)
        }
      })
      ws.addEventListener('close', ({ code }) => {
        if (stopped || socket.current !== ws) return
        socket.current = null
        setEntering(false)
        if (code === 4001) {
          setSeat(null)
          setRoom(null)
          setError('这个座位已在另一个页面恢复。')
        }
        setConnection(seat.current ? 'reconnecting' : 'unavailable')
        retryTimer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 6000)
      })
    }

    setConnection('connecting')
    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      socket.current?.close()
      socket.current = null
    }
  }, [enabled])

  function send(message) {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError('正在连接联机服务，请稍后再试。')
      return
    }
    if (message.type === 'create' || message.type === 'join') {
      if (entering) return
      setEntering(true)
    }
    setError('')
    socket.current.send(JSON.stringify(message))
  }

  function leave() {
    if ((seat.current || entering) && socket.current?.readyState === WebSocket.OPEN) send({ type: 'leave' })
    setEntering(false)
    setSeat(null)
    setRoom(null)
    setError('')
    if (socket.current?.readyState === WebSocket.OPEN) setConnection('connected')
  }

  return { room, connection, entering, error, send, leave }
}
