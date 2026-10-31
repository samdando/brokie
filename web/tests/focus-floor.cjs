// Focus floor: Brokie's own chart, hold-to-trade with TP/SL slide, cash out, and real touch page swipes.
// Run against the local Vite dev server with synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});
const errors=[];page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE ERROR',e.message)});
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
await page.evaluate(()=>localStorage.removeItem('brokie.layout'));
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
await page.getByTestId('focus-floor').waitFor();
await page.evaluate(()=>{
 const g=window.testGame; g.isOpen=()=>true; g.set({market:'nas'});const now=Date.now(),start=Math.floor(now/900000)-80,wave=i=>Math.sin(i*.21)*28+Math.sin(i*.07)*45+Math.sin(i*1.7)*6,price=i=>29700+wave(i)-wave(80);g.set({candleSeconds:900,candles:{...g.state.candles,nas:Array.from({length:80},(_,i)=>({index:start+i,open:price(i),high:Math.max(price(i),price(i+1))+4+Math.abs(Math.sin(i))*6,low:Math.min(price(i),price(i+1))-4-Math.abs(Math.cos(i))*6,close:price(i+1)}))}}); window.orders=[];window.brackets=[];window.closes=[];
 g.open=async(side,q)=>{window.orders.push({side,q});const p={id:'p1',market:'nas',side,quantity:q,entry_price:29700,opened_at:new Date().toISOString()};g.set({me:{...g.state.me,positions:[p]}});return null;};
 g.setBracket=async(id,b)=>{window.brackets.push({id,...b});g.set({brackets:{...g.state.brackets,[id]:{...(g.state.brackets[id]??{}),...b}}});};
 window.reduces=[];g.reduce=async(side,q)=>{window.reduces.push({side,q});return {closed:q,pnl:12};};g.closeStack=async(ids)=>{window.closes.push(ids);g.set({me:{...g.state.me,positions:[]}});return {pnl:42};};
});
const fit=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
for(const [w,h] of [[320,568],[393,852],[430,932]]){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);await fit();
 const box=await page.getByTestId('focus-floor').boundingBox();const tabs=await page.locator('.tabs').boundingBox();
 assert(box.height>=300,'chart fills the page');assert(box.y+box.height<=tabs.y+2,'chart stays above the tab bar');}
await page.setViewportSize({width:393,height:852});await page.waitForTimeout(150);
await page.screenshot({path:'/tmp/brokie-focus-flat.png'});
const chart=await page.getByTestId('arcade-chart').boundingBox();
// Hold top half → BUY, slide down → SL with mirrored TP, release → both saved on the server.
const cx=chart.x+chart.width*.45, top=chart.y+chart.height*.3;
await page.mouse.move(cx,top);await page.mouse.down();await page.waitForTimeout(450);
await page.getByTestId('hold-label').waitFor();assert.equal(await page.evaluate(()=>window.orders.length),1);assert.equal(await page.evaluate(()=>window.orders[0].side),'long');
await page.mouse.move(cx,top+120,{steps:6});await page.waitForTimeout(80);
assert.match(await page.getByTestId('hold-label').innerText(),/TP .* SL /);
await page.screenshot({path:'/tmp/brokie-focus-hold.png'});
await page.mouse.up();await page.waitForTimeout(150);
const br=await page.evaluate(()=>window.brackets[0]);assert.equal(br.id,'p1');assert(br.sl<29700&&br.tp>29700,'SL below, TP above for a long');
assert(Math.abs((br.tp-29700)-(29700-br.sl))<1,'1:1 mirror');
assert.equal(await page.evaluate(()=>location.hash),'');
await page.getByTestId('cash-out').waitFor();await page.screenshot({path:'/tmp/brokie-focus-position.png'});
// A quick tap does not trade.
await page.mouse.click(cx,chart.y+chart.height*.7);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.orders.length),1);
// Holding the other half while long takes it off instead of opening a hedge.
await page.mouse.move(cx,chart.y+chart.height*.62);await page.mouse.down();await page.waitForTimeout(500);
assert.match(await page.getByTestId('hold-label').innerText(),/CLOSING/);await page.mouse.move(cx,chart.y+chart.height*.75,{steps:4});await page.mouse.up();await page.waitForTimeout(150);
assert.equal(await page.evaluate(()=>window.orders.length),1,'no hedge order');assert.deepEqual(await page.evaluate(()=>window.reduces),[{side:'long',q:1}]);assert.equal(await page.evaluate(()=>window.brackets.length),1,'closing never sets TP/SL');
// Hold cash-out to close.
const co=await page.getByTestId('cash-out').boundingBox();await page.mouse.move(co.x+20,co.y+15);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
await page.waitForFunction(()=>window.closes.length===1);
// Real touch swipes (CDP) change pages: on the chart, then from a button on the next page.
const cdp=await page.context().newCDPSession(page);
const swipe=async(x0,y,x1)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/8,y}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(450);};
const current=()=>page.evaluate(()=>document.querySelector('.page-map [aria-current="page"]')?.getAttribute('aria-label'));
{const y=chart.y+chart.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y}]});for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:330-i*30,y}]});await page.waitForTimeout(16);}
 const t=await page.evaluate(()=>[...document.querySelectorAll('.page-screen')].map(e=>[e.dataset.pageRole,Math.round(e.getBoundingClientRect().left)]));
 assert.deepEqual(t.map(x=>x[0]).sort(),['current','peek']);const cur=t.find(x=>x[0]==='current')[1],pk=t.find(x=>x[0]==='peek')[1];assert(cur<-150&&cur>-200,'page follows the finger 1:1 ('+cur+')');assert(Math.abs(pk-cur-(await page.evaluate(()=>document.querySelector('.swipe-deck').clientWidth)))<2,'next page sits flush beside it');
 await page.screenshot({path:'/tmp/brokie-swipe-mid.png'});
 for(let i=7;i<=9;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:330-i*30,y}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(450);}
assert.equal(await current(),'Go to chat');assert.equal(await page.evaluate(()=>window.orders.length),1,'swipe never trades');
await page.getByTestId('chat-page').waitFor();
await swipe(330,500,60);assert.equal(await current(),'Go to squad');
const row=await page.getByTestId('leader-row').first().boundingBox();await swipe(row.x+row.width-20,row.y+row.height/2,row.x+20);assert.equal(await current(),'Go to learn','swipe starting on a button');
await swipe(60,400,330);assert.equal(await current(),'Go to squad','swipe back');
// Vertical scrolling is not a page swipe.
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:600}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:205,y:600-i*30}]});}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);
assert.equal(await current(),'Go to squad');
// Classic layout stays one tap away.
await page.getByTestId('tab-trade').click();await page.getByTestId('focus-more').click();await page.getByTestId('classic-layout').click();await page.getByTestId('go-long').waitFor();
await page.getByTestId('focus-layout').click();await page.getByTestId('focus-floor').waitFor();
assert.deepEqual(errors,[]);
console.log('PASS focus floor: full-screen fit at 320/393/430, hold top = BUY, slide = 1:1 TP/SL saved, taps never trade, hold to cash out, touch page swipes on chart/content/buttons, vertical scroll ignored, classic layout toggle');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
