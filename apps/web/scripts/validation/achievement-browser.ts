import { resolve } from 'node:path'
import { chromium } from '/tmp/browser-tools/node_modules/playwright/index.mjs'

const directory = resolve('scripts/validation')
await Bun.write(`${directory}/cn.ts`, `import { clsx } from 'clsx'; import { twMerge } from 'tailwind-merge'; export const cn = (...values) => twMerge(clsx(values));`)
await Bun.write(`${directory}/entry.tsx`, `
import { createRoot } from 'react-dom/client'
import { AchievementCard } from '~/components/sections/achievements/achievement-card'
window.activations = { completed: 0, 'in-progress': 0, locked: 0 }
createRoot(document.getElementById('root')).render(<>
  <a href="#before">Before</a>
  {['completed', 'in-progress', 'locked'].map(status => <div key={status} style={{width:300,height:200}}>
    <AchievementCard title={status} description={'Description for '+status} status={status} icon="star" progressPercentage={45} onClick={() => window.activations[status]++} />
  </div>)}
  <a href="#after">After</a>
</>)
`)
const built = await Bun.build({
  entrypoints: [`${directory}/entry.tsx`],
  target: 'browser',
  plugins: [{name: 'isolate-classname-helper', setup(build) {
    build.onResolve({filter: /^~\/lib\/utils$/}, () => ({path: `${directory}/cn.ts`}))
  }}],
})
if (!built.success) throw new Error(String(built.logs))
const bundle = await built.outputs[0].text()
const server = Bun.serve({port: 0, fetch(request) {
  if (new URL(request.url).pathname === '/bundle.js') return new Response(bundle, {headers: {'Content-Type':'text/javascript'}})
  return new Response('<div id="root"></div><script type="module" src="/bundle.js"></script>', {headers: {'Content-Type':'text/html'}})
}})
const browser = await chromium.launch({headless: true})
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://localhost:${server.port}`)
  const completed = page.getByRole('button', {name: 'completed', exact:true})
  const progress = page.getByRole('button', {name: 'in-progress', exact:true})
  const locked = page.getByRole('button', {name: 'locked', exact:true})
  await completed.waitFor()
  await page.getByRole('link', {name:'Before'}).focus()
  await page.keyboard.press('Tab')
  if (!await completed.evaluate(element => element.matches(':focus-visible'))) throw new Error('Available card is not keyboard focusable')
  for (const button of [completed, progress]) {
    await button.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await button.click()
  }
  if (!await locked.isDisabled()) throw new Error('Locked card is not disabled')
  await locked.evaluate(element => {element.click(); element.dispatchEvent(new MouseEvent('click', {bubbles:true}))})
  await progress.focus()
  await page.keyboard.press('Tab')
  if (!await page.getByRole('link', {name:'After'}).evaluate(element => element === document.activeElement)) throw new Error('Tab did not skip locked card')
  const counts = await page.evaluate(() => window.activations)
  if (counts.completed !== 3 || counts['in-progress'] !== 3 || counts.locked !== 0) throw new Error(JSON.stringify(counts))
  if (await page.getByRole('progressbar').getAttribute('aria-valuenow') !== '45') throw new Error('Progress semantics lost')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('PASS: Enter, Space, mouse activation, visible keyboard focus state, disabled Tab skipping, locked activation, and progress semantics')
} finally {
  await browser.close()
  server.stop()
}
