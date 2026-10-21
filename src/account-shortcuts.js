'use strict';

// Regras dos atalhos de navegação entre contas (⌘/Ctrl + 1…9) e do aviso
// que aparece quando o modificador é mantido pressionado.
//
// Módulo puro de propósito: sem `electron`, sem DOM. O processo principal usa
// as funções de acelerador/observação e a sidebar usa labelForIndex — assim a
// regra de numeração vive num lugar só e é coberta por teste.

const MAX_ACCOUNT_SHORTCUTS = 9;

// Índice 0-based na ordem da sidebar → acelerador do Electron.
// Devolve null a partir da décima conta: a numeração é fixa (1…9) e o
// excedente continua acessível por CmdOrCtrl+Tab.
function acceleratorForIndex(index) {
	if (!Number.isInteger(index) || index < 0) return null;
	if (index >= MAX_ACCOUNT_SHORTCUTS) return null;
	return `CmdOrCtrl+${index + 1}`;
}

// Mesma numeração, para desenhar sobre o avatar na sidebar.
function labelForIndex(index) {
	const accelerator = acceleratorForIndex(index);
	return accelerator ? accelerator.slice("CmdOrCtrl+".length) : null;
}

// Tecla modificadora que revela os números. Mac = Cmd (Meta); Windows/Linux
// = Ctrl. Option/Alt ficaria de fora de propósito: no macOS Option+dígito é
// camada de caractere (¡ ™ £) e o atalho comeria esses caracteres em todo
// campo de texto do app.
function holdModifierKey(platform = process.platform) {
	return platform === 'darwin' ? 'Meta' : 'Control';
}

// Decide o que fazer com um evento de `before-input-event`.
//   true  → mostrar os números
//   false → esconder
//   null  → ignorar (o evento não diz nada sobre o modificador)
//
// A regra é "o modificador está pressionado agora?", lida nas flags do próprio
// evento. Não basta reagir só ao modificador: ao apertar ⌘1 o evento é do "1"
// (com meta=true) e o aviso precisa continuar aceso enquanto o ⌘ não soltar.
//
// O keyUp do modificador não é confiável: ao trocar de app com ⌘+Tab o macOS
// entrega o keyUp para o outro app. Por isso o estado também é limpo no blur
// da janela (ver createWindow) e por qualquer evento que já venha com a flag
// do modificador em false.
function shortcutHintState(input, platform = process.platform) {
	if (!input || typeof input !== 'object') return null;

	const modifier = holdModifierKey(platform);
	const flag = modifier === 'Meta' ? 'meta' : 'control';

	const isKeyEvent = input.type === 'keyDown' || input.type === 'rawKeyDown' || input.type === 'keyUp';
	if (!isKeyEvent) return null;

	// Na própria tecla modificadora a flag vem false — o campo descreve os
	// OUTROS modificadores. É o único caso em que a resposta não está nas flags.
	if (input.key === modifier) return input.type !== 'keyUp';

	return input[flag] === true;
}

// Rótulo do item de menu. O nome da conta vem do store e é do usuário, então
// não pode quebrar o acelerador nem virar texto vazio.
function menuLabel(index, name) {
	const label = labelForIndex(index);
	const title = String(name == null ? '' : name).trim() || 'Conta sem nome';
	return label ? `${label} — ${title}` : title;
}

module.exports = {
	MAX_ACCOUNT_SHORTCUTS,
	acceleratorForIndex,
	labelForIndex,
	holdModifierKey,
	shortcutHintState,
	menuLabel
};
