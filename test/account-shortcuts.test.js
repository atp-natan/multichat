'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
	MAX_ACCOUNT_SHORTCUTS,
	acceleratorForIndex,
	labelForIndex,
	holdModifierKey,
	shortcutHintState,
	menuLabel
} = require('../src/account-shortcuts');

test('numera as nove primeiras contas na ordem da sidebar', () => {
	assert.strictEqual(acceleratorForIndex(0), 'CmdOrCtrl+1');
	assert.strictEqual(acceleratorForIndex(1), 'CmdOrCtrl+2');
	assert.strictEqual(acceleratorForIndex(8), 'CmdOrCtrl+9');
});

test('não cria acelerador a partir da décima conta', () => {
	assert.strictEqual(acceleratorForIndex(MAX_ACCOUNT_SHORTCUTS), null);
	assert.strictEqual(acceleratorForIndex(99), null);
	assert.strictEqual(labelForIndex(MAX_ACCOUNT_SHORTCUTS), null);
});

test('índice inválido não vira atalho', () => {
	for (const bad of [-1, 1.5, NaN, null, undefined, '2'])
		assert.strictEqual(acceleratorForIndex(bad), null);
});

test('a etiqueta na sidebar é só o dígito', () => {
	assert.strictEqual(labelForIndex(0), '1');
	assert.strictEqual(labelForIndex(8), '9');
});

test('o modificador é Cmd no macOS e Ctrl no resto', () => {
	assert.strictEqual(holdModifierKey('darwin'), 'Meta');
	assert.strictEqual(holdModifierKey('win32'), 'Control');
	assert.strictEqual(holdModifierKey('linux'), 'Control');
});

test('manter o modificador mostra os números', () => {
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: 'Meta' }, 'darwin'), true);
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: 'Control' }, 'win32'), true);
});

test('soltar o modificador esconde os números', () => {
	assert.strictEqual(shortcutHintState({ type: 'keyUp', key: 'Meta' }, 'darwin'), false);
});

test('apertar ⌘1 com o ⌘ ainda preso mantém os números na tela', () => {
	// Este é o caso que quebrava: o evento é do "1", não do Cmd. A flag meta
	// diz que o modificador continua pressionado, então o aviso fica aceso.
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: '1', meta: true }, 'darwin'), true);
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: '9', meta: true }, 'darwin'), true);
	// O keyUp do "1" chega com meta=true também (o Cmd ainda está preso).
	assert.strictEqual(shortcutHintState({ type: 'keyUp', key: '1', meta: true }, 'darwin'), true);
	// Mesma coisa no Windows/Linux com Ctrl.
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: '2', control: true }, 'win32'), true);
});

test('tecla sem o modificador esconde, porque o keyUp pode se perder', () => {
	// Cmd+Tab leva o keyUp do Cmd para o outro app; o keyDown sem a flag
	// encerra o estado aqui.
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: 'Tab', meta: true }, 'darwin'), true);
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: 'Escape', meta: false }, 'darwin'), false);
	assert.strictEqual(shortcutHintState({ type: 'keyDown', key: 'a', meta: false }, 'darwin'), false);
});

test('eventos irrelevantes não mexem no estado', () => {
	assert.strictEqual(shortcutHintState(null), null);
	assert.strictEqual(shortcutHintState({}), null);
	assert.strictEqual(shortcutHintState({ type: 'char', key: 'a' }), null);
	assert.strictEqual(shortcutHintState({ type: 'mouseDown' }), null);
});

test('rótulo do menu leva o número junto do nome', () => {
	assert.strictEqual(menuLabel(0, 'Trabalho'), '1 — Trabalho');
	assert.strictEqual(menuLabel(3, 'Pessoal'), '4 — Pessoal');
});

test('nome vazio ou ausente não quebra o rótulo', () => {
	assert.strictEqual(menuLabel(0, '   '), '1 — Conta sem nome');
	assert.strictEqual(menuLabel(0, null), '1 — Conta sem nome');
});

test('conta além da nona aparece no menu sem número', () => {
	assert.strictEqual(menuLabel(MAX_ACCOUNT_SHORTCUTS, 'Décima'), 'Décima');
});
