/**
 * Opens a URL in the user's default external browser, bypassing Obsidian's
 * sandbox. `window.open` is often blocked or redirected inside the renderer;
 * Electron's shell.openExternal is the reliable channel.
 */
export function openExternal(url: string): boolean {
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
    console.warn("frontmatter-editor: shell.openExternal unavailable", err);
  }
  // Fallback (often blocked in Obsidian)
  try {
    window.open(url, "_blank");
    return true;
  } catch {
    return false;
  }
}
