import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initAutoZoom} from './utils/autoZoom';
import {DialogProvider} from './contexts/DialogContext';

// App-wide auto-scale for large/wide monitors — see autoZoom.ts. Called
// once here (not per-page/per-component) so it applies everywhere, not
// just on Home.
initAutoZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Mounted once at the root (not inside App) so every component in the
        tree — App itself included — can call useDialog() with no prop
        drilling. See DialogContext.tsx's header comment. */}
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
);
