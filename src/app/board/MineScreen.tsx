import { Send } from 'lucide-react';
import { useState } from 'react';
import { readNickname } from '../../runtime/board';
import { useLoaded } from '../common/useLoaded';
import { BOARD } from '../common/words';
import { useAccount } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, NavBar, Screen, SettingGroup, SettingRow } from '../ui';
import { NicknameDialog } from './nickname';
import { PostList } from './parts';

// What this account wrote, public and operator-only alike, under the nickname it writes as.
export function MineScreen({ back }: { back: Back }) {
  const { admin } = useAccount();
  const nickname = useLoaded(readNickname);
  const [changing, setChanging] = useState(false);
  const name = nickname.data?.name;
  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={BOARD.mine}
          {...backBar(back)}
          actions={
            <Button variant="secondary" icon={Send} onClick={() => navigate({ kind: 'board-write', operator: true })}>
              {BOARD.toOperator}
            </Button>
          }
        />
      }
    >
      {nickname.failure}
      {nickname.data && (
        <SettingGroup label={BOARD.nickname}>
          <SettingRow
            label={BOARD.nickname}
            sub={name ?? '정하지 않음'}
            control={
              // The operator writes as 운영자, which no one picks or changes.
              admin ? null : (
                <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
                  {name ? '바꾸기' : '정하기'}
                </Button>
              )
            }
          />
        </SettingGroup>
      )}
      <PostList ask={{ sort: 'new', mine: true }} label={BOARD.mine} empty="쓴 글이 없어요." />
      {changing && (
        <NicknameDialog
          current={name ?? null}
          onSet={() => {
            setChanging(false);
            nickname.reload();
          }}
          onClose={() => setChanging(false)}
        />
      )}
    </Screen>
  );
}
