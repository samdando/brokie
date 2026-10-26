const ts=require('typescript');
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function moduleFor(name){const exports={};const source=fs.readFileSync(require('node:path').join(__dirname,`../functions/${name}/index.ts`),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,Deno:{serve:()=>{}}});return exports;}
const {parseTicker}=moduleFor('crypto-quotes');
assert.equal(parseTicker('btc',{price:'100',time:'2026-10-24T00:00:00Z'},Date.parse('2026-10-24T00:00:10Z')).price,100);
for(const p of [{price:'NaN',time:'2026-10-24T00:00:00Z'},{price:'-1',time:'2026-10-24T00:00:00Z'},{price:'100',time:'2026-10-23T00:00:00Z'},{price:'100',time:'2026-10-25T00:00:00Z'}])assert.equal(parseTicker('btc',p,Date.parse('2026-10-24T00:00:10Z')),null);
const {parseMarket}=moduleFor('prediction-quotes');
const base={ticker:'TEST',title:'Test?',rules_primary:'Yes if test passes',market_type:'binary',notional_value_dollars:'1.00',yes_bid_dollars:'.4',yes_ask_dollars:'.5',no_bid_dollars:'.5',no_ask_dollars:'.6',status:'active',close_time:'2026-10-25T00:00:00Z'};
assert.equal(parseMarket({...base,status:'determined',result:'yes'}).payout_yes,null);
assert.equal(parseMarket({...base,status:'finalized',result:'yes'}).payout_yes,1);
assert.equal(parseMarket({...base,status:'finalized',result:'no'}).payout_yes,0);
assert.equal(parseMarket({...base,status:'finalized',settlement_value_dollars:'.5'}).payout_yes,.5);
assert.equal(parseMarket({...base,yes_bid_dollars:'.6',yes_ask_dollars:'.5'}),null);
assert.equal(parseMarket({...base,yes_bid_dollars:'NaN'}),null);
assert.equal(parseMarket({...base,notional_value_dollars:'100'}),null);
console.log('Feed validation: stale/future/invalid prices rejected; final Yes/No/void resolution verified.');

assert.equal(parseMarket({...base,yes_sub_title:'Above 7,500'}).title,'Test? · Above 7,500');
// Exercise the entire ingestion handler: new discovery is finance-only, but a held sports
// position must still get its final settlement quote after the discovery policy changes.
(async()=>{
 let handler,ingested;
 const source=fs.readFileSync(require('node:path').join(__dirname,'../functions/prediction-quotes/index.ts'),'utf8');
 const open={...base,status:'active',close_time:'2099-01-01T00:00:00Z',volume_24h_fp:'200'};
 const markets=[{...open,ticker:'KXINXU-TEST',title:'S&P above 7500?'},{...open,ticker:'KXCRICKET-OLD',status:'finalized',result:'yes',title:'Old match'}];
 const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Response,AbortSignal,Request,Deno:{serve:f=>handler=f,env:{get:name=>name==='SUPABASE_URL'?'https://example.test':'test-key'}},
  fetch:async(url,init)=>{
   if(url.endsWith('check_cron_secret'))return Response.json(true);
   if(url.endsWith('prediction_watchlist'))return Response.json(['KXCRICKET-OLD']);
   if(url.endsWith('ingest_predictions')){ingested=JSON.parse(init.body).p_rows;return Response.json({ok:true});}
   return Response.json({markets});
  }
 });
 const response=await handler(new Request('https://example.test'));
 assert.equal(response.status,200);
 assert.equal(ingested.length,2);
 assert.equal(ingested.find(m=>m.id==='KXCRICKET-OLD').payout_yes,1);
 assert(ingested.some(m=>m.id==='KXINXU-TEST'));
 console.log('PASS finance feed ingestion and legacy sport settlement continuity');
})().catch(e=>{console.error(e);process.exitCode=1;});
