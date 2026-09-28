import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountFlow } from './account/AccountFlow';
import { Workspace } from './shell/Workspace';
import './ui/foundation/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <AccountFlow>{(unlocked) => <Workspace {...unlocked} />}</AccountFlow>
  </StrictMode>,
);
