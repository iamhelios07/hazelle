import { useState } from 'react';
import type { BackupWarning } from '../../contracts/admin';
import { readService } from '../../runtime/admin';
import { ACTS } from '../common/acts';
import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Beside, Callout, NavBar, Screen } from '../ui';
import { AccountsSection } from './AccountsSection';
import { FileSection } from './FileSection';
import { LogSection } from './LogSection';
import { ReportsSection, type AccountReport } from './ReportsSection';
import { ShareSection } from './ShareSection';
import { RestoresDialog, type Operated } from '../common/RestoresDialog';
import { ServiceSection } from './ServiceSection';
import { useLoaded } from '../common/useLoaded';
import { moderates } from './moderation';
import { useAccounts } from './useAccounts';
import { UsageSection } from './UsageSection';

const WARNINGS: Record<BackupWarning, string> = {
  'backup-stale': '백업이 36시간 넘게 없음',
  'disk-full': '디스크 80% 초과',
};

// Every act lands in the log, which is asked again after one. Only the changed account's row is asked again;
// whole-service usage is refreshed separately by the operator; with one person it would repeat that person's row. A
// failed service read shows every section: it cannot tell that nothing waits in them.
export function AdminScreen({ back }: { back: Back | null }) {
  const service = useLoaded(readService);
  const accounts = useAccounts();
  const [acts, setActs] = useState(0);
  const [restoring, setRestoring] = useState<Operated | null>(null);
  const acted = () => setActs((count) => count + 1);
  const moderating = service.data ? moderates(service.data) : service.failure !== null;
  const shared = service.data ? service.data.people > 1 : service.failure !== null;
  const actedOnAccount = (id?: string) => {
    if (id) void accounts.refresh(id).then((removed) => { if (removed) service.reload(); });
    acted();
  };
  return (
    <Screen width="page" top={<NavBar title={PAGES.admin} {...backBar(back)} />}>
      {service.data?.warnings.map((warning) => <Callout key={warning} tone="warn" alert>{WARNINGS[warning]}</Callout>)}
      {service.failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: service.reload }}>{service.failure}</Callout>}
      {service.data && <ServiceSection service={service.data} onSaved={() => { service.reload(); acted(); }} onNoticed={moderating ? acted : null} />}
      {shared && <UsageSection />}
      <Beside side={<LogSection key={acts} />}>
        <AccountsSection loaded={accounts} onActed={actedOnAccount} onRestores={(account) => setRestoring({ ...account, report: null })} />
        {moderating && <>
          <ReportsSection onActed={acted} onRestore={(report: AccountReport) => setRestoring({ accountId: report.accountId, username: report.username, report })} />
          <ShareSection onActed={acted} />
          <FileSection onActed={acted} />
        </>}
      </Beside>
      {restoring && <RestoresDialog key={restoring.accountId} operated={restoring} onClose={() => setRestoring(null)} onActed={() => actedOnAccount(restoring.accountId)} />}
    </Screen>
  );
}
