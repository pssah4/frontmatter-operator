import { App, Modal, Notice, Setting } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_API_VERSIONS,
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  type CustomModel,
  type ProviderType,
  type AwsAuthMode,
  newModelId,
  recommendedMaxTokens,
  supportsThinking,
  supportsPromptCache,
  isTemperatureFixed,
  getMaxTemperature,
  getModelOutputCeiling,
} from "../../types/llm";
import { buildApiHandler } from "../../api/ProviderRegistry";

/**
 * VO-style per-model configuration modal. Renders ~18 form rows, most of
 * which are conditionally visible based on the chosen provider.
 */
export class ModelConfigModal extends Modal {
  private form: CustomModel;
  private isNew: boolean;
  private testEl: HTMLElement | null = null;
  private autoMaxTokens: boolean;

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    initial: CustomModel | null,
    private onSaved: () => void,
  ) {
    super(app);
    this.isNew = !initial;
    this.form = initial
      ? JSON.parse(JSON.stringify(initial))
      : ({
          id: newModelId(),
          name: "",
          provider: "anthropic",
          displayName: "",
          enabled: true,
          apiKey: "",
          baseUrl: DEFAULT_BASE_URLS.anthropic,
        } satisfies CustomModel);
    this.autoMaxTokens = this.form.maxTokens === undefined;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.isNew ? "Add model" : "Edit model");

    this.renderProviderRow(contentEl);
    this.renderSuggestionsRow(contentEl);
    this.renderModelIdRow(contentEl);
    this.renderDisplayNameRow(contentEl);

    if (showApiKey(this.form.provider)) this.renderApiKeyRow(contentEl);
    if (showBaseUrl(this.form.provider)) this.renderBaseUrlRow(contentEl);
    if (this.form.provider === "azure") this.renderApiVersionRow(contentEl);
    if (this.form.provider === "anthropic") this.renderGatewayRow(contentEl);

    if (this.form.provider === "bedrock") this.renderBedrockRows(contentEl);
    if (this.form.provider === "github-copilot") {
      this.renderOAuthRow(contentEl, "github-copilot");
    }
    if (this.form.provider === "chatgpt-oauth") {
      this.renderOAuthRow(contentEl, "chatgpt-oauth");
    }
    if (this.form.provider === "kilo-gateway") {
      this.renderOAuthRow(contentEl, "kilo-gateway");
    }

    this.renderMaxTokensRow(contentEl);
    if (!isTemperatureFixed(this.form)) this.renderTemperatureRow(contentEl);
    if (supportsPromptCache(this.form)) this.renderPromptCacheRow(contentEl);
    if (supportsThinking(this.form)) this.renderThinkingRows(contentEl);

    this.renderEnabledRow(contentEl);
    this.renderTestRow(contentEl);
    this.renderFooter(contentEl);
  }

  // ============================================================ ROWS

  private renderProviderRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Provider")
      .setDesc("Which API speaks to this model.")
      .addDropdown((d) => {
        for (const type of Object.keys(PROVIDER_LABELS) as ProviderType[]) {
          d.addOption(type, PROVIDER_LABELS[type]);
        }
        d.setValue(this.form.provider);
        d.onChange((value) => {
          this.form.provider = value as ProviderType;
          this.form.baseUrl = DEFAULT_BASE_URLS[this.form.provider];
          this.form.apiVersion = DEFAULT_API_VERSIONS[this.form.provider];
          if (!this.form.name) {
            const first = MODEL_SUGGESTIONS[this.form.provider]?.[0];
            if (first) this.form.name = first.id;
          }
          this.onOpen();
        });
      });
  }

  private renderSuggestionsRow(parent: HTMLElement): void {
    const items = MODEL_SUGGESTIONS[this.form.provider] ?? [];
    if (items.length === 0) return;
    const setting = new Setting(parent)
      .setName("Quick-pick")
      .setDesc("Pick a model id from the recommended list.");
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const list = groups.get(it.group) ?? [];
      list.push(it);
      groups.set(it.group, list);
    }
    const select = setting.controlEl.createEl("select");
    select.createEl("option", { value: "", text: "(custom)" });
    for (const [group, list] of groups) {
      const optgroup = select.createEl("optgroup");
      optgroup.label = group;
      for (const it of list) {
        const opt = optgroup.createEl("option", { value: it.id, text: it.label });
        if (it.id === this.form.name) opt.selected = true;
      }
    }
    select.addEventListener("change", () => {
      if (select.value) {
        this.form.name = select.value;
        this.onOpen();
      }
    });
  }

  private renderModelIdRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Model id")
      .setDesc("Provider-specific identifier (e.g. claude-opus-4-7, gpt-4o).")
      .addText((t) => {
        t.setPlaceholder("model id").setValue(this.form.name).onChange((v) => {
          this.form.name = v;
        });
        if (this.form.isBuiltIn) t.inputEl.disabled = true;
      });
  }

  private renderDisplayNameRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Display name")
      .setDesc("Optional friendly label.")
      .addText((t) => {
        t.setPlaceholder("e.g. Opus -- writing")
          .setValue(this.form.displayName ?? "")
          .onChange((v) => {
            this.form.displayName = v;
          });
      });
  }

  private renderApiKeyRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("API key")
      .setDesc(apiKeyHint(this.form.provider))
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-...")
          .setValue(this.form.apiKey ?? "")
          .onChange((v) => {
            this.form.apiKey = v;
          });
      });
  }

  private renderBaseUrlRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Base URL")
      .setDesc(baseUrlHint(this.form.provider))
      .addText((t) => {
        t.setPlaceholder(DEFAULT_BASE_URLS[this.form.provider] ?? "")
          .setValue(this.form.baseUrl ?? "")
          .onChange((v) => {
            this.form.baseUrl = v;
          });
      });
  }

  private renderApiVersionRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("API version")
      .setDesc("Azure OpenAI deployment api-version (e.g. 2024-10-21).")
      .addText((t) => {
        t.setPlaceholder("2024-10-21")
          .setValue(this.form.apiVersion ?? DEFAULT_API_VERSIONS.azure ?? "")
          .onChange((v) => {
            this.form.apiVersion = v;
          });
      });
  }

  private renderGatewayRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Enterprise gateway")
      .setDesc("Route through a custom gateway with a static header.")
      .addToggle((t) => {
        t.setValue(!!this.form.useGateway).onChange((v) => {
          this.form.useGateway = v;
          this.onOpen();
        });
      });
    if (!this.form.useGateway) return;
    new Setting(parent)
      .setName("Gateway header name")
      .addText((t) => {
        t.setValue(this.form.gatewayHeaderName ?? "Ocp-Apim-Subscription-Key")
          .onChange((v) => {
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

  private renderBedrockRows(parent: HTMLElement): void {
    new Setting(parent)
      .setName("AWS region")
      .addText((t) => {
        t.setPlaceholder("eu-central-1")
          .setValue(this.form.awsRegion ?? "eu-central-1")
          .onChange((v) => {
            this.form.awsRegion = v;
          });
      });
    new Setting(parent)
      .setName("AWS auth mode")
      .addDropdown((d) => {
        d.addOption("api-key", "Bedrock API Key");
        d.addOption("gateway", "Enterprise Gateway");
        d.addOption("access-key", "IAM Access Key (SigV4 -- next phase)");
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
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.awsApiKey ?? "").onChange((v) => {
            this.form.awsApiKey = v;
          });
        });
    } else if (mode === "access-key") {
      new Setting(parent)
        .setName("AWS access key id")
        .addText((t) => {
          t.setValue(this.form.awsAccessKey ?? "").onChange((v) => {
            this.form.awsAccessKey = v;
          });
        });
      new Setting(parent)
        .setName("AWS secret access key")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.form.awsSecretKey ?? "").onChange((v) => {
            this.form.awsSecretKey = v;
          });
        });
      new Setting(parent)
        .setName("AWS session token (optional)")
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
  }

  private renderOAuthRow(parent: HTMLElement, kind: ProviderType): void {
    const setting = new Setting(parent).setName("Account").setDesc(oauthHint(kind, this.plugin));
    setting.addButton((b) => {
      b.setButtonText(oauthButtonLabel(kind, this.plugin)).onClick(async () => {
        try {
          if (kind === "github-copilot") {
            await this.plugin.copilotAuth.signIn(({ userCode, verificationUri }) => {
              new Notice(
                `GitHub code: ${userCode}\nOpen ${verificationUri} to authorize.`,
                30_000,
              );
              window.open(verificationUri, "_blank");
            });
          } else if (kind === "chatgpt-oauth") {
            await this.plugin.chatgptAuth.signIn();
          } else if (kind === "kilo-gateway") {
            await this.plugin.kiloAuth.signInWithDeviceFlow(
              ({ userCode, verificationUri }) => {
                new Notice(
                  `Kilo code: ${userCode}\nOpen ${verificationUri} to authorize.`,
                  30_000,
                );
                window.open(verificationUri, "_blank");
              },
            );
          }
          this.onOpen();
        } catch (err) {
          new Notice(`Auth failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    });
    if (oauthIsSignedIn(kind, this.plugin)) {
      setting.addButton((b) => {
        b.setButtonText("Sign out").onClick(async () => {
          if (kind === "github-copilot") await this.plugin.copilotAuth.signOut();
          if (kind === "chatgpt-oauth") await this.plugin.chatgptAuth.signOut();
          if (kind === "kilo-gateway") await this.plugin.kiloAuth.signOut();
          this.onOpen();
        });
      });
    }
    if (kind === "kilo-gateway") {
      new Setting(parent)
        .setName("Manual token (alternative to device flow)")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("paste kilo-token")
            .setValue(this.plugin.settings.kiloToken ?? "")
            .onChange(async (v) => {
              if (v) {
                await this.plugin.kiloAuth.setManualToken(v);
              }
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
  }

  private renderMaxTokensRow(parent: HTMLElement): void {
    const ceiling = getModelOutputCeiling(this.form.name) ?? 200_000;
    new Setting(parent)
      .setName("Max output tokens")
      .setDesc(
        this.autoMaxTokens
          ? `Auto (~${recommendedMaxTokens(this.form.name)}). Untick to set manually.`
          : "Manual cap.",
      )
      .addToggle((t) => {
        t.setValue(this.autoMaxTokens).onChange((v) => {
          this.autoMaxTokens = v;
          if (v) this.form.maxTokens = undefined;
          else this.form.maxTokens = recommendedMaxTokens(this.form.name);
          this.onOpen();
        });
      });
    if (!this.autoMaxTokens) {
      new Setting(parent).addSlider((s) => {
        s.setLimits(1024, ceiling, 1024);
        s.setValue(this.form.maxTokens ?? recommendedMaxTokens(this.form.name));
        s.setDynamicTooltip();
        s.onChange((v) => {
          this.form.maxTokens = v;
        });
      });
    }
  }

  private renderTemperatureRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Temperature")
      .setDesc(
        this.form.temperature === undefined
          ? "Use model default (deterministic generation prefers 0)."
          : `Manual: ${this.form.temperature}`,
      )
      .addToggle((t) => {
        t.setValue(this.form.temperature !== undefined).onChange((v) => {
          this.form.temperature = v ? 0 : undefined;
          this.onOpen();
        });
      });
    if (this.form.temperature !== undefined) {
      new Setting(parent).addSlider((s) => {
        s.setLimits(0, getMaxTemperature(this.form.provider), 0.05);
        s.setValue(this.form.temperature ?? 0);
        s.setDynamicTooltip();
        s.onChange((v) => {
          this.form.temperature = v;
        });
      });
    }
  }

  private renderPromptCacheRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Prompt caching")
      .setDesc("Anthropic prompt caching (reduces input cost on repeated prefixes).")
      .addToggle((t) => {
        t.setValue(this.form.promptCachingEnabled ?? true).onChange((v) => {
          this.form.promptCachingEnabled = v;
        });
      });
  }

  private renderThinkingRows(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Extended thinking")
      .setDesc("Anthropic native reasoning (Claude 3.7+, 4.x).")
      .addToggle((t) => {
        t.setValue(!!this.form.thinkingEnabled).onChange((v) => {
          this.form.thinkingEnabled = v;
          if (v && this.form.thinkingBudgetTokens === undefined) {
            this.form.thinkingBudgetTokens = 10_000;
          }
          this.onOpen();
        });
      });
    if (this.form.thinkingEnabled) {
      new Setting(parent)
        .setName("Thinking budget (tokens)")
        .addSlider((s) => {
          s.setLimits(1024, 128_000, 1024);
          s.setValue(this.form.thinkingBudgetTokens ?? 10_000);
          s.setDynamicTooltip();
          s.onChange((v) => {
            this.form.thinkingBudgetTokens = v;
          });
        });
    }
  }

  private renderEnabledRow(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Enabled")
      .setDesc("Disabled models stay in the list but are hidden from generators.")
      .addToggle((t) => {
        t.setValue(this.form.enabled).onChange((v) => {
          this.form.enabled = v;
        });
      });
  }

  private renderTestRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "fm-editor-modal-row" });
    const btn = row.createEl("button", {
      text: "Test connection",
      cls: "fm-editor-btn",
    });
    this.testEl = row.createDiv({ cls: "fm-editor-modal-status" });
    btn.addEventListener("click", async () => {
      if (!this.testEl) return;
      this.testEl.setText("Pinging...");
      try {
        const handler = await buildApiHandler(this.form, this.plugin);
        const result = await handler.ping();
        if (result.ok) {
          this.testEl.setText(`OK — model returned: ${result.model}`);
        } else {
          this.testEl.setText(`Failed — ${result.error}`);
        }
      } catch (err) {
        this.testEl.setText(
          `Failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", {
      text: "Cancel",
      cls: "fm-editor-btn",
    });
    cancel.addEventListener("click", () => this.close());
    const save = right.createEl("button", {
      text: this.isNew ? "Add model" : "Save",
      cls: "fm-editor-btn mod-cta",
    });
    save.addEventListener("click", async () => {
      if (!this.form.name.trim()) {
        new Notice("Model id is required");
        return;
      }
      const list = this.plugin.settings.models.filter((m) => m.id !== this.form.id);
      list.push(this.form);
      this.plugin.settings.models = list;
      if (!this.plugin.settings.defaultModelId && this.form.enabled) {
        this.plugin.settings.defaultModelId = this.form.id;
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

// ----------------------------------------------------------- helpers

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
      return "Anthropic API key. Stored in this vault's data.json (encrypted via OS keychain when available).";
    case "openai":
      return "OpenAI API key (sk-...).";
    case "openrouter":
      return "OpenRouter API key (sk-or-...).";
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
      : "Not signed in. Click Sign in to start the device flow.";
  }
  if (p === "chatgpt-oauth") {
    const email = plugin.settings.chatgptOAuthEmail;
    return email
      ? `Signed in as ${email}.`
      : "Not signed in. Click Sign in to launch the PKCE loopback flow.";
  }
  if (p === "kilo-gateway") {
    return plugin.settings.kiloToken
      ? "Signed in to Kilo Gateway."
      : "Not signed in. Use the device flow or paste a manual token below.";
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
