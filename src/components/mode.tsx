'use client';
import { useSyncExternalStore } from 'react';

// Computer: keyboard and handheld scanner, no camera. Phone: adds the camera, and keeps the on-screen keyboard down.
export type Mode = 'computer' | 'phone';
const KEY = 'eca-mode', listeners = new Set<() => void>();
let chosen: Mode | null | undefined;

function current(): Mode {
  if (chosen === undefined) {
    try { const v = localStorage.getItem(KEY); chosen = v === 'computer' || v === 'phone' ? v : null; } catch { chosen = null; }
  }
  return chosen ?? (matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer');
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useMode = () => useSyncExternalStore(subscribe, current, (): Mode => 'computer');
export const isComputer = () => current() === 'computer';

export function ModeSwitch() {
  const mode = useMode(), other: Mode = mode === 'computer' ? 'phone' : 'computer';
  function change() {
    chosen = other;
    try { localStorage.setItem(KEY, other); } catch { /* remembered until the page closes */ }
    listeners.forEach(fn => fn());
  }
  return <p>{mode === 'computer' ? 'Computer mode: keyboard or handheld scanner.' : 'Phone mode: camera scanning is on.'} <button className="link" onClick={change}>Switch to {other} mode</button></p>;
}
