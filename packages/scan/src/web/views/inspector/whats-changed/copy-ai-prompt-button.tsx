import type { Fiber } from "bippy";
import { pushBridgeEvent } from "~core/bridge";
import { memo } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "~web/components/icon";
import { cn, getExtendedDisplayName } from "~web/utils/helpers";
import { getFiberSource } from "../../../../lite/fiber-source";
import { timelineState } from "../states";
import { buildAiPrompt } from "./build-ai-prompt";
import type { AllAggregatedChanges } from "./use-change-store";

const COPIED_RESET_MS = 600;

interface CopyAiPromptButtonProps {
  fiber: Fiber;
  changes: AllAggregatedChanges;
}

export const CopyAiPromptButton = /* @__PURE__ */ memo(
  ({ fiber, changes }: CopyAiPromptButtonProps) => {
    const [isCopied, setIsCopied] = useState(false);
    const [includeValues, setIncludeValues] = useState(false);

    useEffect(() => {
      if (!isCopied) return;
      const timeout = setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
      return () => clearTimeout(timeout);
    }, [isCopied]);

    const handleCopy = () => {
      const { name, wrapperTypes } = getExtendedDisplayName(fiber);
      const { totalUpdates, currentIndex, updates } = timelineState.value;
      const selfTime = updates[currentIndex]?.fiberInfo?.selfTime;

      const prompt = buildAiPrompt({
        componentName: name ?? "Unknown",
        isMemoized: wrapperTypes.some((wrapper) => wrapper.type === "memo"),
        source: getFiberSource(fiber),
        renderCount: Math.max(0, totalUpdates - 1),
        selfTimeMs: selfTime && selfTime > 0 ? Number(selfTime.toFixed(1)) : undefined,
        changes,
        includeValues,
      });

      pushBridgeEvent({ kind: "prompt", surface: "inspector:whats-changed", text: prompt });
      navigator.clipboard.writeText(prompt).then(
        () => setIsCopied(true),
        () => {},
      );
    };

    return (
      <div className="flex items-center gap-x-2 shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          title="Copy a plain-text prompt describing this re-render for an AI coding agent"
          className={cn(
            "flex items-center gap-x-1.5 px-2 py-1 rounded-md border-none cursor-pointer",
            "text-xs font-medium",
            "bg-[#A855F7]/10 text-[#A855F7] hover:bg-[#A855F7]/20",
            "transition-colors duration-200",
          )}
        >
          <Icon
            name={isCopied ? "icon-check" : "icon-sparkles"}
            size={12}
            className={cn(isCopied && "text-green-500")}
          />
          <span className="inline-block min-w-[90px] text-left">
            {isCopied ? "Copied" : "Copy AI prompt"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIncludeValues((prev) => !prev)}
          title={
            includeValues
              ? "Raw values are included — click to redact them for privacy"
              : "Values are redacted to types/shape — click to include raw values"
          }
          className={cn(
            "flex items-center gap-x-1 px-1.5 py-1 rounded-md border-none cursor-pointer bg-transparent",
            "text-[10px] font-medium text-[#666] hover:text-[#888]",
            "transition-colors duration-200",
          )}
        >
          <Icon name={includeValues ? "icon-lock-open" : "icon-lock"} size={11} />
          <span className="inline-block min-w-[62px] text-left">
            {includeValues ? "raw values" : "redacted"}
          </span>
        </button>
      </div>
    );
  },
);
