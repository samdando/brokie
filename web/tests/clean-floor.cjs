// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});await page.addInitScript(()=>{try{if(!localStorage.getItem("brokie.layout"))localStorage.setItem("brokie.layout","classic")}catch{}});
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
await page.getByTestId('go-long').waitFor();
await page.evaluate(()=>{const g=window.testGame;g.setCandleSeconds(60);g.setQty(1);g.isOpen=()=>true;g.now=()=>Date.parse('2026-10-27T12:00:00Z');g.open=async(side,q)=>{window.orders.push({side,q});return null;};window.orders=[];});
assert.equal(await page.getByTestId('equity').count(),0,'account details stay collapsed');
assert(await page.getByTestId('timeframe-rail').evaluate(e=>e.classList.contains('wheel-scroll')));assert.equal(await page.getByTestId('micro-rail').getByRole('button').count(),3);
await page.getByTestId('timeframe-rail').press('ArrowDown');assert.equal(await page.evaluate(()=>window.testGame.state.candleSeconds),300);
await page.getByTestId('timeframe-rail').press('ArrowDown');assert.equal(await page.evaluate(()=>window.testGame.state.candleSeconds),900);
for(const n of [10,100]) { await page.getByTestId('size-'+n).click();await page.getByTestId('go-long').click();await page.waitForTimeout(650); }
assert.deepEqual(await page.evaluate(()=>window.orders),[{side:'long',q:10},{side:'long',q:100}]);
const b=await page.getByTestId('go-long').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.getByTestId('go-long').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.orders.length),2);
await page.getByTestId('size-1').click();
await page.evaluate(()=>{const g=window.testGame,now=new Date(g.now()).toISOString();g.api.rpc=async(name,args)=>{

 if(name==='avatar_shop'||name==='set_profile_color')return {balance:5,equipped:'koala',color:args?.p_color??null,items:[{id:'koala',name:'Local legend',symbol:'🐨',color:'#73E7C3',price:0,owned:true}]};
 if(name==='player_avatars')return {sam:{symbol:'🐨',color:'#7CC8FF'}};return {};
};});
await page.getByTestId('crypto-switch').click();await page.getByTestId('market-btc').waitFor();assert.equal(await page.evaluate(()=>window.testGame.state.market),'btc');assert.equal(await page.getByText(/Predictions|Buy YES|Buy NO/).count(),0);await page.getByTestId('crypto-switch').click();assert.equal(await page.evaluate(()=>window.testGame.state.market),'nas');await page.waitForTimeout(450);
await page.getByTestId('tab-you').click();await page.getByRole('button',{name:'Make it yours',exact:false}).click();await page.getByTestId('avatar-koala').waitFor();await page.getByRole('button',{name:'Use profile colour #7CC8FF'}).click();assert.equal(await page.getByRole('button',{name:'Use profile colour #7CC8FF'}).getAttribute('aria-pressed'),'true');
await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:/Account settings/}).click();assert.equal(await page.getByLabel('Play order sounds',{exact:true}).isChecked(),false);await page.getByLabel('Touch feedback',{exact:true}).check();assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.haptics')),'on');await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByTestId('tab-trade').click();
await page.evaluate(async()=>{const {nextZonedEvent,sessionEvents}=await import('/src/sessions.ts');const check=(c,m)=>{if(!c)throw Error(m)};
 check(nextZonedEvent(Date.parse('2026-10-30T20:00:00Z'),'America/New_York',17,0,[1,2,3,4,5])===Date.parse('2026-10-30T21:00:00Z'),'before DST');
 check(nextZonedEvent(Date.parse('2026-11-02T20:00:00Z'),'America/New_York',17,0,[1,2,3,4,5])===Date.parse('2026-11-02T22:00:00Z'),'after DST');
 check(sessionEvents(Date.parse('2026-10-24T03:00:00Z'),'btc')[0].at===Date.parse('2026-10-25T22:00:00Z'),'crypto close');
 window.testGame.now=()=>Date.now()+window.testGame.state.clockOffset;window.testGame.set({clockOffset:Date.parse('2026-10-27T20:59:30Z')-Date.now()});});
await page.getByTestId('session-alert').waitFor();assert((await page.getByTestId('session-alert').innerText()).includes('Market close'));await page.getByRole('button',{name:'Dismiss session alert'}).click();await page.evaluate(()=>window.testGame.set({clockOffset:0}));
for(const width of [320,393,430]) {await page.setViewportSize({width,height:852});await page.waitForTimeout(500);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);await page.screenshot({path:'/tmp/brokie-floor-'+width+'.png'});}
await page.emulateMedia({reducedMotion:'reduce'});await page.getByTestId('crypto-switch').click();await page.getByTestId('market-btc').waitFor();assert.equal(await page.locator('.page-screen').evaluate(e=>e.getAnimations().length),0);
assert.deepEqual(errors,[]);console.log('PASS size selection/timeframe keyboard, 10/100 orders, pointer cancellation, Crypto section, transitions, colours/optional feedback, DST/weekend timers, alert animation, reduced motion, phone widths');await browser.close();
})();
