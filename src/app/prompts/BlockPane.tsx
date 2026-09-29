import { ArrowDown, ArrowUp, Ellipsis, GitBranch, Plus, X } from 'lucide-react';
import type { Ref } from 'react';
import type { Block, Role, TextBlock, Toggle } from '../../model/prompt';
import { Button, ChoiceGroup, Divider, Empty, IconButton, MarkupArea, Menu, MenuHeading, MenuItem, Row, Section, Stack, Tag, Text, TitleField } from '../ui';
import { blockTitle, describeRange, MARKS, RANGES, rangeKey, ROLES, SLOT } from './blocks';

type Props = {
  block: Block;
  index: number;
  count: number;
  toggles: readonly Toggle[];
  authorNote: string;
  onChange: (block: Block) => void;
  // Takes the 감싸는 글 off, with a way back.
  onUnwrap: () => void;
  onAuthorNote: (text: string) => void;
  onMark: (mark: TextBlock['mark']) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onCondition: (toggle: Toggle) => void;
  onNewToggle: () => void;
  textRef: Ref<HTMLTextAreaElement>;
  nameRef: Ref<HTMLInputElement>;
};

const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

// The block picked in the outline, and only it (design §4.2): where it goes, its name, its role, and what it holds.
export function BlockPane({ block, index, count, toggles, authorNote, onChange, onUnwrap, onAuthorNote, onMark, onMove, onRemove, onCondition, onNewToggle, textRef, nameRef }: Props) {
  const { title } = blockTitle(block);
  const where = `${index + 1}번째 · ${block.kind === 'text' ? '직접 쓴 글' : `앱이 채우는 자리 · ${SLOT[block.slot].name}`}`;
  const placeholder = block.kind === 'slot' ? SLOT[block.slot].name : firstLine(block.text) || '이름 붙이기';

  return (
    <Stack gap="section">
      <Stack gap="related">
        <Text size="sm" tone="muted">
          {where}
        </Text>
        <TitleField ref={nameRef} label="블록 이름" value={block.name ?? ''} placeholder={placeholder} onChange={(name) => onChange({ ...block, name: name || null })} />
        <Row kind="toolbar">
          {'role' in block && <ChoiceGroup<Role> label="보내는 역할" showLabel layout="segmented" options={ROLES} value={block.role} onChange={(role) => onChange({ ...block, role })} />}
          {block.kind === 'text' && block.mark && <Tag tone="accent">{MARKS[block.mark].label}</Tag>}
          {block.kind === 'text' && (
            <Menu
              label="조건 넣기"
              place="below-end"
              trigger={(opener) => (
                <Button variant="ghost" size="sm" icon={GitBranch} {...opener}>
                  조건 넣기
                </Button>
              )}
            >
              <MenuHeading>어떤 토글에 따라 바뀔까요? 커서 자리에 조건이 들어가고, 선택해 둔 글은 첫 칸에 담겨요. 그 뒤 각 칸의 글만 고쳐 쓰면 돼요.</MenuHeading>
              {toggles.length === 0 && <Empty variant="menu">아직 이 프롬프트에 토글이 없어요.</Empty>}
              {toggles.map((toggle) => (
                <MenuItem
                  key={toggle.key}
                  label={toggle.label}
                  sub={`${toggle.key} · ${toggle.kind === 'check' ? '켰을 때 · 껐을 때 두 칸' : `선택지마다 한 칸: ${toggle.options.join(' · ')}`}`}
                  onClick={() => onCondition(toggle)}
                />
              ))}
              <Divider variant="menu" />
              <MenuItem icon={Plus} label="새 토글 만들기" onClick={onNewToggle} />
            </Menu>
          )}
          <Menu label={`‘${title}’ 더 보기`} place="below-end" trigger={(opener) => <IconButton icon={Ellipsis} size="sm" label={`‘${title}’ 더 보기`} title="더 보기" {...opener} />}>
            {block.kind === 'text' && (
              <>
                <MenuHeading>캐릭터 카드가 이 글을 대신할 때</MenuHeading>
                <MenuItem label="대신하지 않음" sub="카드와 상관없이 늘 이 글을 보내요" checked={block.mark === null} onClick={() => onMark(null)} />
                {(['main', 'globalNote'] as const).map((mark) => (
                  <MenuItem key={mark} label={MARKS[mark].label} sub={MARKS[mark].hint} checked={block.mark === mark} onClick={() => onMark(mark)} />
                ))}
                <Divider variant="menu" />
              </>
            )}
            {index > 0 && <MenuItem icon={ArrowUp} label="위로 옮기기" onClick={() => onMove(index - 1)} />}
            {index < count - 1 && <MenuItem icon={ArrowDown} label="아래로 옮기기" onClick={() => onMove(index + 1)} />}
            <MenuItem icon={X} tone="warn" label="빼기" onClick={onRemove} />
          </Menu>
        </Row>
      </Stack>
      {block.kind === 'text' && block.mark && (
        <Text size="sm" tone="muted">
          {`캐릭터 카드에 ‘${MARKS[block.mark].card}’가 있으면 이 글 대신 그 글이 들어가요. 카드 글 속 {{original}}에는 이 글이 들어가요.`}
        </Text>
      )}
      {block.kind === 'slot' && <Text>{SLOT[block.slot].line}</Text>}
      {block.kind === 'text' && (
        <MarkupArea
          ref={textRef}
          label="글"
          value={block.text}
          placeholder={block.mark === 'globalNote' ? '비워 두면, 카드에 대화 뒤 지시문이 없을 때 여기서는 아무것도 보내지 않아요.' : '모델에게 보낼 글을 써요.'}
          onChange={(text) => onChange({ ...block, text })}
        />
      )}
      {block.kind === 'slot' && block.slot === 'chat' && <ChatRange block={block} onChange={onChange} />}
      {block.kind === 'slot' && block.slot === 'authorNote' && (
        <Section title="채팅에 노트가 없을 때 쓰는 글" level={3} note="비워 두면 노트가 없는 채팅에는 아무것도 들어가지 않아요.">
          <MarkupArea label="채팅에 노트가 없을 때 쓰는 글" variant="field" value={authorNote} onChange={onAuthorNote} />
        </Section>
      )}
      {'wrapper' in block &&
        (block.wrapper === null ? (
          <Row kind="actions">
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange({ ...block, wrapper: '{{slot}}' })}>
              감싸는 글 넣기
            </Button>
          </Row>
        ) : (
          <Section
            title="감싸는 글"
            level={3}
            note={`{{slot}} 자리에 ${SLOT[block.slot].name}이(가) 들어가요.`}
            action={
              <Button variant="ghost" size="xs" onClick={onUnwrap}>
                빼기
              </Button>
            }
          >
            <MarkupArea label="감싸는 글" variant="field" value={block.wrapper} onChange={(wrapper) => onChange({ ...block, wrapper })} />
          </Section>
        ))}
    </Stack>
  );
}

function ChatRange({ block, onChange }: { block: Extract<Block, { slot: 'chat' }>; onChange: (block: Block) => void }) {
  const current = rangeKey(block.range);
  const known = RANGES.some((option) => rangeKey(option.range) === current);
  const options = [...RANGES, ...(known ? [] : [{ range: block.range, ...describeRange(block.range) }])];
  return (
    <ChoiceGroup
      label="들어갈 메시지"
      layout="list"
      options={options.map((option) => ({ value: rangeKey(option.range), label: option.label }))}
      value={current}
      onChange={(key) => onChange({ ...block, range: options.find((option) => rangeKey(option.range) === key)!.range })}
    />
  );
}
