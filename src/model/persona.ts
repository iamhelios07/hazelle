// Kind `persona` (design §4.3): {{user}} is its name, and the 페르소나 slot holds its description.
// picture is a small copy made like an avatar's thumb; personas keep no original.
// nickname: 별명, the user's own note to tell apart personas of one name; it is never sent (runtime/turn takes only the
// name and the description). Personas made before it have none.
export type Persona = { name: string; description: string; picture: string | null; nickname?: string };
