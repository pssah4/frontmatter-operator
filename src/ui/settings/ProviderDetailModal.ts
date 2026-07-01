import { App, Notice, Setting } from "obsidian";
import { DraggableModal } from "../modals/DraggableModal";
import type FrontmatterEditorPlugin from "../../main";
import {
  DEFAULT_API_VERSIONS,
  DEFAULT_BASE_URLS,
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  getDefaultModelForProvider,
  newProviderId,
  type AwsAuthMode,
  type DiscoveredModel,
  type ProviderConfig,
  type ProviderType,
} from "../../types/llm";
import { fetchModels } from "../../api/fetchModels";
import { OAuthProgressModal } from "../modals/OAuthProgressModal";

/**
 * VO-style provider account modal -- three sections:
 *
 *   IDENTITY          provider type, display name, enabled
 *   AUTHENTICATION    auth fields conditional on provider type
 *   DISCOVERY         "Save first" hint OR refresh button + cached model count
 *
 * Decode parameters (max tokens, temperature, thinking budget) do NOT live
 * here -- they are picked per generation run in the AI chat modal.
 */
export class ProviderDetailModal extends DraggableModal {
  private form: ProviderConfig;
  private isNew: boolean;
  private testEl: HTMLElement | null = null;
  private discoveryEl: HTMLElement | null = null;
  /**
   * Initial-model picker for the Add-Provider flow. Pre-selected to the
   * first MODEL_SUGGESTIONS entry for the chosen provider type. On Save
   * it lands in plugin.settings.lastUsedModelByProvider[id] so the AI
   * chat picker has a sensible default the moment the new provider is
   * usable. Mirrors VO's defaultDraftProvider + maybeAutoRefresh
   * pre-population pattern.
   */
  private initialModelId: string = "";

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    initial: ProviderConfig | null,
    private onSaved: () => void,
  ) {
    super(app);
    this.isNew = !initial;
    this.form = initial
      ? JSON.parse(JSON.stringify(initial))
      : ({
          id: newProviderId(),
          type: "anthropic",
          displayName: PROVIDER_LABELS.anthropic,
          enabled: true,
          apiKey: "",
          baseUrl: DEFAULT_BASE_URLS.anthropic,
        } satisfies ProviderConfig);
    // Seed the default-model picker:
    //   * Add-flow: first MODEL_SUGGESTIONS entry for the type.
    //   * Edit-flow: whatever the user last picked for this provider, or
    //     fall back to the suggestion-default.
    this.initialModelId = this.isNew
      ? getDefaultModelForProvider(this.form.type)
      : (plugin.settings.lastUsedModelByProvider?.[this.form.id] ??
         getDefaultModelForProvider(this.form.type));
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.isNew ? "Add provider" : "Edit provider");

    this.renderIdentitySection(contentEl);
    this.renderAuthSection(contentEl);
    this.renderDiscoverySection(contentEl);
    this.renderDefaultModelSection(contentEl);
    this.renderFooter(contentEl);
  }

  // ----------------------------------------------------------- DEFAULT MODEL

  /**
   * Pre-selected model the AI chat picker uses the first time this
   * provider is the source. On Add this is seeded from
   * getDefaultModelForProvider(type); on Edit from the persisted
   * lastUsedModelByProvider entry. The Save handler writes the picked
   * value to lastUsedModelByProvider[id]. For providers without static
   * suggestions (azure / ollama / lmstudio / custom) the picker becomes
   * a free-text input so the user can paste a model id.
   */
  private renderDefaultModelSection(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-section-label",
      text: "DEFAULT MODEL",
    });

    const cached = this.form.discoveredModels ?? [];
    const suggestions = MODEL_SUGGESTIONS[this.form.type] ?? [];
    const haveDropdown = cached.length > 0 || suggestions.length > 0;

    if (haveDropdown) {
      new Setting(parent)
        .setName("Default model")
        .setDesc(
          cached.length > 0
            ? "Picked from the latest Refresh. Generate-with-AI defaults to this model."
            : "Static suggestion list. Click Refresh in Discovery to pull the live list.",
        )
        .addDropdown((d) => {
          // Cached refresh results win over static suggestions.
          if (cached.length > 0) {
            for (const m of cached) d.addOption(m.id, m.label);
          } else {
            for (const s of suggestions) {
              d.addOption(s.id, `${s.group} -- ${s.label}`);
            }
          }
          // If the seed isn't in the option list (e.g. type just
          // changed), fall back to the first available option.
          const available = (cached.length > 0 ? cached : suggestions).map(
            (m) => ("id" in m ? m.id : ""),
          );
          if (!available.includes(this.initialModelId) && available[0]) {
            this.initialModelId = available[0];
          }
          d.setValue(this.initialModelId);
          d.onChange((v) => {
            this.initialModelId = v;
          });
        });
    } else {
      new Setting(parent)
        .setName("Default model")
        .setDesc(
          "This provider has no static suggestions. Type the model id you want as the default.",
        )
        .addText((t) => {
          t.setPlaceholder("model-id");
          t.setValue(this.initialModelId);
          t.onChange((v) => {
            this.initialModelId = v.trim();
          });
        });
    }
  }

  // ----------------------------------------------------------- IDENTITY

  private renderIdentitySection(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-section-label",
      text: "IDENTITY",
    });

    new Setting(parent)
      .setName("Provider")
      .setDesc("Which API speaks to this account.")
      .addDropdown((d) => {
        for (const type of Object.keys(PROVIDER_LABELS) as ProviderType[]) {
          d.addOption(type, PROVIDER_LABELS[type]);
        }
        d.setValue(this.form.type);
        d.onChange((value) => {
          this.form.type = value as ProviderType;
          this.form.baseUrl = DEFAULT_BASE_URLS[this.form.type];
          this.form.apiVersion = DEFAULT_API_VERSIONS[this.form.type];
          // Reset auth fields for the new provider type.
          this.form.discoveredModels = undefined;
          this.form.discoveredAt = undefined;
          // Reseed the default-model picker for the new type.
          this.initialModelId = getDefaultModelForProvider(this.form.type);
          if (this.isNew) {
            this.form.displayName = PROVIDER_LABELS[this.form.type];
          }
          this.onOpen();
        });
      });

    new Setting(parent)
      .setName("Display name")
      .setDesc("Friendly label shown in the AI chat picker.")
      .addText((t) => {
        t.setPlaceholder(PROVIDER_LABELS[this.form.type])
          .setValue(this.form.displayName)
          .onChange((v) => {
            this.form.displayName = v;
          });
      });

    new Setting(parent)
      .setName("Enabled")
      .setDesc("Disabled providers stay in the list but are hidden from the AI chat.")
      .addToggle((t) => {
        t.setValue(this.form.enabled).onChange((v) => {
          this.form.enabled = v;
        });
      });
  }

  // ----------------------------------------------------------- AUTH

  private renderAuthSection(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-section-label",
      text: "AUTHENTICATION",
    });

    const p = this.form.type;

    if (p === "bedrock") {
      this.renderBedrockAuth(parent);
      return;
    }
    if (p === "github-copilot" || p === "chatgpt-oauth" || p === "kilo-gateway") {
      this.renderOAuth(parent, p);
      if (p === "kilo-gateway") this.renderKiloExtra(parent);
      return;
    }

    if (showBaseUrl(p)) {
      new Setting(parent)
        .setName("Base URL")
        .setDesc(baseUrlHint(p))
        .addText((t) => {
          t.setPlaceholder(DEFAULT_BASE_URLS[p] ?? "")
            .setValue(this.form.baseUrl ?? "")
            .onChange((v) => {
              this.form.baseUrl = v;
            });
        });
    }
    if (p === "azure") {
      new Setting(parent)
        .setName("API version")
        .addText((t) => {
          t.setPlaceholder("2024-10-21")
            .setValue(this.form.apiVersion ?? DEFAULT_API_VERSIONS.azure ?? "")
            .onChange((v) => {
              this.form.apiVersion = v;
            });
        });
    }
    if (showApiKey(p)) {
      new Setting(parent)
        .setName("API key")
        .setDesc(apiKeyHint(p))
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("sk-...").setValue(this.form.apiKey ?? "").onChange((v) => {
            this.form.apiKey = v;
          });
        });
    }
    if (p === "anthropic") {
      new Setting(parent)
        .setName("Enterprise gateway")
        .setDesc("Route through a custom gateway with a static header.")
        .addToggle((t) => {
          t.setValue(!!this.form.useGateway).onChange((v) => {
            this.form.useGateway = v;
            this.onOpen();
          });
        });
      if (this.form.useGateway) {
        new Setting(parent).setName("Gateway header name").addText((t) => {
          t.setValue(this.form.gatewayHeaderName ?? "Ocp-Apim-Subscription-Key").onChange(
            (v) => {
              this.form.gatewayHeaderName = v;
            },
          );
        });
        new Setting(parent).setName("Gateway header value").addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.gatewayHeaderValue ?? "").onChange((v) => {
            this.form.gatewayHeaderValue = v;
          });
        });
      }
    }
    this.renderTestRow(parent);
  }

  private renderBedrockAuth(parent: HTMLElement): void {
    new Setting(parent)
      .setName("AWS region")
      .addText((t) => {
        t.setPlaceholder("eu-central-1")
          .setValue(this.form.awsRegion ?? "")
          .onChange((v) => {
            this.form.awsRegion = v;
          });
      });
    new Setting(parent)
      .setName("Auth mode")
      .addDropdown((d) => {
        d.addOption("api-key", "API key (bearer)");
        d.addOption("access-key", "IAM Access Key (SigV4)");
        d.addOption("gateway", "Enterprise Gateway");
        d.setValue(this.form.awsAuthMode ?? "api-key");
        d.onChange((v) => {
          this.form.awsAuthMode = v as AwsAuthMode;
          this.onOpen();
        });
      });
    const mode = this.form.awsAuthMode ?? "api-key";
    if (mode === "api-key") {
      new Setting(parent)
        .setName("Bedrock API key")
        .setDesc("Bedrock API keys are runtime-only. Use Access Key mode to enable model discovery.")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.awsApiKey ?? "").onChange((v) => {
            this.form.awsApiKey = v;
          });
        });
    } else if (mode === "access-key") {
      new Setting(parent)
        .setName("Access key id")
        .addText((t) => {
          t.setValue(this.form.awsAccessKey ?? "").onChange((v) => {
            this.form.awsAccessKey = v;
          });
        });
      new Setting(parent)
        .setName("Secret access key")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.awsSecretKey ?? "").onChange((v) => {
            this.form.awsSecretKey = v;
          });
        });
      new Setting(parent)
        .setName("Session token (optional)")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.awsSessionToken ?? "").onChange((v) => {
            this.form.awsSessionToken = v;
          });
        });
    } else {
      new Setting(parent)
        .setName("Gateway header name")
        .addText((t) => {
          t.setValue(this.form.gatewayHeaderName ?? "").onChange((v) => {
            this.form.gatewayHeaderName = v;
          });
        });
      new Setting(parent)
        .setName("Gateway header value")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.gatewayHeaderValue ?? "").onChange((v) => {
            this.form.gatewayHeaderValue = v;
          });
        });
    }
    this.renderTestRow(parent);
  }

  private renderOAuth(parent: HTMLElement, p: ProviderType): void {
    const setting = new Setting(parent)
      .setName("Account")
      .setDesc(oauthHint(p, this.plugin));
    setting.addButton((b) => {
      b.setButtonText(oauthButtonLabel(p, this.plugin)).onClick(() => {
        this.startOAuth(p);
      });
    });
    if (oauthIsSignedIn(p, this.plugin)) {
      setting.addButton((b) => {
        b.setButtonText("Sign out").onClick(async () => {
          if (p === "github-copilot") await this.plugin.copilotAuth.signOut();
          if (p === "chatgpt-oauth") await this.plugin.chatgptAuth.signOut();
          if (p === "kilo-gateway") await this.plugin.kiloAuth.signOut();
          this.onOpen();
        });
      });
    }
  }

  private renderKiloExtra(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Manual token (alternative to device flow)")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("paste kilo-token")
          .setValue(this.plugin.settings.kiloToken ?? "")
          .onChange(async (v) => {
            if (v) await this.plugin.kiloAuth.setManualToken(v);
          });
      });
    new Setting(parent)
      .setName("Organization id (optional)")
      .addText((t) => {
        t.setValue(this.plugin.settings.kiloOrganizationId ?? "").onChange(
          async (v) => {
            this.plugin.settings.kiloOrganizationId = v || undefined;
            await this.plugin.saveSettings();
          },
        );
      });
  }

  private startOAuth(p: ProviderType): void {
    const titleByKind: Record<string, string> = {
      "github-copilot": "Sign in to GitHub Copilot",
      "chatgpt-oauth": "Sign in to ChatGPT",
      "kilo-gateway": "Sign in to Kilo Gateway",
    };
    new OAuthProgressModal(
      this.app,
      { title: titleByKind[p] ?? "Sign in", description: "", initialStatus: "Starting..." },
      async (ctrl) => {
        try {
          if (p === "github-copilot") {
            await this.plugin.copilotAuth.signIn({
              showUserCode: (info) => ctrl.showUserCode(info),
              setStatus: (text) => ctrl.setStatus(text),
              signal: ctrl.signal,
            });
          } else if (p === "chatgpt-oauth") {
            await this.plugin.chatgptAuth.signIn({
              setStatus: (text) => ctrl.setStatus(text),
              showAuthLink: (url) =>
                ctrl.showUserCode({ userCode: "(no code)", verificationUri: url }),
              signal: ctrl.signal,
            });
          } else if (p === "kilo-gateway") {
            await this.plugin.kiloAuth.signInWithDeviceFlow({
              showUserCode: (info) => ctrl.showUserCode(info),
              setStatus: (text) => ctrl.setStatus(text),
              signal: ctrl.signal,
            });
          }
          ctrl.finish();
          this.onOpen();
        } catch (err) {
          ctrl.fail(err instanceof Error ? err.message : String(err));
        }
      },
    ).open();
  }

  /**
   * Pick the model id Test-Connection should ping. Mirrors VO's
   * pickModelForTest (ProviderDetailModal.ts:603-631) with the
   * frontmatter-operator simplification (no tier mapping):
   *
   *   1. initialModelId (whatever the Default-Model picker shows -- if
   *      the user changed it, that's what we should test).
   *   2. First discovered model after the Bedrock-aware sort (so we get
   *      an Anthropic inference profile before a bare Nova id).
   *   3. First MODEL_SUGGESTIONS entry for the provider type.
   *   4. Hardcoded fallback for ChatGPT OAuth (gpt-5.5 -- the Codex
   *      backend has no /v1/models endpoint to seed from).
   *   5. '' (UI surfaces a "no model" message and skips the ping).
   *
   * The bare-id-as-pre-selection bug ("amazon.nova-2-lite-v1:0 with
   * on-demand throughput isn't supported") goes away once the Default
   * picker pre-selects a Converse-safe profile (see byBedrockPriority
   * in fetchModels.ts).
   */
  private pickModelForTest(): string {
    if (this.initialModelId) return this.initialModelId;
    const cached = this.form.discoveredModels;
    if (cached && cached.length > 0) return cached[0].id;
    const suggestions = MODEL_SUGGESTIONS[this.form.type] ?? [];
    if (suggestions.length > 0) return suggestions[0].id;
    if (this.form.type === "chatgpt-oauth") return "gpt-5.5";
    return "";
  }

  private renderTestRow(parent: HTMLElement): void {
    const setting = new Setting(parent)
      .setName("Test connection")
      .setDesc("Sends a ping to a default model.");
    setting.addButton((b) => {
      b.setButtonText("Test").onClick(async () => {
        if (!this.testEl) return;
        this.testEl.setText("Pinging...");
        try {
          // VO pattern (pickModelForTest, ProviderDetailModal.ts:603-631):
          // priority order is tier-overrides > tier-mapping > discovered
          // models > hardcoded fallbacks. In frontmatter-operator we
          // collapse tier-overrides+mapping into the single
          // initialModelId (the Default-Model picker), which is what the
          // user will actually use for Generate-with-AI -- testing
          // anything else is misleading. Provider-specific fallbacks
          // mirror VO when initialModelId is empty.
          const modelId = this.pickModelForTest();
          if (!modelId) {
            this.testEl.setText(
              "No model id available. Pick one in DEFAULT MODEL or Refresh in Discovery first.",
            );
            return;
          }
          const { buildApiHandler } = await import("../../api/ProviderRegistry");
          const handler = await buildApiHandler(
            this.form,
            { modelId },
            this.plugin,
          );
          const result = await handler.ping();
          if (result.ok) this.testEl.setText(`OK -- ${result.model}`);
          else this.testEl.setText(`Failed: ${result.error}`);
        } catch (err) {
          this.testEl.setText(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    });
    this.testEl = setting.controlEl.createDiv({
      cls: "fm-editor-modal-status",
    });
  }

  // ----------------------------------------------------------- DISCOVERY

  private renderDiscoverySection(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-section-label",
      text: "DISCOVERY",
    });

    if (this.isNew) {
      parent.createDiv({
        cls: "fm-editor-modal-hint",
        text: "Save the provider first, then refresh to discover its models.",
      });
      return;
    }

    const cached = this.form.discoveredModels ?? [];
    const setting = new Setting(parent)
      .setName("Models")
      .setDesc(
        cached.length === 0
          ? "No models cached yet. Click Refresh to enumerate available models."
          : `${cached.length} model${cached.length === 1 ? "" : "s"} cached from last refresh.`,
      );
    setting.addButton((b) => {
      b.setButtonText(cached.length === 0 ? "Refresh" : "Re-refresh").onClick(
        async () => {
          if (!this.discoveryEl) return;
          this.discoveryEl.setText("Fetching...");
          try {
            const result = await fetchModels(this.form, this.plugin);
            if (!result.ok) {
              this.discoveryEl.setText(`Failed: ${result.error}`);
              new Notice(`Fetch failed: ${result.error}`);
              return;
            }
            this.form.discoveredModels = result.models as DiscoveredModel[];
            this.form.discoveredAt = Date.now();
            // Family-aware promote: AWS sometimes returns the
            // version-less form (eu.anthropic.claude-opus-4-6) while
            // our static suggestion has the versioned form
            // (eu.anthropic.claude-opus-4-6-v1). A strict equality
            // check then auto-promotes to sorted[0] -- a newer model
            // the user may have no AWS access to (Opus 4.8 in
            // eu-central-1). So:
            //   1. Exact id in cache -> keep.
            //   2. Family match in cache -> upgrade to the cached form
            //      (same model the user had selected, just rewritten
            //      to whatever AWS now calls it).
            //   3. No match -> promote to sorted[0] (the curated-first
            //      bedrockSuggestionPriority gate ensures this is a
            //      VO MODEL_SUGGESTIONS entry whenever possible).
            const { bedrockFamilyKey } = await import("../../api/fetchModels");
            const cachedIds = new Set(result.models.map((m) => m.id));
            if (!cachedIds.has(this.initialModelId)) {
              const family = bedrockFamilyKey(this.initialModelId);
              const familyMatch = result.models.find(
                (m) => bedrockFamilyKey(m.id) === family,
              );
              if (familyMatch) {
                this.initialModelId = familyMatch.id;
              } else if (result.models[0]) {
                this.initialModelId = result.models[0].id;
              }
            }
            this.discoveryEl.setText(
              `Fetched ${result.models.length} model${result.models.length === 1 ? "" : "s"}.`,
            );
            this.onOpen();
          } catch (err) {
            this.discoveryEl?.setText(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    });
    this.discoveryEl = setting.controlEl.createDiv({
      cls: "fm-editor-modal-status",
    });
  }

  // ----------------------------------------------------------- FOOTER

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", { text: "Cancel", cls: "fm-editor-btn" });
    cancel.addEventListener("click", () => this.close());
    const save = right.createEl("button", {
      text: this.isNew ? "Add provider" : "Save",
      cls: "fm-editor-btn mod-cta",
    });
    save.addEventListener("click", async () => {
      if (!this.form.displayName.trim()) {
        new Notice("Display name is required");
        return;
      }
      const list = this.plugin.settings.providers.filter((p) => p.id !== this.form.id);
      list.push(this.form);
      this.plugin.settings.providers = list;
      if (!this.plugin.settings.defaultProviderId && this.form.enabled) {
        this.plugin.settings.defaultProviderId = this.form.id;
      }
      // Persist the picked default model. Generate-with-AI reads this on
      // its first run for the provider; without it the picker has no
      // sensible pre-selection on a fresh add.
      if (this.initialModelId) {
        if (!this.plugin.settings.lastUsedModelByProvider) {
          this.plugin.settings.lastUsedModelByProvider = {};
        }
        this.plugin.settings.lastUsedModelByProvider[this.form.id] =
          this.initialModelId;
      }
      await this.plugin.saveSettings();
      this.onSaved();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function showApiKey(p: ProviderType): boolean {
  return ![
    "ollama",
    "lmstudio",
    "github-copilot",
    "kilo-gateway",
    "bedrock",
    "chatgpt-oauth",
  ].includes(p);
}

function showBaseUrl(p: ProviderType): boolean {
  return ![
    "openai",
    "gemini",
    "openrouter",
    "github-copilot",
    "kilo-gateway",
    "bedrock",
    "chatgpt-oauth",
  ].includes(p);
}

function apiKeyHint(p: ProviderType): string {
  switch (p) {
    case "anthropic":
      return "Anthropic API key.";
    case "openai":
      return "OpenAI API key (sk-...).";
    case "openrouter":
      return "OpenRouter API key.";
    case "gemini":
      return "Google AI Studio API key.";
    case "azure":
      return "Azure OpenAI key for this deployment.";
    case "custom":
      return "Optional. Required when the endpoint enforces bearer auth.";
    default:
      return "API key";
  }
}

function baseUrlHint(p: ProviderType): string {
  switch (p) {
    case "ollama":
      return "Local Ollama server URL.";
    case "lmstudio":
      return "Local LM Studio server URL.";
    case "azure":
      return "Azure OpenAI endpoint without the /openai suffix.";
    case "custom":
      return "Full OpenAI-compatible endpoint URL.";
    case "anthropic":
      return "Override the Anthropic endpoint (rare; used by self-hosted gateways).";
    default:
      return "Base URL";
  }
}

function oauthHint(p: ProviderType, plugin: FrontmatterEditorPlugin): string {
  if (p === "github-copilot") {
    return plugin.settings.githubCopilotAccessToken
      ? "Signed in to GitHub Copilot."
      : "Not signed in.";
  }
  if (p === "chatgpt-oauth") {
    return plugin.settings.chatgptOAuthEmail
      ? `Signed in as ${plugin.settings.chatgptOAuthEmail}.`
      : "Not signed in.";
  }
  if (p === "kilo-gateway") {
    return plugin.settings.kiloToken ? "Signed in to Kilo Gateway." : "Not signed in.";
  }
  return "";
}

function oauthIsSignedIn(p: ProviderType, plugin: FrontmatterEditorPlugin): boolean {
  if (p === "github-copilot") return !!plugin.settings.githubCopilotAccessToken;
  if (p === "chatgpt-oauth") return !!plugin.settings.chatgptOAuthAccessToken;
  if (p === "kilo-gateway") return !!plugin.settings.kiloToken;
  return false;
}

function oauthButtonLabel(p: ProviderType, plugin: FrontmatterEditorPlugin): string {
  return oauthIsSignedIn(p, plugin) ? "Re-authenticate" : "Sign in";
}
