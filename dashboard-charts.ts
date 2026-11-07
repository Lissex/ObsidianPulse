import { ActivityEvent, NoteRecord, StatsPeriod, eventInPeriod, getDateRange } from "./stats";
import { localDayNumber, periodCaption } from "./view-utils";

export function renderActivityChart(
  card: HTMLElement,
  events: ActivityEvent[],
  period: StatsPeriod,
  weekStartsMonday: boolean,
  chartStyle: "bars" | "line" | "area",
): void {
    const { start, bucketCount } = getDateRange(period, new Date(), weekStartsMonday);
    const buckets = Array.from({ length: bucketCount }, () => ({ created: 0, modified: 0 }));
    for (const event of events) {
      if (!eventInPeriod(event, period, new Date(), weekStartsMonday)) continue;
      const date = new Date(event.timestamp);
      let index = 0;
      if (period === "day") index = date.getHours();
      else if (period === "week") index = Math.floor((localDayNumber(date) - localDayNumber(start)) / 86400000);
      else if (period === "month") index = date.getDate() - 1;
      else index = date.getMonth();
      if (index >= 0 && index < buckets.length) buckets[index][event.kind] += 1;
    }
    const max = Math.max(1, ...buckets.map((bucket) => bucket.created + bucket.modified));
    const labels = period === "day" ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
      : period === "week" ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : period === "month" ? Array.from({ length: bucketCount }, (_, i) => String(i + 1))
      : ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
    if (chartStyle === "bars") {
      const chart = card.createDiv({ cls: `vp-chart vp-chart-${period} vp-chart-bars`, attr: { role: "img", "aria-label": `График активности за период: ${periodCaption(period)}` } });
      buckets.forEach((bucket, index) => {
        const column = chart.createDiv({ cls: "vp-chart-column", attr: { "aria-label": `${labels[index]}: ${bucket.created} создано, ${bucket.modified} изменено` } });
        const stack = column.createDiv({ cls: "vp-chart-stack" });
        const totalHeight = (bucket.created + bucket.modified) / max * 100;
        const createdHeight = bucket.created + bucket.modified === 0 ? 0 : bucket.created / (bucket.created + bucket.modified) * 100;
        stack.setCssProps({ "--vp-stack-height": `${Math.max(2, totalHeight)}%`, "--vp-created-height": `${createdHeight}%` });
        column.createSpan({ text: labels[index], cls: "vp-chart-label" });
      });
    } else {
      const plot = card.createDiv({ cls: `vp-chart-plot vp-chart-${chartStyle}`, attr: { role: "img", "aria-label": `График активности за период: ${periodCaption(period)}` } });
      
      const svg = plot.createSvg("svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
      
      for (const y of [12, 32, 52, 72, 92]) {
        const guide = svg.createSvg("line");
        guide.setAttribute("x1", "0"); guide.setAttribute("x2", "100");
        guide.setAttribute("y1", String(y)); guide.setAttribute("y2", String(y));
        guide.setAttribute("class", "vp-chart-guide");
      }
      const pointString = (key: "created" | "modified") => buckets.map((bucket, index) => {
        const x = buckets.length === 1 ? 50 : index / (buckets.length - 1) * 100;
        const y = 92 - bucket[key] / max * 80;
        return `${x},${y}`;
      }).join(" ");
      if (chartStyle === "area") {
        const points = pointString("created");
        const area = svg.createSvg("polygon");
        area.setAttribute("points", `0,92 ${points} 100,92`);
        area.setAttribute("class", "vp-chart-area-fill");
      }
      for (const key of ["modified", "created"] as const) {
        const line = svg.createSvg("polyline");
        line.setAttribute("points", pointString(key));
        line.setAttribute("class", `vp-chart-line vp-chart-line-${key}`);
      }
      const xLabels = card.createDiv({ cls: `vp-chart-x-labels vp-chart-x-labels-${period}` });
      for (const label of labels) xLabels.createSpan({ text: label });
    }
    const legend = card.createDiv({ cls: "vp-legend" });
    legend.createSpan({ cls: "vp-legend-created" }); legend.createSpan({ text: "Создано" });
    legend.createSpan({ cls: "vp-legend-modified" }); legend.createSpan({ text: "Изменено" });
    if (events.length === 0) card.createEl("p", { text: "За выбранный период активности нет.", cls: "vp-helper" });

}

export function renderBreakdown(card: HTMLElement, notes: NoteRecord[], kind: "folder" | "tag"): void {
    const title = kind === "folder" ? "Папки" : "Теги";
    const counts = new Map<string, number>();
    for (const note of notes) {
      const values = kind === "folder" ? [note.folder] : note.tags;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const section = card.createDiv({ cls: "vp-breakdown" });
    section.createEl("h3", { text: title });
    if (sorted.length === 0) {
      section.createEl("p", { text: "Нет данных для выбранных фильтров.", cls: "vp-helper" });
      return;
    }
    const max = sorted[0][1];
    for (const [name, count] of sorted) {
      const row = section.createDiv({ cls: "vp-breakdown-row" });
      row.createSpan({ text: name, cls: "vp-breakdown-name" });
      const track = row.createDiv({ cls: "vp-breakdown-track" });
      track.createDiv({ cls: "vp-breakdown-fill" }).setCssProps({ "--vp-fill-width": `${count / max * 100}%` });
      row.createSpan({ text: String(count), cls: "vp-breakdown-count" });
    }

}

export function renderVaultHeatmap(card: HTMLElement, events: ActivityEvent[]): void {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yearStart = new Date(today);
  yearStart.setDate(yearStart.getDate() - 364);
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - 364);
  rangeStart.setDate(rangeStart.getDate() - rangeStart.getDay());
  const firstVisibleDate = toDateKey(rangeStart);
  const todayKey = toDateKey(today);

  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.date >= firstVisibleDate && event.date <= todayKey) counts.set(event.date, (counts.get(event.date) ?? 0) + 1);
  }
  const activeDays = new Set([...counts.keys()].filter((date) => date >= toDateKey(yearStart)));
  let currentStreak = 0;
  const streakCursor = new Date(today);
  if (!activeDays.has(toDateKey(streakCursor))) streakCursor.setDate(streakCursor.getDate() - 1);
  while (activeDays.has(toDateKey(streakCursor))) {
    currentStreak++;
    streakCursor.setDate(streakCursor.getDate() - 1);
  }
  let longestStreak = 0;
  let runningStreak = 0;
  for (let offset = 0; offset <= 364; offset++) {
    const date = new Date(today);
    date.setDate(date.getDate() - (364 - offset));
    if (activeDays.has(toDateKey(date))) {
      runningStreak++;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else runningStreak = 0;
  }

  const summary = card.createDiv({ cls: "vp-heatmap-summary" });
  summary.createEl("strong", { text: `Текущая серия: ${currentStreak} дн.` });
  summary.createSpan({ text: `Лучшая: ${longestStreak} дн. · Активных дней: ${activeDays.size}` });

  const scroller = card.createDiv({ cls: "vp-heatmap-scroll" });
  const heatmap = scroller.createDiv({ cls: "vp-heatmap", attr: { role: "img", "aria-label": "Активность хранилища за последние 365 дней" } });
  const labels = heatmap.createDiv({ cls: "vp-heatmap-weekdays", attr: { "aria-hidden": "true" } });
  for (const label of ["", "Пн", "", "Ср", "", "Пт", ""]) labels.createSpan({ text: label });

  const calendar = heatmap.createDiv({ cls: "vp-heatmap-calendar" });
  const monthRow = calendar.createDiv({ cls: "vp-heatmap-months", attr: { "aria-hidden": "true" } });
  const grid = calendar.createDiv({ cls: "vp-heatmap-grid" });
  let lastMonth = -1;
  let weekColumn = 0;
  const date = new Date(rangeStart);
  for (let index = 0; index < 371; index++, date.setDate(date.getDate() + 1)) {
    const dateKey = toDateKey(date);
    const afterToday = date > today;
    if (date.getDay() === 0 && !afterToday) {
      weekColumn++;
      if (date.getMonth() !== lastMonth) {
        const month = monthRow.createSpan({ text: new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(date) });
        month.style.gridColumnStart = String(weekColumn);
        lastMonth = date.getMonth();
      }
    }
    const count = counts.get(dateKey) ?? 0;
    const level = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
    const day = grid.createDiv({ cls: `vp-heatmap-day${afterToday ? " is-future" : ""}`, attr: {
      "data-level": String(level),
      "aria-label": `${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date)}: ${count} событий`,
      title: `${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date)} · ${count} событий`,
    } });
    if (afterToday) day.setAttribute("aria-hidden", "true");
  }
  const legend = card.createDiv({ cls: "vp-heatmap-legend", attr: { "aria-hidden": "true" } });
  legend.createSpan({ text: "Меньше" });
  for (let level = 0; level <= 4; level++) legend.createDiv({ cls: "vp-heatmap-day", attr: { "data-level": String(level) } });
  legend.createSpan({ text: "Больше" });
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
