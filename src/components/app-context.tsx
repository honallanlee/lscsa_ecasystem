'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Routes } from '../lib/service.ts';

const Ctx = createContext<Routes['bootstrap'] | null>(null);
export const AppProvider = ({ value, children }: { value: Routes['bootstrap']; children: ReactNode }) => <Ctx value={value}>{children}</Ctx>;
export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider is missing.');
  return v;
}
