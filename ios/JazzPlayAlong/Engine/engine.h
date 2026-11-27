/* engine.h - the Jazz Band engine (jazzband-op1r web/jb_web.c, built natively) and the iOS glue around it (engine.c).
 * Swift calls these through the bridging header. Every jbw_* call that changes the band must sit between eng_lock()
 * and eng_unlock(): the audio thread renders under the same lock. */
#ifndef JPA_ENGINE_H
#define JPA_ENGINE_H
#include <stdint.h>
#include <CoreMIDI/CoreMIDI.h>

/* the engine (jb_web.c) */
void jbw_init(void);
int jbw_add_pack_file(const uint8_t *file, uint32_t n);
int jbw_pack_ok(int inst);
uint8_t *jbw_bars(void);
void jbw_load(int nbars, int beats, int bpm, int feel);
void jbw_play(int from_bar);
void jbw_stop(void);
void jbw_finish(void);
void jbw_tempo(int bpm);
void jbw_feel(int feel);
void jbw_trade(int bars);
void jbw_transpose(int semis);
void jbw_level(int inst, int q15);
void jbw_form(int choruses, int ending, int intro, int turn);
int jbw_state(void);
int jbw_bar(void);
void jbw_human(int amount);
void *jbw_lead_buf(void);
void *jbw_pick_buf(void);
int jbw_lead_max(void);
void jbw_lead_set(int n, int npick);
void jbw_lead_mask(uint32_t m);
void jbw_lead_sound(int s, int level, int oct);
void jbw_midi_route(int mask, int clock);
void jbw_render(void);

/* glue (engine.c) */
void eng_lock(void);
void eng_unlock(void);
void eng_warm_up(int blocks);                       /* render without output: the packs' checksums run */
/* the audio callback: frames of stereo float at 44.1 kHz; host_time: when the first frame is heard (mach ticks) */
void eng_render(float *left, float *right, int frames, uint64_t host_time);
void eng_set_paused(int paused);
void eng_set_latency(double seconds);               /* output latency, for timing MIDI out */
/* MIDI out: the parts routed with jbw_midi_route go to this destination as notes on this channel (1..16), and MIDI
 * clock if routed; 0 for no destination */
void eng_set_midi_out(MIDIPortRef port, MIDIEndpointRef dest, int channel);
void eng_midi_transport(int start);                 /* MIDI start (1) or stop and all notes off (0), now */
#endif
