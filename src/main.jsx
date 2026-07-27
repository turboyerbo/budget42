import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Announce which build is running. If this line does not change after a deploy,
// the browser is serving a cached bundle and nothing new has actually loaded.
console.log(
  `%c Budget For Two ${__APP_VERSION__} %c built ${__BUILD_ID__} `,
  'background:#1a7a4a;color:#fff;font-weight:600;border-radius:3px 0 0 3px;padding:2px 6px',
  'background:#eceae4;color:#4a4a46;border-radius:0 3px 3px 0;padding:2px 6px'
);
import './index.css';

createRoot(document.getElementById('root')).render(<App />);
