'use strict';

// Testa a parte pura do gerador de rascunho (scripts/gen-whats-new.js).
// O script é CLI, então as funções são exercitadas via require indireto:
// ele roda main() ao ser carregado, então os casos aqui cobrem o
// comportamento ponta a ponta com git stub e arquivos temporários.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gen-whats-new.js');

// Repositório git descartável com os commits informados.
const makeRepo = (commits) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multichat-gen-'));
	const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
	git('init', '-q');
	git('config', 'user.email', 'test@example.test');
	git('config', 'user.name', 'Teste');
	git('config', 'commit.gpgsign', 'false');
	for (const [index, message] of commits.entries()) {
		git('commit', '-q', '--allow-empty', '-m', message);
		if (index === 0) git('tag', 'v1.7.1');
	}
	// O script resolve package.json/constants/whats-new.json a partir de
	// __dirname do próprio arquivo; por isso o repo de teste recebe uma cópia
	// do script no mesmo layout relativo de scripts/../src.
	fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
	fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'gen-whats-new.js'));
	fs.copyFileSync(path.join(ROOT, 'src', 'release-notes.js'), path.join(dir, 'src', 'release-notes.js'));
	fs.copyFileSync(path.join(ROOT, 'src', 'update-check.js'), path.join(dir, 'src', 'update-check.js'));
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.8.0' }, null, 2));
	return dir;
};

const run = (dir, args = []) => {
	try {
		const stdout = execFileSync(process.execPath, [path.join(dir, 'scripts', 'gen-whats-new.js'), ...args], {
			cwd: dir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.status || 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
	}
};

test('gerador cria rascunho com destaques a partir dos commits feat/fix', () => {
	const dir = makeRepo(['feat: base', 'feat: atalhos por conta', 'fix: corrige foco do assistente']);
	const result = run(dir);
	assert.equal(result.code, 0, result.stderr);
	const doc = JSON.parse(fs.readFileSync(path.join(dir, 'src', 'whats-new.json'), 'utf8'));
	const entry = doc.releases.find((release) => release.version === '1.8.0');
	assert.ok(entry, 'entrada da 1.8.0 não foi criada');
	assert.equal(entry.draft, true);
	assert.equal(entry.highlights.length, 2);
	// Mais recente primeiro: é a ordem em que `git log` devolve e a que o
	// mantenedor naturalmente revisa ("o que acabou de entrar").
	assert.deepEqual(entry.highlights.map((h) => h.title), ['Corrige foco do assistente', 'Atalhos por conta']);
	assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('commits de chore/docs/test ficam fora do rascunho', () => {
	const dir = makeRepo(['feat: base', 'chore: release 1.8.0', 'docs: atualiza README', 'ci: matrix']);
	const result = run(dir);
	assert.equal(result.code, 1, 'sem nenhum destaque o script deve falhar em vez de gravar entrada vazia');
	assert.match(result.stderr, /Nenhum commit/);
});

test('--check falha quando a versão não está no JSON', () => {
	const dir = makeRepo(['feat: base']);
	const result = run(dir, ['--check']);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /não tem entrada válida/);
});

test('--check falha enquanto a entrada estiver marcada como rascunho', () => {
	const dir = makeRepo(['feat: base', 'feat: algo novo']);
	run(dir);
	const result = run(dir, ['--check']);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /draft/);
});

test('--check passa quando o rascunho foi reescrito e o draft removido', () => {
	const dir = makeRepo(['feat: base', 'feat: algo novo']);
	run(dir);
	const file = path.join(dir, 'src', 'whats-new.json');
	const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
	delete doc.releases[0].draft;
	doc.releases[0].highlights[0].body = 'Texto em linguagem de produto.';
	fs.writeFileSync(file, JSON.stringify(doc, null, '\t'));
	const result = run(dir, ['--check']);
	assert.equal(result.code, 0, result.stderr);
	assert.match(result.stdout, /cobre a 1\.8\.0/);
});

test('não sobrescreve entrada já publicada (só com --force)', () => {
	const dir = makeRepo(['feat: base', 'feat: algo novo']);
	run(dir);
	const file = path.join(dir, 'src', 'whats-new.json');
	const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
	delete doc.releases[0].draft;
	doc.releases[0].highlights[0].title = 'Texto curado à mão';
	fs.writeFileSync(file, JSON.stringify(doc, null, '	'));

	const blocked = run(dir);
	assert.equal(blocked.code, 1);
	assert.match(blocked.stderr, /já tem entrada publicada/);
	const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.equal(kept.releases[0].highlights[0].title, 'Texto curado à mão');

	const forced = run(dir, ['--force']);
	assert.equal(forced.code, 0, forced.stderr);
	const overwritten = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.equal(overwritten.releases[0].highlights[0].title, 'Algo novo');
});

test('o JSON real do repositório passa no --check', () => {
	const result = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
	assert.match(result, /cobre a 1\.\d+\.\d+/);
});
