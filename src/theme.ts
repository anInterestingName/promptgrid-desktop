export type ColorTheme = "blue" | "aurora" | "dawn" | "violet";

export const colorThemeOptions: Array<{
  colorTheme: ColorTheme;
  labelKey:
    | "colorThemeBlue"
    | "colorThemeAurora"
    | "colorThemeDawn"
    | "colorThemeViolet";
  swatches: [string, string, string];
}> = [
  {
    colorTheme: "blue",
    labelKey: "colorThemeBlue",
    swatches: ["#0a59f7", "#16b8d9", "#eaf2ff"],
  },
  {
    colorTheme: "aurora",
    labelKey: "colorThemeAurora",
    swatches: ["#0d8cff", "#20d3a2", "#e8f7ff"],
  },
  {
    colorTheme: "dawn",
    labelKey: "colorThemeDawn",
    swatches: ["#0a6cff", "#ff7a59", "#fff1df"],
  },
  {
    colorTheme: "violet",
    labelKey: "colorThemeViolet",
    swatches: ["#2454ff", "#8b5cf6", "#f0ecff"],
  },
];

const COLOR_THEME_STORAGE_KEY = "fangcun-color-theme";
const LEGACY_COLOR_THEME_STORAGE_KEY = "promptgrid-color-theme";

export function getInitialColorTheme(): ColorTheme {
  const savedTheme =
    window.localStorage.getItem(COLOR_THEME_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_COLOR_THEME_STORAGE_KEY);
  if (
    savedTheme === "blue" ||
    savedTheme === "aurora" ||
    savedTheme === "dawn" ||
    savedTheme === "violet"
  ) {
    return savedTheme;
  }

  return "blue";
}

export function saveColorTheme(colorTheme: ColorTheme) {
  window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
}
