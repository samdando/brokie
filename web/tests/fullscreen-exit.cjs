// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});await page.addInitScript(()=>{try{if(!localStorage.getItem("brokie.layout"))localStorage.setItem("brokie.layout","classic")}catch{}});
const errors=[];page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE ERROR',e.message)});
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
await page.evaluate(async()=>{
 const {game}=await import('/src/game.ts'); window.testGame=game; window.realRefreshBubbles=game.refreshBubbles.bind(game);
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?Object.fromEntries((args?.p_handles??[]).map(handle=>[handle,{symbol:({sam:'💎',jaoushai:'👽',mrsdandylion:'🌼',ankits:'😎',bum:'🐸'})[handle]??'👤',color:null}])):name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('go-long').waitFor();
await page.evaluate(()=>{const g=window.testGame;g.setMarket('nas');g.now=()=>Date.parse('2026-10-27T13:15:00Z');const now=new Date(g.now()).toISOString();g.set({clockOffset:g.now()-Date.now(),me:{...g.state.me,quotes:g.state.me.quotes.map(q=>({...q,quoted_at:now})),positions:[{id:'view-test',market:'nas',side:'long',quantity:1,entry_price:29700,opened_at:now}]}});});
const layout=()=>page.evaluate(()=>{
 const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
 return {chart:box('.chart-host'),card:box('.chart-card'),dock:box('.trade-dock'),tabs:box('.tabs'),buy:box('[data-testid="go-long"]'),sell:box('[data-testid="go-short"]'),scrollY,bodyStyle:document.body.style.cssText,rootStyle:document.documentElement.style.cssText,viewport:visualViewport?.height??innerHeight,offset:visualViewport?.offsetTop??0,scrollHeight:document.documentElement.scrollHeight};
});
for(const [width,height] of [[393,852],[320,568],[430,932]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(500);const baseline=await layout();
 for(let cycle=0;cycle<4;cycle++){
  await page.getByTestId('big-chart').click();await page.waitForTimeout(400);
  await page.getByTestId('big-chart').click();await page.waitForTimeout(500);const after=await layout();
  assert(after.chart.bottom<=after.dock.top+2,'chart must fit above the execution dock after exit');
  assert(after.chart.height<=baseline.chart.height+2,'preview does not retain excess fullscreen height');
  assert(Math.abs(after.tabs.bottom-after.viewport)<=1,'all bottom navigation remains visible');
  assert(after.sell.bottom<=after.tabs.top,'SELL stays fully above navigation');
  assert.equal(after.bodyStyle,baseline.bodyStyle,'body styles restored');assert.equal(after.rootStyle,baseline.rootStyle,'root styles restored');
 }
}
// Mobile browser chrome and safe areas can change the viewport while expanded.
await page.setViewportSize({width:393,height:852});await page.waitForTimeout(300);
await page.getByTestId('big-chart').click();await page.setViewportSize({width:393,height:740});await page.waitForTimeout(300);await page.getByTestId('big-chart').click();await page.waitForTimeout(400);
let after=await layout();assert(after.chart.bottom<=after.dock.top+2);assert(after.sell.bottom<=after.tabs.top);assert(Math.abs(after.tabs.bottom-740)<1);
await page.setViewportSize({width:393,height:852});await page.addStyleTag({content:':root{--safe-t:47px;--safe-b:34px}'});await page.waitForTimeout(400);
for(let cycle=0;cycle<2;cycle++){
 await page.getByTestId('big-chart').click();await page.getByTestId('trading-status').click();await page.getByTestId('positions-sheet').waitFor();await page.getByRole('button',{name:'Close positions',exact:true}).click();await page.getByTestId('big-chart').click();await page.waitForTimeout(400);
 after=await layout();assert(after.chart.bottom<=after.dock.top+2,'safe-area preview fits after sheet and fullscreen exit');assert(after.sell.bottom<=after.tabs.top);assert.equal(after.bodyStyle,'');assert.equal(after.rootStyle,'');
}
// Preserve an existing scroll position and other root/body inline styles.
await page.evaluate(()=>{document.documentElement.style.setProperty('--test-preserved','root');document.body.style.setProperty('--test-preserved','body');const spacer=document.createElement('div');spacer.id='scroll-spacer';spacer.style.height='160px';document.body.append(spacer);scrollTo(0,40);});await page.waitForTimeout(300);const scrolled=await layout();assert(scrolled.scrollY>0);
await page.getByTestId('big-chart').click();await page.waitForTimeout(250);await page.getByTestId('big-chart').click();await page.waitForTimeout(400);after=await layout();assert.equal(after.scrollY,scrolled.scrollY,'original scroll restored');assert.equal(after.bodyStyle,scrolled.bodyStyle);assert.equal(after.rootStyle,scrolled.rootStyle);assert(after.chart.bottom<=after.dock.top+2);
await page.evaluate(()=>{document.getElementById('scroll-spacer').remove();document.documentElement.style.removeProperty('--test-preserved');document.body.style.removeProperty('--test-preserved');scrollTo(0,0);});
await page.emulateMedia({reducedMotion:'reduce'});await page.getByTestId('big-chart').click();await page.getByTestId('big-chart').click();await page.waitForTimeout(250);after=await layout();assert(after.chart.bottom<=after.dock.top+2);assert.equal(await page.locator('.chart-card').evaluate(e=>e.getAnimations().length),0);await page.screenshot({path:'/tmp/brokie-fullscreen-exit-fixed.png'});
assert.deepEqual(errors,[]);console.log('PASS fullscreen exit: repeated cycles, viewport changes, safe areas, sheets, scroll/style restoration and reduced motion keep chart and bottom controls in view');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
