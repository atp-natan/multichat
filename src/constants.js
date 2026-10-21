Constants = {
	appName : "MultiChat",
	appId   : "com.maiconfontana.multichat",
	offsets : {
		window: { x: 0, y: 0, width: 0, height: 0 },
		view: { x: 0, y: 0, width: 0, height: 0 }
	},
	sidebar : {
		width: 280,
		collapsedWidth: 72
	},
	event   : {},
	whatsapp: {},
	services: {
		whatsapp: {
			name: "WhatsApp",
			url: "https://web.whatsapp.com/",
			icon: "whatsapp",
			color: "#25d366",
			preload: "whatsapp-preload.js"
		},
		teams: {
			name: "Microsoft Teams",
			url: "https://teams.microsoft.com/v2/",
			icon: "microsoft-teams",
			color: "#5059c9",
			preload: "messenger-preload.js"
		},
		telegram: {
			name: "Telegram",
			url: "https://web.telegram.org/a/",
			icon: "telegram",
			color: "#2aabee",
			preload: "messenger-preload.js"
		},
		discord: {
			name: "Discord",
			url: "https://discord.com/app",
			icon: "discord",
			color: "#5865f2",
			preload: "messenger-preload.js"
		},
		slack: {
			name: "Slack",
			url: "https://app.slack.com/client",
			icon: "slack",
			color: "#4a154b",
			preload: "messenger-preload.js"
		},
		custom: {
			name: "Personalizado (URL)",
			url: "https://",
			icon: "globe",
			color: "#00a884",
			preload: "messenger-preload.js"
		}
	}
};

Constants.version = "1.7.1";

Constants.whatsapp.url = "https://web.whatsapp.com/";

// User-Agent coerente com a plataforma real — evita que o WhatsApp Web
// enxergue "Linux" num app rodando em Windows/macOS.
const _chromeVer = () => {
	try { return process.versions.chrome || "150.0.0.0"; }
	catch (e) { return "150.0.0.0"; }
};

Constants.userAgentFor = () => {
	const chrome = _chromeVer();
	switch (process.platform) {
		case "win32":
			return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
		case "darwin":
			return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
		default:
			return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
	}
};

Constants.whatsapp.userAgent = Constants.userAgentFor();

Constants.event.initResources           = "init-resources";
Constants.event.initWhatsAppInstance    = "init-whatsapp-instance";
Constants.event.initGenericInstance     = "init-generic-instance";
Constants.event.clearWorkersAndReload   = "clear-workers-and-reload";
Constants.event.reloadWhatsAppInstance  = "reload-whatsapp-instance";
Constants.event.updateUnreadMessages    = "update-unread-messages";
Constants.event.newRendererNotification = "new-renderer-notification";
Constants.event.fireNotificationClick   = "fire-notification-click";
Constants.event.buildBadgeIcon          = "build-badge-icon";
Constants.event.updateBadgeIcon         = "set-updated-badge-icon";

Constants.event.getAccountsList         = "get-accounts-list";
Constants.event.addAccount              = "add-account";
Constants.event.updateAccount           = "update-account";
Constants.event.deleteAccount           = "delete-account";
Constants.event.reorderAccounts         = "reorder-accounts";
Constants.event.gotoAccount             = "goto-account";
Constants.event.reloadAccounts          = "reload-accounts";
Constants.event.activeAccount           = "active-account";
Constants.event.updateUnread            = "update-unread";
Constants.event.toggleNotifications     = "toggle-notifications";
Constants.event.suspendAccount          = "suspend-account";
Constants.event.toggleSidebar           = "toggle-sidebar";
Constants.event.toggleAssistant         = "toggle-assistant";
Constants.event.sidebarState            = "sidebar-state";
Constants.event.sidebarContextOverlay   = "sidebar-context-overlay";
Constants.event.getUiTheme              = "get-ui-theme";
Constants.event.uiTheme                 = "ui-theme";
Constants.event.idleState               = "idle-state";
Constants.event.idleAddAccount          = "idle-add-account";
Constants.event.openAddAccount          = "open-add-account";
Constants.event.shortcutHints           = "shortcut-hints";

Constants.event.getShareSources   = "get-share-sources";
Constants.event.setShareSelected  = "set-share-selected";
Constants.event.setShareCancelled = "set-share-cancelled";

const init = (lang) => {
	switch (lang) {
		case "pt-BR":
			Constants.whatsapp.profilePicture   = /foto do perfil|conversas/i;
			Constants.whatsapp.unreadText       = "Não lidas";
			Constants.whatsapp.unreadTextSearch = /[0-9]+ mensage(m|ns)? não lida(s)?/;
			break;
	}
	return Constants;
};

module.exports = { init };
