import * as Dialog from "@radix-ui/react-dialog";
import {
  FolderOpen,
  Grid3X3,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { t, type Locale, type MessageKey } from "../i18n";
import { pickDataDirectory } from "../services/localPersistence";
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
  const openProject = usePromptGridStore((state) => state.openProject);
  const openConversation = usePromptGridStore((state) => state.openConversation);
  const currentRound = usePromptGridStore((state) => state.currentRound);
  const completedCount = usePromptGridStore(
    (state) => state.tasks.filter((task) => task.status === "completed").length,
  );
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);

  const projectTree = useMemo(
    () =>
      sortByUpdatedAt(projects).map((item) => ({
        project: item,
        conversations: sortByUpdatedAt(
          conversations.filter(
            (candidate) => candidate.projectId === item.id,
          ),
        ),
      })),
    [conversations, projects],
  );
  const recentConversations = useMemo(
    () => sortByUpdatedAt(conversations).slice(0, 4),
    [conversations],
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
              <div className="project-tree-row">
                <ProjectButton
                  isActive={item.project.id === project.id}
                  item={item.project}
                  onOpen={() => openProject(item.project.id)}
                />
                <button
                  className="project-inline-action"
                  type="button"
                  title={t(locale, "newConversation")}
                  onClick={() => startNewConversation(item.project.id)}
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
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
        <span>
          {t(locale, "round")} {currentRound}
        </span>
        <strong>
          {completedCount}/9 {t(locale, "complete")}
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
  locale,
  onCancel,
  onCreate,
}: {
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
        {t(locale, "create")}
      </button>
    </div>
  );
}

function ProjectButton({
  item,
  isActive,
  onOpen,
}: {
  item: Project;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={isActive ? "project-chip active" : "project-chip"}
      type="button"
      onClick={onOpen}
      title={item.projectDirectory || item.title}
    >
      <FolderOpen size={15} aria-hidden="true" />
      <span>{item.title}</span>
    </button>
  );
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

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
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
