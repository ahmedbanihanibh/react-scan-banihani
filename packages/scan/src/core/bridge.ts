/**
 * linear-grab bridge emitter — streams slowdown telemetry to the local
 * bridge (`npx linear-grab-bridge`), which appends it to the repo's
 * `.lineargrab/scan.ndjson`. AI coding agents (Claude Code, Cursor) read
 * that file — or `GET /scan/report` for an aggregated view — to trace
 * re-render and interaction-latency issues without a human copy-pasting.
 *
 * Fire-and-forget: the bridge being down must never affect the page.
 */

interface BridgeComponent {
  name: string;
  renders: number;
  selfTime: number;
  /** file:line of the component definition — jump straight to the offender. */
  source?: string | null;
  /** Short selector of the rendered host element (tag#id.class). */
  element?: string | null;
  changes?: Array<string>;
  memoizable?: boolean;
}

interface BridgeEvent {
  kind: "interaction" | "long-render" | "prompt";
  /** Route where it happened — slowdowns are page-specific. */
  page?: string;
  type?: string;
  target?: string;
  path?: Array<string>;
  duration?: number;
  slow?: boolean;
  fps?: number;
  components?: Array<BridgeComponent>;
  surface?: string;
  text?: string;
}

let endpoint: string | null = null;
let queue: Array<BridgeEvent> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const flush = () => {
  timer = null;
  if (!endpoint || queue.length === 0) return;
  const events = queue.slice(0, 100);
  queue = [];
  fetch(`${endpoint}/scan/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).catch(() => {
    /* bridge offline — drop silently */
  });
};

export const pushBridgeEvent = (event: BridgeEvent) => {
  if (!endpoint) return;
  queue.push(event);
  timer ??= setTimeout(flush, 1500);
};

/** Real shape (collectInspectorDataWithoutCounts): sections carry
    `changes: Set<name|index>` + `current: [{name, value}]`. Classify changed
    props by their current value so agents see WHY: `(fn)` = unstable callback
    → useCallback; `(ref)` = new object/array identity → useMemo/hoist. */
const changeNames = (changes: unknown): Array<string> => {
  const out: Array<string> = [];
  try {
    const c = changes as {
      fiberProps?: { changes?: Set<string | number>; current?: Array<{ name: string; value: unknown }> };
      fiberState?: { changes?: Set<string | number> };
      fiberContext?: { changes?: Set<string | number>; current?: Array<{ name: string; value: unknown }> };
    };
    const propValue = (name: string | number) =>
      c?.fiberProps?.current?.find((x) => x.name === String(name))?.value;
    for (const name of c?.fiberProps?.changes ?? []) {
      const v = propValue(name);
      const tag =
        typeof v === "function" ? "(fn)" : v !== null && typeof v === "object" ? "(ref)" : "";
      out.push(`prop:${String(name)}${tag}`);
    }
    for (const idx of c?.fiberState?.changes ?? []) {
      out.push(`state:#${String(idx)}`);
    }
    for (const name of c?.fiberContext?.changes ?? []) {
      out.push(`context:${String(name)}`);
    }
  } catch {
    /* shape drift — names are best-effort */
  }
  return out.slice(0, 8);
};

/** tag#id.firstClass — enough for a human or agent to locate the element. */
// biome-ignore lint/suspicious/noExplicitAny: DOM element from nodeInfo
const elementSelector = (el: any): string | null => {
  try {
    if (!el?.tagName) return null;
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
    const testId = el.getAttribute?.("data-testid");
    return `${el.tagName.toLowerCase()}${id}${cls}${testId ? `[data-testid=${testId}]` : ""}`;
  } catch {
    return null;
  }
};

/**
 * Start streaming. `target` is the bridge origin (default localhost bridge);
 * pass `false`-y to disable. Called from scan() init.
 *
 * IMPORTANT: this module must stay import-free (a leaf). It is imported from
 * core/index AND from the notifications event store — any import back toward
 * core creates a load-order cycle that crashes the IIFE bundle.
 */
export const initBridgeEmitter = (
  target: string | boolean | undefined,
): void => {
  if (target === false) return;
  if (typeof window === "undefined") return;
  endpoint = (
    typeof target === "string" ? target : "http://127.0.0.1:4577"
  ).replace(/\/$/, "");
};

/** Called by the toolbar event store on every slowdown event. */
// biome-ignore lint/suspicious/noExplicitAny: shape owned by event-tracking; kept loose to stay a leaf
export const forwardSlowdownToBridge = (event: any): void => {
  if (!endpoint) return;
  try {
    if (event.kind === "interaction") {
      const timing = event.data.meta.detailedTiming as unknown as {
        interactionType?: string;
        componentPath?: Array<string>;
      };
      pushBridgeEvent({
        kind: "interaction",
        page: location.pathname,
        type: timing.interactionType ?? "pointer",
        target: timing.componentPath?.[0],
        path: timing.componentPath?.slice(0, 5),
        duration: event.data.meta.latency,
        slow: event.data.meta.latency > 150,
      });
    } else {
      const fiberRenders = event.data.meta.fiberRenders ?? {};
      // biome-ignore lint/suspicious/noExplicitAny: see above
      const components: Array<BridgeComponent> = Object.entries<any>(fiberRenders)
        .map(([name, fr]) => {
          const changes = changeNames(fr.changes);
          return {
            name,
            renders: fr.renderCount,
            selfTime: fr.selfTime,
            source: fr.source ?? null,
            element: elementSelector(fr.nodeInfo?.[0]?.element),
            changes,
            memoizable: !fr.wasFiberRenderMount && !fr.hasMemoCache && changes.length === 0,
          };
        })
        .sort((a, b) => b.selfTime - a.selfTime)
        .slice(0, 15);
      pushBridgeEvent({
        kind: "long-render",
        page: location.pathname,
        duration: event.data.meta.latency,
        fps: event.data.meta.fps,
        slow: true,
        components,
      });
    }
  } catch {
    /* telemetry must never break the host page */
  }
};
