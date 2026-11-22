'use client';
import { useEffect, useRef, useState } from 'react';
import { createGate } from '../lib/scan.ts';
import { signal } from './signal.ts';

/** What a screen says back about a scan. `retry` means "not now": the same code may be tried again at once. */
export type ScanReply = { ok: boolean; message: string; retry?: boolean };

function cameraProblem(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'The camera is blocked. Allow it for this site in your browser’s settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  return 'The camera could not start. You can still type the number.';
}

/** The camera box. It sits in the page rather than over it, so the form stays usable underneath. */
export function ScanPanel({ hint, onScan, onClose }: { hint: string; onScan: (text: string) => Promise<ScanReply> | ScanReply; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null), handler = useRef(onScan), trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [reply, setReply] = useState<ScanReply | null>(null), [torch, setTorch] = useState<boolean | null>(null), [attempt, setAttempt] = useState(0);
  handler.current = onScan;

  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, stream: MediaStream | undefined;
    const gate = createGate();
    setError(''); setReady(false); setTorch(null);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setError('The camera only works over a secure (https) address. You can still type the number.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        const media = stream;
        if (stopped) { media.getTracks().forEach(t => t.stop()); return; }
        const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
        if (stopped) return;
        prepareZXingModule({ overrides: { locateFile: (f: string) => '/wasm/' + f } });
        const track = media.getVideoTracks()[0]!, el = video.current!;
        trackRef.current = track;
        track.addEventListener('ended', () => { if (!stopped) setError('The camera was interrupted.'); });
        const can = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
        if (can.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        el.srcObject = media;
        await el.play();
        if (stopped) return;
        setReady(true);
        if (can.torch) setTorch(false);

        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        let lastRead = performance.now();
        const look = async () => {
          if (stopped) return;
          try {
            if (!document.hidden && el.videoWidth) {
              // Only the aiming area is read: faster, and nearby codes are not picked up by accident.
              const w = el.videoWidth, h = el.videoHeight, shown = el.clientWidth / el.clientHeight;
              const vw = Math.min(w, h * shown), vh = Math.min(h, w / shown);
              const sw = vw * 0.9, sh = vh * 0.7, scale = Math.min(1, 1600 / sw);
              canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
              ctx.drawImage(el, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
              const found = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: ['Code39', 'Code128', 'QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
              const text = found.find(r => r.isValid && r.text)?.text;
              if (text) lastRead = performance.now();
              else if (!stopped && performance.now() - lastRead > 5000) { lastRead = performance.now(); setReply({ ok: true, message: 'Hold steady and fill the box with the code.' }); }
              if (!stopped && text && text.length <= 64 && gate.push(text, performance.now())) {
                const r = await handler.current(text);
                if (r.retry) gate.release(text); else signal(r.ok);
                if (!stopped) setReply(r);
              }
            }
          } catch (e) { console.warn('scan', e); }
          if (!stopped) timer = setTimeout(look, 90);
        };
        void look();
      } catch (e) {
        stream?.getTracks().forEach(t => t.stop());
        if (!stopped) setError(cameraProblem(e));
      }
    }
    void start();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); trackRef.current = null; };
  }, [attempt]);

  async function light() {
    const on = !torch;
    try { await trackRef.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); setTorch(on); } catch { setTorch(null); }
  }
  return (
    <section className="camera" aria-label="Camera scanner">
      <div className="lens" hidden={Boolean(error)}>
        <div className="tools">
          {torch !== null && <button type="button" aria-pressed={torch} onClick={light}>{torch ? 'Light off' : 'Light on'}</button>}
          <button type="button" onClick={onClose}>Close camera</button>
        </div>
        <video ref={video} muted playsInline aria-hidden />
        {ready && !error && <span className="aim" aria-hidden />}
        <p className={'say' + (reply ? (reply.ok ? ' good' : ' bad') : '')} role="status">{error ? '' : reply?.message ?? (ready ? hint : 'Starting the camera…')}</p>
      </div>
      {error && <><p className="notice bad" role="alert">{error}</p><div className="row"><button className="btn quiet" type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button><button className="btn quiet" type="button" onClick={onClose}>Close camera</button></div></>}
    </section>
  );
}
