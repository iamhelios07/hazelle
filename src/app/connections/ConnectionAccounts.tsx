import { ArrowDown, ArrowUp, ExternalLink, LogIn, MoreHorizontal, Pencil, Plus, RotateCw, Trash2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { resolveConnection } from '../../connectors/registry';
import type { Account, Connection, Group, SignIn, Turns } from '../../connectors/types';
import { pace } from '../../model/pace';
import { addGroup, moveAccount, moveAccountOrder, moveGroup, removeGroup, renameGroup, schedule, setDay, takeTurn } from '../../model/turns';
import type { MetersResult } from '../../runtime/meters';
import { addAccount, changeTurns, newAccount, putAccountBack, removeAccount } from '../../runtime/connections';
import { accountName } from '../../runtime/pool';
import { describeMetersFailure } from '../common/failure';
import { monthDay } from '../common/time';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, CodeCard, IconButton, Link, List, ListItem, Menu, MenuItem, NumberInput, Row, Section, Stack, Text, TextField, useMenuClose } from '../ui';
import { fact, figure, useMeters } from './ConnectionMeters';
import { useDeviceSignIn } from './useDeviceSignIn';

// Who serves a reply: the current group's first account with allowance left (runtime/pool).
const HELP =
  '그룹은 매달 바꾸는 날에 차례를 넘겨요. 답장은 지금 차례인 그룹에서 위에서부터 한도가 남은 첫 계정으로 보내요. 한도를 다 쓴 계정만 건너뛰어요. ' +
  '쓴 비율은 이번 주기 한도 가운데 쓴 몫이고, 균등은 주기 내내 고르게 썼다면 지금까지 썼을 몫이에요. 그룹이 여럿이면 주기는 초기화와 그 그룹 차례가 겹치는 기간이에요. 하루 얼마는 남은 한도를 주기 끝까지 고르게 쓰는 양이에요.';

export function ConnectionAccounts({ id, connection, signIn }: { id: string; connection: Connection & { turns: Turns }; signIn: SignIn }) {
  const { store } = useSession();
  const toast = useToast();
  const [signing, setSigning] = useState<{ for: Account | null } | null>(null);
  const now = Date.now();
  const { timeline, window } = schedule(connection.turns, now);
  const next = timeline[1];
  const usagePage = resolveConnection(connection)?.type?.usagePage;

  const turns = (change: (turns: Turns) => Turns | null) => void changeTurns(store, id, change).then((result) => result.ok || toast.failed(result));

  function remove(account: Account) {
    void removeAccount(store, id, account.id).then((result) => {
      if (!result.ok) return toast.failed(result);
      toast.undoable(`${accountName(account)} 계정을 뺐어요.`, () => void putAccountBack(store, id, result.data).then((back) => back.ok || toast.failed(back)));
    });
  }

  return (
    <Section
      title="계정"
      note={next ? `${monthDay(next.startsAt)}에 ${next.group.name} 차례` : undefined}
      hint={HELP}
      action={
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setSigning({ for: null })}>
          계정 추가
        </Button>
      }
    >
      <Stack gap="group">
        {signing && (
          <AccountSignIn
            key={signing.for?.id ?? 'new'}
            signIn={signIn}
            again={signing.for}
            onClose={() => setSigning(null)}
            onApproved={(secret, name) => {
              const known = connection.accounts.some((account) => account.name === name);
              void addAccount(store, id, newAccount(secret, name)).then((result) => result.ok || toast.failed(result));
              toast.show(known ? `${name} 계정에 다시 로그인했어요.` : `${name} 계정을 추가했어요.`);
              setSigning(null);
            }}
          />
        )}
        {timeline.map(({ group, startsAt, endsAt }, index) => (
          <List key={group.id} label={group.name}>
            <ListItem
              title={group.name}
              tags={index === 0 ? ['지금 차례'] : []}
              description={index === 0 ? undefined : `${monthDay(startsAt)}부터`}
              trailing={<GroupMenu turns={connection.turns} group={group} current={index === 0} change={turns} />}
            >
              {group.accounts.length ? (
                group.accounts.map((accountId, at) => {
                  const account = connection.accounts.find((entry) => entry.id === accountId);
                  return account ? (
                    <AccountRow
                      key={account.id}
                      connection={connection}
                      account={account}
                      group={group}
                      at={at}
                      // One group's turn never ends, so only the reset bounds its pace.
                      turn={window ? { start: startsAt, end: endsAt } : null}
                      change={turns}
                      onSignIn={() => setSigning({ for: account })}
                      onRemove={() => remove(account)}
                    />
                  ) : null;
                })
              ) : (
                <ListItem title="계정 없음" description={index === 0 ? '지금 차례인데 계정이 없어서 답장을 보낼 수 없어요.' : undefined} />
              )}
            </ListItem>
          </List>
        ))}
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => turns((current) => addGroup(current, crypto.randomUUID(), Date.now()))}>
            그룹 추가
          </Button>
          <DayMenu day={connection.turns.day} change={turns} />
          {usagePage && <Link href={usagePage}>사용량 페이지</Link>}
        </Row>
      </Stack>
    </Section>
  );
}

function meterLine(result: MetersResult, turn: { start: number; end: number } | null): string {
  const [failure] = result.failures;
  if (!result.meters.length) return failure ? describeMetersFailure(failure) : '한도 수치를 알려 주지 않았어요.';
  return result.meters
    .flatMap((meter) => {
      const { label, value } = fact(meter);
      const paced = pace(meter, Date.now(), turn);
      return [`${label} ${value}`, ...(paced ? [`${paced.used}% 씀 · 지금쯤 균등 ${paced.even}% · 남은 ${paced.daysLeft}일 하루 ${figure(meter.unit, paced.perDay)}씩`] : [])];
    })
    .join(' · ');
}

type RowProps = {
  connection: Connection & { turns: Turns };
  account: Account;
  group: Group;
  at: number;
  turn: { start: number; end: number } | null;
  change: (change: (turns: Turns) => Turns | null) => void;
  onSignIn: () => void;
  onRemove: () => void;
};

function AccountRow({ connection, account, group, at, turn, change, onSignIn, onRemove }: RowProps) {
  const { result, retry } = useMeters(connection, account);
  const name = accountName(account);
  const others = connection.turns.groups.filter((entry) => entry.id !== group.id);
  return (
    <ListItem
      title={name}
      tags={result?.plan ? [result.plan] : []}
      description={result ? meterLine(result, turn) : '사용량 불러오는 중…'}
      trailing={
        <Menu place="below-end" label={`${name} 메뉴`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${name} 메뉴`} size="sm" {...opener} />}>
          <MenuItem icon={ArrowUp} label="위로" disabled={at === 0} onClick={() => change((turns) => moveAccountOrder(turns, account.id, -1))} />
          <MenuItem icon={ArrowDown} label="아래로" disabled={at === group.accounts.length - 1} onClick={() => change((turns) => moveAccountOrder(turns, account.id, 1))} />
          {others.map((other) => (
            <MenuItem key={other.id} label={`${other.name}으로 옮기기`} onClick={() => change((turns) => moveAccount(turns, account.id, other.id))} />
          ))}
          <MenuItem icon={RotateCw} label="사용량 다시 불러오기" onClick={retry} />
          <MenuItem icon={LogIn} label="다시 로그인" onClick={onSignIn} />
          <MenuItem icon={UserMinus} label="빼기" tone="warn" disabled={connection.accounts.length === 1} onClick={onRemove} />
        </Menu>
      }
    />
  );
}

function GroupMenu({ turns, group, current, change }: { turns: Turns; group: Group; current: boolean; change: (change: (turns: Turns) => Turns | null) => void }) {
  const position = schedule(turns, Date.now()).timeline.findIndex((entry) => entry.group.id === group.id);
  return (
    <Row kind="actions">
      <Menu kind="dialog" place="below-end" label={`${group.name} 이름 바꾸기`} trigger={(opener) => <IconButton icon={Pencil} label={`${group.name} 이름 바꾸기`} size="sm" {...opener} />}>
        <RenameForm name={group.name} onSave={(name) => change((current) => renameGroup(current, group.id, name))} />
      </Menu>
      <Menu place="below-end" label={`${group.name} 메뉴`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${group.name} 메뉴`} size="sm" {...opener} />}>
        <MenuItem label="지금 차례로" disabled={current} onClick={() => change((current) => takeTurn(current, group.id, Date.now()))} />
        <MenuItem icon={ArrowUp} label="앞 차례로" disabled={position < 2} onClick={() => change((current) => moveGroup(current, group.id, -1, Date.now()))} />
        <MenuItem icon={ArrowDown} label="뒤 차례로" disabled={position < 1 || position === turns.groups.length - 1} onClick={() => change((current) => moveGroup(current, group.id, 1, Date.now()))} />
        <MenuItem icon={Trash2} label="그룹 지우기" tone="warn" disabled={group.accounts.length > 0 || turns.groups.length === 1} onClick={() => change((current) => removeGroup(current, group.id, Date.now()))} />
      </Menu>
    </Row>
  );
}

function RenameForm({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const close = useMenuClose();
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    onSave(trimmed);
    close();
  }
  return (
    <form onSubmit={submit}>
      <Stack gap="related">
        <TextField label="그룹 이름" value={value} onChange={setValue} error={trimmed ? undefined : '이름을 적어 주세요.'} />
        <Button type="submit" size="sm" disabled={!trimmed}>
          저장
        </Button>
      </Stack>
    </form>
  );
}

function DayMenu({ day, change }: { day: number; change: (change: (turns: Turns) => Turns | null) => void }) {
  return (
    <Menu kind="dialog" label="바꾸는 날" trigger={(opener) => <Button variant="secondary" size="sm" {...opener}>{`매달 ${day}일에 바꿈`}</Button>}>
      <DayForm day={day} onSave={(next) => change((turns) => setDay(turns, next, Date.now()))} />
    </Menu>
  );
}

function DayForm({ day, onSave }: { day: number; onSave: (day: number) => void }) {
  const close = useMenuClose();
  const [value, setValue] = useState(String(day));
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 28;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSave(parsed);
    close();
  }
  return (
    <form onSubmit={submit}>
      <Stack gap="related">
        <NumberInput label="바꾸는 날 (1–28일)" value={value} onChange={setValue} invalid={!valid} unit="일" />
        <Button type="submit" size="sm" disabled={!valid}>
          저장
        </Button>
      </Stack>
    </form>
  );
}

function AccountSignIn({ signIn, again, onClose, onApproved }: { signIn: SignIn; again: Account | null; onClose: () => void; onApproved: (secret: string, name: string) => void }) {
  const [attempt, setAttempt] = useState(0);
  const { stage, openSite } = useDeviceSignIn(signIn, attempt, async (secret, name) => {
    onApproved(secret, name);
    return null;
  });
  const title = again ? `${accountName(again)} 다시 로그인` : `${signIn.site} 계정 추가`;
  return (
    <Stack gap="related">
      <Text variant="highlight">{title}</Text>
      {stage.step === 'failed' ? (
        <Callout tone="warn" alert action={{ label: '다시 시도', onClick: () => setAttempt((count) => count + 1) }}>
          {stage.message}
        </Callout>
      ) : stage.step === 'code' ? (
        <>
          <CodeCard label="코드" code={stage.code.userCode} />
          <Button icon={ExternalLink} onClick={() => openSite(stage.code)}>
            코드 복사하고 {signIn.site} 열기
          </Button>
        </>
      ) : (
        <Text variant="note">{stage.step === 'starting' ? '코드 받는 중…' : `${signIn.site} 계정을 확인하는 중…`}</Text>
      )}
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>
      </Row>
    </Stack>
  );
}
