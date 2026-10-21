// Lógica do popup de novidades (renderer, sem Node).
//
// Recebe do processo principal as telas já achatadas (ver release-notes.js →
// flattenSlides) e só cuida de: desenhar a tela atual, navegar com teclado,
// acender os keycaps quando o modificador é mantido (demo de atalho) e avisar
// o main quando o usuário termina.
'use strict';

(() => {
	const $ = (id) => document.getElementById(id);
	const state = { slides: [], index: 0, demo: null };

	const applyTheme = (dark) => document.body.classList.toggle('theme-dark', !!dark);

	const renderDots = () => {
		const dots = $('dots');
		dots.innerHTML = '';
		state.slides.forEach((slide, index) => {
			const dot = document.createElement('button');
			dot.className = `dot-nav${index === state.index ? ' active' : ''}`;
			dot.title = `${slide.releaseTitle} — ${slide.title}`;
			dot.setAttribute('aria-label', `Tela ${index + 1} de ${state.slides.length}`);
			dot.addEventListener('click', () => go(index));
			dots.appendChild(dot);
		});
	};

	const renderDemo = (slide) => {
		const box = $('demo');
		const caps = $('keycaps');
		const hint = $('demo-hint');
		caps.innerHTML = '';
		hint.innerHTML = '';

		const hasKeys = Array.isArray(slide && slide.keys) && slide.keys.length > 0;
		if (!hasKeys) {
			box.hidden = true;
			state.demo = null;
			document.body.classList.remove('modifier-down');
			return;
		}

		box.hidden = false;
		state.demo = slide.demo;

		// ⌘ no macOS, Ctrl no resto — mesmo critério de account-shortcuts.js
		// (holdModifierKey), repetido aqui porque o renderer é sandboxed.
		const modifier = isMac ? '⌘' : 'Ctrl';
		const cap = (label, kind) => {
			const el = document.createElement('span');
			el.className = `keycap${kind ? ` ${kind}` : ''}`;
			el.textContent = label;
			return el;
		};

		// Um atalho só: ⌘ + 1. A faixa é o texto (1…9), não o desenho.
		caps.appendChild(cap(modifier, 'modifier'));
		caps.appendChild(cap('+', 'plus'));
		caps.appendChild(cap(slide.keys[0]));

		const sample = slide.keys[0];
		const hold = isMac ? '⌘' : 'Ctrl';
		hint.innerHTML = slide.demo === 'modifier'
			? `Segure <span class="hint-key">${hold}</span> agora: os números aparecem nos avatares.`
			: `Segure <span class="hint-key">${hold}</span> e aperte <span class="hint-key">${sample}</span>.`;
	};

	const render = () => {
		const slide = state.slides[state.index];
		if (!slide) return;

		$('eyebrow').textContent = state.slides.length > 1 ? `Novidade ${state.index + 1} de ${state.slides.length}` : 'Novidade';
		$('release-title').textContent = slide.releaseTitle;
		$('icon').className = `bi ${slide.icon}`;
		$('title').textContent = slide.title;
		$('body').textContent = slide.body;

		const bullets = $('bullets');
		bullets.innerHTML = '';
		for (const item of slide.bullets || []) {
			const li = document.createElement('li');
			li.textContent = item;
			bullets.appendChild(li);
		}

		renderDemo(slide);
		renderDots();

		const isLast = state.index >= state.slides.length - 1;
		$('version-tag').textContent = `v${slide.version}`;
		$('back').disabled = state.index === 0;
		$('next').textContent = isLast ? 'Começar a usar' : 'Próximo';
	};

	const go = (index) => {
		const target = Math.max(0, Math.min(state.slides.length - 1, index));
		if (target === state.index) return;
		state.index = target;
		render();
	};

	const finish = () => {
		if (window.whatsNew && window.whatsNew.dismiss) window.whatsNew.dismiss();
	};

	const next = () => {
		if (state.index >= state.slides.length - 1) finish();
		else go(state.index + 1);
	};

	// ── Demo do atalho ──
	// Apertar o modificador na própria janela acende os keycaps: o usuário vê
	// o gesto antes de usar. Nunca preventDefault (ver comentário equivalente em
	// main.js → attachShortcutHints: mataria aceleradores do menu).
	const isMac = navigator.platform.toLowerCase().includes('mac');
	const modifierKey = isMac ? 'Meta' : 'Control';
	const modifierFlag = (event) => (isMac ? event.metaKey : event.ctrlKey);

	window.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') { finish(); return; }
		if (event.key === 'ArrowRight' || event.key === 'Enter') {
			// Com o modificador pressionado o gesto é demo, não navegação.
			if (!modifierFlag(event)) { next(); event.preventDefault(); }
			return;
		}
		if (event.key === 'ArrowLeft') { go(state.index - 1); event.preventDefault(); return; }

		if (state.demo !== 'modifier') return;
		// Na própria tecla modificadora a flag ainda vem false — é o único caso
		// em que a resposta está em event.key.
		if (event.key === modifierKey || modifierFlag(event))
			document.body.classList.add('modifier-down');
	});

	window.addEventListener('keyup', (event) => {
		if (event.key === modifierKey || !modifierFlag(event))
			document.body.classList.remove('modifier-down');
	});

	// Alt-tab / clique fora: o keyup do modificador vai para outro app e os
	// keycaps ficariam acesos para sempre.
	window.addEventListener('blur', () => document.body.classList.remove('modifier-down'));

	$('next').addEventListener('click', next);
	$('back').addEventListener('click', () => go(state.index - 1));
	$('close').addEventListener('click', finish);

	if (window.whatsNew) {
		if (window.whatsNew.onUiTheme) window.whatsNew.onUiTheme(applyTheme);
		window.whatsNew.getState().then((payload) => {
			state.slides = (payload && payload.slides) || [];
			if (state.slides.length === 0) { finish(); return; }
			applyTheme(!!(payload && payload.dark));
			state.index = 0;
			render();
		}).catch(() => finish());
	}
})();
