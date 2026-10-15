import { useState } from 'react';
import { shown, type Chat, type TranslateSwitches } from '../../model/chat';
import { setOwnTranslate, setTranslate, type TranslateSetup } from '../../runtime/characters';
import { translationInput } from '../../runtime/chat-context';
import type { Shown } from '../../runtime/talk';
import { translatorOf } from '../../runtime/translate';
import { languageLabel } from '../common/languages';
import { useSession, useTranslating } from '../session';
import { useToast } from '../toast';

export type TranslationActions = ReturnType<typeof useChatTranslation>['actions'];

export function useChatTranslation(chatId: string, chat: Chat, messages: Shown[], texts: string[], translate: TranslateSetup) {
  const session = useSession();
  const { store, translator } = session;
  const toast = useToast();
  const translating = useTranslating();
  const translation = translatorOf(store, chat);
  const sendLanguage = languageLabel(translate.inputLanguage);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const last = messages.at(-1);
  // 응답 번역 is shown awaited from the reply's first text; whether and when it starts is translateReceived's.
  const awaited = translate.replies && last?.live && texts.at(-1)!.trim() ? last.live : null;

  function translateMessage(message: Shown) {
    translator.translate(chatId, shown(message), translationInput(session, chatId, chat, messages, { kind: 'message', index: messages.indexOf(message) }));
  }

  function flipTranslation(message: Shown) {
    const version = shown(message).id;
    const next = new Set(flipped);
    if (!next.delete(version)) next.add(version);
    setFlipped(next);
  }

  function setSwitches(change: Partial<TranslateSwitches>) {
    void setTranslate(store, chat.character, change).then((saved) => saved.ok || toast.failed(saved));
  }

  function setOwnSwitches(own: boolean) {
    void setOwnTranslate(store, chat.character!, own).then((saved) => saved.ok || toast.failed(saved));
  }

  return {
    translation, sendLanguage, translating, flipped, awaited,
    actions: {
      translate: translateMessage,
      flipTranslation,
      setTranslate: setSwitches,
      setOwnTranslate: setOwnSwitches,
    },
  };
}
