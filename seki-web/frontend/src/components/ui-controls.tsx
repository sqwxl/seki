import { useEffect, useRef, useState } from "preact/hooks";
import {
  AiBtn,
  ButtonContent,
  ClearVariationsBtn,
  EstimateBtn,
  KomiSelect,
  NewGameBtn,
  SgfExportButton,
  SgfImportButton,
  SizeSelect,
  type ControlsProps,
} from "./controls-shared";
import { IconAnalysis, IconX } from "./icons";

export function hasCollapsedUiControls(
  props: ControlsProps,
  options: { excludeAnalysis?: boolean } = {},
) {
  return Boolean(
    props.aiSuggest?.collapses ||
    (!options.excludeAnalysis && props.analyze?.collapses) ||
    props.estimate?.collapses ||
    props.exitEstimate?.collapses ||
    props.sgfImport?.collapses ||
    props.sgfExport?.collapses ||
    props.clearVariations?.collapses ||
    props.sizeSelect?.collapses ||
    props.komiSelect?.collapses,
  );
}

export function UIControls(
  props: ControlsProps & {
    excludeAnalysis?: boolean;
    renderMode?: "inline" | "menu";
  },
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

  const renderMode = props.renderMode ?? "inline";
  const shouldRender = (collapses?: boolean) =>
    renderMode === "menu" ? collapses === true : !(props.compact && collapses);

  const analyzeBtn = !props.excludeAnalysis && props.analyze && (
    <>
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
            <div
              id="analyze-choice"
              class="controls-menu-dropdown"
              ref={analyzeChoiceRef}
            >
              {props.analyzeChoice.options.map((opt) => (
                <button
                  key={opt.label}
                  disabled={opt.disabled || opt.pending || analyzeChoicePending}
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
          class={props.analyze.active ? "btn-on" : undefined}
          title={props.analyze.title ?? "Analyze"}
          disabled={props.analyze.disabled || props.analyze.pending}
          onClick={props.analyze.onClick}
        >
          <ButtonContent pending={props.analyze.pending} icon={IconAnalysis} />
        </button>
      )}
    </>
  );

  const controls = [
    {
      node: analyzeBtn,
      collapses: props.analyze?.collapses,
    },
    {
      node: props.aiSuggest && <AiBtn {...props.aiSuggest} />,
      collapses: props.aiSuggest?.collapses,
    },
    {
      node: props.estimate && <EstimateBtn {...props.estimate} />,
      collapses: props.estimate?.collapses,
    },
    {
      node: props.exitEstimate && (
        <button
          class="btn-exit"
          title={props.exitEstimate.title ?? "Back to game"}
          disabled={props.exitEstimate.disabled || props.exitEstimate.pending}
          onClick={props.exitEstimate.onClick}
        >
          <ButtonContent pending={props.exitEstimate.pending} icon={IconX} />
        </button>
      ),
      collapses: props.exitEstimate?.collapses,
    },
    {
      node: props.sgfImport && (
        <SgfImportButton onFileChange={props.sgfImport.onFileChange} />
      ),
      collapses: props.sgfImport?.collapses,
    },
    {
      node: props.sgfExport && <SgfExportButton {...props.sgfExport} />,
      collapses: props.sgfExport?.collapses,
    },
    {
      node: props.clearVariations && (
        <ClearVariationsBtn {...props.clearVariations} />
      ),
      collapses: props.clearVariations?.collapses,
    },
    {
      node: props.sizeSelect && <SizeSelect {...props.sizeSelect} />,
      collapses: props.sizeSelect?.collapses,
    },
    {
      node: props.komiSelect && <KomiSelect {...props.komiSelect} />,
      collapses: props.komiSelect?.collapses,
    },
    {
      node: props.newGame && <NewGameBtn {...props.newGame} />,
    },
  ];

  return (
    <>
      {controls.map(
        (control) => shouldRender(control.collapses) && control.node,
      )}
    </>
  );
}
