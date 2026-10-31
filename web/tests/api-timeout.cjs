const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const ts=require(root+'/node_modules/typescript');
let fetchImpl,timer,cleared=0;
const exportsModule={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+'/src/api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:exportsModule,require:()=>({SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'public-test-key'}),Date,AbortController,
 localStorage:{getItem:()=>JSON.stringify({access_token:'test',refresh_token:'test',expires_at:Date.now()/1000+3600})},
 setTimeout:(fn,ms)=>{assert.equal(ms,15000);timer=fn;return 1},clearTimeout:()=>{cleared++},fetch:(url,options)=>fetchImpl(options)
});
(async()=>{
 const api=new exportsModule.Backend();
 fetchImpl=({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 const stalled=api.rpc('set_position_bracket',{});await Promise.resolve();timer();
 await assert.rejects(stalled,e=>e.code==='timeout'&&/Check your account/.test(e.message));assert.equal(cleared,1);
 let bodyEntered=false;fetchImpl=async({signal})=>({ok:true,text:()=>{bodyEntered=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted body'))))}});
 const stalledBody=api.rpc('set_position_bracket',{});while(!bodyEntered)await Promise.resolve();timer();
 await assert.rejects(stalledBody,e=>e.code==='timeout');assert.equal(cleared,2);
 fetchImpl=async()=>({ok:true,text:async()=>'{"positions":[]}'});
 assert.deepEqual(JSON.parse(JSON.stringify(await api.rpc('set_position_bracket',{}))),{positions:[]});assert.equal(cleared,3);
 fetchImpl=async()=>{throw Error('offline')};await assert.rejects(api.rpc('set_position_bracket',{}),e=>e.code==='network');assert.equal(cleared,4);
 console.log('PASS request timeout: abort stalled fetch and response body, clear timers on success/failure, distinguish timeout from offline');
})().catch(e=>{console.error(e);process.exitCode=1});
