import { cost, tokens } from '../common/receipt';
import { STOP } from '../common/words';
import { Button, Callout, Progress, Row, Section, SidePanel, Stack, Text, TextField } from '../ui';
import type { RunEnd } from './autopilot';
import type { Autopilot, Outlook } from './useAutopilot';

const HOW = '위에서부터 하나씩 보내고, 응답이 끝나면 다음 메시지를 보내요. 시작하면 마지막 메시지의 새 버전에서 이어 가서, 지금까지의 대화는 버전을 바꿔 다시 볼 수 있어요. 실패하거나 멈추면 거기서 끝나요. 채팅을 나가면 다음 메시지는 보내지 않아요.';

type Props = { autopilot: Autopilot; busy: boolean; onClose: () => void };

export function ChatAutopilot({ autopilot: { text, messages, outlook, running, end, write, start, stop }, busy, onClose }: Props) {
  return (
    <SidePanel title="오토파일럿" onClose={onClose}>
      <TextField label="보낼 메시지" lines={8} value={text} onChange={write} readOnly={running !== null} hint="한 줄에 메시지 하나씩 보내요." help={HOW} />
      {running ? (
        <Stack gap="related">
          <Progress steps={[{ label: '보내는 중', done: running.at + 1, total: running.total }]} />
          <Text>{running.text}</Text>
          <Row kind="actions">
            <Button variant="secondary" onClick={stop}>{STOP}</Button>
          </Row>
        </Stack>
      ) : (
        <>
          <Section title="예상 비용" help={basis(outlook)}>
            {outlook.kind === 'unsendable' ? <Callout tone="warn">{outlook.why}</Callout> : <Text>{`메시지 ${messages.length}개 · ${costLine(outlook)}`}</Text>}
          </Section>
          <Row kind="actions">
            <Button variant="primary" disabled={!messages.length || busy || outlook.kind === 'unsendable'} onClick={() => void start()}>시작</Button>
          </Row>
        </>
      )}
      {end && <Ended end={end} />}
    </SidePanel>
  );
}

function costLine(outlook: Exclude<Outlook, { kind: 'unsendable' }>): string {
  if (outlook.kind === 'pending') return '계산하는 중…';
  if (outlook.kind === 'unknown') return '비용은 알 수 없어요';
  return outlook.cost ? cost(outlook.cost) : `입력 약 ${tokens(outlook.input)} 토큰 · 비용은 알 수 없어요`;
}

function basis(outlook: Outlook): string | undefined {
  if (outlook.kind !== 'estimate') return undefined;
  if (!outlook.priced) return '이 모델의 가격을 몰라서 비용을 셀 수 없어요.';
  if (outlook.output === null) return '이 채팅에 길이를 아는 응답이 없어서 비용을 셀 수 없어요.';
  return '메시지마다 다음 요청의 입력과 이 채팅의 지난 응답 길이만큼 든다고 셌어요. 대화가 길어지는 만큼은 빠져 있고, 캐시를 읽으면 덜 들어요.';
}

function Ended({ end }: { end: RunEnd }) {
  switch (end.kind) {
    case 'done':
      return <Callout tone="success">{`메시지 ${end.sent}개를 모두 보냈어요.`}</Callout>;
    case 'stopped':
      return <Text>{end.sent ? `메시지 ${end.sent}개를 보내고 멈췄어요.` : '보내기 전에 멈췄어요.'}</Text>;
    case 'failed':
      return <Callout tone="warn">{`${end.at + 1}번째 메시지 '${end.text}'에서 멈췄어요. ${end.why}`}</Callout>;
    case 'unbranched':
      return <Callout tone="warn">{`새 버전을 만들지 못해서 시작하지 않았어요. ${end.why}`}</Callout>;
  }
}
