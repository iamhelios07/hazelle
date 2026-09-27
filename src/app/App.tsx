import { useEffect, useState } from 'react';
import { api } from './api';
import { AccountScreen } from './screens/AccountScreen';
import { describeFailure } from './screens/failure';
import { SignedInScreen } from './screens/SignedInScreen';
import { UnreachableScreen } from './screens/UnreachableScreen';

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'signed-out'; signupOpen: boolean }
  | { kind: 'signed-in'; username: string };

async function loadState(): Promise<State> {
  const session = await api<{ username: string }>('GET', 'session');
  if (session.ok) return { kind: 'signed-in', username: session.data.username };
  if (session.error !== 'no-session') return { kind: 'unreachable', message: describeFailure(session) };
  const signup = await api<{ open: boolean }>('GET', 'signup');
  if (!signup.ok) return { kind: 'unreachable', message: describeFailure(signup) };
  return { kind: 'signed-out', signupOpen: signup.data.open };
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const reload = () => {
    setState({ kind: 'loading' });
    void loadState().then(setState);
  };

  useEffect(() => {
    void loadState().then(setState);
  }, []);

  switch (state.kind) {
    case 'loading':
      return null;
    case 'unreachable':
      return <UnreachableScreen message={state.message} onRetry={reload} />;
    case 'signed-out':
      return (
        <AccountScreen
          mode={state.signupOpen ? 'signup' : 'login'}
          onSignedIn={(username) => setState({ kind: 'signed-in', username })}
        />
      );
    case 'signed-in':
      return <SignedInScreen username={state.username} onSignedOut={() => setState({ kind: 'signed-out', signupOpen: false })} />;
  }
}
