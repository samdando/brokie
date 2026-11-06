// Reproduce the supplied phone screens using a synthetic account only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto((process.env.BASE_URL||'http://127.0.0.1:5179')+'/tests/terminal-preview.html');
 await page.getByTestId('simple-floor').waitFor();
 await page.evaluate(async()=>{
  const {game:g}=await import('/src/game.ts');window.g=g;const now=Date.parse('2026-11-06T04:30:00Z');g.now=()=>now;
  const trade=(id,entry,exit,pnl,offset=0)=>({id,market:'nas',side:'short',quantity:100,entry_price:entry,exit_price:exit,pnl,opened_at:new Date(now-3600000+offset).toISOString(),closed_at:new Date(now-1800000).toISOString(),reason:pnl<0?'daily_limit':'stop_loss'});
  const trades=[trade('dll-a',28214,28251.5,-7500),trade('dll-b',28214,28251.5,-7500,2000),trade('win',28275,28230.75,8850)];
  const rpc=g.api.rpc.bind(g.api);g.api.rpc=async(n,a)=>n==='daily_leaderboard'?{day:'2026-11-06',rows:[{is_you:true,pnl:0,trades:0,wins:0,losses:0}]}:n==='review_trade'?{trade:trades.find(t=>t.id===a.p_trade),candles:[],bucket_seconds:60,note:''}:rpc(n,a);
  const start=Math.floor(now/60000)-119;let last=28300;const bars=Array.from({length:120},(_,i)=>{const close=28300-(28300-26889.25)*i/119+Math.sin(i*.3)*35;const c={index:start+i,open:last,high:Math.max(last,close)+20,low:Math.min(last,close)-20,close};last=close;return c;});
  g.set({candles:{...g.state.candles,nas:bars},clockOffset:now-Date.now(),market:'nas',bubbleScope:'nas:s',bubbles:[],me:{...g.state.me,cash:283541.5,positions:[],trades,quotes:[...g.state.me.quotes.filter(q=>q.market!=='nas'),{market:'nas',price:26889.25,quoted_at:new Date(now).toISOString()}],rules:{...g.state.me.rules,daily_loss_enabled:false,daily_loss_pct:0,daily_loss_amount:null,daily_floor:0,drawdown_floor:100000,max_loss_amount:4200,drawdown_cap:100000,status:'active'}}});
 });
 await page.getByText('No open NAS trades',{exact:true}).waitFor();
 assert.equal(await page.getByText('Your next move?',{exact:true}).count(),0,'large filler card removed');
 assert.equal(await page.locator('[data-testid="tape-trade"]').count(),2,'same event presented once');
 const group=page.locator('[data-testid="tape-trade"][data-fill-count="2"]');
 assert.match(await group.innerText(),/200/);assert.match(await group.innerText(),/15,000/);
 for(const [width,height] of [[320,568],[393,852],[430,932]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(300);await page.evaluate(()=>scrollTo(0,0));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow');
  const flat=await page.locator('.flat-price').boundingBox(),dock=await page.locator('.trade-dock').boundingBox(),tabs=await page.locator('.tabs').boundingBox();
  assert(flat.height<=32,'flat state is one slim line');assert(dock.height<125,'flat dock stays compact');assert(dock.y+dock.height<=tabs.y+1,'dock above tabs');
  await page.screenshot({path:`/tmp/brokie-cleanup-trade-${width}.png`});
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>{document.documentElement.style.setProperty('--safe-t','47px');document.documentElement.style.setProperty('--safe-b','34px');scrollTo(0,0);});
 await page.getByTestId('big-chart').click();await page.waitForTimeout(350);
 const chart=await page.locator('.chart-host').boundingBox(),bigDock=await page.locator('.chart-fullscreen .trade-dock').boundingBox();
 assert(chart.y+chart.height<=bigDock.y+2,'fullscreen flat chart fits above dock with phone safe areas');
 assert(bigDock.height<125,'fullscreen uses compact flat dock too');
 await page.screenshot({path:'/tmp/brokie-cleanup-fullscreen-393.png'});
 await page.keyboard.press('Escape');await page.evaluate(()=>{document.documentElement.style.removeProperty('--safe-t');document.documentElement.style.removeProperty('--safe-b');});
 await group.getByRole('button',{name:'Show 2 fills',exact:true}).click();
 assert.equal(await group.getByTestId('fill-breakdown').locator('[data-trade-id]').count(),2,'both receipts retained');
 await page.getByTestId('tab-you').click();
 await page.getByTestId('receipt').first().waitFor();
 assert.equal(await page.locator('.daily-recap').count(),0,'empty recap no longer competes with real receipts');
 assert.equal(await page.getByTestId('receipt').count(),2,'history uses the same compact grouping');
 const receipt=page.locator('[data-testid="receipt"][data-fill-count="2"]');
 await receipt.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/brokie-cleanup-receipts-430.png'});
 await receipt.getByRole('button',{name:'Show 2 fills',exact:true}).click();
 assert.equal(await receipt.getByRole('button',{name:'Review ↗',exact:true}).count(),2);
 await receipt.getByRole('button',{name:'Review ↗',exact:true}).first().click();
 await page.getByText('Trade details',{exact:true}).waitFor();
 assert.match(await page.locator('.sheet').innerText(),/7,500/,'review preserves individual result');
 assert.deepEqual(errors,[]);
 console.log('PASS screen cleanup: grouped DLL fills retain exact results, compact flat state/dock at 320/393/430px, shared receipt rows, empty recap hidden, each fill opens its review');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
