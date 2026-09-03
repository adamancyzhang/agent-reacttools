import { useState } from 'react';

export default function OtherApp() {
  const [msg] = useState('second app');
  return <div id="other-app">{msg}</div>;
}
