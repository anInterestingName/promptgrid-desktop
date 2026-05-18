import { localeOptions, t } from "../i18n";
import { colorThemeOptions } from "../theme";
import { usePromptGridStore } from "../state/usePromptGridStore";
import { Languages, Palette } from "lucide-react";
import type { CSSProperties } from "react";

export function TopBar() {
  const locale = usePromptGridStore((state) => state.locale);
  const setLocale = usePromptGridStore((state) => state.setLocale);
  const colorTheme = usePromptGridStore((state) => state.colorTheme);
  const setColorTheme = usePromptGridStore((state) => state.setColorTheme);
  const currentRound = usePromptGridStore((state) => state.currentRound);

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{t(locale, "localProject")}</p>
        <h1>{t(locale, "projectTitle")}</h1>
      </div>
      <div className="topbar-actions">
        <div className="toolbar-control">
          <span className="toolbar-label">
            <Palette size={15} aria-hidden="true" />
            {t(locale, "interfaceColor")}
          </span>
          <div
            className="color-theme-switch"
            role="group"
            aria-label={t(locale, "interfaceColor")}
          >
            {colorThemeOptions.map((option) => (
              <button
                className={colorTheme === option.colorTheme ? "active" : ""}
                key={option.colorTheme}
                type="button"
                title={t(locale, option.labelKey)}
                onClick={() => setColorTheme(option.colorTheme)}
              >
                <span
                  className="theme-swatch"
                  style={
                    {
                      "--swatch-a": option.swatches[0],
                      "--swatch-b": option.swatches[1],
                      "--swatch-c": option.swatches[2],
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
                <span>{t(locale, option.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-control">
          <span className="toolbar-label">
            <Languages size={15} aria-hidden="true" />
            {t(locale, "appLanguage")}
          </span>
          <div
            className="language-toggle"
            role="group"
            aria-label={t(locale, "appLanguage")}
          >
            {localeOptions.map((option) => (
              <button
                className={locale === option.locale ? "active" : ""}
                key={option.locale}
                type="button"
                onClick={() => setLocale(option.locale)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="round-pill">
          {t(locale, "round")} {currentRound}
        </div>
      </div>
    </header>
  );
}
