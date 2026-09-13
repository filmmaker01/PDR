import { jsx as _jsx } from 'react/jsx-runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@pdr/ui/styles.css';
import './app/app.css';
import { initTelegram } from './shared/telegram';
import { App } from './app/App';
initTelegram();
const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент');
createRoot(container).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
//# sourceMappingURL=main.js.map
