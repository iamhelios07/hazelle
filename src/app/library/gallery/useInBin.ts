import { useBin, useLibrary } from '../../session';

export function useInBin() {
  const { deleted, deletedChats } = useLibrary();
  const bin = useBin();
  return deleted.length + deletedChats.length + bin.modules.length + bin.prompts.length + bin.personas.length + bin.profiles.length;
}
