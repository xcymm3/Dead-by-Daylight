import { createOnlineServer } from './rooms.js'

const host = process.env.ONLINE_HOST || '127.0.0.1'
const port = Number(process.env.ONLINE_PORT || 8787)
const allowedOrigins = process.env.ONLINE_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean)
const { http, close } = createOnlineServer({ allowedOrigins })

http.listen(port, host, () => {
  console.log(`Online rooms listening on ws://${host}:${port}/online`)
})
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
