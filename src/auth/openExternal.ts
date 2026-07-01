/**
 * Opens a URL in the user's default external browser, bypassing Obsidian's
 * sandbox. `window.open` is often blocked or redirected inside the renderer;
 * Electron's shell.openExternal is the reliable channel.
 */
export function openExternal(url: string): boolean {
  // L-4 (AUDIT v0.2.0): only ever hand http(s) URLs to the OS handler. A
  // file://, smb:// or custom-scheme URL passed to shell.openExternal can
  // trigger OS-level side effects; every legitimate caller opens an https
  // auth URL.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn("frontmatter-operator: openExternal got a malformed URL");
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.warn(
      `frontmatter-operator: openExternal refused non-http(s) scheme "${parsed.protocol}"`,
    );
    return false;
  }
  try {
    const electron = (
      window as unknown as { require?: (id: string) => unknown }
    ).require?.("electron");
    const shell = (electron as { shell?: { openExternal: (u: string) => Promise<void> } })
      ?.shell;
    if (shell) {
      void shell.openExternal(url);
      return true;
    }
  } catch (err) {
    console.warn("frontmatter-operator: shell.openExternal unavailable", err);
  }
  // Fallback (often blocked in Obsidian)
  try {
    window.open(url, "_blank");
    return true;
  } catch {
    return false;
  }
}
