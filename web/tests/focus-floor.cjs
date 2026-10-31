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
await page.getByTestId('focus-floor').waitFor().catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
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
// Hints fade after five seconds and return on a fresh visit, even for experienced players.
await page.evaluate(()=>localStorage.setItem('brokie.coach.trades','100'));
await page.getByTestId('hold-coach').waitFor({state:'detached',timeout:6500});
await page.getByTestId('chat-btn').click();await page.waitForTimeout(400);
await page.getByTestId('tab-trade').click();await page.waitForTimeout(400);
assert.equal(await page.getByTestId('hold-coach').count(),1,'hints return when Trade becomes active');
await page.screenshot({path:'/tmp/brokie-focus-flat.png'});
const chart=await page.getByTestId('arcade-chart').boundingBox();
// Hold top half → BUY, slide down → SL with mirrored TP, release → both saved on the server.
const cx=chart.x+chart.width*.45, top=chart.y+chart.height*.3;
const scale=()=>page.getByTestId('arcade-chart').getAttribute('data-range');
const holdScale=await scale();
await page.mouse.move(cx,top);await page.mouse.down();await page.waitForTimeout(450);
await page.getByTestId('hold-label').waitFor();assert.equal(await page.evaluate(()=>window.orders.length),1);assert.equal(await page.evaluate(()=>window.orders[0].side),'long');
await page.mouse.move(cx,top+120,{steps:6});await page.waitForTimeout(80);
assert.match(await page.getByTestId('hold-label').innerText(),/TP .* SL /);
assert.equal(await scale(),holdScale,'held bracket preview must not change its own price scale');
await page.mouse.move(cx,chart.y+chart.height+90,{steps:8});await page.waitForTimeout(80);
assert.equal(await scale(),holdScale,'holding past the bottom keeps the original scale');
const bottomLabel=await page.getByTestId('hold-label').innerText();
await page.mouse.move(cx,chart.y+chart.height+140,{steps:3});await page.waitForTimeout(80);
assert.equal(await page.getByTestId('hold-label').innerText(),bottomLabel,'held levels stop at the lower plot boundary');
await page.mouse.move(cx,top+120,{steps:6});await page.waitForTimeout(80);
await page.screenshot({path:'/tmp/brokie-focus-hold.png'});
await page.mouse.up();await page.waitForTimeout(150);
const br=await page.evaluate(()=>window.brackets[0]);assert.equal(br.id,'p1');assert(br.sl<29700&&br.tp>29700,'SL below, TP above for a long');
assert(Math.abs((br.tp-29700)-(29700-br.sl))<1,'1:1 mirror');
assert.equal(await page.evaluate(()=>location.hash),'');
await page.getByTestId('cash-out').waitFor();
// An open trade's P&L opens position management directly; sizing shows dollar exposure.
await page.getByTestId('focus-pnl').click();await page.getByRole('heading',{name:'Your open positions',exact:true}).waitFor();
await page.getByRole('button',{name:'Close positions',exact:true}).click();
await page.getByTestId('focus-size-10').click();assert.match(await page.getByTestId('focus-size-context').innerText(),/10 micros.*\$20.00 \/ point/);
await page.getByTestId('focus-size-1').click();
const toastRect=await page.getByTestId('toast').boundingBox();
assert(toastRect.y+toastRect.height<chart.y,'trade confirmation stays above the chart');
const sizeBox=await page.locator('.focus-size').boundingBox(),cashBox=await page.getByTestId('cash-out').boundingBox();
assert(sizeBox.x+sizeBox.width<cashBox.x,'size selector is left of cash out');
await page.screenshot({path:'/tmp/brokie-focus-position.png'});
// Dragging the saved TP line to the top edge: the level moves, the chart scale doesn't jump under the finger.
{const box=await page.evaluate(()=>{const r=document.querySelector('.arcade-chart').getBoundingClientRect();return {x:r.left+r.width*0.3,top:r.top,h:r.height};});
 const pixels=async()=>page.evaluate(()=>document.querySelector('.arcade-chart').dataset.range);
 const n0=await page.evaluate(()=>window.brackets.length);let grabY=null;
 for(let y=box.top+12;y<box.top+box.h*0.8;y+=6){await page.mouse.move(box.x,y);await page.mouse.down();await page.mouse.move(box.x,y-3,{steps:2});await page.mouse.up();await page.waitForTimeout(120);if((await page.evaluate(()=>window.brackets.length))>n0){grabY=y;break;}}
 assert(grabY!==null,'TP line can be grabbed');
 const tp1=await page.evaluate(()=>window.brackets.at(-1).tp);
 await page.mouse.move(box.x,grabY-3);await page.mouse.down();await page.mouse.move(box.x,grabY-40,{steps:4});await page.waitForTimeout(60);
 const mid=await pixels();await page.mouse.move(box.x,box.top-80,{steps:6});await page.waitForTimeout(60);const edge=await pixels();
 await page.mouse.up();await page.waitForTimeout(150);
 const tp2=await page.evaluate(()=>window.brackets.at(-1).tp);assert(tp2>tp1,'TP moved up');
 assert.equal(edge,mid,'price scale is frozen while a line is dragged past the edge');
 assert.equal(await page.evaluate(()=>window.orders.length),1,'line drag never trades');globalThis.bracketsAfterDrag=await page.evaluate(()=>window.brackets.length);}

// Saved STOP: grab its axis tag with a real touch, drag past the bottom, and wait for the server.
// The canvas must not snap back on release while the response is pending; save exactly once in StrictMode.
const touch=await page.context().newCDPSession(page);
const levelY=async(kind)=>page.evaluate(kind=>{
 const el=document.querySelector('.arcade-chart'),r=el.getBoundingClientRect(),[lo,hi]=el.dataset.range.split(':').map(Number);
 const small=!!document.querySelector('.focus-floor.small'),pad=small?18:26,bottom=small?14:20;
 const price=window.testGame.state.brackets.p1[kind];
 return r.top+pad+(hi-price)/(hi-lo)*(r.height-22-pad-bottom);
},kind);
await page.evaluate(()=>{
 const g=window.testGame;window.savedSetBracket=g.setBracket;window.saveCalls=0;
 g.setBracket=async(id,b)=>{window.saveCalls++;await new Promise(r=>setTimeout(r,600));if(window.failSave)throw Error('Synthetic save failed');return window.savedSetBracket(id,b);};
});
const startStop=await levelY('sl'),axisX=chart.x+chart.width-20;
await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:axisX,y:startStop}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:axisX,y:chart.y+chart.height+20}]});await page.waitForTimeout(80);
const pendingRange=await scale(),pendingCanvas=await page.locator('.arcade-chart canvas').evaluate(e=>e.toDataURL());
await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
assert.equal(await scale(),pendingRange,'scale stays frozen while the save is pending');
assert.equal(await page.locator('.arcade-chart canvas').evaluate(e=>e.toDataURL()),pendingCanvas,'dragged line remains visible until server acknowledgement');
assert.equal(await page.evaluate(()=>window.saveCalls),1,'one touch release saves once');
await page.waitForTimeout(550);
assert.equal(await page.evaluate(()=>window.orders.length),1,'axis-tag drag never places a trade');
const confirmedStop=await page.evaluate(()=>window.testGame.state.brackets.p1.sl);
// Rejected changes restore the confirmed level; pointercancel discards without saving.
await page.evaluate(()=>window.failSave=true);
let stopY=await levelY('sl');
await page.mouse.click(axisX,stopY);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.saveCalls),1,'tapping a level without moving does not save');
await page.mouse.move(axisX,stopY);await page.mouse.down();await page.mouse.move(axisX,stopY-45,{steps:3});await page.mouse.up();await page.waitForTimeout(750);
assert.equal(await page.evaluate(()=>window.saveCalls),2);
assert.equal(await page.evaluate(()=>window.testGame.state.brackets.p1.sl),confirmedStop,'failed save keeps confirmed server level');
assert.match(await page.locator('[role="status"]').allTextContents().then(x=>x.join(' ')),/Synthetic save failed/);
await page.evaluate(()=>window.failSave=false);
stopY=await levelY('sl');
await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:axisX,y:stopY}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:axisX,y:stopY-35}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForTimeout(100);
assert.equal(await page.evaluate(()=>window.saveCalls),2,'canceled touch does not save');
globalThis.bracketsAfterDrag=await page.evaluate(()=>window.brackets.length);
await page.evaluate(()=>{window.testGame.setBracket=window.savedSetBracket;});

// A quick tap does not trade.
await page.mouse.click(cx,chart.y+chart.height*.7);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.orders.length),1);
// Holding the other half while long takes it off instead of opening a hedge.
await page.mouse.move(cx,chart.y+chart.height*.62);await page.mouse.down();await page.waitForTimeout(500);
assert.match(await page.getByTestId('hold-label').innerText(),/CLOSING/);await page.mouse.move(cx,chart.y+chart.height*.75,{steps:4});await page.mouse.up();await page.waitForTimeout(150);
assert.equal(await page.evaluate(()=>window.orders.length),1,'no hedge order');assert.deepEqual(await page.evaluate(()=>window.reduces),[{side:'long',q:1}]);assert.equal(await page.evaluate(()=>window.brackets.length),globalThis.bracketsAfterDrag,'closing never sets TP/SL');
// Hold cash-out to close.
const co=await page.getByTestId('cash-out').boundingBox();await page.mouse.move(co.x+20,co.y+15);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
await page.waitForFunction(()=>window.closes.length===1);
// A second finger must cancel the pending hold without losing the first pointer or placing an order.
await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:90,y:chart.y+chart.height*.4}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:90,y:chart.y+chart.height*.4},{id:2,x:240,y:chart.y+chart.height*.6}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:60,y:chart.y+chart.height*.3},{id:2,x:270,y:chart.y+chart.height*.7}]});
await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(400);
assert.equal(await page.evaluate(()=>window.orders.length),1,'pinch never places an order');
await page.mouse.dblclick(cx,chart.y+chart.height*.5);await page.waitForTimeout(100);
// Real touch swipes (CDP) change pages: on the chart, then from a button on the next page.
const cdp=await page.context().newCDPSession(page);
const swipe=async(x0,y,x1)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/8,y}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(450);};
const current=()=>page.evaluate(()=>document.querySelector('.page-map [aria-current="page"]')?.getAttribute('aria-label'));
// Dragging right scrolls back through history (never trades, never flips the page); Live returns; at the live edge a left drag is still a page swipe.
{const y=chart.y+chart.height*.5;await swipe(60,y,300);assert.equal(await current(),'Go to trade','history drag keeps the page');assert.equal(await page.evaluate(()=>window.orders.length),1,'history drag never trades');
 await page.getByTestId('chart-live').waitFor();await page.screenshot({path:'/tmp/brokie-focus-history.png'});
 const before=+(await page.getByTestId('arcade-chart').getAttribute('data-offset'));await swipe(300,y,260);assert.equal(await current(),'Go to trade','left drag while scrolled back scrolls toward live');assert(+(await page.getByTestId('arcade-chart').getAttribute('data-offset'))<before,'moved toward live');
 await page.getByTestId('chart-live').click();await page.waitForTimeout(150);assert.equal(await page.getByTestId('chart-live').count(),0,'Live jumps back');}
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
// Interrupting an armed hold keeps the already-entered order but discards unconfirmed bracket previews.
for(const interrupt of ['cancel','pinch']) {
 await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[]},brackets:{}})});
 await page.waitForTimeout(100);
 const r=await page.getByTestId('arcade-chart').boundingBox(),x=r.x+100,y=r.y+r.height*.25;
 const before=await page.evaluate(()=>window.brackets.length);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await page.waitForTimeout(450);
 await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+90}]});await page.waitForTimeout(60);
 assert.match(await page.getByTestId('hold-label').innerText(),/TP .* SL /);
 if(interrupt==='pinch')await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y:y+90},{id:2,x:x+100,y:y+110}]});
 await touch.send('Input.dispatchTouchEvent',{type:interrupt==='cancel'?'touchCancel':'touchEnd',touchPoints:[]});await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.brackets.length),before,interrupt+' discards unconfirmed levels');
}
assert.deepEqual(errors,[]);
console.log('PASS focus floor: 5s hints and re-entry, size/cash swap, lower-edge hold clamp, delayed/rejected saves, axis-tag touch drag, no-op taps, touch cancellation and pinch,  history drag + Live, full-screen fit at 320/393/430, hold top = BUY, slide = 1:1 TP/SL saved, taps never trade, hold to cash out, touch page swipes on chart/content/buttons, vertical scroll ignored, classic layout toggle');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
