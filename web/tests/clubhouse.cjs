// All accounts, messages and orders are local synthetic fixtures. No external requests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto((process.env.BASE_URL||'http://127.0.0.1:5179')+'/tests/terminal-preview.html');
 await page.getByTestId('simple-floor').waitFor();
 await page.evaluate(async()=>{
  const {game:g}=await import('/src/game.ts');window.g=g;
  const rpc=g.api.rpc.bind(g.api), now=g.now();window.messages=[];window.marketLoads=[];
  g.api.rpc=async(n,a)=>{
   if(n==='chart_bubbles'){window.marketLoads.push(a.p_market);return a.p_market==='nas'?[{id:'mate-nas',handle:'bum',is_you:false,state:'closed',side:'short',quantity:10,entry_price:20500,exit_price:20450,pnl:1000,opened_at:new Date(now-3600000).toISOString(),at:new Date(now-1800000).toISOString(),reason:'closed',size_pct:null,dd_floor:null,equity:null}]:[];}
   return rpc(n,a);
  };
  g.sendMessage=async(body,kind)=>{window.messages.push({body,kind});g.set({chat:[...g.state.chat,{id:Date.now(),handle:'sam',is_you:true,kind,body,at:new Date(now).toISOString()}]});return null;};
  g.set({me:{...g.state.me,rules:{...g.state.me.rules,daily_loss_enabled:false,daily_loss_pct:0,daily_loss_amount:null,daily_floor:0}}});
 });
 assert.equal(await page.locator('.tabs-inner>button').count(),3);
 assert.equal(await page.getByTestId('tab-chat').count(),0);
 assert.equal(await page.locator('.chart-host').count(),0,'main screen has no candles');
 assert(await page.getByTestId('close-position').isVisible(),'close lives directly on the position');
 assert.match(await page.getByTestId('price-position').innerText(),/Your long/);
 for(const [width,height] of [[320,568],[393,852],[430,932]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'trade has no horizontal overflow');
  assert.equal(await page.getByTestId('go-long').evaluate(e=>getComputedStyle(e.closest('.trade-dock')).position),'static','order pad is in normal page flow');
  await page.screenshot({path:`/tmp/brokie-clubhouse-position-${width}.png`});
  await page.getByTestId('big-chart').click();await page.waitForTimeout(300);
  assert(await page.getByTestId('close-trade').isVisible(),'fullscreen also has direct close');
  const chart=await page.locator('.chart-host').boundingBox(),dock=await page.locator('.chart-fullscreen .trade-dock').boundingBox();
  assert(chart.height>=80&&chart.y+chart.height<=dock.y+2,'fullscreen chart stays above controls');
  await page.screenshot({path:`/tmp/brokie-clubhouse-chart-${width}.png`});
  await page.keyboard.press('Escape');await page.getByTestId('simple-floor').waitFor();
 }
 // Rejected and pending close, repeated taps, then a confirmed losing close.
 await page.evaluate(()=>{window.closeCalls=[];window.g.closeStack=async(ids)=>{window.closeCalls.push(ids);return new Promise(resolve=>window.finishClose=resolve);};});
 await page.getByTestId('close-position').click();
 assert(await page.getByTestId('close-position').isDisabled());assert.match(await page.getByTestId('close-position').innerText(),/Closing/);
 assert(await page.getByTestId('go-long').isDisabled());assert(await page.getByTestId('go-short').isDisabled(),'orders wait for the close result');
 await page.getByTestId('close-position').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.closeCalls.length),1,'repeated taps cannot close twice');
 await page.evaluate(()=>window.finishClose({error:'Close refused',pnl:9000}));
 await page.getByTestId('close-position').waitFor();assert.equal(await page.getByTestId('trade-success').count(),0,'refused close has no result');
 await page.waitForFunction(()=>!document.querySelector('[data-testid="close-position"]').disabled);
 await page.getByTestId('price-position').getByRole('button',{name:/Stop and target/}).click();
 await page.getByTestId('protection-editor').waitFor();
 await page.getByTestId('protection-editor').getByRole('button',{name:'Done',exact:true}).click();
 await page.getByTestId('close-position').click();
 await page.evaluate(()=>{const g=window.g,p=g.state.me.positions[0],t={...p,id:'closed-loss',exit_price:p.entry_price-350,pnl:-35,reason:'closed',closed_at:new Date(g.now()).toISOString()};g.set({me:{...g.state.me,cash:g.state.me.cash-35,positions:[],trades:[t,...g.state.me.trades]}});window.finishClose({pnl:-35});});
 await page.getByTestId('trade-success').waitFor();assert.match(await page.getByTestId('trade-success').innerText(),/35/);assert(await page.getByTestId('trade-success').evaluate(e=>e.classList.contains('loss')));
 assert.equal(await page.getByTestId('close-position').count(),0);
 await page.waitForTimeout(100);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/brokie-clubhouse-trade-flat.png'});
 await page.getByTestId('tab-squad').click();await page.getByTestId('club-floor').waitFor();
 await page.locator('[data-trade-id="mate-nas"]').waitFor();
 assert.equal(new Set(await page.evaluate(()=>window.marketLoads)).size,7,'floor loads all trading markets');
 assert(await page.locator('[data-trade-id="closed-loss"]').count(),'own close survives navigation');
 await page.waitForTimeout(400);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/brokie-clubhouse-floor.png'});
 await page.getByTestId('floor-chat').click();await page.getByTestId('chat').waitFor();
 assert.equal(await page.evaluate(()=>window.messages.length),0,'opening floor does not send messages');
 await page.getByTestId('chat-input').fill('Clubhouse test message');await page.getByTestId('chat-send').click();
 assert.equal(await page.evaluate(()=>window.messages[0].body),'Clubhouse test message');
 await page.getByTestId('floor-board').click();await page.getByTestId('seg-squad').waitFor();
 await page.getByTestId('tab-you').click();await page.getByTestId('receipt').first().waitFor();
 assert.equal(await page.locator('.clubhouse-you').count(),1);assert(await page.getByRole('heading',{name:'Your run.',exact:true}).isVisible());
 assert(await page.locator('[data-trade-id="closed-loss"]').count(),'closed receipt persists');
 await page.waitForTimeout(400);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/brokie-clubhouse-you.png'});
 await page.getByRole('button',{name:'Account settings',exact:true}).click();assert.equal(await page.getByTestId('opposite-setting').count(),0);assert.equal(await page.getByText('Open a hedge',{exact:true}).count(),0);
 await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
 // Old saved hedge preferences cannot change order behavior.
 await page.evaluate(async()=>{const {Game}=await import('/src/game.ts');localStorage.setItem('brokie.opposite','hedge');const g=new Game();g.state.me={...window.g.state.me,positions:[{id:'short',market:'btc',side:'short',quantity:20,entry_price:81000,opened_at:new Date().toISOString()}]};g.state.market='btc';g.setOpposite('hedge');if(!g.tapReduces('long'))throw Error('Legacy hedge preference bypassed reductions');let reduced=0,opened=0;g.reduce=async(side,q)=>{if(side!=='short')throw Error('wrong side reduced');reduced+=q;return {closed:q,pnl:0};};g.open=async()=>{opened++;return null;};await new Promise(resolve=>{g.tap('long',()=>resolve());g.sendTapsNow(()=>resolve());});if(reduced!==10||opened)throw Error('Opposite tap created a hedge');});
 // A queued opposite order must recheck the position after an earlier order fills.
 await page.evaluate(async()=>{
  const {Game}=await import('/src/game.ts'),g=new Game();g.state.me={...window.g.state.me,positions:[]};g.state.market='btc';g.submitting=true;
  let reduced=0,opened=0;g.reduce=async(_side,q)=>{reduced+=q;return{closed:q,pnl:0};};g.open=async()=>{opened++;return null;};
  const done=new Promise(resolve=>{g.tap('short',()=>resolve(),true);g.sendTapsNow(()=>resolve());});
  g.state.me.positions=[{id:'just-filled',market:'btc',side:'long',quantity:10,entry_price:81000,opened_at:new Date().toISOString()}];g.submitting=false;await done;
  if(reduced!==10||opened)throw Error('Queued order missed the newly filled opposite position');
  g.submitting=true;const moved=new Promise(resolve=>{g.tap('long',err=>resolve(err),true);g.sendTapsNow(err=>resolve(err));});g.state.market='nas';g.submitting=false;
  if(!/Market changed/.test(await moved)||opened)throw Error('Queued order traded a changed market');
  const closing=new Game();let calls=0;closing.close=async()=>++calls===1?{pnl:-5}:{error:'offline'};
  const result=await closing.closeStack(['first','second','third']);if(calls!==2||result.pnl!==-5||!/Closed 1 of 3 fills/.test(result.error))throw Error('Partial close did not report remaining fills');
 });
 assert.deepEqual(errors,[]);console.log('PASS Clubhouse: three pages, 320/393/430px main/fullscreen close, pending/refused/negative fills, protection, all-market floor, chat, boards, paper receipts and retired hedge settings');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
