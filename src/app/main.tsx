import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountFlow } from './account/AccountFlow';
import { legalPage } from './common/LegalPage';
import { ScreenLoad } from './common/ScreenLoad';
import { watchProblems } from '../runtime/diagnostics';
import { applyStoredScheme } from './display';
import { sharePage } from './share/SharePage';
import { markScrollbars } from './ui';
import './ui/foundation/global.css';

const Workspace = lazy(() => import('./shell/Workspace').then(({ Workspace }) => ({ default: Workspace })));

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

watchProblems();
applyStoredScheme();
markScrollbars();

createRoot(root).render(
  <StrictMode>
    {legalPage(location.pathname) ?? sharePage(location.pathname, location.hash) ?? <AccountFlow>{(unlocked) => <ScreenLoad><Workspace {...unlocked} /></ScreenLoad>}</AccountFlow>}
  </StrictMode>,
);

// Fonts may replace the system faces after paint, but a slow stylesheet must never hold the first screen.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void import('./ui/foundation/fonts.css').catch(() => {});
}));
