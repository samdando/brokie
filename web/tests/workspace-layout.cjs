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
 const {game}=await import('/src/game.ts'); window.testGame=game;
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('equity').waitFor();
await page.evaluate(()=>{const g=window.testGame;g.setCandleSeconds(60);g.set({me:{...g.state.me,cash:174611,rules:{...g.state.me.rules,funded:true,equity:174611},quotes:[{market:'nas',price:29700,quoted_at:new Date().toISOString()},{market:'gold',price:2705,quoted_at:new Date().toISOString()}]}});});
const status=page.getByTestId('trading-status');
assert.equal(await status.getByTestId('live-unrealised').textContent(),'$0.00');
assert((await page.locator('.flat-state').boundingBox()).height<60,'empty positions stay compact');
assert((await page.locator('.account-compact').boundingBox()).height<160,'season overview is secondary');
assert((await page.locator('.session-clock').boundingBox()).height<70,'session summary stays compact');
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[{id:'one',market:'nas',side:'long',quantity:2,entry_price:29600,opened_at:new Date().toISOString()},{id:'two',market:'gold',side:'short',quantity:3,entry_price:2710,opened_at:new Date().toISOString()}]}});});
assert.equal(await status.getByTestId('live-unrealised').textContent(),'+$550.00');
assert((await page.getByTestId('positions-section').boundingBox()).y<(await page.locator('.account-compact').boundingBox()).y,'open trades come before season progress');
await status.click();const sheet=page.getByTestId('positions-sheet');await sheet.waitFor();assert.equal(await sheet.getByTestId('position').count(),2);
await page.getByRole('button',{name:'Close positions'}).click();
for(const [width,height] of [[320,568],[393,852],[430,932]]) {
 await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no phone overflow '+width);
 const dock=await page.locator('.trade-dock').boundingBox(),summary=await status.boundingBox(),buy=await page.getByTestId('go-long').boundingBox();
 assert(summary.y>=dock.y && summary.y+summary.height<=buy.y,'P&L directly above execution');
 const corner=await page.getByTestId('big-chart').boundingBox(),card=await page.locator('.chart-card').boundingBox();
 assert(corner.x+corner.width>card.x+card.width-24 && corner.y<card.y+24,'corner control');
 if(width===393){await page.screenshot({path:'/tmp/brokie-workspace-open.png'});await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.screenshot({path:'/tmp/brokie-workspace-details.png'});await page.evaluate(()=>scrollTo(0,0));}
 await page.getByTestId('big-chart').click();await page.waitForTimeout(400);
 await status.click();await sheet.waitFor();assert(await page.getByRole('button',{name:'Close positions'}).isVisible());await page.getByRole('button',{name:'Close positions'}).click();
 const host=await page.locator('.chart-host').boundingBox(),controls=await page.locator('.chart-controls').boundingBox(),fullDock=await page.locator('.trade-dock').boundingBox();
 assert(host.y+host.height<=controls.y+2);assert(controls.y+controls.height<=fullDock.y+2);assert(fullDock.y+fullDock.height<=height);
 if(width===393)await page.screenshot({path:'/tmp/brokie-workspace-full.png'});
 await page.getByTestId('big-chart').click();await page.waitForTimeout(200);
}
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,quotes:g.state.me.quotes.map(q=>({...q,price:q.market==='nas'?29500:q.price}))}});});
assert.equal(await status.getByTestId('live-unrealised').textContent(),'−$250.00');
assert(await status.getByTestId('live-unrealised').evaluate(e=>e.classList.contains('red')));
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,quotes:g.state.me.quotes.filter(q=>q.market!=='gold')}});});
assert.equal(await status.getByTestId('live-unrealised').textContent(),'—');assert(await status.getByText('Waiting for prices').count());
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[]}});});
await page.setViewportSize({width:393,height:852});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/brokie-workspace-flat.png'});
assert.deepEqual(errors,[]);console.log('PASS trading workspace hierarchy, corner fullscreen, live all-market P&L, missing prices, fullscreen position sheet and compact phone layouts');await browser.close();})();
