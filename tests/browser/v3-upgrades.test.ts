import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer, transformWithEsbuild } from 'vite'
import tailwind from '@tailwindcss/postcss'
import { expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '@adventure/spec-v3'
import { preparationAdventure } from '../fixtures/v3-preparation'

// Real upgrade panel, context, chat composer, and app styles; deterministic transport.
it.runIf(process.env.RUN_REVIEW_BROWSER_TESTS === '1')('reviews, refines, resumes, and applies upgrades at desktop and mobile sizes', async () => {
  const fixture = preparationAdventure().spec
  const ui = await readFile('apps/web/src/components/ui.tsx', 'utf8')
  const controls = ui.slice(ui.indexOf('export const button'), ui.indexOf('/**', ui.indexOf('export const control')))
  const root = resolve('apps/web')
  const vite = await createServer({ configFile: false, cacheDir: resolve('node_modules/.vite/v3-upgrades'), root, publicDir: false,
    server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [resolve('.')] } },
    esbuild: { jsx: 'automatic' }, optimizeDeps: { include: ['react', 'react-dom/client'] },
    css: { postcss: { plugins: [tailwind()] } }, resolve: { alias: { '@': resolve(root, 'src') } },
    plugins: [{ name: 'upgrade-harness', enforce: 'pre', resolveId(id) {
      if (id === 'virtual:upgrade-test') return '\0virtual:upgrade-test'
      if (id.endsWith('/upgrade-actions') || id === './upgrade-actions') return '\0upgrade-actions'
      if (id.endsWith('/chat-actions') || id === './chat-actions') return '\0chat-actions'
      if (id.replaceAll('\\', '/').endsWith('/src/components/ui')) return '\0upgrade-controls'
    }, async load(id) {
      if (id === '\0upgrade-controls') return (await transformWithEsbuild(`${controls}\nexport function Thinking({label}) { return <p>{label}</p>; }`, 'controls.tsx', { loader: 'tsx', jsx: 'automatic' })).code
      if (id === '\0upgrade-actions') return ['start', 'get', 'refine', 'apply', 'discard'].map(name => `export const ${name}UpgradeAction = async () => { throw Error('Use injected transport'); };`).join('\n')
      if (id === '\0chat-actions') return `export const suggestReviewChangeAction = async () => ({ok:false,message:'Ordinary edit route'});`
      if (id === '\0virtual:upgrade-test') return (await transformWithEsbuild(`
        import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {UpgradePanel} from '/src/app/v3/teacher/[id]/upgrade-panel.tsx';
        import {getSchemaVersion} from '@adventure/spec-v3';
        import {ReviewChatComposer} from '/src/app/v3/teacher/[id]/review-chat-composer.tsx';
        import {ReviewChatProvider, useReviewChatTarget} from '/src/app/v3/teacher/[id]/review-chat-context.tsx';
        import '/src/app/globals.css';
        const originalData=${JSON.stringify(fixture)}; const original=location.search ? {...originalData,schemaVersion:2} : originalData; const candidate={...original,schemaVersion:${JSON.stringify(CURRENT_SCHEMA_VERSION)}};
        let stored=JSON.parse(sessionStorage.getItem('upgrade-run') || 'null');
        const save=run=>{stored=run;sessionStorage.setItem('upgrade-run',JSON.stringify(run));return {ok:true,run};};
        const actions={
          get:async()=>stored ? (stored.status==='running' ? save({...stored,status:'ready',candidate}) : {ok:true,run:stored}) : null,
          start:async(id,input)=>save({id:'run',adventureId:id,requesterId:'teacher',sourceRevision:input.expectedRevision,sourceSchemaVersion:getSchemaVersion(original),targetSchemaVersion:${JSON.stringify(CURRENT_SCHEMA_VERSION)},proposalRevision:1,status:'running',candidate:null,findings:[],summary:{documents:1,stages:1,changes:['Add source reasoning checks and essential conversations.']},progress:{completed:1,total:1,label:'Ready for review'},appliedRevision:null,error:null,instruction:'',createdAt:'2026-01-01'}),
          refine:async(id,input)=>{const next=structuredClone(stored);next.status='ready';next.error=null;next.findings=[];next.candidate ??= structuredClone(candidate);next.candidate.documents[0].readingCheck.variants[0].prompt='Which complaints does this register describe?';next.proposalRevision++;return save(next);},
          apply:async()=>save({...stored,status:'applied',appliedRevision:stored.sourceRevision+1}),
          discard:async()=>save({...stored,status:'discarded'}),
        };
        function App(){const [spec,setSpec]=useState(original);const [revision,setRevision]=useState(3);const [dirty,setDirty]=useState(false);
          useReviewChatTarget({key:'draft',revision:String(revision),pending:false,input:{pass:'draft',version:revision,edits:[]},apply:()=>{}});
          return <main className="mx-auto max-w-4xl space-y-4 p-4"><h1>Adventure editor</h1><p data-revision>Draft revision {revision}</p>
            <button onClick={()=>setDirty(!dirty)}>Toggle unsaved changes</button><button onClick={()=>setRevision(revision+1)}>Save external revision</button><button onClick={()=>save({...stored,status:'failed',candidate:null,error:'Provider temporarily unavailable.'})}>Simulate saved failure</button>
            <UpgradePanel adventureId="adventure" spec={spec} revision={revision} dirty={dirty} actions={actions} onApplied={(spec,revision)=>{setSpec(spec);setRevision(revision);}} />
            <ReviewChatComposer adventureId="adventure" onConversation={()=>{}} />
          </main>;
        }createRoot(document.getElementById('root')).render(<ReviewChatProvider><App/></ReviewChatProvider>);
      `, 'upgrade-harness.tsx', { loader: 'tsx', jsx: 'automatic' })).code
    }, configureServer(server) { server.middlewares.use((request,response,next)=>{
      if(request.url?.split('?')[0]!=='/')return next();response.setHeader('Content-Type','text/html');response.end('<html style="--font-ui:Arial;--font-record:Georgia"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:upgrade-test"></script></body></html>');
    }) } }],
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await vite.listen(); browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const errors: string[] = []; page.on('pageerror', error=>errors.push(error.message)); page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
      await page.goto(vite.resolvedUrls!.local[0]! + (width === 320 ? '?prepared=1' : ''))
      await page.getByRole('button',{name:'Upgrade adventure',exact:true}).waitFor()
      await page.getByRole('button',{name:'Toggle unsaved changes'}).click()
      await page.getByRole('button',{name:'Upgrade adventure',exact:true}).click()
      expect(await page.getByRole('button',{name:'Prepare upgrade'}).isDisabled()).toBe(true)
      await page.getByRole('button',{name:'Toggle unsaved changes'}).click()
      await page.getByRole('button',{name:'Close review'}).click()
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Upgrade this adventure')
      await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter')
      await page.getByRole('button',{name:'Prepare upgrade'}).waitFor()
      await page.getByRole('heading',{name:`Upgrade to format ${CURRENT_SCHEMA_VERSION}`,exact:true}).waitFor()
      // Asking through chat displays the plan; it cannot silently create/apply a proposal.
      expect(await page.evaluate(()=>sessionStorage.getItem('upgrade-run'))).toBeNull()
      await page.getByRole('button',{name:'Prepare upgrade'}).click()
      // Running work can be cancelled without waiting for the provider.
      expect(await page.getByRole('button',{name:'Discard proposal'}).isEnabled()).toBe(true)
      page.once('dialog',dialog=>dialog.accept())
      await page.getByRole('button',{name:'Discard proposal'}).click()
      await page.getByRole('button',{name:'Prepare upgrade'}).click()
      await page.getByRole('heading',{name:'Reading checks'}).waitFor()
      expect(await page.locator('[data-revision]').textContent()).toContain('3')
      await page.getByRole('button',{name:'Simulate saved failure'}).click()
      await page.reload()
      await page.getByText('Provider temporarily unavailable.',{exact:true}).waitFor()
      await page.getByRole('button',{name:'Retry upgrade'}).click()
      await page.locator('details').first().locator('summary').click()
      expect(await page.getByText('Some merchants opposed the duties. (correct)',{exact:true}).count()).toBe(5)
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Make the first question clearer')
      await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter')
      await page.getByText('Question 1: Which complaints does this register describe?',{exact:true}).waitFor()
      await page.reload()
      await page.getByRole('button',{name:'Apply upgrade'}).waitFor()
      await page.locator('details').first().locator('summary').click()
      await page.getByText('Question 1: Which complaints does this register describe?',{exact:true}).waitFor()
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await mkdir('output/v3-schema-upgrade-check',{recursive:true})
      await page.screenshot({path:`output/v3-schema-upgrade-check/${width}-review.png`,fullPage:true})
      // A different saved revision invalidates the candidate instead of applying it.
      await page.getByRole('button',{name:'Save external revision'}).click()
      await page.getByRole('button',{name:'Rebuild upgrade'}).waitFor()
      expect(await page.getByRole('button',{name:'Apply upgrade'}).isDisabled()).toBe(true)
      await page.getByRole('button',{name:'Rebuild upgrade'}).click()
      await page.getByRole('button',{name:'Apply upgrade'}).waitFor({state:'visible'})
      page.once('dialog',dialog=>dialog.accept())
      await page.getByRole('button',{name:'Discard proposal'}).click()
      await page.getByRole('button',{name:'Prepare upgrade'}).click()
      await page.getByRole('heading',{name:'Reading checks'}).waitFor()
      await page.getByRole('button',{name:'Apply upgrade'}).focus()
      await page.keyboard.press('Enter')
      await page.getByText('Draft revision 5',{exact:true}).waitFor()
      expect(await page.getByRole('button',{name:'Apply upgrade'}).count()).toBe(0)
      expect(errors).toEqual([])
      await page.close()
    }
  } finally { await browser?.close(); await vite.close() }
}, 90_000)
