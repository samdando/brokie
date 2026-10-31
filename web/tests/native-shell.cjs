// The iOS app (WKWebView) injects window.brokieNative before any script runs. In that shell the $1 pool
// and the Add-to-Home-Screen tip stay hidden, and touch feedback defaults on. Plain web is unchanged.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
for(const native of [false,true]){
 const page=await browser.newPage({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(native) await page.addInitScript(()=>{window.brokieNative={platform:'ios',version:'test'};window.buzz=[];navigator.vibrate=p=>{window.buzz.push(p);return true;};});
 else await page.addInitScript(()=>{window.buzz=[];navigator.vibrate=p=>{window.buzz.push(p);return true;};});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto((process.env.BASE_URL||'http://127.0.0.1:5173')+'/tests/terminal-preview.html');
 await page.getByTestId('focus-floor').waitFor();
 await page.evaluate(async()=>{const {game}=await import('/src/game.ts');game.refreshPool=async()=>{};game.set({pool:{tier:'normal',entry:null,config:{open:true,entry_usd:1},standings:{rows:[],total:0,entries:0,min_days:5}}});});
 await page.getByTestId('focus-size-10').click();
 assert.equal((await page.evaluate(()=>window.buzz.length))>0,native,native?'haptics default on in the app':'haptics stay opt-in on the web');
 await page.getByTestId('tab-you').click();await page.waitForTimeout(500);
 assert.equal(await page.getByTestId('pool-card').count(),native?0:1,'pool card only on the web');
 assert.equal(await page.locator('.install-tip').count(),native?0:1,'install tip only on the web');
 await page.getByRole('button',{name:'Account settings'}).click();
 assert.equal(await page.getByLabel('Touch feedback').isChecked(),native);
 assert.deepEqual(errors,[]);await page.close();
}
await browser.close();console.log('PASS: iOS shell hides the pool and install tip, defaults haptics on; web unchanged.');
})().catch(e=>{console.error(e);process.exit(1);});
