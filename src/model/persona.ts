// Kind `persona` (design §4.3): {{user}} is its name, and the 페르소나 slot holds its description.
// picture is a small copy made like an avatar's thumb; personas keep no original.
export type Persona = { name: string; description: string; picture: string | null };
