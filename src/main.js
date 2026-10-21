const { app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage, Notification, desktopCapturer, session, shell, safeStorage, webContents, nativeTheme, dialog } = require('electron');
const Store = require('electron-store').default;
const path  = require('node:path');
const fs    = require('node:fs');
const os    = require('node:os');
const { getSuspendAfterMs, formatSuspendPolicy, normalizeAccountSuspend, getAccountSuspendAfterMs, pickAccountAfterHibernate, idleCanvasMode } = require('./resource-policy');
const { buildRequest, normalizeContext, normalizeDraft } = require('./assistant-core');
const { requestCompletion, testConnection } = require('./openai-client');
const { DEFAULT_GATEWAY, DEFAULT_PROFILES, normalizeGateway, normalizeProfiles, resolveApiKey, selectionKey } = require('./assistant-settings');
const { checkForUpdate, PAGE_URL: RELEASES_URL } = require('./update-check');
const { excerptNotes, isTrustedDownloadUrl, parseSha256Sums, expectedHash, sha256File, macBundlePath, downloadFile, readText, spawnDetached, writeMacSwapScript, writeLinuxSwapScript, unpackMacZip } = require('./apply-update');
const { avatarFilePath, processAccountAvatar, pngDataUrl, isSafeAccountId } = require('./account-avatar');
const { parseDeeplink, matchingAccounts, findDeeplinkInArgv, accountKind, DEEPLINK_SCHEMES } = require('./deeplink');
const { totalUnread, dockBadgeLabel } = require('./unread-badge');
const { acceleratorForIndex, holdModifierKey, shortcutHintState, menuLabel } = require('./account-shortcuts');

// Página pública do projeto (GitHub Pages, publicada a partir de docs/).
const SITE_URL = "https://maiconfontana.github.io/multichat/";
const pendingDeeplinks = [];

// Constantes serializáveis para enviar aos renderers via IPC (sem funções,
// que não atravessam a ponte — ver initResources / init*Instance).
const ConstantsForIPC = () => JSON.parse(JSON.stringify(Constants));

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

for (const arg of process.argv) {
	if (arg.startsWith("--disable-gpu")) {
		console.log("MultiChat: Disabling GPU by --disable-gpu argument");
		app.disableHardwareAcceleration();
		app.commandLine.appendSwitch('disable-gpu');
		app.commandLine.appendSwitch('disable-gpu-compositing');
	}
}

// Tempo de inatividade padrão antes de suspender uma conta fora de foco.
// Contas podem sobrescrever isso em Editar conta; MULTICHAT_SUSPEND_MINUTES=0
// desliga a hibernação só nas contas que ainda não têm ajuste próprio.
const BOUNDS_DEBOUNCE_MS = 150;
const MAX_ACTIVE_NOTIFICATIONS = 100;

class MultiChatApp {
	constructor() {
		this.store      = new Store();
		this.baseIcon   = path.join(__dirname, "../assets/icon.png");
		this.trayIcon   = path.join(__dirname, "../assets/icon-32.png");
		this.macTrayIcon = path.join(__dirname, "../assets/trayTemplate.png");
		this.tray        = null;
		this.isQuit     = false;
		this.spellLangs = ["en-US", "pt-BR"];
		this.activeId   = null;
		this.shareCurrent = null;
		this.sharePicker = null;
		this.sidebarCollapsed = this.store.get("sidebarCollapsed");
		if (this.sidebarCollapsed === undefined) {
			this.sidebarCollapsed = true; // padrão: sidebar recolhida (só ícones)
			this.store.set("sidebarCollapsed", true);
		}
		this.trayEnabled = this.store.get("trayEnabled");
		if (this.trayEnabled === undefined) {
			this.trayEnabled = true;
			this.store.set("trayEnabled", true);
		}
		this.sidebarContextOverlay = false;
		this.darkMode = !!this.store.get("darkMode");
		this._boundsTimer = null;
		this.assistantView = null;
		this.assistantVisible = false;
		this.assistantPending = new Map();
		this.assistantWidth = 400;
		this.idleView = null;
		this.idleVisible = false;
		this.deeplinkQueue = [];
		this.deeplinkBusy = false;
		this.shortcutHintsVisible = false;

		this.bounds = this.store.get("bounds");
		if (this.bounds == undefined) {
			this.bounds = { width: 1024, height: 768, x: null, y: null };
			this.store.set("bounds", this.bounds);
		}

		this.accounts  = this.store.get("accounts");
		this.instances = {};
		if (this.accounts == undefined) {
			this.accounts = [];
			this.store.set("accounts", this.accounts);
		}

		const quitItem = { label: "Encerrar", click: () => { this.isQuit = true; app.quit(); } };
		this.quitMenuItem = quitItem;

		const appMenu = [];
		if (process.platform === "darwin") {
			appMenu.push({
				label: "MultiChat",
				submenu: [
					{ role: "about" },
					{ type: "separator" },
					this.trayEnabledMenuItem(),
					{ type: "separator" },
					{ role: "services" },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					quitItem
				]
			});
		}

		// O rótulo da versão é preenchido em init(), quando Constants já existe.
		this.versionMenuItem = { label: "Versão", enabled: false };
		this.updateMenuItem = { label: "Verificar atualizações…", click: () => { this.checkForUpdates({ userInitiated: true }); } };

		this.menuTemplate = [
			...appMenu,
			{
				id: "menu-conta",
				label: "Conta",
				// Preenchido por accountMenuItems() em refreshApplicationMenu:
				// o número de cada conta depende da ordem atual da sidebar.
				submenu: []
			},
			// macOS roteia Cmd+C/V/X/A/Z pelo menu da aplicação. Sem estes
			// itens, o Menu.setApplicationMenu abaixo substitui o menu padrão
			// do Electron e os atalhos morrem em todas as conversas.
			// Click explícito (em vez de só role) porque o BrowserWindow não
			// carrega página: o role nativo pode colar no webContents vazio
			// da janela em vez da WebContentsView focada.
			{
				label: "Editar",
				submenu: [
					{ label: "Desfazer", accelerator: "CmdOrCtrl+Z", click: () => { this.runEditCommand("undo"); } },
					{ label: "Refazer", accelerator: "Shift+CmdOrCtrl+Z", click: () => { this.runEditCommand("redo"); } },
					{ type: "separator" },
					{ label: "Recortar", accelerator: "CmdOrCtrl+X", click: () => { this.runEditCommand("cut"); } },
					{ label: "Copiar", accelerator: "CmdOrCtrl+C", click: () => { this.runEditCommand("copy"); } },
					{ label: "Colar", accelerator: "CmdOrCtrl+V", click: () => { this.runEditCommand("paste"); } },
					{ label: "Colar e combinar estilo", accelerator: "Shift+CmdOrCtrl+V", click: () => { this.runEditCommand("pasteAndMatchStyle"); } },
					{ label: "Excluir", click: () => { this.runEditCommand("delete"); } },
					{ label: "Selecionar tudo", accelerator: "CmdOrCtrl+A", click: () => { this.runEditCommand("selectAll"); } }
				]
			},
			{
				label: "Exibir",
				submenu: [
					{ role: "resetZoom", label: "Zoom padrão" },
					{ role: "zoomIn",  label: "Ampliar" },
					{ role: "zoomOut", label: "Reduzir" },
					{ type: "separator" },
					{ label: "Assistente contextual", accelerator: "CmdOrCtrl+Shift+A", click: () => { this.toggleAssistant(); } },
					{ role: "togglefullscreen", label: "Tela cheia" },
					{ type: "separator" },
					{
						id: "toggle-sidebar",
						label: this.sidebarCollapsed ? "Expandir barra lateral" : "Recolher barra lateral",
						click: () => { this.toggleSidebar(); }
					},
					{
						id: "toggle-dark-mode",
						label: "Modo escuro",
						type: "checkbox",
						checked: this.darkMode,
						click: (item) => { this.setDarkMode(item.checked); }
					},
					this.trayEnabledMenuItem()
				]
			},
			{
				label: "Ajuda",
				submenu: [
					this.versionMenuItem,
					this.updateMenuItem,
					{ type: "separator" },
					{ label: "Página do projeto", click: () => { shell.openExternal(SITE_URL); } },
					{ label: "Página de downloads", click: () => { shell.openExternal(RELEASES_URL); } },
					{ label: "Relatar um problema", click: () => { shell.openExternal(`${RELEASES_URL.replace(/\/releases\/latest$/, "")}/issues/new/choose`); } },
					{ type: "separator" },
					quitItem
				]
			}
		];
	}

	_initElectronApp() {
		app.userAgentFallback = Constants.whatsapp.userAgent;
		if (process.platform == "win32")
			app.setAppUserModelId(Constants.appId);
		this.registerDeeplinkSchemes();
	}

	registerDeeplinkSchemes() {
		for (const scheme of DEEPLINK_SCHEMES) {
			if (process.defaultApp && process.argv[1])
				app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
			else
				app.setAsDefaultProtocolClient(scheme);
		}
	}

	init() {
		this._initElectronApp();

		let langs = [];
		for (const arg of process.argv) {
			if (arg.startsWith("--spell-lang"))
				langs.push(arg.split("=")[1]);
		}
		if (langs.length > 0)
			this.spellLangs = langs;
		console.log(`MultiChat: Spell Check: ${this.spellLangs}`);
		console.log(`MultiChat: Hibernação padrão (contas sem ajuste): ${formatSuspendPolicy(getSuspendAfterMs())}`);

		this.registerEvents();
		this.createWindow();
		this.createSidebarView();

		// Lazy-load: apenas a primeira conta é carregada no início.
		// As demais são criadas quando selecionadas pela primeira vez e
		// suspensas (descarregadas) após um período sem uso (ver suspendAccount).
		if (this.accounts.length > 0)
			this.setCurrentView(this.accounts[0].id);
		else
			this.showIdleCanvas("empty");

		// Usa a versão empacotada (package.json) quando disponível; Constants.version
		// funciona como reserva para execução direta do código-fonte.
		this.currentVersion = app.getVersion() || Constants.version;
		this.versionMenuItem.label =
			`Versão ${this.currentVersion} (Electron@${process.versions.electron})`;
		this.refreshApplicationMenu();

		if (this.trayEnabled)
			this.createTray();
		else
			this.updateTrayBadgeCounter();
		nativeTheme.on("updated", () => { this.updateTrayBadgeCounter(); });

		this.activeNotifications = [];
		this.updateCheckInFlight = null;
		this.updateApplyInFlight = false;
		this.pendingUpdate = null;

		// Checagem silenciosa de versão: só avisa se houver release mais nova.
		this.scheduleUpdateCheck();
		this.flushPendingDeeplinks();
	}

	flushPendingDeeplinks() {
		const fromArgv = findDeeplinkInArgv(process.argv);
		if (fromArgv) pendingDeeplinks.push(fromArgv);
		const queued = pendingDeeplinks.splice(0, pendingDeeplinks.length);
		for (const url of queued)
			this.openDeeplink(url);
	}

	openDeeplink(raw) {
		if (typeof raw !== "string" || !raw.trim()) return;
		this.deeplinkQueue.push(raw);
		this.drainDeeplinks();
	}

	drainDeeplinks() {
		if (this.deeplinkBusy) return;
		this.deeplinkBusy = true;
		const run = async () => {
			try {
				while (this.deeplinkQueue.length)
					await this.processDeeplink(this.deeplinkQueue.shift());
			} catch (err) {
				console.warn(`MultiChat: Deeplink falhou: ${err.message}`);
			} finally {
				this.deeplinkBusy = false;
				if (this.deeplinkQueue.length) this.drainDeeplinks();
			}
		};
		run();
	}

	async processDeeplink(raw) {
		const parsed = parseDeeplink(raw);
		if (!parsed) return;
		this.showHide(false);

		const matches = matchingAccounts(this.accounts, parsed.kind);
		const label = parsed.kind === "whatsapp" ? "WhatsApp" : "Teams";
		if (matches.length === 0) {
			if (!this.window) return;
			const { response } = await dialog.showMessageBox(this.window, {
				type: "info",
				title: Constants.appName,
				message: `Nenhuma conta ${label} para abrir o link`,
				detail: "Crie uma conta desse tipo no MultiChat e clique de novo no atalho.",
				buttons: ["Criar conta", "Cancelar"],
				defaultId: 0,
				cancelId: 1
			});
			if (response === 0) this.promptAddAccount();
			return;
		}

		let account = matches[0];
		if (matches.length > 1) {
			const preferred = this.store.get(`deeplinkPreferred.${parsed.kind}`);
			const activeIdx = matches.findIndex(a => a.id === this.activeId);
			const preferredIdx = matches.findIndex(a => a.id === preferred);
			const defaultId = activeIdx >= 0 ? activeIdx : (preferredIdx >= 0 ? preferredIdx : 0);
			const { response } = await dialog.showMessageBox(this.window, {
				type: "question",
				title: Constants.appName,
				message: `Abrir em qual conta ${label}?`,
				buttons: [...matches.map(a => a.name), "Cancelar"],
				defaultId,
				cancelId: matches.length,
				noLink: true
			});
			if (response === matches.length || response < 0) return;
			account = matches[response];
			this.store.set(`deeplinkPreferred.${parsed.kind}`, account.id);
		}

		this.openUrlInAccount(account.id, parsed.loadUrl);
	}

	openUrlInAccount(id, loadUrl) {
		this.setCurrentView(id);
		const inst = this.instances[id];
		if (!inst || !inst.view || inst.view.webContents.isDestroyed()) return;
		if (!loadUrl) return;
		const current = inst.view.webContents.getURL();
		if (current === loadUrl) return;
		inst.view.webContents.loadURL(loadUrl, { userAgent: Constants.whatsapp.userAgent });
	}

	stealCrossAppDeeplink(currentType, targetUrl) {
		const parsed = parseDeeplink(targetUrl);
		if (!parsed) return false;
		if (accountKind(currentType) === parsed.kind) return false;
		this.openDeeplink(targetUrl);
		return true;
	}

	registerEvents() {
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			const inst = this.instances[data.id];
			if (!inst) return;

			// Per-account notification setting
			const notifEnabled = inst.notifications === undefined ? true : inst.notifications.enabled;
			if (!notifEnabled) return;

			const acctName = inst.name;
			const n = new Notification({
				title: `[${acctName}] :: ${data.title}`,
				body: data.options.body,
				...(data.icon ? { icon: nativeImage.createFromDataURL(data.icon) } : {}),
				urgency: "normal"
			});
			n.on("click", () => {
				this.showHide(false);
				this.setCurrentView(data.id);
				if (this.instances[data.id] && this.instances[data.id].view)
					this.instances[data.id].view.webContents.send(Constants.event.fireNotificationClick, data.options.tag);
				this.activeNotifications = this.activeNotifications.filter(_n => _n !== n);
			});
			n.on("close", () => {
				this.activeNotifications = this.activeNotifications.filter(_n => _n !== n);
			});
			this.activeNotifications.push(n);
			if (this.activeNotifications.length > MAX_ACTIVE_NOTIFICATIONS)
				this.activeNotifications.splice(0, this.activeNotifications.length - MAX_ACTIVE_NOTIFICATIONS);
			n.show();
		});

		ipcMain.on(Constants.event.updateBadgeIcon, (event, dataURL) => {
			if (!this.tray) return;
			this.tray.setImage(this.trayImageFromBadgeDataURL(dataURL));
		});

		ipcMain.on(Constants.event.updateUnreadMessages, (event, data) => {
			if (this.instances[data.id]) {
				this.instances[data.id].unread = data.unread;
				this.updateTrayBadgeCounter();
			}
			if (this.sidebarView)
				this.sidebarView.webContents.send(Constants.event.updateUnread, data);
		});

		ipcMain.handle(Constants.event.getAccountsList, () => {
			return this.accounts.map(a => ({
				id: a.id,
				name: a.name,
				type: a.type || "whatsapp",
				url: a.url || (Constants.services[a.type || "whatsapp"] ? Constants.services[a.type || "whatsapp"].url : Constants.whatsapp.url),
				notifications: a.notifications || { enabled: true },
				suspend: normalizeAccountSuspend(a.suspend),
				avatar: this.readAvatarDataUrl(a),
				unread: this.instances[a.id] ? this.instances[a.id].unread : 0,
				active: this.activeId === a.id,
				loaded: !!(this.instances[a.id] && this.instances[a.id].view)
			}));
		});

		ipcMain.on(Constants.event.addAccount, (event, data) => {
			if (!isSafeAccountId(data.id)) return;
			const svc = Constants.services[data.type] || Constants.services.whatsapp;
			const account = {
				id: data.id,
				name: data.name,
				type: data.type || "whatsapp",
				url: data.url || svc.url,
				notifications: { enabled: data.notifications !== false },
				suspend: normalizeAccountSuspend(data.suspend)
			};
			this.applyAvatarPayload(account, data.avatar);
			this.accounts.push(account);
			this.store.set("accounts", this.accounts);
			// A view é criada por setCurrentView (lazy), não aqui.
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
			this.refreshApplicationMenu(); // nova conta = nova numeração
			this.setCurrentView(account.id);
		});

		ipcMain.on(Constants.event.updateAccount, (event, data) => {
			for (let i = 0; i < this.accounts.length; i++) {
				if (this.accounts[i].id == data.id) {
					this.accounts[i].name = data.name;
					if (data.type != undefined) this.accounts[i].type = data.type;
					if (data.url != undefined) this.accounts[i].url = data.url;
					if (data.notifications != undefined) this.accounts[i].notifications = data.notifications;
					if (data.suspend != undefined) this.accounts[i].suspend = normalizeAccountSuspend(data.suspend);
					this.applyAvatarPayload(this.accounts[i], data.avatar);
					break;
				}
			}
			this.store.set("accounts", this.accounts);
			if (this.instances[data.id]) {
				this.instances[data.id].name = data.name;
				if (data.notifications != undefined)
					this.instances[data.id].notifications = data.notifications;
			}
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
			this.refreshApplicationMenu(); // o rótulo do menu mostra o nome
			this.scheduleSuspend(data.id);
		});

		ipcMain.on(Constants.event.deleteAccount, (event, id) => {
			let toDelete = -1;
			for (let idx = 0; idx < this.accounts.length; idx++) {
				if (this.accounts[idx].id == id) { toDelete = idx; break; }
			}
			if (toDelete == -1) return;

			this.accounts.splice(toDelete, 1);
			this.store.set("accounts", this.accounts);
			this.removeAvatarFile(id);

			if (this.instances[id]) {
				this.clearSuspendTimer(id);
				if (this.instances[id].view) {
					this.window.contentView.removeChildView(this.instances[id].view);
					try { this.instances[id].view.webContents.close(); } catch (e) {}
				}
				delete this.instances[id];
			}

			const ses = session.fromPartition(`persist:${id}`);
			ses.clearStorageData().then(() => {
				const dir = ses.getStoragePath();
				if (dir) fs.rmSync(dir, { recursive: true, force: true });
			});

			if (this.activeId == id) {
				const loaded = this.accounts.find(account => this.isAccountLoaded(account.id));
				if (loaded) this.setCurrentView(loaded.id);
				else this.showIdleCanvas(idleCanvasMode({
					accountCount: this.accounts.length,
					loadedCount: this.loadedAccountCount()
				}) || "empty");
			} else if (this.accounts.length === 0) {
				this.showIdleCanvas("empty");
			}

			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
			this.refreshApplicationMenu(); // remover conta renumera as seguintes
			this.updateTrayBadgeCounter();
		});

		ipcMain.on(Constants.event.gotoAccount, (event, id) => {
			this.setCurrentView(id);
		});

		ipcMain.on(Constants.event.idleAddAccount, () => {
			this.promptAddAccount();
		});

		ipcMain.on(Constants.event.suspendAccount, (event, id) => {
			this.hibernateAccountNow(id);
		});

		ipcMain.on(Constants.event.reorderAccounts, (event, ids) => {
			if (!Array.isArray(ids) || ids.length !== this.accounts.length) return;
			const byId = new Map(this.accounts.map(a => [a.id, a]));
			const next = [];
			const seen = new Set();
			for (const id of ids) {
				if (!byId.has(id) || seen.has(id)) return;
				seen.add(id);
				next.push(byId.get(id));
			}
			this.accounts = next;
			this.store.set("accounts", this.accounts);
			this.refreshApplicationMenu(); // arrastar conta troca o ⌘N de cada uma
		});

		ipcMain.on(Constants.event.toggleNotifications, (event, data) => {
			const account = this.accounts.find(a => a.id === data.id);
			if (!account) return;
			account.notifications = {
				enabled: data.enabled,
				...((account.notifications || {}).body !== undefined ? { body: account.notifications.body } : {})
			};
			this.store.set("accounts", this.accounts);
			if (this.instances[data.id])
				this.instances[data.id].notifications = account.notifications;
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
		});

		ipcMain.on(Constants.event.toggleSidebar, event => {
			if (event.sender !== this.sidebarView?.webContents) return;
			this.toggleSidebar();
		});

		ipcMain.handle(Constants.event.sidebarContextOverlay, (event, open) => {
			if (event.sender !== this.sidebarView?.webContents) return false;
			this.setSidebarContextOverlay(open);
			return true;
		});

		ipcMain.handle(Constants.event.getUiTheme, () => !!this.darkMode);

		ipcMain.on(Constants.event.toggleAssistant, event => {
			if (event.sender !== this.sidebarView?.webContents) return;
			this.toggleAssistant();
		});

		// ── Compartilhamento de tela (modal em janela própria) ──
		ipcMain.handle(Constants.event.getShareSources, async () => {
			const sources = await desktopCapturer.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 320, height: 180 }
			});
			return sources.map(s => ({
				id: s.id,
				name: s.name,
				thumb: s.thumbnail.toDataURL()
			}));
		});

		ipcMain.on(Constants.event.setShareSelected, (event, shareId) => {
			if (!this.shareCurrent) return;
			try { this.shareCurrent.callback({ video: { id: shareId } }); } catch (e) {}
			this.shareCurrent = null;
			this.closeSharePicker();
		});

		ipcMain.on(Constants.event.setShareCancelled, () => {
			if (!this.shareCurrent) return;
			try { this.shareCurrent.callback(null); } catch (e) {}
			this.shareCurrent = null;
			this.closeSharePicker();
		});

		// ── Limpar ServiceWorkers/cache e recarregar (anti "atualize o Chrome") ──
		this.registerAssistantEvents();

		ipcMain.on(Constants.event.clearWorkersAndReload, (event, id) => {
			const inst = this.instances[id];
			if (!inst || !inst.view) return;
			console.log(`Clearing workers and reloading account "${inst.name}" (${id})...`);
			const ses = inst.view.webContents.session;
			ses.clearStorageData({
				storages: ["serviceworkers", "cachestorage"]
			}).then(() => {
				if (inst.view) inst.view.webContents.reload();
			}).catch(() => {
				if (inst.view) inst.view.webContents.reload();
			});
		});
	}

	isAssistantSender(event) {
		return !!(this.assistantView && !this.assistantView.webContents.isDestroyed() && event.sender === this.assistantView.webContents);
	}

	getAssistantSettings() {
		const gateway = normalizeGateway(this.store.get('assistant.gateway') || { ...DEFAULT_GATEWAY, model: this.store.get('assistant.model') });
		const profiles = this.store.get('assistant.profiles') || DEFAULT_PROFILES.map(item => ({ ...item }));
		const validProfiles = normalizeProfiles(profiles);
		const defaultProfileId = validProfiles.some(item => item.id === this.store.get('assistant.defaultProfileId')) ? this.store.get('assistant.defaultProfileId') : validProfiles[0].id;
		return { gateway, profiles: validProfiles, defaultProfileId, hasApiKey: !!this.store.get('assistant.apiKey') };
	}

	getProfileSelection(accountId, conversationId) {
		const settings = this.getAssistantSettings();
		const selected = (this.store.get('assistant.selections') || {})[selectionKey(accountId, conversationId)];
		return settings.profiles.some(item => item.id === selected) ? selected : settings.defaultProfileId;
	}

	saveProfileSelection(accountId, conversationId, profileId) {
		const settings = this.getAssistantSettings();
		if (!settings.profiles.some(item => item.id === profileId)) throw new Error('Perfil inválido.');
		const selections = this.store.get('assistant.selections') || {};
		selections[selectionKey(accountId, conversationId)] = profileId;
		this.store.set('assistant.selections', selections);
		return profileId;
	}

	getAssistantApiKey() {
		const encoded = this.store.get('assistant.apiKey');
		if (!encoded) throw new Error('Configure a chave da OpenAI.');
		if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro não está disponível neste sistema.');
		try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')); }
		catch (_) { throw new Error('Não foi possível ler a chave salva. Configure-a novamente.'); }
	}

	requestActiveWhatsApp(action, payload = {}) {
		const inst = this.activeId && this.instances[this.activeId];
		if (!inst || inst.type !== 'whatsapp' || !inst.view || inst.view.webContents.isDestroyed())
			return Promise.reject(new Error('O assistente está disponível somente em uma conta WhatsApp ativa.'));
		const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		const sender = inst.view.webContents;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.assistantPending.delete(id);
				reject(new Error('O WhatsApp não respondeu a tempo. Tente novamente.'));
			}, 10000);
			this.assistantPending.set(id, { sender, resolve, reject, timer });
			try { sender.send('assistant:account-request', { id, action, payload }); }
			catch (error) { clearTimeout(timer); this.assistantPending.delete(id); reject(error); }
		});
	}

	registerAssistantEvents() {
		ipcMain.on('assistant:account-response', (event, response) => {
			if (!response || typeof response.id !== 'string') return;
			const pending = this.assistantPending.get(response.id);
			if (!pending || event.sender !== pending.sender) return;
			clearTimeout(pending.timer);
			this.assistantPending.delete(response.id);
			if (response.error) pending.reject(new Error(String(response.error).slice(0, 300)));
			else pending.resolve(response.result);
		});
		ipcMain.handle('assistant:get-settings', event => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			return this.getAssistantSettings();
		});
		ipcMain.handle('assistant:save-settings', (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			const gateway = normalizeGateway(raw.gateway);
			this.store.set('assistant.gateway', gateway);
			const apiKey = String(raw.apiKey || '').trim();
			if (apiKey) {
				if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro não está disponível neste sistema.');
				this.store.set('assistant.apiKey', safeStorage.encryptString(apiKey).toString('base64'));
			}
			return this.getAssistantSettings();
		});
		ipcMain.handle('assistant:test-connection', async (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			const gateway = normalizeGateway(raw.gateway);
			return testConnection({ apiKey: resolveApiKey(raw.apiKey, () => this.getAssistantApiKey()), gateway });
		});
		ipcMain.handle('assistant:save-profiles', (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			const profiles = normalizeProfiles(raw.profiles);
			if (!profiles.some(item => item.id === raw.defaultProfileId)) throw new Error('Perfil padrão inválido.');
			this.store.set('assistant.profiles', profiles); this.store.set('assistant.defaultProfileId', raw.defaultProfileId);
			const validIds = new Set(profiles.map(item => item.id));
			const selections = this.store.get('assistant.selections') || {};
			for (const key of Object.keys(selections)) if (!validIds.has(selections[key])) delete selections[key];
			this.store.set('assistant.selections', selections);
			return this.getAssistantSettings();
		});
		ipcMain.handle('assistant:get-selection', (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			return this.getProfileSelection(raw.accountId, raw.conversationId);
		});
		ipcMain.handle('assistant:set-selection', (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			return this.saveProfileSelection(raw.accountId, raw.conversationId, String(raw.profileId || ''));
		});
		ipcMain.handle('assistant:capture', async event => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			return { ...normalizeContext(await this.requestActiveWhatsApp('capture')), accountId: this.activeId };
		});
		ipcMain.handle('assistant:generate', async (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			const context = normalizeContext(raw.context);
			if (!this.activeId || String(raw.context?.accountId || '') !== String(this.activeId)) throw new Error('A conta ativa mudou. Capture a conversa novamente.');
			const current = normalizeContext(await this.requestActiveWhatsApp('capture'));
			if (current.conversationId !== context.conversationId) throw new Error('A conversa ativa mudou. Capture a conversa novamente.');
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 45000);
			try {
				const settings = this.getAssistantSettings();
				const profileId = String(raw.profileId || this.getProfileSelection(this.activeId, context.conversationId));
				const profile = settings.profiles.find(item => item.id === profileId);
				if (!profile) throw new Error('Perfil de agente inválido.');
				this.saveProfileSelection(this.activeId, context.conversationId, profile.id);
				const request = buildRequest(context, raw.instruction, profile.systemPrompt);
				return await requestCompletion({ apiKey: this.getAssistantApiKey(), gateway: settings.gateway, ...request, webSearch: raw.webSearch === true, signal: controller.signal });
			} catch (error) {
				if (error && error.name === 'AbortError') throw new Error('A OpenAI não respondeu em 45 segundos.');
				throw error;
			} finally { clearTimeout(timer); }
		});
		ipcMain.handle('assistant:insert-draft', async (event, raw = {}) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			return this.requestActiveWhatsApp('insert', { conversationId: String(raw.conversationId || '').slice(0, 500), draft: normalizeDraft(raw.draft) });
		});
		ipcMain.handle('assistant:open-external', async (event, value) => {
			if (!this.isAssistantSender(event)) throw new Error('Origem IPC inválida.');
			let url; try { url = new URL(String(value)); } catch (_) { throw new Error('URL inválida.'); }
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Somente links HTTP(S) são permitidos.');
			await shell.openExternal(url.href);
			return true;
		});
		ipcMain.on('assistant:close', event => { if (this.isAssistantSender(event)) this.toggleAssistant(false); });
	}

	createAssistantView() {
		if (this.assistantView && !this.assistantView.webContents.isDestroyed()) return;
		this.assistantView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'assistant-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
		this.assistantView.setBackgroundColor(this.chromeBackground());
		this.assistantView.webContents.loadFile(path.join(__dirname, 'assistant.html'));
		this.assistantView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
		this.assistantView.setVisible(false);
		this.window.contentView.addChildView(this.assistantView);
		this.assistantView.webContents.on('did-finish-load', () => {
			if (this.assistantView && !this.assistantView.webContents.isDestroyed())
				this.assistantView.webContents.send(Constants.event.uiTheme, !!this.darkMode);
		});
	}

	toggleAssistant(force) {
		const visible = typeof force === 'boolean' ? force : !this.assistantVisible;
		if (visible) this.createAssistantView();
		this.assistantVisible = visible;
		if (this.assistantView && !this.assistantView.webContents.isDestroyed()) this.assistantView.setVisible(visible);
		for (const id in this.instances) this.layoutAccountView(id);
		this.layoutIdleView();
		this.layoutAssistantView();
		if (visible) this.assistantView.webContents.focus();
		else if (this.activeId && this.instances[this.activeId]?.view) this.instances[this.activeId].view.webContents.focus();
	}

	layoutAssistantView() {
		if (!this.assistantView || this.assistantView.webContents.isDestroyed()) return;
		const b = this.window.getContentBounds();
		const width = Math.min(this.assistantWidth, Math.max(280, b.width - this.getSidebarWidth() - 240));
		this.assistantView.setBounds({ x: b.width - width, y: 0, width, height: b.height });
	}

	// ── Aviso de atalhos (⌘/Ctrl mantido) ──
	//
	// O foco do teclado fica na view da conta, não na sidebar, então o aviso
	// precisa nascer aqui e viajar por IPC. O handler é só observador: NUNCA
	// chama event.preventDefault(), porque isso também mataria os
	// aceleradores do menu (Cmd+C/V inclusive) — ver issue 19279 do Electron.
	attachShortcutHints(webContents) {
		if (!webContents || webContents.isDestroyed()) return;
		webContents.on("before-input-event", (event, input) => {
			const state = shortcutHintState(input);
			if (state === null) return; // evento não fala do modificador
			this.setShortcutHints(state);
		});
	}

	setShortcutHints(visible) {
		const next = !!visible;
		if (this.shortcutHintsVisible === next) return;
		this.shortcutHintsVisible = next;
		if (this.sidebarView && !this.sidebarView.webContents.isDestroyed())
			this.sidebarView.webContents.send(Constants.event.shortcutHints, next);
	}

	trayEnabledMenuItem() {
		return {
			id: "tray-enabled",
			label: process.platform === "darwin" ? "Mostrar ícone na barra de menus" : "Mostrar ícone na bandeja",
			type: "checkbox",
			checked: this.trayEnabled,
			click: (item) => { this.setTrayEnabled(item.checked); }
		};
	}

	buildTrayMenu() {
		return Menu.buildFromTemplate([
			{ label: "Mostrar/ocultar", click: () => { this.showHide(); } },
			{ type: "separator" },
			this.trayEnabledMenuItem(),
			{ type: "separator" },
			{ label: "Encerrar", click: () => { this.isQuit = true; app.quit(); } }
		]);
	}

	createTray() {
		if (this.tray)
			return;
		this.tray = new Tray(this.getDefaultTrayImage());
		this.tray.setContextMenu(this.buildTrayMenu());
		this.tray.setToolTip(Constants.appName);
		this.tray.on("click", () => { this.showHide(); });
		this.updateTrayBadgeCounter();
	}

	destroyTray() {
		if (!this.tray)
			return;
		this.tray.destroy();
		this.tray = null;
		if (this.window && !this.window.isDestroyed() && !this.window.isVisible())
			this.showHide(false);
	}

	setTrayEnabled(enabled) {
		enabled = !!enabled;
		this.trayEnabled = enabled;
		this.store.set("trayEnabled", enabled);
		if (enabled)
			this.createTray();
		else
			this.destroyTray();
		this.refreshApplicationMenu();
	}

	syncMenuDynamicItems(items) {
		if (!items)
			return;
		for (const item of items) {
			if (item.id === "tray-enabled")
				item.checked = this.trayEnabled;
			if (item.id === "toggle-sidebar")
				item.label = this.sidebarCollapsed ? "Expandir barra lateral" : "Recolher barra lateral";
			if (item.id === "toggle-dark-mode")
				item.checked = this.darkMode;
			if (item.submenu)
				this.syncMenuDynamicItems(item.submenu);
		}
	}

	// Submenu "Conta": recriado a cada mudança na lista porque o número de
	// cada atalho é a posição da conta na sidebar. Se fosse montado uma vez
	// só, arrastar uma conta deixaria o ⌘3 apontando para a conta errada.
	accountMenuItems() {
		const items = [
			{ label: "Recarregar conta atual", accelerator: "CmdOrCtrl+R", click: () => { this.reloadCurrentView(); } },
			{ label: "Próxima conta", accelerator: "CmdOrCtrl+Tab", click: () => { this.cycleAccount(1); } },
			{ label: "Conta anterior", accelerator: "CmdOrCtrl+Shift+Tab", click: () => { this.cycleAccount(-1); } }
		];

		if (this.accounts.length > 0) {
			items.push({ type: "separator" });
			this.accounts.forEach((account, index) => {
				const accelerator = acceleratorForIndex(index);
				if (!accelerator) return; // a partir da 10ª: só ⌘Tab
				items.push({
					label: menuLabel(index, account.name),
					accelerator,
					click: () => { this.setCurrentView(account.id); }
				});
			});
		}

		items.push(
			{ type: "separator" },
			{ label: "Ferramentas de desenvolvedor", accelerator: "CmdOrCtrl+Shift+I", click: () => { this.openDevTools(); } },
			{ type: "separator" },
			this.quitMenuItem
		);
		return items;
	}

	refreshApplicationMenu() {
		this.syncMenuDynamicItems(this.menuTemplate);
		const accountMenu = this.menuTemplate.find(item => item.id === "menu-conta");
		if (accountMenu) accountMenu.submenu = this.accountMenuItems();
		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);
	}

	chromeBackground() {
		return this.darkMode ? "#161717" : "#111b21";
	}

	applyUiTheme() {
		const dark = !!this.darkMode;
		nativeTheme.themeSource = dark ? "dark" : "system";
		const bg = this.chromeBackground();
		if (this.window && !this.window.isDestroyed())
			this.window.setBackgroundColor(bg);
		if (this.sidebarView && this.sidebarView.webContents && !this.sidebarView.webContents.isDestroyed())
			this.sidebarView.webContents.send(Constants.event.uiTheme, dark);
		if (this.assistantView && this.assistantView.webContents && !this.assistantView.webContents.isDestroyed()) {
			this.assistantView.setBackgroundColor(bg);
			this.assistantView.webContents.send(Constants.event.uiTheme, dark);
		}
		if (this.sharePicker && !this.sharePicker.isDestroyed()) {
			this.sharePicker.setBackgroundColor(bg);
			this.sharePicker.webContents.send(Constants.event.uiTheme, dark);
		}
		if (this.idleView && !this.idleView.webContents.isDestroyed()) {
			this.idleView.setBackgroundColor(bg);
			this.idleView.webContents.send(Constants.event.uiTheme, dark);
		}
	}

	setDarkMode(enabled) {
		this.darkMode = !!enabled;
		this.store.set("darkMode", this.darkMode);
		this.applyUiTheme();
		this.refreshApplicationMenu();
	}

	toggleSidebar() {
		this.sidebarContextOverlay = false;
		this.sidebarCollapsed = !this.sidebarCollapsed;
		this.store.set("sidebarCollapsed", this.sidebarCollapsed);
		this.updateSidebarBounds();
		for (const id in this.instances)
			this.layoutAccountView(id);
		this.layoutIdleView();
		this.layoutAssistantView();
		this.refreshApplicationMenu();
	}

	setSidebarContextOverlay(open) {
		this.sidebarContextOverlay = !!open;
		this.updateSidebarBounds();
	}

	syncSidebarZOrder() {
		if (!this.window || !this.sidebarView) return;
		if (this.sidebarContextOverlay) {
			this.window.contentView.addChildView(this.sidebarView);
			return;
		}
		this.window.contentView.addChildView(this.sidebarView, 0);
		if (this.idleVisible && this.idleView && !this.idleView.webContents.isDestroyed())
			this.window.contentView.addChildView(this.idleView);
		if (this.assistantVisible && this.assistantView && !this.assistantView.webContents.isDestroyed())
			this.window.contentView.addChildView(this.assistantView);
	}


	getEditTarget() {
		const focused = webContents.getFocusedWebContents();
		if (focused && !focused.isDestroyed() && this.window && focused !== this.window.webContents)
			return focused;
		const inst = this.activeId && this.instances[this.activeId];
		if (inst && inst.view && inst.view.webContents && !inst.view.webContents.isDestroyed())
			return inst.view.webContents;
		if (this.sidebarView && this.sidebarView.webContents && !this.sidebarView.webContents.isDestroyed())
			return this.sidebarView.webContents;
		return (focused && !focused.isDestroyed()) ? focused : null;
	}

	runEditCommand(method) {
		const target = this.getEditTarget();
		if (target && typeof target[method] === "function")
			target[method]();
	}

	createWindow() {
		const options = {
			width: this.bounds.width,
			height: this.bounds.height,
			icon: this.baseIcon,
			backgroundColor: this.chromeBackground(), // pintura inicial — evita flash branco
			// Mostra de imediato: esta janela não carrega página própria (as views
			// são filhas), então ready-to-show nunca dispararia e a janela ficaria
			// invisível. O backgroundColor cuida do flash inicial.
			show: !(process.argv.includes("--start-in-tray") && this.trayEnabled)
		};
		if (this.bounds.x != null) {
			options.x = this.bounds.x;
			options.y = this.bounds.y;
		}

		this.window = new BrowserWindow(options);

		if (this.bounds.x == null)
			this.window.center();

		this.applyUiTheme();

		// Cmd+Tab / clique em outro app: o keyUp do modificador vai para o
		// outro app e nunca chega aqui — o aviso ficaria travado na tela.
		this.window.on("blur", () => { this.setShortcutHints(false); });
		this.window.on("focus", () => { this.setShortcutHints(false); });

		this.window.on("move", () => { this.scheduleStoreBounds(); });
		this.window.on("resize", () => { this.scheduleStoreBounds(); });
		this.window.on("close", (e) => {
			if (this.isQuit) { app.quit(); return; }
			// Sem ícone na bandeja, esconder a janela no Windows/Linux
			// deixa o app inacessível. No macOS o Dock ainda reabre.
			if (!this.trayEnabled && process.platform !== "darwin") {
				this.isQuit = true;
				app.quit();
				return;
			}
			e.preventDefault();
			this.window.hide();
		});
	}

	createSidebarView() {
		this.sidebarView = new WebContentsView({
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				contextIsolation: true,
				nodeIntegration: false
			}
		});
		this.sidebarView.setBackgroundColor('#00000000');
		this.sidebarView.webContents.loadFile(path.join(__dirname, "accounts.html"));
		// Envio imediato (cobre o caso do listener já registrado)…
		this.sidebarView.webContents.send(Constants.event.initResources, { constants: ConstantsForIPC() });
		// …e reenvio quando a página terminar de carregar, para vencer a race
		// "evento chega antes do preload existir". O preload é idempotente.
		this.sidebarView.webContents.on("did-finish-load", () => {
			this.sidebarView.webContents.send(Constants.event.initResources, { constants: ConstantsForIPC() });
		});

		// A sidebar também pode ter o foco (clique no avatar, formulário aberto):
		// sem isto o aviso não acenderia enquanto o usuário está nela.
		this.attachShortcutHints(this.sidebarView.webContents);

		// Sidebar is always first (z-order: bottom)
		this.window.contentView.addChildView(this.sidebarView);
		this.updateSidebarBounds();

		// When sidebar finishes loading, notify it of the active account
		this.sidebarView.webContents.on("did-finish-load", () => {
			this.sidebarView.webContents.send(Constants.event.activeAccount, this.activeId);
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
			this.sidebarView.webContents.send(Constants.event.sidebarState, this.sidebarCollapsed);
			this.sidebarView.webContents.send(Constants.event.uiTheme, !!this.darkMode);
		});
	}

	avatarPath(id) {
		return avatarFilePath(app.getPath("userData"), id);
	}

	readAvatarDataUrl(account) {
		if (!account || !account.customAvatar || !isSafeAccountId(account.id)) return null;
		try {
			const file = this.avatarPath(account.id);
			if (!fs.existsSync(file)) return null;
			return pngDataUrl(fs.readFileSync(file));
		} catch (e) {
			console.error("Failed to read account avatar:", e);
			return null;
		}
	}

	removeAvatarFile(id) {
		try {
			if (!isSafeAccountId(id)) return;
			const file = this.avatarPath(id);
			if (fs.existsSync(file)) fs.unlinkSync(file);
		} catch (e) {
			console.error("Failed to remove account avatar:", e);
		}
	}

	writeAvatarFile(id, dataUrl) {
		const png = processAccountAvatar(nativeImage, dataUrl);
		const file = this.avatarPath(id);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, png);
	}

	applyAvatarPayload(account, payload) {
		if (!account || !payload || payload.action === "keep") return;
		if (payload.action === "clear") {
			this.removeAvatarFile(account.id);
			account.customAvatar = false;
			return;
		}
		if (payload.action !== "set") return;
		try {
			this.writeAvatarFile(account.id, payload.dataUrl);
			account.customAvatar = true;
		} catch (e) {
			console.error("Failed to save account avatar:", e);
		}
	}

	promptAddAccount() {
		if (this.sidebarView && !this.sidebarView.webContents.isDestroyed())
			this.sidebarView.webContents.send(Constants.event.openAddAccount);
	}

	loadedAccountCount() {
		return this.accounts.filter(account => this.isAccountLoaded(account.id)).length;
	}

	createIdleView() {
		if (this.idleView && !this.idleView.webContents.isDestroyed()) return;
		this.idleView = new WebContentsView({
			webPreferences: {
				preload: path.join(__dirname, "idle-preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true
			}
		});
		this.idleView.setBackgroundColor(this.chromeBackground());
		this.idleView.webContents.loadFile(path.join(__dirname, "idle.html"));
		this.idleView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		this.idleView.setVisible(false);
		this.window.contentView.addChildView(this.idleView);
		this.idleView.webContents.on("did-finish-load", () => {
			if (!this.idleView || this.idleView.webContents.isDestroyed()) return;
			this.idleView.webContents.send(Constants.event.uiTheme, !!this.darkMode);
			if (this.idleVisible)
				this.idleView.webContents.send(Constants.event.idleState, { mode: this.idleMode || "empty" });
		});
	}

	layoutIdleView() {
		if (!this.idleView || this.idleView.webContents.isDestroyed()) return;
		const b = this.window.getContentBounds();
		const sbw = this.getSidebarWidth();
		const assistantWidth = this.assistantVisible ? Math.min(this.assistantWidth, Math.max(280, b.width - sbw - 240)) : 0;
		this.idleView.setBounds({ x: sbw, y: 0, width: Math.max(1, b.width - sbw - assistantWidth), height: b.height });
	}

	showIdleCanvas(mode = "empty") {
		this.activeId = null;
		this.idleMode = mode === "hibernated" ? "hibernated" : "empty";
		this.window.setTitle(Constants.appName);
		for (const aid in this.instances) {
			if (this.instances[aid].view)
				this.instances[aid].view.setVisible(false);
		}
		this.createIdleView();
		this.idleVisible = true;
		this.idleView.setVisible(true);
		this.layoutIdleView();
		if (!this.idleView.webContents.isDestroyed())
			this.idleView.webContents.send(Constants.event.idleState, { mode: this.idleMode });
		this.syncSidebarZOrder();
		if (this.sidebarView && !this.sidebarView.webContents.isDestroyed()) {
			this.sidebarView.webContents.send(Constants.event.activeAccount, null);
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
		}
	}

	hideIdleCanvas() {
		this.idleVisible = false;
		if (this.idleView && !this.idleView.webContents.isDestroyed())
			this.idleView.setVisible(false);
	}

	createAccountView(account) {
		const id = account.id;
		if (this.instances[id] && this.instances[id].view)
			return this.instances[id].view; // já criada

		const name = account.name;
		const type = account.type || "whatsapp";
		const url  = account.url || (Constants.services[type] ? Constants.services[type].url : Constants.whatsapp.url);
		const preloadFile = Constants.services[type] ? Constants.services[type].preload : "whatsapp-preload.js";

		console.log(`Creating account view for "${name} (${id})" [${type}]`);
		if (!this.instances[id]) {
			this.instances[id] = {
				id, name, type,
				unread: 0,
				notifications: account.notifications || { enabled: true },
				view: null,
				suspendTimer: null
			};
		}

		const view = new WebContentsView({
			webPreferences: {
				partition: `persist:${id}`,
				preload: path.join(__dirname, preloadFile),
				spellcheck: true,
				// Mensageiros dependem de WebSocket e timers mesmo quando ocultos.
				backgroundThrottling: false,
				contextIsolation: false
			}
		});
		this.instances[id].view = view;
		this.instances[id].name = name;
		this.instances[id].type = type;

		if (this.spellLangs.length > 0)
			view.webContents.session.setSpellCheckerLanguages(this.spellLangs);

		view.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
			this.shareCurrent = { id, callback };
			this.openScreenSharePicker();
		});

		this.attachShortcutHints(view.webContents);

		view._id   = id;
		view._name = name;
		view._type = type;
		view.setBackgroundColor('#ffffff');
		view.webContents.loadURL(url, { userAgent: Constants.whatsapp.userAgent });

		view.webContents.setWindowOpenHandler((details) => {
			if (this.stealCrossAppDeeplink(type, details.url))
				return { action: "deny" };
			try {
				const opened = new URL(details.url);
				if (opened.protocol === "whatsapp:" || opened.protocol === "msteams:" || opened.protocol === "ms-teams:")
					return { action: "deny" };
				const host = opened.hostname;
				const baseHost = new URL(url).hostname;
				if (host === baseHost || host.endsWith("." + baseHost))
					return { action: "allow" };
			} catch (e) {}
			try {
				const external = new URL(details.url);
				if (external.protocol === 'http:' || external.protocol === 'https:')
					shell.openExternal(external.href);
			} catch (e) {}
			return { action: 'deny' };
		});

		view.webContents.on("will-navigate", (event, navUrl) => {
			let opened;
			try { opened = new URL(navUrl); } catch { return; }
			if (opened.protocol === "http:" || opened.protocol === "https:") {
				if (this.stealCrossAppDeeplink(type, navUrl))
					event.preventDefault();
				return;
			}
			const parsed = parseDeeplink(navUrl);
			if (!parsed) return;
			event.preventDefault();
			if (accountKind(type) !== parsed.kind)
				this.openDeeplink(navUrl);
		});

		view.webContents.on("did-finish-load", () => {
			console.log(`Account "${name} (${id})" [${type}] loaded`);
			const initEvent = (preloadFile === "whatsapp-preload.js")
				? Constants.event.initWhatsAppInstance
				: Constants.event.initGenericInstance;
			view.webContents.send(initEvent, { id, name, constants: ConstantsForIPC() });
		});

		// Se o renderer da conta morrer, recria (mantendo a sessão persistente)
		view.webContents.on("render-process-gone", (event, details) => {
			console.warn(`Account "${name} (${id})" renderer gone: ${details.reason}`);
			const inst = this.instances[id];
			// O evento pode vir da view anterior depois que a conta já foi
			// reativada. Não descarte a referência da view nova nesse caso.
			if (!inst || inst.view !== view) return;
			this.clearSuspendTimer(id);
			try { this.window.contentView.removeChildView(view); } catch (e) {}
			inst.view = null;
			if (this.activeId === id)
				this.setCurrentView(id); // recria imediatamente a conta ativa
		});

		// Start hidden — will be shown when set as current
		view.setVisible(false);
		this.window.contentView.addChildView(view);
		this.layoutAccountView(id);
		// Contas lazy podem ser criadas depois do painel; mantenha o assistente no topo.
		if (this.assistantVisible && this.assistantView && !this.assistantView.webContents.isDestroyed()) {
			this.window.contentView.removeChildView(this.assistantView);
			this.window.contentView.addChildView(this.assistantView);
			this.layoutAssistantView();
		}
		return view;
	}

	ensureAccountView(id) {
		const account = this.accounts.find(a => a.id === id);
		if (!account) return null;
		if (this.instances[id] && this.instances[id].view)
			return this.instances[id].view;
		return this.createAccountView(account);
	}

	clearSuspendTimer(id) {
		const inst = this.instances[id];
		if (inst && inst.suspendTimer) {
			clearTimeout(inst.suspendTimer);
			inst.suspendTimer = null;
		}
	}

	scheduleSuspend(id) {
		this.clearSuspendTimer(id);
		const inst = this.instances[id];
		if (!inst || !inst.view || id === this.activeId) return;
		const afterMs = getAccountSuspendAfterMs(this.accounts.find(a => a.id === id));
		if (afterMs === 0) return;
		inst.suspendTimer = setTimeout(() => {
			this.suspendAccount(id);
		}, afterMs);
	}

	isAccountLoaded(id) {
		return !!(this.instances[id] && this.instances[id].view);
	}

	hibernateAccountNow(id) {
		if (typeof id !== "string" || !this.accounts.some(account => account.id === id)) return;
		if (!this.isAccountLoaded(id)) return;

		if (id === this.activeId) {
			const fallback = pickAccountAfterHibernate(this.accounts, id, accountId => this.isAccountLoaded(accountId));
			if (fallback) this.setCurrentView(fallback.id);
			else this.activeId = null;
		}
		this.suspendAccount(id);
		if (!this.activeId)
			this.showIdleCanvas("hibernated");
	}

	suspendAccount(id) {
		const inst = this.instances[id];
		if (!inst || !inst.view || id === this.activeId) return;
		console.log(`Suspending account "${inst.name}" (${id}) — freeing memory`);
		this.clearSuspendTimer(id);

		// Desvincula antes de fechar: render-process-gone pode chegar depois de
		// uma reativação e deve ser reconhecido como evento da view antiga.
		const view = inst.view;
		inst.view = null;
		try {
			this.window.contentView.removeChildView(view);
			view.webContents.close();
		} catch (e) {
			console.warn(`Suspend of "${id}" failed: ${e.message}`);
		}
		if (this.sidebarView)
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
	}

	setCurrentView(id) {
		// Contas suspensas (ver suspendAccount) ficam com view = null: se a
		// conta ativa for suspensa (ex.: aba Teams presa em background), ela
		// nunca era recriada e o app ficava preso em tela branca ao voltar.
		const instance = this.instances[id];
		if (!instance || !instance.view) {
			const view = this.ensureAccountView(id);
			if (!view) return;
		}

		this.hideIdleCanvas();

		// Hide all account views, show only the active one
		for (const aid in this.instances) {
			if (this.instances[aid].view)
				this.instances[aid].view.setVisible(aid === id);
		}

		this.activeId = id;

		const inst = this.instances[id];
		this.window.setTitle(`${Constants.appName} :: ${inst.name}`);
		if (inst.view) {
			this.layoutAccountView(id);
			inst.view.webContents.focus();
		}

		// (Re)agenda a suspensão das outras contas e cancela a da ativa
		this.clearSuspendTimer(id);
		for (const aid in this.instances)
			this.scheduleSuspend(aid);

		// Notify sidebar
		if (this.sidebarView) {
			this.sidebarView.webContents.send(Constants.event.activeAccount, id);
			this.sidebarView.webContents.send(Constants.event.reloadAccounts);
		}
	}

	cycleAccount(dir) {
		if (this.accounts.length === 0) return;
		if (!this.activeId) {
			const pick = dir > 0 ? this.accounts[0] : this.accounts[this.accounts.length - 1];
			this.setCurrentView(pick.id);
			return;
		}
		if (this.accounts.length < 2) return;
		const idx = this.accounts.findIndex(a => a.id === this.activeId);
		const next = (idx + dir + this.accounts.length) % this.accounts.length;
		this.setCurrentView(this.accounts[next].id);
	}

	getSidebarWidth() {
		return this.sidebarCollapsed ? Constants.sidebar.collapsedWidth : Constants.sidebar.width;
	}

	layoutAccountView(id) {
		const inst = this.instances[id];
		if (!inst || !inst.view) return;
		const view = inst.view;
		const b = this.window.getContentBounds();
		const sbw = this.getSidebarWidth();
		const assistantWidth = this.assistantVisible ? Math.min(this.assistantWidth, Math.max(280, b.width - sbw - 240)) : 0;
		view.setBounds({ x: sbw, y: 0, width: Math.max(1, b.width - sbw - assistantWidth), height: b.height });
	}

	updateSidebarBounds() {
		if (!this.sidebarView) return;
		const b = this.window.getContentBounds();
		const width = this.sidebarContextOverlay ? b.width : this.getSidebarWidth();
		this.sidebarView.setBounds({ x: 0, y: 0, width, height: b.height });
		this.sidebarView.webContents.send(Constants.event.sidebarState, this.sidebarCollapsed);
		this.syncSidebarZOrder();
	}

	scheduleStoreBounds() {
		if (this._boundsTimer) return;
		this._boundsTimer = setTimeout(() => {
			this._boundsTimer = null;
			this.storeWindowBounds();
		}, BOUNDS_DEBOUNCE_MS);
	}

	storeWindowBounds() {
		this.bounds = this.window.getBounds();
		this.store.set("bounds", this.bounds);
		this.updateSidebarBounds();
		for (const id in this.instances)
			this.layoutAccountView(id);
		this.layoutIdleView();
		this.layoutAssistantView();
	}

	getDefaultTrayImage() {
		if (process.platform === "darwin" && fs.existsSync(this.macTrayIcon)) {
			const img = nativeImage.createEmpty();
			img.addRepresentation({
				scaleFactor: 1,
				buffer: fs.readFileSync(this.macTrayIcon)
			});
			const retinaPath = this.macTrayIcon.replace(/\.png$/, "@2x.png");
			if (fs.existsSync(retinaPath)) {
				img.addRepresentation({
					scaleFactor: 2,
					buffer: fs.readFileSync(retinaPath)
				});
			}
			img.setTemplateImage(true);
			return img;
		}
		const iconPath = fs.existsSync(this.trayIcon) ? this.trayIcon : this.baseIcon;
		return nativeImage.createFromPath(iconPath);
	}

	// O canvas do badge no mac é 44px (@2x de 22pt). Sem scaleFactor o
	// Electron trata isso como 44 pontos lógicos e o ícone explode na barra.
	trayImageFromBadgeDataURL(dataURL) {
		const img = nativeImage.createFromDataURL(dataURL);
		if (process.platform !== "darwin")
			return img;
		const retina = nativeImage.createFromBuffer(img.toPNG(), { scaleFactor: 2 });
		const { width } = retina.getSize();
		if (width > 22)
			return retina.resize({ width: 22, height: 22, quality: "best" });
		return retina;
	}

	syncDockBadge(counter) {
		if (process.platform !== "darwin" || !app.dock) return;
		const label = dockBadgeLabel(counter);
		if (app.dock.getBadge() === label) return;
		app.dock.setBadge(label);
	}

	updateTrayBadgeCounter() {
		const counter = totalUnread(this.instances);
		this.syncDockBadge(counter);
		if (!this.tray) return;

		if (counter == 0) {
			this.tray.setImage(this.getDefaultTrayImage());
			this.tray.setToolTip(Constants.appName);
			return;
		}
		this.tray.setToolTip(`${Constants.appName} — ${counter} não lidas`);
		if (this.sidebarView)
			this.sidebarView.webContents.send(Constants.event.buildBadgeIcon, {
				counter,
				dark: nativeTheme.shouldUseDarkColors
			});
	}

	reloadCurrentView() {
		if (!this.activeId) return;
		const inst = this.instances[this.activeId];
		if (!inst || !inst.view) return;
		inst.view.webContents.reload();
		// O evento de reinicialização do preload é enviado pelo did-finish-load,
		// já com o tipo correto da conta (ver createAccountView).
	}

	openDevTools() {
		if (this.activeId && this.instances[this.activeId] && this.instances[this.activeId].view)
			this.instances[this.activeId].view.webContents.openDevTools({ mode: "detach" });
		else if (this.sidebarView)
			this.sidebarView.webContents.openDevTools({ mode: "detach" });
	}

	// ── Verificação de atualizações ──
	// Consulta a última release, avisa com notificação e oferece changelog
	// ou instalação in-app (SHA-256) no binário empacotado.
	async checkForUpdates({ userInitiated = false } = {}) {
		if (this.updateCheckInFlight) return this.updateCheckInFlight;

		this.updateCheckInFlight = (async () => {
			const result = await checkForUpdate({
				currentVersion: this.currentVersion || app.getVersion(),
				platform: process.platform,
				arch: process.arch
			});

			if (result.status === "update") {
				this.pendingUpdate = result;
				if (userInitiated)
					await this.promptUpdate(result);
				else
					this.notifyUpdate(result);
			} else if (result.status === "current") {
				this.pendingUpdate = null;
				if (userInitiated) {
					await dialog.showMessageBox(this.window, {
						type: "info",
						title: "Sem atualizações",
						message: `Você já está na versão mais recente (${result.currentVersion}).`,
						buttons: ["OK"],
						noLink: true
					});
				}
			} else if (userInitiated) {
				const { response } = await dialog.showMessageBox(this.window, {
					type: "warning",
					title: "Não foi possível verificar",
					message: "A verificação de atualizações falhou.",
					detail: `Motivo: ${result.reason || "desconhecido"}. Confira a conexão e tente novamente, ou baixe manualmente na página de releases.`,
					buttons: ["Abrir página de downloads", "Fechar"],
					defaultId: 0,
					cancelId: 1,
					noLink: true
				});
				if (response === 0) await shell.openExternal(RELEASES_URL);
			}

			return result;
		})().finally(() => { this.updateCheckInFlight = null; });

		return this.updateCheckInFlight;
	}

	notifyUpdate(result) {
		const version = result.latestVersion;
		if (this.store.get("dismissedUpdate") === version) return;

		const showPrompt = () => {
			this.showHide(false);
			this.promptUpdate(result).catch((err) => console.warn(`MultiChat: prompt de atualização falhou: ${err.message}`));
		};

		if (!Notification.isSupported()) {
			showPrompt();
			return;
		}

		const n = new Notification({
			title: "Há uma nova versão disponível",
			body: `MultiChat ${version}. Toque para ver o changelog ou atualizar.`,
			silent: false,
			urgency: "normal"
		});
		n.on("click", showPrompt);
		n.show();
	}

	async promptUpdate(result) {
		if (!result || result.status !== "update") return;
		const version = result.latestVersion;
		const canInstall = !!(app.isPackaged && result.installUrl && isTrustedDownloadUrl(result.installUrl));
		const { response } = await dialog.showMessageBox(this.window, {
			type: "info",
			title: "Atualização disponível",
			message: `Há uma nova versão disponível: MultiChat ${version}.`,
			detail: `Você está na ${result.currentVersion}.\n\n${excerptNotes(result.notes)}`,
			buttons: canInstall
				? ["Atualizar agora", "Ver changelog", "Depois"]
				: ["Baixar agora", "Ver changelog", "Depois"],
			defaultId: 0,
			cancelId: 2,
			noLink: true
		});
		if (response === 1) {
			await shell.openExternal(result.releaseUrl || RELEASES_URL);
			return;
		}
		if (response === 2) {
			this.store.set("dismissedUpdate", version);
			return;
		}
		this.store.delete("dismissedUpdate");
		if (canInstall) await this.applyDownloadedUpdate(result);
		else await shell.openExternal(result.downloadUrl || result.releaseUrl || RELEASES_URL);
	}

	async applyDownloadedUpdate(result) {
		if (this.updateApplyInFlight) return;
		this.updateApplyInFlight = true;
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multichat-dl-"));
		const destFile = path.join(tmpDir, result.installName || "update.bin");
		try {
			if (Notification.isSupported()) {
				new Notification({
					title: "Baixando atualização",
					body: `MultiChat ${result.latestVersion} — o app vai reiniciar ao terminar.`,
					silent: true
				}).show();
			}

			await downloadFile(result.installUrl, destFile);
			if (result.checksumsUrl && isTrustedDownloadUrl(result.checksumsUrl)) {
				const sums = parseSha256Sums(await readText(result.checksumsUrl));
				const expected = expectedHash(sums, result.installName);
				if (expected) {
					const actual = await sha256File(destFile);
					if (actual !== expected) throw new Error("checksum-mismatch");
				}
			}

			await this.installAndRelaunch(result, destFile);
		} catch (err) {
			console.error("MultiChat: falha ao aplicar atualização:", err);
			const { response } = await dialog.showMessageBox(this.window, {
				type: "error",
				title: "Não foi possível atualizar",
				message: "O download ou a verificação da atualização falhou.",
				detail: "Você pode baixar o instalador no navegador. As contas já configuradas não são afetadas.",
				buttons: ["Abrir download", "Fechar"],
				defaultId: 0,
				cancelId: 1,
				noLink: true
			});
			if (response === 0) await shell.openExternal(result.downloadUrl || result.releaseUrl || RELEASES_URL);
		} finally {
			this.updateApplyInFlight = false;
		}
	}

	async installAndRelaunch(result, destFile) {
		const name = String(result.installName || destFile);
		if (process.platform === "darwin") {
			const bundle = macBundlePath(process.execPath);
			if (!bundle) throw new Error("not-an-app-bundle");
			if (/\.zip$/i.test(name)) {
				const nextApp = await unpackMacZip(destFile);
				const script = writeMacSwapScript({ pid: process.pid, sourceApp: nextApp, destApp: bundle });
				spawnDetached("/bin/bash", [script]);
			} else {
				spawnDetached("open", [destFile]);
				await dialog.showMessageBox(this.window, {
					type: "info",
					title: "Instalador aberto",
					message: "Arraste o MultiChat para Aplicativos e reabra o app.",
					buttons: ["OK"],
					noLink: true
				});
				return;
			}
		} else if (process.platform === "linux") {
			const current = process.env.APPIMAGE;
			if (!current) throw new Error("not-an-appimage");
			const script = writeLinuxSwapScript({ pid: process.pid, source: destFile, dest: current });
			spawnDetached("/bin/bash", [script]);
		} else if (process.platform === "win32") {
			spawnDetached(destFile, []);
		} else {
			throw new Error("unsupported-platform");
		}

		this.isQuit = true;
		app.quit();
	}

	// Checagem silenciosa alguns segundos após a janela abrir: não interrompe
	// a inicialização e só incomoda o usuário quando há de fato versão nova.
	scheduleUpdateCheck(delayMs = 6000) {
		const timer = setTimeout(() => {
			this.checkForUpdates().catch((err) => console.warn(`MultiChat: Verificação de atualização falhou: ${err.message}`));
		}, delayMs);
		if (timer.unref) timer.unref();
	}

	// ── Compartilhamento de tela ──
	openScreenSharePicker() {
		if (this.sharePicker && !this.sharePicker.isDestroyed()) {
			this.sharePicker.show();
			this.sharePicker.focus();
			return;
		}
		this.sharePicker = new BrowserWindow({
			width: 720,
			height: 540,
			minWidth: 480,
			minHeight: 360,
			parent: this.window,
			modal: true,
			show: false,
			autoHideMenuBar: true,
			title: "Compartilhar tela",
			backgroundColor: this.chromeBackground(),
			icon: this.baseIcon,
			webPreferences: {
				preload: path.join(__dirname, "screenshare-preload.js"),
				contextIsolation: true,
				nodeIntegration: false
			}
		});
		this.sharePicker.loadFile(path.join(__dirname, "screenshare.html"));
		this.sharePicker.webContents.on("did-finish-load", () => {
			if (this.sharePicker && !this.sharePicker.isDestroyed())
				this.sharePicker.webContents.send(Constants.event.uiTheme, !!this.darkMode);
		});
		this.sharePicker.once("ready-to-show", () => this.sharePicker.show());
		this.sharePicker.on("closed", () => { this.sharePicker = null; });
		// Se o usuário fechar a janela sem escolher, cancela o pedido pendente
		this.sharePicker.on("close", () => {
			if (this.shareCurrent) {
				try { this.shareCurrent.callback(null); } catch (e) {}
				this.shareCurrent = null;
			}
		});
	}

	closeSharePicker() {
		if (this.sharePicker && !this.sharePicker.isDestroyed())
			this.sharePicker.close();
		this.sharePicker = null;
	}

	clearSessionCaches() {
		const sessions = new Set();
		for (const id in this.instances) {
			const view = this.instances[id].view;
			if (view && !view.webContents.isDestroyed())
				sessions.add(view.webContents.session);
			this.clearSuspendTimer(id);
		}
		return Promise.allSettled([...sessions].map(ses => ses.clearCache()));
	}

	showHide(hide = true) {
		if (!this.window) return;
		if (!this.window.isFocused()) {
			if (this.window.isVisible())
				this.window.focus();
			else if (this.window.isMinimized()) {
				this.window.restore();
				this.window.focus();
			} else {
				this.window.show();
				this.window.restore();
				this.window.focus();
			}
		} else {
			if (hide)
				this.window.hide();
		}
	}
}

let Constants = {};
const ws = new MultiChatApp();

app.whenReady().then(() => {
	Constants = require("./constants").init(app.getSystemLocale());
	ws.init();
});

app.on('open-url', (event, url) => {
	event.preventDefault();
	if (ws.window) ws.openDeeplink(url);
	else pendingDeeplinks.push(url);
});

app.on('second-instance', (event, commandLine) => {
	const url = findDeeplinkInArgv(commandLine);
	if (ws.window) {
		ws.showHide(false);
		if (url) ws.openDeeplink(url);
	} else if (url) {
		pendingDeeplinks.push(url);
	}
});

app.on('activate', () => {
	// macOS: clique no ícone do Dock reabre a janela
	ws.showHide(false);
});

app.on('before-quit', () => {
	ws.isQuit = true;
	// A limpeza é best-effort: remove cache HTTP obsoleto sem apagar cookies,
	// IndexedDB ou demais dados responsáveis por manter as contas logadas.
	ws.clearSessionCaches().catch(err => console.warn(`MultiChat: Falha ao limpar cache: ${err.message}`));
	if (ws.sharePicker && !ws.sharePicker.isDestroyed())
		ws.sharePicker.destroy();
});

app.on('window-all-closed', () => {
	// No macOS o app continua no Dock; nas outras plataformas encerra
	// apenas quando pedido via menu/tray (isQuit).
	if (process.platform !== 'darwin' && ws.isQuit)
		app.quit();
});
