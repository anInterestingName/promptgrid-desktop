import { GridWorkspace } from "./components/GridWorkspace";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { PromptPanel } from "./components/PromptPanel";
import { SettingsWorkspace } from "./components/SettingsWorkspace";
import { TopBar } from "./components/TopBar";
import { t } from "./i18n";
import { usePromptGridStore } from "./state/usePromptGridStore";
import { useEffect } from "react";

export default function App() {
  const locale = usePromptGridStore((state) => state.locale);
  const colorTheme = usePromptGridStore((state) => state.colorTheme);
  const hydrate = usePromptGridStore((state) => state.hydrate);
  const activeSection = usePromptGridStore((state) => state.activeSection);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <main className="app-shell" lang={locale} data-color-theme={colorTheme}>
      <ProjectSidebar />
      <section className="workbench" aria-label={t(locale, "workspaceAria")}>
        <TopBar />
        {activeSection === "settings" ? (
          <SettingsWorkspace />
        ) : (
          <div className="workspace-grid">
            <PromptPanel />
            <GridWorkspace />
          </div>
        )}
      </section>
    </main>
  );
}
