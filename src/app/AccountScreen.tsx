import { useState, type FormEvent } from 'react';
import { api, type ApiFailure } from './api';

const MESSAGES: Record<string, string> = {
  'wrong-login': '아이디나 비밀번호가 맞지 않아요.',
  'bad-username': '아이디는 2–32자의 글자, 숫자, _ . - 로만 만들 수 있어요.',
  'short-password': '비밀번호는 8자 이상이어야 해요.',
  'signup-closed': '이미 계정이 있어요. 새로고침한 뒤 로그인해 주세요.',
  offline: '서버에 닿지 못했어요. 연결을 확인해 주세요.',
};

export function describeFailure(failure: ApiFailure): string {
  if (failure.error === 'too-many-attempts' && failure.retryAfter !== undefined) {
    return `시도가 너무 많았어요. ${Math.ceil(failure.retryAfter / 60)}분 뒤에 다시 해 주세요.`;
  }
  return MESSAGES[failure.error] ?? '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';
}

export function AccountScreen({ mode, onSignedIn }: { mode: 'signup' | 'login'; onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (signup && password !== again) {
      setMessage('두 비밀번호가 달라요.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api<{ username: string }>('POST', mode, { username: username.trim(), password });
    setBusy(false);
    if (result.ok) onSignedIn(result.data.username);
    else setMessage(describeFailure(result));
  }

  return (
    <main className="screen">
      <header className="brand">risu-alpha</header>
      <div className="intro">
        <h1>{signup ? '계정 만들기' : '로그인'}</h1>
        {signup && <p>어느 기기에서든 같은 채팅을 이어가기 위한 로그인이에요.</p>}
      </div>
      <form className="form" onSubmit={submit}>
        <label className="field">
          아이디
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          {signup ? '로그인 비밀번호' : '비밀번호'}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            placeholder={signup ? '8자 이상' : undefined}
            required
          />
        </label>
        {signup && (
          <label className="field">
            한 번 더
            <input
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              autoComplete="new-password"
              placeholder="같은 비밀번호"
              required
            />
          </label>
        )}
        {message && (
          <p className="message" role="alert">
            {message}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '확인하는 중…' : signup ? '계정 만들기' : '로그인'}
        </button>
      </form>
    </main>
  );
}
