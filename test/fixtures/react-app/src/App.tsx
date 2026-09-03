import { useMemo, useState } from 'react';
import ClassBox from './components/ClassBox';
import Counter from './components/Counter';
import HelloWorld from './components/HelloWorld';
import ItemList from './components/ItemList';
import MultiRoot from './components/MultiRoot';
import ThemeBox from './components/ThemeBox';

export default function App() {
  const [title] = useState('agent-reacttools fixture');
  const [count, setCount] = useState(3);
  const doubled = useMemo(() => count * 2, [count]);
  return (
    <div id="app-root" className="app-shell">
      <h1>{title}</h1>
      <p id="doubled">doubled: {doubled}</p>
      <button id="count-btn" onClick={() => setCount(count + 1)}>
        Count
      </button>
      <Counter step={1} count={count} label="Count" />
      <HelloWorld greeting="Hi" />
      <ItemList items={['alpha', 'beta', 'gamma']} />
      <MultiRoot />
      <ClassBox />
      <ThemeBox />
    </div>
  );
}
