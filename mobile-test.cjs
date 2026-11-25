const { webkit } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
    const page = await context.newPage();
    page.on('pageerror', e=>console.error(e.message));
    await page.goto('http://127.0.0.1:8765', {waitUntil:'domcontentloaded'});
    const button = name => page.getByRole('button', {name,exact:true});
    await button('▶ Play').tap();
    await button('Stop').waitFor({timeout:30000});
    const status = page.locator('.pl-status');
    await page.waitForFunction(()=>document.querySelector('.pl-status')?.textContent.includes('Chorus'));
    await page.waitForFunction(()=>document.querySelector('.bar.now')?.dataset.src === '2' && document.querySelector('.bar.now .beat')?.style.left==='0%');
    await button('Pause').tap();
    const pausedBar = await status.textContent();
    const beatPosition = () => page.locator('.bar.now').evaluate(el => [el.dataset.src,el.querySelector('.beat')?.style.left]);
    // Allow the already-buffered visual beat to settle before measuring.
    await page.waitForTimeout(250);
    const pausedBeat = await beatPosition();
    await page.waitForTimeout(2400);
    assert.equal(await status.textContent(),pausedBar);
    assert.deepEqual(await beatPosition(),pausedBeat);
    assert.ok(await page.locator('.pl-output').evaluate(el => el.value < -85));
    await button('Resume').tap();
    await page.waitForFunction(old => document.querySelector('.bar.now .beat')?.style.left !== old, pausedBeat[1]);
    assert.equal(await status.textContent(),pausedBar);
    await button('Mixer').tap();
    const next = button('Next Bass sound');
    const bass = page.getByRole('slider',{name:'Bass level'});
    const position = () => bass.evaluate(e=>[window.scrollY,e.getBoundingClientRect().top,e.closest('.panel').scrollTop]);
    const before = await position(), initialBar = await status.textContent();
    await next.tap();
    const box = await bass.boundingBox();
    await page.touchscreen.tap(box.x+box.width*.35,box.y+box.height/2);
    assert.notEqual(await bass.inputValue(),'100');
    assert.equal(await page.getByRole('combobox',{name:'Bass player'}).inputValue(),'1');
    await page.waitForFunction(old=>document.querySelector('.pl-status').textContent!==old,initialBar);
    assert.deepEqual(await position(),before);
    await button('Score').tap();
    await button('Songs').tap();
    await page.getByPlaceholder('Song title or composer…').fill('Autumn');
    await button('← Back to tune').tap();
    await button('Pause').tap();
    await button('Stop').tap();
    await button('▶ Play').waitFor();
    for(const size of [{width:320,height:568},{width:844,height:390},{width:1024,height:768}]){
      await page.setViewportSize(size);
      await button('Mixer').tap();
      const rect=await button('Setup').boundingBox();
      assert.ok(rect.y>=0 && rect.y+rect.height<=size.height+1 && rect.x+rect.width<=size.width+1);
      await button('Setup').tap();
    }
    console.log('WebKit touch playback, mixer stability, song navigation and three additional viewports passed.');
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});

