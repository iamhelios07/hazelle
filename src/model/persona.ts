import type { Mark } from './library';

// {{user}} is its name, and the 페르소나 slot holds its description. picture is a small copy made like an avatar's
// thumb; personas keep no original.
// modules: the modules on in its chats, in the order they were turned on, after the character's (design §6.5).
export type Persona = Mark & { name: string; description: string; picture: string | null; alias?: string; modules?: string[]; folder?: string };
