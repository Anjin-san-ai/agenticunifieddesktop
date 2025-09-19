// Athena Desktop Enhanced Script v2.3
// Responsibilities:
// 1. Initialize knowledge graph
// 2. AI Composer interactions
// 3. Grader logic (simple heuristic)
// 4. Agent Hub (presence toggle, live clock, theme switch, KPI modal placeholder)
// 5. Assist Hub dynamic mini-metrics (cognitive load pulse + sentiment sparkline)

document.addEventListener('DOMContentLoaded', () => {
	/* -------------------- Element References -------------------- */
	const chatInput = document.getElementById('chat-input');
	const sendBtn = document.getElementById('send-btn');
	const graderWidget = document.getElementById('response-grader-widget');
	const nbaComposeBtn = document.getElementById('nba-compose-btn');
	const nbaRefreshBtn = document.getElementById('nba-refresh');
	const ctaItemsContainer = document.getElementById('cta-items-container');
	const ctaRefreshBtn = document.getElementById('cta-refresh');
	const knowledgeGraphContainer = document.getElementById('knowledge-graph');
	const assistLoadBar = document.getElementById('assist-load-bar');
	const assistSentiment = document.getElementById('assist-sentiment');
	const nbaText = document.getElementById('nba-text');

	// Agent Hub
	const presenceToggle = document.getElementById('presence-toggle');
	const presenceBadge = document.getElementById('presence-badge');
	const themeToggle = document.getElementById('theme-toggle');
	const agentClock = document.getElementById('agent-clock');
	const openKpiBtn = document.getElementById('open-kpi');
		const availabilityMenu = document.querySelector('.availability-menu');
		const notifBtn = document.getElementById('notif-btn');
		const notifMenu = document.getElementById('notif-menu');
		const notifItems = document.getElementById('notif-items');
		const shiftTimerEl = document.getElementById('shift-timer');
		const aiDraftBtn = document.getElementById('ai-draft-btn');
		const qaCompose = document.getElementById('qa-compose');
		const qaKnowledge = document.getElementById('qa-knowledge');
		const qaSettings = document.getElementById('qa-settings');
		const perfCapsule = document.getElementById('perf-capsule');

	// Composer Modal
	const composerModal = document.getElementById('composer-modal');
	const composerTextarea = document.getElementById('composer-textarea');
	const composerSourceTitle = document.getElementById('composer-source-title');
	const refineEmpathyBtn = document.getElementById('refine-empathy');
	const refineConciseBtn = document.getElementById('refine-concise');
	const cancelBtn = composerModal?.querySelector('.cancel-btn');
	const insertBtn = composerModal?.querySelector('.insert-btn');

	/* -------------------- Mock / Placeholder Data -------------------- */
	const knowledgeBase = {
		BILL_HIGH: {
			id: 'kb-bill-high',
			title: 'SOP: High Bill Complaint',
			aiDraft: "Hi <span class='placeholder'>[CUSTOMER NAME]</span>, I can see you've had a frustrating week and I'm very sorry to hear that. Let's get this sorted for you.<br><br>I've reviewed your bill and the higher amount is due to a one-time charge for <span class='placeholder'>[REASON FOR CHARGE]</span>. Your base package price hasn't changed. Would you like a more detailed breakdown?",
			related: ['BILL_DATE', 'CHANGE_PLAN']
		},
		BILL_DATE: { id: 'kb-bill-date', title: 'Explaining Billing Dates', related: ['BILL_CYCLE','PRORATION'] },
		CHANGE_PLAN: { id: 'kb-change-plan', title: 'Changing a Package', related: ['UPGRADE_OPTIONS','PLAN_RULES'] },
		BILL_CYCLE: { id: 'kb-bill-cycle', title: 'Billing Cycle Basics', related: ['DIRECT_DEBIT','DUE_DATE'] },
		PRORATION: { id: 'kb-proration', title: 'Proration on Mid-Cycle Changes', related: ['ADD_ONS'] },
		UPGRADE_OPTIONS: { id: 'kb-upgrade-options', title: 'Upgrade Options', related: ['DEVICE_OFFER','LOYALTY_DISCOUNT'] },
		PLAN_RULES: { id: 'kb-plan-rules', title: 'Plan Rules & Fair Use', related: [] },
		DIRECT_DEBIT: { id: 'kb-direct-debit', title: 'Direct Debit Setup', related: [] },
		DUE_DATE: { id: 'kb-due-date', title: 'Payment Due Date', related: [] },
		ADD_ONS: { id: 'kb-add-ons', title: 'Add-ons & Charges', related: [] },
		DEVICE_OFFER: { id: 'kb-device-offer', title: 'Device Offer Eligibility', related: [] },
		LOYALTY_DISCOUNT: { id: 'kb-loyalty-discount', title: 'Loyalty Discounts', related: [] }
	};

	/* -------------------- Knowledge Graph -------------------- */
			function drawKnowledgeGraph(primaryIntent) {
			knowledgeGraphContainer.innerHTML = '';
				const data = knowledgeBase[primaryIntent];
			if (!data) return;
			// Prepare SVG
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.classList.add('kg-svg');
			svg.setAttribute('viewBox', '0 0 440 260');
			const defs = document.createElementNS(svg.namespaceURI, 'defs');
			// gradient for links
			const grad = document.createElementNS(svg.namespaceURI, 'linearGradient');
			grad.id = 'kgLinkGrad'; grad.setAttribute('x1','0%'); grad.setAttribute('x2','100%');
			const s1 = document.createElementNS(svg.namespaceURI, 'stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','#5500a9');
			const s2 = document.createElementNS(svg.namespaceURI, 'stop'); s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#e8005a');
			grad.appendChild(s1); grad.appendChild(s2);
			// glow filter
			const filter = document.createElementNS(svg.namespaceURI, 'filter'); filter.id='kgGlow';
			const fe = document.createElementNS(svg.namespaceURI, 'feDropShadow');
			fe.setAttribute('dx','0'); fe.setAttribute('dy','0'); fe.setAttribute('stdDeviation','1.5'); fe.setAttribute('flood-color','#e8d7ff'); fe.setAttribute('flood-opacity','0.8');
			filter.appendChild(fe);
			defs.appendChild(grad); defs.appendChild(filter);
			svg.appendChild(defs);
			// grid
			const grid = document.createElementNS(svg.namespaceURI, 'g'); grid.setAttribute('class','kg-grid');
			for (let x=20;x<440;x+=40){ const line = document.createElementNS(svg.namespaceURI,'line'); line.setAttribute('x1',x); line.setAttribute('y1',0); line.setAttribute('x2',x); line.setAttribute('y2',260); grid.appendChild(line); }
			for (let y=20;y<260;y+=40){ const line = document.createElementNS(svg.namespaceURI,'line'); line.setAttribute('x1',0); line.setAttribute('y1',y); line.setAttribute('x2',440); line.setAttribute('y2',y); grid.appendChild(line); }
			svg.appendChild(grid);

			const linksG = document.createElementNS(svg.namespaceURI,'g');
			const nodesG = document.createElementNS(svg.namespaceURI,'g');

			const cx = 220, cy = 130; // center
			const idToKey = Object.fromEntries(Object.entries(knowledgeBase).map(([k,v]) => [v.id, k]));
			const nodes = [{ id:data.id, title:data.title, x:cx, y:cy, primary:true }];
			const nodesSet = new Set([data.id]);
			const expandedSet = new Set();
			const r = 85; // radius for first ring
			const count = data.related.length; const angleStep = (Math.PI*2)/(Math.max(count,1));
			data.related.forEach((key, i) => {
				const n = knowledgeBase[key]; if(!n) return;
				const angle = i*angleStep - Math.PI/2; // start top
				nodes.push({ id:n.id, title:n.title, x: cx + r*Math.cos(angle), y: cy + r*Math.sin(angle), primary:false });
			});

			// links
				nodes.slice(1).forEach(n => {
				const path = document.createElementNS(svg.namespaceURI,'path');
				const mx = (n.x + cx)/2; const my = (n.y + cy)/2 - 12;
				const d = `M ${cx} ${cy} Q ${mx} ${my} ${n.x} ${n.y}`;
				path.setAttribute('d', d);
				path.setAttribute('class','kg-link');
				path.setAttribute('stroke','url(#kgLinkGrad)');
				path.setAttribute('fill','none');
					path.dataset.from = data.id; path.dataset.to = n.id;
				linksG.appendChild(path);
			});

			// nodes
				function attachNode(n){
				const g = document.createElementNS(svg.namespaceURI,'g');
				g.setAttribute('class', 'kg-node' + (n.primary?' primary':''));
				g.setAttribute('transform', `translate(${n.x},${n.y})`);
				const circle = document.createElementNS(svg.namespaceURI,'circle'); circle.setAttribute('r', n.primary? 28 : 20);
				const label = document.createElementNS(svg.namespaceURI,'text');
				label.setAttribute('text-anchor','middle'); label.setAttribute('dy', n.primary? '4' : '3');
				label.textContent = n.title;
				g.appendChild(circle); g.appendChild(label);
				nodesG.appendChild(g);
					g.addEventListener('mouseenter', () => {
					g.classList.add('highlight');
						// thicken corresponding link(s)
						linksG.querySelectorAll(`[data-to="${n.id}"]`).forEach(l => l.classList.add('highlight'));
				});
					g.addEventListener('mouseleave', () => {
					g.classList.remove('highlight');
						linksG.querySelectorAll(`[data-to="${n.id}"]`).forEach(l => l.classList.remove('highlight'));
				});
					g.addEventListener('click', () => {
						// Expand/collapse multi-hop around this node
						const key = idToKey[n.id];
						if (!key) return;
						if (expandedSet.has(n.id)) return; // simple: only expand once in this demo
						const rel = knowledgeBase[key]?.related || [];
						if (!rel.length) return;
						expandedSet.add(n.id);
						const ringR = 60; const step = (Math.PI*2)/rel.length;
						rel.forEach((rk, idx) => {
							const child = knowledgeBase[rk]; if (!child || nodesSet.has(child.id)) return;
							const ang = idx*step - Math.PI/2;
							const x = n.x + ringR*Math.cos(ang);
							const y = n.y + ringR*Math.sin(ang);
							const nodeObj = { id: child.id, title: child.title, x, y, primary:false };
							nodes.push(nodeObj); nodesSet.add(child.id);
							// link
							const path = document.createElementNS(svg.namespaceURI,'path');
							const mx = (x + n.x)/2; const my = (y + n.y)/2 - 10;
							path.setAttribute('d', `M ${n.x} ${n.y} Q ${mx} ${my} ${x} ${y}`);
							path.setAttribute('class','kg-link');
							path.setAttribute('stroke','url(#kgLinkGrad)'); path.setAttribute('fill','none');
							path.dataset.from = n.id; path.dataset.to = child.id;
							linksG.appendChild(path);
							// node
							attachNode(nodeObj);
						});
					});
				}
				nodes.forEach(attachNode);

			svg.appendChild(linksG); svg.appendChild(nodesG);
			knowledgeGraphContainer.appendChild(svg);
		}

	/* -------------------- Composer -------------------- */
	function openComposer(intent) {
		const article = knowledgeBase[intent];
		if (!article) return;
		composerTextarea.innerHTML = article.aiDraft;
		composerSourceTitle.textContent = article.title;
		document.querySelectorAll('.node.highlighted').forEach(el => el.classList.remove('highlighted'));
		const nodeEl = document.getElementById(article.id);
		if (nodeEl) nodeEl.classList.add('highlighted');
		composerModal.classList.add('open');
		composerTextarea.focus();
	}
	function closeComposer() {
		composerModal.classList.remove('open');
		document.querySelectorAll('.node.highlighted').forEach(el => el.classList.remove('highlighted'));
	}
	function insertToChat() {
		const text = composerTextarea.innerHTML
			.replace(/<br\s*[\/]?>/gi, '\n')
			.replace(/<span class="placeholder">\[.*?\]<\/span>/gi, '...');
		chatInput.value = text;
		closeComposer();
		chatInput.focus();
		gradeResponse(chatInput.value);
	}

	/* -------------------- Grader -------------------- */
	function gradeResponse(text) {
		if (!text.trim()) {
			graderWidget.classList.remove('visible');
			return;
		}
		graderWidget.classList.add('visible');
		let empathyScore = (text.match(/sorry|understand|frustrating|apologize|clarify|happy to|sorted/gi) || []).length * 40;
		const setGrade = (id, score) => {
			const el = document.getElementById(id);
			if (!el) return;
			el.style.width = Math.min(100, score) + '%';
			if (score < 40) el.style.backgroundColor = 'var(--accent-negative)';
			else if (score < 70) el.style.backgroundColor = 'var(--accent-warning)';
			else el.style.backgroundColor = 'var(--accent-positive)';
		};
		setGrade('grade-empathy', empathyScore);
		setGrade('grade-clarity', Math.max(20, 100 - (Math.abs(100 - text.length) / 2)));
		setGrade('grade-tone', 80);
	}

	function updateRadialProgress(circleId, value, spanSelector) {
		const circle = document.getElementById(circleId);
		if (!circle) return;
		const span = circle.querySelector('span');
		if (span) span.textContent = value + '%';
		let color = 'var(--accent-positive)';
		if (value < 70) color = 'var(--accent-warning)';
		if (value < 40) color = 'var(--accent-negative)';
		circle.style.background = `radial-gradient(closest-side, var(--bg-elevated) 79%, transparent 80% 100%), conic-gradient(${color} ${value}%, var(--border-soft) 0)`;
	}

	/* -------------------- Assist Hub Metrics -------------------- */
	const sentimentPoints = []; // store last N points
	function pushSentimentPoint() {
		const next = Math.round(40 + Math.random() * 40); // 40-80 arbitrary index
		sentimentPoints.push(next);
		if (sentimentPoints.length > 25) sentimentPoints.shift();
		drawSparkline();
	}
	function drawSparkline() {
		if (!assistSentiment) return;
		let canvas = assistSentiment.querySelector('canvas');
		if (!canvas) {
			canvas = document.createElement('canvas');
			assistSentiment.appendChild(canvas);
		}
		const w = assistSentiment.clientWidth || 140;
		const h = assistSentiment.clientHeight || 24;
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0,0,w,h);
		if (sentimentPoints.length < 2) return;
		const max = Math.max(...sentimentPoints);
		const min = Math.min(...sentimentPoints);
		ctx.lineWidth = 1.5;
		const gradient = ctx.createLinearGradient(0,0,w,0);
		gradient.addColorStop(0,'#5500a9');
		gradient.addColorStop(1,'#e8005a');
		ctx.strokeStyle = gradient;
		ctx.beginPath();
		sentimentPoints.forEach((val,i) => {
			const x = (i/(sentimentPoints.length-1)) * (w-2) + 1;
			const y = h - ((val - min)/(max-min || 1)) * (h-4) - 2;
			if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
		});
		ctx.stroke();
	}
	function animateCognitiveLoad() {
		if (!assistLoadBar) return;
		const target = 35 + Math.random()*55; // 35-90
		assistLoadBar.style.width = target.toFixed(0) + '%';
	}

	/* -------------------- Agent Hub Interactions -------------------- */
	const presenceStates = [
		{ cls:'presence-online', label:'Online', btn:'Online ▾' },
		{ cls:'presence-away', label:'Away', btn:'Away ▾' },
		{ cls:'presence-offline', label:'Offline', btn:'Offline ▾' }
	];
	let currentPresenceIndex = 0;
	function cyclePresence() {
		currentPresenceIndex = (currentPresenceIndex + 1) % presenceStates.length;
		const state = presenceStates[currentPresenceIndex];
		presenceBadge.className = 'presence-badge ' + state.cls;
		presenceBadge.title = state.label;
		presenceToggle.textContent = state.btn;
	}
	function updateClock() {
		const now = new Date();
		const hh = String(now.getHours()).padStart(2,'0');
		const mm = String(now.getMinutes()).padStart(2,'0');
		agentClock.textContent = hh + ':' + mm;
	}
	function toggleTheme() {
		document.body.classList.toggle('dark');
		themeToggle.textContent = document.body.classList.contains('dark') ? '☀' : '☾';
	}
	function openKpiPanel() {
		// Placeholder: could open side drawer / modal with richer KPI charts
		alert('KPI panel coming soon (drill-down performance, trends, coaching).');
	}

	/* -------------------- Events -------------------- */
	nbaComposeBtn?.addEventListener('click', () => openComposer(nbaComposeBtn.dataset.intent));
	nbaRefreshBtn?.addEventListener('click', () => {
		nbaText.textContent = 'Recomputing...';
		setTimeout(() => { nbaText.textContent = 'Acknowledge Frustration & Explain One-Time Charge'; }, 900);
	});
	cancelBtn?.addEventListener('click', closeComposer);
	insertBtn?.addEventListener('click', insertToChat);
	refineEmpathyBtn?.addEventListener('click', () => {
		composerTextarea.innerHTML = 'I want to assure you we take this seriously. ' + composerTextarea.innerHTML;
		composerTextarea.classList.add('flash');
		setTimeout(() => composerTextarea.classList.remove('flash'), 550);
	});
	refineConciseBtn?.addEventListener('click', () => {
		composerTextarea.innerHTML = composerTextarea.innerHTML.split('.').slice(0,2).join('.') + '.';
		composerTextarea.classList.add('flash');
		setTimeout(() => composerTextarea.classList.remove('flash'), 550);
	});
	ctaItemsContainer?.addEventListener('click', e => {
		const ctaItem = e.target.closest('.cta-item');
		if (ctaItem) {
			chatInput.value += (chatInput.value ? ' ' : '') + ctaItem.dataset.value;
			chatInput.focus();
			ctaItem.classList.add('clicked');
			setTimeout(() => ctaItem.classList.remove('clicked'), 500);
		}
	});
	ctaRefreshBtn?.addEventListener('click', () => {
		const badge = document.getElementById('cta-updated');
		if (badge) {
			const ts = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
			badge.textContent = 'Updated ' + ts;
			badge.classList.add('fade-in');
			setTimeout(()=>badge.classList.remove('fade-in'),400);
		}
	});
	let gradingTimeout;
	chatInput?.addEventListener('input', () => {
		clearTimeout(gradingTimeout);
		gradingTimeout = setTimeout(()=> gradeResponse(chatInput.value), 300);
	});
	sendBtn?.addEventListener('click', () => { if (chatInput.value.trim()) { chatInput.value=''; gradeResponse(''); }});
	chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }});

	presenceToggle?.addEventListener('click', cyclePresence);
	themeToggle?.addEventListener('click', toggleTheme);
	openKpiBtn?.addEventListener('click', openKpiPanel);
		aiDraftBtn?.addEventListener('click', () => openComposer('BILL_HIGH'));
	qaCompose?.addEventListener('click', () => openComposer('BILL_HIGH'));
	qaKnowledge?.addEventListener('click', () => {
		document.getElementById('kb-widget')?.scrollIntoView({behavior:'smooth'});
		const g=document.getElementById('knowledge-graph');
		if(g){ g.classList.add('flash'); setTimeout(()=>g.classList.remove('flash'),700);} 
	});
	qaSettings?.addEventListener('click', () => alert('Preferences panel coming soon (themes, density, keyboard shortcuts).'));

		// Availability dropdown (override cyclePresence to open menu if enriched design)
		if (availabilityMenu) {
			presenceToggle?.removeEventListener('click', cyclePresence);
			presenceToggle?.addEventListener('click', (e) => {
				const expanded = presenceToggle.getAttribute('aria-expanded') === 'true';
				presenceToggle.setAttribute('aria-expanded', String(!expanded));
				availabilityMenu.classList.toggle('hidden');
				if (!expanded) {
					availabilityMenu.querySelector('.availability-option')?.focus();
				}
				e.stopPropagation();
			});
			availabilityMenu.addEventListener('click', (e) => {
				const opt = e.target.closest('.availability-option');
				if (!opt) return;
				const state = opt.dataset.state;
				const map = { online:0, away:1, offline:2 };
				currentPresenceIndex = map[state] ?? 0;
				const ps = presenceStates[currentPresenceIndex];
				presenceBadge.className = 'presence-badge ' + ps.cls;
				presenceBadge.title = ps.label;
				presenceToggle.textContent = ps.btn;
				availabilityMenu.classList.add('hidden');
				presenceToggle.setAttribute('aria-expanded','false');
			});
			document.addEventListener('click', (e) => {
				if (!availabilityMenu.classList.contains('hidden')) {
					if (!availabilityMenu.contains(e.target) && e.target !== presenceToggle) {
						availabilityMenu.classList.add('hidden');
						presenceToggle.setAttribute('aria-expanded','false');
					}
				}
			});
		}

		// Notifications menu demo
		const demoNotifications = [
			{ id:1, title:'New coaching tip available', ts:'2m', unread:true },
			{ id:2, title:'Customer sentiment dipped below threshold', ts:'8m', unread:true },
			{ id:3, title:'System update scheduled tonight', ts:'1h', unread:false }
		];
		function renderNotifications() {
			if (!notifItems) return;
			notifItems.innerHTML = '';
			demoNotifications.forEach(n => {
				const div = document.createElement('div');
				div.className = 'notif-item' + (n.unread ? ' unread' : '');
				div.innerHTML = `<div>${n.title}</div><div class="notif-meta"><span>${n.ts}</span>${n.unread ? '<span>NEW</span>' : ''}</div>`;
				notifItems.appendChild(div);
			});
		}
		notifBtn?.addEventListener('click', (e) => {
			const expanded = notifBtn.getAttribute('aria-expanded') === 'true';
			notifBtn.setAttribute('aria-expanded', String(!expanded));
			notifMenu.classList.toggle('hidden');
			if (!expanded) { renderNotifications(); }
			e.stopPropagation();
		});
		document.addEventListener('click', (e) => {
			if (!notifMenu) return;
			if (!notifMenu.classList.contains('hidden')) {
				if (!notifMenu.contains(e.target) && e.target !== notifBtn) {
					notifMenu.classList.add('hidden');
					notifBtn.setAttribute('aria-expanded','false');
				}
			}
		});

		// Shift timer
		const shiftStart = Date.now();
		function updateShiftTimer() {
			if (!shiftTimerEl) return;
			const elapsed = Date.now() - shiftStart;
			const hrs = String(Math.floor(elapsed/3600000)).padStart(2,'0');
			const mins = String(Math.floor((elapsed%3600000)/60000)).padStart(2,'0');
			const secs = String(Math.floor((elapsed%60000)/1000)).padStart(2,'0');
			shiftTimerEl.textContent = `${hrs}:${mins}:${secs}`;
		}
		setInterval(updateShiftTimer, 1000);
		updateShiftTimer();

	/* -------------------- Init -------------------- */
	drawKnowledgeGraph('BILL_HIGH');
	updateRadialProgress('health-score-circle', 52);
	updateRadialProgress('fcr-score-circle', 65);
	updateClock();
	setInterval(updateClock, 60 * 1000);
	// Boot theme icon state
	themeToggle.textContent = document.body.classList.contains('dark') ? '☀' : '☾';

	// Metrics animations
	pushSentimentPoint();
	const metricsInterval = setInterval(() => {
		pushSentimentPoint();
		animateCognitiveLoad();
	}, 4000);
	animateCognitiveLoad();

	/* -------------------- Diagnostics & Enhancements -------------------- */
	// Diagnostics badge utility
	function diag(message){
		console.warn('[AthenaDiag]', message);
		let badge=document.querySelector('.diag-badge');
		if(!badge){
			badge=document.createElement('div');
			badge.className='diag-badge';
			badge.textContent='UI';
			document.body.appendChild(badge);
		}
		badge.title=message;
	}
	window.addEventListener('error', e=> diag(e.message||'Script error'));

	// Auto-resize chat textarea
	const inputWrapper=document.querySelector('.input-wrapper');
	function autoResize(el){
		if(!el) return;
		el.style.height='auto';
		const h=Math.min(110, el.scrollHeight);
		el.style.height=h+'px';
		if(h>50) inputWrapper?.classList.add('expanded'); else inputWrapper?.classList.remove('expanded');
	}
	autoResize(chatInput);
	chatInput?.addEventListener('input', ()=> autoResize(chatInput));

	// Ensure dropdown menus remain in viewport
	function ensureInViewport(el){
		if(!el||el.classList.contains('hidden')) return;
		const r=el.getBoundingClientRect();
		if(r.right>window.innerWidth){ el.style.left='auto'; el.style.right='4px'; }
		if(r.bottom>window.innerHeight){ el.style.top='auto'; el.style.bottom='4px'; }
	}
	const mo = new MutationObserver(()=> { ensureInViewport(document.querySelector('.availability-menu')); ensureInViewport(document.getElementById('notif-menu')); });
	const avail=document.querySelector('.availability-menu');
	const notif=document.getElementById('notif-menu');
	if(avail) mo.observe(avail,{attributes:true,attributeFilter:['class','style']});
	if(notif) mo.observe(notif,{attributes:true,attributeFilter:['class','style']});
	window.addEventListener('resize', ()=> { ensureInViewport(avail); ensureInViewport(notif); });

	// Sanity element presence checks
	['composer-modal','chat-input','send-btn','nba-compose-btn','ai-draft-btn'].forEach(id=>{ if(!document.getElementById(id)) diag('Missing #' + id); });

	// Metric chip hover pulse (subtle scale)
	if(perfCapsule){
		perfCapsule.querySelectorAll('.metric-chip').forEach(chip => {
			chip.addEventListener('mouseenter',()=> chip.style.transform='translateY(-2px) scale(1.04)');
			chip.addEventListener('mouseleave',()=> chip.style.transform='');
		});
	}

	// Cleanup if navigation (not needed here but good pattern)
	window.addEventListener('beforeunload', () => clearInterval(metricsInterval));
	});

