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
 * Eleven languages ship out of the box. The guardrail is provided in
 * EN + DE; all other languages fall back to the EN guardrail
 * (LLMs handle the mixed-language system prompt fine, and the
 * UNABLE_TO_GENERATE sentinel is language-neutral).
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

/**
 * ISO 639-1 codes. The eleven the user explicitly requested.
 * Default = "en" (LLMs treat English as the most reliable substrate
 * for the strict-extractor system prompt).
 */
export type GeneratorLanguage =
  | "en"
  | "de"
  | "fr"
  | "es"
  | "it"
  | "ru"
  | "ar"
  | "zh"
  | "ko"
  | "ja"
  | "hi";

export const GENERATOR_LANGUAGES: GeneratorLanguage[] = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "ru",
  "ar",
  "zh",
  "ko",
  "ja",
  "hi",
];

export const GENERATOR_LANGUAGE_LABELS: Record<GeneratorLanguage, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  ru: "Русский",
  ar: "العربية",
  zh: "中文",
  ko: "한국어",
  ja: "日本語",
  hi: "हिन्दी",
};

/**
 * Fixed system prompt the plugin sends with every generator call. Not
 * user-editable. Lives here so prompt-design changes happen in one
 * place. EN is the canonical text; DE ships as a translated variant
 * for German-speaking users. All other languages fall back to EN --
 * the contract is identical (output-only, refusal sentinel), and
 * LLMs reliably follow English instruction prompts regardless of the
 * note's language.
 *
 * Two non-negotiable contracts the LLM must honour:
 *   (a) Output ONLY the value in the requested format -- no prose,
 *       no apologies, no "Based on...", no "I need...".
 *   (b) If for any reason no valid output can be produced, respond
 *       with EXACTLY UNABLE_TO_GENERATE on its own line. The
 *       plugin then skips the note silently.
 */
const GUARDRAIL_EN = `You are a strict data extractor. The plugin parses your output deterministically and writes it into a YAML frontmatter property -- it will not retry, edit, or interpret your wording.

ABSOLUTE RULES:
1. Return ONLY the requested value in the requested format. No introductions, no explanations, no commentary, no apologies, no markdown code fences (unless explicitly requested), no labels like "Output:" or "Answer:".
2. Never write phrases like "Based on the note...", "I need to see...", "I'll wait...", "Since no content...", "Please share the note...", "Without the actual note...", "The note appears empty...", or any meta-commentary about your task or the input. These end up as garbage values in the user's vault.
3. If you cannot produce a valid value for ANY reason -- the note body is empty, too short, off-topic, unclear, missing required context, in an unexpected language, or you simply have nothing reliable to say -- respond with EXACTLY this single token on its own line:
   UNABLE_TO_GENERATE
   Do not pad it, do not explain it, do not wrap it in quotes. The plugin will silently skip the note.`;

const GUARDRAIL_DE = `Du bist ein strikter Daten-Extraktor. Das Plugin parst deine Ausgabe deterministisch und schreibt sie in eine YAML-Frontmatter-Property -- es wird nichts erneut versuchen, bearbeiten oder interpretieren.

ABSOLUTE REGELN:
1. Gib AUSSCHLIESSLICH den geforderten Wert im geforderten Format zurück. Keine Einleitungen, keine Erklärungen, keine Kommentare, keine Entschuldigungen, keine Markdown-Code-Fences (außer explizit verlangt), keine Labels wie "Output:" oder "Antwort:".
2. Schreibe niemals Phrasen wie "Basierend auf der Notiz...", "Ich brauche...", "Ich warte...", "Da kein Inhalt...", "Bitte teile die Notiz...", "Ohne den eigentlichen Inhalt...", "Die Notiz scheint leer...", oder jegliche Meta-Kommentare über deine Aufgabe oder den Input. Solche Phrasen landen als Müll-Werte im Vault des Users.
3. Wenn du AUS IRGENDEINEM GRUND keinen gültigen Wert produzieren kannst -- Note-Body ist leer, zu kurz, off-topic, unklar, fehlender Kontext, in unerwarteter Sprache, oder du hast schlicht nichts Verlässliches zu sagen -- antworte mit EXAKT diesem einzelnen Token auf einer eigenen Zeile:
   UNABLE_TO_GENERATE
   Nicht ausschmücken, nicht erklären, nicht in Anführungszeichen setzen. Das Plugin überspringt dann stillschweigend.`;

export const GENERATOR_GUARDRAIL: Record<GeneratorLanguage, string> = {
  en: GUARDRAIL_EN,
  de: GUARDRAIL_DE,
  fr: GUARDRAIL_EN,
  es: GUARDRAIL_EN,
  it: GUARDRAIL_EN,
  ru: GUARDRAIL_EN,
  ar: GUARDRAIL_EN,
  zh: GUARDRAIL_EN,
  ko: GUARDRAIL_EN,
  ja: GUARDRAIL_EN,
  hi: GUARDRAIL_EN,
};

// ============================================================================
// DEFAULT PROMPTS -- ONE per (preset, language). User-editable via Settings.
// ============================================================================

const DESCRIPTION_PROMPTS: Record<GeneratorLanguage, string> = {
  en: `Write a single summary of the note in English, in exactly one sentence. The output MUST NOT exceed 25 words. If the summary would be longer, shorten it radically.

Output format: exactly one line, plain text, no quotes, no labels, no introduction.

Note content:
{{NOTE_BODY}}`,
  de: `Erstelle eine Zusammenfassung der Notiz auf Deutsch in genau einem Satz. Die Ausgabe darf NICHT mehr als 25 Wörter enthalten. Falls die Zusammenfassung länger wäre, radikal kürzen.

Ausgabe-Format: genau eine Zeile, reiner Text, keine Anführungszeichen, keine Labels, keine Einleitung.

Note-Inhalt:
{{NOTE_BODY}}`,
  fr: `Rédige un résumé de la note en français, en une seule phrase. La sortie NE DOIT PAS dépasser 25 mots. Si le résumé est plus long, raccourcis-le radicalement.

Format de sortie : exactement une ligne, texte brut, sans guillemets, sans étiquettes, sans introduction.

Contenu de la note :
{{NOTE_BODY}}`,
  es: `Escribe un resumen de la nota en español, en una sola oración. La salida NO DEBE exceder 25 palabras. Si el resumen fuera más largo, acórtalo radicalmente.

Formato de salida: exactamente una línea, texto plano, sin comillas, sin etiquetas, sin introducción.

Contenido de la nota:
{{NOTE_BODY}}`,
  it: `Scrivi un riassunto della nota in italiano, in una sola frase. L'output NON DEVE superare 25 parole. Se il riassunto fosse più lungo, accorcialo drasticamente.

Formato di output: esattamente una riga, testo semplice, senza virgolette, senza etichette, senza introduzione.

Contenuto della nota:
{{NOTE_BODY}}`,
  ru: `Напишите краткое содержание заметки на русском языке одним предложением. Результат НЕ ДОЛЖЕН превышать 25 слов. Если краткое содержание будет длиннее, радикально сократите его.

Формат вывода: ровно одна строка, простой текст, без кавычек, без заголовков, без вступлений.

Содержание заметки:
{{NOTE_BODY}}`,
  ar: `اكتب ملخصاً للملاحظة باللغة العربية في جملة واحدة فقط. يجب ألا يتجاوز الناتج 25 كلمة. إذا كان الملخص أطول، اختصره بشكل جذري.

تنسيق الإخراج: سطر واحد بالضبط، نص عادي، بدون علامات اقتباس، بدون عناوين، بدون مقدمة.

محتوى الملاحظة:
{{NOTE_BODY}}`,
  zh: `用中文为该笔记写一句话摘要。输出不得超过25个字。如果摘要会更长，请大幅缩短。

输出格式：恰好一行，纯文本，不加引号，不加标签，不加引言。

笔记内容：
{{NOTE_BODY}}`,
  ko: `이 노트에 대한 한국어 한 문장 요약을 작성하세요. 출력은 25단어를 초과해서는 안 됩니다. 요약이 더 길어질 경우 과감하게 줄이세요.

출력 형식: 정확히 한 줄, 일반 텍스트, 인용 부호 없음, 레이블 없음, 서론 없음.

노트 내용:
{{NOTE_BODY}}`,
  ja: `このノートの要約を日本語で一文で書いてください。出力は25語を超えてはいけません。要約が長くなる場合は大幅に短縮してください。

出力形式：ちょうど一行、プレーンテキスト、引用符なし、ラベルなし、前置きなし。

ノート内容：
{{NOTE_BODY}}`,
  hi: `इस नोट का सारांश हिन्दी में एक ही वाक्य में लिखें। आउटपुट 25 शब्दों से अधिक नहीं होना चाहिए। यदि सारांश अधिक लंबा हो तो उसे कठोरता से छोटा करें।

आउटपुट प्रारूप: ठीक एक पंक्ति, सादा पाठ, बिना उद्धरण चिह्न, बिना लेबल, बिना प्रस्तावना।

नोट सामग्री:
{{NOTE_BODY}}`,
};

const KEYWORDS_PROMPTS: Record<GeneratorLanguage, string> = {
  en: `Produce 5 to 10 keywords for the note. The keywords should help the author recall the note later (associations, memory cues, meta-topics, semantics) and improve semantic search recall.

Format rules:
- Output a plain YAML list, one item per line, starting with "- ".
- Hyphenate multi-word concepts ("AI-agent", "non-linear-writing"), maximum 2 connected words per keyword.
- Mix English and the note's original language. If a technical term is more common in English (e.g. "AI-agent" instead of a localized form), prefer the English form.
- Output ONLY the dashed list. No keys, no introduction, no prose.

Note content:
{{NOTE_BODY}}`,
  de: `Erzeuge 5 bis 10 Keywords für die Notiz. Die Keywords sollen helfen, die Notiz später wiederzufinden (Assoziationen, Erinnerungshilfen, Meta-Themen, Semantik) und die semantische Suche verbessern.

Format-Regeln:
- Ausgabe als reine YAML-Liste, ein Eintrag pro Zeile, beginnend mit "- ".
- Mehr-Wort-Begriffe per Bindestrich verbinden ("AI-Agent", "non-linear-writing"), maximal 2 verbundene Wörter pro Keyword.
- Deutsch und Englisch mischen. Wenn ein Fachbegriff im Englischen gebräuchlicher ist (z.B. "AI-Agent" statt lokalisierter Form), die englische Variante bevorzugen.
- Gib NUR die Bindestrich-Liste aus. Keine Keys, keine Einleitung, keine Prosa.

Note-Inhalt:
{{NOTE_BODY}}`,
  fr: `Produis 5 à 10 mots-clés pour la note. Les mots-clés doivent aider l'auteur à se souvenir de la note plus tard (associations, indices mnémoniques, méta-sujets, sémantique) et améliorer la recherche sémantique.

Règles de format :
- Sortie en liste YAML brute, un élément par ligne, commençant par "- ".
- Concepts multi-mots avec traits d'union ("AI-agent", "non-linear-writing"), maximum 2 mots reliés par mot-clé.
- Mélange français et anglais. Si un terme technique est plus courant en anglais (ex. "AI-agent" au lieu de "agent-IA"), préfère la forme anglaise.
- Sortie UNIQUEMENT la liste à tirets. Pas de clés, pas d'introduction, pas de prose.

Contenu de la note :
{{NOTE_BODY}}`,
  es: `Produce de 5 a 10 palabras clave para la nota. Las palabras clave deben ayudar al autor a recordar la nota más tarde (asociaciones, pistas mnemotécnicas, meta-temas, semántica) y mejorar la búsqueda semántica.

Reglas de formato:
- Salida como lista YAML simple, un elemento por línea, comenzando con "- ".
- Conceptos de varias palabras con guiones ("AI-agent", "non-linear-writing"), máximo 2 palabras conectadas por palabra clave.
- Mezcla español e inglés. Si un término técnico es más común en inglés (p. ej. "AI-agent" en lugar de la forma localizada), prefiere la forma inglesa.
- Salida ÚNICAMENTE la lista con guiones. Sin claves, sin introducción, sin prosa.

Contenido de la nota:
{{NOTE_BODY}}`,
  it: `Produci da 5 a 10 parole chiave per la nota. Le parole chiave devono aiutare l'autore a ricordare la nota in seguito (associazioni, indizi mnemonici, meta-argomenti, semantica) e migliorare la ricerca semantica.

Regole di formato:
- Output come lista YAML semplice, un elemento per riga, che inizia con "- ".
- Concetti di più parole con trattini ("AI-agent", "non-linear-writing"), massimo 2 parole collegate per parola chiave.
- Mescola italiano e inglese. Se un termine tecnico è più comune in inglese (es. "AI-agent" invece della forma localizzata), preferisci la forma inglese.
- Output SOLO la lista con trattini. Niente chiavi, niente introduzione, niente prosa.

Contenuto della nota:
{{NOTE_BODY}}`,
  ru: `Создайте от 5 до 10 ключевых слов для заметки. Ключевые слова должны помочь автору вспомнить заметку позже (ассоциации, мнемонические подсказки, мета-темы, семантика) и улучшить семантический поиск.

Правила формата:
- Вывод в виде простого YAML-списка, по одному элементу на строку, начиная с "- ".
- Многословные концепции через дефис ("AI-agent", "non-linear-writing"), максимум 2 связанных слова на ключевое слово.
- Смешивайте русский и английский. Если технический термин чаще используется на английском (например, "AI-agent" вместо локализованной формы), предпочтите английскую форму.
- Выводите ТОЛЬКО список с дефисами. Без ключей, без введения, без прозы.

Содержание заметки:
{{NOTE_BODY}}`,
  ar: `أنتج من 5 إلى 10 كلمات مفتاحية للملاحظة. يجب أن تساعد الكلمات المفتاحية المؤلف على تذكر الملاحظة لاحقاً (روابط، تلميحات للذاكرة، موضوعات شاملة، دلالات) وتحسين البحث الدلالي.

قواعد التنسيق:
- الإخراج كقائمة YAML بسيطة، عنصر واحد لكل سطر، يبدأ بـ "- ".
- المفاهيم متعددة الكلمات بالشرطات ("AI-agent", "non-linear-writing")، بحد أقصى كلمتين متصلتين لكل كلمة مفتاحية.
- اخلط العربية والإنجليزية. إذا كان مصطلح تقني أكثر شيوعاً بالإنجليزية (مثل "AI-agent" بدلاً من الصيغة المُحلية)، فضّل الصيغة الإنجليزية.
- أخرج فقط القائمة بالشرطات. لا مفاتيح، لا مقدمة، لا نثر.

محتوى الملاحظة:
{{NOTE_BODY}}`,
  zh: `为该笔记生成 5 到 10 个关键词。关键词应帮助作者日后回忆这条笔记（关联、记忆线索、元主题、语义），并提升语义搜索的召回率。

格式规则：
- 输出为纯 YAML 列表，每行一个条目，以 "- " 开头。
- 多词概念使用连字符连接（"AI-agent"、"non-linear-writing"），每个关键词最多 2 个连接词。
- 中英混合。如果技术术语在英语中更常用（如 "AI-agent" 而非本地化形式），优先使用英语形式。
- 仅输出带连字符的列表。不要键名、不要引言、不要散文。

笔记内容：
{{NOTE_BODY}}`,
  ko: `이 노트에 대해 5~10개의 키워드를 생성하세요. 키워드는 작성자가 노트를 나중에 떠올릴 수 있도록 돕고(연상, 기억 단서, 메타 주제, 의미론) 의미 기반 검색을 개선해야 합니다.

형식 규칙:
- 출력은 일반 YAML 목록, 한 줄에 한 항목, "- "로 시작.
- 다중 단어 개념은 하이픈으로 연결("AI-agent", "non-linear-writing"), 키워드당 최대 2개 연결 단어.
- 한국어와 영어를 섞으세요. 기술 용어가 영어에서 더 흔하면(예: 현지화된 형태 대신 "AI-agent") 영어 형태를 선호.
- 하이픈 목록만 출력. 키 없음, 서론 없음, 산문 없음.

노트 내용:
{{NOTE_BODY}}`,
  ja: `このノートのキーワードを 5～10 個生成してください。キーワードは、著者が後でノートを思い出すのに役立つもの（連想、記憶手がかり、メタトピック、意味論）であり、セマンティック検索の再現率を高めるものであるべきです。

形式ルール：
- 出力はプレーンな YAML リスト、1 行に 1 項目、"- " で開始。
- 複数語の概念はハイフンで連結（"AI-agent"、"non-linear-writing"）、キーワードあたり最大 2 つの連結語。
- 日本語と英語を混在させる。技術用語が英語で一般的な場合（ローカライズ形式の代わりに "AI-agent" など）、英語形式を優先。
- ハイフン付きリストのみ出力。キーなし、前置きなし、散文なし。

ノート内容：
{{NOTE_BODY}}`,
  hi: `इस नोट के लिए 5 से 10 कीवर्ड बनाएँ। कीवर्ड लेखक को बाद में नोट को याद रखने में मदद करने (संगति, स्मृति-संकेत, मेटा-विषय, अर्थशास्त्र) और सिमेंटिक खोज को बेहतर बनाने वाले होने चाहिए।

प्रारूप नियम:
- आउटपुट सादे YAML सूची के रूप में, प्रति पंक्ति एक प्रविष्टि, "- " से शुरू।
- बहु-शब्द अवधारणाओं को हाइफ़न से जोड़ें ("AI-agent", "non-linear-writing"), प्रति कीवर्ड अधिकतम 2 जुड़े शब्द।
- हिन्दी और अंग्रेज़ी मिलाएँ। यदि कोई तकनीकी शब्द अंग्रेज़ी में अधिक प्रचलित हो (जैसे स्थानीयकृत रूप के बजाय "AI-agent"), तो अंग्रेज़ी रूप को प्राथमिकता दें।
- केवल हाइफ़न सूची आउटपुट करें। कोई कुंजी नहीं, कोई परिचय नहीं, कोई गद्य नहीं।

नोट सामग्री:
{{NOTE_BODY}}`,
};

const MOC_PROMPTS: Record<GeneratorLanguage, string> = {
  en: `Produce 2-3 suggestions for "Topics" and 2-3 suggestions for "Concepts" matching the note's content, as a taxonomy. First check the existing vault topics and concepts and REUSE them when they fit. Only invent a new entry when no existing one fits.

Output format: a YAML-style block with exactly two keys (topics, concepts), each a list of dashed items.
topics:
  - Topic A
  - Topic B
concepts:
  - Concept X
  - Concept Y

Known topics in the vault:
{{KNOWN_TOPICS}}

Known concepts in the vault:
{{KNOWN_CONCEPTS}}

Note content:
{{NOTE_BODY}}`,
  de: `Erstelle 2-3 Vorschläge für "Themen" und 2-3 Vorschläge für "Konzepte" passend zum Inhalt der Notiz als Taxonomie. Suche zuerst nach passenden vorhandenen Vault-Themen und -Konzepten und VERWENDE sie wieder. Erfinde einen neuen Eintrag nur dann, wenn kein passender existiert.

Ausgabe-Format: ein YAML-artiger Block mit genau zwei Keys (topics, concepts), jeweils eine Liste mit Bindestrich-Einträgen.
topics:
  - Thema A
  - Thema B
concepts:
  - Konzept X
  - Konzept Y

Bekannte Themen im Vault:
{{KNOWN_TOPICS}}

Bekannte Konzepte im Vault:
{{KNOWN_CONCEPTS}}

Note-Inhalt:
{{NOTE_BODY}}`,
  fr: `Produis 2 à 3 suggestions de "Sujets" et 2 à 3 suggestions de "Concepts" correspondant au contenu de la note, sous forme de taxonomie. Vérifie d'abord les sujets et concepts existants dans le vault et RÉUTILISE-les s'ils conviennent. N'invente une nouvelle entrée que si aucune existante ne convient.

Format de sortie : un bloc YAML avec exactement deux clés (topics, concepts), chacune une liste à tirets.
topics:
  - Sujet A
  - Sujet B
concepts:
  - Concept X
  - Concept Y

Sujets connus dans le vault :
{{KNOWN_TOPICS}}

Concepts connus dans le vault :
{{KNOWN_CONCEPTS}}

Contenu de la note :
{{NOTE_BODY}}`,
  es: `Produce de 2 a 3 sugerencias de "Temas" y de 2 a 3 sugerencias de "Conceptos" que coincidan con el contenido de la nota, como una taxonomía. Primero revisa los temas y conceptos existentes en el vault y REUTILÍZALOS cuando encajen. Solo inventa una entrada nueva cuando ninguna existente encaje.

Formato de salida: un bloque al estilo YAML con exactamente dos claves (topics, concepts), cada una una lista con guiones.
topics:
  - Tema A
  - Tema B
concepts:
  - Concepto X
  - Concepto Y

Temas conocidos en el vault:
{{KNOWN_TOPICS}}

Conceptos conocidos en el vault:
{{KNOWN_CONCEPTS}}

Contenido de la nota:
{{NOTE_BODY}}`,
  it: `Produci da 2 a 3 suggerimenti per "Argomenti" e da 2 a 3 suggerimenti per "Concetti" corrispondenti al contenuto della nota, come tassonomia. Controlla prima gli argomenti e concetti esistenti nel vault e RIUTILIZZALI quando si adattano. Inventa una nuova voce solo quando nessuna esistente si adatta.

Formato di output: un blocco in stile YAML con esattamente due chiavi (topics, concepts), ciascuna una lista con trattini.
topics:
  - Argomento A
  - Argomento B
concepts:
  - Concetto X
  - Concetto Y

Argomenti noti nel vault:
{{KNOWN_TOPICS}}

Concetti noti nel vault:
{{KNOWN_CONCEPTS}}

Contenuto della nota:
{{NOTE_BODY}}`,
  ru: `Создайте 2-3 предложения для "Темы" и 2-3 предложения для "Концепции", соответствующих содержанию заметки, в виде таксономии. Сначала проверьте существующие темы и концепции в хранилище и ПОВТОРНО ИСПОЛЬЗУЙТЕ их, если они подходят. Создавайте новую запись только если ни одна существующая не подходит.

Формат вывода: блок в стиле YAML с ровно двумя ключами (topics, concepts), каждый — список с дефисами.
topics:
  - Тема A
  - Тема B
concepts:
  - Концепция X
  - Концепция Y

Известные темы в хранилище:
{{KNOWN_TOPICS}}

Известные концепции в хранилище:
{{KNOWN_CONCEPTS}}

Содержание заметки:
{{NOTE_BODY}}`,
  ar: `أنتج 2-3 اقتراحات لـ "الموضوعات" و 2-3 اقتراحات لـ "المفاهيم" التي تتطابق مع محتوى الملاحظة، كتصنيف. تحقق أولاً من الموضوعات والمفاهيم الموجودة في الـ vault وأعد استخدامها عند ملاءمتها. لا تخترع إدخالاً جديداً إلا عندما لا يلائم أي إدخال موجود.

تنسيق الإخراج: كتلة بنمط YAML بمفتاحين فقط (topics, concepts)، كل منهما قائمة بالشرطات.
topics:
  - موضوع A
  - موضوع B
concepts:
  - مفهوم X
  - مفهوم Y

الموضوعات المعروفة في الـ vault:
{{KNOWN_TOPICS}}

المفاهيم المعروفة في الـ vault:
{{KNOWN_CONCEPTS}}

محتوى الملاحظة:
{{NOTE_BODY}}`,
  zh: `根据笔记内容，生成 2-3 个"主题"建议和 2-3 个"概念"建议，作为分类法。首先检查 vault 中已有的主题和概念，并在合适时予以复用。只有在没有现有条目合适时才发明新条目。

输出格式：YAML 风格的代码块，恰好包含两个键（topics、concepts），每个键都是带连字符的列表。
topics:
  - 主题 A
  - 主题 B
concepts:
  - 概念 X
  - 概念 Y

vault 中的已知主题：
{{KNOWN_TOPICS}}

vault 中的已知概念：
{{KNOWN_CONCEPTS}}

笔记内容：
{{NOTE_BODY}}`,
  ko: `노트 내용에 맞는 "주제(Topics)" 2-3개와 "개념(Concepts)" 2-3개를 분류 체계로 생성하세요. 먼저 vault에 있는 기존 주제와 개념을 확인하고 적합한 경우 재사용하세요. 적합한 기존 항목이 없을 때만 새 항목을 만드세요.

출력 형식: 정확히 두 개의 키(topics, concepts)를 가진 YAML 스타일 블록, 각각 하이픈 목록.
topics:
  - 주제 A
  - 주제 B
concepts:
  - 개념 X
  - 개념 Y

vault의 알려진 주제:
{{KNOWN_TOPICS}}

vault의 알려진 개념:
{{KNOWN_CONCEPTS}}

노트 내용:
{{NOTE_BODY}}`,
  ja: `ノートの内容に合致する「トピック」を 2～3 個と「概念」を 2～3 個、分類体系として生成してください。まず vault 内の既存のトピックと概念を確認し、適合する場合は再利用してください。適合する既存項目がない場合のみ新項目を作成してください。

出力形式：ちょうど 2 つのキー（topics、concepts）を持つ YAML スタイルのブロック、それぞれハイフン付きリスト。
topics:
  - トピック A
  - トピック B
concepts:
  - 概念 X
  - 概念 Y

vault 内の既知のトピック：
{{KNOWN_TOPICS}}

vault 内の既知の概念：
{{KNOWN_CONCEPTS}}

ノート内容：
{{NOTE_BODY}}`,
  hi: `नोट की सामग्री से मेल खाते 2-3 "विषय" (Topics) सुझाव और 2-3 "अवधारणा" (Concepts) सुझाव वर्गीकरण के रूप में बनाएँ। पहले vault के मौजूदा विषयों और अवधारणाओं की जाँच करें और जहाँ उपयुक्त हों, उन्हें फिर से उपयोग करें। नया प्रविष्टि केवल तब बनाएँ जब कोई मौजूदा उपयुक्त न हो।

आउटपुट प्रारूप: ठीक दो कुंजियों (topics, concepts) वाला YAML-शैली का ब्लॉक, प्रत्येक हाइफ़न-सूची।
topics:
  - विषय A
  - विषय B
concepts:
  - अवधारणा X
  - अवधारणा Y

vault में ज्ञात विषय:
{{KNOWN_TOPICS}}

vault में ज्ञात अवधारणाएँ:
{{KNOWN_CONCEPTS}}

नोट सामग्री:
{{NOTE_BODY}}`,
};

/** Built-in description preset: one-sentence summary in target language. */
export const DEFAULT_DESCRIPTION: GeneratorPreset = {
  id: "description",
  displayName: "Description (one-sentence summary)",
  targetProperty: "description",
  parser: "single_line_text",
  description: "Writes a single-sentence summary of the note into `description`.",
  isBuiltIn: true,
  prompts: DESCRIPTION_PROMPTS,
};

/** Built-in keywords preset: 5-10 hyphenated keywords. */
export const DEFAULT_KEYWORDS: GeneratorPreset = {
  id: "keywords",
  displayName: "Keywords / tags",
  targetProperty: "tags",
  parser: "list_string",
  description: "Adds 5-10 hyphenated keywords to `tags` (merged with existing).",
  isBuiltIn: true,
  prompts: KEYWORDS_PROMPTS,
};

/** Built-in MoC preset: 2-3 Topics + 2-3 Concepts. */
export const DEFAULT_MOC: GeneratorPreset = {
  id: "moc",
  displayName: "Map of Content (topics + concepts)",
  targetProperty: "moc",
  parser: "moc_topics_concepts",
  description: "Produces 2-3 topics and 2-3 concepts as a YAML map under `moc`.",
  isBuiltIn: true,
  prompts: MOC_PROMPTS,
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

/**
 * Migrate a legacy preset that has prompts only for "en" and "de" to
 * fill in the other 9 supported languages from the defaults. Used at
 * plugin load on every entry of settings.presets so an old data.json
 * keeps working after the 11-language expansion. New languages get
 * the canonical built-in prompt as a starting point; the user can
 * edit them per-language in Settings.
 */
export function fillMissingLanguagePrompts(
  preset: GeneratorPreset,
): GeneratorPreset {
  const baseline = DEFAULT_PRESETS.find((p) => p.id === preset.id);
  if (!baseline) return preset;
  const filled: Record<GeneratorLanguage, string> = { ...baseline.prompts };
  for (const lang of GENERATOR_LANGUAGES) {
    const existing = preset.prompts?.[lang];
    if (typeof existing === "string" && existing.length > 0) {
      filled[lang] = existing;
    }
  }
  return { ...preset, prompts: filled };
}
