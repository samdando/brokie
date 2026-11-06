// Local fixture only. External requests are blocked; no live accounts or orders.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
 const page = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 const base = process.env.BASE_URL || 'http://127.0.0.1:5179';
 await page.goto(base + '/tests/terminal-preview.html');
 await page.evaluate(async () => {
   const { game } = await import('/src/game.ts'); window.testGame = game;
   const q = game.quote('btc').price, now = game.now();
   const fill = (id, handle, side, entry, exit) => ({ id, handle, is_you: handle === 'sam', state: 'closed', side, quantity: 10, entry_price: q + entry, exit_price: q + exit, pnl: (exit-entry) * (side === 'long' ? 1 : -1) * .1, opened_at: new Date(now-25*60000).toISOString(), at: new Date(now-10*60000).toISOString(), reason:'closed', size_pct:null, dd_floor:null, equity:null });
   game.set({ bubbles: [...game.state.bubbles, fill('mate-close','bum','short',80,-50), fill('quiet-close','quiet','long',-70,10)], candleSeconds:60 });
 });
 await page.getByTestId('simple-floor').waitFor();
 await page.waitForFunction(() => document.querySelectorAll('[data-testid="tape-trade"]').length === 5);
 assert.equal(await page.locator('.chart-host').count(), 0, 'no compressed chart on open');
 assert.equal(await page.getByTestId('tab-learn').count(), 0, 'Learn removed');
 assert.equal(await page.locator('.tabs-inner > button').count(), 4);
 assert.match(await page.getByTestId('price-position').innerText(), /above your entry/);
 assert.equal(await page.getByTestId('tape-trade').count(), 5, 'own receipt, own entry, mates open and closed fills');
 assert.match(await page.locator('[data-trade-id="receipt"]').innerText(), /Exit · closed/);
 assert.equal(await page.getByTestId('style-switch').count(), 0, 'candles controls fullscreen only');
 for (const [width,height] of [[320,568],[393,852],[430,932]]) {
   await page.setViewportSize({ width,height }); await page.evaluate(() => scrollTo(0,0)); await page.waitForTimeout(200);
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
   const buy = await page.getByTestId('go-long').boundingBox(), tabs = await page.locator('.tabs').boundingBox();
   assert(buy.y + buy.height <= tabs.y + 1, 'orders above tabs');
   await page.screenshot({ path: `/tmp/brokie-simple-${width}.png` });
   await page.getByTestId('big-chart').click(); await page.locator('.chart-host').waitFor(); await page.waitForTimeout(250);
   assert(await page.getByTestId('trade-path').count() >= 5, 'all entry-to-exit paths visible without selecting');
   assert.equal(await page.getByTestId('style-switch').count(), 1);
   const chart = await page.locator('.chart-host').boundingBox(), dock = await page.locator('.trade-dock').boundingBox();
   assert(chart.height >= 80 && chart.y + chart.height <= dock.y + 2, 'fullscreen chart fits above controls');
   await page.getByTestId('chart-all-trades').click();
   await page.screenshot({ path:`/tmp/brokie-simple-fullscreen-${width}.png` });
   await page.keyboard.press('Escape'); await page.getByTestId('simple-floor').waitFor();
 await page.waitForFunction(() => document.querySelectorAll('[data-testid="tape-trade"]').length === 5);
   assert.equal(await page.locator('.chart-host').count(), 0);
   assert.equal(await page.evaluate(() => document.body.style.position), '');
 }
 // Hundreds of fills retain quiet players and draw paths without selection.
 await page.evaluate(() => { const g=window.testGame;window.originalBubbles=g.state.bubbles;const sample=g.state.bubbles.find(b=>b.state==='closed');g.set({bubbles:[...g.state.bubbles,...Array.from({length:200},(_,i)=>({...sample,id:'busy-'+i,handle:'busy'}))]}); });
 await page.getByTestId('big-chart').click();
 await page.waitForFunction(() => document.querySelectorAll('[data-testid="trade-path"]').length >= 205);
 assert(await page.locator('.tm.cluster').count() > 0, 'crowded entries stay grouped');
 await page.keyboard.press('Escape');
 assert.equal(await page.getByTestId('tape-trade').count(),205,'no shared fill cap hides quiet traders');
 assert(await page.locator('[data-trade-id="quiet-close"]').count());
 await page.evaluate(() => window.testGame.set({bubbles:window.originalBubbles}));
 // A swipe neither navigates nor closes a trade.
 await page.evaluate(() => { window.closeCalls=0; window.testGame.closeStack=async()=>{window.closeCalls++;return {error:'Rejected for test'};}; });
 const quick = await page.getByTestId('quick-close').boundingBox();
 await page.mouse.move(quick.x+20,quick.y+15); await page.mouse.down(); await page.mouse.move(quick.x+200,quick.y+15,{steps:8}); await page.mouse.up();
 assert.equal(await page.evaluate(() => window.closeCalls),0);
 if (await page.getByTestId('positions-sheet').isVisible()) await page.getByRole('button',{name:'Close positions',exact:true}).click();
 await page.getByTestId('close-trade').click();
 assert.equal(await page.evaluate(() => window.closeCalls),1);
 assert.equal(await page.getByTestId('price-position').count(),1,'refused close preserves position');
 await page.evaluate(() => {
   const g=window.testGame;
   g.closeStack=async(ids)=>{const p=g.state.me.positions.find(p=>ids.includes(p.id));const t={...p,id:'closed-now',exit_price:g.quote(p.market).price,pnl:12,closed_at:new Date(g.now()).toISOString(),reason:'closed'};g.set({me:{...g.state.me,positions:[],trades:[t,...g.state.me.trades]}});return {pnl:12};};
 });
 await page.getByTestId('close-trade').click();
 await page.locator('[data-trade-id="closed-now"]').waitFor();
 assert.equal(await page.getByTestId('price-position').count(),0,'closed fill replaces position immediately');
 assert.match(await page.locator('[data-trade-id="closed-now"]').innerText(),/Exit · closed/);
 await page.getByTestId('tab-you').click(); await page.getByTestId('tab-trade').click();
 await page.locator('[data-trade-id="closed-now"]').waitFor();
 // A fresh account response reconstructs our receipts without social history.
 await page.evaluate(async()=>{const {accountBubbles}=await import('/src/tradeActivity.ts');const g=window.testGame;const reloaded=JSON.parse(JSON.stringify(g.state.me));if(!accountBubbles(reloaded,'btc',[]).some(b=>b.id==='closed-now'&&b.exit_price!=null))throw Error('Reload lost own receipt');});
 // Legacy RPC compatibility, visible errors, and stale-response isolation.
 await page.evaluate(async()=>{
   const {Game}=await import('/src/game.ts');const {BackendError}=await import('/src/api.ts');
   const g=new Game();g.state={...window.testGame.state};let calls=[];
   g.api.rpc=async(n,a)=>{calls.push(a);if('p_from' in a)throw new BackendError('Could not find the function','PGRST202');return [{id:'legacy'}];};
   await g.refreshBubbles();if(calls.length!==2||'p_from' in calls[1]||g.state.bubbles[0].id!=='legacy')throw Error('Legacy RPC fallback failed');
   if(calls[0].p_from!=='1970-01-01T00:00:00.000Z')throw Error('History truncated');
   calls=[];g.api.rpc=async(n,a)=>{calls.push(a);throw new BackendError('not in that squad','42501');};await g.refreshBubbles();
   if(calls.length!==1||!g.state.bubbleError)throw Error('Permission errors hidden or retried');
   let resolve;g.api.rpc=()=>new Promise(r=>resolve=r);const request=g.refreshBubbles();g.state={...g.state,market:'eth',bubbles:[],bubbleScope:null};resolve([{id:'stale'}]);await request;
   if(g.state.bubbles.length)throw Error('Stale market response leaked');
   let finish, count=0;g.api.rpc=()=>{count++;return new Promise(r=>finish=r);};
   const slow=g.refreshBubbles();await g.refreshBubbles();await g.refreshBubbles();
   if(count!==1)throw Error('Polling superseded a slow trade request');
   finish([{id:'fresh'}]);await slow;
   if(g.state.bubbles[0].id!=='fresh'||g.state.bubbleError!==null)throw Error('Slow request failed to recover');
 });
 await page.evaluate(()=>window.testGame.set({bubbleError:'Squad trades couldn’t refresh. Your account fills are still shown.'}));
 assert(await page.getByRole('status').filter({hasText:'Squad trades'}).isVisible());
 assert(await page.locator('[data-trade-id="closed-now"]').isVisible());
 assert.deepEqual(errors, []);
 console.log('PASS simple floor: 320/393/430px, price comparison, no embedded candles, four tap-only pages, explicit close/refusal, persistent own receipts, everyone’s connectors, fullscreen fit, legacy RPC, errors and request races');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
