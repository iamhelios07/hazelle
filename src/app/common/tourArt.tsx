import { Lock, MessageSquare, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sketch, Tag } from '../ui';
import type { TourArt } from './release';
import { BOARD } from './words';

// The pictures a tour page names (release.ts TourArt), each a Sketch of the screen it talks about.
export const tourArt: Record<TourArt, ReactNode> = {
  'board-list': (
    <Sketch>
      <Sketch.Row>
        <Tag>{BOARD.categories.bug}</Tag>
        <Sketch.Line width="long" />
        <Sketch.Mark icon={ThumbsUp} count={3} />
      </Sketch.Row>
      <Sketch.Row accent>
        <Tag tone="accent">{BOARD.categories.idea}</Tag>
        <Sketch.Line width="medium" />
        <Sketch.Mark icon={ThumbsUp} count={12} lit />
      </Sketch.Row>
      <Sketch.Row>
        <Tag>{BOARD.categories.talk}</Tag>
        <Sketch.Line width="long" />
        <Sketch.Mark icon={MessageSquare} count={5} />
      </Sketch.Row>
    </Sketch>
  ),
  'board-thread': (
    <Sketch badge={2}>
      <Sketch.Row>
        <Sketch.Line width="long" />
        <Sketch.Mark icon={MessageSquare} count={2} />
      </Sketch.Row>
      <Sketch.Row>
        <Sketch.Line width="short" />
        <Sketch.Line width="medium" />
      </Sketch.Row>
      <Sketch.Row indent accent>
        <Sketch.Line width="short" />
        <Sketch.Line width="long" />
      </Sketch.Row>
    </Sketch>
  ),
  'board-operator': (
    <Sketch>
      <Sketch.Row accent>
        <Tag tone="accent">{BOARD.operatorOnly}</Tag>
        <Sketch.Line width="medium" />
        <Sketch.Mark icon={Lock} lit />
      </Sketch.Row>
      <Sketch.Row indent>
        <Tag>운영자</Tag>
        <Sketch.Line width="long" />
      </Sketch.Row>
    </Sketch>
  ),
};
