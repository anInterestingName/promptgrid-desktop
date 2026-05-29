import type { Locale } from "../../i18n";
import type { StyleGroup, VisualStyle, WorkflowConfig } from "../../types";

export const styleGroups = [
  {
    id: "aesthetic-visual",
    label: {
      en: "Aesthetic",
      zh: "美学风格",
    },
    description: {
      en: "Pure visual language for light, color, spatial order, and mood.",
      zh: "控制光线、色彩、空间秩序与情绪的纯视觉语言。",
    },
    styleIds: [
      "soft-natural-light",
      "high-key-pale-tone",
      "low-key-dark-tone",
      "minimal-geometry",
      "rich-color-block",
      "soft-haze",
      "analog-film-grain",
      "surreal-still-life",
    ],
  },
  {
    id: "material-light",
    label: {
      en: "Material & Light",
      zh: "材质光影",
    },
    description: {
      en: "Surface, reflection, transparency, tactility, and light behavior.",
      zh: "控制表面、反射、透明度、触感与光线表现。",
    },
    styleIds: [
      "translucent-glass",
      "cool-metallic-light",
      "warm-organic-texture",
      "raw-textural-surface",
      "matte-ceramic",
      "liquid-reflective-light",
    ],
  },
  {
    id: "product-visual-system",
    label: {
      en: "Product Visual System",
      zh: "商品视觉体系",
    },
    description: {
      en: "Shared visual systems for a hero image and its detail image set.",
      zh: "用于统一主图与详情图套图气质的商品视觉体系。",
    },
    styleIds: [
      "clean-marketplace-system",
      "refined-studio-still-life",
      "soft-lifestyle-system",
      "dark-premium-product",
      "precision-tech-product",
      "natural-material-story",
      "bright-color-block-product",
      "translucent-product-system",
    ],
  },
] as const satisfies readonly StyleGroup[];

export const visualStyles = [
  {
    id: "soft-natural-light",
    groupId: "aesthetic-visual",
    label: {
      en: "Soft Natural Light",
      zh: "柔和自然光",
    },
    description: {
      en: "Diffused light, gentle contrast, and an airy realistic atmosphere.",
      zh: "漫射光、低反差与自然色温，画面轻盈真实。",
    },
    usage: {
      en: "For calm, warm, realistic inspiration directions.",
      zh: "适合温和、真实、轻盈的灵感探索。",
    },
    tags: {
      en: ["Gentle", "Realistic", "Airy"],
      zh: ["温和", "真实", "轻盈"],
    },
    prompt:
      "soft natural light, diffused shadows, gentle contrast, realistic color temperature, airy atmosphere",
  },
  {
    id: "high-key-pale-tone",
    groupId: "aesthetic-visual",
    label: {
      en: "High-Key Pale Tone",
      zh: "高调浅色调",
    },
    description: {
      en: "Bright pale tones, soft shadows, and a clean luminous feeling.",
      zh: "明亮浅色、轻阴影与低饱和色彩，整体通透洁净。",
    },
    usage: {
      en: "For clean, bright, delicate visual exploration.",
      zh: "适合干净、明亮、轻盈的视觉探索。",
    },
    tags: {
      en: ["Bright", "Clean", "Low saturation"],
      zh: ["明亮", "洁净", "低饱和"],
    },
    prompt:
      "high-key lighting, pale tonal palette, soft shadows, low saturation, clean luminous atmosphere",
  },
  {
    id: "low-key-dark-tone",
    groupId: "aesthetic-visual",
    label: {
      en: "Low-Key Dark Tone",
      zh: "低调暗调光",
    },
    description: {
      en: "Deep tones, selective highlights, and quiet concentrated tension.",
      zh: "深色层次、局部高光与强明暗关系，安静集中。",
    },
    usage: {
      en: "For quiet, dramatic, mysterious visual tension.",
      zh: "适合安静、神秘、强光影张力的方向。",
    },
    tags: {
      en: ["Dark", "Dramatic", "Focused"],
      zh: ["暗调", "戏剧感", "集中"],
    },
    prompt:
      "low-key lighting, dark tonal range, selective highlights, deep shadows, focused visual tension",
  },
  {
    id: "minimal-geometry",
    groupId: "aesthetic-visual",
    label: {
      en: "Minimal Geometry",
      zh: "极简几何",
    },
    description: {
      en: "Large negative space, clean geometry, and restrained color.",
      zh: "大面积留白、清晰几何与少量色彩，强调比例秩序。",
    },
    usage: {
      en: "For ordered, modern, abstract compositions.",
      zh: "适合秩序感、留白感、现代抽象构图。",
    },
    tags: {
      en: ["Minimal", "Order", "Modern"],
      zh: ["极简", "秩序", "现代"],
    },
    prompt:
      "minimal geometric composition, strong negative space, restrained color palette, clean spatial balance",
  },
  {
    id: "rich-color-block",
    groupId: "aesthetic-visual",
    label: {
      en: "Rich Color Blocks",
      zh: "浓郁色块",
    },
    description: {
      en: "Saturated color blocks, vivid contrast, and energetic rhythm.",
      zh: "高饱和色彩、强色块关系与明确视觉节奏。",
    },
    usage: {
      en: "For bold color experiments and high-recognition ideas.",
      zh: "适合高能量、高识别度、色彩实验。",
    },
    tags: {
      en: ["Vivid", "Graphic", "Energetic"],
      zh: ["鲜明", "图形感", "高能量"],
    },
    prompt:
      "rich saturated colors, bold color blocking, vivid contrast, energetic visual rhythm",
  },
  {
    id: "soft-haze",
    groupId: "aesthetic-visual",
    label: {
      en: "Soft Haze",
      zh: "柔雾朦胧",
    },
    description: {
      en: "Diffused highlights, softened edges, and a quiet dreamlike mood.",
      zh: "高光扩散、边缘柔化与轻微雾感，氛围静谧。",
    },
    usage: {
      en: "For poetic, quiet, dreamy atmosphere studies.",
      zh: "适合诗性、静谧、梦境感的氛围探索。",
    },
    tags: {
      en: ["Dreamy", "Soft", "Atmospheric"],
      zh: ["梦境", "柔和", "氛围"],
    },
    prompt:
      "soft haze, diffused highlights, softened edges, atmospheric blur, quiet dreamlike mood",
  },
  {
    id: "analog-film-grain",
    groupId: "aesthetic-visual",
    label: {
      en: "Analog Film Grain",
      zh: "胶片颗粒",
    },
    description: {
      en: "Soft contrast, subtle color shift, and analog texture.",
      zh: "柔和对比、轻微颗粒与自然偏色，带有模拟影像质感。",
    },
    usage: {
      en: "For nostalgic, documentary, time-textured directions.",
      zh: "适合怀旧、纪实、带时间感的视觉方向。",
    },
    tags: {
      en: ["Nostalgic", "Analog", "Texture"],
      zh: ["怀旧", "胶片", "颗粒"],
    },
    prompt:
      "analog film grain, soft contrast, subtle color shift, natural imperfection, nostalgic texture",
  },
  {
    id: "surreal-still-life",
    groupId: "aesthetic-visual",
    label: {
      en: "Surreal Still Life",
      zh: "超现实静物",
    },
    description: {
      en: "Unexpected scale, uncanny spatial logic, and controlled dreamlike light.",
      zh: "非常规比例、陌生空间关系与克制的梦境光线。",
    },
    usage: {
      en: "For imaginative concepts, visual metaphors, and unusual object logic.",
      zh: "适合想象力概念、视觉隐喻和非常规静物关系。",
    },
    tags: {
      en: ["Conceptual", "Uncanny", "Imaginative"],
      zh: ["概念", "陌生感", "想象力"],
    },
    prompt:
      "surreal still-life aesthetic, unexpected scale, uncanny spatial arrangement, controlled dreamlike lighting",
  },
  {
    id: "translucent-glass",
    groupId: "material-light",
    label: {
      en: "Translucent Glass",
      zh: "清透玻璃",
    },
    description: {
      en: "Refraction, crisp reflections, transparent layers, and luminous highlights.",
      zh: "透明、折射、反射与清晰高光层次。",
    },
    usage: {
      en: "For glass, liquid, clear plastics, and light transparent forms.",
      zh: "适合玻璃、液体、透明塑料和轻盈透明结构。",
    },
    tags: {
      en: ["Glass", "Liquid", "Transparent"],
      zh: ["玻璃", "液体", "透明"],
    },
    prompt:
      "translucent glass aesthetic, refraction, crisp reflections, luminous highlights, transparent layers",
  },
  {
    id: "cool-metallic-light",
    groupId: "material-light",
    label: {
      en: "Cool Metallic Light",
      zh: "金属冷光",
    },
    description: {
      en: "Metallic reflection, hard-edged highlights, and precise surfaces.",
      zh: "金属反射、硬边高光与冷色照明，结构精确。",
    },
    usage: {
      en: "For metal, hardware, tools, and precise industrial surfaces.",
      zh: "适合金属、硬件、工具和精密工业表面。",
    },
    tags: {
      en: ["Metal", "Hardware", "Precise"],
      zh: ["金属", "硬件", "精密"],
    },
    prompt:
      "metallic surfaces, cool specular highlights, hard-edged reflections, precise industrial texture",
  },
  {
    id: "warm-organic-texture",
    groupId: "material-light",
    label: {
      en: "Warm Organic Texture",
      zh: "温润有机",
    },
    description: {
      en: "Warm light, natural grain, irregular detail, and tactile softness.",
      zh: "暖光、自然纹理、柔和颗粒与不规则细节。",
    },
    usage: {
      en: "For wood, paper, fabric, food, and handmade textures.",
      zh: "适合木、纸、织物、食品和手作质感。",
    },
    tags: {
      en: ["Natural", "Warm", "Tactile"],
      zh: ["自然", "温润", "触感"],
    },
    prompt:
      "warm organic texture, natural material grain, soft irregular details, grounded tactile mood",
  },
  {
    id: "raw-textural-surface",
    groupId: "material-light",
    label: {
      en: "Raw Textural Surface",
      zh: "粗粝原生",
    },
    description: {
      en: "Rough surfaces, visible grain, imperfect edges, and tactile realism.",
      zh: "粗糙表面、可见颗粒与不完美边缘，触感强。",
    },
    usage: {
      en: "For raw materials, outdoor surfaces, rugged objects, and realism.",
      zh: "适合原生材料、户外表面、粗犷物体和真实质感。",
    },
    tags: {
      en: ["Raw", "Rough", "Real"],
      zh: ["原生", "粗粝", "真实"],
    },
    prompt:
      "raw textural surface, visible grain, rough edges, tactile realism, natural imperfections",
  },
  {
    id: "matte-ceramic",
    groupId: "material-light",
    label: {
      en: "Matte Ceramic",
      zh: "哑光陶瓷",
    },
    description: {
      en: "Low reflection, soft curvature, and subtle shadow gradients.",
      zh: "低反射、柔和曲面与细腻阴影，沉静稳定。",
    },
    usage: {
      en: "For ceramic, skincare, home goods, and calm curved forms.",
      zh: "适合陶瓷、护肤品、家居用品和安静曲面造型。",
    },
    tags: {
      en: ["Matte", "Ceramic", "Calm"],
      zh: ["哑光", "陶瓷", "沉静"],
    },
    prompt:
      "matte ceramic surface, low reflectivity, soft curvature, subtle shadow gradients, calm material presence",
  },
  {
    id: "liquid-reflective-light",
    groupId: "material-light",
    label: {
      en: "Liquid Reflective Light",
      zh: "液态流光",
    },
    description: {
      en: "Flowing forms, mirrorlike surfaces, and stretched highlights.",
      zh: "流动形态、镜面反射与拉伸高光，动态感强。",
    },
    usage: {
      en: "For fluid, futuristic, glossy, and motion-led material studies.",
      zh: "适合流体、未来感、亮面和动态材质探索。",
    },
    tags: {
      en: ["Fluid", "Glossy", "Dynamic"],
      zh: ["流体", "亮面", "动态"],
    },
    prompt:
      "liquid reflective surface, flowing forms, elongated highlights, fluid light movement",
  },
  {
    id: "clean-marketplace-system",
    groupId: "product-visual-system",
    label: {
      en: "Clean Marketplace System",
      zh: "清爽平台规范",
    },
    description: {
      en: "Clean background, clear subject readability, even light, and consistent set language.",
      zh: "背景干净、主体清楚、光线均匀，适合规整商品套图。",
    },
    usage: {
      en: "For standard products, marketplace main images, and orderly detail sets.",
      zh: "适合标品、平台主图、规整详情套图。",
    },
    tags: {
      en: ["Marketplace", "Main image", "Clean"],
      zh: ["平台", "主图", "干净"],
    },
    prompt:
      "clean marketplace product visual system, bright neutral background, clear product readability, minimal props, even lighting, consistent visual language across hero and detail images",
  },
  {
    id: "refined-studio-still-life",
    groupId: "product-visual-system",
    label: {
      en: "Refined Studio Still Life",
      zh: "精致棚拍静物",
    },
    description: {
      en: "Controlled studio composition, clean shadows, and detailed material presence.",
      zh: "棚拍质感、构图稳定、阴影干净，突出形体和材质。",
    },
    usage: {
      en: "For beauty, fragrance, small appliances, and texture-led products.",
      zh: "适合美妆、香氛、小家电、质感型商品。",
    },
    tags: {
      en: ["Studio", "Texture", "Refined"],
      zh: ["棚拍", "质感", "精致"],
    },
    prompt:
      "refined studio still-life product system, controlled lighting, clean shadow structure, balanced composition, consistent material detail across the image set",
  },
  {
    id: "soft-lifestyle-system",
    groupId: "product-visual-system",
    label: {
      en: "Soft Lifestyle System",
      zh: "轻生活场景",
    },
    description: {
      en: "Natural usage context, gentle daylight, and believable everyday atmosphere.",
      zh: "自然使用环境、柔和日光与生活化道具，整体亲和真实。",
    },
    usage: {
      en: "For home, apparel, daily goods, and lifestyle products.",
      zh: "适合家居、服饰、日用品、生活方式商品。",
    },
    tags: {
      en: ["Lifestyle", "Home", "Daily use"],
      zh: ["生活方式", "家居", "日用"],
    },
    prompt:
      "soft lifestyle product visual system, natural usage context, gentle daylight, believable props, consistent everyday atmosphere across hero and detail images",
  },
  {
    id: "dark-premium-product",
    groupId: "product-visual-system",
    label: {
      en: "Dark Tactile Product",
      zh: "高级暗调质感",
    },
    description: {
      en: "Dark background, selective highlights, and tactile material contrast.",
      zh: "深色背景、局部高光与强材质对比，画面沉稳有张力。",
    },
    usage: {
      en: "For beverages, fragrance, electronics, and dark premium materials.",
      zh: "适合酒水、香水、数码和深色高质感商品。",
    },
    tags: {
      en: ["Dark", "Premium", "Tactile"],
      zh: ["暗调", "高级感", "质感"],
    },
    prompt:
      "dark premium product visual system, low-key lighting, selective highlights, deep tonal contrast, tactile material emphasis, cohesive mood across the set",
  },
  {
    id: "precision-tech-product",
    groupId: "product-visual-system",
    label: {
      en: "Precision Tech Product",
      zh: "科技精密视觉",
    },
    description: {
      en: "Cool light, sharp geometry, clean reflections, and technical clarity.",
      zh: "冷色光、清晰线条与精密表面，适合硬件和智能产品。",
    },
    usage: {
      en: "For digital hardware, smart devices, tools, and technical products.",
      zh: "适合数码硬件、智能设备、工具类产品。",
    },
    tags: {
      en: ["Tech", "Hardware", "Precise"],
      zh: ["科技", "硬件", "精密"],
    },
    prompt:
      "precision technology product visual system, cool lighting, sharp geometry, clean reflections, technical surface detail, consistent futuristic clarity",
  },
  {
    id: "natural-material-story",
    groupId: "product-visual-system",
    label: {
      en: "Natural Material Story",
      zh: "自然材质叙事",
    },
    description: {
      en: "Warm organic materials, earthy light, and a handcrafted atmosphere.",
      zh: "木、纸、织物、陶瓷等自然材质氛围，温润有触感。",
    },
    usage: {
      en: "For food, handmade goods, homeware, and eco-material products.",
      zh: "适合食品、手作、家居、环保材质商品。",
    },
    tags: {
      en: ["Organic", "Handmade", "Eco"],
      zh: ["有机", "手作", "环保"],
    },
    prompt:
      "natural material product visual system, warm organic textures, tactile surfaces, soft earthy lighting, coherent handcrafted atmosphere",
  },
  {
    id: "bright-color-block-product",
    groupId: "product-visual-system",
    label: {
      en: "Bright Color-Block Product",
      zh: "明亮色块陈列",
    },
    description: {
      en: "Bright backgrounds, graphic spacing, and a lively color rhythm.",
      zh: "明快背景、色块构图与强节奏感，年轻活泼。",
    },
    usage: {
      en: "For youthful, trendy, children's, and colorful products.",
      zh: "适合年轻化、潮流、儿童和彩色商品。",
    },
    tags: {
      en: ["Colorful", "Youthful", "Playful"],
      zh: ["彩色", "年轻", "活泼"],
    },
    prompt:
      "bright color-block product visual system, vivid backgrounds, graphic composition, playful spacing, consistent energetic color rhythm",
  },
  {
    id: "translucent-product-system",
    groupId: "product-visual-system",
    label: {
      en: "Translucent Product System",
      zh: "透明清透质感",
    },
    description: {
      en: "Glasslike refraction, crisp reflections, and clean transparent layering.",
      zh: "玻璃、液体、半透明与反射高光，强调轻盈精致。",
    },
    usage: {
      en: "For skincare, beverages, glass, liquid, acrylic, and translucent products.",
      zh: "适合护肤、饮品、玻璃、液体、亚克力商品。",
    },
    tags: {
      en: ["Skincare", "Liquid", "Clear"],
      zh: ["护肤", "液体", "清透"],
    },
    prompt:
      "translucent product visual system, glasslike refraction, crisp reflections, luminous highlights, clean layered transparency across the set",
  },
] as const satisfies readonly VisualStyle[];

export const defaultStyleGroupIds = ["aesthetic-visual"] as const;
export const defaultStyleId = "soft-natural-light";
export const fallbackProductStyleId = "clean-marketplace-system";

const styleById = Object.fromEntries(
  visualStyles.map((style) => [style.id, style]),
) as Record<string, VisualStyle>;

const groupById = Object.fromEntries(
  styleGroups.map((group) => [group.id, group]),
) as Record<string, StyleGroup>;

const legacyStyleMap: Record<string, string> = {
  "Editorial product study": "refined-studio-still-life",
  "Quiet cinematic still": "low-key-dark-tone",
  "Premium ecommerce scene": "clean-marketplace-system",
  "Magazine cover concept": "surreal-still-life",
};

export function getStyleById(styleId: string | undefined) {
  return styleId ? styleById[normalizeStyleId(styleId)] : undefined;
}

export function getStyleGroupById(groupId: string | undefined) {
  return groupId ? groupById[groupId] : undefined;
}

export function getStyleGroupsByIds(groupIds: readonly string[] | undefined) {
  const normalizedGroupIds = normalizeStyleGroupIds(groupIds);
  return normalizedGroupIds
    .map((groupId) => getStyleGroupById(groupId))
    .filter((group): group is StyleGroup => Boolean(group));
}

export function getStylesForGroup(groupId: string | undefined) {
  const group = getStyleGroupById(groupId);
  if (!group) {
    return [];
  }

  return group.styleIds
    .map((styleId) => getStyleById(styleId))
    .filter((style): style is VisualStyle => Boolean(style));
}

export function getStylesForGroups(groupIds: readonly string[] | undefined) {
  const seenStyleIds = new Set<string>();
  return getStyleGroupsByIds(groupIds).flatMap((group) =>
    getStylesForGroup(group.id).filter((style) => {
      if (seenStyleIds.has(style.id)) {
        return false;
      }

      seenStyleIds.add(style.id);
      return true;
    }),
  );
}

export function getStyleLabel(styleId: string | undefined, locale: Locale) {
  const style = getStyleById(styleId);
  return style?.label[locale] ?? styleId ?? "";
}

export function getStylePrompt(styleId: string | undefined) {
  const style = getStyleById(styleId);
  return style?.prompt ?? styleId ?? "";
}

export function normalizeStyleId(styleId: string) {
  return legacyStyleMap[styleId] ?? styleId;
}

export function normalizeStyleGroupIds(groupIds: readonly string[] | undefined) {
  const normalized = (groupIds ?? [])
    .filter((groupId): groupId is string => typeof groupId === "string")
    .filter((groupId) => Boolean(getStyleGroupById(groupId)));

  return normalized.length ? normalized : [...defaultStyleGroupIds];
}

export function getDefaultStyleForWorkflow(workflow: Pick<WorkflowConfig, "styleGroupIds" | "defaultStyleId">) {
  const normalizedDefaultStyleId = normalizeStyleId(workflow.defaultStyleId);
  if (isStyleAllowedForWorkflow(normalizedDefaultStyleId, workflow)) {
    return normalizedDefaultStyleId;
  }

  return getStylesForGroups(workflow.styleGroupIds)[0]?.id ?? defaultStyleId;
}

export function getDefaultStyleForWorkflowMode(
  workflowConfigs: Partial<
    Record<string, Pick<WorkflowConfig, "styleGroupIds" | "defaultStyleId">>
  >,
  workflowMode: string,
) {
  const workflow = workflowConfigs[workflowMode];
  return workflow ? getDefaultStyleForWorkflow(workflow) : defaultStyleId;
}

export function ensureStyleForWorkflow(
  styleId: string | undefined,
  workflow: Pick<WorkflowConfig, "styleGroupIds" | "defaultStyleId">,
) {
  const normalizedStyleId = styleId ? normalizeStyleId(styleId) : "";
  return isStyleAllowedForWorkflow(normalizedStyleId, workflow)
    ? normalizedStyleId
    : getDefaultStyleForWorkflow(workflow);
}

export function getGroupIdForStyleInWorkflow(
  styleId: string | undefined,
  workflow: Pick<WorkflowConfig, "styleGroupIds" | "defaultStyleId">,
) {
  const normalizedStyleId = ensureStyleForWorkflow(styleId, workflow);
  const style = getStyleById(normalizedStyleId);
  const allowedGroupIds = normalizeStyleGroupIds(workflow.styleGroupIds);
  return style && allowedGroupIds.includes(style.groupId)
    ? style.groupId
    : allowedGroupIds[0];
}

function isStyleAllowedForWorkflow(
  styleId: string,
  workflow: Pick<WorkflowConfig, "styleGroupIds" | "defaultStyleId">,
) {
  return getStylesForGroups(workflow.styleGroupIds).some(
    (style) => style.id === styleId,
  );
}
