import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initAutoZoom} from './utils/autoZoom';

// App-wide auto-scale for large/wide monitors — see autoZoom.ts. Called
// once here (not per-page/per-component) so it applies everywhere, not
// just on Home.
initAutoZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
