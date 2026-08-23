import { useEffect, useRef, useState } from 'react';
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

export function App() {
  const [count, setCount] = useState(0);
  const counterRef = useRef<Counter | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const runtime = await dotnet.create();
      runtime.runMain();
      if (cancelled) return;
      const counter = new Counter(0);
      counterRef.current = counter;
      setCount(counter.Value);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function increment(): void {
    const counter = counterRef.current;
    if (!counter) return;
    counter.Increment();
    setCount(counter.Value);
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-16">
      <div className="rounded-xl bg-white p-8 ring-1 ring-stone-200">
        <p className="text-sm text-stone-500">Farm · React</p>
        <p className="mt-4 text-5xl font-light tabular-nums">{count}</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-900"
          onClick={increment}
        >
          Increment
        </button>
      </div>
    </main>
  );
}
