// Hold-to-spam check (about a minute): holding BUY/SELL sends full orders of 10, paced to the server's
// 5 orders per 10 s, sends the rest on release, stops on a refusal; quick taps still batch. Synthetic state only.
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
await page.evaluate(()=>{const g=window.testGame; window.orders=[]; window.failAt=null;
  g.open=async(side,q)=>{const t=performance.now(); g.submitting=true; await new Promise(r=>setTimeout(r,150)); g.submitting=false;
    window.orders.push({side,q,t}); return window.failAt!==null&&window.orders.length>=window.failAt?'Slow down — max 5 new trades per 10 seconds.':null;};});
const buy=page.getByTestId('go-long'), sell=page.getByTestId('go-short');
const box=await buy.boundingBox(), sbox=await sell.boundingBox();
const at=(b)=>[b.x+b.width/2,b.y+b.height/2];
const orders=()=>page.evaluate(()=>window.orders.map(o=>o.side+o.q));
const reset=()=>page.evaluate(()=>{window.orders=[];window.failAt=null;});
const wait=(ms)=>page.waitForTimeout(ms);
// 1. one quick tap = one 1-micro order
await page.mouse.move(...at(box)); await page.mouse.down(); await wait(60); await page.mouse.up(); await wait(700);
assert.deepEqual(await orders(),['long1'],'single tap'); await reset();
// 2. three quick taps still batch into one order of 3
for(let i=0;i<3;i++){await page.mouse.down(); await wait(50); await page.mouse.up(); await wait(80);} await wait(700);
assert.deepEqual(await orders(),['long3'],'quick taps batch'); await reset(); await wait(1200);
// 3. hold for 4 s: full orders of 10 go out while holding; release sends the rest
await page.mouse.down(); await wait(4000);
const during=await orders(); await page.mouse.up(); await wait(800); const after=await orders();
console.log('held 4s ->', during.join(' '), '| after release ->', after.slice(during.length).join(' '));
assert(during.length>=2 && during.every(o=>o==='long10'),'full orders of 10 while holding');
assert(after.length<=6,'paced: at most 5 full orders per 10 s plus the release');
assert(after.length>during.length || after.length===5,'release sends the remainder');
const sum=after.reduce((s,o)=>s+Number(o.slice(4)),0); console.log('total micros', sum);
// 4. pacing: a long hold never sends more than 5 full orders in 10 s
await reset(); await wait(11000);
await page.mouse.down(); await wait(9000); const long=await orders(); await page.mouse.up(); await wait(600);
console.log('held 9s ->', long.length, 'orders'); assert(long.length<=5,'max 5 orders per 10 s while holding');
// 5. a refusal stops the hold and nothing more is sent
await reset(); await wait(11000); await page.evaluate(()=>{window.failAt=2;});
await page.mouse.down(); await wait(4500); await page.mouse.up(); await wait(800);
const refused=await orders(); console.log('refusal ->', refused.join(' '));
assert.equal(refused.length,2,'hold stops after the server refuses');
assert.equal(await page.evaluate(()=>window.testGame.state.pending),null,'nothing left queued');
// 6. sell side works too
await reset(); await wait(11000); await page.evaluate(()=>{const g=window.testGame,me=g.state.me; g.set({me:{...me,quotes:me.quotes.map(q=>({...q,quoted_at:new Date().toISOString()}))}});}); await wait(200); await page.mouse.move(...at(sbox)); await page.mouse.down(); await wait(1700); await page.mouse.up(); await wait(700);
const s6=await orders(); console.log('sell hold ->', s6.join(' ')); assert(s6[0]==='short10','sell hold');
assert.deepEqual(errors,[]); console.log('PASS hold-to-spam'); await browser.close();})();
