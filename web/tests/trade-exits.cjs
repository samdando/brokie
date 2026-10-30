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
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('go-long').waitFor();
await page.evaluate(()=>{
 const g=window.testGame;g.setMarket('nas');g.now=()=>Date.parse('2026-10-27T13:15:00Z');const now=new Date(g.now()).toISOString();
 const leg=(id,market='nas',side='long',quantity=1)=>({id,market,side,quantity,entry_price:30000,opened_at:now});
 window.originalPositions=[leg('p1'),leg('p2'),leg('other-market','gold','short',3)];window.closes=[];
 g.set({me:{...g.state.me,positions:window.originalPositions,quotes:g.state.me.quotes.map(q=>({...q,price:30000,quoted_at:now}))}});
 g.closeStack=async ids=>{window.closes.push([...ids]);return {pnl:20};};
});
await page.waitForTimeout(450);
const drag=async(target,dx,dy=0,cancel=false,mid)=>{
 const b=await target.boundingBox(),x=b.x+Math.min(30,b.width*.1),y=b.y+b.height*.55;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});
 if(mid)await mid();
 if(cancel)await target.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await page.waitForTimeout(200);
};
const status=page.getByTestId('trading-status');
await status.click();await page.getByTestId('positions-sheet').waitFor();await page.getByRole('button',{name:'Close positions',exact:true}).click();assert.equal(await page.evaluate(()=>window.closes.length),0,'tap still opens management');
await drag(status,45);assert.equal(await page.evaluate(()=>window.closes.length),0,'short swipe does not close');
await drag(status,-180);assert.equal(await page.evaluate(()=>window.closes.length),0,'left swipe does not close');
await drag(status,18,60);assert.equal(await page.evaluate(()=>window.closes.length),0,'vertical scroll does not close');
await drag(status,180,0,true);assert.equal(await page.evaluate(()=>window.closes.length),0,'cancel does not close');
await drag(status,180,0,false,async()=>{assert.match(await page.locator('.quick-close-progress').innerText(),/Release to close/);await page.screenshot({path:'/tmp/brokie-quick-close.png'});});
assert.deepEqual(await page.evaluate(()=>window.closes),[['p1','p2']],'only the displayed stack closes, not another market');assert.equal(await page.getByTestId('positions-sheet').count(),0);
// A newly added leg cancels the in-progress swipe rather than silently broadening its scope.
await drag(status,180,0,false,async()=>{await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[...window.originalPositions,{...window.originalPositions[0],id:'new-size'}]}});});await page.waitForTimeout(50);});assert.equal(await page.evaluate(()=>window.closes.length),1);
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:window.originalPositions}});g.closeStack=async ids=>{window.closes.push([...ids]);await new Promise(r=>window.resolveClose=r);return {error:'Close refused'};};});
await drag(status,180);await drag(status,180);assert.equal(await page.evaluate(()=>window.closes.length),2,'no duplicate close while pending');await page.evaluate(()=>window.resolveClose());await page.getByTestId('toast').getByText('Close refused',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.testGame.state.me.positions.length),3,'failure keeps positions');
// Blank lower chart is also a swipe surface; fullscreen chart remains available to pan.
await page.evaluate(()=>{const g=window.testGame;g.closeStack=async ids=>{window.closes.push([...ids]);return {pnl:0};};});
const chart=page.locator('.chart-host');const b=await chart.boundingBox();await page.mouse.move(b.x+110,b.y+b.height*.8);await page.mouse.down();await page.mouse.move(b.x+290,b.y+b.height*.8,{steps:12});await page.mouse.up();await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.closes.length),3,'lower chart supports close');
await page.getByTestId('big-chart').click();await page.waitForTimeout(450);await drag(chart,140);assert.equal(await page.evaluate(()=>window.closes.length),3,'fullscreen pan never closes');await page.getByTestId('back-to-live').click();await drag(status,180);assert.equal(await page.evaluate(()=>window.closes.length),4,'fullscreen P&L swipe closes');await page.getByTestId('big-chart').click();await page.waitForTimeout(450);
// A hedge opens the chooser; it never closes either side automatically.
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[...window.originalPositions,{...window.originalPositions[0],id:'hedge',side:'short'}]}});});
await drag(status,180);await page.getByTestId('positions-sheet').waitFor();assert.equal(await page.evaluate(()=>window.closes.length),4);await page.getByRole('button',{name:'Close positions',exact:true}).click();
// Protection has distinct price/amount inputs and previews the short's actual trigger direction.
await page.evaluate(()=>{const g=window.testGame;const p={...window.originalPositions[0],id:'short',side:'short',quantity:5};g.set({me:{...g.state.me,positions:[p]}});window.saves=[];g.api.rpc=async(name,args)=>{if(name!=='set_position_bracket')return {};window.saves.push(args);return {positions:[{...g.state.me.positions[0],[args.p_kind==='tp'?'take_profit':'stop_loss']:args.p_price}]};};});
await status.click();await page.getByRole('button',{name:'Manage SL/TP for NAS short'}).click();const editor=page.getByTestId('protection-editor');await editor.waitFor();
await page.getByLabel('Take profit price',{exact:true}).fill('1000');assert.match(await page.getByTestId('preview-tp').innerText(),/at or below 1,000.00/);assert.match(await page.getByTestId('preview-tp').innerText(),/\+\$290,000.00/);
await page.getByRole('button',{name:'Profit / loss ($)',exact:true}).click();await page.getByLabel('Take profit amount',{exact:true}).fill('1200');assert.match(await page.getByTestId('preview-tp').innerText(),/at or below 29,880.00/);assert.match(await page.getByTestId('preview-tp').innerText(),/\+\$1,200.00/);
await editor.locator('.protection-row').nth(1).getByRole('button',{name:'Save',exact:true}).click();await editor.getByText('Active · 29,880.00',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.saves[0].p_price),29880,'server receives market price, not requested dollar profit');
await page.getByLabel('Stop loss amount',{exact:true}).fill('200');assert.match(await page.getByTestId('preview-sl').innerText(),/at or above 30,020.00/);assert.match(await page.getByTestId('preview-sl').innerText(),/−\$200.00/);
await page.getByTestId('toast').waitFor({state:'hidden'});await page.screenshot({path:'/tmp/brokie-protection-amount.png'});await editor.getByRole('button',{name:'Done',exact:true}).click();
// A season failure has a visible explanation and a player-controlled unused restart.
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[],rules:{...g.state.me.rules,status:'blown',equity:91900,drawdown_floor:92000,resets_used:0}}});});
assert(await page.getByTestId('go-long').isDisabled());await page.getByTestId('season-restriction').click();await page.getByTestId('status-blown').waitFor();assert.match(await page.getByTestId('status-blown').innerText(),/new trading day won't reset it/);assert(await page.getByRole('button',{name:'Use free restart',exact:true}).isVisible());await page.waitForTimeout(400);await page.screenshot({path:'/tmp/brokie-season-status.png'});
assert.deepEqual(errors,[]);console.log('PASS exits: lower-half and fullscreen dock swipes, explicit market scope, tap management, cancellation/scroll/left gestures, changed positions, pending/error handling, hedge choice, price vs dollar targets and season restart visibility');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
