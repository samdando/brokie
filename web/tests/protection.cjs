const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const cache={};function load(name){if(cache[name])return cache[name];const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>load(n.replace('./',''))});return cache[name]=exports;}
const {priceForPnl,protectionDirection,protectionPnl}=load('protection');
const nas={market:'nas',side:'long',quantity:2,entry_price:30000};
assert.equal(priceForPnl(nas,'tp',500),30125);assert.equal(protectionPnl(nas,30125),500);
assert.equal(priceForPnl(nas,'sl',100),29975);assert.equal(protectionDirection(nas,'tp'),'at or above');assert.equal(protectionDirection(nas,'sl'),'at or below');
const short={...nas,side:'short',quantity:5};assert.equal(priceForPnl(short,'tp',1200),29880);assert.equal(priceForPnl(short,'sl',200),30020);assert.equal(protectionDirection(short,'tp'),'at or below');assert.equal(protectionPnl(short,1000),290000,'a price input is never silently treated as dollar profit');
const btc={market:'btc',side:'long',quantity:10,entry_price:100000};assert.equal(priceForPnl(btc,'tp',100),101000);assert.equal(priceForPnl(btc,'sl',100),99000);
const gold={market:'gold',side:'short',quantity:3,entry_price:4000};assert.equal(priceForPnl(gold,'tp',100),3996.7);assert(Math.abs(protectionPnl(gold,3996.7)-99)<.0001,'preview reflects the actual rounded market tick');
for(const amount of [NaN,Infinity,-1,0])assert.equal(priceForPnl(nas,'tp',amount),null);
assert.equal(priceForPnl({...nas,quantity:0},'tp',100),null);assert.equal(priceForPnl({market:'sol',side:'short',quantity:1,entry_price:10},'tp',100),null);
console.log('PASS protection amounts: long/short directions, stack sizing, market point values, tick rounding and invalid targets');
