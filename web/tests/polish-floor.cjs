// 31 Oct playtest polish: closed markets say when they open, the price change says how far back it's measured,
// the add/close tip stays off the chart, and Chat gives the messages the screen.
// Uses the local simulated preview (no accounts, no network, no orders).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,headless:true}:{channel:'chrome',headless:true});
for(const [w,h] of [[320,568],[393,852]]){
 const page=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,isMobile:true,timezoneId:'Australia/Brisbane'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto((process.env.BASE_URL||'http://127.0.0.1:5173')+'/tests/terminal-preview.html');
 await page.getByTestId('focus-floor').waitFor();
 // Preview clock: Saturday 31 Oct 2pm Brisbane. Futures reopen Sunday 6pm New York = Monday 9am Brisbane.
 assert.match(await page.getByTestId('focus-change').innerText(),/[▲▼] [\d,.]+ [+−]\d+\.\d\d%/,'change shows a percentage');
 await page.getByTestId('focus-market').click();
 assert.equal(await page.getByTestId('focus-market-closed-nas').innerText(),'Opens Mon 9:00 am');
 assert.equal(await page.getByTestId('focus-market-closed-btc').count(),0,'weekend crypto is open');
 await page.getByTestId('focus-market-nas').click();
 assert.match(await page.locator('.focus-banner').innerText(),/Market closed · opens Mon 9:00 am/);
 await page.getByTestId('focus-market').click();await page.getByTestId('focus-market-btc').click();
 // Position tip lives in the size line (never over the chart) and steps aside when you change size.
 await page.evaluate(()=>localStorage.removeItem('brokie.coach.position'));
 await page.reload();await page.getByTestId('focus-floor').waitFor();
 const tip=page.getByTestId('focus-tip');await tip.waitFor();
 const chart=await page.getByTestId('arcade-chart').boundingBox(),tb=await tip.boundingBox();
 assert(tb.y>=chart.y+chart.height,'tip sits below the chart');
 const cash=await page.getByTestId('cash-out').boundingBox();
 assert(cash.x+cash.width<=w,'cash out stays on screen with the tip showing');
 await page.getByTestId('focus-size-10').click();
 assert.equal(await tip.count(),0);assert.match(await page.getByTestId('focus-size-context').innerText(),/10 micros/);
 // Chat: the composer sits just above the tab bar.
 await page.getByTestId('chat-btn').click();await page.waitForTimeout(600);
 const gap=await page.evaluate(()=>document.querySelector('.tabs').getBoundingClientRect().top-document.querySelector('.chat-page .chat-composer').getBoundingClientRect().bottom);
 assert(gap>=0&&gap<40,`composer hugs the tab bar (gap ${gap}px)`);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 assert.deepEqual(errors,[]);await page.close();
}
await browser.close();console.log('PASS: closed-market reopen times, change %, off-chart position tip, full-height chat.');
})().catch(e=>{console.error(e);process.exit(1);});
