import { isRecord, list } from '../../connectors/values';
import { assemble, imageType, type Resolve } from './card';
import { add, convert, counted, type Tally } from './convert';
import { MOVE_UNSUPPORTED_KINDS, type MoveUnsupportedKind, type Picture, type RisuCharacter, type RisuChat } from './types';

type Json = Record<string, unknown>;
export type Read = () => Promise<Uint8Array<ArrayBuffer>>;
// The backup's entry for a Risu asset key; null when the backup lacks it.
export type Entry = (key: string) => Read | null;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const record = (value: unknown): Json => (isRecord(value) ? value : {});
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const INLAY = /\{\{inlay(?:ed|eddata)?::/;

export async function picture(read: Read): Promise<Picture | null> {
  const bytes = await read();
  const type = imageType(bytes);
  return type ? { bytes, type } : null;
}

// char: a database character, out of cold storage. chats: its chats at their positions, each with its own cold
// payload back, or null when the backup lacks it. Risu's open-time migrations are applied here (spec §8).
export function risuCharacter(char: Json, chats: (Json | null)[], folder: string | null, entry: Entry): RisuCharacter {
  const missed: Tally<MoveUnsupportedKind> = new Map();
  const tally: Tally = new Map();
  // cardJson always builds a v3 card with data, which convert never refuses.
  const converted = convert(cardJson(char), null, tally, list(char.globalLore))!;
  // Any uri other than a Risu asset key points outside the backup.
  const resolve: Resolve = (uri) => {
    const read = uri.startsWith('assets/') ? entry(uri) : null;
    if (!read) add(missed, 'missing-picture');
    return read;
  };
  const imported = assemble('json', converted, resolve, tally);
  const image = text(char.image) && entry(text(char.image));
  if (image === null) add(missed, 'missing-picture');

  const page = Number.isInteger(char.chatPage) && chats[char.chatPage as number] ? (char.chatPage as number) : 0;
  const fmIndex = number(char.firstMsgIndex) ?? -1;
  const greetings = imported.card.greetings.length;
  // Risu turns a module on for one chat too, a place this app does not have: a chat's are on for its character
  // (design §6.5). Only a chat that comes brings its own.
  const modules = new Set(list(char.modules).filter((id) => typeof id === 'string'));
  const brought = chats.flatMap((chat, index) => {
    if (!chat) {
      add(missed, 'cold-missing');
      return [];
    }
    if (list(chat.message).length === 0) return [];
    for (const id of list(chat.modules)) if (typeof id === 'string') modules.add(id);
    // Risu moves the old post-history text into the open chat's note when the character is next opened.
    const note = index === page && text(char.postHistoryInstructions) ? `${text(chat.note)}\n${text(char.postHistoryInstructions)}`.trim() : text(chat.note);
    return [risuChat(chat, note, fmIndex, greetings, missed)];
  });
  add(missed, 'chat-folder', list(char.chatFolders).length);

  return {
    ...imported,
    id: text(char.chaId),
    avatar: image ? () => picture(image) : () => Promise.resolve(null),
    folder,
    chats: brought,
    modules: [...modules],
    missed: counted(MOVE_UNSUPPORTED_KINDS, missed),
  };
}

// Risu keeps a reply's reasoning inside its text, in these blocks, and takes them out again before it draws or sends
// the text (ParseMarkdown, and the prompt builder).
const THOUGHTS = /<Thoughts>([\s\S]*?)<\/Thoughts>/g;

function risuChat(chat: Json, note: string, fmIndex: number, greetings: number, missed: Tally<MoveUnsupportedKind>): RisuChat {
  const messages = list(chat.message).filter(isRecord);
  let at = number(chat.lastDate) ?? 0;
  // 'allBefore' leaves it and every message before it out of the prompt.
  const cut = messages.findLastIndex((message) => message.disabled === 'allBefore');
  for (const [index, message] of messages.entries()) {
    if (index <= cut || message.disabled === true || message.isComment === true) add(missed, 'hidden-message');
    if (INLAY.test(text(message.data))) add(missed, 'inlay');
  }
  if (list(chat.localLore).length > 0) add(missed, 'chat-lore');
  if (text(chat.supaMemoryData).trim() || [chat.hypaV2Data, chat.hypaV3Data].some(holdsData)) add(missed, 'memory');
  add(missed, 'bookmark', list(chat.bookmarks).length);
  return {
    title: text(chat.name),
    note: note.trim() ? note : null,
    persona: text(chat.bindedPersona) || null,
    greeting: Math.min(Math.max((number(chat.fmIndex) ?? fmIndex) + 1, 0), Math.max(greetings - 1, 0)),
    variables: Object.entries(record(chat.scriptstate)).flatMap(([key, value]): [string, string][] =>
      key.startsWith('$') && value !== undefined ? [[key.slice(1), typeof value === 'string' ? value : JSON.stringify(value)]] : [],
    ),
    messages: messages.map((message) => {
      at = number(message.time) ?? at;
      const thoughts: string[] = [];
      const said = text(message.data).replace(THOUGHTS, (_, thought: string) => (thoughts.push(thought.trim()), ''));
      const reasoning = thoughts.filter(Boolean).join('\n\n');
      return { role: message.role === 'user' ? 'user' : 'assistant', text: thoughts.length > 0 ? said.trimStart() : said, at, ...(reasoning && { reasoning }) };
    }),
  };
}

const holdsData = (memory: unknown) => isRecord(memory) && Object.values(memory).some((value) => Array.isArray(value) && value.length > 0);

// Risu's own export of a database character (createBaseV3, spec §6), so the one card converter reads it. Scripts and
// triggers stay in extensions.risuai, where a JSON card holds them. Export quirks are not reproduced: an unset
// character_version stays unset rather than "undefined", and no ccdefault: icon is added, since the avatar comes
// from the character's image.
function cardJson(char: Json): Json {
  const settings = record(char.loreSettings);
  const extras = record(char.additionalData);
  const other = Object.entries(record(char.extentions)).filter(([key]) => key !== 'risuai' && key !== 'depth_prompt');
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: char.name,
      description: char.desc,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.firstMessage,
      mes_example: char.exampleMessage,
      creator_notes: char.creatorNotes,
      system_prompt: char.systemPrompt,
      post_history_instructions: char.replaceGlobalNote,
      alternate_greetings: char.alternateGreetings,
      character_book: {
        scan_depth: settings.scanDepth,
        token_budget: settings.tokenBudget,
        recursive_scanning: settings.recursiveScanning,
        extensions: { ...record(char.loreExt), risu_fullWordMatching: settings.fullWordMatching ?? false },
      },
      tags: char.tags,
      creator: extras.creator,
      character_version: extras.character_version,
      extensions: {
        ...Object.fromEntries(other),
        risuai: {
          bias: char.bias,
          viewScreen: char.viewScreen,
          customScripts: char.customscript,
          utilityBot: char.utilityBot,
          sdData: char.sdData,
          backgroundHTML: char.backgroundHTML,
          license: char.license,
          triggerscript: char.triggerscript,
          additionalText: char.additionalText,
          largePortrait: char.largePortrait,
          lorePlus: char.lorePlus,
          inlayViewScreen: char.inlayViewScreen,
          newGenData: char.newGenData,
          defaultVariables: char.defaultVariables,
          prebuiltAssetCommand: char.prebuiltAssetCommand,
          prebuiltAssetExclude: char.prebuiltAssetExclude,
          prebuiltAssetStyle: char.prebuiltAssetStyle,
          toggles: char.customModuleToggle,
          moduleNamespace: char.moduleNamespace,
          hideChatIcon: char.hideChatIcon,
        },
        depth_prompt: char.depth_prompt,
      },
      group_only_greetings: char.group_only_greetings,
      nickname: char.nickname,
      source: char.source,
      creation_date: char.creation_date,
      assets: [
        ...list(char.ccAssets),
        ...list(char.additionalAssets)
          .filter(Array.isArray)
          .map(([name, uri, ext]) => ({ type: 'x-risu-asset', uri, name, ext: text(ext) || 'png' })),
        ...list(char.emotionImages)
          .filter(Array.isArray)
          .map(([name, uri]) => ({ type: 'emotion', uri, name, ext: 'png' })),
      ],
    },
  };
}
