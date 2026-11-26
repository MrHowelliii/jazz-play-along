const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('web/jazzband.wasm'), {});
  const x = instance.exports;
  const heap = new Uint8Array(x.memory.buffer);
  x.jbw_init();
  for (const name of ['jbdrums','jbbass','jbpiano','jbguitar','jbgtrlead']) {
    const bytes = fs.readFileSync('web/packs/' + name + '.jbp');
    const pointer = x.jbw_alloc(bytes.length);
    assert.ok(pointer);
    heap.set(bytes, pointer);
    x.jbw_add_pack(pointer);
  }
  for (let i = 0; i < 1500; i++) x.jbw_render();
  for (let i = 0; i < 4; i++) {
    assert.equal(x.jbw_pack_ok(i), 1);
    x.jbw_level(i, 1);
  }
  x.jbw_load(8, 4, 120, 0);
  // A sustained middle C in measure seven. The other measures have no melody.
  heap.set([6,0,0,0,180,0,60,105], x.jbw_lead_buf());
  x.jbw_lead_set(1,0);
  x.jbw_play(-1);
  function levelAfterSeek(measure) {
    x.jbw_seek(measure);
    assert.equal(x.jbw_bar(), measure);
    let energy = 0;
    for (let block = 0; block < 100; block++) {
      x.jbw_render();
      for (const sample of new Float32Array(x.memory.buffer, x.jbw_out_l(), 128)) {
        energy += sample * sample;
      }
    }
    return Math.sqrt(energy / 12800);
  }
  for (const [id,name] of [[4,'muted trumpet'],[1,'grand piano'],[2,'archtop guitar'],[5,'upright bass']]) {
    x.jbw_lead_sound(id, 30000, 0);
    const quiet = levelAfterSeek(4);
    const audible = levelAfterSeek(6);
    assert.ok(audible > Math.max(.0005, quiet * 5), name + ' sample RMS ' + audible + ' vs rest ' + quiet);
    console.log(name + ' melody rendered at the tapped bar, RMS ' + audible.toFixed(4));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
