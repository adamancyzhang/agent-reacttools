import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import OtherApp from './OtherApp';

// #app wraps the tree in StrictMode like a real app; #app2 is plain.
createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
createRoot(document.getElementById('app2')!).render(<OtherApp />);
