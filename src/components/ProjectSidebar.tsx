import * as Dialog from "@radix-ui/react-dialog";
import {
  FolderOpen,
  Grid3X3,
  MoreHorizontal,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ContextMenu } from "./ContextMenu";
import {
  getContextMenuPosition,
  type ContextMenuItem,
} from "./contextMenuUtils";
import { t, type Locale, type MessageKey } from "../i18n";
import { openProjectFolder, pickDataDirectory } from "../services/localPersistence";
import { getErrorMessage } from "../shared/utils/error";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type { Conversation, Project } from "../types";

const navItems: Array<{
  label: MessageKey;
  icon: typeof FolderOpen;
  section?: "projects" | "settings";
}> = [
  { label: "projects", icon: FolderOpen, section: "projects" },
  { label: "settings", icon: Settings2, section: "settings" },
];

const projectContextMenuWidth = 172;
const projectContextMenuHeight = 136;
const projectContextMenuGap = 6;

function getProjectMenuPosition({
  preferredX,
  preferredY,
  boundaryRight,
  fallbackRight,
}: {
  preferredX: number;
  preferredY: number;
  boundaryRight: number;
  fallbackRight?: number;
}) {
  return getContextMenuPosition({
    preferredX,
    preferredY,
    width: projectContextMenuWidth,
    height: projectContextMenuHeight,
    gap: projectContextMenuGap,
    boundaryRight,
    fallbackRight,
  });
}

export function ProjectSidebar() {
  const locale = usePromptGridStore((state) => state.locale);
  const activeSection = usePromptGridStore((state) => state.activeSection);
  const setActiveSection = usePromptGridStore((state) => state.setActiveSection);
  const project = usePromptGridStore((state) => state.project);
  const conversation = usePromptGridStore((state) => state.conversation);
  const isConversationSaved = usePromptGridStore(
    (state) => state.isConversationSaved,
  );
  const projects = usePromptGridStore((state) => state.projects);
  const conversations = usePromptGridStore((state) => state.conversations);
  const createProject = usePromptGridStore((state) => state.createProject);
  const startNewConversation = usePromptGridStore(
    (state) => state.startNewConversation,
  );
  const openConversation = usePromptGridStore((state) => state.openConversation);
  const renameProject = usePromptGridStore((state) => state.renameProject);
  const removeProject = usePromptGridStore((state) => state.removeProject);
  const currentRound = usePromptGridStore((state) => state.currentRound);
  const completedCount = usePromptGridStore(
    (state) => state.tasks.filter((task) => task.status === "completed").length,
  );
  const taskCount = usePromptGridStore((state) => state.tasks.length);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openProjectMenu, setOpenProjectMenu] = useState<{
    projectId: string;
    x?: number;
    y?: number;
  }>();
  const [renamingProject, setRenamingProject] = useState<Project>();
  const [projectFolderError, setProjectFolderError] = useState("");

  const projectTree = useMemo(
    () =>
      sortByCreatedAt(projects).map((item) => ({
        project: item,
        conversations: sortByCreatedAt(
          conversations.filter(
            (candidate) => candidate.projectId === item.id,
          ),
        ),
      })),
    [conversations, projects],
  );
  const recentConversations = useMemo(
    () => sortByCreatedAt(conversations).slice(0, 4),
    [conversations],
  );

  function toggleProject(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function handleOpenProjectFolder(projectItem: Project) {
    void openProjectFolder(projectItem)
      .then(() => setProjectFolderError(""))
      .catch((error) => {
        const errorMessage = getErrorMessage(error);
        const message = errorMessage.includes("desktop app")
          ? t(locale, "openProjectFolderDesktopOnly")
          : errorMessage.includes("not found")
            ? t(locale, "openProjectFolderRestartRequired")
            : `${t(locale, "openProjectFolderError")}: ${errorMessage}`;
        setProjectFolderError(message);
        console.error("Could not open project folder", error);
      });
  }

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

      <div className="sidebar-actions">
        <button
          className="sidebar-action primary"
          type="button"
          onClick={() => setIsProjectDialogOpen(true)}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{t(locale, "newProject")}</span>
        </button>
      </div>

      <nav className="nav-stack" aria-label={t(locale, "workspaceSections")}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.section === activeSection;
          return (
            <button
              className={isActive ? "nav-item active" : "nav-item"}
              key={item.label}
              type="button"
              onClick={() => {
                if (item.section) {
                  setActiveSection(item.section);
                }
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{t(locale, item.label)}</span>
            </button>
          );
        })}
      </nav>

      <section className="sidebar-section" aria-labelledby="project-tree-title">
        <h2 id="project-tree-title">{t(locale, "projectTree")}</h2>
        <div className="project-tree">
          {projectTree.map((item) => (
            <div className="project-tree-group" key={item.project.id}>
              <div
                className="project-tree-row"
                onContextMenu={(event) => {
                  event.preventDefault();
                  const rowRect = event.currentTarget.getBoundingClientRect();
                  const sidebarRight =
                    event.currentTarget.closest(".sidebar")?.getBoundingClientRect()
                      .right ?? window.innerWidth;
                  setOpenProjectMenu({
                    projectId: item.project.id,
                    ...getProjectMenuPosition({
                      preferredX: event.clientX,
                      preferredY: rowRect.bottom + projectContextMenuGap,
                      boundaryRight: sidebarRight,
                    }),
                  });
                }}
              >
                <ProjectButton
                  isCollapsed={collapsedProjectIds.has(item.project.id)}
                  isActive={item.project.id === project.id}
                  item={item.project}
                  onToggle={() => toggleProject(item.project.id)}
                />
                <ProjectMenu
                  isOpen={openProjectMenu?.projectId === item.project.id}
                  item={item.project}
                  locale={locale}
                  menuPosition={
                    openProjectMenu?.projectId === item.project.id
                      ? openProjectMenu
                      : undefined
                  }
                  onOpenChange={(menuPosition) =>
                    setOpenProjectMenu(
                      menuPosition
                        ? { projectId: item.project.id, ...menuPosition }
                        : undefined,
                    )
                  }
                  onNewConversation={() => {
                    startNewConversation(item.project.id);
                    setOpenProjectMenu(undefined);
                  }}
                  onOpenFolder={() => {
                    handleOpenProjectFolder(item.project);
                    setOpenProjectMenu(undefined);
                  }}
                  onRename={() => {
                    setRenamingProject(item.project);
                    setOpenProjectMenu(undefined);
                  }}
                  onRemove={() => {
                    removeProject(item.project.id);
                    setOpenProjectMenu(undefined);
                  }}
                />
              </div>
              {!collapsedProjectIds.has(item.project.id) ? (
                <div className="conversation-branch">
                  {!isConversationSaved && item.project.id === project.id ? (
                    <PendingConversationButton
                      conversation={conversation}
                      locale={locale}
                    />
                  ) : null}
                  {item.conversations.map((child) => (
                    <ConversationButton
                      isActive={
                        isConversationSaved && child.id === conversation.id
                      }
                      item={child}
                      key={child.id}
                      locale={locale}
                      onOpen={() => openConversation(child.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="sidebar-section" aria-labelledby="recent-conversations">
        <h2 id="recent-conversations">{t(locale, "recent")}</h2>
        <div className="project-list">
          {recentConversations.map((item) => (
            <ConversationButton
              isActive={isConversationSaved && item.id === conversation.id}
              item={item}
              key={item.id}
              locale={locale}
              projectTitle={
                projects.find((candidate) => candidate.id === item.projectId)
                  ?.title
              }
              onOpen={() => openConversation(item.id)}
            />
          ))}
        </div>
      </section>

      <section
        className="sidebar-summary"
        aria-label={t(locale, "localProjectSummary")}
      >
        {projectFolderError ? (
          <p className="sidebar-error" role="status">
            {projectFolderError}
          </p>
        ) : null}
        <span>
          {t(locale, "round")} {currentRound}
        </span>
        <strong>
          {completedCount}/{taskCount} {t(locale, "complete")}
        </strong>
      </section>

      <NewProjectDialog
        locale={locale}
        open={isProjectDialogOpen}
        onOpenChange={setIsProjectDialogOpen}
        onCreate={(input) => {
          createProject(input);
          setIsProjectDialogOpen(false);
        }}
      />
      <RenameProjectDialog
        locale={locale}
        project={renamingProject}
        projects={projects}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingProject(undefined);
          }
        }}
        onRename={(projectId, title) => {
          renameProject(projectId, title);
          setRenamingProject(undefined);
        }}
      />
    </aside>
  );
}

function NewProjectDialog({
  locale,
  open,
  onOpenChange,
  onCreate,
}: {
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; projectDirectory?: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");

  async function chooseFolder() {
    const folder = await pickDataDirectory();
    if (folder) {
      setProjectDirectory(folder);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setTitle("");
          setProjectDirectory("");
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="form-dialog">
          <DialogHeader
            locale={locale}
            title={t(locale, "newProject")}
          />
          <label className="settings-field">
            <span>{t(locale, "projectName")}</span>
            <input
              className="settings-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>{t(locale, "projectFolder")}</span>
            <div className="folder-picker-row">
              <input
                className="settings-input"
                placeholder={t(locale, "defaultProjectFolder")}
                readOnly
                value={projectDirectory}
              />
              <button className="compact-action secondary-action" type="button" onClick={chooseFolder}>
                <FolderOpen size={15} aria-hidden="true" />
                {t(locale, "chooseFolder")}
              </button>
            </div>
            <p className="settings-help">{t(locale, "projectFolderHint")}</p>
          </label>
          <DialogActions
            locale={locale}
            onCancel={() => onOpenChange(false)}
            onCreate={() =>
              onCreate({
                title: title.trim() || t(locale, "untitledProject"),
                projectDirectory: projectDirectory.trim() || undefined,
              })
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameProjectDialog({
  locale,
  project,
  projects,
  onOpenChange,
  onRename,
}: {
  locale: Locale;
  project?: Project;
  projects: Project[];
  onOpenChange: (open: boolean) => void;
  onRename: (projectId: string, title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const trimmedTitle = title.trim();
  const hasDuplicateTitle =
    Boolean(project && trimmedTitle) &&
    projects.some(
      (candidate) =>
        candidate.id !== project?.id &&
        candidate.title.trim().toLocaleLowerCase() ===
          trimmedTitle.toLocaleLowerCase(),
    );

  useEffect(() => {
    setTitle(project?.title ?? "");
  }, [project]);

  function submitRename() {
    if (project && trimmedTitle && !hasDuplicateTitle) {
      onRename(project.id, trimmedTitle);
    }
  }

  return (
    <Dialog.Root open={Boolean(project)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="form-dialog">
          <DialogHeader locale={locale} title={t(locale, "renameProject")} />
          <label className="settings-field">
            <span>{t(locale, "projectName")}</span>
            <input
              className="settings-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitRename();
                }
              }}
            />
            {hasDuplicateTitle ? (
              <p className="settings-error">{t(locale, "projectAlreadyExists")}</p>
            ) : null}
          </label>
          <DialogActions
            actionLabel={t(locale, "rename")}
            locale={locale}
            onCancel={() => onOpenChange(false)}
            onCreate={submitRename}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogHeader({ locale, title }: { locale: Locale; title: string }) {
  return (
    <div className="dialog-topline">
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Close className="icon-button" title={t(locale, "cancel")}>
        <X size={18} aria-hidden="true" />
      </Dialog.Close>
    </div>
  );
}

function DialogActions({
  actionLabel,
  locale,
  onCancel,
  onCreate,
}: {
  actionLabel?: string;
  locale: Locale;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="dialog-actions">
      <button className="secondary-action compact-action" type="button" onClick={onCancel}>
        {t(locale, "cancel")}
      </button>
      <button className="primary-action compact-action" type="button" onClick={onCreate}>
        {actionLabel ?? t(locale, "create")}
      </button>
    </div>
  );
}

function ProjectButton({
  item,
  isActive,
  isCollapsed,
  onToggle,
}: {
  item: Project;
  isActive: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={isActive ? "project-chip active" : "project-chip"}
      type="button"
      aria-expanded={!isCollapsed}
      onClick={onToggle}
      title={item.projectDirectory || item.title}
    >
      <FolderOpen size={15} aria-hidden="true" />
      <span>{item.title}</span>
    </button>
  );
}

function ProjectMenu({
  item,
  isOpen,
  locale,
  menuPosition,
  onOpenChange,
  onNewConversation,
  onOpenFolder,
  onRename,
  onRemove,
}: {
  item: Project;
  isOpen: boolean;
  locale: Locale;
  menuPosition?: { x?: number; y?: number };
  onOpenChange: (menuPosition?: { x: number; y: number }) => void;
  onNewConversation: () => void;
  onOpenFolder: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={
        isOpen ? "project-tree-menu-shell open" : "project-tree-menu-shell"
      }
    >
      <button
        className="project-inline-action"
        type="button"
        title={t(locale, "projectActions")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) {
            onOpenChange(undefined);
            return;
          }

          const buttonRect = event.currentTarget.getBoundingClientRect();
          const sidebarRight =
            event.currentTarget.closest(".sidebar")?.getBoundingClientRect()
              .right ?? window.innerWidth;
          onOpenChange(
            getProjectMenuPosition({
              preferredX: buttonRect.left,
              preferredY: buttonRect.bottom + projectContextMenuGap,
              boundaryRight: sidebarRight,
              fallbackRight: buttonRect.right,
            }),
          );
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {isOpen && menuPosition?.x !== undefined && menuPosition.y !== undefined ? (
        <ContextMenu
          ariaLabel={item.title}
          className="project-context-menu"
          items={getProjectContextMenuItems({
            locale,
            onNewConversation,
            onOpenFolder,
            onRename,
            onRemove,
          })}
          position={{ x: menuPosition.x, y: menuPosition.y }}
          onClose={() => onOpenChange(undefined)}
        />
      ) : null}
    </div>
  );
}

function getProjectContextMenuItems({
  locale,
  onNewConversation,
  onOpenFolder,
  onRename,
  onRemove,
}: {
  locale: Locale;
  onNewConversation: () => void;
  onOpenFolder: () => void;
  onRename: () => void;
  onRemove: () => void;
}): ContextMenuItem[] {
  return [
    {
      key: "new-conversation",
      label: t(locale, "newConversation"),
      onSelect: onNewConversation,
    },
    {
      key: "open-folder",
      label: t(locale, "openInExplorer"),
      onSelect: onOpenFolder,
    },
    {
      key: "rename-project",
      label: t(locale, "renameProject"),
      onSelect: onRename,
    },
    {
      key: "remove-project",
      label: t(locale, "remove"),
      danger: true,
      onSelect: onRemove,
    },
  ];
}

function ConversationButton({
  item,
  projectTitle,
  isActive,
  locale,
  onOpen,
}: {
  item: Conversation;
  projectTitle?: string;
  isActive: boolean;
  locale: Locale;
  onOpen: () => void;
}) {
  return (
    <button
      className={isActive ? "project-chip conversation active" : "project-chip conversation"}
      type="button"
      onClick={onOpen}
      title={item.title}
    >
      <span className="conversation-row-content">
        <strong>{item.title}</strong>
        {projectTitle ? (
          <span className="conversation-project-name">{projectTitle}</span>
        ) : null}
        <small>{formatDate(item.updatedAt, locale)}</small>
      </span>
    </button>
  );
}

function PendingConversationButton({
  conversation,
  locale,
}: {
  conversation: Conversation;
  locale: Locale;
}) {
  return (
    <div
      className="project-chip conversation pending active"
      role="status"
      title={t(locale, "newConversation")}
    >
      <span className="conversation-row-content">
        <strong>{t(locale, "newConversation")}</strong>
        <small>{formatDate(conversation.updatedAt, locale)}</small>
      </span>
    </div>
  );
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
