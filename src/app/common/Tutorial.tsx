import { GraduationCap } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useConnections, useReplied } from '../session';
import { navigate, useRoute } from '../shell/router';
import { Button, Coach, Dialog, guideShown, List, ListItem, Row, Text, useGuideTarget } from '../ui';
import { stepAt, TUTORIALS, type Facts, type Tutorial } from './tutorial';
import { usePersisted } from './usePersisted';

export const TUTORIAL = { open: '튜토리얼 보기', icon: GraduationCap, title: '헤이젤이 처음이라면', later: '나중에', stop: '그만', resume: '이어 하기', done: '완료' };

// offered: the tutorials to show, none once a reply has come; listed: their titles, a door's note. open: the list;
// welcome: the list at arrival, unless this device closed it before, true when it opened.
type Tutorials = { offered: readonly Tutorial[]; listed: string; open: () => void; welcome: () => boolean };
const TutorialContext = createContext<Tutorials | null>(null);

export function useTutorials(): Tutorials {
  const context = useContext(TutorialContext);
  if (!context) throw new Error('useTutorials outside TutorialProvider');
  return context;
}

function useFacts(): Facts {
  const route = useRoute();
  const connections = useConnections();
  const replied = useReplied();
  return { route, connection: connections[0]?.id ?? null, added: connections.some(({ value }) => value.starred.length > 0), replied };
}

// running: the tutorial being followed on this device, kept across reloads until 그만 or its end is closed.
export function TutorialProvider({ children }: { children: ReactNode }) {
  const facts = useFacts();
  const [runningId, setRunning] = usePersisted('risu-alpha:tutorial', String, '', String);
  const [welcomed, setWelcomed] = usePersisted('risu-alpha:welcome-seen', (stored) => stored === '1', false, (value) => (value ? '1' : ''));
  const [listing, setListing] = useState(false);
  const offered = facts.replied ? [] : TUTORIALS;
  const running = TUTORIALS.find(({ id }) => id === runningId) ?? null;

  function close() {
    setListing(false);
    setWelcomed(true);
  }

  // Started where the step's control is on screen (the empty home's 새 연결), else at the step's place.
  function start(tutorial: Tutorial) {
    close();
    setRunning(tutorial.id);
    const at = stepAt(tutorial, facts);
    const step = at === null ? null : tutorial.steps[at]!;
    if (step && !guideShown(step.mark)) navigate(step.at(facts));
  }

  function welcome() {
    if (welcomed) return false;
    setListing(true);
    return true;
  }

  const tutorials: Tutorials = { offered, listed: offered.map(({ title }) => title).join(' · '), open: () => setListing(true), welcome };
  return (
    <TutorialContext.Provider value={tutorials}>
      {children}
      {listing && (
        <Dialog
          title={TUTORIAL.title}
          onClose={close}
          actions={
            <Button variant="secondary" onClick={close}>
              {TUTORIAL.later}
            </Button>
          }
        >
          <List label={TUTORIAL.title} places>
            {offered.map((tutorial) => (
              <ListItem key={tutorial.id} title={tutorial.title} description={tutorial.description} onClick={() => start(tutorial)} />
            ))}
          </List>
        </Dialog>
      )}
      {running && <Running tutorial={running} facts={facts} onEnd={() => setRunning('')} />}
    </TutorialContext.Provider>
  );
}

// A step's control can take a moment to come after its screen: the note docks only once it has been missing a while.
const DOCK_AFTER = 400;

function Running({ tutorial, facts, onEnd }: { tutorial: Tutorial; facts: Facts; onEnd: () => void }) {
  const at = stepAt(tutorial, facts);
  const step = at === null ? null : tutorial.steps[at]!;
  const target = useGuideTarget((step ?? tutorial.steps.at(-1)!).mark);
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (target) return setDocked(false);
    const timer = window.setTimeout(() => setDocked(true), DOCK_AFTER);
    return () => window.clearTimeout(timer);
  }, [target]);
  if (!target && !docked) return null;

  if (!step) {
    return (
      <Coach target={target} title={tutorial.finish.title}>
        <Text>{tutorial.finish.text}</Text>
        <Row kind="actions">
          <Button size="sm" onClick={onEnd}>
            {TUTORIAL.done}
          </Button>
        </Row>
      </Coach>
    );
  }
  return (
    <Coach target={target} title={tutorial.title} note={`${at! + 1}/${tutorial.steps.length}`} above={step.above}>
      {target && <Text>{step.text}</Text>}
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={onEnd}>
          {TUTORIAL.stop}
        </Button>
        {!target ? (
          <Button size="sm" onClick={() => navigate(step.at(facts))}>
            {TUTORIAL.resume}
          </Button>
        ) : (
          step.go && (
            <Button size="sm" onClick={() => navigate(step.go!.route)}>
              {step.go.label}
            </Button>
          )
        )}
      </Row>
    </Coach>
  );
}
