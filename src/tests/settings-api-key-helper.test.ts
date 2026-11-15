import { describe, expect, it, vi } from "vitest";

const resolved = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  resolveSettings: async () => resolved.value,
}));

const { SettingsManager } = await import("../settings.js");

async function managerResolving(value: unknown) {
  resolved.value = value;
  const manager = new SettingsManager(process.cwd());
  await manager.initialize();
  return manager;
}

describe("SettingsManager.getApiKeyHelper", () => {
  it("prefers a managed helper over the --settings override", async () => {
    const manager = await managerResolving({
      effective: { apiKeyHelper: "managed-helper" },
      provenance: { apiKeyHelper: { source: "managed" } },
      sources: [],
    });
    expect(manager.getApiKeyHelper({ apiKeyHelper: "override-helper" })).toBe("managed-helper");
    manager.dispose();
  });

  it("prefers the --settings override over a user helper", async () => {
    const manager = await managerResolving({
      effective: { apiKeyHelper: "user-helper" },
      provenance: { apiKeyHelper: { source: "userSettings" } },
      sources: [],
    });
    expect(manager.getApiKeyHelper({ apiKeyHelper: "override-helper" })).toBe("override-helper");
    expect(manager.getApiKeyHelper()).toBe("user-helper");
    manager.dispose();
  });
});

describe("SettingsManager.getShowClearContextOnPlanAccept", () => {
  it("ranks managed settings over the --settings override over the files, and is off by default", async () => {
    const managed = await managerResolving({
      effective: { showClearContextOnPlanAccept: false },
      provenance: {},
      sources: [{ source: "managed", settings: { showClearContextOnPlanAccept: false } }],
    });
    expect(managed.getShowClearContextOnPlanAccept({ showClearContextOnPlanAccept: true })).toBe(
      false,
    );
    managed.dispose();

    const files = await managerResolving({
      effective: { showClearContextOnPlanAccept: true },
      provenance: {},
      sources: [{ source: "userSettings", settings: { showClearContextOnPlanAccept: true } }],
    });
    expect(files.getShowClearContextOnPlanAccept({ showClearContextOnPlanAccept: false })).toBe(
      false,
    );
    expect(files.getShowClearContextOnPlanAccept()).toBe(true);
    files.dispose();

    const unset = await managerResolving({ effective: {}, provenance: {}, sources: [] });
    expect(unset.getShowClearContextOnPlanAccept()).toBe(false);
    unset.dispose();
  });
});
