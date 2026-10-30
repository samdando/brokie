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
 const {game}=await import('/src/game.ts'); window.testGame=game; window.realRefreshBubbles=game.refreshBubbles.bind(game);
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?Object.fromEntries((args?.p_handles??[]).map(handle=>[handle,{symbol:({sam:'💎',jaoushai:'👽',mrsdandylion:'🌼',ankits:'😎',bum:'🐸'})[handle]??'👤',color:null}])):name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]'); localStorage.setItem('brokie.chartHistory','on');
});
await page.getByTestId('go-long').waitFor();
await page.evaluate(() => {
 const g=window.testGame; g.setCandleSeconds(60);
 const base=Math.floor(Date.now()/60000)*60000;
 const iso=minutes=>new Date(base-minutes*60000).toISOString();
 const closed=(id,handle,side='long')=>({id,handle,is_you:handle==='sam',state:'closed',side,quantity:1,entry_price:29673,exit_price:29681,pnl:side==='long'?16:-16,reason:'closed',opened_at:iso(25),at:iso(17),size_pct:null,dd_floor:null,equity:null});
 const bubbles=[closed('quiet','quiet'),closed('short','sarah','short'),closed('mine','sam'),...Array.from({length:200},(_,i)=>closed('spam-'+i,'spammer')),
  {...closed('offscreen','older'),opened_at:iso(110),entry_price:29672}];
 g.set({bubbleScope:'nas:s',bubbles,me:{...g.state.me,positions:[{id:'own-a',market:'nas',side:'long',quantity:1,entry_price:29685,opened_at:iso(12)},{id:'own-b',market:'nas',side:'long',quantity:1,entry_price:29695,opened_at:iso(4)}]}});
});
await page.locator('.tm.cluster').first().waitFor();
await page.waitForTimeout(500);
assert.equal(await page.getByTestId('trade-path').count(),0,'idle history has no connector web');
assert.equal(await page.locator('.trade-stem').count(),0,'markers are never scattered away from fills');
assert.equal(await page.locator('.trade-connectors').evaluate(e=>getComputedStyle(e).pointerEvents),'none','lines allow chart navigation');
assert(await page.locator('.tm.entry.history .player-avatar').count()>0,'historical entries show player pictures');
assert.equal(await page.locator('.tm.exit .player-avatar').count(),0,'exit-only stamps stay small');
assert(await page.locator('.tm.cluster .tm-person.long').count()>0,'crowded entries show long pictures');
assert(await page.locator('.tm.cluster .tm-person.short').count()>0,'opposing short pictures remain visible');
for(const side of ['long','short']) {
 const arrows=await page.locator(`.tm-person.${side} .tm-bias`).allTextContents();
 assert(arrows.length>0); assert(arrows.every(text=>text===(side==='long'?'↑':'↓')),'every picture keeps its own direction');
}
const reachable=new Set();
let foundQuiet=false, foundOlder=false;
const clusterCount=await page.locator('.tm.cluster').count();
for(let i=0;i<clusterCount;i++) {
 await page.locator('.tm.cluster').nth(i).click();
 const list=page.getByTestId('trade-group'); await list.waitFor();
 const ids=await list.locator('.trade-group-list > button').evaluateAll(es=>es.map(e=>e.dataset.tradeId));
 ids.forEach(id=>reachable.add(id));
 for(const id of ['quiet','offscreen']) if(ids.includes(id)) {
  await list.locator(`[data-trade-id="${id}"]`).click();
  await page.getByTestId('trade-card').waitFor();
  assert.equal(await page.getByTestId('trade-path').count(),1,'only the selected trade draws a connector');
  if(id==='quiet') {
   foundQuiet=true;
   assert((await page.getByTestId('trade-card').innerText()).includes('@quiet'),'quiet player keeps their own identity');
   assert((await page.getByTestId('trade-card').innerText()).includes('29,673.00'),'selected cluster trade uses exact fill');
  } else {
   foundOlder=true;
   assert(await page.locator('[data-trade-id="offscreen"] .trade-path-line').evaluate(e=>+e.getAttribute('x1')<0),'older selected entry clips at the plot edge');
  }
  await page.getByRole('button',{name:'Close trade card',exact:true}).click();
  assert.equal(await page.getByTestId('trade-path').count(),0,'closing details clears the path');
 }
 await page.getByRole('button',{name:'Close trade list',exact:true}).click();
}
assert(foundQuiet && foundOlder,'quiet players and offscreen entries remain selectable');
for(let i=0;i<200;i++) assert(reachable.has('spam-'+i),'all 200 overlapping fills remain accessible');
assert(await page.locator('.tm').count()<10,'dense activity shares a few targets');
for(const [width,height] of [[320,568],[393,852],[430,932]]) {
 await page.setViewportSize({width,height}); await page.waitForTimeout(200);
 assert.equal(await page.getByTestId('trade-path').count(),0,'no idle connectors at width '+width);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
 await page.getByTestId('big-chart').click(); await page.waitForTimeout(450);
 assert(await page.getByTestId('my-bubble').count()>0,'own open activity remains in fullscreen '+width);
 const markers=await page.locator('.tm').evaluateAll(es=>es.map(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top),width:e.getBoundingClientRect().width,shadow:getComputedStyle(e).boxShadow,target:getComputedStyle(e,'::after').width})));
 for(const marker of markers) { assert(marker.width<=64,'compact picture groups'); assert.equal(marker.shadow,'none','no permanent glow'); assert(parseFloat(marker.target)>=44,'at least 44px tap target'); }
 for(let i=0;i<markers.length;i++) for(let j=i+1;j<markers.length;j++) assert(Math.hypot(markers[i].x-markers[j].x,markers[i].y-markers[j].y)>=44,'tap targets stay separated');
 if(width===393) await page.screenshot({path:'/tmp/brokie-trade-markers.png'});
 await page.getByTestId('big-chart').click(); await page.waitForTimeout(400);
}
await page.getByTestId('history-toggle').click();
assert.equal(await page.locator('.tm.history').count(),0,'history toggle hides closed activity');
assert(await page.getByTestId('my-bubble').count()>0,'open entries remain');
await page.getByTestId('history-toggle').click();
await page.getByTestId('crowd-toggle').click();
await page.locator('.tm.cluster').first().click();
assert.equal(await page.getByTestId('trade-group').getByText('@spammer',{exact:true}).count(),0,'squad toggle removes friends from groups');
assert(await page.getByTestId('trade-group').getByText('You',{exact:true}).count()>0,'squad toggle retains own fills');
await page.getByRole('button',{name:'Close trade list',exact:true}).click();
await page.getByTestId('crowd-toggle').click();
await page.evaluate(async()=>{
 const g=window.testGame, snapshot={...g.state}, calls=[], originalRPC=g.api.rpc;
 g.api.rpc=async(name,args)=>{calls.push({name,args});return []};
 await window.realRefreshBubbles();
 const call=calls.find(c=>c.name==='chart_bubbles');
 if(call.args.p_from!==new Date(snapshot.candles.nas[0].index*60000).toISOString())throw Error('query did not request loaded candle history');
 let finish; g.api.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=window.realRefreshBubbles();
 g.set({candleSeconds:300,bubbles:[]});finish([{id:'stale-window'}]);await pending;
 if(g.state.bubbles.length)throw Error('stale timeframe response overwrote new chart');
 g.set(snapshot); g.api.rpc=originalRPC;
});
await page.evaluate(async()=>{
 const {tradeMarkers}=await import('/src/tradeMarkers.ts');
 const at=new Date().toISOString(), base={state:'closed',side:'long',quantity:1,exit_price:100,pnl:1,reason:'closed',opened_at:at,at,is_you:false,size_pct:null,dd_floor:null,equity:null};
 const trades=[{...base,id:'quiet',handle:'quiet',entry_price:50},...Array.from({length:600},(_,i)=>({...base,id:'many-'+i,handle:'aaa_spammer',entry_price:i,exit_price:i+3}))];
 const groups=tradeMarkers(trades,(_time,price)=>({x:18+price%120,y:18+(Math.floor(price/120)*31)%80,clamped:false}),160,120,false,true);
 const ids=new Set(groups.flatMap(g=>g.trades.map(b=>b.id)));
 if(ids.size!==601)throw Error('packed chart lost a fill');
 if(!groups.some(g=>g.trades.some(b=>b.handle==='quiet')))throw Error('packed chart lost a quiet player');
 for(let i=0;i<groups.length;i++) for(let j=i+1;j<groups.length;j++) if(Math.abs(groups[i].x-groups[j].x)<68 && Math.abs(groups[i].y-groups[j].y)<44)throw Error('packed chart covers another marker');
});
// A busy, varied floor for visual review, rather than only a same-price spam pile.
await page.setViewportSize({width:393,height:852});
await page.evaluate(()=>{
 const g=window.testGame, start=Math.floor(Date.now()/60000)-100;
 const price=i=>29630+i*.55+Math.sin(i*.15)*27+Math.sin(i*.5)*9;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:price(i),high:Math.max(price(i),price(i+1))+4,low:Math.min(price(i),price(i+1))-4,close:price(i+1)}));
 const iso=i=>new Date((start+i)*60000).toISOString();
 const handles=['jaoushai','mrsdandylion','ankits','bum','sam'];
 const bubbles=Array.from({length:36},(_,i)=>{
  const entry=42+i%48,exit=Math.min(98,entry+4+i%9),long=i%3!==0;
  return {id:'busy-'+i,market:'nas',handle:handles[i%5],is_you:handles[i%5]==='sam',state:'closed',side:long?'long':'short',quantity:1+i%10,entry_price:price(entry),exit_price:price(exit),pnl:(price(exit)-price(entry))*2*(long?1:-1),reason:'closed',opened_at:iso(entry),at:iso(exit),size_pct:null,dd_floor:null,equity:null};
 });
 bubbles.push(...['ankits','bum'].map((handle,i)=>({id:'active-'+i,market:'nas',handle,is_you:false,state:'open',side:i?'short':'long',quantity:10,entry_price:price(92-i*15),exit_price:null,pnl:null,reason:null,opened_at:iso(92-i*15),at:iso(92-i*15),size_pct:null,dd_floor:null,equity:null})));
 g.set({candleSeconds:60,candles:{...g.state.candles,nas:candles},bubbleScope:'nas:s',bubbles,me:{...g.state.me,quotes:g.state.me.quotes.map(q=>q.market==='nas'?{...q,price:price(100)}:q),positions:[{id:'busy-own',market:'nas',side:'short',quantity:10,entry_price:price(92),opened_at:iso(92)}]}});
});
await page.mouse.move(392,851);
await page.waitForTimeout(600);
await page.locator('.chart-card').screenshot({path:'/tmp/brokie-chart-cleanup-compact.png'});
await page.getByTestId('big-chart').click(); await page.waitForTimeout(450);
await page.screenshot({path:'/tmp/brokie-chart-cleanup-393.png'});
assert(await page.locator('.tm.entry .player-avatar').count()>0,'busy chart keeps entry pictures');
assert.equal(await page.locator('.tm.entry .tm-person').evaluateAll(es=>Math.max(...es.map(e=>e.parentElement.querySelectorAll('.tm-person').length))),2,'crowded picture markers cap visible identities');
const busy=await page.locator('.tm').count();
assert(busy<25,'busy chart stays readable across 36 closed trades');
assert.equal(await page.getByTestId('trade-path').count(),0,'busy chart also keeps paths on demand');
assert.deepEqual(errors,[]);
console.log('PASS chart: entry pictures and per-player long/short arrows, compact history, selected-only exact paths, 200 overlapping fills retain quiet players, complete cluster lists, offscreen clipping, 44px targets, toggles, phone/fullscreen layouts and request windows/races');
await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
