import type { ConnectionType } from './types';

export const google: ConnectionType = {
  id: 'google',
  label: 'Google',
  group: 'maker',
  major: true,
  description: 'Gemini API로 Gemini를 사용해요.',
  keyPage: 'https://aistudio.google.com/apikey',
  endpoint: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini' },
  detect: { key: /^AIza[0-9A-Za-z_-]{35}$/, host: 'generativelanguage.googleapis.com' },
};
