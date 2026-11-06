import { App, TAbstractFile, TFile } from "obsidian";

export type StatsPeriod = "day" | "week" | "month" | "year";
export type ActivityKind = "created" | "modified";
export type ActivityClassification = "normal" | "import" | "sync" | "bulk";

export interface NoteRecord {
  path: string;
  createdAt: number;
  modifiedAt: number;
  folder: string;
  tags: string[];
  links: number;
}

export interface ActivityEvent {
  id: string;
  date: string;
  timestamp: number;
  path: string;
  folder: string;
  tags: string[];
  kind: ActivityKind;
  classification?: ActivityClassification;
}

interface StoredStats {
  version: 1;
  initializedAt: number;
  notes: Record<string, NoteRecord>;
  events: ActivityEvent[];
}

export interface StatsSnapshot {
  notes: NoteRecord[];
  events: ActivityEvent[];
  ready: boolean;
  error: string | null;
}

const DATA_FOLDER = "Vault Pulse";
const DATA_PATH = `${DATA_FOLDER}/activity.json`;

export class StatsService {
  private data: StoredStats = { version: 1, initializedAt: 0, notes: {}, events: [] };
  private eventIds = new Set<string>();
  private ready = false;
  private error: string | null = null;
  private pending: Array<() => void> = [];
  private saveTimer: number | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private app: App, private onUpdate: () => void) {}

  async start(): Promise<void> {
    try {
      await this.load();
      await this.indexVault();
      this.ready = true;
      for (const work of this.pending.splice(0)) work();
      this.queueSave();
      this.onUpdate();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.ready = true;
      this.onUpdate();
    }
  }

  getSnapshot(): StatsSnapshot {
    return {
      notes: Object.values(this.data.notes),
      events: this.data.events,
      ready: this.ready,
      error: this.error,
    };
  }

  classifyEvents(ids: string[], classification: ActivityClassification): void {
    const selected = new Set(ids);
    for (const event of this.data.events) if (selected.has(event.id)) event.classification = classification;
    this.queueSave();
    this.onUpdate();
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist(JSON.stringify(this.data));
  }

  onCreate(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.whenReady(() => this.recordCreate(file));
  }

  onModify(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.whenReady(() => this.recordModify(file));
  }

  onDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.whenReady(() => {
      delete this.data.notes[file.path];
      this.queueSave();
      this.onUpdate();
    });
  }

  onRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    this.whenReady(() => {
      const old = this.data.notes[oldPath];
      if (!old) return;
      delete this.data.notes[oldPath];
      this.data.notes[file.path] = { ...old, path: file.path, folder: this.folderFor(file.path) };
      this.refreshMetadata(file);
      this.queueSave();
      this.onUpdate();
    });
  }

  onMetadataChanged(file: TFile): void {
    if (file.extension.toLowerCase() !== "md") return;
    this.whenReady(() => {
      if (!this.data.notes[file.path]) return;
      this.refreshMetadata(file);
      this.queueSave();
      this.onUpdate();
    });
  }

  private whenReady(work: () => void): void {
    if (!this.ready) this.pending.push(work);
    else work();
  }

  private async load(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(DATA_PATH);
    if (file instanceof TFile) {
      const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<StoredStats>;
      if (parsed.version !== 1 || !parsed.notes || !Array.isArray(parsed.events)) {
        throw new Error("Файл статистики имеет неизвестный формат. Исходный файл сохранён без изменений.");
      }
      this.data = {
        version: 1,
        initializedAt: typeof parsed.initializedAt === "number" ? parsed.initializedAt : Date.now(),
        notes: parsed.notes,
        events: parsed.events,
      };
      this.eventIds = new Set(this.data.events.map((event) => event.id));
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(DATA_FOLDER);
    if (!folder) await this.app.vault.createFolder(DATA_FOLDER);
    else if (!("children" in folder)) throw new Error(`Путь ${DATA_FOLDER} занят файлом.`);
    await this.app.vault.create(DATA_PATH, JSON.stringify(this.data, null, 2));
  }

  private async indexVault(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const present = new Set<string>();
    let touched = false;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      present.add(file.path);
      const previous = this.data.notes[file.path];
      const record = this.makeRecord(file);
      if (!previous) {
        this.data.notes[file.path] = record;
        this.addEvent(file, "created", file.stat.ctime);
        if (file.stat.mtime - file.stat.ctime > 5_000) this.addEvent(file, "modified", file.stat.mtime);
        touched = true;
      } else {
        this.data.notes[file.path] = record;
        if (previous.modifiedAt !== file.stat.mtime) {
          this.addEvent(file, "modified", file.stat.mtime || Date.now());
          touched = true;
        }
      }
      if (index > 0 && index % 250 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    for (const path of Object.keys(this.data.notes)) {
      if (!present.has(path)) { delete this.data.notes[path]; touched = true; }
    }
    if (!this.data.initializedAt) {
      this.data.initializedAt = Date.now();
      touched = true;
    }
    if (touched) this.queueSave();
  }

  private recordCreate(file: TFile): void {
    const record = this.makeRecord(file);
    this.data.notes[file.path] = record;
    this.addEvent(file, "created", file.stat.ctime || Date.now());
    this.queueSave();
    this.onUpdate();
  }

  private recordModify(file: TFile): void {
    const previous = this.data.notes[file.path];
    const record = this.makeRecord(file);
    this.data.notes[file.path] = record;
    if (!previous || previous.modifiedAt !== file.stat.mtime) {
      this.addEvent(file, "modified", file.stat.mtime || Date.now());
      this.queueSave();
      this.onUpdate();
    }
  }

  private makeRecord(file: TFile): NoteRecord {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = new Set((cache?.tags ?? []).map((item) => item.tag));
    const frontmatterTags = cache?.frontmatter?.tags;
    if (typeof frontmatterTags === "string") {
      for (const tag of frontmatterTags.split(/[ ,]+/)) if (tag.trim()) tags.add(tag.startsWith("#") ? tag : `#${tag}`);
    } else if (Array.isArray(frontmatterTags)) {
      for (const tag of frontmatterTags) if (typeof tag === "string" && tag.trim()) tags.add(tag.startsWith("#") ? tag : `#${tag}`);
    }
    const links = (cache?.links?.length ?? 0) + (cache?.embeds?.length ?? 0);
    return {
      path: file.path,
      createdAt: file.stat.ctime,
      modifiedAt: file.stat.mtime,
      folder: this.folderFor(file.path),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
      links,
    };
  }

  private refreshMetadata(file: TFile): void {
    const old = this.data.notes[file.path];
    this.data.notes[file.path] = { ...this.makeRecord(file), createdAt: old.createdAt };
  }

  private addEvent(file: TFile, kind: ActivityKind, timestamp: number): void {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const date = this.dateKey(timestamp);
    const id = `${date}|${kind}|${file.path}`;
    if (this.eventIds.has(id)) return;
    const record = this.makeRecord(file);
    this.data.events.push({ id, date, timestamp, path: file.path, folder: record.folder, tags: record.tags, kind });
    this.eventIds.add(id);
  }

  private folderFor(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "/" : path.slice(0, slash);
  }

  private dateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private queueSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persist(JSON.stringify(this.data));
    }, 500);
  }

  private async persist(serialized: string): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      const file = this.app.vault.getAbstractFileByPath(DATA_PATH);
      if (file instanceof TFile) await this.app.vault.modify(file, serialized);
    }).catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : String(error);
      this.onUpdate();
    });
    await this.saveQueue;
  }
}

export function getDateRange(period: StatsPeriod, now = new Date(), weekStartsMonday = true): { start: Date; end: Date; bucketCount: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  let bucketCount: number;
  if (period === "day") {
    start.setHours(0, 0, 0, 0);
    bucketCount = 24;
  } else if (period === "week") {
    start.setHours(0, 0, 0, 0);
    const day = weekStartsMonday ? (start.getDay() + 6) % 7 : start.getDay();
    start.setDate(start.getDate() - day);
    bucketCount = 7;
  } else if (period === "month") {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    bucketCount = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  } else {
    start.setHours(0, 0, 0, 0);
    start.setMonth(0, 1);
    bucketCount = 12;
  }
  return { start, end, bucketCount };
}

export function eventInPeriod(event: ActivityEvent, period: StatsPeriod, now = new Date(), weekStartsMonday = true): boolean {
  const { start, end } = getDateRange(period, now, weekStartsMonday);
  return event.timestamp >= start.getTime() && event.timestamp <= end.getTime();
}

export function findActivityBursts(events: ActivityEvent[], minimum = 20, windowMs = 120_000): ActivityEvent[][] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const bursts: ActivityEvent[][] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].timestamp - sorted[start].timestamp <= windowMs) end++;
    if (end - start >= minimum) {
      bursts.push(sorted.slice(start, end));
      start = end;
    } else {
      start++;
    }
  }
  return bursts;
}
