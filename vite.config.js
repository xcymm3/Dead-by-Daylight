import { defineConfig } from 'vite'

const onlineProxy = {
  '/online': { target: 'ws://127.0.0.1:8787', ws: true },
}

export default defineConfig({
  server: { proxy: onlineProxy },
  preview: { proxy: onlineProxy },
})
