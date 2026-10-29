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
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('equity').waitFor();
await page.evaluate(() => {
 const g=window.testGame; g.setCandleSeconds(60);
 const base=Math.floor(Date.now()/60000)*60000;
 const iso=minutes=>new Date(base-minutes*60000).toISOString();
 const closed=(id,handle,side='long')=>({id,handle,is_you:handle==='sam',state:'closed',side,quantity:1,entry_price:29673,exit_price:29681,pnl:side==='long'?16:-16,reason:'closed',opened_at:iso(25),at:iso(17),size_pct:null,dd_floor:null,equity:null});
 const bubbles=[closed('quiet','quiet'),closed('short','sarah','short'),closed('mine','sam'),...Array.from({length:200},(_,i)=>closed('spam-'+i,'spammer')),
  {...closed('offscreen','older'),opened_at:iso(110),entry_price:29672}];
 g.set({bubbleScope:'nas:s',bubbles,me:{...g.state.me,positions:[{id:'own-a',market:'nas',side:'long',quantity:1,entry_price:29685,opened_at:iso(12)},{id:'own-b',market:'nas',side:'long',quantity:1,entry_price:29695,opened_at:iso(4)}]}});
});
await page.getByTestId('trade-path').first().waitFor();
await page.waitForTimeout(500);
assert.equal(await page.getByTestId('trade-path').count(),204,'every closed trade has a connector');
assert.equal(await page.getByTestId('my-bubble').count(),2,'own entries use individual fill times and prices');
const quiet=page.getByRole('button',{name:'@quiet entered long 1 micros at 29,673.00',exact:true});
await quiet.waitFor();
assert.equal(await quiet.evaluate(e=>getComputedStyle(e).opacity),'1','entry is fully opaque');
assert.equal(await page.getByTestId('exit-mark').first().evaluate(e=>getComputedStyle(e).opacity),'1','exit is fully opaque');
assert.equal(await page.locator('.trade-connectors').evaluate(e=>getComputedStyle(e).pointerEvents),'none','lines allow chart navigation');
assert.equal(await page.locator('[data-trade-id="offscreen"] .trade-path-line').evaluate(e=>+e.getAttribute('x1')<0),true,'older entry remains beyond the edge rather than being moved onto a candle');
const entry=await quiet.boundingBox(),spam=page.getByRole('button',{name:'@spammer 200 entries. Tap to view every trade',exact:true}),spamBox=await spam.boundingBox();
assert(Math.hypot(entry.x-spamBox.x,entry.y-spamBox.y)>=35,'spam group does not cover a quiet player');
await spam.click();
assert.equal(await page.getByTestId('trade-group').locator('.trade-group-list > button').count(),200,'all spam fills remain individually accessible');
await page.getByTestId('trade-group').locator('.trade-group-list > button').last().click();
await page.getByTestId('trade-card').waitFor();
assert((await page.getByTestId('trade-card').innerText()).includes('29,673.00'),'cluster trade opens exact fill details');
await page.getByRole('button',{name:'Close trade card',exact:true}).click();
await page.getByRole('button',{name:'Close trade list',exact:true}).click();
for(const [width,height] of [[320,568],[393,852],[430,932]]) {
 await page.setViewportSize({width,height}); await page.waitForTimeout(200);
 assert.equal(await page.getByTestId('trade-path').count(),204,'all lines at phone width '+width);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
 await page.getByTestId('big-chart').click(); await page.waitForTimeout(450);
 assert.equal(await page.getByTestId('my-bubble').count(),2,'open fills in fullscreen '+width);
 assert.equal(await page.getByTestId('trade-path').count(),204,'closed lines in fullscreen '+width);
 if(width===393) await page.screenshot({path:'/tmp/brokie-trade-markers.png'});
 await page.getByTestId('big-chart').click(); await page.waitForTimeout(400);
}
await page.getByTestId('history-toggle').click();
assert.equal(await page.getByTestId('trade-path').count(),0,'history toggle hides connectors');
assert.equal(await page.getByTestId('exit-mark').count(),0,'history toggle hides closed exits');
assert.equal(await page.getByTestId('my-bubble').count(),2,'open entries remain');
await page.getByTestId('history-toggle').click();
await page.getByTestId('crowd-toggle').click();
assert.equal(await page.getByTestId('trade-path').count(),1,'squad toggle leaves only your own history');
assert.equal(await page.getByTestId('my-bubble').count(),2,'squad toggle preserves your entries');
await page.getByTestId('crowd-toggle').click();
await page.evaluate(async()=>{
 const g=window.testGame, snapshot={...g.state}, calls=[];
 g.api.rpc=async(name,args)=>{calls.push({name,args});return []};
 await window.realRefreshBubbles();
 const call=calls.find(c=>c.name==='chart_bubbles');
 if(call.args.p_from!==new Date(snapshot.candles.nas[0].index*60000).toISOString())throw Error('query did not request loaded candle history');
 let finish; g.api.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=window.realRefreshBubbles();
 g.set({candleSeconds:300,bubbles:[]});finish([{id:'stale-window'}]);await pending;
 if(g.state.bubbles.length)throw Error('stale timeframe response overwrote new chart');
 g.set(snapshot);
});
await page.evaluate(async()=>{
 const {tradeMarkers}=await import('/src/tradeMarkers.ts');
 const at=new Date().toISOString(), base={state:'closed',side:'long',quantity:1,exit_price:100,pnl:1,reason:'closed',opened_at:at,at,is_you:false,size_pct:null,dd_floor:null,equity:null};
 const trades=[{...base,id:'quiet',handle:'quiet',entry_price:50},...Array.from({length:600},(_,i)=>({...base,id:'many-'+i,handle:'aaa_spammer',entry_price:i,exit_price:i+3}))];
 const groups=tradeMarkers(trades,(_time,price)=>({x:18+price%120,y:18+(Math.floor(price/120)*31)%80,clamped:false}),160,120,false,true);
 const ids=new Set(groups.flatMap(g=>g.trades.map(b=>b.id)));
 if(ids.size!==601)throw Error('packed chart lost a fill');
 if(!groups.some(g=>g.trades.some(b=>b.handle==='quiet')))throw Error('packed chart lost a quiet player');
 for(let i=0;i<groups.length;i++) for(let j=i+1;j<groups.length;j++) if(Math.hypot(groups[i].x-groups[j].x,groups[i].y-groups[j].y)<35)throw Error('packed chart covers another marker');
});
assert.deepEqual(errors,[]);
console.log('PASS chart: opaque entries/exits, exact closed paths, 200 overlapping fills retain quiet players, complete cluster lists, individual own entries, offscreen clipping, toggles, phone/fullscreen layouts and request windows/races');
await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
