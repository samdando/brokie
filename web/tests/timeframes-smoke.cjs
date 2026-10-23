// Timeframes check: one chart button cycles through the timeframes picked on the You tab; choices are remembered. Synthetic state only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
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
await page.evaluate(()=>{ window.candleReqs=[]; const g=window.testGame; g.refreshCandles=async()=>{ window.candleReqs.push(g.state.candleSeconds); }; });
const fb=page.getByTestId('frame-btn'); const label=()=>fb.textContent();
assert.equal(await label(),'1m','default 1m');
await fb.click(); assert.equal(await label(),'5m'); await fb.click(); assert.equal(await label(),'15m'); await fb.click(); assert.equal(await label(),'1m','wraps');
// settings: add 4h and 1D
await page.getByTestId('tab-you').click(); await page.getByRole('button',{name:/Account settings/}).click(); await page.getByTestId('frames-setting').waitFor();
await page.getByTestId('frame-4h').click(); await page.getByTestId('frame-1D').click(); await page.getByTestId('frame-5m').click();
await page.getByTestId('frames-setting').evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(250);
const fs=await page.getByTestId('frames-setting').boundingBox(); await page.screenshot({path:'/tmp/claude-0/-home-claude/17a0ffd9-b307-54f8-8829-149246ea101d/scratchpad/tf-settings.png',clip:{x:0,y:fs.y-6,width:393,height:fs.height+12}});
assert.deepEqual(await page.evaluate(()=>window.testGame.state.frames),[60,900,14400,86400],'list saved in order');
await page.getByRole('button',{name:'Done',exact:true}).click(); await page.getByTestId('tab-trade').click();
const seen=[]; for(let i=0;i<5;i++){ seen.push(await label()); await fb.click(); }
assert.deepEqual(seen,['1m','15m','4h','1D','1m'],'cycles through the picked list'); console.log('cycle:',seen.join(' → '));
assert.equal(await label(),'15m'); await fb.click(); assert.equal(await label(),'4h');
// remembered after a reload
assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.frame')),'14400'); assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.frames')),'[60,900,14400,86400]');
// turning off the current timeframe moves to the first one left; the last one can't be turned off
await page.evaluate(()=>window.testGame.toggleFrame(14400)); assert.equal(await label(),'1m');
for (const s of [60,900,86400]) await page.evaluate((s)=>window.testGame.toggleFrame(s),s);
assert.equal((await page.evaluate(()=>window.testGame.state.frames)).length,1,'one always stays'); assert(await fb.isDisabled(),'single timeframe: button does nothing');
await page.setViewportSize({width:320,height:800}); await page.waitForTimeout(200);
await page.locator('.chart-controls').evaluate(e=>e.scrollIntoView({block:'center'})); await page.waitForTimeout(200);
await page.evaluate(()=>{for(const s of [60,300,14400]) window.testGame.toggleFrame(s);});
const cc=await page.locator('.chart-controls').boundingBox(); await page.screenshot({path:'/tmp/claude-0/-home-claude/17a0ffd9-b307-54f8-8829-149246ea101d/scratchpad/tf-chart.png',clip:{x:0,y:cc.y-4,width:320,height:cc.height+8}});
assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'no sideways scroll');
assert.deepEqual(errors,[]); console.log('requests:',(await page.evaluate(()=>window.candleReqs)).join(',')); console.log('PASS timeframes'); await browser.close();})();
