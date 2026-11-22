'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="landing"><h1>This page could not load</h1><p className="lede">The database may still be waking up, or it is not connected yet.</p><button className="btn" onClick={reset}>Try again</button></main>;
}
