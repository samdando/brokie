// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
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
// Chat is one tap away from any screen: header button with an unread badge.
await page.evaluate(()=>window.testGame.set({chatUnread:3}));assert.equal(await page.getByTestId('chat-badge').textContent(),'3');
await page.getByTestId('chat-btn').click();await page.getByTestId('chat-input').waitFor({state:"visible"});await shot('chat-header');
assert.equal(await page.getByTestId('chat-badge').count(),0,'opening chat clears the badge');await page.getByRole('button',{name:'Done',exact:true}).click();
assert(await page.getByTestId('go-long').isVisible(),'closing chat stays on the trade screen');
// Target alone is 🎯 TARGET HIT; funded needs the 5 trading days too.
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,target_hit:true,funded:false}}})});
await page.getByTestId('target-chip').waitFor();assert.equal(await page.getByTestId('funded-chip').count(),0);
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,target_hit:true,funded:true,trading_days:5}}})});
await page.getByTestId('funded-chip').waitFor();assert.equal(await page.getByTestId('target-chip').count(),0);
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,target_hit:false,funded:false,trading_days:1}}})});
const buy=await page.getByTestId('go-long').boundingBox(),nav=await page.locator('.tabs').boundingBox();assert(buy.y+buy.height<=nav.y,'buy overlaps nav');
await page.locator('.compact-rules summary').click();await page.getByTestId('meter-dd').waitFor({state:"visible"});await page.locator('.compact-rules summary').click();
await page.getByRole('button',{name:'Chart info'}).click();await page.locator('.chart-help').waitFor({state:"visible"});
await page.getByTestId('tab-squad').click();await shot('squad');
assert(await page.locator('[data-testid="leader-row"]').count()===5);
await page.getByRole('button',{name:"View @ankits's profile"}).click();await page.getByTestId('player-profile').waitFor();await page.getByText('Max drawdown',{exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
assert(await page.getByTestId('invite-code').count()===0);
await page.getByRole('button',{name:'Invite / manage'}).click();await page.getByTestId('invite-code').waitFor({state:"visible"});await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('chat-btn').click();await page.getByTestId('chat-input').waitFor({state:"visible"});await shot('chat');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.locator('.activity-group summary').click();assert(await page.locator('.activity-group .panel').count()===5);
await page.getByTestId('tab-learn').click();await page.getByText('Essentials complete.',{exact:true}).waitFor({state:"visible"});await shot('learn');
await page.getByRole('button',{name:'Put it into practice'}).click();await page.getByTestId('equity').waitFor({state:"visible"});
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,status:'locked'},cash:94995}})});
assert(await page.getByTestId('go-long').isDisabled());await shot('locked');
await page.getByRole('button',{name:'Review your trades'}).click();await shot('you');
await page.getByTestId('receipt').click();await page.getByText('Trade details',{exact:true}).waitFor({state:"visible"});await page.getByTestId('prepare-card').click();await page.getByTestId('share-card').waitFor({state:"visible"});await shot('receipt');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('tab',{name:'Lifetime',exact:true}).click();await page.getByTestId('lifetime').waitFor({state:"visible"});await shot('lifetime');
const sizes = [[320,568],[375,667],[390,844],[393,852],[430,932],[768,1024],[1024,768],[1440,900]];
for(const [width,height] of sizes) {
 await page.setViewportSize({width,height});
 for(const tab of ['trade','squad','learn','you']){await page.getByTestId('tab-'+tab).click();await shot(tab+'-'+width);}
 await page.getByTestId('tab-trade').click();
 // Tap where the page is: Playwright's own click may re-scroll the button clear of the tab bar first.
 await page.getByTestId('big-chart').evaluate(el=>el.scrollIntoView({block:'center'}));
 const scroll = await page.getByTestId('big-chart').evaluate(el=>{const y=scrollY; el.click(); return y;});
 await page.getByRole('dialog',{name:'Fullscreen chart'}).waitFor();
 assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
 assert.equal(await page.locator('.chart-host').evaluate(el=>getComputedStyle(el).touchAction),'none');
 await page.mouse.move(width/2,40); await page.mouse.wheel(0,500);   // over the fullscreen header: the page must not scroll
 assert.equal(await page.evaluate(()=>scrollY),0,'page behind fullscreen does not scroll');
 await shot('fullscreen-'+width);
 const box=await page.getByTestId('big-chart').boundingBox(); assert(box.y>=0 && box.y+box.height<=height,'fullscreen exit reachable');
 await page.getByTestId('big-chart').click(); await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>scrollY),scroll,'restore scroll');
 assert.equal(await page.evaluate(()=>document.body.style.position),'');
}
await page.getByTestId('tab-trade').click();
await page.evaluate(()=>{
 // On the live bar: the synthetic chart opens zoomed to the newest candle.
 const g=window.testGame;
 g.set({market:'nas',me:{...g.state.me,positions:[{id:'open1',market:'nas',side:'long',quantity:2,entry_price:29701,opened_at:new Date(Math.floor(Date.now()/60000)*60000).toISOString()}]}});
});
// Tapping your position pill (without dragging) opens the trade's entry details.
assert.equal(await page.getByTestId('bracket-grip').getAttribute('data-pinned'),null,'entry in view: pill sits on the entry line');
await page.getByTestId('bracket-grip').click();
await page.getByTestId('trade-card').getByText('Entry time',{exact:true}).waitFor();
await page.getByTestId('trade-card').getByText('Current P&L',{exact:true}).waitFor();
await page.getByRole('button',{name:'Close trade card'}).click();
// So does your face marker, where the chart draws it (the synthetic test chart doesn't place markers).
if(await page.getByTestId('my-bubble').count()){await page.getByTestId('my-bubble').click();await page.getByTestId('trade-card').getByText('Entry time',{exact:true}).waitFor();await page.getByRole('button',{name:'Close trade card'}).click();}
// Entry far off the zoomed chart: the pill pins to the edge so size and P&L stay visible, in fullscreen too.
await page.evaluate(()=>{const g=window.testGame; g.set({me:{...g.state.me,positions:[{...g.state.me.positions[0],quantity:7,entry_price:29000}]}});});
await page.getByTestId('bracket-grip').waitFor();
assert.equal(await page.getByTestId('bracket-grip').getAttribute('data-pinned'),'below','pill pins to the bottom edge');
assert.match(await page.getByTestId('bracket-grip').innerText(),/L7/);
const host=await page.locator('.chart-host').boundingBox(), pill=await page.getByTestId('bracket-grip').boundingBox();
assert(pill.y>=host.y && pill.y+pill.height<=host.y+host.height-20,'pinned pill inside the plot, above the time axis');
await page.getByTestId('big-chart').click();
assert.equal(await page.getByTestId('bracket-grip').getAttribute('data-pinned'),'below','still pinned in fullscreen');
await page.screenshot({path:'/tmp/brokie-pinned-fullscreen.png'});
await page.getByTestId('big-chart').click();
// Squad board shows W/L, not the lowest trade.
await page.evaluate(()=>{const g=window.testGame; g.set({leaderboard:g.state.leaderboard.map((r,i)=>({...r,trades:5,wins:3,losses:2}))});});
await page.getByTestId('tab-squad').click();
assert.match(await page.locator('[data-testid="leader-row"]').first().innerText(),/3W–2L/);
assert.equal(await page.getByText('lowest trade').count(),0);
await page.getByTestId('tab-trade').click();
await page.getByTestId('big-chart').click(); await page.keyboard.press('Escape');
assert.equal(await page.evaluate(()=>document.body.style.position),'');
assert.deepEqual(errors,[]); console.log('PASS: 8 screen sizes, fullscreen scroll lock/restoration, tap-pill entry details, pinned position pill, squad W/L, navigation, risk disclosure, chart info, squad management/chat, feed grouping, completion, lockout, receipts, lifetime; no runtime errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
