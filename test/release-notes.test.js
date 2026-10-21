'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
	MAX_HIGHLIGHTS,
	DEFAULT_ICON,
	versionOf,
	normalizeHighlight,
	normalizeRelease,
	normalizeDocument,
	selectReleases,
	flattenSlides,
	coversVersion
} = require('../src/release-notes');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'whats-new.json'), 'utf8'));

const FIXTURE = {
	schema: 1,
	releases: [
		{
			version: '1.6.0',
			title: 'Novidades da 1.6.0',
			highlights: [{ id: 'a', title: 'Um', body: 'Corpo um' }]
		},
		{
			version: '1.7.0',
			title: 'Novidades da 1.7.0',
			highlights: [
				{ id: 'b', title: 'Dois', body: 'Corpo dois' },
				{ id: 'c', title: 'Três', body: 'Corpo três' }
			]
		},
		{
			version: '1.8.0',
			title: 'Novidades da 1.8.0',
			highlights: [{ id: 'd', title: 'Quatro', body: 'Corpo quatro' }]
		}
	]
};

test('versionOf normaliza prefixo v e sufixo de build', () => {
	assert.equal(versionOf('v1.7.1'), '1.7.1');
	assert.equal(versionOf('1.8.0+sha'), '1.8.0');
	assert.equal(versionOf('1.9.0-beta.2'), '1.9.0-beta.2');
	assert.equal(versionOf('sem-versao'), null);
});

test('destaque sem título ou sem corpo é descartado', () => {
	assert.equal(normalizeHighlight({ title: 'Só título' }), null);
	assert.equal(normalizeHighlight({ body: 'Só corpo' }), null);
	assert.equal(normalizeHighlight(null), null);
	assert.equal(normalizeHighlight({ title: '  ', body: 'x' }), null);
});

test('destaque válido ganha id, ícone padrão e listas vazias', () => {
	const h = normalizeHighlight({ title: 'Trocar de conta', body: 'Segure ⌘' });
	assert.equal(h.id, 'destaque-1');
	assert.equal(h.icon, DEFAULT_ICON);
	assert.deepEqual(h.bullets, []);
	assert.deepEqual(h.keys, []);
	assert.equal(h.demo, null);
});

test('ícone fora do padrão cai para o padrão (sem injetar classe arbitrária)', () => {
	const h = normalizeHighlight({ title: 'T', body: 'B', icon: '"><script>' });
	assert.equal(h.icon, DEFAULT_ICON);
	assert.equal(normalizeHighlight({ title: 'T', body: 'B', icon: 'bi-keyboard' }).icon, 'bi-keyboard');
});

test('bullets e keys são limitados e sanitizados', () => {
	const h = normalizeHighlight({
		title: 'T',
		body: 'B',
		bullets: ['um', 'dois', 'três', 'quatro'],
		keys: ['1', '2', '3', '4', '5', '<b>']
	});
	assert.equal(h.bullets.length, 3);
	assert.deepEqual(h.keys, ['1', '2', '3', '4']);
});

test('uma release sem destaque válido não entra', () => {
	assert.equal(normalizeRelease({ version: '1.7.0', highlights: [] }), null);
	assert.equal(normalizeRelease({ version: 'sem-versao', highlights: [{ title: 'a', body: 'b' }] }), null);
	assert.equal(normalizeRelease({ version: '1.7.0', highlights: [{ title: 'a', body: 'b' }] }).title, 'Novidades da 1.7.0');
});

test('documento ordena por versão e ignora versões repetidas', () => {
	const doc = normalizeDocument({
		releases: [
			FIXTURE.releases[0],
			FIXTURE.releases[2],
			FIXTURE.releases[1],
			FIXTURE.releases[1]
		]
	});
	assert.deepEqual(doc.releases.map((r) => r.version), ['1.8.0', '1.7.0', '1.6.0']);
	assert.equal(normalizeDocument(null).releases.length, 0);
	assert.equal(normalizeDocument({}).schema, 1);
});

test('quem pulou versões vê todas as pendentes, da mais antiga para a mais nova', () => {
	const releases = selectReleases(FIXTURE, { currentVersion: '1.8.0', lastSeenVersion: '1.6.0' });
	assert.deepEqual(releases.map((r) => r.version), ['1.7.0', '1.8.0']);
});

test('já visto nesta versão não gera popup', () => {
	assert.deepEqual(selectReleases(FIXTURE, { currentVersion: '1.8.0', lastSeenVersion: '1.8.0' }), []);
});

test('primeira vez com a feature mostra só a versão atual (sem histórico)', () => {
	const releases = selectReleases(FIXTURE, { currentVersion: '1.8.0', lastSeenVersion: null });
	assert.deepEqual(releases.map((r) => r.version), ['1.8.0']);
});

test('instalação nova não mostra nada', () => {
	assert.deepEqual(selectReleases(FIXTURE, { currentVersion: '1.7.0', lastSeenVersion: null, isFreshInstall: true }), []);
});

test('versão em desenvolvimento à frente do JSON não mostra popup', () => {
	assert.deepEqual(selectReleases(FIXTURE, { currentVersion: '1.9.0', lastSeenVersion: '1.8.0' }), []);
});

test('pré-lançamento não anuncia a versão estável seguinte', () => {
	// Rodando 1.8.0-beta.1, a 1.8.0 ainda não "chegou": só se anuncia o que é
	// <= a versão instalada.
	const releases = selectReleases(FIXTURE, { currentVersion: '1.8.0-beta.1', lastSeenVersion: '1.6.0' });
	assert.deepEqual(releases.map((r) => r.version), ['1.7.0']);
});

test('no máximo três versões por popup', () => {
	const many = {
		releases: ['1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0'].map((version, i) => ({
			version,
			highlights: [{ id: `h${i}`, title: `T${i}`, body: `B${i}` }]
		}))
	};
	const releases = selectReleases(many, { currentVersion: '1.8.0', lastSeenVersion: '1.3.0' });
	assert.equal(releases.length, 3);
	assert.deepEqual(releases.map((r) => r.version), ['1.6.0', '1.7.0', '1.8.0']);
});

test('flattenSlides transforma destaques em telas com etiqueta de versão', () => {
	const slides = flattenSlides(selectReleases(FIXTURE, { currentVersion: '1.7.0', lastSeenVersion: '1.6.0' }));
	assert.equal(slides.length, 2);
	assert.deepEqual(slides.map((s) => [s.version, s.id, s.position, s.total]), [
		['1.7.0', 'b', 1, 2],
		['1.7.0', 'c', 2, 2]
	]);
	assert.equal(slides[0].releaseTitle, 'Novidades da 1.7.0');
});

test('o JSON real cobre a versão do package.json', () => {
	assert.ok(coversVersion(document, pkg.version), `src/whats-new.json não tem entrada para ${pkg.version}`);
});

test('o JSON real está normalizado sem perdas e dentro dos limites', () => {
	const doc = normalizeDocument(document);
	assert.equal(doc.releases.length, document.releases.length, 'alguma release do JSON foi descartada na validação');
	for (const release of document.releases) {
		assert.ok(release.highlights.length <= MAX_HIGHLIGHTS, `${release.version} passa do limite de destaques`);
	}
	// Todo destaque declarado precisa sobreviver: perda silenciosa aqui é popup
	// com tela faltando.
	const declared = document.releases.reduce((sum, r) => sum + r.highlights.length, 0);
	const kept = doc.releases.reduce((sum, r) => sum + r.highlights.length, 0);
	assert.equal(kept, declared);
});

test('toda release do JSON tem data ISO e ids únicos', () => {
	const ids = new Set();
	for (const release of document.releases) {
		assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `${release.version} sem data ISO`);
		for (const highlight of release.highlights) {
			assert.ok(highlight.id, `${release.version}: destaque sem id`);
			assert.ok(!ids.has(highlight.id), `id repetido: ${highlight.id}`);
			ids.add(highlight.id);
			assert.ok(highlight.title.length <= 90);
			assert.ok(highlight.body.length <= 320);
		}
	}
});
