// A tool frame's sandbox flags. The iframe's attribute and SANDBOX_CSP's sandbox directive both carry them: a browser
// grants a frame only the flags both allow.
export const TOOL_SANDBOX = 'allow-scripts allow-downloads allow-modals';
// The permissions a tool frame is delegated, for its copy buttons.
export const TOOL_ALLOW = 'clipboard-write';
