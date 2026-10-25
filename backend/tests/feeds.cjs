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
