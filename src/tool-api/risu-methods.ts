// The names of Risu v3's API object (RisuaiPluginAPI in upstream risuai.d.ts, plus risuFetch, which plugins still call).
// The import scan searches an aliased plugin for these as properties of anything, so what it will miss is still listed.
export const RISU_NAMES: readonly string[] = [
  'addPluginChannelListener', 'addProvider', 'addRisuChatListener', 'addRisuReplacer', 'addRisuScriptHandler', 'addTTSPostprocessor', 'addTTSPreprocessor',
  'apiVersion', 'apiVersionCompatibleWith', 'changeColorScheme', 'changeTextTheme', 'checkCharOrder', 'createMutationObserver', 'getArg', 'getArgument',
  'getChar', 'getCharacter', 'getCharacterFromIndex', 'getChatFromIndex', 'getColorScheme', 'getCurrentCharacterIndex', 'getCurrentChatIndex',
  'getCurrentLorebookEntries', 'getDatabase', 'getFetchLogs', 'getLocalPluginStorage', 'getRootDocument', 'getRuntimeInfo', 'getTextTheme',
  'getTranslationCache', 'hideContainer', 'loadPlugins', 'log', 'nativeFetch', 'onUnload', 'parseRisuChat', 'pluginStorage', 'postPluginChannelMessage',
  'readImage', 'readInlay', 'registerBodyIntercepter', 'registerButton', 'registerMCP', 'registerSetting', 'removeRisuChatListener', 'removeRisuReplacer',
  'removeRisuScriptHandler', 'requestPluginPermission', 'risuFetch', 'runLLMModel', 'safeLocalStorage', 'saveAsset', 'saveSecretHeader',
  'searchTranslationCache', 'sendChat', 'setArg', 'setArgument', 'setChar', 'setCharacter', 'setCharacterToIndex', 'setChatToIndex', 'setColorScheme',
  'setCustomTextTheme', 'setDatabase', 'setDatabaseLite', 'showContainer', 'unregisterBodyIntercepter', 'unregisterMCP', 'unregisterUIPart', 'unwarpSafeArray',
];
// The adapter (src/sandbox/risu.ts) maps exactly these Risu v3 names; the import scan lists every other name a plugin
// uses as missing. Both read this file, so a name mapped later is added here and nowhere else.
export const RISU_MAPPED: ReadonlySet<string> = new Set([
  'showContainer', 'hideContainer', 'registerButton', 'registerSetting', 'unregisterUIPart', 'onUnload', 'log',
  'pluginStorage', 'getLocalPluginStorage', 'safeLocalStorage', 'getArgument', 'getArg', 'requestPluginPermission',
  'getCharacter', 'getChar', 'getCurrentCharacterIndex', 'getCurrentChatIndex', 'getChatFromIndex', 'setChatToIndex',
  'runLLMModel', 'addRisuReplacer', 'removeRisuReplacer', 'addRisuChatListener', 'removeRisuChatListener',
  'addRisuScriptHandler', 'removeRisuScriptHandler', 'getDatabase', 'getCurrentLorebookEntries', 'getCharacterFromIndex', 'setArgument', 'setArg',
  'unwarpSafeArray', 'nativeFetch', 'risuFetch', 'getRuntimeInfo', 'saveAsset', 'readImage', 'sendChat',
]);
// addRisuReplacer kinds the adapter runs; another kind is missing as `addRisuReplacer:<kind>`.
export const RISU_REPLACERS: ReadonlySet<string> = new Set(['beforeRequest', 'afterRequest']);
// Declined for good (design §6.10): the adapter answers them undefined, and the import words them apart from names not
// mapped yet.
export const RISU_DECLINED: ReadonlySet<string> = new Set([
  'getRootDocument', 'addProvider', 'registerBodyIntercepter', 'unregisterBodyIntercepter', 'addPluginChannelListener', 'postPluginChannelMessage',
]);
