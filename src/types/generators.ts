/**
 * Generator presets: built-in property generators and the prompts that
 * back them. The shipped defaults are in English; the German variant is
 * available through the language picker.
 *
 * A preset is a "what to put under property X" recipe:
 *   - targetProperty: the frontmatter key the generator writes into
 *   - prompt:         the user instruction sent to the LLM
 *   - systemPrompt:   the deterministic guardrail (format + safety)
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
  /** Per-language prompt text. The system prompt is the guardrail. */
  prompts: Record<GeneratorLanguage, GeneratorPromptPair>;
  /** True for the three built-in presets so users can reset them. */
  isBuiltIn: boolean;
}

export interface GeneratorPromptPair {
  systemPrompt: string;
  userPrompt: string;
}

export type GeneratorLanguage = "en" | "de";

export const GENERATOR_LANGUAGES: GeneratorLanguage[] = ["en", "de"];

export const GENERATOR_LANGUAGE_LABELS: Record<GeneratorLanguage, string> = {
  en: "English",
  de: "Deutsch",
};

/**
 * Shared guardrail prompt appended to every generator's system prompt. It
 * tells the model that the plugin will deterministically parse the result;
 * the model must not invent its own frontmatter side-effects.
 */
const SHARED_GUARDRAIL: Record<GeneratorLanguage, string> = {
  en: `IMPORTANT:
- Return ONLY the output block in the requested format. No explanations, no extra prose, no code fences other than the requested ones.
- Do not write any YAML, do not invent additional frontmatter keys.
- The plugin parses your output deterministically and merges it into the note. Existing properties are preserved by the plugin; you do not need to consider them.`,
  de: `WICHTIG:
- Gib AUSSCHLIESSLICH den Ausgabe-Block im verlangten Format zurück. Keine Erklärungen, keine zusätzliche Prosa, keine anderen Code-Fences als die verlangten.
- Schreibe kein YAML, erfinde keine zusätzlichen Frontmatter-Properties.
- Das Plugin parst deine Ausgabe deterministisch und fügt sie in die Note ein. Bestehende Properties bleiben durch das Plugin erhalten; du musst sie nicht berücksichtigen.`,
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
    en: {
      systemPrompt: `You write one-sentence summaries.\n\n${SHARED_GUARDRAIL.en}\n\nOutput format (exactly one line, plain text, no quotes):\n<sentence>`,
      userPrompt: `Write **one single summary in exactly one sentence** in English for the active note.\nThe output must NOT exceed **25 words**.\nReturn **only the sentence** -- no explanations, no extra text.\nIf the summary would be longer, **shorten it radically**.\n\nNote content:\n{{NOTE_BODY}}`,
    },
    de: {
      systemPrompt: `Du schreibst Ein-Satz-Zusammenfassungen.\n\n${SHARED_GUARDRAIL.de}\n\nAusgabeformat (genau eine Zeile, reiner Text, keine Anführungszeichen):\n<satz>`,
      userPrompt: `Erstelle **eine einzige Zusammenfassung in genau einem Satz** in deutscher Sprache für die aktive Note.\nDie Ausgabe darf **nicht mehr als 25 Wörter** enthalten.\nGib **nur den Satz** aus -- keine Erklärungen, keine zusätzlichen Texte.\nWenn die Zusammenfassung länger wäre, **kürze sie radikal**.\n\nNote-Inhalt:\n{{NOTE_BODY}}`,
    },
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
    en: {
      systemPrompt: `You produce keyword lists for note-recall and semantic search.\n\n${SHARED_GUARDRAIL.en}\n\nOutput format (a plain YAML-list block, no key, just dashes):\n- keyword-one\n- keyword-two\n- ...\n\nRules:\n- 5 to 10 keywords.\n- Hyphenate multi-word concepts ("AI-agent", "non-linear-writing"), maximum 2 connected words.\n- Mix English and the target language; if a term is more common in English (e.g. "AI-agent"), use the English form.`,
      userPrompt: `Produce 5-10 keywords in English and the original note language for the active note. The keywords should help the author recall the note later (associations, memory cues, meta-topics, semantics) and improve semantic search recall.\nHyphenated spelling \"word1-word2\", maximum 2 connected words.\nIf technical terms are more commonly used in English, use the English variant (e.g. "AI-agent" instead of localized form).\n\nNote content:\n{{NOTE_BODY}}`,
    },
    de: {
      systemPrompt: `Du erzeugst Keyword-Listen für späteres Wiedererinnern und semantische Suche.\n\n${SHARED_GUARDRAIL.de}\n\nAusgabeformat (eine reine YAML-Liste, kein Key, nur Bindestriche):\n- keyword-eins\n- keyword-zwei\n- ...\n\nRegeln:\n- 5 bis 10 Keywords.\n- Mehr-Wort-Begriffe per Bindestrich verbinden (\"AI-Agent\", \"non-linear-writing\"), maximal 2 verbundene Wörter.\n- Deutsch und Englisch mischen; wenn ein Fachbegriff im Englischen gebräuchlicher ist (z.B. \"AI-Agent\"), die englische Variante verwenden.`,
      userPrompt: `Erzeuge 5-10 Keywords in deutscher und englischer Sprache für die aktive Note, die helfen, sich später an die Note zu erinnern (Assoziationen, Erinnerungshilfen, Meta-Themen, Semantik) und den Inhalt in semantischer Suche besser zu finden. Schreibweise mit Bindestrichen \"Wort1-Wort2\", maximal 2 verbundene Wörter. Wenn Fachbegriffe eher in Englisch gebräuchlich sind, verwende die englische Variante (z.B. \"AI-Agent\" statt \"KI-Agent\").\n\nNote-Inhalt:\n{{NOTE_BODY}}`,
    },
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
    en: {
      systemPrompt: `You produce taxonomy proposals for a personal knowledge base. You reuse existing topics and concepts whenever possible and only invent new ones when no existing entry fits.\n\n${SHARED_GUARDRAIL.en}\n\nOutput format (a YAML-style block, two keys: topics and concepts, each a list of dashed items):\ntopics:\n  - Topic A\n  - Topic B\nconcepts:\n  - Concept X\n  - Concept Y\n\nRules:\n- 2 to 3 entries per list.\n- Prefer existing topics and concepts from the vault when given.`,
      userPrompt: `Produce 2-3 suggestions for "Topics" and 2-3 suggestions for "Concepts" matching the content of the note, as a taxonomy. First check the existing vault topics and concepts and reuse them when they fit. Only invent a new topic or concept when no existing entry fits.\n\nKnown topics in the vault:\n{{KNOWN_TOPICS}}\n\nKnown concepts in the vault:\n{{KNOWN_CONCEPTS}}\n\nNote content:\n{{NOTE_BODY}}`,
    },
    de: {
      systemPrompt: `Du erzeugst Taxonomie-Vorschläge für eine persönliche Wissensbasis. Du nutzt bestehende Themen und Konzepte wann immer möglich wieder und erfindest neue nur dann, wenn kein passender Eintrag existiert.\n\n${SHARED_GUARDRAIL.de}\n\nAusgabeformat (ein YAML-artiger Block mit zwei Keys: topics und concepts, jeweils eine Liste mit Bindestrich-Einträgen):\ntopics:\n  - Thema A\n  - Thema B\nconcepts:\n  - Konzept X\n  - Konzept Y\n\nRegeln:\n- 2 bis 3 Einträge pro Liste.\n- Bestehende Themen und Konzepte aus dem Vault bevorzugen, wenn welche gegeben sind.`,
      userPrompt: `Erstelle 2-3 Vorschläge für \"Themen\" und 2-3 Vorschläge für \"Konzepte\" passend zum Inhalt der Note als Taxonomie. Suche zuerst im Vault nach passenden vorhandenen Themen und Konzepten. Erstelle nur dann ein neues Thema oder Konzept, wenn kein passendes existiert.\n\nBekannte Themen im Vault:\n{{KNOWN_TOPICS}}\n\nBekannte Konzepte im Vault:\n{{KNOWN_CONCEPTS}}\n\nNote-Inhalt:\n{{NOTE_BODY}}`,
    },
  },
};

export const DEFAULT_PRESETS: GeneratorPreset[] = [
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_MOC,
];

export function clonePreset(preset: GeneratorPreset): GeneratorPreset {
  return JSON.parse(JSON.stringify(preset)) as GeneratorPreset;
}
