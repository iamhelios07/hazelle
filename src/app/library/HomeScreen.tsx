import { MessageSquarePlus, PackageOpen, Plug, UserRoundPlus } from 'lucide-react';
import { ACTS, importOf, newOf } from '../common/acts';
import { useChats, useConnections } from '../session';
import { navigate } from '../shell/router';
import { ActionCard, Intro, Screen, Stack } from '../ui';
import { useImport } from '../common/importing';
import { useNewCharacter } from './useCharacterActions';

export function Welcome() {
  const connections = useConnections();
  const chats = useChats();
  const { pick, move } = useImport();
  const create = useNewCharacter();
  return (
    <Stack gap="section">
      <Intro title={chats.length ? '어디서 이어 갈까요?' : '비어 있어요'} />
      <Stack>
        {connections.length > 0 && (
          <ActionCard tone="accent" icon={MessageSquarePlus} title="새 채팅" description="캐릭터 없이 모델과 이야기해요" onClick={() => navigate({ kind: 'new-chat', character: null })} />
        )}
        <ActionCard tone={connections.length ? 'default' : 'accent'} icon={PackageOpen} title="Risu에서 이사" description="캐릭터, 채팅, 프롬프트를 한 번에 옮겨요" onClick={move} />
        <ActionCard icon={ACTS.import.icon} title={importOf('봇')} description="PNG · charx · JSON 파일을 끌어다 놓거나 눌러서 선택" onClick={pick} />
        <ActionCard icon={UserRoundPlus} title={newOf('캐릭터')} description="이름과 설명부터 직접 써요" onClick={create} />
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
