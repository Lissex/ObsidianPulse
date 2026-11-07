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
