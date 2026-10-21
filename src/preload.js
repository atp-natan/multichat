const { contextBridge, ipcRenderer } = require('electron');

let Constants = null;

// Caminho RELATIVO (o renderer já é servido de dentro do app): evita
// require('path'), proibido em preload sandboxed (module not found: path).
const BADGE_ICON_SRC = "../assets/icon-32.png";
const MAC_TRAY_SRC = "../assets/trayTemplate@2x.png";
const MAC_TRAY_PX = 44;

// Desenha o badge do tray (contador sobre o logo) e devolve um dataURL.
// No macOS o canvas é 44px (@2x de 22pt) sobre o ícone template; no resto
// das plataformas continua o logo colorido de 32px. O contador é limitado
// a 999+ para não transbordar.
const buildBadgeIcon = (payload) => {
	const counter = (payload && typeof payload === "object") ? payload.counter : payload;
	const dark = !!(payload && typeof payload === "object" && payload.dark);
	const isMac = process.platform === "darwin";
	const label = counter > 999 ? '999+' : String(counter);
	const image = new Image();
	image.onload = () => {
		const size = isMac ? MAC_TRAY_PX : (image.width || 32);
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d");
		canvas.width = size;
		canvas.height = size;

		if (isMac && dark)
			ctx.filter = "invert(1)";
		ctx.drawImage(image, 0, 0, size, size);
		ctx.filter = "none";

		const radius = isMac ? Math.max(7, size * 0.22) : Math.max(8, size * 0.40);
		const centerX = size * (isMac ? 0.78 : 0.73);
		const centerY = size * (isMac ? 0.22 : 0.27);
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
		ctx.fillStyle = isMac ? '#ff3b30' : '#ff3333';
		ctx.fill();
		if (!isMac) {
			ctx.lineWidth = Math.max(1, size / 16);
			ctx.strokeStyle = '#003300';
			ctx.stroke();
		}

		const fontSize = radius * (label.length >= 3 ? 0.95 : (isMac ? 1.15 : 1.25));
		ctx.font = `bold ${Math.round(fontSize)}px -apple-system, BlinkMacSystemFont, Arial`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#ffffff';
		ctx.fillText(label, centerX, centerY + fontSize * .06);

		var data = canvas.toDataURL("image/png");
		ipcRenderer.send(Constants.event.updateBadgeIcon, data);
	};
	image.src = isMac ? MAC_TRAY_SRC : BADGE_ICON_SRC;
};

// Recebe as constantes do main. Chega tanto no envio imediato (pós-loadFile)
// quanto reenviado no did-finish-load — ver createSidebarView no main.js —
// então a race "evento chega antes do listener" não derruba mais a sidebar.
ipcRenderer.on("init-resources", (event, data) => {
	if (Constants) return; // idempotente
	Constants = data.constants;
	console.log("[sidebar] preload OK — API window.electron exposta");
	ipcRenderer.on(Constants.event.buildBadgeIcon, (event, payload) => buildBadgeIcon(payload));
});

contextBridge.exposeInMainWorld("electron", {
	getAccounts: () => ipcRenderer.invoke(Constants && Constants.event.getAccountsList),
	addAccount: (data) => ipcRenderer.send(Constants && Constants.event.addAccount, data),
	updateAccount: (data) => ipcRenderer.send(Constants && Constants.event.updateAccount, data),
	deleteAccount: (id) => ipcRenderer.send(Constants && Constants.event.deleteAccount, id),
	reorderAccounts: (ids) => ipcRenderer.send(Constants && Constants.event.reorderAccounts, ids),
	gotoAccount: (id) => ipcRenderer.send(Constants && Constants.event.gotoAccount, id),
	toggleNotifications: (id, enabled) => ipcRenderer.send(Constants && Constants.event.toggleNotifications, { id, enabled }),
	suspendAccount: (id) => ipcRenderer.send(Constants && Constants.event.suspendAccount, id),
	toggleSidebar: () => ipcRenderer.send(Constants && Constants.event.toggleSidebar),
	toggleAssistant: () => ipcRenderer.send(Constants && Constants.event.toggleAssistant),
	setSidebarContextOverlay: (open) => ipcRenderer.invoke(Constants && Constants.event.sidebarContextOverlay, !!open),
	getUiTheme: () => ipcRenderer.invoke(Constants && Constants.event.getUiTheme),
	onUiTheme: (cb) => ipcRenderer.on("ui-theme", (e, dark) => cb(!!dark)),
	onSidebarState: (cb) => ipcRenderer.on("sidebar-state", (e, collapsed) => cb(collapsed)),

	reloadAccounts: (cb) => ipcRenderer.on("reload-accounts", cb),
	onUpdateUnread: (cb) => ipcRenderer.on("update-unread", (e, data) => cb(data)),
	onActiveAccount: (cb) => ipcRenderer.on("active-account", (e, id) => cb(id || null)),
	onOpenAddAccount: (cb) => ipcRenderer.on("open-add-account", () => cb()),
	onShortcutHints: (cb) => ipcRenderer.on("shortcut-hints", (e, visible) => cb(!!visible))
});
