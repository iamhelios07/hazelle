import { MessageSquarePlus, PackageOpen, Plug } from 'lucide-react';
import { ACTS, importOf, newOf } from '../common/acts';
import { useChats, useConnections } from '../session';
import { navigate } from '../shell/router';
import { ActionCard, Intro, Screen, Stack } from '../ui';
import { useImport } from './ImportFlow';

export function Welcome() {
  const connections = useConnections();
  const chats = useChats();
  const { pick, move } = useImport();
  return (
    <Stack gap="section">
      <Intro title={chats.length ? '어디서 이어 갈까요?' : '아직 비어 있어요'} />
      <Stack>
        {connections.length > 0 && (
          <ActionCard tone="accent" icon={MessageSquarePlus} title="새 채팅" description="캐릭터 없이 모델과 이야기해요" onClick={() => navigate({ kind: 'new-chat', character: null })} />
        )}
        <ActionCard
          tone={connections.length ? 'default' : 'accent'}
          icon={ACTS.import.icon}
          title={importOf('봇')}
          description="PNG · charx · JSON 파일을 끌어다 놓거나 눌러서 선택"
          onClick={pick}
        />
        <ActionCard icon={PackageOpen} title="Risu에서 이사" description="Risu 로컬 백업에서 캐릭터와 채팅을 가져와요" onClick={move} />
        {connections.length === 0 ? (
          <ActionCard icon={Plug} title={newOf('연결')} description="제공자를 선택하고 API 키를 입력해요" onClick={() => navigate({ kind: 'add-connection' })} />
        ) : (
          <ActionCard icon={Plug} title="연결" description={`연결 ${connections.length}개 · 모델 즐겨찾기`} onClick={() => navigate({ kind: 'connections' })} />
        )}
      </Stack>
    </Stack>
  );
}

export function HomeScreen() {
  return (
    <Screen align="center">
      <Welcome />
    </Screen>
  );
}
