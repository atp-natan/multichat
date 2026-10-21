#!/usr/bin/env node
// Gera o rascunho de uma entrada em src/whats-new.json a partir dos commits.
//
// Uso:
//   node scripts/gen-whats-new.js                 # versão do package.json
//   node scripts/gen-whats-new.js 1.8.0           # versão específica
//   node scripts/gen-whats-new.js --from v1.7.1   # base do diff de commits
//   node scripts/gen-whats-new.js --check         # só valida, não escreve (CI)
//
// O rascunho NÃO é publicado como está: ele nasce com o título de cada commit
// convencional (feat/fix/perf) e um corpo vazio, para o mantenedor reescrever
// em linguagem de produto. O que o script garante é o que não pode falhar por
// esquecimento: a entrada da versão existir, ter data e ter destaques válidos.
//
// --check (usado no CI) falha se a versão atual não tiver entrada válida no
// JSON — o mesmo papel do teste que impede package.json e constants.js de
// divergirem.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { normalizeDocument, coversVersion, versionOf } = require('../src/release-notes');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const DOC_PATH = path.join(ROOT, 'src', 'whats-new.json');

// Tipos de commit que viram destaque. `chore`, `ci`, `docs`, `test` e `style`
// não interessam a quem usa o app — ficam de fora do rascunho por padrão.
const TYPE_LABEL = {
	feat: 'Novidade',
	feat_: 'Novidade',
	fix: 'Correção',
	perf: 'Desempenho',
	refactor: 'Melhoria interna'
};
const INCLUDED_TYPES = new Set(['feat', 'fix', 'perf']);

// `icon` sugerido por tipo — o mantenedor troca se quiser.
const TYPE_ICON = {
	feat: 'bi-stars',
	fix: 'bi-bug',
	perf: 'bi-lightning-charge'
};

const MAX_DRAFT_HIGHLIGHTS = 6;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const git = (args) => {
	try {
		return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
};

const hasGit = () => git(['rev-parse', '--is-inside-work-tree']) === 'true';

// Tag da versão anterior: a mais recente que não é a versão atual.
const previousTag = (currentVersion, explicit) => {
	if (explicit) return explicit;
	if (!hasGit()) return null;
	const tags = git(['tag', '--sort=-v:refname']).split('\n').filter(Boolean);
	const wanted = `v${versionOf(currentVersion) || currentVersion}`;
	return tags.find((tag) => tag !== wanted && tag !== wanted.replace(/^v/, '')) || null;
};

// Commits desde a tag anterior, já parseados no formato convencional.
const collectCommits = (fromTag) => {
	if (!hasGit()) return [];
	const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
	const raw = git(['log', range, '--no-merges', '--pretty=format:%s%x1f%b%x1e']);
	if (!raw) return [];

	const commits = [];
	for (const record of raw.split('\x1e')) {
		const block = record.trim();
		if (!block) continue;
		const [subject, ...bodyParts] = block.split('\x1f');
		const body = bodyParts.join('\x1f').trim();
		const match = String(subject || '').match(/^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/);
		if (!match) continue;
		const type = match[1].toLowerCase();
		if (!INCLUDED_TYPES.has(type)) continue;
		commits.push({ type, scope: match[2] || null, subject: match[3].trim(), body });
	}
	return commits;
};

const sentence = (value) => {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	return text.charAt(0).toUpperCase() + text.slice(1);
};

// Sugestão para a mensagem de erro: próximo patch da versão informada.
const nextPatchHint = (version) => {
	const numbers = String(versionOf(version) || '').split('.').map(Number);
	if (numbers.length !== 3 || numbers.some((n) => !Number.isFinite(n))) return '1.8.0';
	return `${numbers[0]}.${numbers[1]}.${numbers[2] + 1}`;
};

// Rascunho: um destaque por commit relevante. `body` fica com a descrição do
// commit (quando existe) para o mantenedor não perder o contexto do "porquê".
const buildDraft = (version, commits) => {
	const highlights = commits.slice(0, MAX_DRAFT_HIGHLIGHTS).map((commit, index) => {
		const title = sentence(commit.subject).replace(/\.$/, '');
		const firstParagraph = commit.body.split(/\n{2,}/)[0].replace(/\s+/g, ' ').trim();
		return {
			id: `${commit.type}-${index + 1}`,
			icon: TYPE_ICON[commit.type] || 'bi-stars',
			title: title.slice(0, 90),
			body: (firstParagraph || `${TYPE_LABEL[commit.type]}: ${title}`).slice(0, 320),
			bullets: [],
			keys: []
		};
	});
	return {
		version: versionOf(version),
		date: new Date().toISOString().slice(0, 10),
		title: `Novidades da ${versionOf(version)}`,
		draft: true, // marcador para o mantenedor: apagar depois de reescrever
		highlights
	};
};

const insertRelease = (document, release) => {
	const next = document && typeof document === 'object' ? { ...document } : { schema: 1, releases: [] };
	if (!Array.isArray(next.releases)) next.releases = [];
	next.releases = [release, ...next.releases.filter((item) => versionOf(item && item.version) !== release.version)];
	return next;
};

// Entrada já publicada (sem draft) para a mesma versão: sobrescrever apagaria
// texto de produto escrito à mão. Só com --force.
const publishedEntry = (document, version) => {
	const wanted = versionOf(version);
	const entries = document && Array.isArray(document.releases) ? document.releases : [];
	return entries.find((item) => versionOf(item && item.version) === wanted && item.draft !== true) || null;
};

const checkDocument = (document, version) => {
	const wanted = versionOf(version);
	if (!wanted) {
		console.error(`Versão inválida: ${version}`);
		return false;
	}
	if (!coversVersion(document, wanted)) {
		console.error(`✖ src/whats-new.json não tem entrada válida para a ${wanted}.`);
		console.error('  Rode `npm run whats-new` e escreva os destaques antes de taguear.');
		return false;
	}
	const { releases } = normalizeDocument(document);
	const release = releases.find((item) => item.version === wanted);
	const count = release ? release.highlights.length : 0;

	// `draft: true` é rascunho saído dos commits: publicar assim entrega
	// changelog técnico ("feat: ...") no popup do usuário final.
	const entries = Array.isArray(document.releases) ? document.releases : [];
	const rawEntry = entries.find((item) => versionOf(item && item.version) === wanted);
	if (rawEntry && rawEntry.draft === true) {
		console.error(`✖ A entrada da ${wanted} ainda está marcada como rascunho (draft: true).`);
		console.error('  Reescreva os destaques em linguagem de produto e remova o campo "draft".');
		return false;
	}

	console.log(`✔ whats-new.json cobre a ${wanted} com ${count} destaque(s).`);
	return true;
};

const main = () => {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const fromIndex = args.indexOf('--from');
	const explicitBase = fromIndex >= 0 ? args[fromIndex + 1] : null;
	const versionArg = args.filter((arg, index) => !arg.startsWith('--') && !(fromIndex >= 0 && index === fromIndex + 1))[0];

	const pkg = readJson(PKG_PATH);
	const version = versionArg || pkg.version;

	let document = { schema: 1, releases: [] };
	if (fs.existsSync(DOC_PATH)) document = readJson(DOC_PATH);

	if (check) {
		process.exit(checkDocument(document, version) ? 0 : 1);
	}

	const base = previousTag(version, explicitBase);
	const commits = collectCommits(base);
	if (commits.length === 0) {
		console.error(`Nenhum commit feat/fix/perf encontrado${base ? ` em ${base}..HEAD` : ''}.`);
		console.error('Escreva a entrada à mão em src/whats-new.json ou revise o padrão dos commits.');
		process.exit(1);
	}

	// Guarda-corpo: a versão do package.json normalmente já foi publicada, e
	// regenerar sobrescreveria o texto de produto. O rascunho é para a versão
	// que vai sair agora — a que ainda não tem entrada.
	if (publishedEntry(document, version) && !args.includes('--force')) {
		console.error(`✖ A ${versionOf(version)} já tem entrada publicada em src/whats-new.json.`);
		console.error('  Rode com --force para sobrescrever (o texto escrito à mão será perdido),');
		console.error(`  ou gere para outra versão: node scripts/gen-whats-new.js ${nextPatchHint(version)}`);
		process.exit(1);
	}

	const release = buildDraft(version, commits);
	fs.writeFileSync(DOC_PATH, `${JSON.stringify(insertRelease(document, release), null, '\t')}\n`);

	console.log(`Rascunho da ${release.version} gravado em src/whats-new.json (${release.highlights.length} destaque(s)).`);
	if (base) console.log(`Commits de ${base}..HEAD — ${commits.length} relevante(s).`);
	console.log('\nPróximos passos:');
	console.log('  1. Reescreva os títulos/corpos em linguagem de produto (npm run whats-new:preview)');
	console.log('  2. Remova "draft": true da entrada');
	console.log('  3. npm test && npm run whats-new:check');
};

main();
