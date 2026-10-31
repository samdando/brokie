// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});await page.addInitScript(()=>{try{localStorage.setItem("brokie.layout","focus");localStorage.setItem("brokie.coach.position","1")}catch{}});
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
await page.getByTestId('arcade-chart').waitFor();
await page.evaluate(()=>{
 const g=window.testGame,now=Date.parse('2026-10-27T13:15:00Z'),start=Math.floor(now/60000)-100;
 const wave=i=>i*.9+Math.sin(i*.11)*40+Math.sin(i*.31)*25,price=i=>29385.5+wave(i)-wave(100),iso=i=>new Date((start+i)*60000).toISOString();
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:price(i),high:Math.max(price(i),price(i+1))+6,low:Math.min(price(i),price(i+1))-6,close:price(i+1)}));
 g.now=()=>now;window.orders=[];window.reactions=[];window.vibrations=[];navigator.vibrate=p=>{window.vibrations.push(p);return true;};
 g.open=async(side,q)=>{window.orders.push({side,q});return null;};g.sendMessage=async(body,kind)=>{window.reactions.push({body,kind,squad:g.state.squadId});return null;};
 const bubbles=['ankits','bum','jaoushai'].map((handle,i)=>({state:'open',id:'friend-'+i,handle,is_you:false,side:i===1?'short':'long',quantity:10,entry_price:price(80+i*6),exit_price:null,pnl:null,reason:null,at:iso(80+i*6),opened_at:iso(80+i*6),size_pct:10,dd_floor:92000,equity:100000}));
 const feed=[{kind:'closed',id:'latest',handle:'jaoushai',is_you:false,market:'nas',side:'long',quantity:10,price:29380,pnl:180,reason:'closed',at:iso(99)},{kind:'opened',id:'short',handle:'bum',is_you:false,market:'nas',side:'short',quantity:10,price:29408,pnl:null,reason:null,at:iso(97)},{kind:'opened',id:'long',handle:'ankits',is_you:false,market:'gold',side:'long',quantity:1,price:2750,pnl:null,reason:null,at:iso(96)}];
 g.set({market:'nas',opposite:'hedge',candleSeconds:60,clockOffset:now-Date.now(),candles:{...g.state.candles,nas:candles},bubbleScope:'nas:s',bubbles,feed,me:{...g.state.me,cash:100000,positions:[{id:'mine',market:'nas',side:'short',quantity:100,entry_price:29408,opened_at:iso(88)}],quotes:[{market:'nas',price:29385.5,quoted_at:new Date(now).toISOString()},{market:'gold',price:2750,quoted_at:new Date(now).toISOString()},{market:'es',price:6500,quoted_at:new Date(now).toISOString()},{market:'us30',price:46500,quoted_at:new Date(now).toISOString()}]}});
 g.set({candles:{...g.state.candles,btc:candles,eth:candles,sol:candles},me:{...g.state.me,quotes:[...g.state.me.quotes,...['btc','eth','sol'].map(market=>({market,price:29385.5,quoted_at:new Date(now).toISOString()}))]}});
 window.predictionCalls=[]; const base=g.api.rpc;g.api.rpc=async(name,args)=>{if(/prediction/.test(name))window.predictionCalls.push(name);return base(name,args);};
});
await page.waitForTimeout(600);
// First-time hints: two quiet pills, no wash over the candles, gone on their own within ~7 s.
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[]}})});await page.getByTestId('hold-coach').waitFor();
assert.equal(await page.locator('.coach-pill').count(),2,'two hint pills');
await page.screenshot({path:'/tmp/focus-coach.png'});
assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.coach-zone.long'),'::before').backgroundColor),'rgba(0, 0, 0, 0)','no white wash');
await page.waitForTimeout(7200);
assert.equal(await page.getByTestId('hold-coach').count(),0,'hints fade away by themselves');await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[{id:'mine',market:'nas',side:'short',quantity:100,entry_price:29408,opened_at:new Date(g.now()-600000).toISOString()}]}})});await page.waitForTimeout(300);
// Friends' open trades show on the focus chart as markers.
const n=await page.locator('.arcade-overlay .tm-person').count(); assert(n>=3,'friend faces on the focus chart: '+n);
assert.equal(await page.locator('.arcade-overlay [data-handle="bum"][data-side="short"]').count(),1,'bum short marker');
// Tapping a marker opens the trade card without starting a hold-to-trade.
await page.locator('.arcade-overlay .tm').first().tap();
await page.waitForTimeout(200);
assert.equal(await page.getByTestId('trade-card').count(),1,'trade card opens');
assert.equal(await page.getByTestId('hold-label').count(),0,'no hold started');
assert.equal(await page.evaluate(()=>window.orders.length),0,'no order placed');
await page.getByLabel('Close trade card').tap();
// The 👥 toggle in the drawer hides them.
await page.getByTestId('focus-more').tap(); await page.getByTestId('focus-crowd').waitFor();
assert((await page.getByTestId('focus-crowd').innerText()).includes('3 in right now'),'drawer counts mates');
await page.getByTestId('focus-crowd').tap(); await page.waitForTimeout(150);
assert.equal(await page.locator('.arcade-overlay .tm:not(.me)').count(),0,'friends hidden after toggle');
await page.getByTestId('focus-crowd').tap(); await page.waitForTimeout(150);
assert(await page.locator('.arcade-overlay .tm-person').count()>=3,'friends back');
assert.equal(errors.length,0,'no page errors: '+errors.join('; '));
console.log('PASS focus-bubbles: friends\' trades on the focus chart, tap opens the card without trading, drawer toggle');
await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
