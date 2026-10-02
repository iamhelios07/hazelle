import { useState } from 'react';
import { readAccounts, readService, type Report } from '../../runtime/admin';
import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Callout, NavBar, Screen } from '../ui';
import { AccountsSection } from './AccountsSection';
import { FileSection } from './FileSection';
import { LogSection } from './LogSection';
import { ReportsSection } from './ReportsSection';
import { RestoresDialog, type Restoring } from './RestoresDialog';
import { ServiceSection } from './ServiceSection';
import { useLoaded } from './useLoaded';

// 운영: the operator's tools. Every act lands in the log, which is asked again after one. The accounts are asked again
// only after an act on an account: reading them calls every account's store.
export function AdminScreen({ back }: { back: Back | null }) {
  const service = useLoaded(readService);
  const accounts = useLoaded(readAccounts);
  const [acts, setActs] = useState(0);
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const acted = () => {
    service.reload();
    setActs((count) => count + 1);
  };
  const actedOnAccount = () => {
    accounts.reload();
    acted();
  };
  return (
    <Screen width="form" top={<NavBar title={PAGES.admin} {...backBar(back)} />}>
      {service.failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: service.reload }}>{service.failure}</Callout>}
      {service.data && <ServiceSection service={service.data} onSaved={acted} />}
      <AccountsSection loaded={accounts} onActed={actedOnAccount} onRestores={(account) => setRestoring({ ...account, report: null })} />
      <ReportsSection onActed={acted} onRestore={(report: Report) => setRestoring({ accountId: report.accountId, username: report.username, report })} />
      <FileSection onActed={acted} />
      <LogSection key={acts} />
      {restoring && <RestoresDialog key={restoring.accountId} restoring={restoring} onClose={() => setRestoring(null)} onActed={actedOnAccount} />}
    </Screen>
  );
}
