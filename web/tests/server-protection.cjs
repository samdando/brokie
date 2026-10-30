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
 const {game}=await import('/src/game.ts'); window.testGame=game;
 for(const name of ['setActive','refreshState','refreshSquads','refreshBoard','refreshBubbles','refreshLifetime','refreshChat','refreshGlobal','refreshEvents','refreshCandles']) game[name]=async()=>{};
 game.checkBrackets=async()=>[];
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});

await page.getByTestId('go-long').waitFor();
await page.evaluate(()=>{const g=window.testGame;g.set({me:{...g.state.me,positions:[{id:'protected',market:'nas',side:'long',quantity:2,entry_price:29700,opened_at:new Date().toISOString(),stop_loss:null,take_profit:null}]}});
window.rpcRequests=[];window.failSave=false;g.api.rpc=async(name,args)=>{if(name!=='set_position_bracket')return {};window.rpcRequests.push(args);await new Promise(resolve=>window.releaseSave=resolve);if(window.failSave)throw new Error('Connection lost. Stop was not saved.');const p={...g.state.me.positions[0],[args.p_kind==='sl'?'stop_loss':'take_profit']:args.p_price};return {positions:[p]};};});
await page.getByTestId('trading-status').click();await page.getByRole('button',{name:'Manage SL/TP for NAS long'}).last().click();
const editor=page.getByTestId('protection-editor');await editor.waitFor();
await page.getByLabel('Stop loss price',{exact:true}).fill('29680');await editor.getByRole('button',{name:'Save',exact:true}).first().click();
assert.equal(await page.evaluate(()=>window.testGame.state.brackets.protected?.sl),undefined,'unsaved draft is not protection');
assert(await editor.getByText(/Saving… your previous/).isVisible());
await page.evaluate(()=>window.releaseSave());await editor.getByText('Active · 29,680.00',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.testGame.state.brackets.protected.sl),29680);
// A failed edit must leave the last confirmed stop intact and display the error.
await page.getByLabel('Stop loss price',{exact:true}).fill('29650');await page.evaluate(()=>window.failSave=true);await editor.getByRole('button',{name:'Save',exact:true}).first().click();await page.evaluate(()=>window.releaseSave());await page.getByTestId('toast').getByText('Connection lost. Stop was not saved.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.testGame.state.brackets.protected.sl),29680);assert(await editor.getByText('Active · 29,680.00',{exact:true}).isVisible());
await page.evaluate(()=>window.failSave=false);await editor.getByRole('button',{name:'Cancel SL'}).click();await page.evaluate(()=>window.releaseSave());assert.equal(await page.evaluate(()=>window.testGame.state.brackets.protected?.sl),undefined);
for(const [width,height] of [[320,568],[393,852],[430,932]]) {await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const input=await page.getByLabel('Stop loss price',{exact:true}).boundingBox();assert(input.width>=100);}
await page.screenshot({path:'/tmp/brokie-protection-editor.png'});
await editor.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.evaluate(()=>document.body.style.overflow),'','switching sheets does not strand scroll lock');
await page.getByTestId('big-chart').click();await page.getByTestId('trading-status').click();await page.getByRole('button',{name:'Manage SL/TP for NAS long'}).last().click();await editor.waitFor();await editor.getByRole('button',{name:'Done',exact:true}).click();assert(await page.getByRole('dialog',{name:'Fullscreen chart'}).isVisible());await page.getByTestId('big-chart').click();
const previousSaves=await page.evaluate(()=>window.rpcRequests.length);
await page.getByTestId('big-chart').click();await page.waitForTimeout(400);const grip=await page.getByTestId('bracket-grip').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2-50,{steps:8});await page.mouse.up();await page.waitForTimeout(100);
assert.equal(await page.evaluate(()=>window.rpcRequests.length),previousSaves+1,'one drag sends exactly one save in StrictMode');await page.evaluate(()=>window.releaseSave());await page.getByTestId('big-chart').click();
assert.deepEqual(errors,[]);console.log('PASS protection editor: pending/confirmed states, failed-save preservation, cancellation, small phones, sheet scroll restoration and fullscreen');await browser.close();})();
