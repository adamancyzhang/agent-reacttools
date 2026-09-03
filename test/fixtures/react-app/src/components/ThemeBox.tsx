import { createContext, useContext } from 'react';

export const ThemeContext = createContext('light');
ThemeContext.displayName = 'Theme';

export default function ThemeBox() {
  return (
    <ThemeContext.Provider value="dark">
      <ThemeConsumer />
    </ThemeContext.Provider>
  );
}

function ThemeConsumer() {
  const theme = useContext(ThemeContext);
  return <button id="theme-btn">{theme}</button>;
}
