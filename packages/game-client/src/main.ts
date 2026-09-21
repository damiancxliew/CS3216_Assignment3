import { mountPlayground, type PlaygroundHandle } from './index.js'
import './styles.css'

declare global {
  interface Window { __MAP_PLAYGROUND__?: unknown }
}

let handle: PlaygroundHandle | undefined
let disposed = false
const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing playground root')
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true
    handle?.destroy()
    delete window.__MAP_PLAYGROUND__
  })
}
const mounted = await mountPlayground(root)
if (disposed) mounted.destroy()
else handle = mounted
if (import.meta.env.DEV && !disposed) {
  Object.defineProperty(window, '__MAP_PLAYGROUND__', {
    configurable: true,
    get: () => handle?.getSnapshot(),
  })
}
