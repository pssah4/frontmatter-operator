/**
 * Generator presets: built-in property generators and the prompts that
 * back them.
 *
 * Each preset has ONE prompt per language, attached to the target
 * property. The plugin internally wraps every prompt with a fixed
 * non-user-editable guardrail (output policy, format constraints,
 * the UNABLE_TO_GENERATE sentinel) before sending it to the LLM, so
 * the user only sees + edits a single instruction per property.
 *
 * Shape:
 *   - targetProperty: the frontmatter key the generator writes into
 *   - prompt[lang]:   the user-editable instruction sent to the LLM
 *                     (one string -- the plugin appends the guardrail)
 *   - parser:         id of the deterministic parser used on the LLM output
 */

export type GeneratorParserId =
  | "single_line_text"
  | "list_string"
  | "moc_topics_concepts";

export interface GeneratorPreset {
  id: string;
  displayName: string;
  targetProperty: string;
  /** Soft hint shown in the UI. */
  description: string;
  parser: GeneratorParserId;
  /** Per-language prompt. Single string per language (no system/user
   *  split). The plugin prepends a fixed guardrail at send time. */
  prompts: Record<GeneratorLanguage, string>;
  /** True for the three built-in presets so users can reset them. */
  isBuiltIn: boolean;
}

export type GeneratorLanguage = "en" | "de";

export const GENERATOR_LANGUAGES: GeneratorLanguage[] = ["en", "de"];

export const GENERATOR_LANGUAGE_LABELS: Record<GeneratorLanguage, string> = {
  en: "English",
  de: "Deutsch",
};

/**
 * Fixed system prompt the plugin sends with every generator call. Not
 * user-editable. Lives here so prompt-design changes happen in one
 * place. The {{PROMPT_HOOK}} placeholder gets the user's
 * per-property instruction stitched in at send time -- see
 * GeneratorService.buildSystemPrompt.
 *
 * Two non-negotiable contracts the LLM must honour:
 *   (a) Output ONLY the value in the requested format -- no prose,
 *       no apologies, no "Based on...", no "I need...".
 *   (b) If for any reason no valid output can be produced (note
 *       empty, content too short, off-topic, ambiguous), respond
 *       with EXACTLY UNABLE_TO_GENERATE on its own line. The
 *       plugin then skips the note silently.
 */
export const GENERATOR_GUARDRAIL: Record<GeneratorLanguage, string> = {
  en: `You are a strict data extractor. The plugin parses your output deterministically and writes it into a YAML frontmatter property -- it will not retry, edit, or interpret your wording.

ABSOLUTE RULES:
1. Return ONLY the requested value in the requested format. No introductions, no explanations, no commentary, no apologies, no markdown code fences (unless explicitly requested), no labels like "Output:" or "Answer:".
2. Never write phrases like "Based on the note...", "I need to see...", "I'll wait...", "Since no content...", "Please share the note...", "Without the actual note...", "The note appears empty...", or any meta-commentary about your task or the input. These end up as garbage values in the user's vault.
3. If you cannot produce a valid value for ANY reason -- the note body is empty, too short, off-topic, unclear, missing required context, in an unexpected language, or you simply have nothing reliable to say -- respond with EXACTLY this single token on its own line:
   UNABLE_TO_GENERATE
   Do not pad it, do not explain it, do not wrap it in quotes. The plugin will silently skip the note.`,
  de: `Du bist ein strikter Daten-Extraktor. Das Plugin parst deine Ausgabe deterministisch und schreibt sie in eine YAML-Frontmatter-Property -- es wird nichts erneut versuchen, bearbeiten oder interpretieren.

ABSOLUTE REGELN:
1. Gib AUSSCHLIESSLICH den geforderten Wert im geforderten Format zurück. Keine Einleitungen, keine Erklärungen, keine Kommentare, keine Entschuldigungen, keine Markdown-Code-Fences (außer explizit verlangt), keine Labels wie "Output:" oder "Antwort:".
2. Schreibe niemals Phrasen wie "Basierend auf der Notiz...", "Ich brauche...", "Ich warte...", "Da kein Inhalt...", "Bitte teile die Notiz...", "Ohne den eigentlichen Inhalt...", "Die Notiz scheint leer...", oder jegliche Meta-Kommentare über deine Aufgabe oder den Input. Solche Phrasen landen als Müll-Werte im Vault des Users.
3. Wenn du AUS IRGENDEINEM GRUND keinen gültigen Wert produzieren kannst -- Note-Body ist leer, zu kurz, off-topic, unklar, fehlender Kontext, in unerwarteter Sprache, oder du hast schlicht nichts Verlässliches zu sagen -- antworte mit EXAKT diesem einzelnen Token auf einer eigenen Zeile:
   UNABLE_TO_GENERATE
   Nicht ausschmücken, nicht erklären, nicht in Anführungszeichen setzen. Das Plugin überspringt dann stillschweigend.`,
};

/** Built-in description preset: one-sentence summary in target language. */
export const DEFAULT_DESCRIPTION: GeneratorPreset = {
  id: "description",
  displayName: "Description (one-sentence summary)",
  targetProperty: "description",
  parser: "single_line_text",
  description: "Writes a single-sentence summary of the note into `description`.",
  isBuiltIn: true,
  prompts: {
    en: `Write a single-sentence summary of the note in English, no more than 25 words.
Output format: exactly one line, plain text, no quotes, no labels.
If the summary would be longer than 25 words, shorten it radically.

Note content:
{{NOTE_BODY}}`,
    de: `Erstelle eine Zusammenfassung der Notiz auf Deutsch in genau einem Satz, maximal 25 Wörter.
Ausgabe-Format: genau eine Zeile, reiner Text, keine Anführungszeichen, keine Labels.
Falls die Zusammenfassung länger als 25 Wörter würde, radikal kürzen.

Note-Inhalt:
{{NOTE_BODY}}`,
  },
};

/** Built-in keywords preset: 5-10 hyphenated keywords. */
export const DEFAULT_KEYWORDS: GeneratorPreset = {
  id: "keywords",
  displayName: "Keywords / tags",
  targetProperty: "tags",
  parser: "list_string",
  description: "Adds 5-10 hyphenated keywords to `tags` (merged with existing).",
  isBuiltIn: true,
  prompts: {
    en: `Produce 5 to 10 keywords for the note. The keywords should help the author recall the note later (associations, memory cues, meta-topics, semantics) and improve semantic search recall.

Format rules:
- Output a plain YAML list (one item per line, starting with "- ").
- Hyphenate multi-word concepts ("AI-agent", "non-linear-writing"), maximum 2 connected words per keyword.
- Mix English and the note's original language; if a term is more commonly used in English, prefer the English form ("AI-agent" not "KI-Agent").
- No keys, no extra prose, no introduction, just the dashed list.

Note content:
{{NOTE_BODY}}`,
    de: `Erzeuge 5 bis 10 Keywords für die Notiz, die helfen, sie später wiederzufinden (Assoziationen, Erinnerungshilfen, Meta-Themen, Semantik) und die semantische Suche verbessern.

Format-Regeln:
- Ausgabe als reine YAML-Liste (ein Eintrag pro Zeile, beginnend mit "- ").
- Mehr-Wort-Begriffe per Bindestrich verbinden ("AI-Agent", "non-linear-writing"), maximal 2 verbundene Wörter pro Keyword.
- Deutsch und Englisch mischen; wenn ein Fachbegriff im Englischen gebräuchlicher ist, die englische Variante verwenden ("AI-Agent" statt "KI-Agent").
- Keine Keys, keine zusätzliche Prosa, keine Einleitung, nur die Bindestrich-Liste.

Note-Inhalt:
{{NOTE_BODY}}`,
  },
};

/** Built-in MoC preset: 2-3 Topics + 2-3 Concepts. */
export const DEFAULT_MOC: GeneratorPreset = {
  id: "moc",
  displayName: "Map of Content (topics + concepts)",
  targetProperty: "moc",
  parser: "moc_topics_concepts",
  description: "Produces 2-3 topics and 2-3 concepts as a YAML map under `moc`.",
  isBuiltIn: true,
  prompts: {
    en: `Produce 2-3 "Topics" and 2-3 "Concepts" matching the note's content. First check the existing vault topics and concepts and REUSE them when they fit. Only invent a new entry when no existing one fits.

Format rules:
- Output a YAML-style block with exactly two keys: topics and concepts.
- Each list item starts with "- ".
- 2 to 3 entries per list.

Known topics in the vault:
{{KNOWN_TOPICS}}

Known concepts in the vault:
{{KNOWN_CONCEPTS}}

Note content:
{{NOTE_BODY}}`,
    de: `Erstelle 2-3 "Themen" und 2-3 "Konzepte" passend zum Inhalt der Notiz. Prüfe zuerst die bestehenden Vault-Einträge und VERWENDE sie wieder, wenn sie passen. Erfinde einen neuen Eintrag nur, wenn kein passender existiert.

Format-Regeln:
- Ausgabe als YAML-artiger Block mit genau zwei Keys: topics und concepts.
- Jeder Listen-Eintrag beginnt mit "- ".
- 2 bis 3 Einträge pro Liste.

Bekannte Themen im Vault:
{{KNOWN_TOPICS}}

Bekannte Konzepte im Vault:
{{KNOWN_CONCEPTS}}

Note-Inhalt:
{{NOTE_BODY}}`,
  },
};

export const DEFAULT_PRESETS: GeneratorPreset[] = [
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_MOC,
];

/** Deep-clone a preset so the user can edit a copy without touching the const. */
export function clonePreset(preset: GeneratorPreset): GeneratorPreset {
  return JSON.parse(JSON.stringify(preset)) as GeneratorPreset;
}

/**
 * User-defined ad-hoc prompt template. Saved per-property; the user can
 * recall any of them in the Generate-with-AI mini-chat. Single
 * `prompt` string -- the guardrail is appended by GeneratorService.
 */
export interface CustomPromptTemplate {
  id: string;
  name: string;
  targetProperty: string;
  parser: GeneratorParserId;
  prompt: string;
}

export function emptyCustomPrompt(targetProperty: string): CustomPromptTemplate {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Custom for ${targetProperty}`,
    targetProperty,
    parser: "single_line_text",
    prompt: "",
  };
}

/**
 * Migrate a legacy preset/template that still uses {systemPrompt,
 * userPrompt} pairs to the new single-string shape. Called on plugin
 * load against settings.customPrompts (and applied opportunistically
 * to any legacy entries the user might have saved).
 *
 * Strategy: drop the systemPrompt entirely (it was a duplicate of the
 * guardrail), keep the userPrompt as the new single prompt. Lossy in
 * theory but in practice the systemPrompt was always either the
 * default guardrail or an extension of it -- the new fixed guardrail
 * subsumes it.
 */
export function migrateLegacyCustomPrompt(
  legacy: unknown,
): CustomPromptTemplate | null {
  if (!legacy || typeof legacy !== "object") return null;
  const obj = legacy as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.targetProperty !== "string") {
    return null;
  }
  // Already in new shape -- return as is.
  if (typeof obj.prompt === "string") {
    return obj as unknown as CustomPromptTemplate;
  }
  // Legacy shape: userPrompt becomes the new prompt; systemPrompt
  // collapsed into the fixed guardrail.
  const userPrompt = typeof obj.userPrompt === "string" ? obj.userPrompt : "";
  return {
    id: obj.id,
    name: typeof obj.name === "string" ? obj.name : `Custom for ${obj.targetProperty}`,
    targetProperty: obj.targetProperty,
    parser: (typeof obj.parser === "string" ? obj.parser : "single_line_text") as GeneratorParserId,
    prompt: userPrompt,
  };
}
