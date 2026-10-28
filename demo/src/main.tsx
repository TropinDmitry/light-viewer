import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineLuminaireViewer } from '../../src/index';
import { App } from './App';
import './styles.css';

defineLuminaireViewer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
