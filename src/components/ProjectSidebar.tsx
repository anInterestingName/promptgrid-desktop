import { FolderOpen, Grid3X3, History, Settings2 } from "lucide-react";
import { t, type MessageKey } from "../i18n";
import { usePromptGridStore } from "../state/usePromptGridStore";

const recentProjects = [
  "projectTitle",
  "recentProjectProduct",
  "recentProjectCampaign",
] as const;

const navItems: Array<{
  label: MessageKey;
  icon: typeof FolderOpen;
  active: boolean;
}> = [
  { label: "projects", icon: FolderOpen, active: true },
  { label: "history", icon: History, active: false },
  { label: "settings", icon: Settings2, active: false },
];

export function ProjectSidebar() {
  const locale = usePromptGridStore((state) => state.locale);
  const currentRound = usePromptGridStore((state) => state.currentRound);
  const completedCount = usePromptGridStore(
    (state) => state.tasks.filter((task) => task.status === "completed").length,
  );

  return (
    <aside className="sidebar" aria-label={t(locale, "projectNavigation")}>
      <div className="brand-lockup">
        <div className="brand-mark">
          <Grid3X3 size={20} aria-hidden="true" />
        </div>
        <div>
          <strong>PromptGrid</strong>
          <span>{t(locale, "desktop")}</span>
        </div>
      </div>

      <nav className="nav-stack" aria-label={t(locale, "workspaceSections")}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={item.active ? "nav-item active" : "nav-item"}
              key={item.label}
              type="button"
            >
              <Icon size={17} aria-hidden="true" />
              <span>{t(locale, item.label)}</span>
            </button>
          );
        })}
      </nav>

      <section className="sidebar-section" aria-labelledby="recent-projects">
        <h2 id="recent-projects">{t(locale, "recent")}</h2>
        <div className="project-list">
          {recentProjects.map((project) => (
            <button
              className={
                project === recentProjects[0]
                  ? "project-chip active"
                  : "project-chip"
              }
              key={project}
              type="button"
            >
              {t(locale, project)}
            </button>
          ))}
        </div>
      </section>

      <section
        className="sidebar-summary"
        aria-label={t(locale, "localProjectSummary")}
      >
        <span>
          {t(locale, "round")} {currentRound}
        </span>
        <strong>
          {completedCount}/9 {t(locale, "complete")}
        </strong>
      </section>
    </aside>
  );
}
