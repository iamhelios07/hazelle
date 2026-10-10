import { useState } from 'react';
import type { BackupWarning } from '../../contracts/admin';
import { readService, type Report } from '../../runtime/admin';
import { ACTS } from '../common/acts';
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
import { useLoaded } from '../common/useLoaded';
import { useAccounts } from './useAccounts';
import { UsageSection } from './UsageSection';

const WARNINGS: Record<BackupWarning, string> = {
  'backup-stale': '백업이 36시간 넘게 없음',
  'disk-full': '디스크 80% 초과',
};

// Every act lands in the log, which is asked again after one. Only the changed account's row is asked again;
// whole-service usage is refreshed separately by the operator.
export function AdminScreen({ back }: { back: Back | null }) {
  const service = useLoaded(readService);
  const accounts = useAccounts();
  const [acts, setActs] = useState(0);
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const acted = () => setActs((count) => count + 1);
  const actedOnAccount = (id?: string) => {
    if (id) void accounts.refresh(id).then((removed) => { if (removed) service.reload(); });
    acted();
  };
  return (
    <Screen width="form" top={<NavBar title={PAGES.admin} {...backBar(back)} />}>
      {service.data?.warnings.map((warning) => <Callout key={warning} tone="warn" alert>{WARNINGS[warning]}</Callout>)}
      {service.failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: service.reload }}>{service.failure}</Callout>}
      {service.data && <ServiceSection service={service.data} onSaved={() => { service.reload(); acted(); }} onNoticed={acted} />}
      <UsageSection />
      <AccountsSection loaded={accounts} onActed={actedOnAccount} onRestores={(account) => setRestoring({ ...account, report: null })} />
      <ReportsSection onActed={acted} onRestore={(report: Report) => setRestoring({ accountId: report.accountId, username: report.username, report })} />
      <FileSection onActed={acted} />
      <LogSection key={acts} />
      {restoring && <RestoresDialog key={restoring.accountId} restoring={restoring} onClose={() => setRestoring(null)} onActed={() => actedOnAccount(restoring.accountId)} />}
    </Screen>
  );
}
