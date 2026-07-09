import type { FiberSource } from "bippy/source";
import {
  formatForClipboard,
  formatPath,
  getObjectDiff,
  safeGetValue,
} from "../utils";
import type { AggregatedChanges, AllAggregatedChanges } from "./use-change-store";

const MAX_PATHS_PER_ENTRY = 6;
const MAX_OBJECT_KEYS = 6;
const MAX_VALUE_LENGTH = 200;

type ChangeKind = "unstable-reference" | "unstable-function" | "value-change";

interface ClassifiedPath {
  path: string;
  previous: string;
  current: string;
}

interface ClassifiedChange {
  label: string;
  kind: ChangeKind;
  count: number;
  paths: Array<ClassifiedPath>;
}

export interface BuildAiPromptInput {
  componentName: string;
  isMemoized: boolean;
  source: FiberSource | null;
  renderCount: number;
  selfTimeMs?: number;
  changes: AllAggregatedChanges;
  includeValues: boolean;
}

const describeValueShape = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") {
    const name = value.name;
    return name ? `<function ${name}>` : "<function>";
  }
  if (Array.isArray(value)) return `<array(${value.length})>`;
  if (value instanceof Date) return "<Date>";
  if (value instanceof RegExp) return "<RegExp>";
  if (value instanceof Map) return `<Map(${value.size})>`;
  if (value instanceof Set) return `<Set(${value.size})>`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const shown = keys.slice(0, MAX_OBJECT_KEYS).join(", ");
    const suffix = keys.length > MAX_OBJECT_KEYS ? ", …" : "";
    return `{ ${shown}${suffix} }`;
  }
  return `<${typeof value}>`;
};

const renderValue = (value: unknown, includeValues: boolean): string => {
  if (!includeValues) return describeValueShape(value);
  const formatted = formatForClipboard(value);
  return formatted.length > MAX_VALUE_LENGTH
    ? `${formatted.slice(0, MAX_VALUE_LENGTH)}…`
    : formatted;
};

const classifyChange = (
  label: string,
  entry: AggregatedChanges,
  includeValues: boolean,
): ClassifiedChange => {
  const { value: previous } = safeGetValue(entry.previousValue);
  const { value: current } = safeGetValue(entry.currentValue);
  const diff = getObjectDiff(previous, current);

  const isFunction = typeof current === "function" || typeof previous === "function";

  if (isFunction) {
    const sameBody = diff.changes.length > 0 && diff.changes.every((change) => change.sameFunction);
    return {
      label,
      count: entry.count,
      kind: sameBody ? "unstable-function" : "value-change",
      paths: [],
    };
  }

  if (diff.changes.length === 0) {
    return { label, count: entry.count, kind: "unstable-reference", paths: [] };
  }

  const paths = diff.changes.slice(0, MAX_PATHS_PER_ENTRY).map((change) => ({
    path: formatPath(change.path),
    previous: renderValue(change.prevValue, includeValues),
    current: renderValue(change.currentValue, includeValues),
  }));

  return { label, count: entry.count, kind: "value-change", paths };
};

const formatStateLabel = (name: string): string => {
  const asNumber = Number(name);
  return Number.isNaN(asNumber) ? `state "${name}"` : `state hook #${name}`;
};

const collectPropsAndState = (
  changes: AllAggregatedChanges,
  includeValues: boolean,
): { props: Array<ClassifiedChange>; state: Array<ClassifiedChange> } => {
  const props = Array.from(changes.propsChanges.values()).map((entry) =>
    classifyChange(`prop "${entry.name}"`, entry, includeValues),
  );
  const state = Array.from(changes.stateChanges.values()).map((entry) =>
    classifyChange(formatStateLabel(entry.name), entry, includeValues),
  );
  return { props, state };
};

const collectContext = (
  changes: AllAggregatedChanges,
  includeValues: boolean,
): Array<ClassifiedChange> => {
  const result: Array<ClassifiedChange> = [];
  for (const value of changes.contextChanges.values()) {
    if (value.kind !== "initialized") continue;
    const label = value.changes.name ? `context "${value.changes.name}"` : "context";
    result.push(classifyChange(label, value.changes, includeValues));
  }
  return result;
};

const describeKind = (change: ClassifiedChange): string => {
  switch (change.kind) {
    case "unstable-reference":
      return "new reference every render but structurally identical [UNSTABLE REFERENCE]";
    case "unstable-function":
      return "new function reference every render but identical body [UNSTABLE REFERENCE]";
    case "value-change": {
      if (change.paths.length === 0) return "value changed";
      const details = change.paths
        .map((entry) =>
          entry.path
            ? `${entry.path}: ${entry.previous} → ${entry.current}`
            : `${entry.previous} → ${entry.current}`,
        )
        .join("; ");
      return `value changed (${details})`;
    }
  }
};

const renderSection = (title: string, changes: Array<ClassifiedChange>): string | null => {
  if (changes.length === 0) return null;
  const lines = changes.map(
    (change) => `- ${change.label} — ${describeKind(change)}, ×${change.count}`,
  );
  return `${title}:\n${lines.join("\n")}`;
};

export const buildAiPrompt = (input: BuildAiPromptInput): string => {
  const { props, state } = collectPropsAndState(input.changes, input.includeValues);
  const context = collectContext(input.changes, input.includeValues);
  const allChanges = [...props, ...state, ...context];

  const hasUnstable = allChanges.some(
    (change) => change.kind === "unstable-reference" || change.kind === "unstable-function",
  );
  const hasValueChange = allChanges.some((change) => change.kind === "value-change");

  const header = [
    `Fix an unnecessary React re-render that React Scan detected.`,
    ``,
    `Component: ${input.componentName}${input.isMemoized ? " (memoized)" : ""}`,
  ];
  if (input.source) {
    const location = [input.source.lineNumber, input.source.columnNumber]
      .filter((part) => part !== undefined)
      .join(":");
    header.push(`Source: ${input.source.fileName}${location ? `:${location}` : ""}`);
  } else {
    header.push(`Source: unavailable (needs a React development build for file:line)`);
  }
  const timing = input.selfTimeMs !== undefined ? `, last render ${input.selfTimeMs}ms` : "";
  header.push(`Re-rendered ×${input.renderCount} while inspected${timing}.`);

  const sections = [
    renderSection("Changed props", props),
    renderSection("Changed state", state),
    renderSection("Changed context", context),
  ].filter((section): section is string => section !== null);

  const fixes: Array<string> = [];
  if (hasUnstable) {
    fixes.push(
      `Stabilize every value marked [UNSTABLE REFERENCE]: wrap objects/arrays in useMemo and functions in useCallback, hoist constants out of the render body, or memoize the context provider's value so consumers stop re-rendering.`,
    );
  }
  if (hasValueChange) {
    fixes.push(
      `For values that genuinely change every render, check whether a subscription or state update is firing too often and narrow it to the slice this component actually uses.`,
    );
  }
  if (fixes.length === 0) {
    fixes.push(
      `No prop/state/context change was captured, so this component likely re-rendered because a parent re-rendered. Consider memoizing it or lifting the work into the parent.`,
    );
  }

  const body = [
    header.join("\n"),
    sections.length > 0 ? `What changed between renders:\n\n${sections.join("\n\n")}` : "",
    input.includeValues
      ? ""
      : `(Values are redacted to types/shape for privacy — ask to include raw values if needed.)`,
    `Likely fixes:\n${fixes.map((fix, index) => `${index + 1}. ${fix}`).join("\n")}`,
    `Please open the source file, identify the unstable references first, and apply the minimal fix.`,
  ].filter((part) => part !== "");

  return body.join("\n\n");
};
