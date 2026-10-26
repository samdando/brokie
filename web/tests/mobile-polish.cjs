// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});
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
await page.evaluate(()=>{window.testGame.setCandleSeconds(60);window.testGame.setQty(1);window.testGame.isOpen=()=>true;window.orders=[];
const g=window.testGame,c=g.state.candles.nas,stamp=(n)=>new Date(c[c.length-n].index*60000).toISOString();
g.set({bubbleScope:'nas:s',bubbles:[...['ankits','fuko','sam'].map((handle,i)=>({id:'open'+i,handle,is_you:false,state:'open',market:'nas',side:i===1?'short':'long',quantity:10,entry_price:c[c.length-12-i*8].close,opened_at:stamp(12+i*8),at:stamp(12+i*8),exit_price:null})),...Array.from({length:20},(_,i)=>({id:'closed'+i,handle:'jaoushai',is_you:false,state:'closed',market:'nas',side:'long',quantity:1,entry_price:c[c.length-50].close,opened_at:stamp(50),at:stamp(30),exit_price:c[c.length-30].close,pnl:20,reason:'manual'}))]});window.testGame.open=async(side,q)=>{window.orders.push({side,q});return null;};});
assert.equal(await page.getByTestId('exit-mark').count(),0,'closed history hidden initially');
await page.getByTestId('history-toggle').click();await page.waitForTimeout(200);
assert((await page.getByTestId('exit-mark').count())<=1,'dense closed trades thinned around open positions');assert.equal(await page.getByTestId('earlier-trades').count(),0,'overlapping exits are not labelled offscreen');
await page.getByTestId('history-toggle').click();
const cdp=await page.context().newCDPSession(page);
async function swipeWheel(id,dy){
 const r=await page.getByTestId(id).boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/8}]});await page.waitForTimeout(35);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(700);
}
await page.evaluate(()=>window.scrollTo(0,0));
const y=await page.evaluate(()=>window.scrollY);
await swipeWheel('timeframe-rail',-35);
assert((await page.evaluate(()=>window.testGame.state.candleSeconds))>60,'finger swipe selects another interval');
assert.equal(await page.evaluate(()=>window.scrollY),y,'wheel gesture does not scroll page');
await swipeWheel('micro-rail',-35);
assert((await page.evaluate(()=>window.testGame.state.qty))>1,'micro wheel swipes');
await page.getByTestId('big-chart').click();await page.waitForTimeout(500);
assert(await page.getByTestId('go-long').isVisible());
assert(await page.getByTestId('go-short').isVisible());
await page.getByTestId('timeframe-rail').press('Home');await swipeWheel('timeframe-rail',-35);
assert((await page.evaluate(()=>window.testGame.state.candleSeconds))>60,'native swipe works inside fullscreen');
await page.getByTestId('micro-rail').press('Home');await swipeWheel('micro-rail',-35);
const qty=await page.evaluate(()=>window.testGame.state.qty);
await page.getByTestId('go-long').click();await page.waitForTimeout(650);
await page.getByTestId('go-short').click();await page.waitForTimeout(650);
assert.deepEqual(await page.evaluate(()=>window.orders),[{side:'long',q:qty},{side:'short',q:qty}]);
for(const [width,height] of [[320,568],[393,852],[430,932],[852,393]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(500);
 const chart=await page.locator('.chart-host').boundingBox(),controls=await page.locator('.chart-controls').boundingBox(),dock=await page.locator('.trade-dock').boundingBox();
 assert(chart.y+chart.height<=controls.y+2,'chart clear of controls '+width);
 assert(controls.y+controls.height<=dock.y+2,'controls clear of order dock '+width);
 assert(dock.y+dock.height<=height,'fullscreen orders fit '+width);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(width===393)await page.screenshot({path:'/tmp/brokie-polish-fullscreen.png'});
}
await page.setViewportSize({width:393,height:852});await page.getByTestId('big-chart').click();await page.waitForTimeout(500);await page.evaluate(()=>window.scrollTo(0,0));
await page.getByTestId('timeframe-rail').press('Home');await page.waitForTimeout(300);assert((await page.getByTestId('bubble').count())>0,'open avatar markers visible');await page.screenshot({path:'/tmp/brokie-polish-floor.png'});
const chart=await page.locator('.chart-host').boundingBox(),dock=await page.locator('.trade-dock').boundingBox();assert(chart.y+chart.height<=dock.y,'first chart clears dock');
for(const [id,n] of [['nas','100'],['es','500'],['us30','30']])assert.equal(await page.getByTestId('market-'+id).locator('svg text').textContent(),n);
await page.evaluate(()=>{const g=window.testGame,at=Date.now();g.set({chat:Array.from({length:35},(_,i)=>({id:i+1,handle:i%6<3?'sam':'ankits',is_you:i%6<3,kind:i%7===0?'emoji':'text',body:i%7===0?'🫡':i%3===0?'Gold looks good from here. Watching the next session.':'That entry was clean',at:new Date(at-(35-i)*60000).toISOString()}))});g.sendMessage=async(body,kind)=>{g.set({chat:[...g.state.chat,{id:Date.now(),handle:'sam',is_you:true,kind,body,at:new Date().toISOString()}]});return null;};});
await page.getByTestId('chat-btn').click();await page.getByTestId('chat-input').waitFor();await page.waitForTimeout(400);
const log=page.locator('.chat-log');assert(await log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<5),'opens at latest');
await log.evaluate(e=>e.scrollTop=100);await page.waitForTimeout(300);
await page.evaluate(()=>{const g=window.testGame;g.set({chat:[...g.state.chat,{id:999,handle:'ankits',is_you:false,kind:'text',body:'New message while reading',at:new Date().toISOString()}]});});
await page.waitForTimeout(200);assert((await log.evaluate(e=>e.scrollTop))<150,'polling preserves reading position');
await page.getByRole('button',{name:'New messages ↓'}).click();assert(await log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<5));
await page.getByTestId('chat-input').fill('Looks clean');await page.getByTestId('chat-send').click();await page.getByText('Looks clean',{exact:true}).waitFor();
await page.getByRole('button',{name:'Emoji reactions'}).click();await page.getByTestId('emoji-bar').waitFor();await page.waitForTimeout(100);assert(await log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<5),'composer resize keeps latest visible');
await page.screenshot({path:'/tmp/brokie-polish-chat.png'});
assert((await page.locator('.message-row.grouped').count())>0,'consecutive messages grouped');
for(const width of [320,393,430]){await page.setViewportSize({width,height:800});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const input=await page.getByTestId('chat-input').boundingBox();assert(input.width>100,'usable composer');}
assert.deepEqual(errors,[]);console.log('PASS mobile finger wheels, fullscreen buy/sell fills, portrait/landscape layout, flags, grouped chat, reading anchor and send');await browser.close();})();
