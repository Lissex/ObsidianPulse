import { Notice, PluginSettingTab, SecretComponent, Setting, SettingDefinitionItem, setIcon } from "obsidian";
import { DAILY_BLOCKS } from "./daily";
import { PlanningPeriod } from "./planning";
import { timeToMinutes } from "./schedule";

import type VaultScopePlugin from "./main";
import { PANELS, Period, Density, PanelStyle, ChartStyle, AccentPalette, TaskDestination, TaskGrouping } from "./settings-model";
export class VaultScopeSettingTab extends PluginSettingTab {
  constructor(app: VaultScopePlugin["app"], private plugin: VaultScopePlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: "group",
      name: "VaultScope",
      items: [{
        name: "Настройки панели VaultScope",
        desc: "Внешний вид, тема Obsidianite, классическая тёмная тема, классическая светлая тема, стиль карточек, график, плотность, период, исключённые папки и теги, дневные заметки, формат даты, блоки дневника, задачи, сроки, приоритеты, расписание, рабочие часы, планы недели, месяца и года, шаблоны, обучение, Stepik, Udemy, GitHub, токен, репозитории, синхронизация, видимость и порядок панелей.",
        aliases: ["тема", "палитра", "цвет", "задача", "расписание", "дневник", "план", "курс", "коммит", "папка", "тег"],
        render: (setting) => {
          // The declarative renderer owns this Setting row. Render the custom
          // settings interface inside it; its parent may not exist yet here.
          setting.settingEl.empty();
          setting.settingEl.addClass("vp-settings-shell");
          const host = setting.settingEl.createDiv({ cls: "vp-setting-content" });
          this.renderSettings(host);
          return () => setting.settingEl.empty();
        },
      }],
    }];
  }

  private renderSettings(containerEl: HTMLElement): void {
    containerEl.empty();

    const hero = containerEl.createDiv({ cls: "vp-settings-hero" });
    const heroCopy = createDiv({ cls: "vp-settings-hero-copy" });
    hero.appendChild(heroCopy);
    heroCopy.createEl("span", { text: "VAULTSCOPE · CONTROL CENTER", cls: "vp-settings-eyebrow" });
    new Setting(heroCopy).setName("Настройте своё пространство").setHeading();
    heroCopy.createEl("p", { text: "Тихий порядок в заметках начинается с удобных инструментов. Выберите оформление и настройте рабочий процесс под себя." });
    this.renderThemePicker(hero);

    const toolbar = containerEl.createDiv({ cls: "vp-settings-toolbar" });
    const searchWrap = toolbar.createDiv({ cls: "vp-settings-search" });
    const searchIcon = searchWrap.createSpan({ cls: "vp-settings-search-icon", attr: { "aria-hidden": "true" } });
    setIcon(searchIcon, "search");
    const search = searchWrap.createEl("input", { attr: { type: "search", placeholder: "Найти настройку…", "aria-label": "Найти настройку" } });
    const clear = toolbar.createEl("button", { text: "Очистить", cls: "vp-settings-clear" });
    clear.type = "button";
    clear.hidden = true;
    
    new Setting(containerEl).setName("Внешний вид").setHeading();
    new Setting(containerEl).setName("Стиль панелей").setDesc("Выберите оформление карточек дашборда.")
      .addDropdown((dropdown) => dropdown.addOption("mac", "MacBook · стекло")
        .addOption("minimal", "Минимализм").addOption("outlined", "Контурный")
        .setValue(this.plugin.settings.panelStyle)
        .onChange(async (value) => { this.plugin.settings.panelStyle = value as PanelStyle; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Стиль графика активности").setDesc("Столбцы показывают оба типа событий, линия и область — их динамику.")
      .addDropdown((dropdown) => dropdown.addOption("bars", "Столбцы")
        .addOption("line", "Линия").addOption("area", "Область")
        .setValue(this.plugin.settings.chartStyle)
        .onChange(async (value) => { this.plugin.settings.chartStyle = value as ChartStyle; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Плотность панели").setDesc("Свободная раскладка или больше данных на экране.")
      .addDropdown((dropdown) => dropdown.addOption("comfortable", "Свободная").addOption("compact", "Компактная")
        .setValue(this.plugin.settings.density)
        .onChange(async (value) => { this.plugin.settings.density = value as Density; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Основное").setHeading();

    new Setting(containerEl).setName("Период по умолчанию").setDesc("Период, выбранный при открытии панели.")
      .addDropdown((dropdown) => dropdown.addOption("day", "День").addOption("week", "Неделя")
        .addOption("month", "Месяц").addOption("year", "Год")
        .setValue(this.plugin.settings.period)
        .onChange(async (value) => { this.plugin.settings.period = value as Period; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Исключить папки").setDesc("Укажите пути по одному на строку. По умолчанию учитываются все папки, включая архивы и шаблоны.")
      .addTextArea((text) => text.setPlaceholder("Например:\nПриватное\nПроекты/Закрытые")
        .setValue(this.plugin.settings.excludedFolders.join("\n"))
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value.split(/\r?\n/).map((item) => item.trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Исключить теги").setDesc("Укажите теги по одному на строку. Символ # можно не вводить.")
      .addTextArea((text) => text.setPlaceholder("Например:\nprivate\nчерновик")
        .setValue(this.plugin.settings.excludedTags.join("\n"))
        .onChange(async (value) => {
          this.plugin.settings.excludedTags = value.split(/\r?\n/).map((item) => item.trim().replace(/^#/, "")).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Дневная запись").setHeading();
    containerEl.createEl("p", { text: "Заметка создаётся или дополняется только после предпросмотра и вашего подтверждения." });
    new Setting(containerEl).setName("Папка дневных заметок").setDesc("Путь внутри хранилища. Папки будут созданы после подтверждения заметки.")
      .addText((text) => text.setPlaceholder("Планирование/Дни").setValue(this.plugin.settings.dailyFolder)
        .onChange(async (value) => { this.plugin.settings.dailyFolder = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Формат имени файла").setDesc("Поддерживаются YYYY, MM и DD. Например: YYYY-MM-DD.")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.plugin.settings.dailyDateFormat)
        .onChange(async (value) => {
          const format = value.trim();
          if (!format || /[*?:"<>|]/.test(format)) return;
          this.plugin.settings.dailyDateFormat = format;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl).setName("Блоки дневной записи").setHeading();
    containerEl.createEl("p", { text: "Выберите блоки и настройте порядок кнопками со стрелками." });
    for (const [index, blockId] of this.plugin.settings.dailyBlocks.entries()) {
      const block = DAILY_BLOCKS.find((item) => item.id === blockId);
      if (!block) continue;
      const setting = new Setting(containerEl).setName(block.title).setDesc(`Раздел «${block.title}» в дневной заметке.`);
      setting.addToggle((toggle) => toggle.setValue(true).setTooltip("Добавлять этот блок").onChange(async (enabled) => {
        if (!enabled) this.plugin.settings.dailyBlocks = this.plugin.settings.dailyBlocks.filter((id) => id !== blockId);
        else this.plugin.settings.dailyBlocks.push(blockId);
        await this.plugin.saveSettings();
        this.update();
      }));
      setting.addExtraButton((button) => button.setIcon("arrow-up").setTooltip("Переместить выше")
        .setDisabled(index === 0).onClick(async () => { await this.moveDailyBlock(index, -1); }));
      setting.addExtraButton((button) => button.setIcon("arrow-down").setTooltip("Переместить ниже")
        .setDisabled(index === this.plugin.settings.dailyBlocks.length - 1).onClick(async () => { await this.moveDailyBlock(index, 1); }));
    }
    for (const block of DAILY_BLOCKS.filter((item) => !this.plugin.settings.dailyBlocks.includes(item.id))) {
      new Setting(containerEl).setName(block.title).setDesc(`Раздел «${block.title}» выключен.`)
        .addButton((button) => button.setButtonText("Добавить").onClick(async () => {
          this.plugin.settings.dailyBlocks.push(block.id);
          await this.plugin.saveSettings();
          this.update();
        }));
    }

    new Setting(containerEl).setName("Задачи").setHeading();
    new Setting(containerEl).setName("Куда добавлять новые задачи").setDesc("Выберите дневную заметку или отдельный файл со списком задач.")
      .addDropdown((dropdown) => dropdown.addOption("daily", "В дневную заметку").addOption("file", "В отдельный файл")
        .setValue(this.plugin.settings.taskDestination)
        .onChange(async (value) => { this.plugin.settings.taskDestination = value as TaskDestination; await this.plugin.saveSettings(); this.update(); }));
    if (this.plugin.settings.taskDestination === "file") {
      new Setting(containerEl).setName("Файл списка задач").setDesc("Путь к Markdown-файлу. Если файла нет, он будет создан после добавления первой задачи.")
        .addText((text) => text.setPlaceholder("Планирование/Задачи.md").setValue(this.plugin.settings.taskFilePath)
          .onChange(async (value) => { this.plugin.settings.taskFilePath = value.trim().replace(/\\/g, "/"); await this.plugin.saveSettings(); }));
    }
    new Setting(containerEl).setName("Группировать задачи по").setDesc("Порядок группировки списка в панели «Сегодня».")
      .addDropdown((dropdown) => dropdown.addOption("due", "Сроку").addOption("priority", "Приоритету").addOption("folder", "Папке")
        .setValue(this.plugin.settings.taskGrouping)
        .onChange(async (value) => { this.plugin.settings.taskGrouping = value as TaskGrouping; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Показывать выполненные задачи").setDesc("Добавляет группу выполненных задач в список.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showCompletedTasks)
        .onChange(async (value) => { this.plugin.settings.showCompletedTasks = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Задач в каждой группе").setDesc("Ограничивает высоту списка; выберите «Все», чтобы показать весь список.")
      .addDropdown((dropdown) => dropdown.addOption("3", "3").addOption("5", "5").addOption("10", "10").addOption("0", "Все")
        .setValue(String(this.plugin.settings.taskDisplayLimit))
        .onChange(async (value) => { this.plugin.settings.taskDisplayLimit = Number(value); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Расписание").setHeading();
    new Setting(containerEl).setName("Начало рабочего дня").setDesc("Формат 24 часа: HH:MM.")
      .addText((text) => text.setPlaceholder("09:00").setValue(this.plugin.settings.scheduleStart)
        .onChange(async (value) => { await this.updateWorkingHours(value, this.plugin.settings.scheduleEnd); }));
    new Setting(containerEl).setName("Конец рабочего дня").setDesc("Должен быть позже начала рабочего дня.")
      .addText((text) => text.setPlaceholder("17:00").setValue(this.plugin.settings.scheduleEnd)
        .onChange(async (value) => { await this.updateWorkingHours(this.plugin.settings.scheduleStart, value); }));
    new Setting(containerEl).setName("Шаг расписания").setDesc("Размер временного интервала в сетке дня.")
      .addDropdown((dropdown) => dropdown.addOption("15", "15 минут").addOption("30", "30 минут").addOption("60", "60 минут")
        .setValue(String(this.plugin.settings.scheduleSlotMinutes))
        .onChange(async (value) => { this.plugin.settings.scheduleSlotMinutes = Number(value); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Формат времени").setDesc("Как показывать время в расписании.")
      .addDropdown((dropdown) => dropdown.addOption("24h", "24 часа").addOption("12h", "12 часов")
        .setValue(this.plugin.settings.timeFormat)
        .onChange(async (value) => { this.plugin.settings.timeFormat = value as "24h" | "12h"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Первый день недели").setDesc("Используется для недельного периода.")
      .addDropdown((dropdown) => dropdown.addOption("monday", "Понедельник").addOption("sunday", "Воскресенье")
        .setValue(this.plugin.settings.weekStartsMonday ? "monday" : "sunday")
        .onChange(async (value) => { this.plugin.settings.weekStartsMonday = value === "monday"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Переносить незавершённые задачи").setDesc("Показывает действие переноса из вчерашней дневной заметки в сегодняшнюю.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.rolloverTasks)
        .onChange(async (value) => { this.plugin.settings.rolloverTasks = value; await this.plugin.saveSettings(); this.update(); }));

    new Setting(containerEl).setName("Периодические планы").setHeading();
    containerEl.createEl("p", { text: "Шаблоны содержат Markdown-разделы и подстановки {{period}}, {{start}}, {{end}}, {{stats}}, {{tasks}}, {{notes}} и {{projects}}." });
    new Setting(containerEl).setName("Период по умолчанию").setDesc("Какой обзор открывать первым в панели планирования.")
      .addDropdown((dropdown) => dropdown.addOption("week", "Неделя").addOption("month", "Месяц").addOption("year", "Год")
        .setValue(this.plugin.settings.planningDefaultPeriod)
        .onChange(async (value) => { this.plugin.settings.planningDefaultPeriod = value as PlanningPeriod; await this.plugin.saveSettings(); }));
    for (const period of ["week", "month", "year"] as PlanningPeriod[]) {
      const label = period === "week" ? "Неделя" : period === "month" ? "Месяц" : "Год";
      const folderValue = period === "week" ? this.plugin.settings.weeklyFolder : period === "month" ? this.plugin.settings.monthlyFolder : this.plugin.settings.yearlyFolder;
      const formatValue = period === "week" ? this.plugin.settings.weeklyFormat : period === "month" ? this.plugin.settings.monthlyFormat : this.plugin.settings.yearlyFormat;
      const templateValue = period === "week" ? this.plugin.settings.weeklyTemplate : period === "month" ? this.plugin.settings.monthlyTemplate : this.plugin.settings.yearlyTemplate;
      new Setting(containerEl).setName(`Шаблон: ${label.toLocaleLowerCase()}`).setHeading();
      new Setting(containerEl).setName("Папка").setDesc("Путь внутри хранилища.")
        .addText((text) => text.setValue(folderValue).onChange(async (value) => {
          if (period === "week") this.plugin.settings.weeklyFolder = value.trim().replace(/\\/g, "/");
          else if (period === "month") this.plugin.settings.monthlyFolder = value.trim().replace(/\\/g, "/");
          else this.plugin.settings.yearlyFolder = value.trim().replace(/\\/g, "/");
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl).setName("Формат имени файла").setDesc("Неделя: YYYY-[W]WW; месяц: YYYY-MM; год: YYYY. Также доступны DD.")
        .addText((text) => text.setValue(formatValue).onChange(async (value) => {
          if (!value.trim() || /[*?:"<>|]/.test(value)) return;
          if (period === "week") this.plugin.settings.weeklyFormat = value.trim();
          else if (period === "month") this.plugin.settings.monthlyFormat = value.trim();
          else this.plugin.settings.yearlyFormat = value.trim();
          await this.plugin.saveSettings();
        }));
      new Setting(containerEl).setName("Шаблон Markdown").setDesc("Разделы с тем же заголовком в существующем плане повторно не добавляются.")
        .addTextArea((text) => {
          text.inputEl.rows = 10;
          text.inputEl.addClass("vp-plan-template");
          return text.setValue(templateValue).onChange(async (value) => {
            if (period === "week") this.plugin.settings.weeklyTemplate = value;
            else if (period === "month") this.plugin.settings.monthlyTemplate = value;
            else this.plugin.settings.yearlyTemplate = value;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl).setName("Обучение").setHeading();
    containerEl.createEl("p", { text: "Выберите платформы для ручного учёта. Stepik API требует OAuth-доступ к аккаунту; личные данные прогресса Udemy доступны через корпоративные API Udemy Business с административной настройкой. Автоматическое подключение здесь не включено." });
    new Setting(containerEl).setName("Stepik").setDesc("Показывать курсы Stepik в списке обучения.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningStepikEnabled)
        .onChange(async (value) => { this.plugin.settings.learningStepikEnabled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Udemy").setDesc("Показывать курсы Udemy в списке обучения.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningUdemyEnabled)
        .onChange(async (value) => { this.plugin.settings.learningUdemyEnabled = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Другие платформы").setDesc("Включает ручные записи для любых других сервисов.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.learningOtherEnabled)
        .onChange(async (value) => { this.plugin.settings.learningOtherEnabled = value; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("GitHub").setHeading();
    containerEl.createEl("p", { text: "Подключите GitHub аккаунт один раз, затем отметьте репозитории, коммиты которых показывать. Token хранится через SecretStorage Obsidian и не попадает в настройки плагина. Fine-grained token должен иметь доступ к нужным репозиториям и Contents: read." });
    new Setting(containerEl).setName("Personal access token").setDesc("Создайте fine-grained token в GitHub и сохраните его в защищённом хранилище Obsidian.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.githubSecretId)
        .onChange(async (value) => {
          const nextSecretId = value ?? "";
          if (nextSecretId !== this.plugin.settings.githubSecretId) {
            this.plugin.settings.githubAccount = "";
            this.plugin.settings.githubRepositories = [];
            this.plugin.githubAvailableRepositories = [];
            this.plugin.githubCommits = [];
          }
          this.plugin.settings.githubSecretId = nextSecretId;
          await this.plugin.saveSettings();
          this.update();
        }));
    const connectSetting = new Setting(containerEl)
      .setName(this.plugin.settings.githubAccount ? `GitHub аккаунт · @${this.plugin.settings.githubAccount}` : "GitHub аккаунт")
      .setDesc("Проверить подключение и загрузить список доступных репозиториев аккаунта.");
    connectSetting.addButton((button) => button
      .setButtonText(this.plugin.githubSyncing ? "Подключение…" : "Подключить аккаунт")
      .setDisabled(this.plugin.githubSyncing)
      .onClick(async () => { await this.plugin.connectGitHubAccount(); this.update(); }));

    const availableRepositories = this.plugin.githubAvailableRepositories;
    const availableNames = new Set(availableRepositories.map((repository) => repository.fullName));
    const repositoryNames = [...new Set([
      ...availableRepositories.map((repository) => repository.fullName),
      ...this.plugin.settings.githubRepositories.filter((repository) => !availableNames.has(repository)),
    ])];
    if (repositoryNames.length) {
      new Setting(containerEl).setName("Репозитории для синхронизации").setHeading();
      const repositoryList = containerEl.createDiv({ cls: "vp-github-repository-list" });
      for (const repo of repositoryNames) {
        const repository = availableRepositories.find((item) => item.fullName === repo);
        new Setting(repositoryList).setName(repo)
          .setDesc(repository ? (repository.isPrivate ? "Приватный репозиторий" : "Публичный репозиторий") : "Сохранённый репозиторий; обновите список аккаунта.")
          .addToggle((toggle) => toggle.setValue(this.plugin.settings.githubRepositories.includes(repo))
            .onChange(async (enabled) => {
              const selected = new Set(this.plugin.settings.githubRepositories);
              if (enabled) selected.add(repo); else selected.delete(repo);
              this.plugin.settings.githubRepositories = [...selected];
              if (!enabled) this.plugin.githubCommits = this.plugin.githubCommits.filter((commit) => commit.repo !== repo);
              await this.plugin.saveSettings();
            }));
      }
    } else {
      containerEl.createEl("p", { text: "После подключения аккаунта здесь появятся его репозитории." });
    }
    new Setting(containerEl).setName("Автоматическая синхронизация").setDesc("По умолчанию выключена. При включении запрашивает только список коммитов выбранных репозиториев.")
      .addDropdown((dropdown) => dropdown.addOption("0", "Только вручную").addOption("15", "Каждые 15 минут")
        .addOption("60", "Каждый час").addOption("1440", "Раз в день")
        .setValue(String(this.plugin.settings.githubSyncMinutes))
        .onChange(async (value) => { this.plugin.settings.githubSyncMinutes = Number(value); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Панели").setHeading();
    containerEl.createEl("p", { text: "Выберите видимые панели и измените их порядок. Изменения применяются сразу." });
    for (const [index, id] of this.plugin.settings.panelOrder.entries()) {
      const panel = PANELS.find((item) => item.id === id);
      if (!panel) continue;
      const setting = new Setting(containerEl).setName(panel.title).setDesc(panel.description);
      setting.addToggle((toggle) => toggle.setValue(!this.plugin.settings.hiddenPanels.includes(id))
        .setTooltip("Показывать панель").onChange(async (visible) => {
          this.plugin.settings.hiddenPanels = visible
            ? this.plugin.settings.hiddenPanels.filter((hidden) => hidden !== id)
            : [...this.plugin.settings.hiddenPanels, id];
          await this.plugin.saveSettings();
        }));
      setting.addExtraButton((button) => button.setIcon("arrow-up").setTooltip("Переместить выше")
        .setDisabled(index === 0).onClick(async () => { await this.movePanel(index, -1); }));
      setting.addExtraButton((button) => button.setIcon("arrow-down").setTooltip("Переместить ниже")
        .setDisabled(index === this.plugin.settings.panelOrder.length - 1).onClick(async () => { await this.movePanel(index, 1); }));
    }
    this.wrapSettingsSections(containerEl);
    this.addSectionNavigation(containerEl);
    this.bindSettingsSearch(containerEl, search, clear);
  }

  private renderThemePicker(hero: HTMLElement): void {
    const themes: { id: AccentPalette; name: string; note: string; swatches: string[] }[] = [
      { id: "obsidianite", name: "Obsidianite", note: "Графит · циан · розовый", swatches: ["#17151f", "#48b8d5", "#f05b9c"] },
      { id: "classic-dark", name: "Тёмная", note: "Уголь · сталь · синий", swatches: ["#202020", "#686f7a", "#8ab4f8"] },
      { id: "classic-light", name: "Светлая", note: "Бумага · серый · синий", swatches: ["#ffffff", "#d9dce1", "#426fc5"] },
    ];
    const picker = hero.createDiv({ cls: "vp-theme-picker", attr: { role: "group", "aria-label": "Тема панели" } });
    for (const theme of themes) {
      const selected = this.plugin.settings.accentPalette === theme.id;
      const card = picker.createEl("button", { cls: `vp-theme-option${selected ? " is-selected" : ""}`, attr: { type: "button", "aria-pressed": String(selected) } });
      const preview = card.createSpan({ cls: `vp-theme-preview vp-theme-preview-${theme.id}`, attr: { "aria-hidden": "true" } });
      theme.swatches.forEach((color) => preview.createSpan({ attr: { style: `--vp-swatch: ${color}` } }));
      const copy = card.createSpan({ cls: "vp-theme-copy" });
      copy.createSpan({ text: theme.name, cls: "vp-theme-name" });
      copy.createSpan({ text: theme.note, cls: "vp-theme-note" });
      card.addEventListener("click", () => {
        this.plugin.settings.accentPalette = theme.id;
        void this.plugin.saveSettings().then(() => {
          picker.querySelectorAll(".vp-theme-option").forEach((option) => {
            const active = option === card;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-pressed", String(active));
          });
        }).catch((error: unknown) => new Notice(`Не удалось сохранить тему: ${error instanceof Error ? error.message : String(error)}`));
      });
    }
  }

  private addSectionNavigation(container: HTMLElement): void {
    const sections = Array.from(container.querySelectorAll<HTMLDetailsElement>(".vp-settings-section"));
    const nav = container.createDiv({ cls: "vp-settings-nav", attr: { "aria-label": "Разделы настроек" } });
    for (const [index, section] of sections.entries()) {
      const title = section.querySelector("summary .setting-item-name")?.textContent?.trim();
      if (!title) continue;
      const button = nav.createEl("button", { cls: "vp-settings-nav-item", attr: { type: "button" } });
      const number = button.createSpan({ cls: "vp-settings-nav-number", text: String(index + 1).padStart(2, "0") });
      const label = button.createSpan({ text: title });
      button.addEventListener("click", () => {
        section.open = true;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        nav.querySelectorAll(".vp-settings-nav-item").forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
      });
      button.setAttribute("aria-label", `${number.textContent} ${label.textContent}`);
    }
    container.insertBefore(nav, sections[0] ?? null);
  }

  private bindSettingsSearch(container: HTMLElement, search: HTMLInputElement, clear: HTMLButtonElement): void {
    const sections = Array.from(container.querySelectorAll<HTMLDetailsElement>(".vp-settings-section"));
    const navItems = Array.from(container.querySelectorAll<HTMLButtonElement>(".vp-settings-nav-item"));
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase();
      clear.hidden = !query;
      sections.forEach((section, index) => {
        const rows = Array.from(section.querySelectorAll<HTMLElement>(".setting-item:not(.setting-item-heading)"));
        let matches = 0;
        rows.forEach((row) => {
          const visible = !query || row.textContent?.toLocaleLowerCase().includes(query) === true;
          row.classList.toggle("vp-search-hidden", !visible);
          if (visible) matches++;
        });
        section.classList.toggle("vp-search-hidden", Boolean(query) && matches === 0);
        if (query) section.open = matches > 0;
        else section.open = section.dataset.initialOpen === "true";
        const navItem = navItems[index];
        if (navItem) navItem.classList.toggle("vp-search-hidden", Boolean(query) && matches === 0);
      });
      container.classList.toggle("vp-settings-searching", Boolean(query));
    };
    search.addEventListener("input", filter);
    clear.addEventListener("click", () => { search.value = ""; filter(); search.focus(); });
  }

  private wrapSettingsSections(container: HTMLElement): void {
    const headingElements = Array.from(container.children).filter((el) => el.classList.contains("setting-item-heading"));
    
    headingElements.forEach((headingEl, index) => {
      const details = container.createEl("details", { cls: "vp-settings-section" });
      details.open = index === 0;
      details.dataset.initialOpen = String(index === 0);
      const summary = details.createEl("summary");
      
      headingEl.parentNode?.insertBefore(details, headingEl);
      summary.appendChild(headingEl);
      details.appendChild(summary);

      const nextHeading = headingElements[index + 1];
      let sibling = details.nextSibling;
      while (sibling && sibling !== nextHeading) {
        const next = sibling.nextSibling;
        details.appendChild(sibling);
        sibling = next;
      }
    });
  }

  private async movePanel(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    const order = [...this.plugin.settings.panelOrder];
    [order[index], order[target]] = [order[target], order[index]];
    this.plugin.settings.panelOrder = order;
    await this.plugin.saveSettings();
    this.update();
  }

  private async moveDailyBlock(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    const order = [...this.plugin.settings.dailyBlocks];
    [order[index], order[target]] = [order[target], order[index]];
    this.plugin.settings.dailyBlocks = order;
    await this.plugin.saveSettings();
    this.update();
  }

  private async updateWorkingHours(start: string, end: string): Promise<void> {
    const valid = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!valid(start) || !valid(end) || timeToMinutes(end) <= timeToMinutes(start)) return;
    this.plugin.settings.scheduleStart = start;
    this.plugin.settings.scheduleEnd = end;
    await this.plugin.saveSettings();
  }
}
