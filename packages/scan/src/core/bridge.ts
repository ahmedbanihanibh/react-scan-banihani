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
  changes?: Array<string>;
  memoizable?: boolean;
}

interface BridgeEvent {
  kind: "interaction" | "long-render" | "prompt";
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

const changeNames = (changes: unknown): Array<string> => {
  const out: Array<string> = [];
  try {
    const c = changes as {
      fiberProps?: { changes?: Array<{ name?: string }> };
      fiberState?: { changes?: Array<{ name?: unknown }> };
      fiberContexts?: { changes?: Array<{ name?: string }> };
    };
    for (const p of c?.fiberProps?.changes ?? []) {
      if (p.name) out.push(`prop:${p.name}`);
    }
    for (const st of c?.fiberState?.changes ?? []) {
      out.push(`state:${String(st.name ?? "?")}`);
    }
    for (const ctx of c?.fiberContexts?.changes ?? []) {
      if (ctx.name) out.push(`context:${ctx.name}`);
    }
  } catch {
    /* shape drift — names are best-effort */
  }
  return out.slice(0, 6);
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
        .map(([name, fr]) => ({
          name,
          renders: fr.renderCount,
          selfTime: fr.selfTime,
          changes: changeNames(fr.changes),
          memoizable:
            !fr.wasFiberRenderMount &&
            !fr.hasMemoCache &&
            changeNames(fr.changes).length === 0,
        }))
        .sort((a, b) => b.selfTime - a.selfTime)
        .slice(0, 15);
      pushBridgeEvent({
        kind: "long-render",
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
