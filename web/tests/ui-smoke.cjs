// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE ERROR',e.message)});
await page.goto('http://127.0.0.1:5173');
await page.evaluate(async()=>{
 const {game}=await import('/src/game.ts'); window.testGame=game;
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
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
const buy=await page.getByTestId('go-long').boundingBox(),nav=await page.locator('.tabs').boundingBox();assert(buy.y+buy.height<=nav.y,'buy overlaps nav');
await page.locator('.compact-rules summary').click();await page.getByTestId('meter-dd').waitFor({state:"visible"});await page.locator('.compact-rules summary').click();
await page.getByRole('button',{name:'Chart info'}).click();await page.locator('.chart-help').waitFor({state:"visible"});
await page.getByTestId('tab-squad').click();await shot('squad');
assert(await page.locator('[data-testid="leader-row"]').count()===5);
assert(await page.getByTestId('invite-code').count()===0);
await page.getByRole('button',{name:'Invite / manage'}).click();await page.getByTestId('invite-code').waitFor({state:"visible"});await page.getByRole('button',{name:'Done',exact:true}).click();
await page.locator('.chat-preview').evaluate(el=>el.scrollIntoView({block:'center'})); await page.locator('.chat-preview').click();await page.getByTestId('chat-input').waitFor({state:"visible"});await shot('chat');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.locator('.activity-group summary').click();assert(await page.locator('.activity-group .panel').count()===5);
await page.getByTestId('tab-learn').click();await page.getByText('Essentials complete.',{exact:true}).waitFor({state:"visible"});await shot('learn');
await page.getByRole('button',{name:'Put it into practice'}).click();await page.getByTestId('equity').waitFor({state:"visible"});
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,status:'locked'},cash:94995}})});
assert(await page.getByTestId('go-long').isDisabled());await shot('locked');
await page.getByRole('button',{name:'Review your trades'}).click();await shot('you');
await page.getByTestId('receipt').click();await page.getByText('Trade details',{exact:true}).waitFor({state:"visible"});await page.getByTestId('share-card').waitFor({state:"visible"});await shot('receipt');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('tab',{name:'Lifetime',exact:true}).click();await page.getByTestId('lifetime').waitFor({state:"visible"});await shot('lifetime');
for(const width of [320,430]) {await page.setViewportSize({width,height:852}); for(const tab of ['trade','squad','learn','you']){await page.getByTestId('tab-'+tab).click();await shot(tab+'-'+width);}}
assert.deepEqual(errors,[]); console.log('PASS: 3 mobile widths, navigation, risk disclosure, chart info, squad management/chat, feed grouping, completion, lockout, receipts, lifetime; no runtime errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
