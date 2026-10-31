// Run against the local Vite dev server. Uses synthetic state; never connects to a live account.
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
 game.api.rpc=async(name,args)=>name==='avatar_shop'?{balance:8,items:[],equipped:null}:name==='player_avatars'?{}:name==='squad_dashboard'?{day:'2026-10-26',ends_at:new Date().toISOString(),players:[],open:[]}:name==='share_trade'?'10000000-0000-0000-0000-000000000001':{...game.state.lifetime,handle:args?.p_handle || 'sam'};
 const now=new Date().toISOString(); const start=Math.floor(Date.now()/60000)-100;
 const candles=Array.from({length:100},(_,i)=>({index:start+i,open:29600+i,high:29610+i,low:29590+i,close:29605+i}));
 const rules={status:'active',start_balance:100000,peak_equity:100000,day_start_equity:100000,daily_loss_pct:5,max_dd_pct:10,daily_floor:95000,drawdown_floor:90000,target:110000,funded:false,resets_used:0,trading_days:1,qualify_days:5,equity:99900};
 const trades=[{id:'t1',market:'nas',side:'long',quantity:10,entry_price:29700,exit_price:29695,pnl:-100,closed_at:now,reason:'daily_limit'}];
 game.set({phase:'ready',me:{handle:'sam',season:'s1',season_number:1,season_ends_at:'2026-12-14T00:00:00Z',server_time:now,cash:99900,rules,protection_credit:0,liquidations:0,has_backup_code:true,positions:[],trades,quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now}))},squads:[{id:'s',name:'Bing',member_count:5,invite_code:'ABCDEF',owner_id:'sam'}],squadId:'s',candles:{nas:candles,gold:candles,es:candles},leaderboard:['jaoushai','mrsdandylion','ankits','bum','sam'].map((handle,i)=>({handle,is_you:handle==='sam',equity:100000-i*100,return_pct:2-i,trades:5,worst_trade:-100,open_positions:0,trading_days:1,qualified:false})),feed:Array.from({length:5},(_,i)=>({kind:'opened',id:String(i),handle:'jaoushai',market:'nas',side:'long',quantity:2,price:29700,pnl:null,reason:null,at:now,is_you:false})),chat:[{id:1,handle:'sam',is_you:true,kind:'text',body:'See you tomorrow bro',at:now}],lifetime:{total_trades:5,win_rate:0,max_drawdown:5.1,seasons_played:1,seasons_funded:0,seasons_blown:0,seasons:[{season:'s1',number:1,return_pct:-5.01,status:'active',funded:false}]}});
 localStorage.setItem('brokie.lessons','[0,1,2]');
});
await page.getByTestId('go-long').waitFor();
await page.evaluate(()=>{
 const g=window.testGame;g.now=()=>Date.parse('2026-10-27T13:15:00Z');
 const now=new Date(g.now()).toISOString(); const players=g.state.leaderboard.map((p,i)=>({...p,status:i===1?'blown':'active',qualified:true,open_positions:i<2?1:0,today_pnl:undefined,return_pct:4.5-i*1.75}));
 const trades=Array.from({length:10},(_,i)=>({...g.state.me.trades[0],id:'trade-'+i,market:i%2?'gold':'nas',quantity:i%2?1:10,side:i%2?'short':'long',pnl:i%3?-120:450,reason:'closed'}));
 g.set({me:{...g.state.me,cash:104500,trades,quotes:g.state.me.quotes.map(q=>({...q,quoted_at:now}))},leaderboard:players,global:{rows:players.map((p,i)=>({...p,rank:i+1,show_global:true})),me:{...players[4],rank:5,show_global:true},players:5},chat:[{id:1,handle:'ankits',kind:'text',is_you:false,body:'Watching the Nasdaq open. Anyone else in?',at:now},{id:2,handle:'sam',kind:'text',is_you:true,body:'Here for it. Keeping the size small.',at:now},{id:3,handle:'bum',kind:'emoji',is_you:false,body:'👀',at:now}],lifetime:{...g.state.lifetime,win_rate:60,total_trades:54,seasons_played:2,seasons_funded:1}});
 window.calls=[];window.messages=[];window.sharedInvites=[];window.playerLooks={sam:{symbol:'💎',color:'#7CC8FF'},ankits:{symbol:'😎',color:'#F2CA73'},bum:{symbol:'🐸',color:'#73E7C3'},jaoushai:{symbol:'👽',color:'#B5A0FE'},mrsdandylion:{symbol:'🌼',color:'#FF7D8B'}};
 Object.defineProperty(navigator,'share',{configurable:true,value:async data=>window.sharedInvites.push(data)});
 g.sendMessage=async(body,kind)=>{window.messages.push({body,kind});g.set({chat:[...g.state.chat,{id:100+window.messages.length,handle:'sam',kind:kind??'text',is_you:true,body,at:now}]});return null;};
 g.api.rpc=async(name,args)=>{
  window.calls.push({name,args});
  if(name==='player_avatars')return structuredClone(window.playerLooks);
  if(name==='squad_dashboard')return {day:'2026-10-27',ends_at:'2026-10-27T21:00:00Z',players:players.map((p,i)=>({handle:p.handle,trades:5,wins:3,losses:2,pnl:450-i*150})),open:[{handle:'ankits',market:'nas',side:'long',quantity:10,entry_price:29680,opened_at:now},{handle:'bum',market:'gold',side:'short',quantity:1,entry_price:29740,opened_at:now}]};
  if(name==='daily_leaderboard')return {day:'2026-10-27',rows:[{is_you:true,pnl:450,wins:3,losses:2,trades:5}]};
  if(name==='avatar_shop'||name==='buy_avatar'||name==='equip_avatar'||name==='set_profile_color')return {balance:name==='buy_avatar'?5:8,equipped:name==='buy_avatar'?'bull':'diamond',color:args?.p_color??'#799FBA',items:[{id:'diamond',name:'Diamond hands',symbol:'💎',color:'#799FBA',price:0,owned:true},{id:'bull',name:'Bull club',symbol:'🐂',color:'#A8D5B6',price:3,owned:name==='buy_avatar'},{id:'alien',name:'Out of this world',symbol:'👽',color:'#A8D5B6',price:0,owned:true}]};
  if(name==='lifetime_stats')return {...g.state.lifetime,handle:args?.p_handle??'sam'};
  if(name==='chart_bubbles')return [];
  if(name==='review_trade')return {trade:trades[0],candles:[],bucket_seconds:60,note:''};
  if(name==='save_trade_note')return {};
  if(name==='set_global_visibility'||name==='submit_feedback')return {};
  throw Error('Unexpected RPC '+name);
 };
 localStorage.removeItem('brokie.lessons');
});
const fit=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
const snap=async name=>{await page.waitForTimeout(400);await fit();await page.screenshot({path:`/tmp/brokie-pages-${name}.png`});};
for(const width of [320,393,430]){
 await page.setViewportSize({width,height:852});
 for(const tab of ['squad','learn','you']){
  await page.getByTestId('tab-'+tab).click();await page.waitForTimeout(400);await fit();
  assert.equal(await page.getByTestId('tab-'+tab).getAttribute('aria-current'),'page');
  assert.equal(await page.getByText(/Predictions|Buy YES|Buy NO/).count(),0);
  if(width===393)await snap(tab);
 }
}
await page.setViewportSize({width:393,height:852});
await page.getByTestId('tab-squad').click();await page.getByTestId('squad-title').waitFor();await page.waitForTimeout(400);
assert(await page.getByTestId('squad-active').isVisible());assert.equal(await page.getByTestId('squad-daily').isVisible(),false,'daily details collapse');
await page.getByTestId('squad-recap').locator('summary').click();assert(await page.getByTestId('squad-daily').isVisible());
await page.getByRole('button',{name:'Invite or manage squad'}).click();await page.getByTestId('invite-code').waitFor();await page.getByRole('button',{name:'Invite friends ↗',exact:true}).click();assert.equal(await page.evaluate(()=>window.sharedInvites.length),1);await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('seg-global').click();await page.getByTestId('global-board').waitFor();await snap('everyone');
await page.getByTestId('global-visibility').click();assert(await page.evaluate(()=>window.calls.some(c=>c.name==='set_global_visibility'&&c.args.p_show===false)));
await page.getByTestId('seg-squad').click();await page.getByTestId('leader-row').first().getByRole('button').first().click();await page.getByTestId('player-profile').waitFor();assert.equal(await page.getByTestId('leader-row').count(),await page.getByTestId('leader-row').getByTestId('rank-badge').count());assert.equal(await page.getByTestId('player-profile').getByTestId('rank-badge').count(),1);await snap('player');await page.getByTestId('player-profile').getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('chat-btn').click();await page.getByTestId('chat').waitFor();await snap('chat');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-row')).getPropertyValue('--player-accent')==='#F2CA73');await page.evaluate(async()=>{window.playerLooks.ankits.color='#B5A0FE';const {refreshAvatars}=await import('/src/Avatar.tsx');refreshAvatars();});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-row')).getPropertyValue('--player-accent')==='#B5A0FE'&&getComputedStyle(document.querySelector('.message-avatar .player-avatar')).getPropertyValue('--player-accent')==='#B5A0FE');
await page.getByTestId('chat-input').fill('The new floor looks clean.');await page.getByTestId('chat-send').click();assert.equal(await page.evaluate(()=>window.messages[0].body),'The new floor looks clean.');assert.equal(await page.getByTestId('chat-input').inputValue(),'');
await page.getByRole('button',{name:'Emoji reactions',exact:true}).click();await page.getByTestId('emoji-bar').getByRole('button').first().click();assert.equal(await page.evaluate(()=>window.messages[1].kind),'emoji');
await page.getByTestId('tab-trade').click();
await page.getByTestId('tab-learn').click();await page.getByTestId('lesson-0').click();await page.getByTestId('lesson-content').waitFor();await snap('lesson');await page.getByRole('button',{name:'Your position loses',exact:true}).click();assert.match(await page.getByRole('status').innerText(),/Not quite/);assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.lessons')),null);await page.getByRole('button',{name:'Your position gains',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.lessons')),'[0]');await page.getByRole('button',{name:'Next lesson →',exact:true}).click();await page.getByRole('button',{name:'+$20',exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByTestId('tab-you').click();await page.waitForTimeout(400);await page.getByTestId('rank-card').waitFor();assert.ok(['iron','bronze','silver','gold','platinum','diamond','legend'].includes(await page.getByTestId('rank-card').getAttribute('data-tier')));await page.getByTestId('usdc-play').scrollIntoViewIfNeeded();await page.getByTestId('usdc-play').locator('summary').click();await page.getByTestId('usdc-optin').waitFor();await snap('usdc');await page.getByTestId('usdc-optin').click();await page.getByTestId('usdc-optin').and(page.locator('[aria-checked="true"]')).waitFor();assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='submit_feedback'&&/1 USDC/.test(JSON.stringify(c.args??c)))));await page.getByTestId('usdc-play').locator('summary').click();await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.getByTestId('receipt').count(),6);await page.getByRole('button',{name:'View all 10 trades'}).click();assert.equal(await page.getByTestId('receipt').count(),10);
await page.getByTestId('receipt').first().click();await page.getByTestId('trade-review').waitFor();await page.getByPlaceholder('What was the setup? What would you repeat or change?').fill('Keep the size small.');await page.getByRole('button',{name:'Save private note'}).click();await page.getByRole('button',{name:'Saved ✓'}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('button',{name:'Change your look'}).click();await page.getByTestId('avatar-bull').waitFor();await snap('look');await page.getByTestId('avatar-bull').click();await page.getByTestId('avatar-bull').getByText('Equipped ✓').waitFor();assert(await page.getByTestId('avatar-shop').innerText().then(t=>t.includes('5 tokens')));await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByTestId('toast').waitFor({state:'hidden'});
await page.getByRole('tab',{name:'Lifetime',exact:true}).click();await page.getByTestId('lifetime').waitFor();await snap('lifetime');
await page.getByRole('button',{name:'Account settings',exact:true}).click();await snap('settings');await page.getByLabel('Touch feedback',{exact:true}).check();assert.equal(await page.evaluate(()=>localStorage.getItem('brokie.haptics')),'on');await page.getByRole('button',{name:'Done',exact:true}).click();
await page.evaluate(()=>{const g=window.testGame;g.set({squads:[],squadId:null,leaderboard:[],feed:[],chat:[],me:{...g.state.me,trades:[]}});});
await page.getByTestId('tab-squad').click();await page.getByTestId('join-code').waitFor();await snap('squad-empty');assert(await page.getByTestId('join-squad').isDisabled());await page.getByTestId('join-code').fill('ABCDEF');assert.equal(await page.getByTestId('join-squad').isDisabled(),false);
await page.getByTestId('chat-btn').click();await page.getByTestId('chat-page').getByRole('button',{name:'Go to Squad'}).waitFor();await snap('chat-empty');await page.getByTestId('chat-page').getByRole('button',{name:'Go to Squad'}).click();
await page.evaluate(()=>window.testGame.set({phase:'needsHandle',me:null}));await page.getByTestId('onboarding-handle').waitFor();
for(const [width,height] of [[320,568],[393,852],[430,932]]){await page.setViewportSize({width,height});await fit();if(width===393)await snap('welcome');}
await page.getByTestId('onboarding-handle').fill('MY_HANDLE!');assert.equal(await page.getByTestId('onboarding-handle').inputValue(),'my_handle');await page.getByTestId('onboarding-restore').click();await page.getByTestId('restore-code').waitFor();await snap('restore');
assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.calls.some(c=>/prediction/.test(c.name))),false);console.log('PASS secondary pages: responsive layouts, live identity colour sync, squad/invites/global visibility, player profiles, chat, lessons/progress, review notes, avatar purchase, settings, empty states and onboarding');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
