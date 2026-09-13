import { jsx as _jsx } from "react/jsx-runtime";
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './queryClient';
import { router } from './router';
export function App() {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(RouterProvider, { router: router }) }));
}
//# sourceMappingURL=App.js.map