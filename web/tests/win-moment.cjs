// Focus floor feel pass: result splash (win / best this week / loss / server fill), riding tint, dollar risk
// while sliding, 1R/2R targets, beginner Clean indicators, default size 10, season line, target moment, tag spacing.
// Run against the local Vite dev server with synthetic state; never connects to a live account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,hasTouch:true,isMobile:true});
const errors=[];page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE ERROR',e.message)});
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await page.addInitScript(()=>{try{localStorage.setItem('brokie.layout.v2','focus')}catch{}});await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
await page.evaluate(()=>{localStorage.clear();});
await page.evaluate(async()=>{
 const {game}=await import('/src/game.ts'); window.testGame=game;
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles','refreshPool']) game[name]=async()=>{};
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:0,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:{...game.state.lifetime,handle:args?.p_handle||'sam'};
 const now=new Date().toISOString(),start=Math.floor(Date.now()/900000)-80;
 const wave=i=>Math.sin(i*.21)*28+Math.sin(i*.07)*45+Math.sin(i*1.7)*6,price=i=>29700+wave(i)-wave(80);
 const candles=Array.from({length:80},(_,i)=>({index:start+i,open:price(i),high:Math.max(price(i),price(i+1))+4,low:Math.min(price(i),price(i+1))-4,close:price(i+1)}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,target_hit:false,resets_used:0,trading_days:1,qualify_days:5,equity:100004.31};
 // One small win earlier this week (to beat), one big win from last month (doesn't count).
 const trades=[{id:'t-week',market:'nas',side:'long',quantity:1,entry_price:29690,exit_price:29700,pnl:20,closed_at:new Date(Date.now()-2*864e5).toISOString(),reason:'manual'},
  {id:'t-old',market:'nas',side:'long',quantity:10,entry_price:29000,exit_price:29200,pnl:4000,closed_at:new Date(Date.now()-20*864e5).toISOString(),reason:'manual'}];
 game.set({phase:'ready',candleSeconds:900,market:'nas',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:100004.31,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},
  squads:[],squadId:null,candles:{nas:candles},leaderboard:[],feed:[],chat:[],lifetime:{total_trades:2,win_rate:1,max_drawdown:0,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');localStorage.setItem('brokie.layout.v2','focus');
});
await page.getByTestId('focus-floor').waitFor();
await page.evaluate(()=>{
 const g=window.testGame; g.isOpen=()=>true; window.orders=[];window.brackets=[];
 window.setQuote=p=>{const me=g.state.me;g.set({me:{...me,quotes:me.quotes.map(q=>q.market==='nas'?{...q,price:p,quoted_at:new Date().toISOString()}:q)}});};
 g.open=async(side,q)=>{window.orders.push({side,q});const p={id:'p'+window.orders.length,market:'nas',side,quantity:q,entry_price:g.quote('nas').price,opened_at:new Date().toISOString()};g.set({me:{...g.state.me,positions:[p]}});return null;};
 g.setBracket=async(id,b)=>{window.brackets.push({id,...b});g.set({brackets:{...g.state.brackets,[id]:{...(g.state.brackets[id]??{}),...b}}});};
 // Closing books a trade like the server does; the test picks the P&L.
 g.closeStack=async(ids)=>{const me=g.state.me,p=me.positions[0],pnl=window.nextPnl??0;g.set({me:{...me,positions:[],cash:me.cash+pnl,trades:[{id:p.id,market:p.market,side:p.side,quantity:p.quantity,entry_price:p.entry_price,exit_price:p.entry_price,pnl,closed_at:new Date().toISOString(),reason:'manual'},...me.trades]}});return {pnl};};
});
const tabs=await page.locator('.tabs').boundingBox();

// Default size 10 for a player with no saved size.
assert.equal(await page.getByTestId('focus-size-10').getAttribute('aria-pressed'),'true','default order size is 10');
assert.match(await page.getByTestId('focus-size-context').innerText(),/10 micros · \$20\.00 \/ point/);
// The season line is in dollars with the distance to target.
assert.match(await page.getByTestId('focus-season').innerText(),/Season \+\$4\.31\s+\$9,996 to target/);
// Nothing in the HUD is clipped: every line fits its box.
const hudFits=()=>page.evaluate(()=>[...document.querySelectorAll('.pnl-box, .pnl-box > *, .focus-figures, .focus-price > *')].every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth));
assert(await hudFits(),'HUD fits at 393');
await page.setViewportSize({width:430,height:932});await page.waitForTimeout(150);
const seasonRows=()=>page.getByTestId('focus-season').evaluate(e=>new Set([...e.children].map(c=>Math.round(c.getBoundingClientRect().top))).size);
assert.equal(await seasonRows(),1,'one season line on a wide phone');
assert(await hudFits(),'HUD fits at 430');
await page.setViewportSize({width:393,height:852});await page.waitForTimeout(150);
// Beginner (2 trades, nothing saved): Clean chart, EMA only.
await page.getByTestId('focus-more').click();
assert.match(await page.getByTestId('focus-drawer').innerText(),/Indicators\s*1 on/);
await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('focus-indicators').click();
const checks=await page.locator('[data-testid="indicator-settings"] input[type="checkbox"]').evaluateAll(els=>els.map(e=>e.checked));
assert.deepEqual(checks.filter(Boolean).length,1,'only the EMA is on for a beginner');
await page.getByRole('button',{name:'Done',exact:true}).click();
assert.equal(await page.evaluate(async()=>{const m=await import('/src/indicators.ts');const g=window.testGame,me=g.state.me;
 g.set({me:{...me,trades:Array.from({length:12},(_,i)=>({...me.trades[0],id:'v'+i}))}});const vet=m.readIndicators().structure;g.set({me});return vet;}),false,'10+ trades and nothing saved: EMA-only defaults');

// Hold top → BUY 10, slide down: the label prices the risk and the win in dollars (1:1 by default).
const chart=await page.getByTestId('arcade-chart').boundingBox();
const cx=chart.x+chart.width*.45, top=chart.y+chart.height*.3;
await page.mouse.move(cx,top);await page.mouse.down();await page.waitForTimeout(450);
await page.getByTestId('hold-label').waitFor();
assert.equal(await page.evaluate(()=>document.querySelector('[data-testid="ride-tint"]').className.includes('press')),true,'holding to trade strengthens the tint');
await page.mouse.move(cx,top+110,{steps:6});await page.waitForTimeout(80);
const label=await page.getByTestId('hold-label').innerText();
assert.match(label,/TP [\d,.]+ · SL [\d,.]+/);
const [risk,win]=(label.match(/Risk \$([\d,.]+) → Win \$([\d,.]+)/)||[]).slice(1).map(s=>Number(s.replace(/,/g,'')));
assert(risk>0&&Math.abs(risk-win)<=1,'1R: risk and win match ('+label.replace(/\n/g,' | ')+')');
await page.screenshot({path:'/tmp/brokie-win-hold.png'});
await page.mouse.up();await page.waitForTimeout(200);
assert.equal(await page.evaluate(()=>window.orders[0].q),10);
const br=await page.evaluate(()=>window.brackets[0]);
assert(Math.abs((br.tp-29700)-(29700-br.sl))<.3,'1:1 by default');
assert(Math.abs(risk-(29700-br.sl)*2*10)<=1,'label risk = micros × $/pt × stop distance');

// Riding: green tint while up, red while down; R next to the open P&L.
await page.evaluate(()=>window.setQuote(29712));await page.waitForTimeout(120);
assert.equal(await page.getByTestId('focus-floor').getAttribute('data-ride'),'up');
assert.match(await page.getByTestId('ride-tint').getAttribute('class'),/\bon\b.*\bup\b/);
const r1=(12*2*10)/((29700-br.sl)*2*10);
assert.equal(await page.getByTestId('focus-r').innerText(),`+${r1.toFixed(1)}R`);
await page.screenshot({path:'/tmp/brokie-win-riding.png'});
await page.evaluate(()=>window.setQuote(29690));await page.waitForTimeout(120);
assert.equal(await page.getByTestId('focus-floor').getAttribute('data-ride'),'down');
assert.match(await page.getByTestId('ride-tint').getAttribute('class'),/\bdown\b/);
// Entry and live price tags a point apart never overlap on the axis.
await page.evaluate(()=>window.setQuote(29700.5));await page.waitForTimeout(120);
const tags=await page.locator('.arcade-chart canvas').evaluate(c=>c.dataset.tags.split(',').map(s=>{const [k,y]=s.split(':');return {k,y:+y};}));
const live=tags.find(t=>t.k==='live'),entry=tags.filter(t=>t.k==='level');
assert(entry.length>=3,'entry, target and stop tags drawn');
for(const t of entry) assert(Math.abs(t.y-live.y)>=19,'tag clear of the live price ('+JSON.stringify(tags)+')');
for(let i=0;i<tags.length;i++)for(let j=i+1;j<tags.length;j++)assert(Math.abs(tags[i].y-tags[j].y)>=18,'no two axis tags overlap');
await page.screenshot({path:'/tmp/brokie-win-tags.png'});

// Win: hold cash out. Big green dollars, R, BEST THIS WEEK (beats the +$20 from this week; last month's +$4,000 doesn't count).
const riskUsd=(29700-br.sl)*2*10;
await page.evaluate(r=>{window.nextPnl=Math.round(r*1.5*100)/100;window.setQuote(29720);},riskUsd);
const co=await page.getByTestId('cash-out').boundingBox();
await page.mouse.move(co.x+20,co.y+15);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
await page.getByTestId('result-splash').waitFor();
assert.equal(await page.getByTestId('result-splash').getAttribute('data-tone'),'win');
assert.match(await page.getByTestId('result-amount').innerText(),/^\+\$[\d,]+\.\d\d$/);
assert.equal(await page.getByTestId('result-r').innerText(),'+1.5R');
assert.match(await page.getByTestId('result-meta').innerText(),/NAS · Long 10/);
assert.match(await page.getByTestId('best-week').innerText(),/best this week/i);
assert.equal(await page.getByTestId('result-splash').evaluate(e=>getComputedStyle(e).pointerEvents),'none','splash never takes touches');
await page.waitForTimeout(500);
await page.screenshot({path:'/tmp/brokie-win-splash.png'});
const card=await page.locator('.rs-card').boundingBox();assert(card.y+card.height<tabs.y,'splash stays above the tab bar');
assert(card.x>=0&&card.x+card.width<=393,'splash fits the width');
const winSize=await page.getByTestId('result-amount').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
// The next trade is never blocked: a hold during the splash dismisses it and trades.
await page.mouse.move(cx,top);await page.mouse.down();await page.waitForTimeout(450);
await page.getByTestId('hold-label').waitFor();
assert.equal(await page.evaluate(()=>window.orders.length),2,'a hold through the splash still trades');
await page.mouse.move(cx,top+90,{steps:5});await page.mouse.up();await page.waitForTimeout(300);
assert.equal(await page.getByTestId('result-splash').count(),0,'touching dismisses the splash');

// Loss: calmer and smaller, red, −1.0R, no badge, no burst, no "win it back"; it goes on its own.
await page.evaluate(()=>{const g=window.testGame,p=g.state.me.positions[0];window.nextPnl=-(p.entry_price-g.state.brackets[p.id].sl)*2*p.quantity;window.setQuote(29680);});
await page.waitForTimeout(150);
const co2=await page.getByTestId('cash-out').boundingBox();
await page.mouse.move(co2.x+20,co2.y+15);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
await page.getByTestId('result-splash').waitFor();
assert.equal(await page.getByTestId('result-splash').getAttribute('data-tone'),'loss');
assert.match(await page.getByTestId('result-amount').innerText(),/^−\$/);
assert.equal(await page.getByTestId('result-r').innerText(),'−1.0R');
assert.equal(await page.getByTestId('best-week').count(),0);
assert.equal(await page.locator('.rs-burst').count(),0,'no celebration on a loss');
const lossText=await page.getByTestId('result-splash').innerText();
assert.doesNotMatch(lossText,/win (it )?back|revenge/i);assert.match(lossText,/Loss kept to your stop/);
assert(await page.getByTestId('result-amount').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))<winSize,'loss figure is smaller');
await page.waitForTimeout(250);await page.screenshot({path:'/tmp/brokie-loss-splash.png'});
await page.waitForTimeout(1500);
assert.equal(await page.getByTestId('result-splash').count(),0,'loss splash leaves on its own');
assert.equal(await page.getByTestId('focus-floor').getAttribute('data-ride'),'none','no tint once flat');

// 2R from the drawer: the slide puts the target twice as far as the stop; the label says so in dollars.
await page.getByTestId('focus-more').click();await page.getByTestId('focus-rr-2').click();
assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.rr')),'2');
await page.getByRole('button',{name:'Done',exact:true}).click();await page.waitForTimeout(150);
await page.mouse.move(cx,top);await page.mouse.down();await page.waitForTimeout(450);
await page.mouse.move(cx,top+100,{steps:6});await page.waitForTimeout(80);
const label2=await page.getByTestId('hold-label').innerText();
const [risk2,win2]=(label2.match(/Risk \$([\d,.]+) → Win \$([\d,.]+)/)||[]).slice(1).map(s=>Number(s.replace(/,/g,'')));
assert(Math.abs(win2-2*risk2)<=2,'2R label: win is twice the risk ('+label2.replace(/\n/g,' | ')+')');
await page.screenshot({path:'/tmp/brokie-2r-hold.png'});
await page.mouse.up();await page.waitForTimeout(200);
const br3=await page.evaluate(()=>window.brackets.at(-1));
const e3=29680;   // the live price when the hold armed
assert(br3.sl<e3&&br3.tp>e3);
assert.equal(br3.tp-e3,2*(e3-br3.sl),'2R: TP = entry + 2 × (entry − SL)');
await page.evaluate(()=>window.setQuote(29701));await page.waitForTimeout(150);
assert.equal(await page.getByTestId('focus-r').innerText().then(s=>s.endsWith('R')),true);
await page.screenshot({path:'/tmp/brokie-2r-position.png'});

// A server take-profit fill the floor hears about gets the splash too ("Target hit"), with R from the stop it had.
await page.evaluate(()=>{const g=window.testGame,me=g.state.me,p=me.positions[0],b=g.state.brackets[p.id];
 const pnl=(b.tp-p.entry_price)*2*p.quantity;
 g.set({me:{...me,positions:[],cash:me.cash+pnl,trades:[{id:p.id,market:'nas',side:p.side,quantity:p.quantity,entry_price:p.entry_price,exit_price:b.tp,trigger_price:b.tp,pnl,closed_at:new Date().toISOString(),reason:'take_profit'},...me.trades]}});});
await page.getByTestId('result-splash').waitFor();
assert.match(await page.getByTestId('result-splash').innerText(),/Target hit/i);
assert.equal(await page.getByTestId('result-r').innerText(),'+2.0R');
await page.mouse.click(30,chart.y+chart.height*.8);await page.waitForTimeout(300);
assert.equal(await page.getByTestId('result-splash').count(),0,'tap dismisses');

// Target hit: one full-screen moment per season.
await page.evaluate(()=>{const g=window.testGame,me=g.state.me;g.set({me:{...me,cash:110250,rules:{...me.rules,target_hit:true,equity:110250}}});});
await page.getByTestId('goal-celebration').waitFor();
assert.equal(await page.getByTestId('goal-celebration').getAttribute('data-kind'),'target');
assert.match(await page.getByTestId('focus-season').innerText(),/Target hit/);
await page.waitForTimeout(700);await page.screenshot({path:'/tmp/brokie-goal-target.png'});
await page.getByTestId('goal-continue').click();await page.waitForTimeout(150);
assert.equal(await page.getByTestId('goal-celebration').count(),0);
await page.evaluate(()=>{const g=window.testGame,me=g.state.me;g.set({me:{...me,rules:{...me.rules,target_hit:false}}});g.set({me:{...g.state.me,rules:{...g.state.me.rules,target_hit:true}}});});
await page.waitForTimeout(200);
assert.equal(await page.getByTestId('goal-celebration').count(),0,'shows once per season');
assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.goal.s1.target')),'done');
// Funded is its own moment.
await page.evaluate(()=>{const g=window.testGame,me=g.state.me;g.set({me:{...me,rules:{...me.rules,funded:true,trading_days:5}}});});
await page.getByTestId('goal-celebration').waitFor();
assert.equal(await page.getByTestId('goal-celebration').getAttribute('data-kind'),'funded');
await page.getByTestId('goal-celebration').click({position:{x:20,y:20}});await page.waitForTimeout(150);
assert.equal(await page.getByTestId('goal-celebration').count(),0,'tap anywhere dismisses');
assert.match(await page.getByTestId('focus-season').innerText(),/Funded/);

// Saving a preset ends the beginner chart.
await page.getByTestId('focus-indicators').click();
await page.locator('.indicator-presets').getByRole('button',{name:'Structure',exact:true}).click();
await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('focus-more').click();
assert.match(await page.getByTestId('focus-drawer').innerText(),/Indicators\s*4 on/);
await page.getByRole('button',{name:'Done',exact:true}).click();
assert.equal(await page.evaluate(async()=>(await import('/src/indicators.ts')).readIndicators().structure),true,'a saved choice is respected');

// Small phone + reduced motion: still fits above the tab bar, splash without animation.
await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at 320');
await page.mouse.move(100,(await page.getByTestId('arcade-chart').boundingBox()).y+60);await page.mouse.down();await page.waitForTimeout(450);await page.mouse.up();await page.waitForTimeout(200);
await page.evaluate(()=>{window.nextPnl=84.3;window.setQuote(29705);});await page.waitForTimeout(100);
await page.screenshot({path:'/tmp/brokie-320-riding.png'});
const co3=await page.getByTestId('cash-out').boundingBox();
await page.mouse.move(co3.x+20,co3.y+15);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
await page.getByTestId('result-splash').waitFor();
assert.equal(await page.locator('.rs-card').evaluate(e=>getComputedStyle(e).animationName),'none','reduced motion: no pop');
assert.equal(await page.locator('.rs-burst').evaluate(e=>getComputedStyle(e).display),'none','reduced motion: no burst');
const tabs2=await page.locator('.tabs').boundingBox(),card2=await page.locator('.rs-card').boundingBox();
assert(card2.y+card2.height<tabs2.y&&card2.x>=0&&card2.x+card2.width<=320,'splash fits a 320 phone');
await page.screenshot({path:'/tmp/brokie-320-splash.png'});
assert(await hudFits(),'HUD fits at 320');

// Win/loss sounds use the opt-in sound setting: on by default in the iOS app, still off on the web.
assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.sound')),null,'web: sound stays opt-in');
{const ctx=await browser.newContext();await ctx.addInitScript(()=>{window.brokieNative={};try{localStorage.setItem('brokie.layout.v2','focus')}catch{}});const ios=await ctx.newPage();
 await ios.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 await ios.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');await ios.waitForFunction(()=>localStorage.getItem('brokie.sound')!==null);
 assert.equal(await ios.evaluate(async()=>[localStorage.getItem('brokie.sound'),(await import('/src/effects.ts')).soundOn()].join()),'on,true','iOS app: sound on when unset');
 await ctx.close();}

assert.deepEqual(errors,[]);
console.log('PASS win moment: iOS sound default, default size 10, season $ + to-target line, beginner Clean chart then saved preset respected, dollar risk/win while sliding, 1R default, riding tint up/down/press, R next to P&L, axis tags kept apart, win splash with $ + R + best-this-week, tap-through next trade, calm loss splash, 2R slide, server TP fill splash, once-per-season target/funded moments, 320px + reduced motion');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
