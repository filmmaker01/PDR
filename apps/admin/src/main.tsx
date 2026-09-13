import React from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
