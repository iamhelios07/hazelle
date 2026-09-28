import { describe, expect, it } from 'vitest';
import { copilot } from './copilot';
import { codeRequest, parseCode, parsePoll, pollRequest } from './device-code';

const signIn = copilot.signIn!;

describe('device code sign-in', () => {
  it('asks for a code and polls with form bodies that ask for JSON back', () => {
    const start = codeRequest(signIn);
    expect(start).toMatchObject({ url: 'https://github.com/login/device/code', method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'GitHubCopilotChat/0.37.4' } });
    expect(start.body).toBe('client_id=01ab8ac9400c4e429b23&scope=user%3Aemail');
    expect(pollRequest(signIn, 'dc').body).toBe('client_id=01ab8ac9400c4e429b23&device_code=dc&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
  });

  it('reads the code, with the standard interval when none is given, and only an https page', () => {
    const payload = { device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 };
    expect(parseCode(payload)).toEqual({ deviceCode: 'dc', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 899, interval: 5 });
    expect(parseCode({ ...payload, interval: undefined })?.interval).toBe(5);
    expect(parseCode({ ...payload, verification_uri: 'javascript:alert(1)' })).toBeNull();
    expect(parseCode({ ...payload, expires_in: undefined })).toBeNull();
    expect(parseCode({ error: 'unauthorized_client' })).toBeNull();
  });

  it('tells waiting, slowing down, approval and refusal apart', () => {
    expect(parsePoll({ error: 'authorization_pending', error_description: '…' })).toEqual({ state: 'pending' });
    expect(parsePoll({ error: 'slow_down', interval: 10 })).toEqual({ state: 'slow-down', interval: 10 });
    expect(parsePoll({ error: 'slow_down' })).toEqual({ state: 'slow-down', interval: null });
    expect(parsePoll({ access_token: 'gho_x', token_type: 'bearer', scope: 'user:email' })).toEqual({ state: 'done', secret: 'gho_x' });
    expect(parsePoll({ error: 'access_denied' })).toEqual({ state: 'failed', code: 'access_denied' });
    expect(parsePoll({ message: 'Not Found' })).toBeNull();
  });
});
