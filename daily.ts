import { App, Modal, Notice, TFile, TFolder, Vault } from "obsidian";
import { ActivityEvent } from "./stats";

export type DailyBlockId = "plan" | "events" | "activity" | "completed" | "review";

export interface DailyBlock {
  id: DailyBlockId;
  title: string;
}

export const DAILY_BLOCKS: DailyBlock[] = [
  { id: "plan", title: "План дня" },
  { id: "events", title: "События" },
  { id: "activity", title: "Активность в заметках" },
  { id: "completed", title: "Выполненные задачи" },
  { id: "review", title: "Итог дня" },
];

export function dailyDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildDailyPath(folder: string, format: string, date = new Date()): string {
  const datePart = format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, String(date.getMonth() + 1).padStart(2, "0"))
    .replace(/DD/g, String(date.getDate()).padStart(2, "0"));
  const base = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `${base ? `${base}/` : ""}${datePart}.md`;
}

export function buildDailyContent(
  date: Date,
  blocks: DailyBlockId[],
  events: ActivityEvent[],
  existing = "",
): { content: string; appendedTitles: string[] } {
  const key = dailyDateKey(date);
  const titles = new Map<DailyBlockId, string>(DAILY_BLOCKS.map((block) => [block.id, block.title]));
  
  const existingHeadings = new Set<string>();
  const headingRegex = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingRegex.exec(existing)) !== null) {
    if (headingMatch[1]) {
      existingHeadings.add(headingMatch[1].trim().toLocaleLowerCase());
    }
  }

  const selected = blocks.filter((id) => {
    const title = titles.get(id);
    return title !== undefined && !existingHeadings.has(title.toLocaleLowerCase());
  });

  const sections = selected.map((id) => {
    const title = titles.get(id) || "";
    if (id === "plan") return `## ${title}\n\n- [ ] `;
    if (id === "events") return `## ${title}\n\n- `;
    if (id === "completed") return `## ${title}\n\n- [ ] `;
    if (id === "review") return `## ${title}\n\n`;
    const dayEvents = events.filter((event) => event.date === key).sort((a, b) => a.timestamp - b.timestamp);
    const activity = dayEvents.length
      ? dayEvents.map((event) => `- ${event.kind === "created" ? "Создана" : "Изменена"}: [[${event.path.replace(/\.md$/i, "")}]]`).join("\n")
      : "- За сегодня записей нет.";
    return `## ${title}\n\n${activity}`;
  });

  const appendedTitles = selected.map((id) => titles.get(id) || "");
  
  if (existing) {
    const addition = sections.join("\n\n").trim();
    const separator = !existing ? "" : existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return {
      content: addition ? `${existing}${separator}${addition}\n` : existing,
      appendedTitles,
    };
  }
  
  const frontmatter = `---\ntype: daily\ndate: ${key}\n---`;
  const heading = `# ${key}`;
  return { content: `${frontmatter}\n\n${heading}${sections.length ? `\n\n${sections.join("\n\n")}` : ""}\n`, appendedTitles };
}

export interface DailySummary {
  completedTasks: string[];
  events: string[];
}

export function parseDailySummary(content: string): DailySummary {
  const completedTasks: string[] = [];
  const taskRegex = /^\s*[-*]\s+\[x\]\s+(.+?)\s*$/gim;
  let taskMatch: RegExpExecArray | null;
  while ((taskMatch = taskRegex.exec(content)) !== null) {
    if (taskMatch[1]) {
      completedTasks.push(taskMatch[1]);
    }
  }

  const lines = content.split(/\r?\n/);
  const events: string[] = [];
  let inEvents = false;
  
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch && headingMatch[1]) {
      inEvents = headingMatch[1].trim().toLocaleLowerCase() === "события";
      continue;
    }
    if (!inEvents) continue;
    const itemMatch = line.match(/^\s*[-*]\s+(.*?)\s*$/);
    if (itemMatch && itemMatch[1]) {
      events.push(itemMatch[1]);
    }
  }
  return { completedTasks, events };
}

export class DailyNotePreviewModal extends Modal {
  constructor(
    app: App,
    private vault: Vault,
    private path: string,
    private file: TFile | null,
    private original: string,
    private proposed: string,
    private appendedTitles: string[],
    private onSaved: (file: TFile) => void,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.file ? "Предпросмотр дополнения" : "Предпросмотр дневной заметки");
    contentEl.createEl("p", { text: this.file
      ? "Исходный текст будет сохранён. В конец добавятся только разделы, которых ещё нет."
      : "Будет создан новый файл. До подтверждения заметка не изменяется." });
    contentEl.createEl("p", { text: this.path, cls: "vp-daily-path" });
    contentEl.createEl("p", { text: this.appendedTitles.length
      ? `Добавляемые разделы: ${this.appendedTitles.join(", ")}.`
      : "Все выбранные разделы уже есть. Содержимое файла не изменится.", cls: "vp-helper" });
    const preview = contentEl.createEl("pre", { cls: "vp-daily-preview" });
    preview.setText(this.proposed);
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Отмена" });
    cancel.addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { text: this.file ? "Добавить разделы" : "Создать заметку", cls: "mod-cta" });
    confirm.disabled = this.file !== null && this.appendedTitles.length === 0;
    confirm.addEventListener("click", () => { void this.commit(); });
  }

  onClose(): void { this.contentEl.empty(); }

  private async commit(): Promise<void> {
    try {
      let result: TFile;
      if (this.file) {
        let stale = false;
        await this.vault.process(this.file, (current) => {
          if (current !== this.original) { stale = true; return current; }
          return this.proposed;
        });
        if (stale) {
          new Notice("Заметка изменилась после предпросмотра. Закройте окно и откройте предпросмотр заново.");
          return;
        }
        result = this.file;
      } else {
        await this.ensureParentFolder(this.path);
        const collision = this.vault.getAbstractFileByPath(this.path);
        if (collision) {
          new Notice("Файл с таким путём уже существует. Откройте его и подготовьте дополнение.");
          return;
        }
        result = await this.vault.create(this.path, this.proposed);
      }
      this.close();
      this.onSaved(result);
    } catch (error: unknown) {
      new Notice(`Не удалось сохранить дневную заметку: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parent = path.split("/").slice(0, -1).join("/");
    if (!parent) return;
    let current = "";
    for (const segment of parent.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`Папка ${current} занята файлом.`);
      await this.vault.createFolder(current);
    }
  }
}
