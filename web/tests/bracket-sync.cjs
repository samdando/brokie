const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const storage=new Map(),cache={react:{useSyncExternalStore:()=>{}},config:{isConfigured:false},api:{Backend:class{},BackendError:class extends Error{}}};
const globals={console,Date,Intl,setTimeout,clearTimeout,window:{setTimeout,clearTimeout},document:{hidden:false},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
function load(name){if(cache[name])return cache[name];const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...globals,exports,require:n=>load(n.replace('./',''))});return cache[name]=exports;}
const {Game}=load('game');const p={id:'p',market:'nas',side:'long',quantity:2,entry_price:30000,opened_at:new Date().toISOString(),stop_loss:null,take_profit:null};
const me=()=>({handle:'sam',season:'s1',cash:100000,positions:[{...p}],quotes:[{market:'nas',price:30000,quoted_at:new Date().toISOString()}],trades:[],server_time:new Date().toISOString()});
const fresh=()=>{const g=new Game();g.state.me=me();g.lastWeekend=false;g.refreshCandles=async()=>{};g.refreshBubbles=async()=>{};return g;};
(async()=>{
 const g=fresh();g.legacyBracketsChecked=true;let release;
 g.api.rpc=async()=>new Promise(r=>release=r);
 const saving=g.setBracket('p',{sl:29990});assert.equal(g.state.bracketSaving,'p');assert.equal(g.state.brackets.p,undefined);
 release({positions:[{id:'p',stop_loss:29990,take_profit:null}]});await saving;assert.equal(g.state.brackets.p.sl,29990);
 g.api.rpc=async()=>{throw Error('network');};await assert.rejects(g.setBracket('p',{sl:29980}),/network/);assert.equal(g.state.brackets.p.sl,29990);assert.equal(g.state.bracketSaving,null);
 // A poll begun before an edit must not replace its confirmed levels with stale data.
 let poll;g.api.rpc=async name=>name==='my_state'?new Promise(r=>poll=r):{positions:[{id:'p',stop_loss:29970,take_profit:null}]};
 const refreshing=g.refreshState();await g.setBracket('p',{sl:29970});poll(me());await refreshing;assert.equal(g.state.brackets.p.sl,29970);
 // A new device receives saved protection without any local storage.
 const remote=fresh();remote.api.rpc=async()=>({...me(),positions:[{...p,stop_loss:29970,take_profit:30030}]});await remote.refreshState();assert.equal(remote.state.brackets.p.sl,29970);assert.equal(remote.state.brackets.p.tp,30030);
 // Upgrade old device-only stops. Only confirmed requests become chart lines.
 storage.set('brokie.brackets',JSON.stringify({p:{sl:29950,tp:30050}}));const migration=fresh();
 migration.api.rpc=async(name,args)=>{if(args.p_kind==='tp')throw Error('crossed');return{positions:[{id:'p',stop_loss:args.p_price,take_profit:null}]};};
 await migration.migrateDeviceBrackets();assert.equal(migration.state.brackets.p.sl,29950);assert.equal(migration.state.brackets.p.tp,undefined);assert.equal(JSON.parse(storage.get('brokie.brackets')).p.sl,undefined);assert.equal(JSON.parse(storage.get('brokie.brackets')).p.tp,30050);assert.equal(migration.state.flash.title,'Review your SL/TP');
 // Explicit cancellation removes the old local level too: it cannot reappear on restart.
 migration.api.rpc=async()=>({positions:[{id:'p',stop_loss:29950,take_profit:null}]});await migration.clearBracket('p','tp');assert.equal(storage.has('brokie.brackets'),false);
 storage.set('brokie.brackets','null');await fresh().migrateDeviceBrackets();assert.equal(storage.has('brokie.brackets'),false);
 console.log('PASS bracket sync: confirmation, failed saves, poll races, cross-device restore, legacy migration and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
