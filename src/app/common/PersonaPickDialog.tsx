import { useEffect, useRef, type ReactNode } from 'react';
import { usePersonas } from '../session';
import { CardGrid, Dialog, Empty, FaceCard, hasFinePointer } from '../ui';
import { personaFaces, personaTexts } from './alias';
import { useSearch } from './useSearch';

type Props = { title: string; using: string | null; pinned?: string; onChoose: (id: string) => void; onClose: () => void; footer?: ReactNode };

// Mounted only while open, so each opening starts with an empty search. A touch screen gets no focused search, whose
// keyboard would cover half the faces.
export function PersonaPickDialog({ title, using, pinned, onChoose, onClose, footer }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const search = useSearch(personaFaces(usePersonas()), '페르소나 검색', personaTexts, { ref: field, onEnter: ({ persona }) => onChoose(persona.id) });
  useEffect(() => {
    if (hasFinePointer()) field.current?.focus();
  }, []);
  return (
    <Dialog title={title} size="wide" onClose={onClose} toolbar={search.field || undefined} footer={footer}>
      {search.none && <Empty>{search.none}</Empty>}
      <CardGrid label="페르소나" variant="face" current={using ?? undefined} keys={search.found.map(({ persona: { id } }) => id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = search.found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} current={id === using} tag={id === pinned ? '고정' : undefined} onClick={() => onChoose(id)} />;
        }}
      </CardGrid>
    </Dialog>
  );
}
