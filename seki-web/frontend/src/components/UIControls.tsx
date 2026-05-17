import { useEffect, useRef, useState } from "preact/hooks";
import {
  ButtonContent,
  SgfImportButton,
  type ControlsProps,
} from "./controls-shared";
import {
  IconAnalysis,
  IconBalance,
  IconFileExport,
  IconGrid4x4,
  IconKomi,
  IconX,
} from "./icons";

export function UIControls(
  props: ControlsProps & { excludeAnalysis?: boolean },
) {
  const [analyzeChoiceOpen, setAnalyzeChoiceOpen] = useState(false);
  const analyzeChoiceRef = useRef<HTMLDivElement>(null);
  const analyzeChoiceButtonRef = useRef<HTMLButtonElement>(null);
  const analyzeChoicePending =
    props.analyzeChoice?.options.some((option) => option.pending) ?? false;

  useEffect(() => {
    if (!analyzeChoiceOpen || analyzeChoicePending) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        analyzeChoiceRef.current?.contains(target) ||
        analyzeChoiceButtonRef.current?.contains(target)
      ) {
        return;
      }
      setAnalyzeChoiceOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [analyzeChoiceOpen, analyzeChoicePending]);

  useEffect(() => {
    if (analyzeChoicePending) {
      setAnalyzeChoiceOpen(true);
    }
  }, [analyzeChoicePending]);

  return (
    <>
      {!props.excludeAnalysis && props.analyze && (
        <span class="analysis-toggle">
          {props.analyzeChoice && !props.analyze.active ? (
            <>
              <button
                ref={analyzeChoiceButtonRef}
                title={props.analyze.title ?? "Analyze"}
                disabled={props.analyze.disabled || analyzeChoicePending}
                onClick={() => setAnalyzeChoiceOpen((value) => !value)}
              >
                <ButtonContent
                  pending={props.analyze.pending}
                  icon={IconAnalysis}
                />
              </button>
              {analyzeChoiceOpen && (
                <div id="analyze-choice" class="controls-menu-dropdown">
                  {props.analyzeChoice.options.map((opt) => (
                    <button
                      key={opt.label}
                      disabled={
                        opt.disabled || opt.pending || analyzeChoicePending
                      }
                      onClick={() => {
                        opt.onClick();
                      }}
                    >
                      <ButtonContent pending={opt.pending} label={opt.label} />
                    </button>
                  ))}
                  <button
                    disabled={analyzeChoicePending}
                    onClick={() => setAnalyzeChoiceOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              class={props.analyze.active ? "active" : undefined}
              title={
                props.analyze.active
                  ? "Back to game"
                  : (props.analyze.title ?? "Analyze")
              }
              disabled={props.analyze.disabled || props.analyze.pending}
              onClick={props.analyze.onClick}
            >
              <ButtonContent
                pending={props.analyze.pending}
                icon={props.analyze.active ? IconX : IconAnalysis}
              />
            </button>
          )}
        </span>
      )}
      {props.estimate && (
        <button
          class="btn-estimate"
          title={props.estimate.title ?? "Estimate score"}
          disabled={props.estimate.disabled || props.estimate.pending}
          onClick={props.estimate.onClick}
        >
          <ButtonContent pending={props.estimate.pending} icon={IconBalance} />
        </button>
      )}
      {props.exitEstimate && (
        <button
          class="btn-exit-estimate"
          title={props.exitEstimate.title ?? "Back to game"}
          disabled={props.exitEstimate.disabled || props.exitEstimate.pending}
          onClick={props.exitEstimate.onClick}
        >
          <ButtonContent pending={props.exitEstimate.pending} icon={IconX} />
        </button>
      )}
      {props.sgfImport && (
        <SgfImportButton onFileChange={props.sgfImport.onFileChange} />
      )}
      {props.sgfExport && (
        <button
          title={props.sgfExport.title ?? "Export SGF"}
          disabled={props.sgfExport.disabled || props.sgfExport.pending}
          onClick={props.sgfExport.onClick}
        >
          <ButtonContent
            pending={props.sgfExport.pending}
            icon={IconFileExport}
          />
        </button>
      )}
      {props.sizeSelect && (
        <span class="inline-control-group">
          <IconGrid4x4 title="Board size" />
          <select
            title="Board size"
            value={String(props.sizeSelect.value)}
            onChange={(e) =>
              props.sizeSelect!.onChange(
                parseInt((e.target as HTMLSelectElement).value, 10),
              )
            }
          >
            {props.sizeSelect.options.map((s) => (
              <option key={s} value={String(s)}>
                {s}×{s}
              </option>
            ))}
          </select>
        </span>
      )}
      {props.komiSelect && (
        <span class="inline-control-group">
          <IconKomi title="Komi" />
          <input
            type="number"
            title="Komi"
            value={props.komiSelect.value}
            step={0.5}
            min={-100.5}
            max={100.5}
            onChange={(e) =>
              props.komiSelect!.onChange(parseFloat(e.currentTarget.value) || 0)
            }
          />
        </span>
      )}
    </>
  );
}
