import { useLibrary } from '../../session';
import { Button, Divider, Menu, MenuItem, SelectionBar } from '../../ui';

type Props = {
  count: number;
  onCancel: () => void;
  // to null takes them out of their folders.
  onMove: (to: string | null) => void;
};

export function MoveBar({ count, onCancel, onMove }: Props) {
  const { folders } = useLibrary();
  return (
    <SelectionBar>
      <span>{count ? `${count}명 선택됨` : '옮길 캐릭터를 선택하세요'}</span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        취소
      </Button>
      <Menu
        place="above-end"
        label="옮길 폴더"
        trigger={(opener) => (
          <Button size="sm" disabled={count === 0 || folders.length === 0} {...opener}>
            폴더로 옮기기
          </Button>
        )}
      >
        {folders.flatMap((candidate) => [
          <MenuItem key={candidate.id} label={candidate.value.name} onClick={() => onMove(candidate.id)} />,
          ...candidate.children.map((child) => <MenuItem key={child.id} label={`${candidate.value.name} › ${child.value.name}`} onClick={() => onMove(child.id)} />),
        ])}
        <Divider variant="menu" />
        <MenuItem label="폴더에서 빼기" onClick={() => onMove(null)} />
      </Menu>
    </SelectionBar>
  );
}
