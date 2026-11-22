'use client';
let audio: AudioContext | undefined;
/** A short high beep for yes, a low one for no, plus a buzz where the device supports it. */
export function signal(ok: boolean) {
  try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ok ? 60 : [60, 60, 60]); } catch { /* not supported */ }
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1100 : 300;
    g.gain.setValueAtTime(0.12, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.16);
  } catch { /* sound is optional */ }
}
