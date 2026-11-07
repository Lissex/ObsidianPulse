import { App, Modal, Notice, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { ActivityEvent, NoteRecord } from "./stats";
import { TaskRecord } from "./tasks";

export type PlanningPeriod = "week" | "month" | "year";

export interface PeriodInfo {
  period: PlanningPeriod;
  key: string;
  label: string;
  start: Date;
  end: Date;
  year: number;
  week: number;
  month: number;
  day: number;
}

export const DEFAULT_PERIOD_TEMPLATES: Record<PlanningPeriod, string> = {
  week: `---
type: weekly-plan
period: {{period}}
---
# План на неделю {{period}}

Период: {{start}} — {{end}}

## Цели
- [ ] 

## План

## Итоги

## Факты периода
<!-- vault-pulse:stats:start -->
{{stats}}
<!-- vault-pulse:stats:end -->

## Задачи со сроком в периоде
<!-- vault-pulse:tasks:start -->
{{tasks}}
<!-- vault-pulse:tasks:end -->

## Заметки и проекты
<!-- vault-pulse:notes:start -->
{{notes}}
<!-- vault-pulse:notes:end -->`,
  month: `---
type: monthly-plan
period: {{period}}
---
# План на месяц {{period}}

Период: {{start}} — {{end}}

## Цели
- [ ] 

## План

## Итоги

## Факты периода
<!-- vault-pulse:stats:start -->
{{stats}}
<!-- vault-pulse:stats:end -->

## Задачи со сроком в периоде
<!-- vault-pulse:tasks:start -->
{{tasks}}
<!-- vault-pulse:tasks:end -->

## Заметки и проекты
<!-- vault-pulse:notes:start -->
{{notes}}
<!-- vault-pulse:notes:end -->`,
  year: `---
type: yearly-plan
period: {{period}}
---
# План на год {{period}}

## Направления и цели
- [ ] 

## Ключевые проекты

## План по периодам

## Итоги года

## Факты периода
<!-- vault-pulse:stats:start -->
{{stats}}
<!-- vault-pulse:stats:end -->

## Задачи со сроком в периоде
<!-- vault-pulse:tasks:start -->
{{tasks}}
<!-- vault-pulse:tasks:end -->

## Заметки и проекты
<!-- vault-pulse:notes:start -->
{{notes}}
<!-- vault-pulse:notes:end -->`,
};

export function getPeriodInfo(period: PlanningPeriod, date = new Date(), weekStartsMonday = true): PeriodInfo {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  let week = 0;
  if (period === "week") {
    const offset = weekStartsMonday ? (start.getDay() + 6) % 7 : start.getDay();
    start.setDate(start.getDate() - offset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    week = isoWeekNumber(start);
  } else if (period === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  }
  const year = period === "week" ? isoWeekYear(start) : start.getFullYear();
  const key = period === "week" ? `${year}-W${String(week).padStart(2, "0")}`
    : period === "month" ? `${year}-${String(start.getMonth() + 1).padStart(2, "0")}` : String(year);
  const label = period === "week" ? `Неделя ${key}` : period === "month" ? `Месяц ${key}` : `Год ${key}`;
  return { period, key, label, start, end, year, week, month: start.getMonth() + 1, day: start.getDate() };
}

export function buildPeriodPath(folder: string, format: string, info: PeriodInfo): string {
  const marker = "\u0001";
  const name = format.replace(/\[W\]/gi, marker)
    .replace(/YYYY/g, String(info.year))
    .replace(/WW/g, String(info.week).padStart(2, "0"))
    .replace(/MM/g, String(info.month).padStart(2, "0"))
    .replace(/DD/g, String(info.day).padStart(2, "0"))
    .split(marker).join("W");
  const base = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `${base ? `${base}/` : ""}${name}.md`;
}

export function renderPeriodTemplate(template: string, info: PeriodInfo, events: ActivityEvent[], tasks: TaskRecord[], notes: NoteRecord[]): string {
  const periodEvents = events.filter((event) => event.timestamp >= info.start.getTime() && event.timestamp <= info.end.getTime());
  const created = periodEvents.filter((event) => event.kind === "created").length;
  const modified = periodEvents.filter((event) => event.kind === "modified").length;
  const activePaths = new Set(periodEvents.map((event) => event.path));
  const startKey = dateKey(info.start);
  const endKey = dateKey(info.end);
  const periodTasks = tasks.filter((task) => task.due !== null && task.due >= startKey && task.due <= endKey);
  const tasksText = periodTasks.length
    ? periodTasks.map((task) => `- [${task.completed ? "x" : " "}] ${task.text} 📅 ${task.due} · [[${task.path.replace(/\.md$/i, "")}]]`).join("\n")
    : "- Задач со сроком в этом периоде пока нет.";
  const notePaths = [...activePaths].sort((a, b) => a.localeCompare(b)).slice(0, 30);
  const noteLinks = notePaths.length ? notePaths.map((path) => `- [[${path.replace(/\.md$/i, "")}]]`).join("\n") : "- Активных заметок в этом периоде пока нет.";
  const folders = new Map<string, number>();
  for (const path of activePaths) {
    const slash = path.lastIndexOf("/");
    const folder = slash === -1 ? "/" : path.slice(0, slash);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const projectList = [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([folder, count]) => `- ${folder} — ${count} активных заметок`).join("\n") || "- Нет данных по папкам.";
  const summary = [
    `- Создано заметок: ${created}`,
    `- Изменено заметок: ${modified}`,
    `- Активных заметок: ${activePaths.size}`,
    `- Задач со сроком в периоде: ${periodTasks.length} (${periodTasks.filter((task) => task.completed).length} отмечены выполненными)`,
    `- Заметок в хранилище: ${notes.length}`,
  ].join("\n");
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" });
  const values: Record<string, string> = {
    period: info.key,
    start: dateFormat.format(info.start),
    end: dateFormat.format(info.end),
    stats: summary,
    tasks: tasksText,
    notes: `${projectList}\n\n### Активные заметки\n${noteLinks}`,
    projects: projectList,
  };
  return template.replace(/\{\{(period|start|end|stats|tasks|notes|projects)\}\}/g, (_match, key: string) => values[key] ?? "");
}

export function mergePeriodReview(existing: string, rendered: string): { content: string; added: string[] } {
  if (!existing) {
    const initialHeadings: string[] = [];
    const headingRegex = /^##\s+(.+?)\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(rendered)) !== null) {
      if (match[1]) initialHeadings.push(match[1]);
    }
    return { content: `${rendered.trim()}\n`, added: initialHeadings };
  }
  let updated = existing;
  const changedBlocks: string[] = [];
  const blockLabels: Record<string, string> = { stats: "Факты периода", tasks: "Задачи со сроком", notes: "Заметки и проекты" };
  
  for (const key of ["stats", "tasks", "notes"]) {
    const pattern = new RegExp(`<!-- vault-pulse:${key}:start -->([\\s\\S]*?)<!-- vault-pulse:${key}:end -->`);
    const oldBlock = pattern.exec(updated);
    const newBlock = pattern.exec(rendered);
    if (!oldBlock || !newBlock || oldBlock[1] === newBlock[1]) continue;
    updated = updated.replace(pattern, `<!-- vault-pulse:${key}:start -->${newBlock[1]}<!-- vault-pulse:${key}:end -->`);
    changedBlocks.push(blockLabels[key] || key);
  }
  
  const existingHeadings = new Set<string>();
  const headingRegexCheck = /^##\s+(.+?)\s*$/gm;
  let checkMatch: RegExpExecArray | null;
  while ((checkMatch = headingRegexCheck.exec(updated)) !== null) {
    if (checkMatch[1]) existingHeadings.add(checkMatch[1].trim().toLocaleLowerCase());
  }

  const headings: RegExpExecArray[] = [];
  const headingRegexRendered = /^##\s+(.+?)\s*$/gm;
  let renderedMatch: RegExpExecArray | null;
  while ((renderedMatch = headingRegexRendered.exec(rendered)) !== null) {
    headings.push(renderedMatch);
  }

  if (!headings.length) return { content: updated, added: changedBlocks };
  const additions: string[] = [];
  const added: string[] = [];
  
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const title = heading[1] ? heading[1].trim() : "";
    if (!title || existingHeadings.has(title.toLocaleLowerCase())) continue;
    
    const from = heading.index;
    const nextHeading = headings[index + 1];
    const to = nextHeading ? nextHeading.index : rendered.length;
    
    additions.push(rendered.slice(from, to).trim());
    added.push(title);
  }
  
  if (!additions.length) return { content: updated, added: changedBlocks };
  const separator = updated.endsWith("\n\n") ? "" : updated.endsWith("\n") ? "\n" : "\n\n";
  return { content: `${updated}${separator}${additions.join("\n\n")}\n`, added: [...changedBlocks, ...added] };
}

export class PeriodPlanPreviewModal extends Modal {
  constructor(app: App, private vault: Vault, private path: string, private file: TFile | null,
    private original: string, private proposed: string, private addedSections: string[], private onSaved: (file: TFile) => void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.file ? "Предпросмотр дополнения плана" : "Предпросмотр плана");
    contentEl.createEl("p", { text: this.file
      ? "Исходный текст сохранится. Отсутствующие разделы добавятся, а размеченные блоки статистики обновятся."
      : "План будет создан как обычная Markdown-заметка после подтверждения." });
    contentEl.createEl("p", { text: this.path, cls: "vp-daily-path" });
    contentEl.createEl("p", { text: this.addedSections.length ? `Будут добавлены или обновлены: ${this.addedSections.join(", ")}.` : "План уже содержит все разделы и актуальные сводки.", cls: "vp-helper" });
    contentEl.createEl("pre", { cls: "vp-daily-preview" }).setText(this.proposed);
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Отмена" }).addEventListener("click", () => this.close());
    const save = buttons.createEl("button", { text: this.file ? "Добавить разделы" : "Создать план", cls: "mod-cta" });
    save.disabled = this.file !== null && this.addedSections.length === 0;
    save.addEventListener("click", () => { void this.commit(); });
  }

  onClose(): void { this.contentEl.empty(); }

  private async commit(): Promise<void> {
    try {
      let file: TFile;
      if (this.file) {
        let stale = false;
        await this.vault.process(this.file, (current) => {
          if (current !== this.original) { stale = true; return current; }
          return this.proposed;
        });
        if (stale) { new Notice("Заметка изменилась после предпросмотра. Откройте предпросмотр заново."); return; }
        file = this.file;
      } else {
        await ensureFolders(this.vault, this.path);
        if (this.vault.getAbstractFileByPath(this.path)) { new Notice("Файл с таким путём уже существует. Откройте его и подготовьте дополнение."); return; }
        file = await this.vault.create(this.path, this.proposed);
      }
      this.close();
      this.onSaved(file);
    } catch (error: unknown) {
      new Notice(`Не удалось сохранить план: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function ensureFolders(vault: Vault, path: string): Promise<void> {
  const parent = path.split("/").slice(0, -1).join("/");
  let current = "";
  for (const segment of parent.split("/").filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    const existing = vault.getAbstractFileByPath(current) as TAbstractFile | null;
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`Папка ${current} занята файлом.`);
    await vault.createFolder(current);
  }
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function isoWeekYear(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  return target.getUTCFullYear();
}