// {{user}} is its name, and the 페르소나 slot holds its description. picture is a small copy made like an
// avatar's thumb; personas keep no original. alias: 별명, as on a character. deleted and purging: model/library Mark.
export type Persona = { name: string; description: string; picture: string | null; alias?: string; deleted?: number; purging?: true };
