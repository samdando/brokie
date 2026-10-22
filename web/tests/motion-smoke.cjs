// Local-only motion/input regression: never submits orders or connects to an account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:5173');
    await page.evaluate(async () => {
      const { game } = await import('/src/game.ts');
      window.testGame = game; window.tapCalls = [];
      for (const name of ['setActive', 'refreshState', 'refreshSquads', 'refreshBoard', 'refreshBubbles', 'refreshLifetime', 'refreshChat', 'refreshGlobal', 'refreshEvents', 'refreshCandles']) game[name] = async () => {};
      game.checkBrackets = async () => [];
      game.tap = side => window.tapCalls.push(side);
      const now = new Date().toISOString();
      const rules = { status:'active', start_balance:100000, peak_equity:103500, day_start_equity:100000, daily_loss_pct:5, max_dd_pct:10, daily_floor:95000, drawdown_floor:93150, target:110000, funded:false, resets_used:0, trading_days:3, qualify_days:5, equity:103500 };
      game.set({ phase:'ready', market:'nas', me:{ handle:'sam', season:'s1', season_number:1, season_ends_at:'2026-12-14T00:00:00Z', server_time:now, cash:103500, rules, protection_credit:0, liquidations:0, has_backup_code:true, positions:[], trades:[], quotes:['nas','gold','es'].map(market=>({market,price:29700,quoted_at:now})) } });
    });
    const buy = page.getByTestId('go-long'), sell = page.getByTestId('go-short');
    await buy.waitFor(); await page.waitForTimeout(500);
    // Clicks must deliver once, even while the button and its descendants animate.
    const startBox = await buy.boundingBox();
    await page.mouse.click(startBox.x+startBox.width/2,startBox.y+startBox.height/2);
    await page.waitForFunction(() => document.querySelector("[data-testid=go-long]").getAnimations().some(a => a.animationName === "controller-press"));
    assert(await buy.locator('.tap-ring').count() > 0);
    assert.equal(await page.evaluate(() => window.tapCalls.length), 1);
    const b = await buy.boundingBox();
    for (let i = 0; i < 5; i++) await page.mouse.click(b.x+b.width/2, b.y+b.height/2);
    await sell.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    assert.deepEqual(await page.evaluate(() => window.tapCalls), [...Array(6).fill('long'),'short','short']);
    await page.waitForTimeout(750);
    assert.equal(await page.locator('.tap-feedback').count(), 0, 'tap effects clean up');
    await page.evaluate(() => { const g=window.testGame; g.set({me:{...g.state.me,cash:104000}}); });
    await page.waitForFunction(() => document.querySelector('[data-testid="equity"]').textContent === '$104,000.00');
    assert(await page.locator('[data-testid="equity"] .tick-value').evaluate(el => el.getAnimations().length > 0), 'exact value gets a presentation tick');
    await page.emulateMedia({ reducedMotion:'reduce' });
    await buy.click();
    assert.equal(await buy.locator('.tap-feedback').first().evaluate(el => getComputedStyle(el).display), 'none');
    await page.evaluate(() => { const g=window.testGame; g.set({me:{...g.state.me,cash:104100}}); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-testid="equity"] .tick-value').evaluate(el => el.getAnimations().length), 0);
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState==='running').length), 0, 'reduced motion stops all decorative animations');
    // Disabled trading must not produce an input call or a fresh effect.
    await page.waitForTimeout(650);
    await page.evaluate(() => {const g=window.testGame;g.set({me:{...g.state.me,rules:{...g.state.me.rules,status:'locked'}}});});
    await page.waitForFunction(() => document.querySelector('[data-testid="go-long"]').disabled);
    const calls = await page.evaluate(() => window.tapCalls.length), locked = await buy.boundingBox();
    await page.mouse.click(locked.x+locked.width/2,locked.y+locked.height/2);
    assert.equal(await page.evaluate(() => window.tapCalls.length), calls);
    assert.equal(await page.locator('.tap-feedback').count(), 0);
    for (const width of [320,393,430]) {
      await page.setViewportSize({width,height:852});
      // TradingView resizes its canvases through ResizeObserver on the next frame.
      await page.waitForFunction(() => document.documentElement.scrollWidth<=innerWidth);
      assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,w:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})))));
      const dock=await buy.boundingBox(), nav=await page.locator('.tabs').boundingBox();
      assert(dock.y+dock.height<=nav.y, 'controller stays above nav');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: tap bursts, rapid pointer input, keyboard input, exact value ticks, effect cleanup, disabled input, reduced motion, three mobile widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
