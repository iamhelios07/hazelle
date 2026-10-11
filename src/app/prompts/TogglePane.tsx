import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { isToggle, type Toggle, type ToggleLine, type ToggleMark } from '../../model/prompt';
import { ACTS, newOf } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { ToggleChoice } from '../common/ToggleChoice';
import { Button, Checkbox, ChoiceGroup, Dialog, Empty, Menu, MenuItem, MoreMenu, Row, Section, SettingGroup, SettingRow, Switch, TextField } from '../ui';
import { keyProblem, LINE_WORDS } from './edits';

type Props = {
  lines: readonly ToggleLine[];
  uses: (key: string) => number;
  onAdd: (line: ToggleLine) => void;
  onEdit: (before: ToggleLine, after: ToggleLine, at: number, what: 'label' | 'default') => void;
  onMove: (line: ToggleLine, from: number, to: number) => void;
  onRekey: (toggle: Toggle, to: string) => void;
  onRemove: (at: number) => void;
  // The new-toggle form is open; 조건 삽입's 새 토글 만들기 opens it too.
  adding: boolean;
  onAdding: (adding: boolean) => void;
};

type Labeled = Exclude<ToggleMark['kind'], 'groupEnd'>;
type Editing = { at: number; field: 'label' | 'key' | 'default' } | { add: Labeled };

const FIELD: Record<Labeled, string> = { divider: '이름', caption: '내용', group: '이름' };

const subOf = (line: ToggleLine) =>
  isToggle(line) ? `${line.key} · ${LINE_WORDS[line.kind]}${line.kind === 'text' && line.lines ? ' · 여러 줄' : ''}` : line.kind !== 'groupEnd' && line.label ? LINE_WORDS[line.kind] : undefined;

export function TogglePane({ lines, uses, onAdd, onEdit, onMove, onRekey, onRemove, adding, onAdding }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const count = lines.filter(isToggle).length;
  const close = () => setEditing(null);

  function control(line: ToggleLine, at: number) {
    if (!isToggle(line) || line.kind === 'text') return null;
    return line.kind === 'check' ? (
      <Switch label={`${line.label} 기본값`} checked={line.default === '1'} onChange={(on) => onEdit(line, { ...line, default: on ? '1' : '0' }, at, 'default')} />
    ) : (
      <ToggleChoice label={`${line.label} 기본값`} options={line.options} value={line.default} onChange={(value) => onEdit(line, { ...line, default: value }, at, 'default')} />
    );
  }

  function dialog(line: ToggleLine, at: number, field: 'label' | 'key' | 'default') {
    if (field === 'key' && isToggle(line)) {
      return (
        <KeyDialog
          toggle={line}
          lines={lines}
          uses={uses(line.key)}
          onClose={close}
          onSave={(key) => {
            close();
            if (key !== line.key) onRekey(line, key);
          }}
        />
      );
    }
    if (field === 'default' && line.kind === 'text') {
      return (
        <NameDialog
          title="기본값 바꾸기"
          field="기본값"
          value={line.default}
          onClose={close}
          onSave={(value) => {
            close();
            onEdit(line, { ...line, default: value }, at, 'default');
          }}
        />
      );
    }
    if (field !== 'label' || line.kind === 'groupEnd') return null;
    return (
      <NameDialog
        title={line.kind === 'caption' ? '내용 바꾸기' : ACTS.rename.label}
        field={isToggle(line) ? '이름' : FIELD[line.kind]}
        value={line.label}
        onClose={close}
        onSave={(label) => {
          close();
          if (label.trim() || line.kind === 'divider') onEdit(line, { ...line, label: label.trim() }, at, 'label');
        }}
      />
    );
  }

  return (
    <Section
      title="토글"
      note={`${count}개`}
      help="채팅에서 켜고 끄면 조건에 따라 보내는 내용이 바뀌어요. 구분선, 설명, 그룹은 채팅의 토글 목록을 정리해요."
      action={
        <Row kind="actions">
          <Menu label="줄 추가" place="below-end" trigger={(opener) => <Button variant="secondary" {...opener}>줄 추가</Button>}>
            <MenuItem label={LINE_WORDS.divider} onClick={() => setEditing({ add: 'divider' })} />
            <MenuItem label={LINE_WORDS.caption} onClick={() => setEditing({ add: 'caption' })} />
            <MenuItem label={LINE_WORDS.group} onClick={() => setEditing({ add: 'group' })} />
            <MenuItem label={LINE_WORDS.groupEnd} onClick={() => onAdd({ kind: 'groupEnd' })} />
          </Menu>
          <Button variant="secondary" icon={ACTS.create.icon} onClick={() => onAdding(true)}>
            {newOf('토글')}
          </Button>
        </Row>
      }
    >
      {lines.length === 0 ? (
        <Empty variant="section">토글이 없어요.</Empty>
      ) : (
        <SettingGroup label="토글">
          {lines.map((line, at) => (
            <SettingRow
              key={isToggle(line) ? line.key : `${line.kind}${at}`}
              label={isToggle(line) || (line.kind !== 'groupEnd' && line.label) ? line.label : LINE_WORDS[line.kind]}
              sub={subOf(line)}
              control={
                <Row kind="toolbar">
                  {control(line, at)}
                  <MoreMenu of={isToggle(line) ? `'${line.label}'` : LINE_WORDS[line.kind]}>
                    {line.kind !== 'groupEnd' && <MenuItem icon={ACTS.rename.icon} label={line.kind === 'caption' ? '내용 바꾸기' : ACTS.rename.label} onClick={() => setEditing({ at, field: 'label' })} />}
                    {line.kind === 'text' && <MenuItem label="기본값 바꾸기" onClick={() => setEditing({ at, field: 'default' })} />}
                    {isToggle(line) && <MenuItem label="키 바꾸기" sub="조건에 쓴 키도 바뀌어요" onClick={() => setEditing({ at, field: 'key' })} />}
                    {at > 0 && <MenuItem icon={ArrowUp} label="위로 옮기기" onClick={() => onMove(line, at, at - 1)} />}
                    {at < lines.length - 1 && <MenuItem icon={ArrowDown} label="아래로 옮기기" onClick={() => onMove(line, at, at + 1)} />}
                    <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onRemove(at)} />
                  </MoreMenu>
                </Row>
              }
            />
          ))}
        </SettingGroup>
      )}
      {editing && 'add' in editing && (
        <NameDialog
          title={`${LINE_WORDS[editing.add]} 추가`}
          field={FIELD[editing.add]}
          value=""
          hint={editing.add === 'divider' ? '비워 두면 선만 보여요.' : undefined}
          onClose={close}
          onSave={(label) => {
            close();
            if (label.trim() || editing.add === 'divider') onAdd({ kind: editing.add, label: label.trim() });
          }}
        />
      )}
      {editing && 'at' in editing && lines[editing.at] && dialog(lines[editing.at]!, editing.at, editing.field)}
      {adding && (
        <NewToggleDialog
          lines={lines}
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

function KeyDialog({ toggle, lines, uses, onClose, onSave }: { toggle: Toggle; lines: readonly ToggleLine[]; uses: number; onClose: () => void; onSave: (key: string) => void }) {
  const [key, setKey] = useState(toggle.key);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="키 바꾸기"
      onClose={onClose}
      onSubmit={() => {
        const problem = keyProblem(key.trim(), lines, toggle.key);
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

function NewToggleDialog({ lines, onClose, onSave }: { lines: readonly ToggleLine[]; onClose: () => void; onSave: (toggle: Toggle) => void }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<Toggle['kind']>('check');
  const [options, setOptions] = useState('');
  const [several, setSeveral] = useState(false);
  const [error, setError] = useState<{ key?: string; label?: string; options?: string }>({});
  const choices = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

  function submit() {
    const problems = {
      label: label.trim() ? undefined : '이름을 적어 주세요.',
      key: keyProblem(key.trim(), lines, null) ?? undefined,
      options: kind === 'choice' && choices.length < 2 ? '선택지를 둘 이상 적어 주세요.' : undefined,
    };
    if (problems.label || problems.key || problems.options) return setError(problems);
    const named = { key: key.trim(), label: label.trim() };
    onSave(
      kind === 'check'
        ? { ...named, kind, default: '0' }
        : kind === 'choice'
          ? { ...named, kind, options: choices, default: '0' }
          : { ...named, kind, ...(several && { lines: true as const }), default: '' },
    );
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
          { value: 'check', label: LINE_WORDS.check },
          { value: 'choice', label: LINE_WORDS.choice },
          { value: 'text', label: LINE_WORDS.text },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'choice' && <TextField label="선택지" help="쉼표로 구분해요." value={options} onChange={setOptions} placeholder="예: 간결, 보통, 풍부" error={error.options} />}
      {kind === 'text' && <Checkbox label="여러 줄" checked={several} onChange={setSeveral} />}
    </Dialog>
  );
}
