import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sirv from 'sirv'
import { createOnlineServer } from './rooms.js'

const onRender = process.env.RENDER === 'true'
const host = process.env.ONLINE_HOST || (onRender ? '0.0.0.0' : '127.0.0.1')
const port = Number(process.env.ONLINE_PORT || process.env.PORT || 8787)
const allowedOrigins = (process.env.ONLINE_ORIGINS || process.env.RENDER_EXTERNAL_URL)
  ?.split(',').map(value => value.trim()).filter(Boolean)
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const hasBuild = existsSync(new URL('../dist/index.html', import.meta.url))
if (onRender && !hasBuild) throw new Error('Frontend build missing. Run npm run build before starting the service.')
const servePage = hasBuild ? sirv(dist, { etag: true, maxAge: 0 }) : undefined
const { http, close } = createOnlineServer({ allowedOrigins, servePage })

http.listen(port, host, () => {
  console.log(`Game and rooms listening on http://${host}:${http.address().port}`)
})
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
