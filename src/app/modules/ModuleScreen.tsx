import type { Stored } from '../../model/kinds';
import { setModuleAlways, setModuleDeleted } from '../../runtime/modules';
import { aliased } from '../common/alias';
import { ALWAYS } from '../common/words';
import { useLibrary, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import { characterPage, type Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Button, Empty, List, ListItem, NavBar, Row, Screen, Section, SettingGroup, SettingRow, Switch, Text, useWide } from '../ui';
import { useHolds } from './ModulesScreen';

const ALWAYS_ON = `${ALWAYS} 켜기`;
const USED_BY = '쓰는 캐릭터';

export function ModuleScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const wide = useWide();
  const { id, value } = stored;
  const always = useSettings().modules?.includes(id) ?? false;
  const users = useLibrary().characters.filter(({ character }) => character.modules?.includes(id));
  const holds = useHolds(stored);

  async function setAlways(on: boolean) {
    const saved = await setModuleAlways(store, id, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  async function mark(at: number | null): Promise<boolean> {
    const saved = await setModuleDeleted(store, id, at);
    if (!saved.ok) toast.failed(saved);
    return saved.ok;
  }

  // A deleted module is listed nowhere, so the toast's 되돌리기 is the only way back: its detail must not name a place.
  async function remove() {
    if (!(await mark(Date.now()))) return;
    navigate({ kind: 'modules' });
    toast.undoable(`‘${value.name}’ 모듈을 지웠어요.`, () => void mark(null), '이 알림이 사라지면 되돌릴 수 없어요.');
  }

  return (
    <Screen top={<NavBar title={value.name} {...backBar(back)} />}>
      {value.description.trim() && <Text>{value.description}</Text>}
      <Text variant="note">{holds}</Text>
      <SettingGroup label={ALWAYS_ON}>
        <SettingRow
          label={ALWAYS_ON}
          help="켜면 모든 채팅에서 일해요. 꺼 두면 캐릭터 편집의 ‘모듈’에서 켠 캐릭터의 채팅에서만 일해요."
          control={<Switch label={ALWAYS_ON} checked={always} onChange={(on) => void setAlways(on)} />}
        />
      </SettingGroup>
      <Section title={USED_BY}>
        {users.length > 0 ? (
          <List label={USED_BY}>
            {users.map(({ id: character, character: { card, alias }, face }) => (
              <ListItem key={character} leading={<Avatar face={card.name} image={face} />} title={aliased(card.name, alias)} onClick={() => navigate(characterPage(character, wide))} />
            ))}
          </List>
        ) : (
          <Empty variant="section">{always ? '따로 켠 캐릭터는 없어요.' : '아직 켠 캐릭터가 없어요. 캐릭터 편집의 ‘모듈’에서 켤 수 있어요.'}</Empty>
        )}
      </Section>
      <Row kind="actions">
        <Button variant="danger" size="sm" onClick={() => void remove()}>
          이 모듈 지우기
        </Button>
      </Row>
    </Screen>
  );
}
