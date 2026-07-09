import { describe, expect, it } from "vitest";
import { buildAiPrompt } from "./build-ai-prompt";
import type { AggregatedChanges, AllAggregatedChanges } from "./use-change-store";

const makeChanges = (overrides: Partial<AllAggregatedChanges>): AllAggregatedChanges => ({
  propsChanges: new Map(),
  stateChanges: new Map(),
  contextChanges: new Map(),
  ...overrides,
});

const aggregated = (partial: Partial<AggregatedChanges> & { name: string }): AggregatedChanges => ({
  count: 1,
  currentValue: undefined,
  previousValue: undefined,
  lastUpdated: 0,
  id: partial.name,
  ...partial,
});

describe("buildAiPrompt", () => {
  it("flags a reference that changed but is structurally identical as an unstable reference", () => {
    const stateChanges = new Map([
      ["11", aggregated({ name: "11", count: 52, previousValue: [1, 2], currentValue: [1, 2] })],
    ]);

    const prompt = buildAiPrompt({
      componentName: "RightNavCluster",
      isMemoized: true,
      source: { fileName: "src/right-nav-cluster.tsx", lineNumber: 42, columnNumber: 10 },
      renderCount: 61,
      selfTimeMs: 13,
      changes: makeChanges({ stateChanges }),
      includeValues: false,
    });

    expect(prompt).toContain("RightNavCluster (memoized)");
    expect(prompt).toContain("src/right-nav-cluster.tsx:42:10");
    expect(prompt).toContain("Re-rendered ×61");
    expect(prompt).toContain("state hook #11");
    expect(prompt).toContain("[UNSTABLE REFERENCE]");
    expect(prompt).toContain("useMemo");
  });

  it("redacts values by default and reports genuine value changes by type", () => {
    const stateChanges = new Map([
      [
        "8",
        aggregated({
          name: "8",
          count: 62,
          previousValue: { lastHeartbeat: 1783606215793 },
          currentValue: { lastHeartbeat: 1783606225744 },
        }),
      ],
    ]);

    const redacted = buildAiPrompt({
      componentName: "RightNavCluster",
      isMemoized: true,
      source: null,
      renderCount: 61,
      changes: makeChanges({ stateChanges }),
      includeValues: false,
    });

    expect(redacted).toContain("lastHeartbeat: <number> → <number>");
    expect(redacted).not.toContain("1783606215793");
    expect(redacted).toContain("Values are redacted");
    expect(redacted).toContain("Source: unavailable");

    const raw = buildAiPrompt({
      componentName: "RightNavCluster",
      isMemoized: false,
      source: null,
      renderCount: 61,
      changes: makeChanges({ stateChanges }),
      includeValues: true,
    });

    expect(raw).toContain("1783606225744");
  });

  it("attributes a re-render with no captured change to a parent render", () => {
    const prompt = buildAiPrompt({
      componentName: "BranchChip",
      isMemoized: true,
      source: null,
      renderCount: 13,
      changes: makeChanges({}),
      includeValues: false,
    });

    expect(prompt).toContain("parent re-rendered");
  });
});
