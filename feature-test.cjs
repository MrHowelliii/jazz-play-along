// Practice features, end to end in a real browser against the built site (python3 -m http.server 8765 -d site):
//   BROWSER=chromium node feature-test.cjs
// Covers: instruments preloaded before Play, per-tune tempo memory, count-in and "Solos next" cues, keyboard / pedal
// keys, loop speed-up, stage view, recording a take, my list with auto-advance, room control, offline start.
const pw = require('playwright');
const assert = require('node:assert/strict');
const engine = process.env.BROWSER || 'chromium';
const URL = process.env.SITE || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await pw[engine].launch(engine === 'chromium'
    ? { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {});
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, permissions: engine === 'chromium' ? ['microphone'] : [] });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const loaded = new Set();
    page.on('response', r => { if (/\.(wasm|jbp)(\?|$)/.test(r.url()) && r.ok()) loaded.add(r.url().split('/').pop()); });
    await page.goto(URL + '#play=462jazz-60');
    const $ = s => page.locator(s);
    const text = s => $(s).textContent();
    const button = name => page.getByRole('button', { name, exact: true });
    await $('#player .bar').first().waitFor();

    // 1. the band downloads before anyone presses Play
    await page.waitForFunction(() => true); await page.waitForTimeout(1500);
    assert.equal(loaded.size, 6, 'engine and five instruments preloaded: ' + [...loaded]);

    // 2. tempo from the quick row, remembered for this tune
    const base = +(await $('.in-tempo').inputValue());
    await $('.in-tempo').fill(String(base + 10)); await $('.in-tempo').press('Enter');
    assert.equal(+(await $('.in-tempo').inputValue()), base + 10);
    await page.reload(); await $('#player .bar').first().waitFor();
    assert.equal(+(await $('.in-tempo').inputValue()), base + 10, 'tempo remembered per tune');
    await page.goto(URL + '#play=462jazz-83'); await page.reload(); await $('#player .bar').first().waitFor();
    assert.notEqual(await text('.song-head h2'), 'Autumn Leaves');
    await page.goto(URL + '#play=462jazz-60'); await page.reload(); await $('#player .bar').first().waitFor();

    // 3. count-in shown big, then gone
    await $('.in-role-q').selectOption('lead');
    await button('Play').click();
    await $('.pl-cue.count').waitFor({ timeout: 30000 });
    assert.match(await text('.pl-cue'), /^[1-4]$/);
    await page.waitForFunction(() => document.querySelector('.pl-status')?.textContent.includes('Chorus'));
    await page.waitForFunction(() => document.querySelector('.pl-cue').hidden);

    // 4. keys: tempo, pause, stop
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const t0 = +(await $('.in-tempo').inputValue());
    await page.keyboard.press('ArrowUp'); assert.equal(+(await $('.in-tempo').inputValue()), t0 + 5);
    await page.keyboard.press('Shift+ArrowDown'); assert.equal(+(await $('.in-tempo').inputValue()), t0 + 4);
    await page.keyboard.press('PageDown'); await button('Resume').waitFor();
    await page.keyboard.press('ArrowRight'); await button('Pause').waitFor();
    await page.keyboard.press('PageUp'); await button('Play').waitFor();

    // 5. a two-bar loop that speeds up each pass, and the tempo coming back at Stop
    await button('Setup').click();
    await $('.in-pass').selectOption('8'); await $('.in-tempo').fill('300'); await $('.in-tempo').press('Enter');
    await button('Score').click();
    await $('.bar[data-src="4"]').click(); await $('.bar[data-src="5"]').click({ modifiers: ['Shift'] });
    await button('Loop').click();
    await button('Play').click();
    await page.waitForFunction(() => /Loop pass 3/.test(document.querySelector('.pl-status')?.textContent), null, { timeout: 30000 });
    assert.equal(+(await $('.in-tempo').inputValue()), 316, 'two passes at +8');
    await button('Stop').click();
    assert.equal(+(await $('.in-tempo').inputValue()), 300, 'tempo restored after the loop');
    await button('Loop on').click(); await button('Clear selection').click();

    // 6. "Solos next" a bar before the melody drops out (3 choruses: head, solos, head)
    await button('Setup').click(); await $('.in-chor').selectOption('3'); await $('.in-tempo').fill('320'); await $('.in-tempo').press('Enter'); await button('Score').click();
    await button('Play').click();
    await page.waitForFunction(() => document.querySelector('.pl-cue')?.textContent === 'Solos next', null, { timeout: 60000 });
    assert.match(await text('.pl-status'), /Chorus 1 of 3/);

    // 7. stage view: big chart, the line being played at the top
    const h0 = (await $('.bar.now').boundingBox()).height;
    await button('Stage').click();
    assert.ok(await page.evaluate(() => document.body.classList.contains('stage')));
    await page.waitForFunction(() => document.querySelector('.bar.now'));
    await page.waitForTimeout(700);
    const now = await $('.bar.now').boundingBox(), view = await $('.pl-view').boundingBox();
    assert.ok(now.height > h0 * 1.15, `stage bars are larger (${h0} -> ${now.height})`);
    assert.ok(Math.abs(now.y - view.y) < 12, 'current line at the top of the stage');
    assert.ok(await $('.song-head h2').isHidden());
    await page.keyboard.press('s');
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('stage'))));
    await button('Stop').click();

    // 8. record a take (band + microphone), listen back in Setup
    await button('● Rec').click();
    await button('■ Save take').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.pl-status')?.textContent.includes('Chorus'));
    await page.waitForTimeout(2500);
    await button('■ Save take').click();
    await button('● Rec').waitFor();
    await button('Stop').click();
    await button('Setup').click();
    const size = await page.evaluate(async () => (await (await fetch(document.querySelector('.take audio').src)).blob()).size);
    assert.ok(size > 4000, 'a take was recorded: ' + size + ' bytes');
    assert.match(await $('.take a').getAttribute('download'), /Autumn Leaves take 1\./);

    // 9. room control and speaker delay are kept
    await button('Mixer').click();
    await $('.in-room').fill('30');
    await button('Setup').click(); await $('.in-latency').fill('120'); await $('.in-latency').press('Enter');
    assert.deepEqual(await page.evaluate(() => { const s = JSON.parse(localStorage['playalong.settings']); return [s.room, s.latency, s.passStep]; }), [30, 120, 8]);
    await $('.in-latency').fill('0'); await $('.in-latency').press('Enter'); await $('.in-pass').selectOption('0');

    // 10. my list: star two tunes, play the list in order
    await $('.in-chor').selectOption('1'); await button('Score').click();
    await button('Add to my list').click();
    await button('Songs').click();
    await page.getByPlaceholder('Song title or composer…').fill('blue bossa'); await $('.play-badge').first().click();
    await $('#player .bar').first().waitFor();
    await button('Add to my list').click();
    await button('Songs').click();
    assert.deepEqual(await $('#my-list .ml-title').allTextContents(), ['1. Autumn Leaves', '2. Blue Bossa']);
    await $('#auto-next').check();
    await $('#my-list .ml-title').first().click();
    assert.equal(await text('.song-head h2'), 'Autumn Leaves');
    await button('Play').click();
    await page.waitForFunction(() => document.querySelector('.song-head h2')?.textContent === 'Blue Bossa'
      && /Count-in|Chorus/.test(document.querySelector('.pl-status')?.textContent), null, { timeout: 120000 });
    await button('Stop').click();

    // 11. offline: the app, the library and the band come from the service worker
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => (await caches.keys()).length && (await (await caches.open((await caches.keys())[0])).keys()).length >= 15, null, { timeout: 60000 });
    await context.setOffline(true);
    await page.reload(); await $('#player .bar').first().waitFor({ timeout: 30000 });
    await button('Play').click();
    await page.waitForFunction(() => document.querySelector('.pl-status')?.textContent.includes('Chorus'), null, { timeout: 30000 });
    await button('Stop').click();
    await context.setOffline(false);

    // 12. phone widths: nothing wider than the screen, quick controls reachable
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size); await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll at ' + size.width);
      const dock = await $('.dock').boundingBox();
      assert.ok(dock.y + dock.height <= size.height + 1, 'dock on screen at ' + size.width + 'x' + size.height);
    }
    assert.deepEqual(errors, []);
    console.log(`${engine}: preload, tune memory, cues, keys, loop speed-up, stage, recording, my list, offline and phone widths passed.`);
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
