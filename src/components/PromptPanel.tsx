import {
  aspectRatioOptions,
  outputSizeOptions,
  qualityOptions,
  styleOptions,
} from "../data/mockProject";
import { outputSizeLabels, qualityLabels, styleLabels, t } from "../i18n";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type { AspectRatio, OutputSize, Quality } from "../types";
import { Check, ChevronDown, Play, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function PromptPanel() {
  const locale = usePromptGridStore((state) => state.locale);
  const project = usePromptGridStore((state) => state.project);
  const settings = usePromptGridStore((state) => state.settings);
  const isAnalyzing = usePromptGridStore((state) => state.isAnalyzing);
  const isGenerating = usePromptGridStore((state) => state.isGenerating);
  const setOriginalPrompt = usePromptGridStore(
    (state) => state.setOriginalPrompt,
  );
  const setStyle = usePromptGridStore((state) => state.setStyle);
  const setAspectRatio = usePromptGridStore((state) => state.setAspectRatio);
  const setQuality = usePromptGridStore((state) => state.setQuality);
  const setOutputSize = usePromptGridStore((state) => state.setOutputSize);
  const analyzePrompt = usePromptGridStore((state) => state.analyzePrompt);
  const generateImages = usePromptGridStore((state) => state.generateImages);
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const styleFieldRef = useRef<HTMLDivElement>(null);
  const selectedStyleLabel = styleLabels[locale][project.style];
  const configuredImageModel =
    settings.apiProvider === "openai"
      ? settings.imageModel
      : settings.customImageModel ?? "";
  const supportsFlexibleOutputSize =
    settings.apiProvider === "custom" ||
    configuredImageModel.toLowerCase().includes("gpt-image-2");

  useEffect(() => {
    function closeStyleField(event: PointerEvent) {
      if (!styleFieldRef.current?.contains(event.target as Node)) {
        setIsStyleOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeStyleField);
    return () => document.removeEventListener("pointerdown", closeStyleField);
  }, []);

  return (
    <aside className="prompt-panel" aria-label={t(locale, "promptControls")}>
      <section className="panel-section">
        <div className="section-title">
          <Sparkles size={17} aria-hidden="true" />
          <h2>{t(locale, "sourceIdea")}</h2>
        </div>
        <textarea
          aria-label={t(locale, "originalPrompt")}
          className="prompt-input"
          value={project.originalPrompt}
          onChange={(event) => setOriginalPrompt(event.target.value)}
        />
      </section>

      <section className="panel-section">
        <label className="field-label" htmlFor="style-select">
          {t(locale, "style")}
        </label>
        <div className="select-field" ref={styleFieldRef}>
          <button
            id="style-select"
            className="select-trigger"
            type="button"
            aria-controls="style-select-options"
            aria-expanded={isStyleOpen}
            aria-haspopup="listbox"
            onClick={() => setIsStyleOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsStyleOpen(false);
              }
            }}
          >
            <span>{selectedStyleLabel}</span>
            <ChevronDown
              className={isStyleOpen ? "select-arrow open" : "select-arrow"}
              size={18}
              aria-hidden="true"
            />
          </button>

          {isStyleOpen ? (
            <div
              className="select-menu"
              id="style-select-options"
              role="listbox"
              aria-labelledby="style-select"
            >
              {styleOptions.map((style) => {
                const isSelected = project.style === style;

                return (
                  <button
                    className={
                      isSelected ? "select-option selected" : "select-option"
                    }
                    key={style}
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    onClick={() => {
                      setStyle(style);
                      setIsStyleOpen(false);
                    }}
                  >
                    <span>{styleLabels[locale][style]}</span>
                    {isSelected ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "aspectRatio")}</span>
        <div className="segmented-control">
          {aspectRatioOptions.map((ratio) => (
            <button
              className={project.aspectRatio === ratio ? "active" : ""}
              key={ratio}
              type="button"
              onClick={() => setAspectRatio(ratio as AspectRatio)}
            >
              {ratio}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "quality")}</span>
        <div className="segmented-control">
          {qualityOptions.map((quality) => (
            <button
              className={project.quality === quality ? "active" : ""}
              key={quality}
              type="button"
              onClick={() => setQuality(quality as Quality)}
            >
              {qualityLabels[locale][quality]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "outputSize")}</span>
        <div className="segmented-control">
          {outputSizeOptions.map((outputSize) => {
            const requiresFlexibleSize =
              outputSize === "2k" || outputSize === "4k";
            const isDisabled =
              requiresFlexibleSize && !supportsFlexibleOutputSize;

            return (
              <button
                className={project.outputSize === outputSize ? "active" : ""}
                disabled={isDisabled}
                key={outputSize}
                title={
                  isDisabled ? t(locale, "outputSizeRequiresGptImage2") : ""
                }
                type="button"
                onClick={() => setOutputSize(outputSize as OutputSize)}
              >
                {outputSizeLabels[locale][outputSize]}
              </button>
            );
          })}
        </div>
      </section>

      <div className="action-stack">
        <button
          className="primary-action"
          type="button"
          onClick={analyzePrompt}
          disabled={isAnalyzing || isGenerating}
        >
          <Wand2 size={18} aria-hidden="true" />
          {isAnalyzing ? t(locale, "analyzing") : t(locale, "analyzePrompts")}
        </button>
        <button
          className="secondary-action"
          type="button"
          onClick={generateImages}
          disabled={isGenerating || isAnalyzing}
        >
          <Play size={18} aria-hidden="true" />
          {isGenerating ? t(locale, "generating") : t(locale, "generateImages")}
        </button>
      </div>
    </aside>
  );
}
