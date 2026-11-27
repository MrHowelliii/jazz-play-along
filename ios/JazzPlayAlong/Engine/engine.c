/* engine.c - the Jazz Band engine for iOS: jb_web.c (the same C the web app runs as WebAssembly) built natively,
 * an audio callback that renders it in 128-frame blocks under a lock, and MIDI out of the routed parts, timed to the
 * moment each note is heard. */
#include "jb_web.c"                                     /* engine.h (for Swift) is not included: it
                                                         * declares a few engine pointers as void * */
#include <CoreMIDI/CoreMIDI.h>
#include <stdatomic.h>
#include <mach/mach_time.h>

static atomic_flag lk = ATOMIC_FLAG_INIT;
void eng_lock(void) { while (atomic_flag_test_and_set_explicit(&lk, memory_order_acquire)) { } }
void eng_unlock(void) { atomic_flag_clear_explicit(&lk, memory_order_release); }

static float bufL[128], bufR[128];
static int bufPos = 128;
static volatile int paused;
void eng_set_paused(int p) { paused = p; }

static MIDIPortRef mport; static MIDIEndpointRef mdest; static int mch;
void eng_set_midi_out(MIDIPortRef port, MIDIEndpointRef dest, int channel) {
    eng_lock(); mport = port; mdest = dest; mch = (channel - 1) & 15; eng_unlock();
}
static double ticks_per_sample;                         /* mach ticks per 44.1 kHz sample */
static uint64_t latency_ticks;                          /* from a render call's time stamp to the speaker */
void eng_set_latency(double seconds) {
    mach_timebase_info_data_t tb; mach_timebase_info(&tb); latency_ticks = (uint64_t)(seconds * 1e9 * tb.denom / tb.numer);
}
static void midi_send3(uint64_t t, uint8_t a, uint8_t b, uint8_t c, int n) {
    Byte mem[64]; MIDIPacketList *pl = (MIDIPacketList *)mem; MIDIPacket *p = MIDIPacketListInit(pl);
    Byte d[3] = {a, b, c};
    if (MIDIPacketListAdd(pl, sizeof mem, p, (MIDITimeStamp)t, n, d)) MIDISend(mport, mdest, pl);
}
void eng_midi_transport(int start) {
    if (!mdest) return;
    if (start) midi_send3(0, 0xFA, 0, 0, 1);
    else { midi_send3(0, 0xB0 | mch, 123, 0, 3); midi_send3(0, 0xFC, 0, 0, 1); }
}
/* after each engine block: its MIDI events, at host time t0 for the block's first sample */
static void send_events(uint64_t t0) {
    int n = mq_n; if (!n || !mdest) return;
    for (int i = 0; i < n; i++) {
        const mev_t *m = &MQ[i];
        uint64_t t = t0 + (uint64_t)(m->delay * ticks_per_sample);
        if (m->kind == 1) { midi_send3(t, 0xF8, 0, 0, 1); continue; }
        midi_send3(t, 0x90 | mch, m->note, m->vel, 3);
        int len = m->len > 1300 ? m->len - 350 : 1000;    /* a few ms short of the next note */
        midi_send3(t + (uint64_t)(len * ticks_per_sample), 0x80 | mch, m->note, 0, 3);
    }
}
void eng_warm_up(int blocks) { eng_lock(); for (int i = 0; i < blocks; i++) jbw_render(); eng_unlock(); bufPos = 128; }
void eng_render(float *left, float *right, int frames, uint64_t host_time) {
    if (ticks_per_sample == 0) { mach_timebase_info_data_t tb; mach_timebase_info(&tb); ticks_per_sample = 1e9 / 44100.0 * tb.denom / tb.numer; }
    if (paused) { for (int i = 0; i < frames; i++) left[i] = right[i] = 0; return; }
    eng_lock();
    for (int i = 0; i < frames; i++) {
        if (bufPos >= 128) {
            jbw_render();
            for (int k = 0; k < 128; k++) { bufL[k] = OUTL[k]; bufR[k] = OUTR[k]; }
            bufPos = 0;
            if (host_time) send_events(host_time + latency_ticks + (uint64_t)(i * ticks_per_sample));
        }
        left[i] = bufL[bufPos]; right[i] = bufR[bufPos]; bufPos++;
    }
    eng_unlock();
}
