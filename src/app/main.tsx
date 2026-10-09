import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountFlow } from './account/AccountFlow';
import { legalPage } from './common/LegalPage';
import { ScreenLoad } from './common/ScreenLoad';
import { applyStoredTheme } from './display';
import './ui/foundation/global.css';

const Workspace = lazy(() => import('./shell/Workspace').then(({ Workspace }) => ({ default: Workspace })));

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

applyStoredTheme();

createRoot(root).render(
  <StrictMode>
    {legalPage(location.pathname) ?? <AccountFlow>{(unlocked) => <ScreenLoad><Workspace {...unlocked} /></ScreenLoad>}</AccountFlow>}
  </StrictMode>,
);
