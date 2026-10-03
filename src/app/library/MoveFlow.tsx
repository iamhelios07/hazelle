import { useEffect, useState } from 'react';
import { readBackup } from '../../engine/import/backup';
import type { PresetFailure } from '../../engine/import/preset';
import type { BackupFailure, BackupSource, RisuBackup } from '../../engine/import/types';
import { unused, type Unused } from '../../engine/pipeline';
import { broughtFromRisu, modulesFromRisu, moveFromRisu, type Moved, type MovePick, type MoveStep } from '../../runtime/move';
import { aliased } from '../common/alias';
import { describeFailure } from '../common/failure';
import { describeUnused } from '../common/unused';
import { moduleName } from '../common/words';
import { useFiles, useStore } from '../session';
import { Button, Callout, Checkbox, Dialog, Outcome, Section, Stack, Text } from '../ui';
import { cardMissed, moduleMissed, moveMissed } from './missed';
import { hasModule, tickable, tickCount, toPick, type Have, type Ticks } from './movePick';

const FAILURE: Record<BackupFailure['kind'], string> = {
  encrypted: 'Risu 계정의 전체 백업은 글이 Risu 서버의 키로 잠겨 있어요. 그림은 읽을 수 있으니, Risu에서 ‘부분 로컬 백업 저장’으로 받은 파일을 이 파일과 함께 넣어 주세요. 글은 그 파일에서, 그림은 이 파일에서 가져와요.',
  'no-database': 'Risu 백업이 아니거나 깨진 파일이에요.',
  unreadable: 'Risu 백업이 아니거나 깨진 파일이에요.',
};

const PRESET_FAILURE: Record<PresetFailure['kind'], string> = {
  'no-template': '템플릿 없는 옛 프리셋',
  'decrypt-failed': '열지 못함',
  unreadable: '읽지 못함',
  'not-preset': '프리셋 아님',
};

const STEP: Record<MoveStep['kind'], string> = { characters: '캐릭터', chats: '대화', personas: '페르소나', prompts: '프롬프트', modules: '모듈' };

type Phase =
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'picking'; backup: RisuBackup; have: Have; can: Ticks; ticks: Ticks }
  | { kind: 'running'; step: MoveStep | null }
  | { kind: 'done'; backup: RisuBackup; pick: MovePick; moved: Moved };

// The file is read a slice at a time; a backup can be far larger than memory should hold.
const sourceOf = (file: File): BackupSource => ({
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
});

// Risu backups dropped or picked, read as one: pick what to bring, bring it, and say what came and what did not (design
// F7). aside: other files dropped with them, which are not imported.
export function MoveFlow({ files: dropped, aside, onClose }: { files: File[]; aside: number; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });

  useEffect(() => {
    let live = true;
    void readBackup(dropped.map(sourceOf)).then((read) => {
      if (!live) return;
      if (!read.ok) return setPhase({ kind: 'failed', message: FAILURE[read.failure.kind] });
      const have: Have = { characters: broughtFromRisu(store), modules: new Set(modulesFromRisu(store).keys()) };
      const can = tickable(read.backup, have);
      // Personas and presets carry no Risu id, so once anything was brought they start unticked rather than come twice.
      const ticks = have.characters.size + have.modules.size === 0 ? can : { ...can, personas: can.personas.map(() => false), presets: can.presets.map(() => false) };
      setPhase({ kind: 'picking', backup: read.backup, have, can, ticks });
    });
    return () => {
      live = false;
    };
  }, [dropped, store]);

  async function run(backup: RisuBackup, ticks: Ticks) {
    const pick = toPick(backup, ticks);
    setPhase({ kind: 'running', step: null });
    const moved = await moveFromRisu(store, files, pick, (step) => setPhase({ kind: 'running', step }));
    setPhase(moved.ok ? { kind: 'done', backup, pick, moved: moved.data } : { kind: 'failed', message: `저장하지 못했어요. ${describeFailure(moved)}` });
  }

  const names = dropped.map((file) => file.name).join(' + ');
  const note = aside > 0 ? `${names} · 함께 넣은 파일 ${aside}개는 가져오지 않았어요` : names;
  const close = (
    <Button variant="secondary" size="md" onClick={onClose}>
      닫기
    </Button>
  );

  if (phase.kind === 'reading' || phase.kind === 'running') {
    const { step } = phase.kind === 'running' ? phase : { step: null };
    return (
      <Dialog title={phase.kind === 'reading' ? '백업 읽는 중' : '가져오는 중'} note={note} onClose={() => {}}>
        <Text variant="note">{step ? `${STEP[step.kind]} 저장 중 · ${step.done} / ${step.total}` : '잠시만요'}</Text>
      </Dialog>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Dialog title="가져오지 못했어요" note={note} onClose={onClose} actions={close}>
        <Callout tone="warn">{phase.message}</Callout>
      </Dialog>
    );
  }
  if (phase.kind === 'done') {
    return (
      <Dialog title="가져왔어요" note={note} onClose={onClose} actions={close}>
        <Summary {...phase} />
      </Dialog>
    );
  }

  const { backup, have, can, ticks } = phase;
  const count = tickCount(ticks);
  const tick = (part: keyof Ticks, next: boolean[]) => setPhase({ ...phase, ticks: { ...ticks, [part]: next } });
  return (
    <Dialog
      title="Risu 백업"
      note={note}
      onClose={onClose}
      actions={
        <Button size="md" disabled={count === 0} onClick={() => void run(backup, ticks)}>
          {`가져오기 ${count}개`}
        </Button>
      }
    >
      <Stack gap="section">
        <Text variant="note">{backup.pictures > 0 ? `그림 ${backup.pictures}개가 들어 있어요.` : '그림이 들어 있지 않아요. 그림을 뺀 백업이면, 그림이 든 전체 백업을 함께 넣어 주세요.'}</Text>
        <Picks
          title="캐릭터"
          rows={backup.characters.map((character) => ({ label: character.card.name, note: have.characters.has(character.id) ? '이미 있음' : `대화 ${character.chats.length}개` }))}
          can={can.characters}
          ticks={ticks.characters}
          onChange={(next) => tick('characters', next)}
        />
        <Picks title="페르소나" rows={backup.personas.map((persona) => ({ label: aliased(persona.name, persona.alias) }))} can={can.personas} ticks={ticks.personas} onChange={(next) => tick('personas', next)} />
        <Picks
          title="프롬프트"
          rows={backup.presets.map((preset) => ({ label: preset.name, note: preset.result.ok ? undefined : PRESET_FAILURE[preset.result.failure.kind] }))}
          can={can.presets}
          ticks={ticks.presets}
          onChange={(next) => tick('presets', next)}
        />
        <Picks
          title="모듈"
          rows={backup.modules.map((module) => ({ label: moduleName(module.name), note: hasModule(have, module.risu) ? '이미 있음' : undefined }))}
          can={can.modules}
          ticks={ticks.modules}
          onChange={(next) => tick('modules', next)}
        />
      </Stack>
    </Dialog>
  );
}

type PicksProps = { title: string; rows: { label: string; note?: string }[]; can: boolean[]; ticks: boolean[]; onChange: (ticks: boolean[]) => void };

function Picks({ title, rows, can, ticks, onChange }: PicksProps) {
  if (rows.length === 0) return null;
  const all = can.every((open, index) => !open || ticks[index]);
  const action = can.filter(Boolean).length > 1 && (
    <Button variant="link" size="sm" onClick={() => onChange(can.map((open) => open && !all))}>
      {all ? '모두 해제' : '모두 선택'}
    </Button>
  );
  return (
    <Section title={title} note={`${rows.length}개`} action={action || undefined}>
      <Stack gap="related">
        {rows.map((row, index) => (
          <Checkbox
            key={index}
            label={row.label}
            note={row.note}
            checked={ticks[index]!}
            disabled={!can[index]}
            onChange={(checked) => onChange(ticks.map((ticked, at) => (at === index ? checked : ticked)))}
          />
        ))}
      </Stack>
    </Section>
  );
}

function Summary({ backup, pick, moved }: { backup: RisuBackup; pick: MovePick; moved: Moved }) {
  const chats = moved.characters.reduce((sum, character) => sum + character.chats, 0);
  const missed = [
    ...moved.characters.flatMap((character) => {
      const source = pick.characters.find(({ id }) => id === character.risu)!;
      const lines = [...cardMissed(source.report, character.skipped, character.faceless), ...moveMissed(source.missed)];
      return lines.length ? [{ tone: 'missed' as const, title: character.name, note: lines.join(' · ') }] : [];
    }),
    ...backup.presets.flatMap((preset) => (preset.result.ok ? [] : [{ tone: 'missed' as const, title: preset.name, note: `프롬프트 · ${PRESET_FAILURE[preset.result.failure.kind]}` }])),
    ...moved.modules.flatMap(({ module, skipped }) => {
      const lines = moduleMissed(module.unsupported, skipped);
      return lines.length ? [{ tone: 'missed' as const, title: moduleName(module.name), note: `모듈 · ${lines.join(' · ')}` }] : [];
    }),
  ];
  const totals = new Map<Unused['kind'], number>();
  for (const item of pick.characters.flatMap((character) => unused(character.card))) totals.set(item.kind, (totals.get(item.kind) ?? 0) + item.count);
  const notUsed = describeUnused([...totals].map(([kind, count]) => ({ kind, count })));
  return (
    <Stack gap="section">
      {backup.unsupported.length > 0 && <Callout tone="warn">백업에서 못 가져온 것: {moveMissed(backup.unsupported).join(' · ')}</Callout>}
      <Text>{`캐릭터 ${moved.characters.length}개 · 대화 ${chats}개 · 페르소나 ${moved.personas}개 · 프롬프트 ${moved.prompts}개 · 모듈 ${moved.modules.length}개`}</Text>
      {missed.length > 0 && (
        <Section title="가져오지 않은 것">
          <Outcome label="가져오지 않은 것" items={missed} />
        </Section>
      )}
      {notUsed && <Text variant="note">{notUsed}</Text>}
    </Stack>
  );
}
