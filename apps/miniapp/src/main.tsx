import React from 'react';
import { createRoot } from 'react-dom/client';
import '@pdr/ui/styles.css';
import './app/app.css';
import { initTelegram } from './shared/telegram';
import { App } from './app/App';

initTelegram();

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
