'use strict';

// Conteúdo do popup "Novidades da versão".
//
// Módulo puro (sem `electron`, sem DOM) para poder ser testado em Node, no
// mesmo espírito de update-check.js e account-shortcuts.js: a leitura, a
// validação do formato e a decisão de QUAIS versões mostrar ficam aqui; o
// processo principal só abre a janela e a sidebar/renderer só desenha.
//
// Fontes do conteúdo:
//   src/whats-new.json            → texto curado, versionado junto com o código
//   scripts/gen-whats-new.js      → gera um rascunho a partir dos commits
//
// Regra de exibição (ver selectReleases):
//   - usuário atualizado     → versões entre lastSeenVersion (exclusivo) e a
//                              versão atual (inclusivo). Quem pulou a 1.7.0 e
//                              a 1.7.1 vê as três versões numa só passada.
//   - instalação nova        → nada (o app acabou de ser instalado, não houve
//                              atualização; a tela inicial já se explica).
//   - primeira atualização   → só a versão atual (sem histórico anterior).
//     com a feature (não
//     existe lastSeenVersion)
//   - no máximo MAX_HIGHLIGHTS telas por versão: popup de atualização não é
//     changelog, é recado curto.

const { parseVersion, compareVersions } = require('./update-check');

const MAX_RELEASES_SHOWN = 3;
const MAX_HIGHLIGHTS = 6;
const MAX_BULLETS = 3;
const DEFAULT_ICON = 'bi-stars';

const ICON_PATTERN = /^bi-[a-z0-9-]{1,40}$/;
const KEY_PATTERN = /^[a-z0-9⌘⇧⌥⏎⎋→←↑↓+]{1,6}$/i;

const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

const slug = (value) =>
	String(value == null ? '' : value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);

const versionOf = (raw) => {
	const parsed = parseVersion(raw);
	if (!parsed) return null;
	const core = parsed.numbers.join('.');
	return parsed.pre ? `${core}-${parsed.pre}` : core;
};

const normalizeKeys = (raw) => {
	if (!Array.isArray(raw)) return [];
	const keys = [];
	for (const key of raw) {
		const value = String(key == null ? '' : key).trim().toLowerCase();
		if (!value || !KEY_PATTERN.test(value)) continue;
		keys.push(value);
		if (keys.length >= 4) break;
	}
	return keys;
};

const normalizeBullets = (raw) => {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => text(item, 160))
		.filter(Boolean)
		.slice(0, MAX_BULLETS);
};

// Um destaque precisa de título e de texto: sem isso a tela fica vazia e o
// popup não vale a interrupção. Destaques inválidos são descartados em vez de
// derrubar a lista inteira — um erro de digitação no JSON não pode impedir o
// app de abrir.
const normalizeHighlight = (raw, index = 0) => {
	if (!raw || typeof raw !== 'object') return null;
	const position = Number.isInteger(index) && index >= 0 ? index : 0;
	const title = text(raw.title, 90);
	const body = text(raw.body, 320);
	if (!title || !body) return null;
	return {
		id: slug(raw.id) || `destaque-${position + 1}`,
		icon: ICON_PATTERN.test(String(raw.icon || '')) ? String(raw.icon) : DEFAULT_ICON,
		title,
		body,
		bullets: normalizeBullets(raw.bullets),
		keys: normalizeKeys(raw.keys),
		// `demo: "modifier"` faz os keycaps acenderem quando o usuário segura
		// ⌘/Ctrl na própria janela — demonstração sem sair do popup.
		demo: raw.demo === 'modifier' ? 'modifier' : null
	};
};

const normalizeRelease = (raw) => {
	if (!raw || typeof raw !== 'object') return null;
	const version = versionOf(raw.version);
	if (!version) return null;
	const seen = new Set();
	const highlights = [];
	for (const item of Array.isArray(raw.highlights) ? raw.highlights : []) {
		const highlight = normalizeHighlight(item, highlights.length);
		if (!highlight) continue;
		if (seen.has(highlight.id)) continue;
		seen.add(highlight.id);
		highlights.push(highlight);
		if (highlights.length >= MAX_HIGHLIGHTS) break;
	}
	if (highlights.length === 0) return null;
	return {
		version,
		date: text(raw.date, 10) || null,
		title: text(raw.title, 80) || `Novidades da ${version}`,
		highlights
	};
};

// Documento inteiro → releases normalizadas, das mais novas para as mais
// velhas. Entradas repetidas (mesma versão) mantêm a primeira.
const normalizeDocument = (raw) => {
	const source = raw && typeof raw === 'object' ? raw : {};
	const releases = [];
	const seen = new Set();
	for (const item of Array.isArray(source.releases) ? source.releases : []) {
		const release = normalizeRelease(item);
		if (!release || seen.has(release.version)) continue;
		seen.add(release.version);
		releases.push(release);
	}
	releases.sort((a, b) => compareVersions(b.version, a.version));
	return { schema: Number(source.schema) || 1, releases };
};

// Quais versões merecem popup agora. Devolve da mais antiga para a mais nova:
// a leitura natural é "isto chegou na 1.7.0, depois na 1.7.1, depois na 1.8.0".
//
// Sem `lastSeenVersion` (primeira vez que o app roda com esta feature), mostra
// só a versão atual: é a que o usuário acabou de instalar/atualizar. Histórico
// de versões anteriores só aparece para quem tem o registro do que já viu.
const selectReleases = (raw, { currentVersion, lastSeenVersion = null, isFreshInstall = false } = {}) => {
	if (isFreshInstall) return [];
	const current = versionOf(currentVersion);
	if (!current) return [];

	const { releases } = normalizeDocument(raw);
	// Versão em desenvolvimento (código-fonte rodando à frente do JSON) e
	// pré-lançamento não geram popup de histórico.
	const eligible = releases.filter((release) => compareVersions(release.version, current) <= 0);
	if (eligible.length === 0) return [];

	const lastSeen = versionOf(lastSeenVersion);
	if (!lastSeen) return eligible.filter((release) => release.version === current);

	const pending = eligible.filter((release) => compareVersions(release.version, lastSeen) > 0);
	return pending.slice(0, MAX_RELEASES_SHOWN).reverse();
};

// Vira uma lista linear de telas: cada destaque é uma tela, com a etiqueta da
// versão a que pertence.
const flattenSlides = (releases) => {
	const slides = [];
	for (const release of Array.isArray(releases) ? releases : []) {
		release.highlights.forEach((highlight, index) => {
			slides.push({
				...highlight,
				version: release.version,
				releaseTitle: release.title,
				position: index + 1,
				total: release.highlights.length
			});
		});
	}
	return slides;
};

// Usado pelo scripts/gen-whats-new.js --check e pelo teste: uma versão não
// pode sair sem entrada no JSON (é o mesmo papel do teste que impede
// package.json e constants.js de divergirem).
const coversVersion = (raw, version) => {
	const wanted = versionOf(version);
	if (!wanted) return false;
	const { releases } = normalizeDocument(raw);
	return releases.some((release) => release.version === wanted);
};

module.exports = {
	MAX_RELEASES_SHOWN,
	MAX_HIGHLIGHTS,
	DEFAULT_ICON,
	versionOf,
	normalizeHighlight,
	normalizeRelease,
	normalizeDocument,
	selectReleases,
	flattenSlides,
	coversVersion
};
