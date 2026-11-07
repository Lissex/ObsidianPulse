import { DAILY_BLOCKS, DailyBlockId } from "./daily";
import { DEFAULT_PERIOD_TEMPLATES, PlanningPeriod } from "./planning";
import { normalizeRepository } from "./github";
import { timeToMinutes } from "./schedule";

export type Period = "day" | "week" | "month" | "year";
export type Density = "comfortable" | "compact";
export type PanelStyle = "mac" | "minimal" | "outlined";
export type ChartStyle = "bars" | "line" | "area";
export type AccentPalette = "obsidianite" | "classic-dark" | "classic-light";
export type PanelId = "summary" | "activity" | "folders" | "tasks" | "today" | "schedule" | "planning" | "github" | "learning";
export type TaskDestination = "daily" | "file";
export type TaskGrouping = "due" | "priority" | "folder";
export type DashboardSection = "overview" | "day" | "planning" | "github" | "learning";

export interface PanelDefinition {
  id: PanelId;
  title: string;
  description: string;
}

export const PANELS: PanelDefinition[] = [
  { id: "summary", title: "Коротко", description: "Основные показатели за выбранный период." },
  { id: "activity", title: "Активность", description: "Как менялось хранилище со временем." },
  { id: "folders", title: "Хранилище", description: "Распределение заметок по папкам и тегам." },
  { id: "tasks", title: "Задачи", description: "Открытые, просроченные и выполненные задачи." },
  { id: "today", title: "Сегодня", description: "Активность заметок, дневная запись и события." },
  { id: "schedule", title: "Расписание", description: "Занятые интервалы и свободное время." },
  { id: "planning", title: "Планы периода", description: "Недельные, месячные и годовые цели и обзоры." },
  { id: "github", title: "GitHub", description: "Коммиты выбранных репозиториев за период." },
  { id: "learning", title: "Обучение", description: "Курсы и прогресс обучения." },
];

export interface VaultPulseSettings {
  period: Period;
  density: Density;
  panelStyle: PanelStyle;
  chartStyle: ChartStyle;
  accentPalette: AccentPalette;
  panelOrder: PanelId[];
  hiddenPanels: PanelId[];
  excludedFolders: string[];
  excludedTags: string[];
  dailyFolder: string;
  dailyDateFormat: string;
  dailyBlocks: DailyBlockId[];
  taskDestination: TaskDestination;
  taskFilePath: string;
  taskGrouping: TaskGrouping;
  showCompletedTasks: boolean;
  taskDisplayLimit: number;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleSlotMinutes: number;
  weekStartsMonday: boolean;
  timeFormat: "24h" | "12h";
  rolloverTasks: boolean;
  planningDefaultPeriod: PlanningPeriod;
  weeklyFolder: string;
  weeklyFormat: string;
  weeklyTemplate: string;
  monthlyFolder: string;
  monthlyFormat: string;
  monthlyTemplate: string;
  yearlyFolder: string;
  yearlyFormat: string;
  yearlyTemplate: string;
  githubRepositories: string[];
  githubSecretId: string;
  githubSyncMinutes: number;
  learningStepikEnabled: boolean;
  learningUdemyEnabled: boolean;
  learningOtherEnabled: boolean;
}

export const DEFAULT_SETTINGS: VaultPulseSettings = {
  period: "day",
  density: "comfortable",
  panelStyle: "mac",
  chartStyle: "bars",
  accentPalette: "obsidianite",
  panelOrder: ["summary", "activity", "folders", "tasks", "today", "schedule", "planning", "github", "learning"],
  hiddenPanels: [],
  excludedFolders: [],
  excludedTags: [],
  dailyFolder: "Планирование/Дни",
  dailyDateFormat: "YYYY-MM-DD",
  dailyBlocks: ["plan", "events", "activity", "completed", "review"],
  taskDestination: "daily",
  taskFilePath: "Планирование/Задачи.md",
  taskGrouping: "due",
  showCompletedTasks: true,
  taskDisplayLimit: 5,
  scheduleStart: "09:00",
  scheduleEnd: "17:00",
  scheduleSlotMinutes: 30,
  weekStartsMonday: true,
  timeFormat: "24h",
  rolloverTasks: true,
  planningDefaultPeriod: "week",
  weeklyFolder: "Планирование/Недели",
  weeklyFormat: "YYYY-[W]WW",
  weeklyTemplate: DEFAULT_PERIOD_TEMPLATES.week,
  monthlyFolder: "Планирование/Месяцы",
  monthlyFormat: "YYYY-MM",
  monthlyTemplate: DEFAULT_PERIOD_TEMPLATES.month,
  yearlyFolder: "Планирование/Годы",
  yearlyFormat: "YYYY",
  yearlyTemplate: DEFAULT_PERIOD_TEMPLATES.year,
  githubRepositories: [],
  githubSecretId: "",
  githubSyncMinutes: 0,
  learningStepikEnabled: true,
  learningUdemyEnabled: true,
  learningOtherEnabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSettings(value: unknown): VaultPulseSettings {
  const input: Record<string, unknown> = isRecord(value) ? value : {};
  const validTime = (candidate: unknown): candidate is string => typeof candidate === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate);
  const scheduleStart = validTime(input.scheduleStart) ? input.scheduleStart : DEFAULT_SETTINGS.scheduleStart;
  const requestedEnd = validTime(input.scheduleEnd) ? input.scheduleEnd : DEFAULT_SETTINGS.scheduleEnd;
  const scheduleEnd = timeToMinutes(requestedEnd) > timeToMinutes(scheduleStart) ? requestedEnd : DEFAULT_SETTINGS.scheduleEnd;
  const panelOrder = unknownArray(input.panelOrder)
    .filter((id): id is PanelId => PANELS.some((panel) => panel.id === id));
  for (const panel of PANELS) if (!panelOrder.includes(panel.id)) panelOrder.push(panel.id);
  const hiddenPanels = unknownArray(input.hiddenPanels)
    .filter((id): id is PanelId => PANELS.some((panel) => panel.id === id));
  const periods: Period[] = ["day", "week", "month", "year"];
  const period = oneOf(input.period, periods) ? input.period : DEFAULT_SETTINGS.period;
  const taskDisplayLimit = oneOf(input.taskDisplayLimit, [3, 5, 10, 0]) ? input.taskDisplayLimit : DEFAULT_SETTINGS.taskDisplayLimit;
  const scheduleSlotMinutes = oneOf(input.scheduleSlotMinutes, [15, 30, 60]) ? input.scheduleSlotMinutes : DEFAULT_SETTINGS.scheduleSlotMinutes;
  const githubSyncMinutes = oneOf(input.githubSyncMinutes, [0, 15, 60, 1440]) ? input.githubSyncMinutes : DEFAULT_SETTINGS.githubSyncMinutes;
    return {
      period,
      density: input.density === "compact" ? "compact" : "comfortable",
      panelStyle: input.panelStyle === "minimal" || input.panelStyle === "outlined" ? input.panelStyle : "mac",
      chartStyle: input.chartStyle === "line" || input.chartStyle === "area" ? input.chartStyle : "bars",
      accentPalette: input.accentPalette === "classic-dark" || input.accentPalette === "classic-light"
        ? input.accentPalette : "obsidianite",
      panelOrder,
      hiddenPanels,
      excludedFolders: unknownArray(input.excludedFolders).filter((item): item is string => typeof item === "string"),
      excludedTags: unknownArray(input.excludedTags).filter((item): item is string => typeof item === "string"),
      dailyFolder: typeof input.dailyFolder === "string" ? input.dailyFolder : DEFAULT_SETTINGS.dailyFolder,
      dailyDateFormat: typeof input.dailyDateFormat === "string" && input.dailyDateFormat ? input.dailyDateFormat : DEFAULT_SETTINGS.dailyDateFormat,
      dailyBlocks: Array.isArray(input.dailyBlocks)
        ? [...new Set(unknownArray(input.dailyBlocks).filter((id): id is DailyBlockId => DAILY_BLOCKS.some((block) => block.id === id)))]
        : [...DEFAULT_SETTINGS.dailyBlocks],
      taskDestination: input.taskDestination === "file" ? "file" : "daily",
      taskFilePath: typeof input.taskFilePath === "string" ? input.taskFilePath : DEFAULT_SETTINGS.taskFilePath,
      taskGrouping: input.taskGrouping === "priority" || input.taskGrouping === "folder" ? input.taskGrouping : "due",
      showCompletedTasks: input.showCompletedTasks !== false,
      taskDisplayLimit,
      scheduleStart,
      scheduleEnd,
      scheduleSlotMinutes,
      weekStartsMonday: input.weekStartsMonday !== false,
      timeFormat: input.timeFormat === "12h" ? "12h" : "24h",
      rolloverTasks: input.rolloverTasks !== false,
      planningDefaultPeriod: input.planningDefaultPeriod === "month" || input.planningDefaultPeriod === "year" ? input.planningDefaultPeriod : "week",
      weeklyFolder: typeof input.weeklyFolder === "string" ? input.weeklyFolder : DEFAULT_SETTINGS.weeklyFolder,
      weeklyFormat: typeof input.weeklyFormat === "string" && input.weeklyFormat ? input.weeklyFormat : DEFAULT_SETTINGS.weeklyFormat,
      weeklyTemplate: typeof input.weeklyTemplate === "string" && input.weeklyTemplate ? input.weeklyTemplate : DEFAULT_SETTINGS.weeklyTemplate,
      monthlyFolder: typeof input.monthlyFolder === "string" ? input.monthlyFolder : DEFAULT_SETTINGS.monthlyFolder,
      monthlyFormat: typeof input.monthlyFormat === "string" && input.monthlyFormat ? input.monthlyFormat : DEFAULT_SETTINGS.monthlyFormat,
      monthlyTemplate: typeof input.monthlyTemplate === "string" && input.monthlyTemplate ? input.monthlyTemplate : DEFAULT_SETTINGS.monthlyTemplate,
      yearlyFolder: typeof input.yearlyFolder === "string" ? input.yearlyFolder : DEFAULT_SETTINGS.yearlyFolder,
      yearlyFormat: typeof input.yearlyFormat === "string" && input.yearlyFormat ? input.yearlyFormat : DEFAULT_SETTINGS.yearlyFormat,
      yearlyTemplate: typeof input.yearlyTemplate === "string" && input.yearlyTemplate ? input.yearlyTemplate : DEFAULT_SETTINGS.yearlyTemplate,
      githubRepositories: [...new Set(unknownArray(input.githubRepositories)
        .filter((repo): repo is string => typeof repo === "string")
        .map(normalizeRepository)
        .filter((repo): repo is string => repo !== null))],
      githubSecretId: typeof input.githubSecretId === "string" ? input.githubSecretId : "",
      githubSyncMinutes,
      learningStepikEnabled: input.learningStepikEnabled !== false,
      learningUdemyEnabled: input.learningUdemyEnabled !== false,
      learningOtherEnabled: input.learningOtherEnabled !== false,
  };
  }

function oneOf<const T extends readonly (string | number)[]>(value: unknown, allowed: T): value is T[number] {
  return allowed.some((candidate) => candidate === value);
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

