import { Lock, LogOut, Plug, Settings } from 'lucide-react';
import { useState } from 'react';
import { useAccount, useSession } from '../../session';
import { useToast } from '../../toast';
import { AccountRow, Avatar, IconButton, MenuItem, NavRow, Popover } from '../../ui';
import { navigate, useRoute } from '../router';
import { connectionList } from '../routes';

export function AccountMenu({ beside }: { beside: boolean }) {
  const { onLock, onLogout } = useAccount();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      place={beside ? 'beside' : 'above-start'}
      label="계정"
      trigger={<IconButton icon={Settings} label="계정" size="sm" expanded={open} onClick={() => setOpen(!open)} />}
    >
      <MenuItem icon={Lock} label="잠그기" onClick={onLock} />
      <MenuItem
        icon={LogOut}
        label="로그아웃"
        onClick={() => {
          setOpen(false);
          void onLogout().then((failure) => failure && toast.show(failure));
        }}
      />
    </Popover>
  );
}

export function SidebarFooter() {
  const { username } = useSession();
  const route = useRoute();
  return (
    <>
      <NavRow icon={Plug} label="연결" current={connectionList(route) !== null} onClick={() => navigate({ kind: 'connections' })} />
      <AccountRow avatar={<Avatar face={username} size="sm" tone="you" />} name={username}>
        <AccountMenu beside={false} />
      </AccountRow>
    </>
  );
}
