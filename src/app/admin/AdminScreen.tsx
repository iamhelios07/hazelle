import { useState } from 'react';
import { readService } from '../../runtime/admin';
import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Callout, NavBar, Screen } from '../ui';
import { AccountsSection } from './AccountsSection';
import { FileSection } from './FileSection';
import { LogSection } from './LogSection';
import { ReportsSection } from './ReportsSection';
import { ServiceSection } from './ServiceSection';
import { useLoaded } from './useLoaded';

// 운영: the operator's tools. Every act lands in the log, which is asked again after one.
export function AdminScreen({ back }: { back: Back | null }) {
  const service = useLoaded(readService);
  const [acts, setActs] = useState(0);
  const acted = () => {
    service.reload();
    setActs((count) => count + 1);
  };
  return (
    <Screen width="form" top={<NavBar title={PAGES.admin} {...backBar(back)} />}>
      {service.failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: service.reload }}>{service.failure}</Callout>}
      {service.data && <ServiceSection service={service.data} onSaved={acted} />}
      <AccountsSection onActed={acted} />
      <ReportsSection onActed={acted} />
      <FileSection onActed={acted} />
      <LogSection key={acts} />
    </Screen>
  );
}
