// Timeframes check: one chart button starts on your highest picked timeframe and steps down on each tap;
// the list is picked on the You tab and remembered. Synthetic state only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE ERROR',e.message)});
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
await page.evaluate(async()=>{
 const {game}=await import('/src/game.ts'); window.testGame=game;
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 game.api.rpc=async(name,args)=>name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('equity').waitFor();
async function shot(name){await page.waitForTimeout(350);await page.screenshot({path:'/tmp/brokie-'+name+'.png',fullPage:false});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+name);}
await shot('trade');
await page.evaluate(()=>{ const g=window.testGame; g.refreshCandles=async()=>{}; });
const fb=page.getByTestId('frame-btn'); const label=()=>fb.textContent();
const taps=async(n)=>{const seen=[await label()]; for(let i=0;i<n;i++){await fb.click(); seen.push(await label());} return seen.join(' → ');};
assert.equal(await label(),'15m','starts on the highest default timeframe');
assert.equal(await taps(3),'15m → 5m → 1m → 15m','steps down, wraps to the highest');
await page.getByTestId('tab-you').click(); await page.getByRole('button',{name:/Account settings/}).click(); await page.getByTestId('frames-setting').waitFor();
for (const f of ['4h','1D','5m']) await page.getByTestId('frame-'+f).click();
assert.deepEqual(await page.evaluate(()=>window.testGame.state.frames),[60,900,14400,86400]);
await page.getByRole('button',{name:'Done',exact:true}).click(); await page.getByTestId('tab-trade').click();
const cyc=await taps(4); console.log('cycle:', cyc); assert.equal(cyc,'15m → 1m → 1D → 4h → 15m');
assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.frame')),'900');
await page.evaluate(()=>window.testGame.toggleFrame(900)); assert.equal(await label(),'1D','removing the current one jumps to the highest');
for (const w of [320,393,430]) { await page.setViewportSize({width:w,height:800}); await page.waitForTimeout(250);
  await page.locator('.chart-controls').evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(150);
  const row=await page.locator('.chart-controls').boundingBox(); const btns=await page.locator('.chart-controls > button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,w:r.width,y:r.y};}));
  const sameRow=btns.every(b=>Math.abs(b.y-btns[0].y)<2), right=btns[btns.length-1].x+btns[btns.length-1].w;
  console.log(w+'px:', btns.length,'buttons, one row:',sameRow,', right gap:',Math.round(row.x+row.width-right)+'px');
  assert(sameRow,'one row at '+w); assert(row.x+row.width-right<2,'buttons reach the right edge at '+w);
  if (process.env.SHOTDIR) await page.screenshot({path:process.env.SHOTDIR+'/row-'+w+'.png',clip:{x:0,y:row.y-6,width:w,height:row.height+12}}); }
assert.deepEqual(errors,[]); console.log('PASS timeframes'); await browser.close();})();
