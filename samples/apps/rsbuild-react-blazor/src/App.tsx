import { useEffect, useRef } from 'react';
import { startBlazor } from './blazor';

export function App() {
  const counterRef = useRef<HTMLElement & { initial: number }>(null);
  const dateTimeRef = useRef<HTMLElement & { initial: Date }>(null);

  useEffect(() => {
    const counter = counterRef.current;
    const dateTime = dateTimeRef.current;
    const onCountChanged = (event: Event) => {
      console.log('[blazor-counter] count changed ->', (event as CustomEvent<number>).detail);
    };

    void startBlazor().then(() => {
      if (counter) {
        counter.addEventListener('countchanged', onCountChanged);
      }
      // DateTime is a complex type: Blazor rejects attributes, and React still
      // writes custom-element props as attributes. Set the JS property instead.
      if (dateTime) {
        dateTime.initial = new Date();
      }
    });

    return () => {
      counter?.removeEventListener('countchanged', onCountChanged);
    };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-stone-50 px-6 py-16 text-stone-800">
      <p className="text-sm text-stone-500">Rsbuild · React</p>
      <h1 className="mt-1 text-lg font-normal">Custom elements in a React page</h1>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <section className="rounded-xl bg-white p-8 ring-1 ring-stone-200">
          <h2 className="text-sm text-stone-500">Counter</h2>
          <div className="mt-4">
            <blazor-counter ref={counterRef} initial={42}></blazor-counter>
          </div>
        </section>
        <section className="rounded-xl bg-white p-8 ring-1 ring-stone-200">
          <h2 className="text-sm text-stone-500">Date / time</h2>
          <div className="mt-4">
            <blazor-date-time-now ref={dateTimeRef}></blazor-date-time-now>
          </div>
        </section>
      </div>
    </main>
  );
}
