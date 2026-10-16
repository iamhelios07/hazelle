import { useState } from 'react';
import { moduleContributions, type ModuleContribution, type Sending } from '../../runtime/turn-context';
import { tokens } from '../common/receipt';
import { moduleName } from '../common/words';
import { useSession } from '../session';
import { Empty, Facts, List, ListItem, Stack, Text } from '../ui';

const ATTACHED = { settings: '설정', prompt: '프롬프트', character: '캐릭터', persona: '페르소나' } as const;

const entryTokens = ({ parts }: ModuleContribution['lore'][number]) => parts.reduce((sum, part) => sum + part.tokens, 0);

function moduleTags(module: ModuleContribution): string[] {
  const regex = Object.values(module.regex).reduce((sum, count) => sum + count, 0);
  const fired = module.lore.reduce((sum, entry) => sum + entryTokens(entry), 0);
  return [
    ...(module.lore.length ? [`로어북 ${module.lore.length}개 · ${tokens(fired)} 토큰`] : []),
    ...(module.invalidKeys.length ? [`잘못된 정규식 키 ${module.invalidKeys.reduce((sum, { keys }) => sum + keys.length, 0)}개`] : []),
    ...(regex ? [`정규식 ${regex}개`] : []),
    ...(module.triggers.lua ? [`Lua ${module.triggers.lua}개`] : []),
    ...(module.triggers.blocks ? [`트리거 ${module.triggers.blocks}개`] : []),
    ...(module.toggles.length ? [`토글 ${module.toggles.length}개`] : []),
    ...(module.tools.length ? [`도구 ${module.tools.length}개`] : []),
  ];
}

export function Modules({ sending }: { sending: Sending }) {
  const session = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const modules = moduleContributions(session, sending.turn.chat, sending.prompt);
  if (modules.length === 0) return <Empty variant="section">이 채팅에서 켜져 있는 모듈이 없어요.</Empty>;
  return (
    <List label="실행되는 모듈">
      {modules.map((module) => (
        <ListItem
          key={module.id}
          title={module.kind === 'module' ? moduleName(module.name) : module.name}
          badge={module.kind === 'character' ? '캐릭터' : undefined}
          description={module.kind === 'character' ? '캐릭터에 들어 있음' : `${module.attached.map(({ kind }) => ATTACHED[kind]).join(' · ')}에서 켬`}
          tags={moduleTags(module)}
          expanded={open === module.id}
          onClick={() => setOpen(open === module.id ? null : module.id)}
          detail={open === module.id && <ModuleDetail module={module} />}
        />
      ))}
    </List>
  );
}

function ModuleDetail({ module }: { module: ModuleContribution }) {
  return (
    <Stack gap="related">
      <Facts
        items={[
          { label: '입력 정규식', value: `${module.regex.input}개` },
          { label: '응답 정규식', value: `${module.regex.output}개` },
          { label: '요청 정규식', value: `${module.regex.process}개` },
          { label: '화면 정규식', value: `${module.regex.display}개` },
        ]}
      />
      {module.lore.length > 0 ? (
        <List label={`${module.name} 로어북`}>
          {module.lore.map((entry) => (
            <ListItem key={entry.id} title={entry.name} aside={entry.parts.length ? tokens(entryTokens(entry)) : '안 들어감'} />
          ))}
        </List>
      ) : (
        <Text variant="note">이번 요청에서 켜진 로어북 항목이 없어요.</Text>
      )}
      {module.invalidKeys.length > 0 && (
        <List label="잘못된 정규식 키">
          {module.invalidKeys.map((entry) => (
            <ListItem key={entry.entry} title={entry.name} description={entry.keys.join(' · ')} aside="맞지 않음" />
          ))}
        </List>
      )}
    </Stack>
  );
}
