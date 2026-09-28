import { ExternalLink, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DeviceCode } from '../../connectors/device-code';
import type { Connection, ConnectionType, SignIn } from '../../connectors/types';
import { accountName, awaitApproval, requestCode } from '../../runtime/sign-in';
import { describeSignInFailure } from '../common/failure';
import { useSession } from '../session';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, CodeCard, Intro, NavBar, Screen, Text } from '../ui';
import { connect } from './connect';

type Stage = { step: 'starting' } | { step: 'code'; code: DeviceCode } | { step: 'connecting' } | { step: 'failed'; message: string };

// F5 for a type connected by signing in: the provider's own site takes a short code, and this screen
// waits for the approval, then checks the model list and saves the connection, as a pasted key does.
export function ConnectionSignInScreen({ type, signIn, back }: { type: ConnectionType; signIn: SignIn; back: Back }) {
  const session = useSession();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>({ step: 'starting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    const fail = (message: string) => signal.aborted || setStage({ step: 'failed', message });
    setStage({ step: 'starting' });
    void (async () => {
      const started = await requestCode(signIn, signal);
      if (!started.ok) return fail(describeSignInFailure(started.failure, signIn.site));
      setStage({ step: 'code', code: started.code });
      const approved = await awaitApproval(signIn, started.code, signal);
      if (!approved.ok) return fail(describeSignInFailure(approved.failure, signIn.site));
      setStage({ step: 'connecting' });
      const account = await accountName(signIn, approved.secret, signal);
      if (!account.ok) return fail(describeSignInFailure(account.failure, signIn.site));
      const connection: Connection = {
        type: type.id,
        label: `${type.label} · ${account.name}`,
        baseUrl: null,
        protocol: null,
        secret: approved.secret,
        starred: [],
      };
      const failure = await connect(session, connection, signal);
      if (failure) fail(failure);
    })();
    return () => abort.abort();
  }, [type, signIn, session, attempt]);

  // The copy starts before the new tab takes focus, which the clipboard needs.
  function openSite(code: DeviceCode) {
    navigator.clipboard.writeText(code.userCode).then(
      () => toast.show('코드를 복사했어요.'),
      () => {},
    );
    window.open(code.verificationUri, '_blank', 'noopener');
  }

  const top = <NavBar title={`${type.label} 연결`} onBack={() => navigate(back.to)} backLabel={back.label} />;

  if (stage.step === 'failed') {
    return (
      <Screen
        top={top}
        actions={
          <Button icon={RotateCw} onClick={() => setAttempt((count) => count + 1)}>
            다시 하기
          </Button>
        }
      >
        <Intro title="연결하지 못했어요" />
        <Callout tone="warn" alert>
          {stage.message}
        </Callout>
      </Screen>
    );
  }

  if (stage.step === 'code') {
    const { code } = stage;
    return (
      <Screen
        top={top}
        actions={
          <>
            <Text size="sm" tone="muted">
              승인을 기다리고 있어요. 코드는 {Math.round(code.expiresIn / 60)}분 동안 쓸 수 있어요.
            </Text>
            <Button icon={ExternalLink} onClick={() => openSite(code)}>
              코드 복사하고 {signIn.site} 열기
            </Button>
          </>
        }
      >
        <Intro title={`${signIn.site}에서 이 코드를 넣어 주세요`}>
          {signIn.site}에서 코드를 넣고 승인하면 여기서 저절로 이어져요.
        </Intro>
        <CodeCard label="코드" code={code.userCode} />
      </Screen>
    );
  }

  return (
    <Screen
      top={top}
      actions={
        <Button busy>
          {stage.step === 'starting' ? '코드 받는 중' : '연결하는 중'}
        </Button>
      }
    >
      <Intro title={stage.step === 'starting' ? `${signIn.site} 로그인 준비` : '연결하는 중'}>
        {stage.step === 'starting' ? `${signIn.site}에서 넣을 코드를 받아 오고 있어요.` : `${signIn.site} 계정을 확인하고 모델 목록을 불러오고 있어요.`}
      </Intro>
    </Screen>
  );
}
