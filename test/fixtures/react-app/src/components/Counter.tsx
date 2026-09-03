import { useMemo, useState } from 'react';

interface CounterProps {
  step: number;
  count: number;
  label: string;
}

export default function Counter({ step, count, label }: CounterProps) {
  const [local, setLocal] = useState(7);
  const doubled = useMemo(() => count * 2, [count]);
  return (
    <div id="counter-box">
      <span id="counter-doubled">{doubled}</span>
      <button id="counter-inc" onClick={() => setLocal(local + step)}>
        {label} {count} ({local})
      </button>
    </div>
  );
}
