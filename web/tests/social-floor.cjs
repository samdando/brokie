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
await page.waitForTimeout(450);
assert.equal(await page.getByTestId('equity').count(),0,'equity details are collapsed');
assert.equal(await page.locator('.positions-section,.account-compact').count(),0,'no secondary panels on Trade');
assert.equal(await page.locator('.tm.history').count(),0,'closed history is opt-in');
assert.equal(await page.getByTestId('live-unrealised').textContent(),'+$4,500.00');
assert((await page.getByTestId('floor-presence').innerText()).includes('3 mates trading NAS'),'presence uses current trades');
assert.equal(await page.locator('.combo-badge,.tap-feedback,.confetti').count(),0,'no arcade decorations');
const check=async()=>{
 const [a,b,d,c]=await Promise.all([page.getByTestId('go-long').boundingBox(),page.getByTestId('go-short').boundingBox(),page.locator('.trade-dock').boundingBox(),page.locator('.chart-host').boundingBox()]);
 assert(Math.abs(a.width-b.width)<.1 && a.height===b.height,'balanced BUY/SELL');assert(a.height>=48);
 assert(Math.abs((a.x-d.x)-(d.x+d.width-b.x-b.width))<.1,'equal outer spacing');if(b.y+b.height>await page.evaluate(()=>innerHeight)){await page.screenshot({path:'/tmp/brokie-social-fit-debug.png'});console.log('FIT',await page.locator('.chart-card').evaluate(e=>({height:e.clientHeight,style:getComputedStyle(e).cssText,children:Array.from(e.children).map(c=>({cls:c.className,height:c.offsetHeight,marginTop:getComputedStyle(c).marginTop,marginBottom:getComputedStyle(c).marginBottom,position:getComputedStyle(c).position}))})),{a,b,d,c});}assert(b.y+b.height<=await page.evaluate(()=>innerHeight),'actions within reach');
 assert(c.height>=96 && c.y+c.height<=d.y+2,'chart fits above execution dock');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 const read=e=>{const s=getComputedStyle(e);return[s.borderRadius,s.fontSize,s.fontWeight,s.padding]};assert.deepEqual(await page.getByTestId('go-long').evaluate(read),await page.getByTestId('go-short').evaluate(read));
};
for(const [width,height] of [[320,568],[393,852],[430,932]]){
 await page.setViewportSize({width,height});await page.waitForTimeout(250);await check();assert.equal(await page.locator('.tabs .tab').count(),5,'all five app tabs retained');
 if(width===393)await page.screenshot({path:'/tmp/brokie-social-trade-393.png'});
 await page.getByTestId('big-chart').click();await page.waitForTimeout(400);await check();assert(await page.getByTestId('floor-presence').isVisible());
 if(width===393)await page.screenshot({path:'/tmp/brokie-social-fullscreen-393.png'});
 await page.getByTestId('big-chart').click();await page.waitForTimeout(200);
}
await page.setViewportSize({width:393,height:852});
await page.getByTestId('account-disclosure').click();await page.getByTestId('account-sheet').waitFor();assert.equal(await page.getByTestId('equity').textContent(),'$104,500.00');assert(await page.getByTestId('session-clock').last().isVisible());await page.waitForTimeout(350);await page.screenshot({path:'/tmp/brokie-social-account-393.png'});await page.getByTestId('account-sheet').getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('floor-react').click();await page.getByRole('button',{name:'React 🔥 to squad',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.reactions),[{body:'🔥',kind:'emoji',squad:'s'}]);assert.equal(await page.evaluate(()=>window.testGame.state.chatOpen),false,'reaction does not open chat');
await page.getByTestId('floor-activity-open').click();await page.getByTestId('floor-activity').waitFor();assert.equal(await page.locator('.floor-activity-item').count(),3);await page.getByRole('button',{name:'React 🫡 in activity'}).click();assert.equal(await page.evaluate(()=>window.reactions.length),2);await page.screenshot({path:'/tmp/brokie-social-activity-393.png'});await page.getByTestId('floor-activity').getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('size-10').click();await page.getByTestId('go-long').click();await page.waitForTimeout(650);assert.deepEqual(await page.evaluate(()=>window.orders),[{side:'long',q:10}]);assert.equal(await page.evaluate(()=>window.vibrations.length),0,'haptics default off');
await page.getByTestId('crypto-switch').click();await page.getByTestId('market-btc').waitFor();assert.equal(await page.evaluate(()=>window.testGame.state.market),'btc');assert.equal(await page.locator('[data-testid="markets-section"]').getAttribute('data-section'),'crypto');assert.equal(await page.getByTestId('market-nas').count(),0);assert(await page.getByTestId('go-long').isDisabled(),'closed weekday crypto session');
assert.equal(await page.getByText(/Predictions|Buy YES|Buy NO/).count(),0,'predictions removed');
await page.getByTestId('market-eth').click();assert.equal(await page.evaluate(()=>window.testGame.state.market),'eth');await page.waitForTimeout(350);await page.screenshot({path:'/tmp/brokie-social-crypto-393.png'});
await page.getByTestId('crypto-switch').click();await page.getByTestId('market-nas').waitFor();assert.equal(await page.evaluate(()=>window.testGame.state.market),'nas');assert.deepEqual(await page.evaluate(()=>window.predictionCalls),[],'no prediction API calls');
// The settings stay opt-in, persist, and control the actual haptic bridge.
await page.getByTestId('tab-you').click();await page.getByRole('button',{name:/Account settings/}).click();
assert.equal(await page.getByLabel('Play order sounds',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('Touch feedback',{exact:true}).isChecked(),false);
await page.getByLabel('Touch feedback',{exact:true}).check();assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.haptics')),'on');assert(await page.evaluate(()=>window.vibrations.length)>0);
await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByTestId('tab-trade').click();await page.getByTestId('go-long').waitFor();await page.waitForTimeout(350);await check();
// Confirmed closes get a small receipt; refusals never get a win moment.
await page.evaluate(()=>{window.testGame.closeStack=async()=>({error:'Order refused',pnl:4500});});
const swipe=async()=>{const box=await page.getByTestId('position').locator('.pos-card').boundingBox();await page.mouse.move(box.x+box.width*.2,box.y+15);await page.mouse.down();await page.mouse.move(box.x+box.width*.85,box.y+15,{steps:10});await page.mouse.up();await page.waitForTimeout(350);};
await page.getByTestId('trading-status').click();await page.getByTestId('positions-sheet').waitFor();await swipe();assert.equal(await page.getByTestId('trade-success').count(),0);
await page.evaluate(()=>{const g=window.testGame;g.closeStack=async()=>{g.set({me:{...g.state.me,cash:g.state.me.cash+4500,positions:[]}});return {pnl:4500};};});
await swipe();await page.getByRole('button',{name:'Close positions',exact:true}).click();await page.getByTestId('trade-success').waitFor();assert.match(await page.getByTestId('trade-success').innerText(),/4,500/);
await page.getByTestId('trade-success').waitFor({state:'hidden'});
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,status:'locked'}}});});assert(await page.getByTestId('go-long').isDisabled());assert(await page.getByText('Daily limit reached',{exact:true}).isVisible());await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,status:'active'}}});});
await page.evaluate(()=>{const g=window.testGame;g.set({squads:[],squadId:null,leaderboard:[],feed:[],bubbles:[],bubbleScope:null,me:{...g.state.me,positions:[]}});});await page.getByTestId('floor-invite').waitFor();assert.equal(await page.getByTestId('live-unrealised').textContent(),'$0.00');await page.screenshot({path:'/tmp/brokie-social-empty-393.png'});
await page.evaluate(async()=>{const {Game}=await import('/src/game.ts');const g=new Game();g.state.market='nas';g.refreshCandles=async()=>{};g.refreshBubbles=async()=>{};g.api.rpc=async()=>({...window.testGame.state.me,server_time:'2026-10-24T12:00:00Z'});await g.refreshState();if(g.state.market!=='btc')throw Error('weekend market rollover lost');g.api.rpc=async()=>({...window.testGame.state.me,server_time:'2026-10-27T13:15:00Z'});await g.refreshState();if(!['gold','nas','es','us30'].includes(g.state.market))throw Error('weekday market rollover lost');});
await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.flash').count(),0);assert.deepEqual(errors,[]);console.log('PASS social floor: responsive chart/dock, balanced actions, progressive account/risk, real squad activity, user-triggered reactions, 1/10/100 orders, silent defaults, Crypto section without predictions, empty state and navigation');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
