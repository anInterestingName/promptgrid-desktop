import type { Quality, TaskStatus } from "./types";

export type Locale = "zh" | "en";

export const localeOptions: Array<{ locale: Locale; label: string }> = [
  { locale: "zh", label: "中" },
  { locale: "en", label: "EN" },
];

const messages = {
  en: {
    appLanguage: "Interface language",
    interfaceColor: "Color theme",
    colorThemeBlue: "Blue",
    colorThemeAurora: "Aurora",
    colorThemeDawn: "Dawn",
    colorThemeViolet: "Violet",
    localProject: "Local Project",
    projectNavigation: "Project navigation",
    workspaceAria: "PromptGrid workspace",
    workspaceSections: "Workspace sections",
    projectTitle: "Launch Cover Directions",
    desktop: "Desktop",
    projects: "Projects",
    history: "History",
    settings: "Settings",
    recent: "Recent",
    recentProjectProduct: "Product Scene Angles",
    recentProjectCampaign: "Campaign Visual Branches",
    localProjectSummary: "Local project summary",
    round: "Round",
    complete: "complete",
    promptControls: "Prompt controls",
    sourceIdea: "Source Idea",
    originalPrompt: "Original prompt",
    style: "Style",
    aspectRatio: "Aspect Ratio",
    quality: "Quality",
    analyzePrompts: "Analyze Prompts",
    analyzing: "Analyzing",
    generateImages: "Generate Images",
    generating: "Generating",
    imageGridAria: "Image direction grid",
    gridEyebrow: "3x3 Grid",
    promptDirections: "Prompt Directions",
    exportSelectedImage: "Export selected image",
    exportComposedGrid: "Export composed grid",
    image: "Image",
    grid: "Grid",
    preview: "Preview",
    closePreview: "Close preview",
    cell: "Cell",
    promptForCell: "Prompt for cell",
    previewImage: "Preview image",
    retryCell: "Retry cell",
    regenerateCell: "Regenerate cell",
    expandFromCell: "Expand from cell",
    mockProviderTimeout: "Mock provider timeout",
  },
  zh: {
    appLanguage: "界面语言",
    interfaceColor: "界面色彩",
    colorThemeBlue: "蓝白",
    colorThemeAurora: "极光",
    colorThemeDawn: "朝霞",
    colorThemeViolet: "紫雾",
    localProject: "本地项目",
    projectNavigation: "项目导航",
    workspaceAria: "PromptGrid 工作台",
    workspaceSections: "工作区导航",
    projectTitle: "发布封面方向探索",
    desktop: "桌面版",
    projects: "项目",
    history: "历史",
    settings: "设置",
    recent: "最近",
    recentProjectProduct: "产品场景角度",
    recentProjectCampaign: "活动视觉分支",
    localProjectSummary: "本地项目概览",
    round: "轮次",
    complete: "已完成",
    promptControls: "提示词控制",
    sourceIdea: "原始想法",
    originalPrompt: "原始提示词",
    style: "风格",
    aspectRatio: "画面比例",
    quality: "质量",
    analyzePrompts: "分析提示词",
    analyzing: "分析中",
    generateImages: "生成图片",
    generating: "生成中",
    imageGridAria: "图片方向网格",
    gridEyebrow: "3x3 网格",
    promptDirections: "提示词方向",
    exportSelectedImage: "导出选中图片",
    exportComposedGrid: "导出组合网格",
    image: "图片",
    grid: "网格",
    preview: "预览",
    closePreview: "关闭预览",
    cell: "格子",
    promptForCell: "格子提示词",
    previewImage: "预览图片",
    retryCell: "重试格子",
    regenerateCell: "重新生成格子",
    expandFromCell: "从格子扩展",
    mockProviderTimeout: "模拟服务超时",
  },
} satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof typeof messages.en;

export function t(locale: Locale, key: MessageKey) {
  return messages[locale][key];
}

export function getInitialLocale(): Locale {
  const savedLocale = window.localStorage.getItem("promptgrid-locale");
  if (savedLocale === "zh" || savedLocale === "en") {
    return savedLocale;
  }

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLocale(locale: Locale) {
  window.localStorage.setItem("promptgrid-locale", locale);
}

export const styleLabels: Record<Locale, Record<string, string>> = {
  en: {
    "Editorial product study": "Editorial product study",
    "Quiet cinematic still": "Quiet cinematic still",
    "Premium ecommerce scene": "Premium ecommerce scene",
    "Magazine cover concept": "Magazine cover concept",
  },
  zh: {
    "Editorial product study": "编辑感产品研究",
    "Quiet cinematic still": "安静电影感静帧",
    "Premium ecommerce scene": "高级电商场景",
    "Magazine cover concept": "杂志封面概念",
  },
};

export const qualityLabels: Record<Locale, Record<Quality, string>> = {
  en: {
    draft: "Draft",
    standard: "Standard",
    high: "High",
  },
  zh: {
    draft: "草稿",
    standard: "标准",
    high: "高质量",
  },
};

export const statusLabels: Record<Locale, Record<TaskStatus, string>> = {
  en: {
    pending: "Pending",
    running: "Running",
    completed: "Complete",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  zh: {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  },
};

export const visualLabels: Record<Locale, Record<string, string>> = {
  en: {
    "Soft Studio": "Soft Studio",
    "Glass Desk": "Glass Desk",
    "Warm Editorial": "Warm Editorial",
    "Night Console": "Night Console",
    "Paper Prototype": "Paper Prototype",
    "Signal Board": "Signal Board",
    "Gallery Light": "Gallery Light",
    "Workshop Table": "Workshop Table",
    "Launch Motion": "Launch Motion",
  },
  zh: {
    "Soft Studio": "柔光棚拍",
    "Glass Desk": "玻璃桌面",
    "Warm Editorial": "暖调编辑",
    "Night Console": "夜间控制台",
    "Paper Prototype": "纸面原型",
    "Signal Board": "信号看板",
    "Gallery Light": "画廊光线",
    "Workshop Table": "工作台面",
    "Launch Motion": "发布动势",
  },
};
