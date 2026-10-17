// The adapter (src/sandbox/risu.ts) maps exactly these Risu v3 names; the import scan lists every other name a plugin
// uses as missing. Both read this file, so a name mapped later is added here and nowhere else.
export const RISU_MAPPED: ReadonlySet<string> = new Set([
  'showContainer', 'hideContainer', 'registerButton', 'registerSetting', 'unregisterUIPart', 'onUnload', 'log',
  'pluginStorage', 'getLocalPluginStorage', 'safeLocalStorage', 'getArgument', 'getArg', 'requestPluginPermission',
  'getCharacter', 'getChar', 'getCurrentCharacterIndex', 'getCurrentChatIndex', 'getChatFromIndex', 'setChatToIndex',
  'runLLMModel', 'addRisuReplacer', 'removeRisuReplacer', 'addRisuChatListener', 'removeRisuChatListener',
]);
// addRisuReplacer kinds the adapter runs; another kind is missing as `addRisuReplacer:<kind>`.
export const RISU_REPLACERS: ReadonlySet<string> = new Set(['afterRequest']);
// Declined for good (design §6.10), worded apart from names not mapped yet.
export const RISU_DECLINED: ReadonlySet<string> = new Set([
  'getRootDocument', 'addProvider', 'registerBodyIntercepter', 'unregisterBodyIntercepter', 'sendChat', 'addPluginChannelListener', 'postPluginChannelMessage',
]);
