import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
// Optional local visual preview. Serves only public game art and synthetic story fixtures.
export default mergeConfig(base, defineConfig({ publicDir: '../../apps/web/public', server: { port: 5188 } }))
