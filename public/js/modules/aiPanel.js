// AI Panel Module
// Handles: AI Summary, Next Best Action, Resolution Predictor, Live Prompts, Knowledge Graph

// Element references (queried once on module load)
const summaryWidget = document.getElementById('ai-summary');
const summaryText = summaryWidget?.querySelector('.summary-text');
const nbaWidget = document.getElementById('nba-widget');
const nbaText = nbaWidget?.querySelector('.nba-text');
const nbaButton = document.getElementById('nba-compose-btn');
const resolutionWidget = document.getElementById('resolution-predictor');
const fcrCircle = document.getElementById('fcr-score-circle');
const fcrValueEl = document.getElementById('fcr-value');
const fcrLabel = document.getElementById('fcr-label');
const fcrNotes = document.getElementById('fcr-notes');
const ctaWidget = document.getElementById('cta-prompter');
const ctaContainer = document.getElementById('cta-items-container');
const kbWidget = document.getElementById('kb-widget');
const knowledgeGraph = document.getElementById('knowledge-graph');
const servicePedia = document.getElementById('service-pedia');
const servicePediaSummary = document.getElementById('service-pedia-summary');
const servicePediaDetails = document.getElementById('service-pedia-details');
let servicePediaArticlesContainer = null; // created lazily for V2
let selectedArticleId = null;
// Removed articleCache usage per requirement: always fetch fresh detail
const articleCache = null; // placeholder (unused)
let currentArticleFetchSeq = 0; // incrementing sequence to prevent stale overwrite
let latestServicePediaV2 = null;
let latestLiveResponse = null;
let draftBtn = null;
// Agent network elements
const agentNetworkWidget = document.getElementById('agent-network');
const agentNetworkActionsEl = document.getElementById('agent-network-actions');
const agentNetworkResultsEl = document.getElementById('agent-network-results');
let latestAgentActions = null;
let executingActionId = null;
let liveResponseRefinedFrom = null;
let executedActionsCache = [];
let refreshActionsBtn = null;
console.debug('[AI Panel] module loaded', {
	hasAgentNetworkWidget: !!document.getElementById('agent-network'),
	hasResultsEl: !!document.getElementById('agent-network-results'),
	hasActionsEl: !!document.getElementById('agent-network-actions')
});
// collapse toggle handled via ensureServicePediaCollapseControl();
function ensureServicePediaCollapseControl(){
	if (!servicePediaDetails || !servicePedia) return;
	if (servicePedia.querySelector('.sp-toggle')) return;
	const header = servicePedia.querySelector('h3');
	if (!header) return;
	const btn = document.createElement('button');
	btn.className = 'sp-toggle';
	btn.textContent = 'Collapse';
	btn.addEventListener('click', () => {
		const collapsed = servicePediaDetails.classList.toggle('collapsed');
		if (collapsed){
			servicePediaDetails.style.maxHeight = servicePediaDetails.scrollHeight+'px';
			requestAnimationFrame(()=>{ servicePediaDetails.style.maxHeight='0px'; });
			btn.textContent='Expand';
		}else{
			servicePediaDetails.style.maxHeight = servicePediaDetails.scrollHeight+'px';
			setTimeout(()=>{ servicePediaDetails.style.maxHeight=''; }, 320);
			btn.textContent='Collapse';
		}
	});
		header.appendChild(btn);
}

// Removed legacy mini Sentiment/Risk widgets from the top of AI panel
// (superseded by the enriched Sentiment & Risk widget in index.html)

// Composer modal references (cross-module but kept simple)
const composerModal = document.getElementById('composer-modal');
const composerTextarea = document.getElementById('composer-textarea');
const composerSourceTitle = document.getElementById('composer-source-title');
// New transform controls
const transformSelect = document.getElementById('composer-transform');
const transformBtn = document.getElementById('composer-transform-btn');
const cancelBtn = composerModal.querySelector('.cancel-btn');
const insertBtn = composerModal.querySelector('.insert-btn');

function removeLoading(widget) {
	widget?.querySelectorAll('.loading-block').forEach(el => el.remove());
	return widget;
}

// Update functions
function updateSummary(data) {
	if (!summaryWidget || !data) return;
	removeLoading(summaryWidget);
	summaryText.textContent = data.summary;
	summaryText.classList.remove('hidden');
}

function updateNba(data) {
	if (!nbaWidget || !data) return;
	removeLoading(nbaWidget);
	let html = `<strong>${data.title||'Action'}</strong>`;
	if (Array.isArray(data.guidedSteps) && data.guidedSteps.length){
		// Support both string steps and object steps with optional sources
		const renderStep = (step) => {
			if (typeof step === 'string') return `<li>${step}</li>`;
			if (!step || typeof step !== 'object') return '';
			const text = step.text || step.title || step.label || '';
			// Support flat or nested source metadata
			const srcObj = step.source || step.ref || null;
			const srcType = ((srcObj?.type ?? srcObj?.sourceType ?? step.sourceType) || '').toLowerCase();
			const srcId = (srcObj?.id ?? srcObj?.sourceId ?? step.sourceId ?? step.articleId ?? step.actionId) || '';
			const srcTitle = (srcObj?.title ?? step.sourceTitle) || '';
			let srcBadge = '';
			if (srcType && srcId){
				const label = srcType === 'article' ? `Article ${srcId}` : srcType === 'action' ? `Action ${srcId}` : `${step.sourceType} ${srcId}`;
				srcBadge = `<span class="step-source" title="${srcTitle||label}">${label}</span>`;
			}
			return `<li>${text} ${srcBadge}</li>`;
		};
		html += '<ol class="nba-steps">' + data.guidedSteps.slice(0,5).map(renderStep).join('') + '</ol>';
	}
	nbaText.innerHTML = html;
	nbaText.classList.remove('hidden');
	nbaButton.dataset.intent = data.intentKey;
	nbaButton.dataset.opening = data.suggestedOpening || '';
	nbaButton.dataset.rationale = data.rationale || '';
	nbaButton.dataset.risk = data.riskIfIgnored || '';
	nbaButton.classList.remove('hidden');
}

function updateResolutionPredictor(data) {
	if (!resolutionWidget || !data) return;
	removeLoading(resolutionWidget);
	const radialWrapper = resolutionWidget.querySelector('.radial-progress-widget');
	radialWrapper.classList.remove('hidden');
	const value = data.fcr;
	fcrValueEl.textContent = value + '%';
	fcrLabel.textContent = value > 70 ? 'High Chance' : value > 50 ? 'Moderate Chance' : 'Low Chance';
	fcrNotes.textContent = data.notes;
	let color = 'var(--accent-positive)';
	if (value < 70) color = 'var(--accent-warning)';
	if (value < 40) color = 'var(--accent-negative)';
	fcrCircle.style.background = `radial-gradient(closest-side, white 79%, transparent 80% 100%), conic-gradient(${color} ${value}%, var(--border-soft) 0)`;
}

function updateLivePrompts(data) {
	if (!ctaWidget) return;
	removeLoading(ctaWidget);
	ctaContainer.innerHTML = '';
	if (!Array.isArray(data) || data.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'error-badge';
		empty.style.background = 'var(--bt-purple-light)';
		empty.style.color = 'var(--bt-purple)';
		empty.textContent = 'No live prompts available';
		ctaContainer.appendChild(empty);
		ctaContainer.classList.remove('hidden');
		return;
	}
	data.forEach((p,i) => {
		if (!p) return;
		let label = (p.label || p.value || 'Prompt').trim();
		if (/^label$/i.test(label)) label = (p.value || 'Prompt').trim();
		if (/^value$/i.test(label)) label = (p.label || p.value || 'Prompt').trim();
		const div = document.createElement('div');
		div.className = 'prompt-item live-fade-in';
		div.style.animationDelay = (i*60)+'ms';
		div.dataset.value = p.value || p.label || '';
		div.textContent = label;
		ctaContainer.appendChild(div);
	});
	ctaContainer.classList.remove('hidden');
	// Emit event so NBA can be recomputed with new coaching context
	window.dispatchEvent(new CustomEvent('livePromptsUpdated', { detail: data }));
}

function updateKnowledgeGraph(data) {
	if (!kbWidget || !data) return;
	removeLoading(kbWidget);
	knowledgeGraph.innerHTML = '';
	// SVG radial graph with glass styling
	const W = knowledgeGraph.clientWidth || 440;
	const H = 260;
	const cx = Math.round(W/2), cy = Math.round(H/2);
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('kg-svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	// defs: gradients + glows + arrow marker
	const defs = document.createElementNS(svg.namespaceURI,'defs');
	// Link gradient
	const linkGrad = document.createElementNS(svg.namespaceURI,'linearGradient');
	linkGrad.id = 'kgLinkGrad'; linkGrad.setAttribute('x1','0%'); linkGrad.setAttribute('x2','100%');
	const lg1 = document.createElementNS(svg.namespaceURI,'stop'); lg1.setAttribute('offset','0%'); lg1.setAttribute('stop-color','#5500a9');
	const lg2 = document.createElementNS(svg.namespaceURI,'stop'); lg2.setAttribute('offset','100%'); lg2.setAttribute('stop-color','#e8005a');
	linkGrad.appendChild(lg1); linkGrad.appendChild(lg2);
	// Node radial gradient (reused)
	const nodeGrad = document.createElementNS(svg.namespaceURI,'radialGradient');
	nodeGrad.id = 'kgNodeGrad'; nodeGrad.setAttribute('cx','50%'); nodeGrad.setAttribute('cy','50%'); nodeGrad.setAttribute('r','60%');
	const ng1 = document.createElementNS(svg.namespaceURI,'stop'); ng1.setAttribute('offset','0%'); ng1.setAttribute('stop-color','#ffffff');
	const ng2 = document.createElementNS(svg.namespaceURI,'stop'); ng2.setAttribute('offset','100%'); ng2.setAttribute('stop-color','#f2ebff');
	nodeGrad.appendChild(ng1); nodeGrad.appendChild(ng2);
	// Soft glow filter
	const glow = document.createElementNS(svg.namespaceURI,'filter'); glow.id='kgGlow';
	const fe = document.createElementNS(svg.namespaceURI,'feDropShadow');
	fe.setAttribute('dx','0'); fe.setAttribute('dy','0'); fe.setAttribute('stdDeviation','1.6'); fe.setAttribute('flood-color','#e8d7ff'); fe.setAttribute('flood-opacity','0.85');
	glow.appendChild(fe);
	// Arrow marker
	const marker = document.createElementNS(svg.namespaceURI,'marker');
	marker.id = 'kgArrow'; marker.setAttribute('markerWidth','8'); marker.setAttribute('markerHeight','8');
	marker.setAttribute('refX','6'); marker.setAttribute('refY','3.5'); marker.setAttribute('orient','auto');
	const arrowPath = document.createElementNS(svg.namespaceURI,'path');
	arrowPath.setAttribute('d','M0,0 L7,3.5 L0,7 Z');
	arrowPath.setAttribute('fill','#bb88ff'); arrowPath.setAttribute('opacity','0.9');
	marker.appendChild(arrowPath);
	defs.appendChild(linkGrad); defs.appendChild(nodeGrad); defs.appendChild(glow); defs.appendChild(marker);
	svg.appendChild(defs);
	// grid
	const grid = document.createElementNS(svg.namespaceURI,'g'); grid.setAttribute('class','kg-grid');
	for (let x=20;x<W;x+=40){ const l = document.createElementNS(svg.namespaceURI,'line'); l.setAttribute('x1',x); l.setAttribute('y1',0); l.setAttribute('x2',x); l.setAttribute('y2',H); grid.appendChild(l); }
	for (let y=20;y<H;y+=40){ const l = document.createElementNS(svg.namespaceURI,'line'); l.setAttribute('x1',0); l.setAttribute('y1',y); l.setAttribute('x2',W); l.setAttribute('y2',y); grid.appendChild(l); }
	svg.appendChild(grid);
	// layers
	const linksG = document.createElementNS(svg.namespaceURI,'g');
	const nodesG = document.createElementNS(svg.namespaceURI,'g');
	// nodes data
	const primary = { id: 'primary', title: data.primary?.title || 'Primary', x: cx, y: cy, primary: true };
	const related = Array.isArray(data.related) ? data.related.slice(0,8) : [];
	const r = Math.min(100, Math.max(70, Math.min(cx, cy) - 40));
	const step = (Math.PI*2) / Math.max(related.length || 1, 1);
	const nodes = [primary];
	related.forEach((rel, i) => {
		const angle = i*step - Math.PI/2;
		nodes.push({ id: `rel-${i}`, title: rel.title || 'Related', x: cx + r*Math.cos(angle), y: cy + r*Math.sin(angle), primary: false });
	});
	// links
	nodes.slice(1).forEach(n => {
		const path = document.createElementNS(svg.namespaceURI,'path');
		const mx = (n.x + cx)/2; const my = (n.y + cy)/2 - 12;
		path.setAttribute('d', `M ${cx} ${cy} Q ${mx} ${my} ${n.x} ${n.y}`);
		path.setAttribute('class','kg-link animate');
		path.setAttribute('stroke','url(#kgLinkGrad)');
		path.setAttribute('fill','none');
		path.setAttribute('marker-end','url(#kgArrow)');
		path.dataset.to = n.id;
		linksG.appendChild(path);
	});
	// helpers
	function wrapTitleLines(text, maxChars=14, maxLines=2){
		const words = (text||'').split(/\s+/);
		const lines = [];
		let line = '';
		for (const w of words){
			if ((line + ' ' + w).trim().length <= maxChars) {
				line = (line? line+' ': '') + w;
			} else {
				if (line) lines.push(line);
				line = w;
				if (lines.length >= maxLines-1) break;
			}
		}
		if (line && lines.length < maxLines) lines.push(line);
		if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
			// indicate truncation
			lines[lines.length-1] = lines[lines.length-1].replace(/\.?$/, '…');
		}
		return lines;
	}
	function addNode(n){
		const g = document.createElementNS(svg.namespaceURI,'g');
		g.setAttribute('class', 'kg-node' + (n.primary?' primary':''));
		g.setAttribute('transform', `translate(${n.x},${n.y})`);
		// Ring (halo)
		const ring = document.createElementNS(svg.namespaceURI,'circle'); ring.setAttribute('class','ring'); ring.setAttribute('r', n.primary? 32 : 22);
		ring.setAttribute('stroke','rgba(85,0,169,.35)'); ring.setAttribute('fill','none');
		// Core
		const core = document.createElementNS(svg.namespaceURI,'circle'); core.setAttribute('class','core'); core.setAttribute('r', n.primary? 26 : 18);
		core.setAttribute('fill','url(#kgNodeGrad)'); core.setAttribute('stroke','rgba(255,255,255,.7)');
		// Text (multi-line with tspans)
		const t = document.createElementNS(svg.namespaceURI,'text'); t.setAttribute('text-anchor','middle'); t.setAttribute('dy', n.primary? '2' : '1');
		const lines = wrapTitleLines(n.title, n.primary? 16 : 14, 2);
		lines.forEach((lineText, idx) => {
			const tsp = document.createElementNS(svg.namespaceURI,'tspan');
			tsp.setAttribute('x','0');
			if (idx > 0) tsp.setAttribute('dy','1.1em');
			tsp.textContent = lineText;
			t.appendChild(tsp);
		});
		g.appendChild(ring); g.appendChild(core); g.appendChild(t);
		// Subtle pulse on primary
		if (n.primary){
			const pulse = document.createElementNS(svg.namespaceURI,'circle');
			pulse.setAttribute('class','pulse'); pulse.setAttribute('r', 36);
			pulse.setAttribute('fill','rgba(85,0,169,.08)');
			g.insertBefore(pulse, ring);
		}
		g.addEventListener('mouseenter', ()=>{
			g.classList.add('highlight');
			linksG.querySelectorAll(`[data-to="${n.id}"]`).forEach(el=> el.classList.add('highlight'));
		});
		g.addEventListener('mouseleave', ()=>{
			g.classList.remove('highlight');
			linksG.querySelectorAll(`[data-to="${n.id}"]`).forEach(el=> el.classList.remove('highlight'));
		});
		nodesG.appendChild(g);
	}
	nodes.forEach(addNode);
	svg.appendChild(linksG); svg.appendChild(nodesG);
	knowledgeGraph.appendChild(svg);
	knowledgeGraph.classList.remove('hidden');
}

function updateServicePedia(data) {
	if (!servicePedia || !data) return;
	// Detect V2 schema (articles array) vs legacy
	const isV2 = Array.isArray(data.articles);
	servicePediaSummary.classList.remove('loading-block');
	servicePediaSummary.textContent = data.summary || data.title || 'No summary available.';
	// Clear detail view on every new payload (new context) and reset selection
	servicePediaDetails.innerHTML = '';
	servicePediaDetails.classList.add('hidden');
	selectedArticleId = null;
	if (!isV2 && data.details) {
		data.details.forEach(d => {
			const p = document.createElement('p');
			p.innerHTML = `<strong>${d.label}:</strong> ${d.value}`;
			servicePediaDetails.appendChild(p);
		});
		servicePediaDetails.classList.remove('hidden');
	}
	if (isV2) {
		latestServicePediaV2 = data;
		window.latestServicePediaV2 = data;
		if (!servicePediaArticlesContainer) {
			servicePediaArticlesContainer = document.createElement('div');
			servicePediaArticlesContainer.className = 'sp-articles fade-in';
			servicePedia.appendChild(servicePediaArticlesContainer);
		}
		servicePediaArticlesContainer.innerHTML = '';
		if (data.articles.length === 0) {
			const empty = document.createElement('div');
			empty.id = 'service-pedia-articles-empty';
			empty.textContent = 'No contextual articles found.';
			servicePediaArticlesContainer.appendChild(empty);
		} else {
			data.articles.forEach(a => {
				const card = document.createElement('div');
				card.className = 'sp-article';
				if (a.id === data.recommendedArticleId) card.classList.add('recommended');
				card.innerHTML = `<div class="confidence">${a.confidence||'—'}</div><p class="title">${a.title}</p><p class="snippet">${a.snippet}</p>`;
				card.dataset.articleId = a.id;
				card.addEventListener('click', () => handleArticleCardClick(a, card));
				servicePediaArticlesContainer.appendChild(card);
			});
		}
	}
}

function handleArticleCardClick(article, card){
	// Update selection highlight immediately
	Array.from(servicePediaArticlesContainer.querySelectorAll('.sp-article.selected')).forEach(el=>el.classList.remove('selected'));
	card.classList.add('selected');
	selectedArticleId = article.id;
	// Track current article id on container for race-safe rendering
	servicePediaDetails.dataset.currentArticleId = article.id;
	// Always clear & fetch fresh (no cache reuse)
	servicePediaDetails.classList.remove('hidden');
	servicePediaDetails.innerHTML = `<div class="article-loading" data-article-id="${article.id}" style="font-size:.6rem;color:var(--text-secondary);margin-bottom:4px;">Loading: ${article.title}</div><div class=\"loading-block\" style=\"height:32px\"></div>`;
	// Start guarded fetch
	const seq = ++currentArticleFetchSeq;
	fetchAndDisplayArticle(article, seq);
	ensureServicePediaCollapseControl();
}
async function fetchAndDisplayArticle(article, seqGuard){
	servicePediaDetails.classList.remove('hidden');
	// (Do not overwrite if a placeholder already set by click handler)
	try {
		const body = { customerId: (window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['SERVICE_PEDIA_ARTICLE'], extraVarsMap: { SERVICE_PEDIA_ARTICLE: { ARTICLE_ID: article.id, ARTICLE_TITLE: article.title, ARTICLE_SNIPPET: article.snippet } } };
		const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
		const json = await resp.json();
		if (json.SERVICE_PEDIA_ARTICLE){
			const art = json.SERVICE_PEDIA_ARTICLE;
			// Enforce exact id/title from the clicked card to prevent topic drift UI inconsistency
			art.id = article.id;
			art.title = article.title;
			// Basic topic consistency check: compare major nouns in requested vs returned title
			const tokenize = s => (s||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>3);
			const requestedTokens = tokenize(article.title).slice(0,6);
			const returnedTokens = tokenize(art.title).slice(0,8);
			const domainSynonyms = [ ['broadband','speed','wifi','router'], ['tv','settop','box','decoder'] ];
			function sameDomain(aTokens,bTokens){
				return domainSynonyms.some(group => group.some(g=>aTokens.includes(g)) && group.some(g=>bTokens.includes(g)));
			}
			const overlap = requestedTokens.filter(t=>returnedTokens.includes(t));
			if (requestedTokens.length && overlap.length === 0 && !sameDomain(requestedTokens, returnedTokens)) {
				art.summary = '[WARNING: Topic drift detected] ' + (art.summary||'');
			}
			// Stale guard: only apply if this request matches latest
			if (seqGuard && seqGuard !== currentArticleFetchSeq) return art; // discard stale
			// Render only if article still selected (no caching)
			if (selectedArticleId === article.id && servicePediaDetails.dataset.currentArticleId === article.id.toString()) {
				servicePediaDetails.innerHTML = '';
				servicePediaDetails.innerHTML = renderArticleDetail(art);
				attachArticleComposeHandler(art);
			}
		} else {
			if (!seqGuard || seqGuard === currentArticleFetchSeq) servicePediaDetails.innerHTML = '<div class="error-badge">Article not retrieved.</div>';
		}
	} catch(e){
		if (!seqGuard || seqGuard === currentArticleFetchSeq) servicePediaDetails.innerHTML = '<div class="error-badge">Error loading article.</div>';
	}
	return null;
}

function renderArticleDetail(art){
	const sections = (art.sections||[]).map(s=>`<div class=\"article-section\"><h5>${s.heading}</h5><p>${s.body}</p></div>`).join('');
	const steps = (art.steps||[]).map(st=>`<li>${st}</li>`).join('');
	const tags = (art.tags||[]).map(t=>`<span class=\"article-tag\">${t}</span>`).join('');
	return `<div class=\"article-detail\">\n<div class=\"article-header\"><strong>${art.title}</strong><div class=\"article-tags\">${tags}</div></div>\n<p class=\"article-summary\">${art.summary||''}</p>\n<div class=\"article-sections\">${sections}</div>\n<div class=\"article-steps\"><h5>Steps</h5><ol>${steps}</ol></div>\n<div style=\"margin-top:6px;\"><button class=\"article-compose-btn\">Compose From Article</button></div></div>`;
}

function attachArticleComposeHandler(art){
	const composeBtn = servicePediaDetails.querySelector('.article-compose-btn');
	composeBtn?.addEventListener('click', ()=> composeReplyFromArticle(art));
}

async function composeReplyFromArticle(art){
	if (composerModal.classList.contains('loading')) return;
	composerModal.classList.remove('hidden');
	composerSourceTitle.textContent = `KB Draft (${art.id})`;
	composerTextarea.innerHTML = '<span class="placeholder">Generating draft from article...</span>';
	composerModal.classList.add('loading');
	try {
		const body = { customerId: (window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['SERVICE_PEDIA_COMPOSE'], extraVarsMap:{ SERVICE_PEDIA_COMPOSE: { ARTICLE_ID: art.id, ARTICLE_TITLE: art.title, ARTICLE_SUMMARY: art.summary||'', ARTICLE_STEPS: art.steps||[] } } };
		const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
		const json = await resp.json();
		if (json.SERVICE_PEDIA_COMPOSE?.draft) {
			composerTextarea.innerHTML = json.SERVICE_PEDIA_COMPOSE.draft;
		} else if (json.SERVICE_PEDIA_COMPOSE?.error) {
			composerTextarea.innerHTML = `<span class="error-badge">Compose error: ${json.SERVICE_PEDIA_COMPOSE.error}</span>`;
		} else {
			composerTextarea.innerHTML = '<span class="error-badge">No draft generated.</span>';
		}
	} catch(e){
		composerTextarea.innerHTML = '<span class="error-badge">Failed to generate draft.</span>';
	} finally {
		composerModal.classList.remove('loading');
		composerTextarea.focus();
	}
}

function updateLiveResponse(data){
	if (!data) return;
	latestLiveResponse = data;
	if (!draftBtn) return; // created in init
	// enable button now that we have a model available
	draftBtn.disabled = false;
}

function markExecutedBadges(){
	if (!agentNetworkActionsEl) return;
	const executedIds = new Set(executedActionsCache.map(a=>a.id));
	Array.from(agentNetworkActionsEl.children).forEach(child=>{
		const id = child.dataset.actionId;
		if (executedIds.has(id)) {
			child.classList.add('executed');
			if (!child.querySelector('.exec-badge')){
				const badge = document.createElement('span');
				badge.className = 'exec-badge';
				badge.textContent = 'done';
				child.appendChild(badge);
			}
		}
	});
}

const agentProviderSelect = document.getElementById('agent-provider');
function getSelectedProvider(){
	const saved = localStorage.getItem('agentProvider');
	if (!agentProviderSelect && saved) return saved;
	const v = (agentProviderSelect?.value || saved || 'neurosan').toLowerCase();
	return v === 'openai' ? 'openai' : 'neurosan';
}

async function refreshAgentActions(){
	if (refreshActionsBtn) refreshActionsBtn.disabled = true;
	try {
	// Always plan with standard LLM (OpenAI) per requirement; don't send provider override here
	const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ customerId:(window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['AGENT_NETWORK_ACTIONS'] }) });
		const json = await resp.json();
		if (json.AGENT_NETWORK_ACTIONS) updateAgentNetworkActions(json.AGENT_NETWORK_ACTIONS);
	} catch(e){ console.warn('refresh actions failed', e); }
	finally { if (refreshActionsBtn) refreshActionsBtn.disabled = false; }
}

function updateAgentNetworkActions(data){
	if (!agentNetworkWidget || !agentNetworkActionsEl || !data) return;
	const actions = data.actions || [];
	console.debug('[AI Panel] updateAgentNetworkActions', { count: actions.length, executedCount: (data.executedActions||[]).length });
	executedActionsCache = data.executedActions || executedActionsCache;
	latestAgentActions = actions;
	// remove loading
	agentNetworkWidget.querySelectorAll('.loading-block').forEach(el=>el.remove());
	agentNetworkActionsEl.innerHTML='';
	if (!actions.length){
		agentNetworkActionsEl.classList.remove('hidden');
		agentNetworkActionsEl.textContent = 'No actions suggested.';
		return;
	}
	actions.forEach(a=>{
		const div = document.createElement('div');
		div.className = 'prompt-item';
		div.dataset.actionId = a.id;
		div.innerHTML = `<strong>${a.title}</strong><br/><span style="font-size:.6rem;color:var(--text-secondary)">${a.rationale}</span>`;
		div.title = a.query;
		div.addEventListener('click', ()=> executeAgentAction(a));
		agentNetworkActionsEl.appendChild(div);
	});
	agentNetworkActionsEl.classList.remove('hidden');
	markExecutedBadges();
	// Emit event for NBA recompute
	window.dispatchEvent(new CustomEvent('agentActionsUpdated', { detail: latestAgentActions }));
}

async function executeAgentAction(action){
	if (executingActionId) return; // single-flight
	executingActionId = action.id;
	agentNetworkResultsEl.classList.remove('hidden');
	agentNetworkResultsEl.innerHTML = `<div style=\"display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;\">`
		+ `<div style=\"font-size:.6rem;color:var(--text-secondary);\">Executing: ${action.title}</div>`
		+ `<button id=\"agent-cancel-btn\" style=\"font-size:.6rem;background:transparent;color:var(--text-secondary);border:1px solid var(--border-soft);padding:2px 6px;border-radius:6px;\">Cancel</button>`
		+ `</div>`
		+ `<div class=\"progress\"><div class=\"progress-fill\" id=\"agent-progress-fill\" style=\"width:5%\"></div></div>`;
	console.debug('[AI Panel] executeAgentAction mounted progress UI', { actionId: action.id, title: action.title });
	let pct = 5;
	const progEl = () => document.getElementById('agent-progress-fill');
	// Setup abort controller for cancellation
	const controller = new AbortController();
	const cancelBtnEl = document.getElementById('agent-cancel-btn');
	cancelBtnEl?.addEventListener('click', () => {
		console.debug('[AI Panel] cancel clicked');
		try { controller.abort(); } catch(_){}
	});
	// Smooth progress; keep indicating even beyond ~90s while awaiting response
	const startTs = Date.now();
	const targetMaxMs = 90000; // 90s soft cap towards ~92%
	let longRunNoted = false;
	const timer = setInterval(()=>{
		const elapsed = Date.now() - startTs;
		// Ease out towards 92% over the wait period
		const t = Math.min(1, elapsed / targetMaxMs);
		const eased = 92 * (1 - Math.pow(1 - t, 2));
		pct = Math.max(pct, eased);
		if (progEl()) progEl().style.width = pct + '%';
		// After 30s, show a subtle note that the operation is still running
		if (!longRunNoted && elapsed > 30000) {
			longRunNoted = true;
			const note = document.createElement('div');
			note.style.cssText = 'margin-top:6px;font-size:.55rem;color:var(--text-secondary);';
			note.textContent = 'Still running… large network action may take up to ~90s';
			agentNetworkResultsEl.appendChild(note);
			console.debug('[AI Panel] long-run note appended at ~30s');
		}
		// Beyond 90s, nudge gently up to 96% with tiny increments
		if (elapsed > targetMaxMs) {
			pct = Math.min(96, pct + 0.15);
			if (progEl()) progEl().style.width = pct + '%';
			if (Math.floor(elapsed/5000) % 3 === 0) console.debug('[AI Panel] >90s progress nudge', { pct: Math.round(pct) });
		}
	}, 400);
	try {
	// Execute via selected provider (default Neuro‑San). Composer/LIVE_RESPONSE remains standard LLM server-side.
	const providerMap = { AGENT_NETWORK_EXECUTE: getSelectedProvider() };
	console.debug('[AI Panel] executing with provider', providerMap.AGENT_NETWORK_EXECUTE);
	const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, signal: controller.signal, body: JSON.stringify({ customerId:(window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['AGENT_NETWORK_EXECUTE','LIVE_RESPONSE'], extraVarsMap: { AGENT_NETWORK_EXECUTE: { ACTION_QUERY: action.query, ACTION_ID: action.id }, LIVE_RESPONSE: { ACTION_QUERY: action.query } }, providerMap }) });
	console.debug('[AI Panel] fetch issued /api/v1/get-insights (execute)');
		const json = await resp.json();
		console.debug('[AI Panel] fetch completed', { hasExecute: !!json.AGENT_NETWORK_EXECUTE, hasLiveResponse: !!json.LIVE_RESPONSE });
		if (json.AGENT_NETWORK_EXECUTE){
			const r = json.AGENT_NETWORK_EXECUTE;
			r.actionId = action.id; // associate
			r.findings = r.findings || [];
				agentNetworkResultsEl.innerHTML = `<div style=\"font-weight:600;font-size:.65rem;margin-bottom:4px;\">${r.summary||'Execution complete'}</div>` +
				`<ul style="list-style:none;padding:0;margin:0;">${r.findings.map(f=>`<li style=\"padding:2px 0;font-size:.6rem;\"><strong>${f.label}:</strong> ${f.value}</li>`).join('')}</ul>` +
					`<div style="margin-top:4px;font-size:.55rem;color:var(--text-secondary);">Confidence: ${r.confidence||'—'}</div>` +
					(r.shortDescription ? `<div style=\"margin-top:2px;font-size:.55rem;color:var(--text-secondary);\"><em>${r.shortDescription}</em></div>` : '') +
					`<div style=\"margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;\">`+
					`<button id=\"agent-insert-btn\">Insert to Chat</button>`+
					`<button id=\"agent-compose-btn\" style=\"background:var(--bt-purple);\">Open in Composer</button>`+
					`</div>`;
				const insertBtnLocal = agentNetworkResultsEl.querySelector('#agent-insert-btn');
				insertBtnLocal.addEventListener('click', ()=>{
					// Build a clean, formatted message with numbered steps and bullet findings
					const lines = [];
					if (r.shortDescription) lines.push(`# ${r.shortDescription}`);
					if (r.summary) lines.push(`${r.summary}`);
					if (Array.isArray(r.findings) && r.findings.length){
						lines.push('\nKey findings:');
						r.findings.forEach((f,i)=>{ lines.push(`- ${f.label}: ${f.value}`); });
					}
					const formatted = lines.join('\n');
					const evt = new CustomEvent('insertPromptToChat', { detail: { value: formatted } });
					window.dispatchEvent(evt);
				});
				const composeBtnLocal = agentNetworkResultsEl.querySelector('#agent-compose-btn');
				composeBtnLocal.addEventListener('click', async ()=>{
					if (composerModal.classList.contains('loading')) return;
					composerModal.classList.remove('hidden');
					composerSourceTitle.textContent = 'Agent Action Draft';
					composerTextarea.innerHTML = '<span class="placeholder">Generating draft from action findings...</span>';
					composerModal.classList.add('loading');
					try {
						const body = { customerId:(window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['AGENT_ACTION_COMPOSE'], extraVarsMap: { AGENT_ACTION_COMPOSE: { ACTION_SHORT_DESCRIPTION: r.shortDescription||'', ACTION_SUMMARY: r.summary, ACTION_FINDINGS: r.findings||[] } } };
						const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
						const json = await resp.json();
						if (json.AGENT_ACTION_COMPOSE?.draft) {
							composerTextarea.innerHTML = json.AGENT_ACTION_COMPOSE.draft;
						} else if (json.AGENT_ACTION_COMPOSE?.error) {
							composerTextarea.innerHTML = `<span class="error-badge">Compose error: ${json.AGENT_ACTION_COMPOSE.error}</span>`;
						} else {
							composerTextarea.innerHTML = '<span class="error-badge">No draft generated.</span>';
						}
					} catch(e){
						composerTextarea.innerHTML = '<span class="error-badge">Failed to generate draft.</span>';
					} finally {
						composerModal.classList.remove('loading');
						composerTextarea.focus();
					}
				});
			// refine or generate a LIVE_RESPONSE draft automatically with findings appended if available
			if (json.LIVE_RESPONSE && json.LIVE_RESPONSE.draft){
				const enriched = json.LIVE_RESPONSE.draft + '\n\n[Internal Findings]\n' + r.findings.map(f=>`${f.label}: ${f.value}`).join('\n');
				latestLiveResponse = { ...json.LIVE_RESPONSE, draft: enriched };
				if (draftBtn) draftBtn.disabled = false;
				liveResponseRefinedFrom = action.id;
			}
			// Mark this action as executed immediately and refresh suggestions
			try {
				if (!executedActionsCache) executedActionsCache = [];
				if (!executedActionsCache.some(a=>a.id===action.id)) executedActionsCache.push({ id: action.id, title: action.title, at: Date.now() });
				markExecutedBadges();
				// Fetch a refined/updated plan of actions now that one executed
				refreshAgentActions();
			} catch(e){ /* non-fatal */ }
		} else {
			agentNetworkResultsEl.innerHTML = '<div class="error-badge">No result returned.</div>';
		}
	} catch(e){
		if (e?.name === 'AbortError') {
			agentNetworkResultsEl.innerHTML = '<div class="error-badge">Execution cancelled.</div>';
		} else {
			agentNetworkResultsEl.innerHTML = '<div class="error-badge">Execution failed.</div>';
			console.warn('agent network execute error', e);
		}
	} finally {
		clearInterval(timer);
		if (progEl()) progEl().style.width = '100%';
		executingActionId = null;
		console.debug('[AI Panel] executeAgentAction finished');
	}
}

function updateMiniInsights(data) {
	const s = document.getElementById('mini-sentiment');
	const r = document.getElementById('mini-risk');
	if (!data) return;
	if (s && data.sentiment) s.textContent = data.sentiment;
	if (r && data.risk) r.textContent = data.risk;
	// Enriched Sentiment & Risk widget (if present)
	try {
		const dialSent = document.getElementById('sr-sentiment');
		const dialRisk = document.getElementById('sr-risk');
		if (dialSent && dialRisk) {
			// sentiment mapping
			const sentiment = (data.sentiment||'').toLowerCase();
			const risk = (data.risk||'').toLowerCase();
			const sentLabel = document.getElementById('sr-sentiment-label');
			const riskLabel = document.getElementById('sr-risk-label');
			const sentChip = document.getElementById('sr-sentiment-chip');
			const riskChip = document.getElementById('sr-risk-chip');
			const sentTrend = document.getElementById('sr-sentiment-trend');
			const riskTrend = document.getElementById('sr-risk-trend');
			const ringSent = dialSent.querySelector('.sr-dial-ring');
			const ringRisk = dialRisk.querySelector('.sr-dial-ring');
			// class reset
			dialSent.classList.remove('sr-positive','sr-negative','sr-medium');
			dialRisk.classList.remove('sr-positive','sr-negative','sr-medium');
			// label defaults
			let sentState = 'sr-medium', sentText = 'Neutral';
			if (/pos|good|favorable/.test(sentiment)) { sentState='sr-positive'; sentText='Positive'; }
			else if (/neg|bad|angry|frustrated|poor/.test(sentiment)) { sentState='sr-negative'; sentText='Negative'; }
			let riskState = 'sr-medium', riskText = 'Medium';
			if (/low/.test(risk)) { riskState='sr-positive'; riskText='Low'; }
			else if (/high|severe|critical/.test(risk)) { riskState='sr-negative'; riskText='High'; }
			dialSent.classList.add(sentState);
			dialRisk.classList.add(riskState);
			if (sentLabel) sentLabel.textContent = sentText;
			if (riskLabel) riskLabel.textContent = riskText;
			if (sentChip) sentChip.textContent = data.sentiment || sentText;
			if (riskChip) riskChip.textContent = data.risk || riskText;
			// Partial arc fill using 0-100 scores (fallback to 50)
			const clamp01 = (n) => Math.max(0, Math.min(100, Number(n)));
			const sPct = clamp01(data.sentimentScore ?? 50);
			const rPct = clamp01(data.riskScore ?? 50);
			const colorFor = (state) => state==='sr-positive' ? 'var(--accent-positive)' : state==='sr-negative' ? 'var(--accent-negative)' : 'var(--accent-warning)';
			if (ringSent) ringSent.style.background = `radial-gradient(closest-side, #fff 78%, transparent 79% 100%), conic-gradient(${colorFor(sentState)} ${sPct}%, var(--border-soft) 0)`;
			if (ringRisk) ringRisk.style.background = `radial-gradient(closest-side, #fff 78%, transparent 79% 100%), conic-gradient(${colorFor(riskState)} ${rPct}%, var(--border-soft) 0)`;
			// Glow briefly on update
			dialSent.classList.add('sr-glow');
			dialRisk.classList.add('sr-glow');
			setTimeout(()=>{ dialSent.classList.remove('sr-glow'); dialRisk.classList.remove('sr-glow'); }, 400);
			// Trend arrows with subtle color fades
			const trendMap = { up: '↑', down: '↓', flat: '→' };
			const sentT = (data.sentimentTrend||'').toLowerCase();
			const riskT = (data.riskTrend||'').toLowerCase();
			if (sentTrend) {
				sentTrend.textContent = trendMap[sentT] || '→';
				sentTrend.classList.remove('up','down','flat','animate');
				sentTrend.classList.add(sentT||'flat','animate');
			}
			if (riskTrend) {
				riskTrend.textContent = trendMap[riskT] || '→';
				riskTrend.classList.remove('up','down','flat','animate');
				riskTrend.classList.add(riskT||'flat','animate');
			}
		}
	} catch (e) { /* non-fatal */ }
}

// Composer controls
function openComposer(intentKey) {
	const opening = nbaButton?.dataset.opening || 'Let me take a closer look and help right away.';
	const rationale = nbaButton?.dataset.rationale ? `<div class="composer-meta"><strong>Why:</strong> ${nbaButton.dataset.rationale}</div>` : '';
	const risk = nbaButton?.dataset.risk ? `<div class="composer-meta"><strong>Risk if ignored:</strong> ${nbaButton.dataset.risk}</div>` : '';
	composerTextarea.innerHTML = `${opening}`;
	composerSourceTitle.textContent = intentKey;
	composerTextarea.insertAdjacentHTML('afterend', rationale + risk);
	composerModal.classList.remove('hidden');
	composerTextarea.focus();
}

function closeComposer() { composerModal.classList.add('hidden'); }

function init() {
	console.debug('[AI Panel] init()');
	if (nbaButton) {
		nbaButton.addEventListener('click', () => openComposer(nbaButton.dataset.intent));
	}
	// Add refresh button to agent network widget
	if (agentNetworkWidget) {
		const header = agentNetworkWidget.querySelector('.widget-title');
		if (header && !refreshActionsBtn) {
			// Prefer dedicated anchor if present; else create one
			refreshActionsBtn = document.getElementById('agent-refresh-anchor');
			if (!refreshActionsBtn) {
				refreshActionsBtn = document.createElement('button');
				refreshActionsBtn.id = 'agent-refresh-anchor';
				refreshActionsBtn.className = 'refresh-btn';
				refreshActionsBtn.textContent = 'Refresh';
				refreshActionsBtn.title = 'Re-plan new actions';
				refreshActionsBtn.style.float = 'right';
				header.appendChild(refreshActionsBtn);
			}
			refreshActionsBtn.addEventListener('click', refreshAgentActions);
		}
		// Recompute NEXT_BEST_ACTION when live prompts or agent actions change
		async function recomputeNba(context){
			try {
				const extra = {};
				if (context.livePrompts) extra.LIVE_PROMPTS = context.livePrompts;
				if (context.agentActions) extra.ACTION_CANDIDATES = context.agentActions.map(a=>a.title).slice(0,6);
				if (window.latestServicePediaV2?.articles) extra.ARTICLE_TITLES = window.latestServicePediaV2.articles.slice(0,5).map(a=>a.title);
				const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ customerId:(window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['NEXT_BEST_ACTION'], extraVarsMap:{ NEXT_BEST_ACTION: extra } }) });
				const json = await resp.json();
				if (json.NEXT_BEST_ACTION) updateNba(json.NEXT_BEST_ACTION);
			} catch(e){ console.warn('nba recompute failed', e); }
		}
		let latestPrompts = null;
		let latestActions = null;
		window.addEventListener('livePromptsUpdated', e=>{ console.debug('[AI Panel] livePromptsUpdated', { count: (e.detail||[]).length }); latestPrompts = e.detail; recomputeNba({ livePrompts: latestPrompts, agentActions: latestActions }); });
		window.addEventListener('agentActionsUpdated', e=>{ console.debug('[AI Panel] agentActionsUpdated', { count: (e.detail||[]).length }); latestActions = e.detail; recomputeNba({ livePrompts: latestPrompts, agentActions: latestActions }); });

		// Instant refresh of Agent Network Actions on conversation updates (debounced)
		let refreshDebounce;
		window.addEventListener('conversationChanged', () => {
			clearTimeout(refreshDebounce);
			refreshDebounce = setTimeout(() => { refreshAgentActions(); }, 250);
		});
		// Provider selector persistence
		if (agentProviderSelect){
			const saved = localStorage.getItem('agentProvider');
			if (saved) agentProviderSelect.value = saved;
			agentProviderSelect.addEventListener('change', ()=>{
				localStorage.setItem('agentProvider', agentProviderSelect.value);
				refreshAgentActions();
			});
		}
	}
	// Add draft button (LIVE_RESPONSE) next to send if not present
	if (!draftBtn) {
		draftBtn = document.getElementById('draft-btn');
		if (!draftBtn) {
			const composerBar = document.getElementById('composer-bar');
			if (composerBar) {
				draftBtn = document.createElement('button');
				draftBtn.id = 'draft-btn';
				draftBtn.textContent = 'AI Draft';
				draftBtn.title = 'Generate contextual draft response';
				composerBar.insertBefore(draftBtn, composerBar.querySelector('#send-btn'));
			}
		}
		if (draftBtn) {
			draftBtn.disabled = true; // until first LIVE_RESPONSE arrives or fetched on demand
				draftBtn.addEventListener('click', async () => {
				// If we already have a live response object use it, else fetch
				if (!latestLiveResponse) {
					try {
						const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ customerId: (window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory || [], requestedWidgets:['LIVE_RESPONSE'] }) });
						const json = await resp.json();
						if (json.LIVE_RESPONSE) latestLiveResponse = json.LIVE_RESPONSE;
					} catch(e){ console.warn('LIVE_RESPONSE fetch failed', e); }
				}
				if (latestLiveResponse?.draft) {
					composerTextarea.innerHTML = latestLiveResponse.draft;
					composerSourceTitle.textContent = 'LIVE_RESPONSE Draft';
					composerModal.classList.remove('hidden');
					composerTextarea.focus();
				}
			});
		}
	}
	if (ctaContainer) {
		ctaContainer.addEventListener('click', e => {
			const item = e.target.closest('.prompt-item');
			if (!item) return;
			const evt = new CustomEvent('insertPromptToChat', { detail: { value: item.dataset.value } });
			window.dispatchEvent(evt);
		});
	}
	cancelBtn?.addEventListener('click', closeComposer);
	insertBtn?.addEventListener('click', () => {
		// Convert contenteditable HTML to markdown-like text, preserving lists
		const html = composerTextarea.innerHTML;
		let text = html
			.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, (m,p)=>`# ${p}\n`)
			.replace(/<li[^>]*>(.*?)<\/li>/gi, (m,p)=>`- ${p}\n`)
			.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (m,p)=>p)
			.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (m,p)=>p)
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<div[^>]*>/gi, '\n')
			.replace(/<\/div>/gi, '')
			.replace(/<p[^>]*>/gi, '')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<span class="placeholder">.*?<\/span>/g, '...')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		const evt = new CustomEvent('insertComposerText', { detail: { value: text } });
		window.dispatchEvent(evt);
		// Subtle success flash
		composerTextarea.classList.add('flash');
		setTimeout(()=>composerTextarea.classList.remove('flash'), 600);
		closeComposer();
	});
	// Transform with LLM for Empathetic/Concise/Both
	transformBtn?.addEventListener('click', async ()=>{
		if (!transformSelect) return;
		const mode = transformSelect.value || 'both';
		const raw = composerTextarea.innerText || composerTextarea.textContent || '';
		if (!raw.trim()) return;
		composerModal.classList.add('loading');
		composerTextarea.innerHTML = '<span class="placeholder">Refining with AI…</span>';
		try {
			const resp = await fetch('/api/v1/get-insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ customerId:(window.getActiveCustomerId?.() || window.activeCustomerId || 'GB00000000'), conversationHistory: window.conversationHistory||[], requestedWidgets:['COMPOSER_REFINE'], extraVarsMap: { COMPOSER_REFINE: { MODE: mode, DRAFT: raw } } }) });
			const json = await resp.json();
			const draft = json?.COMPOSER_REFINE?.draft || json?.COMPOSER_REFINE?.DRAFT || '';
			if (draft) {
				// Render simple markdown features for bullets/numbering
				const html = draft
					.replace(/^#\s+(.+)$/gm, '<strong>$1</strong>')
					.replace(/(?:^(?:-|\*)\s+.+(?:\n|$)){1,}/gm, block => {
						const items = block.trim().split(/\n/).map(l=> l.replace(/^(?:-|\*)\s+/, ''));
						return `<ul class="msg-list">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
					})
					.replace(/(?:^(?:\d+)\.\s+.+(?:\n|$)){1,}/gm, block => {
						const items = block.trim().split(/\n/).map(l=> l.replace(/^\d+\.\s+/, ''));
						return `<ol class="msg-list num">${items.map(i=>`<li>${i}</li>`).join('')}</ol>`;
					})
					.replace(/\n{2,}/g, '</p><p>')
					.replace(/\n/g, '<br/>');
				composerTextarea.innerHTML = `<p>${html}</p>`;
			} else {
				composerTextarea.innerHTML = '<span class="error-badge">No refined draft returned.</span>';
			}
		} catch(e){
			composerTextarea.innerHTML = '<span class="error-badge">Refine failed.</span>';
		} finally {
			composerModal.classList.remove('loading');
			composerTextarea.focus();
		}
	});
}

export { init, updateSummary, updateNba, updateResolutionPredictor, updateLivePrompts, updateKnowledgeGraph, updateServicePedia, updateMiniInsights, updateLiveResponse, updateAgentNetworkActions };
