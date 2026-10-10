import { useState } from 'react';
import type { Toggle } from '../../model/prompt';
import { ACTS, newOf } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { ToggleChoice } from '../common/ToggleChoice';
import { Button, ChoiceGroup, Dialog, Empty, MenuItem, MoreMenu, Row, Section, SettingGroup, SettingRow, Switch, TextField } from '../ui';
import { keyProblem } from './edits';

type Props = {
  toggles: readonly Toggle[];
  uses: (key: string) => number;
  onAdd: (toggle: Toggle) => void;
  onEdit: (before: Toggle, after: Toggle, what: 'label' | 'default') => void;
  onRekey: (toggle: Toggle, to: string) => void;
  onRemove: (key: string) => void;
  // The new-toggle form is open; 조건 삽입's 새 토글 만들기 opens it too.
  adding: boolean;
  onAdding: (adding: boolean) => void;
};

const KIND_WORDS = { check: '켜고 끄기', choice: '선택' } as const;

export function TogglePane({ toggles, uses, onAdd, onEdit, onRekey, onRemove, adding, onAdding }: Props) {
  const [renaming, setRenaming] = useState<{ key: string; field: 'label' | 'key' } | null>(null);
  const target = renaming && toggles.find((toggle) => toggle.key === renaming.key);

  return (
    <Section
      title="토글"
      note={`${toggles.length}개`}
      help="채팅에서 켜고 끄면 조건에 따라 보내는 내용이 바뀌어요."
      action={
        <Button variant="secondary" icon={ACTS.create.icon} onClick={() => onAdding(true)}>
          {newOf('토글')}
        </Button>
      }
    >
      {toggles.length === 0 ? (
        <Empty variant="section">토글이 없어요.</Empty>
      ) : (
        <SettingGroup label="토글">
          {toggles.map((toggle) => (
            <SettingRow
              key={toggle.key}
              label={toggle.label}
              sub={`${toggle.key} · ${KIND_WORDS[toggle.kind]}`}
              control={
                <Row kind="toolbar">
                  {toggle.kind === 'check' ? (
                    <Switch label={`${toggle.label} 기본값`} checked={toggle.default === '1'} onChange={(on) => onEdit(toggle, { ...toggle, default: on ? '1' : '0' }, 'default')} />
                  ) : (
                    <ToggleChoice label={`${toggle.label} 기본값`} options={toggle.options} value={toggle.default} onChange={(value) => onEdit(toggle, { ...toggle, default: value }, 'default')} />
                  )}
                  <MoreMenu label={`'${toggle.label}' 더 보기`}>
                    <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setRenaming({ key: toggle.key, field: 'label' })} />
                    <MenuItem label="키 바꾸기" sub="조건에 쓴 키도 바뀌어요" onClick={() => setRenaming({ key: toggle.key, field: 'key' })} />
                    <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onRemove(toggle.key)} />
                  </MoreMenu>
                </Row>
              }
            />
          ))}
        </SettingGroup>
      )}
      {target && renaming.field === 'label' && (
        <NameDialog
          title={ACTS.rename.label}
          value={target.label}
          onClose={() => setRenaming(null)}
          onSave={(label) => {
            setRenaming(null);
            if (label.trim()) onEdit(target, { ...target, label: label.trim() }, 'label');
          }}
        />
      )}
      {target && renaming.field === 'key' && (
        <KeyDialog
          toggle={target}
          toggles={toggles}
          uses={uses(target.key)}
          onClose={() => setRenaming(null)}
          onSave={(key) => {
            setRenaming(null);
            if (key !== target.key) onRekey(target, key);
          }}
        />
      )}
      {adding && (
        <NewToggleDialog
          toggles={toggles}
          onClose={() => onAdding(false)}
          onSave={(toggle) => {
            onAdding(false);
            onAdd(toggle);
          }}
        />
      )}
    </Section>
  );
}

function KeyDialog({ toggle, toggles, uses, onClose, onSave }: { toggle: Toggle; toggles: readonly Toggle[]; uses: number; onClose: () => void; onSave: (key: string) => void }) {
  const [key, setKey] = useState(toggle.key);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="키 바꾸기"
      onClose={onClose}
      onSubmit={() => {
        const problem = keyProblem(key.trim(), toggles, toggle.key);
        if (problem) return setError(problem);
        onSave(key.trim());
      }}
      actionsLayout="full"
      actions={
        <Button type="submit">
          바꾸기
        </Button>
      }
    >
      <TextField
        label="키"
        kind="key"
        value={key}
        onChange={setKey}
        error={error ?? undefined}
        hint={uses ? `조건 ${uses}곳도 바뀌어요.` : '이 키를 쓰는 조건이 없어요.'}
      />
    </Dialog>
  );
}

function NewToggleDialog({ toggles, onClose, onSave }: { toggles: readonly Toggle[]; onClose: () => void; onSave: (toggle: Toggle) => void }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<Toggle['kind']>('check');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<{ key?: string; label?: string; options?: string }>({});
  const choices = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

  function submit() {
    const problems = {
      label: label.trim() ? undefined : '이름을 적어 주세요.',
      key: keyProblem(key.trim(), toggles, null) ?? undefined,
      options: kind === 'choice' && choices.length < 2 ? '선택지를 둘 이상 적어 주세요.' : undefined,
    };
    if (problems.label || problems.key || problems.options) return setError(problems);
    const named = { key: key.trim(), label: label.trim() };
    onSave(kind === 'check' ? { ...named, kind, default: '0' } : { ...named, kind, options: choices, default: '0' });
  }

  return (
    <Dialog
      title={newOf('토글')}
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit">
          만들기
        </Button>
      }
    >
      <TextField label="이름" value={label} onChange={setLabel} placeholder="예: 시뮬레이터 모드" error={error.label} />
      <TextField
        label="키"
        kind="key"
        value={key}
        onChange={setKey}
        placeholder="예: sims"
        help="조건에서 이 토글을 가리키는 이름이에요."
        error={error.key}
      />
      <ChoiceGroup<Toggle['kind']>
        label="종류"
        layout="segmented"
        options={[
          { value: 'check', label: KIND_WORDS.check },
          { value: 'choice', label: KIND_WORDS.choice },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'choice' && <TextField label="선택지" help="쉼표로 구분해요." value={options} onChange={setOptions} placeholder="예: 간결, 보통, 풍부" error={error.options} />}
    </Dialog>
  );
}
