import { useEffect, useRef } from 'react';
import { startBlazor } from './blazor';

export function App() {
  const counterRef = useRef<HTMLElement & { initial: number }>(null);
  const dateTimeRef = useRef<HTMLElement & { initial: string }>(null);

  useEffect(() => {
    const counter = counterRef.current;
    const onCountChanged = (event: Event) => {
      console.log('[blazor-counter] count changed ->', (event as CustomEvent<number>).detail);
    };

    void startBlazor().then(() => {
      if (counter) {
        counter.addEventListener('countchanged', onCountChanged);
      }
    });

    return () => {
      counter?.removeEventListener('countchanged', onCountChanged);
    };
  }, []);

  return (
    <>
      <h1>Blazor WebAssembly, rendered inside a React app</h1>
      <section>
        <h2>Counter</h2>
        <blazor-counter ref={counterRef} initial={42}></blazor-counter>
      </section>
      <section>
        <h2>Date / time</h2>
        <blazor-date-time-now
          ref={dateTimeRef}
          initial={new Date().toISOString()}
        ></blazor-date-time-now>
      </section>
    </>
  );
}
