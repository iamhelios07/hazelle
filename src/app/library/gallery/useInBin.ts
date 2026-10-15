import { useBin, useLibrary } from '../../session';

// How many rows 휴지통 lists, characters, chats and everything else together.
export function useInBin() {
  const { deleted, deletedChats } = useLibrary();
  const bin = useBin();
  return deleted.length + deletedChats.length + bin.modules.length + bin.prompts.length + bin.personas.length + bin.profiles.length;
}
