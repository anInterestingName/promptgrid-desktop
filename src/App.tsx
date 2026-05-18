import { GridWorkspace } from "./components/GridWorkspace";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { PromptPanel } from "./components/PromptPanel";
import { TopBar } from "./components/TopBar";
import { t } from "./i18n";
import { usePromptGridStore } from "./state/usePromptGridStore";

export default function App() {
  const locale = usePromptGridStore((state) => state.locale);
  const colorTheme = usePromptGridStore((state) => state.colorTheme);

  return (
    <main className="app-shell" lang={locale} data-color-theme={colorTheme}>
      <ProjectSidebar />
      <section className="workbench" aria-label={t(locale, "workspaceAria")}>
        <TopBar />
        <div className="workspace-grid">
          <PromptPanel />
          <GridWorkspace />
        </div>
      </section>
    </main>
  );
}
