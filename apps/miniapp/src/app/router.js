import { jsx as _jsx } from "react/jsx-runtime";
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';
export const router = createBrowserRouter([
    {
        path: '/',
        element: _jsx(RootLayout, {}),
        children: [
            { index: true, element: _jsx(Navigate, { to: "/learning", replace: true }) },
            {
                path: 'learning',
                element: _jsx(PlaceholderScreen, { title: "\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435", hint: "\u0420\u0430\u0437\u0434\u0435\u043B \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043D\u0430 \u044D\u0442\u0430\u043F\u0435 6" }),
            },
            {
                path: 'workspace',
                element: _jsx(PlaceholderScreen, { title: "\u041C\u0430\u0441\u0442\u0435\u0440\u0441\u043A\u0430\u044F", hint: "\u0420\u0430\u0437\u0434\u0435\u043B \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043D\u0430 \u044D\u0442\u0430\u043F\u0435 9" }),
            },
            {
                path: 'profile',
                element: _jsx(PlaceholderScreen, { title: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C", hint: "\u0420\u0430\u0437\u0434\u0435\u043B \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043D\u0430 \u044D\u0442\u0430\u043F\u0435 1" }),
            },
            { path: '*', element: _jsx(PlaceholderScreen, { title: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" }) },
        ],
    },
]);
//# sourceMappingURL=router.js.map