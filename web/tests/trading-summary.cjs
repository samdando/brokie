const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const cache={};function load(name){if(cache[name])return cache[name];const exports={};const source=fs.readFileSync(require('node:path').join(__dirname,'../src',name+'.ts'),'utf8');vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>load(n.replace('./',''))});cache[name]=exports;return exports;}
const {tradingSummary}=load('tradingSummary');const now=Date.parse('2026-10-27T00:00:00Z');
const p=(market,side,quantity,entry_price)=>({market,side,quantity,entry_price});
const quotes=[{market:'nas',price:20100,quoted_at:new Date(now).toISOString()},{market:'gold',price:2705,quoted_at:new Date(now).toISOString()}];
const positions=[p('nas','long',2,20000),p('nas','short',1,20050),p('gold','short',3,2710)];
const summary=tradingSummary(positions,quotes,'nas',now);
assert.equal(summary.pnl,450); // NAS +400 -100; gold +150. All contracts in USD.
assert.equal(summary.groups,3);assert.equal(summary.long,2);assert.equal(summary.short,1);assert.equal(summary.stale,false);
assert.equal(tradingSummary(positions,quotes,'gold',now).pnl,450,'changing the displayed ticker does not change account-wide P&L');
assert.equal(tradingSummary([p('nas','long',1,20200)],quotes,'nas',now).pnl,-200);
assert.equal(tradingSummary([],[],'nas',now).pnl,0);assert.equal(tradingSummary([],[],'nas',now).flat,true);
assert.equal(tradingSummary(positions,quotes.slice(0,1),'nas',now).pnl,null,'missing prices never report a partial total as the full total');
assert.equal(tradingSummary(positions,quotes,'nas',now+45000).stale,true,'old prices are labelled');
assert.equal(tradingSummary(positions,[{...quotes[0],price:NaN},quotes[1]],'nas',now).pnl,null);
assert.equal(tradingSummary([...positions,p('prediction','long',20,0.4)],quotes,'nas',now).pnl,450,'tokens excluded');
console.log('PASS open P&L: long/short, multiple markets, hedges, flat, stale/missing prices and separate token wallet');
