import { useEffect, useState } from 'react';
import { AccountScreen, describeFailure } from './AccountScreen';
import { api } from './api';

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
      return (
        <main className="screen">
          <header className="brand">risu-alpha</header>
          <div className="intro">
            <h1>연결할 수 없어요</h1>
            <p>{state.message}</p>
          </div>
          <button className="primary" onClick={reload}>
            다시 시도
          </button>
        </main>
      );
    case 'signed-out':
      return (
        <AccountScreen
          mode={state.signupOpen ? 'signup' : 'login'}
          onSignedIn={(username) => setState({ kind: 'signed-in', username })}
        />
      );
    case 'signed-in':
      return <SignedIn username={state.username} onSignedOut={() => setState({ kind: 'signed-out', signupOpen: false })} />;
  }
}

// Stands in for the home screen until the vault slice adds F1 steps 2–4 (design §2).
function SignedIn({ username, onSignedOut }: { username: string; onSignedOut: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function logout() {
    const result = await api('POST', 'logout');
    if (result.ok) onSignedOut();
    else setMessage(describeFailure(result));
  }

  return (
    <main className="screen">
      <header className="brand">risu-alpha</header>
      <div className="intro">
        <h1>{username}</h1>
        <p>로그인되어 있어요. 금고 만들기와 채팅은 아직 준비 중이에요.</p>
      </div>
      {message && (
        <p className="message" role="alert">
          {message}
        </p>
      )}
      <button className="secondary" onClick={logout}>
        로그아웃
      </button>
    </main>
  );
}
