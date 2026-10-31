// Rush mode: Daily Rush from Learn, replay reveal, hold top/bottom rides with exact $ maths, result card,
// daily lock + practice, challenge links without an account, no real trading, responsive fit.
// Runs against the local Vite dev server with synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const BASE=process.env.BASE_URL || 'http://127.0.0.1:5173';
// Deterministic bars from the RPC args: 40 quiet context bars, then 30 rising, then 30 falling (NAS points).
const gen=(args)=>{const n=args.p_limit||100,end=args.p_end?Math.floor(Date.parse(args.p_end)/60000):Math.floor(Date.now()/60000)+1,out=[];
 for(let i=0;i<n;i++){const j=i-(n-60);let o,c;
  if(j<0){o=20000+Math.sin(i)*1.5;c=o+(i%2?.75:-.75);} else if(j<30){o=20000+j*2;c=o+2;} else {o=20060-(j-30)*2;c=o-2;}
  out.push({index:end-n+i,open:o,high:Math.max(o,c)+1,low:Math.min(o,c)-1,close:c});}
 return out;};
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
await page.goto(BASE+'/?rushspeed=8');
await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('brokie.rush'))localStorage.removeItem(k);localStorage.setItem('brokie.layout','classic');});
await page.evaluate(async(src)=>{
 const gen=new Function('return '+src)();
 const {game}=await import('/src/game.ts');window.testGame=game;window.calls=[];window.trading=[];
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles','refreshPool'])game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 for(const name of ['open','reduce','close','closeStack','setBracket','clearBracket','buyBack'])game[name]=async(...a)=>{window.trading.push({name,a});return null;};
 game.api.rpc=async(name,args)=>{window.calls.push({name,args});
  if(name==='rush_candles'){if(window.noRush){const e=new Error('Could not find the function public.rush_candles');e.code='PGRST202';throw e;}return gen(args);}
  if(name==='candles')return gen(args);
  if(['open_position','reduce_position','close_position','set_position_bracket'].includes(name))throw new Error('real trading call: '+name);
  return name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:{...game.state.lifetime,handle:args?.p_handle||'sam'};};
 const now=new Date().toISOString(),start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades:[],quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:[{handle:'sam',is_you:true,equity:100000,return_pct:0,trades:0,worst_trade:0,open_positions:0}],feed:[],chat:[],lifetime:{total_trades:0,win_rate:0,max_drawdown:0,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
 window.shared=[];Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.shared.push(d);}});
},gen.toString());
const fit=async(label)=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.rush *')].every(e=>{const r=e.getBoundingClientRect();return r.width===0||(r.left>=-1&&r.right<=innerWidth+1);})),'no horizontal overflow '+(label||''));
const current=()=>page.evaluate(()=>document.querySelector('.page-map [aria-current="page"]')?.getAttribute('aria-label'));
const rush=()=>page.evaluate(()=>window.__rush);
const phase=()=>page.getByTestId('rush-chart').getAttribute('data-phase');
const waitPhase=p=>page.waitForFunction(p=>document.querySelector('[data-testid="rush-chart"]')?.dataset.phase===p,p,{timeout:30000});
const money=n=>(n>=0?'+':'−')+'$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:Math.abs(n)>=100?0:2,minimumFractionDigits:Math.abs(n)>=100?0:2});
const core=(fn,...a)=>page.evaluate(async([fn,a])=>{const c=await import('/src/rushCore.ts');return new Function('c','a','return ('+fn+')(c,...a)')(c,a);},[fn.toString(),a]);

// ---- Learn card opens today's Daily Rush; the page underneath doesn't move.
await page.getByTestId('tab-learn').click();await page.getByTestId('rush-card').waitFor();
for(const [w,h] of [[320,568],[393,852],[430,932]]){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(120);await fit('learn '+w);}
await page.setViewportSize({width:393,height:852});
await page.getByTestId('rush-card').screenshot({path:'/tmp/brokie-rush-card.png'});
assert.equal(await page.getByTestId('rush-streak').innerText(),'🔥 0');
const href=await page.evaluate(()=>location.href);
await page.getByTestId('rush-daily-play').click();
await page.getByTestId('rush-overlay').waitFor();
assert.equal(await page.getByTestId('rush-mode').innerText(),'DAILY RUSH');
assert.equal(await current(),'Go to learn','overlay keeps the app page');
const daily=await core(c=>c.dailySeed(c.brisbaneDay()));
const pv=await page.evaluate(async m=>(await import('/src/types.ts')).MARKETS[m].pointValue,daily.market);
const first=await page.evaluate(()=>window.calls.find(c=>c.name==='rush_candles').args);
assert.deepEqual(first,{p_market:daily.market,p_bucket_seconds:60,p_end:new Date(daily.end*60000).toISOString(),p_limit:100},'daily seed → rush_candles(market, 60, end, 100)');
// Overlay sits above the tab bar and toasts.
assert(await page.evaluate(()=>{const t=document.querySelector('.tabs').getBoundingClientRect();return !!document.elementFromPoint(t.left+t.width/2,t.top+t.height/2)?.closest('.rush');}),'overlay covers the tabs');
await page.getByTestId('rush-countdown').waitFor();
await waitPhase('live');
// ---- Candles reveal over time.
const r1=+await page.getByTestId('rush-chart').getAttribute('data-revealed');await page.waitForTimeout(600);
const r2=+await page.getByTestId('rush-chart').getAttribute('data-revealed');
assert(r2>r1,`bars reveal over time (${r1} → ${r2})`);
const p1=await page.getByTestId('rush-chart').getAttribute('data-price');await page.waitForTimeout(120);
assert.notEqual(await page.getByTestId('rush-chart').getAttribute('data-price'),p1,'price moves within a bar');
// ---- Hold top = long during the rise; release cashes out.
const box=await page.getByTestId('rush-chart').boundingBox();
await page.mouse.move(box.x+box.width*.4,box.y+box.height*.25);await page.mouse.down();await page.waitForTimeout(500);
assert.match(await page.getByTestId('rush-ride-pnl').innerText(),/^[+−]\$/);
assert.equal((await rush()).ride.side,'long');
assert(await page.evaluate(()=>document.querySelector('.rush').classList.contains('riding')),'screen tints while riding');
await page.waitForTimeout(500);
await page.screenshot({path:'/tmp/brokie-rush-ride-393.png'});
await fit('riding');
await page.mouse.up();await page.waitForTimeout(80);
let st=await rush();assert.equal(st.rides.length,1);assert.equal(st.ride,null,'release cashes out');
const long=st.rides[0];assert.equal(long.side,'long');assert(long.exit>long.entry,'rode the rise');
assert.equal(long.pnl,Math.round((long.exit-long.entry)*pv*10*100)/100,'P&L = points × point value × 10 micros');
assert.equal(await page.getByTestId('rush-total').innerText(),money(long.pnl));
// ---- Hold bottom = short during the fall.
await page.waitForFunction(()=>+document.querySelector('[data-testid="rush-chart"]').dataset.revealed>=33,null,{timeout:20000});
await page.mouse.move(box.x+box.width*.4,box.y+box.height*.8);await page.mouse.down();await page.waitForTimeout(1000);
assert.equal((await rush()).ride.side,'short');
await page.mouse.up();await page.waitForTimeout(80);
st=await rush();const short=st.rides[1];assert.equal(short.side,'short');assert(short.exit<short.entry,'rode the fall');
assert.equal(short.pnl,Math.round((short.entry-short.exit)*pv*10*100)/100,'short P&L = −points × point value × 10');
const total=Math.round((long.pnl+short.pnl)*100)/100;
assert.equal(await page.getByTestId('rush-total').innerText(),money(total));
// A horizontal swipe on the overlay never flips the app page.
const cdp=await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:40}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:330-i*35,y:42}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(400);
assert.equal(await current(),'Go to learn','swipe on Rush keeps the page');
// ---- Result card.
await page.getByTestId('rush-result').waitFor({timeout:30000});
assert.equal(await page.getByTestId('rush-result-total').innerText(),money(total));
assert.equal(await page.getByTestId('rush-squares').locator('i').count(),2);
assert.equal(await page.getByTestId('rush-squares').locator('i.w').count(),2);
assert.match(await page.getByTestId('rush-stat-reads').innerText(),/2\/2/);
assert.match(await page.getByTestId('rush-stat-timing').innerText(),/\d+%/);
assert.match(await page.getByTestId('rush-stat-best').innerText(),new RegExp(money(Math.max(long.pnl,short.pnl)).replace(/[$+.]/g,'\\$&')));
assert.match(await page.getByTestId('rush-type').innerText(),/Sniper/);
await page.getByTestId('rush-new-best').waitFor();
assert.match(await page.getByTestId('rush-result-streak').innerText(),/1 day streak/);
await page.waitForTimeout(450);
await page.screenshot({path:'/tmp/brokie-rush-result-393.png'});
for(const [w,h] of [[320,568],[393,852],[430,932]]){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);await fit('result '+w);}
await page.setViewportSize({width:320,height:568});await page.waitForTimeout(150);await page.screenshot({path:'/tmp/brokie-rush-result-320.png'});
await page.setViewportSize({width:393,height:852});
// Challenge share = this round's seed.
await page.getByTestId('rush-challenge').click();await page.waitForFunction(()=>window.shared.length===1);
const share=await page.evaluate(()=>window.shared[0]);
const seed=new URL(share.url).searchParams.get('rush');assert.equal(seed,(await rush()).seed,'challenge link carries the seed');
assert.match(share.text,/^Brokie Daily Rush · \d{1,2} [A-Z][a-z]{2} · \+\$[\d,.]+ · 🟩🟩 · 🔥1$/);
const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('brokie.rush.daily')));
assert.equal(stored.runs.length,1);assert.equal(stored.runs[0].marks,'WW');assert.equal(stored.streak,1);
await page.getByTestId('rush-done').click();await page.getByTestId('rush-overlay').waitFor({state:'detached'});
assert.equal(await current(),'Go to learn');assert.equal(await page.evaluate(()=>location.href),href,'URL untouched');
// ---- Daily is locked after one scored run; practice works.
await page.getByTestId('rush-card-done').waitFor();
assert(await page.getByTestId('rush-daily-play').isDisabled());assert.equal(await page.getByTestId('rush-streak').innerText(),'🔥 1');
await page.getByTestId('rush-card').screenshot({path:'/tmp/brokie-rush-card-done.png'});
await page.evaluate(async()=>(await import('/src/Rush.tsx')).openRush({mode:'daily'}));
await page.getByTestId('rush-overlay').waitFor();assert.equal(await page.getByTestId('rush-mode').innerText(),'PRACTICE');
assert.match(await page.getByTestId('rush-note').innerText(),/Daily Rush is in/);
await page.getByTestId('rush-close').click();await page.getByTestId('rush-overlay').waitFor({state:'detached'});
await page.evaluate(()=>{window.calls=[];});
await page.getByTestId('rush-practice').click();await page.getByTestId('rush-overlay').waitFor();
assert.equal(await page.getByTestId('rush-mode').innerText(),'PRACTICE');
await waitPhase('live');
const prac=await page.evaluate(()=>window.calls.filter(c=>c.name==='rush_candles').at(-1).args);
assert.notEqual(prac.p_end,first.p_end,'practice is a different window');
assert(Date.parse(prac.p_end)<Date.now()&&Date.parse(prac.p_end)>Date.now()-41*86400e3,'practice ends within the last ~40 days');
await page.mouse.move(box.x+box.width*.5,box.y+box.height*.3);await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up();
await page.evaluate(()=>{window.__rushSpeed=60;});
await page.getByTestId('rush-result').waitFor({timeout:30000});
await page.getByTestId('rush-new-best').waitFor();
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('brokie.rush.daily')).runs.length),1,'practice never writes the daily');
// Again → a fresh practice round; no rides → calm card, no new best.
await page.getByTestId('rush-again').click();await waitPhase('live');await page.getByTestId('rush-result').waitFor({timeout:30000});
assert.equal(await page.getByTestId('rush-new-best').count(),0);assert.match(await page.getByTestId('rush-type').innerText(),/Spectator/);
await page.getByTestId('rush-done').click();
// ---- Fallback to candles() before rush_candles is deployed.
await page.evaluate(()=>{window.noRush=true;window.calls=[];window.__rushSpeed=8;});
await page.getByTestId('rush-practice').click();await waitPhase('ready');
const fb=await page.evaluate(()=>window.calls.map(c=>c.name));assert.equal(fb[0],'rush_candles');assert(fb.includes('candles'),'falls back to candles()');assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='candles').args.p_limit),100);
assert.match(await page.getByTestId('rush-note').innerText(),/latest candles/);
await page.getByTestId('rush-close').click();await page.evaluate(()=>{window.noRush=false;});
// ---- Leaving a Daily mid-round scores it as it stands (no peeking and retrying).
await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('brokie.rush.daily'));s.runs=[];s.last-=1;localStorage.setItem('brokie.rush.daily',JSON.stringify(s));});
await page.evaluate(async()=>(await import('/src/Rush.tsx')).openRush({mode:'daily'}));await waitPhase('live');
await page.getByTestId('rush-close').click();await page.getByTestId('rush-overlay').waitFor({state:'detached'});
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('brokie.rush.daily')).streak),2,'consecutive day extends the streak');
// ---- Streak + freeze rules and seed determinism (pure).
const rules=await core(c=>{
 const res=c.score([]);const out={};localStorage.removeItem(c.DAILY_KEY);
 const D=20759; // a Sunday Brisbane day number; weeks run Monday→Sunday
 c.recordDaily(D,'x',res);c.recordDaily(D+1,'x',res);out.two=c.readDaily().streak;
 c.recordDaily(D+3,'x',res);out.freeze=c.readDaily().streak;           // missed D+2 → freeze covers it
 c.recordDaily(D+5,'x',res);out.secondMiss=c.readDaily().streak;      // missed D+4, same week → reset
 out.alive=c.streakNow(D+6);out.broken=c.streakNow(D+8);
 c.recordDaily(D+5,'x',res);out.once=c.readDaily().runs.filter(r=>r.day===D+5).length;
 out.same=c.encodeSeed(c.dailySeed(D))===c.encodeSeed(c.dailySeed(D));out.diff=c.encodeSeed(c.dailySeed(D))!==c.encodeSeed(c.dailySeed(D+1));
 const s=c.dailySeed(D);out.round=c.encodeSeed(c.decodeSeed(c.encodeSeed(s)))===c.encodeSeed(s);out.bad=c.decodeSeed('nope')===null&&c.decodeSeed('nas-60-zzzzzzzzz-d')===null;
 out.futuresWeekday=Array.from({length:60},(_,i)=>c.dailySeed(D+i)).filter(x=>c.FUTURES.has(x.market)).every(x=>{const d=new Date(x.end*60000);return d.getUTCDay()>=1&&d.getUTCDay()<=5&&d.getUTCHours()>=15&&d.getUTCHours()<20;});
 out.markets=new Set(Array.from({length:7},(_,i)=>c.dailySeed(D+i).market)).size;
 localStorage.removeItem(c.DAILY_KEY);return out;});
assert.deepEqual(rules,{two:2,freeze:3,secondMiss:1,alive:1,broken:0,once:1,same:true,diff:true,round:true,bad:true,futuresWeekday:true,markets:7});
assert.deepEqual(await page.evaluate(()=>window.trading),[],'no real trading function is ever called');
assert.equal(await page.evaluate(()=>window.calls.some(c=>/position|bracket/.test(c.name))),false);

// ---- Challenge link: same RPC args, no account, no app state needed.
const guest=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});
const g=await guest.newPage();g.on('pageerror',e=>{errors.push(e.message);console.error('GUEST PAGE ERROR',e.message)});
const guestCalls=[];
await g.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.pathname.includes('/rest/v1/rpc/')){const name=u.pathname.split('/').pop(),args=JSON.parse(route.request().postData()||'{}');guestCalls.push({name,args,auth:route.request().headers().authorization||null});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(name==='rush_candles'?gen(args):[])});}
 if(u.pathname.includes('/auth/v1/')){guestCalls.push({name:'AUTH '+u.pathname});return route.fulfill({status:500,body:'{}'});}
 return u.hostname==='127.0.0.1'?route.continue():route.abort();});
await g.goto(BASE+'/?rush='+seed+'&rushspeed=20');
await g.getByTestId('rush-overlay').waitFor();
await g.waitForFunction(()=>document.querySelector('[data-testid="rush-chart"]')?.dataset.phase==='live',null,{timeout:20000});
const decoded=await g.evaluate(async s=>{const c=await import('/src/rushCore.ts');const d=c.decodeSeed(s);return {p_market:d.market,p_bucket_seconds:d.bucket,p_end:new Date(d.end*60000).toISOString(),p_limit:100};},seed);
assert.deepEqual(decoded,first,'the shared seed is the daily round');
assert.deepEqual(guestCalls.find(c=>c.name==='rush_candles').args,first,'challenge link → identical rush_candles args');
assert(!guestCalls.some(c=>c.name.startsWith('AUTH')),'no sign-up needed to play a challenge');
assert.equal(await g.getByTestId('rush-mode').innerText(),'DAILY RUSH','a fresh player opening today\'s daily link gets it as their daily');
const gb=await g.getByTestId('rush-chart').boundingBox();
await g.mouse.move(gb.x+gb.width*.5,gb.y+gb.height*.2);await g.mouse.down();await g.waitForTimeout(400);await g.mouse.up();
await g.getByTestId('rush-result').waitFor({timeout:30000});
await g.getByTestId('rush-signup').waitFor();assert.match(await g.getByTestId('rush-signup').innerText(),/Play the real season → Pick a handle/);
assert.equal(new URL(await g.getByTestId('rush-signup').evaluate(a=>a.href)).search,'','signup goes to the app root');
for(const [w,h] of [[320,568],[393,852],[430,932]]){await g.setViewportSize({width:w,height:h});await g.waitForTimeout(150);assert(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'guest fit '+w);}
await g.setViewportSize({width:393,height:852});await g.waitForTimeout(150);await g.screenshot({path:'/tmp/brokie-rush-guest-393.png'});
// An old (non-daily) challenge seed plays as a Challenge.
const old=await g.evaluate(async()=>{const c=await import('/src/rushCore.ts');return c.encodeSeed({...c.dailySeed(c.brisbaneDay()-3),mode:'p'});});
await g.goto(BASE+'/?rush='+old+'&rushspeed=8');await g.getByTestId('rush-overlay').waitFor();
await g.waitForFunction(()=>document.querySelector('[data-testid="rush-chart"]')?.dataset.phase==='ready',null,{timeout:20000});
assert.equal(await g.getByTestId('rush-mode').innerText(),'CHALLENGE');
await g.setViewportSize({width:320,height:568});await g.waitForTimeout(300);
await g.waitForFunction(()=>document.querySelector('[data-testid="rush-chart"]')?.dataset.phase==='live',null,{timeout:20000});
await g.mouse.move(160,200);await g.mouse.down();await g.waitForTimeout(500);
assert(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'live fit 320');
await g.screenshot({path:'/tmp/brokie-rush-ride-320.png'});await g.mouse.up();
await g.goto(BASE+'/?rush=garbage');await g.getByRole('alert').waitFor();assert.match(await g.getByRole('alert').innerText(),/isn't valid/);
await guest.close();

assert.deepEqual(errors,[]);
console.log('PASS rush: Learn card → Daily Rush, replay reveal + in-bar price path, hold top = long / bottom = short with exact $ maths, tint, result card (squares, reads, timing, best ride, type, NEW BEST, streak), challenge share, daily lock + practice, Again, candles() fallback, leave-mid-daily scoring, streak freeze rules, deterministic seeds, guest challenge link with identical rpc args and no sign-up, overlay above tabs keeps the page and URL, no trading calls, fit at 320/393/430');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
