import { KEEP_DAYS } from '../../model/library';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

// A character in 지운 캐릭터, and a chat whose character is not there, say how to get them back.
const RESTORE = '캐릭터 둘러보기의 ‘지운 캐릭터’에서 되살릴 수 있어요.';
const COPY = {
  chat: { title: '채팅', message: '이 채팅이 없어요. 지워졌거나 주소가 잘못됐어요.' },
  'orphaned-chat': { title: '채팅', message: `지운 캐릭터의 채팅이에요. ${KEEP_DAYS}일 안에는 ${RESTORE}` },
  character: { title: '캐릭터', message: '이 캐릭터가 없어요. 지워졌거나 주소가 잘못됐어요.' },
  'deleted-character': { title: '캐릭터', message: `지운 캐릭터예요. ${RESTORE}` },
  connection: { title: '연결', message: '이 연결이 없어요. 지워졌거나 주소가 잘못됐어요.' },
  prompt: { title: '프롬프트', message: '이 프롬프트가 없어요. 지워졌거나 주소가 잘못됐어요.' },
  persona: { title: '페르소나', message: '이 페르소나가 없어요. 지워졌거나 주소가 잘못됐어요.' },
  module: { title: '모듈', message: '이 모듈이 없어요. 지워졌거나 주소가 잘못됐어요.' },
  profile: { title: '모델 설정', message: '이 설정이 없어요. 지워졌거나 주소가 잘못됐어요.' },
  model: { title: '모델', message: '별표한 모델 중에 이 모델이 없어요. 별표를 뺐거나 연결을 지웠어요.' },
};

export type Absent = keyof typeof COPY;

// What the address names is not there.
export function Missing({ what, back }: { what: Absent; back: Back }) {
  const { title, message } = COPY[what];
  return (
    <Screen top={<NavBar title={title} {...backBar(back)} />}>
      <Empty>{message}</Empty>
    </Screen>
  );
}
