// Timeframes check: one chart button starts on your highest picked timeframe and steps down on each tap;
// the list is picked on the You tab and remembered. Synthetic state only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
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
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('go-long').waitFor();

await page.evaluate(()=>{
 const g=window.testGame, now=new Date().toISOString(); g.setCandleSeconds(60); g.set({me:{...g.state.me,positions:[{id:'pan-test',market:'nas',side:'long',quantity:1,entry_price:29700,opened_at:now}]}});
 g.api.rpc=async(name,args)=>{
  if(name==='player_avatars') return {sam:{symbol:'👑',color:'#D6FE59'},sarah:{symbol:'🚀',color:'#7CC8FF'}};
  if(name==='avatar_shop'||name==='buy_avatar'||name==='equip_avatar') return {balance:name==='buy_avatar'?5:8,equipped:name==='buy_avatar'?'bull':null,items:[{id:'bull',name:'Bull club',symbol:'🐂',color:'#73E7C3',price:3,owned:name==='buy_avatar'}]};
  if(name==='squad_dashboard') return {day:'2026-10-26',ends_at:now,players:[{handle:'sam',trades:3,wins:2,losses:1,pnl:123},{handle:'sarah',trades:2,wins:0,losses:2,pnl:-42}],open:[{handle:'sarah',market:'nas',side:'long',quantity:2,entry_price:29680,opened_at:now}]};
  return {};
 };
});
await page.getByTestId('big-chart').click();
assert(await page.locator('.chart-fullscreen').count(),'fullscreen opens');
assert(await page.locator('.chart-fullscreen').evaluate(e=>e.getAnimations().length>0),'expansion animates');
await page.waitForTimeout(400);
const host=page.locator('.chart-host'), rect=await host.boundingBox();
const beforePan=await page.getByTestId('bracket-grip').boundingBox();
await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
await page.mouse.down(); await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+80,{steps:12}); await page.mouse.up();
await page.getByTestId('back-to-live').waitFor();
const afterPan=await page.getByTestId('bracket-grip').boundingBox(); assert(Math.abs(afterPan.y-beforePan.y)>25,'drag actually moves the price range');
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,quotes:g.state.me.quotes.map(q=>({...q,price:q.price+1}))}});}); await page.waitForTimeout(500);
const afterTick=await page.getByTestId('bracket-grip').boundingBox(); assert(Math.abs(afterTick.y-afterPan.y)<2,'live tick does not snap price range back');
await page.mouse.wheel(0,400); await page.waitForTimeout(500);
assert(await page.getByTestId('back-to-live').count(),'zoom stays detached');
await page.getByTestId('back-to-live').click();
assert.equal(await page.getByTestId('back-to-live').count(),0,'Live restores tracking');
await page.screenshot({path:'/tmp/brokie-new-fullscreen.png'});
await page.getByTestId('big-chart').click(); await page.waitForTimeout(400);
assert.equal(await page.evaluate(()=>document.body.style.position),'','page scroll restored');
const footer=await page.locator('.tabs').boundingBox();
await page.getByTestId('tab-squad').click();
assert(await page.locator('.page-screen.entering').count(),'page slides');
const during=await page.locator('.tabs').boundingBox(); assert.equal(during.y,footer.y,'footer stays fixed');
await page.getByTestId('squad-active').waitFor(); await page.waitForTimeout(450);
assert.equal(await page.getByText('The pit',{exact:true}).count(),0,'pit replaced');
assert(await page.getByTestId('squad-active').innerText().then(t=>t.includes('sarah')),'active trade visible');
await page.getByTestId('squad-recap').locator('summary').click();assert(await page.getByTestId('squad-daily').innerText().then(t=>t.includes('123')&&t.includes('42')),'daily member totals visible');
assert((await page.getByTestId('squad-active').boundingBox()).y < (await page.locator('.competition-board').boundingBox()).y,'active trades first');
await page.screenshot({path:'/tmp/brokie-new-squad.png',fullPage:true});
await page.getByTestId('tab-you').click(); await page.getByRole('button',{name:'Make it yours',exact:false}).click();await page.getByTestId('avatar-bull').waitFor(); await page.waitForTimeout(400);
await page.getByTestId('avatar-bull').click(); await page.getByTestId('avatar-bull').getByText('Equipped ✓').waitFor();
assert(await page.getByTestId('avatar-shop').innerText().then(t=>t.includes('5 tokens')),'shop updates wallet after purchase');
await page.screenshot({path:'/tmp/brokie-new-you.png',fullPage:true});
for(const width of [320,393,430]) { await page.setViewportSize({width,height:852}); await page.waitForTimeout(100); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width); }
assert.deepEqual(errors,[]); console.log('PASS fullscreen gestures, animations, fixed footer, squad daily stats, avatar purchase and responsive layout');
await browser.close();
})();
