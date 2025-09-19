// Customer Panel Module
const healthWidget = document.getElementById('account-health');
const healthScoreCircle = document.getElementById('health-score-circle');
const healthScoreValue = document.getElementById('health-score-value');
const healthStatus = document.getElementById('health-status');
const healthReasons = document.getElementById('health-reasons');
let bubbleCanvas = null;
let bubbleSvg = null;

function ensureBubbleLayer(){
	if (!healthWidget) return null;
	let layer = healthWidget.querySelector('.health-bubbles');
	if (!layer){
		layer = document.createElement('div');
		layer.className = 'health-bubbles';
		layer.style.position='relative';
		layer.style.minHeight='180px';
		layer.style.marginTop='14px';
		layer.style.border='1px dashed var(--border-soft)';
		layer.style.borderRadius='12px';
		layer.style.padding='4px';
		bubbleSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
		bubbleSvg.setAttribute('width','100%');
		bubbleSvg.setAttribute('height','180');
		bubbleSvg.style.overflow='visible';
		layer.appendChild(bubbleSvg);
		const legend = document.createElement('div');
		legend.className='bubble-legend';
		legend.style.display='flex';
		legend.style.flexWrap='wrap';
		legend.style.gap='8px';
		legend.style.padding='4px 6px 4px';
		legend.style.fontSize='.55rem';
		legend.innerHTML = '<span><strong>Size:</strong> value</span><span><strong>Color:</strong> impact</span>';
		layer.appendChild(legend);
		healthWidget.appendChild(layer);
	}
	return bubbleSvg;
}

function renderHealthBubbles(bubbles=[]) {
	const svg = ensureBubbleLayer();
	if (!svg) return;
	while (svg.firstChild) svg.removeChild(svg.firstChild);
	if (!bubbles.length){
		const empty = document.createElementNS('http://www.w3.org/2000/svg','text');
		empty.textContent='No health signals available';
		empty.setAttribute('x','8');
		empty.setAttribute('y','20');
		empty.setAttribute('fill','var(--text-secondary)');
		svg.appendChild(empty);
		return;
	}
	// Basic bubble packing (greedy) within 100% width x 160 height area
	const width = healthWidget.clientWidth - 16;
	const height = 160;
	const maxVal = Math.max(...bubbles.map(b=>b.value||1));
	const minRadius = 16, maxRadius = 56;
	const placed = [];
	function collide(x,y,r){
		return placed.some(p => ((p.x - x)**2 + (p.y - y)**2) < (p.r + r + 6)**2);
	}
	bubbles.sort((a,b)=> (b.value||0) - (a.value||0));
	bubbles.forEach(b => {
		const norm = (b.value||1)/maxVal;
		const r = minRadius + norm*(maxRadius-minRadius);
		let x= r + Math.random()*(width - 2*r);
		let y= r + Math.random()*(height - 2*r);
		let tries=0;
		while (collide(x,y,r) && tries < 120){
			x= r + Math.random()*(width - 2*r);
			y= r + Math.random()*(height - 2*r);
			tries++;
		}
		placed.push({x,y,r,b});
	});
	const impactColors = { HIGH:'var(--accent-negative)', MEDIUM:'var(--accent-warning)', LOW:'var(--accent-positive)' };
	placed.forEach(p => {
		const g = document.createElementNS('http://www.w3.org/2000/svg','g');
		const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
		circle.setAttribute('cx', p.x);
		circle.setAttribute('cy', p.y);
		circle.setAttribute('r', p.r);
		circle.setAttribute('fill', impactColors[p.b.impact]||'var(--bt-purple-light)');
		circle.setAttribute('stroke','var(--bg-main)');
		circle.setAttribute('stroke-width','2');
		circle.style.filter='drop-shadow(0 2px 4px rgba(0,0,0,0.08))';
		const label = document.createElementNS('http://www.w3.org/2000/svg','text');
		label.setAttribute('x', p.x);
		label.setAttribute('y', p.y+4);
		label.setAttribute('text-anchor','middle');
		label.setAttribute('font-size', Math.max(10, Math.min(14, p.r/2)));
		label.setAttribute('fill','#212529');
		label.textContent=(p.b.label||p.b.id||'').slice(0,12);
		g.appendChild(circle);
		g.appendChild(label);
		g.style.cursor='pointer';
		g.addEventListener('click', ()=>{
			const modal = ensureDetailModal();
			const content = modal.querySelector('#detail-content');
			content.innerHTML = `<p><strong>${p.b.label||p.b.id}</strong></p><p>Value: ${p.b.value||'—'}<br>Impact: ${p.b.impact||'—'}<br>Category: ${p.b.category||'—'}<br>Risk: ${p.b.risk||'—'}</p>`;
			modal.classList.remove('hidden');
		});
		svg.appendChild(g);
	});
}

// customer 360 area
const customerProfileWidget = document.getElementById('customer-profile');
const customerProfileContainer = document.getElementById('customer-profile')?.querySelector('.loading-block');

// wordcloud container (inside account health widget)
const wordcloudContainer = document.getElementById('wordcloud-container');

// modal for word detail
let detailModal = null;

function ensureDetailModal(){
	if (detailModal) return detailModal;
	detailModal = document.createElement('div');
	detailModal.className = 'modal hidden';
	detailModal.innerHTML = `<div class="composer-content"><h3 class="widget-title">Detail</h3><div id="detail-content"></div><div style="margin-top:12px;text-align:right"><button id="detail-close">Close</button></div></div>`;
	document.body.appendChild(detailModal);
	detailModal.querySelector('#detail-close').addEventListener('click', ()=> detailModal.classList.add('hidden'));
	return detailModal;
}

function removeLoading(widget){ widget?.querySelectorAll('.loading-block').forEach(el=>el.remove()); }

function updateHealthScore(data) {
	if (!healthWidget || !data) return;
	removeLoading(healthWidget);
	healthWidget.querySelector('.health-content').classList.remove('hidden');
	let { score, status, reasons = [], bubbles = [] } = data;
	if (!Array.isArray(bubbles) || !bubbles.length){
		// fabricate simple bubble signals from KPIs if available in customer profile (lookup last rendered c360?)
		try {
			const kpiMap = (window.__lastC360 && window.__lastC360.kpis) || {};
			const synthetic = [];
			if (kpiMap.csatLast90!=null) synthetic.push({ id:'csat', label:'CSAT', value: kpiMap.csatLast90, impact: kpiMap.csatLast90<60?'HIGH':kpiMap.csatLast90<75?'MEDIUM':'LOW', category:'KPI', risk: kpiMap.csatLast90<60?'NEG':'NEUTRAL' });
			if (kpiMap.nps!=null) synthetic.push({ id:'nps', label:'NPS', value: (kpiMap.nps+100)/2, impact: kpiMap.nps<0?'HIGH':kpiMap.nps<30?'MEDIUM':'LOW', category:'KPI', risk: kpiMap.nps<0?'NEG':'NEUTRAL' });
			if (kpiMap.billingOnTimeRate!=null) synthetic.push({ id:'onTime', label:'On-Time', value: Math.round(kpiMap.billingOnTimeRate*100), impact: kpiMap.billingOnTimeRate<0.8?'HIGH':kpiMap.billingOnTimeRate<0.95?'MEDIUM':'LOW', category:'KPI', risk: kpiMap.billingOnTimeRate<0.8?'NEG':'NEUTRAL' });
			if (synthetic.length) bubbles = synthetic;
		} catch(e){ /* ignore */ }
	}
	let color = 'var(--accent-positive)';
	if (score < 70) color = 'var(--accent-warning)';
	if (score < 40) color = 'var(--accent-negative)';
	healthScoreCircle.style.background = `radial-gradient(closest-side, white 79%, transparent 80% 100%), conic-gradient(${color} ${score}%, var(--border-soft) 0)`;
	healthScoreValue.textContent = score + '%';
	healthStatus.textContent = status;
	healthReasons.textContent = reasons.join('; ');
	renderHealthBubbles(bubbles);
}

function renderWordcloud(words = [], details = {}){
	if (!wordcloudContainer) return;
	wordcloudContainer.innerHTML = '';
	wordcloudContainer.classList.remove('hidden');
	words.forEach((w, idx) => {
		const span = document.createElement('span');
		span.className = 'wc-word';
		span.textContent = w;
		// simple distribution 1-10 bucket by index (placeholder until frequencies available)
		const weight = Math.min(10, 1 + Math.floor((idx / Math.max(1, words.length-1)) * 10));
		span.setAttribute('data-w', weight);
		span.style.margin = '6px';
		span.style.cursor = 'pointer';
		span.addEventListener('click', ()=>{
			const modal = ensureDetailModal();
			const content = modal.querySelector('#detail-content');
			content.innerHTML = `<p><strong>${w}</strong></p><p>${(details[w]||'No details available for this keyword.')}</p>`;
			modal.classList.remove('hidden');
		});
		wordcloudContainer.appendChild(span);
	});
}

function updateCustomer360(obj){
	if (!customerProfileWidget || !obj) return;
	removeLoading(customerProfileWidget);
	// Persist and deep-merge incoming updates with last known state so cards don't blank on partial updates
	const incoming = obj.customer360 || obj; // support payload embedding
	const prev = window.__lastC360 || {};
	const merged = (() => {
		const m = { ...prev, ...incoming };
		// nested objects
		m.kpis = { ...(prev.kpis||{}), ...(incoming.kpis||{}) };
		m.billing = { ...(prev.billing||{}), ...(incoming.billing||{}) };
		// arrays: prefer incoming if provided and non-empty, else keep previous
		m.products = Array.isArray(incoming.products) && incoming.products.length ? incoming.products : (prev.products||[]);
		m.upsellPotential = Array.isArray(incoming.upsellPotential) && incoming.upsellPotential.length ? incoming.upsellPotential : (prev.upsellPotential||[]);
		m.riskSignals = Array.isArray(incoming.riskSignals) && incoming.riskSignals.length ? incoming.riskSignals : (prev.riskSignals||[]);
		m.miniInsights = { ...(prev.miniInsights||{}), ...(incoming.miniInsights||{}) };
		// cards deep merge
		const prevCards = prev.cards||{}; const inCards = incoming.cards||{};
		const prevGeo = prevCards.geoServiceContext||{}; const inGeo = inCards.geoServiceContext||{};
		const prevTic = prevCards.ticketsCases||{}; const inTic = inCards.ticketsCases||{};
		m.cards = {
			...prevCards,
			...inCards,
			geoServiceContext: { ...prevGeo, ...inGeo },
			ticketsCases: { ...prevTic, ...inTic },
		};
		// demographics may come at top-level in obj or nested within incoming/prev
		const topDemo = obj.demographics || obj.CUSTOMER_360_DEMOGRAPHICS;
		const inDemo = incoming.demographics || topDemo;
		const prevDemo = prev.demographics || {};
		const inAddr = (inDemo&&inDemo.address)||{}; const prevAddr = (prevDemo&&prevDemo.address)||{};
		m.demographics = inDemo ? { ...prevDemo, ...inDemo, address: { ...prevAddr, ...inAddr } } : (Object.keys(prevDemo).length? prevDemo : undefined);
		return m;
	})();
	window.__lastC360 = merged; // update global snapshot used elsewhere
	const c360 = merged;
	const demo = c360.demographics || null;
	const mini = obj.miniInsights || c360.miniInsights || {};
	// helpers
	const fmtAmount = (v) => {
		const n = Number(v);
		if (!isFinite(n)) return '—';
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
	};
	// UK geo normalization (postcodes -> realistic city/region)
	const getOutward = (pc) => {
		if (!pc || typeof pc !== 'string') return '';
		const out = pc.trim().toUpperCase().split(/\s+/)[0];
		return out || '';
	};
	const getLetters = (out) => (out.match(/^[A-Z]{1,2}/)?.[0] || '');
	const londonSet = new Set(['E','EC','N','NW','SE','SW','W','WC']);
	// Common UK outward letter mappings
	const ukMap = {
		'LS': { city: 'Leeds', region: 'West Yorkshire' },
		'EH': { city: 'Edinburgh', region: 'City of Edinburgh' },
		'BS': { city: 'Bristol', region: 'Bristol' },
		'NE': { city: 'Newcastle upon Tyne', region: 'Tyne and Wear' },
		'NG': { city: 'Nottingham', region: 'Nottinghamshire' },
		'CF': { city: 'Cardiff', region: 'Cardiff' },
		'BT': { city: 'Belfast', region: 'Northern Ireland' },
		'AB': { city: 'Aberdeen', region: 'Aberdeen City' },
		'DD': { city: 'Dundee', region: 'Dundee City' },
		'FK': { city: 'Falkirk', region: 'Falkirk' },
		'G': { city: 'Glasgow', region: 'Glasgow City' },
		'L': { city: 'Liverpool', region: 'Merseyside' },
		'M': { city: 'Manchester', region: 'Greater Manchester' },
		'B': { city: 'Birmingham', region: 'West Midlands' },
		'S': { city: 'Sheffield', region: 'South Yorkshire' }
	};
	function normalizeUKGeo(geo){
		const out = getOutward(geo.postalCode);
		const letters = getLetters(out);
		let city = geo.city || '';
		let region = geo.region || '';
		if (letters && londonSet.has(letters)) { city = 'London'; region = 'Greater London'; }
		else if (letters && ukMap[letters]) { city = ukMap[letters].city; region = ukMap[letters].region; }
		// If city implies a known region but region mismatched (e.g., Liverpool -> Merseyside), correct it
		const byCity = Object.values(ukMap).find(v => v.city.toLowerCase() === (city||'').toLowerCase());
		if (byCity && region && region.toLowerCase() !== byCity.region.toLowerCase()) {
			region = byCity.region;
		}
		// Avoid showing clearly wrong combos like city set but region "Greater London" when non-London postcode
		if (region === 'Greater London' && !(letters && londonSet.has(letters))) {
			// fallback to byCity region or clear if unknown
			region = byCity?.region || region;
		}
		return { ...geo, city, region };
	}
	const safeText = (v) => (v==null || v==='' ? '—' : String(v));
	const nonNegDays = (d) => {
		const n = Math.max(0, Number(d||0));
		return isFinite(n) ? n : '—';
	};
	const isValidCity = (s) => typeof s === 'string' && s.length > 2 && !/^(UK|GB|US|EU|United Kingdom|England|Scotland|Wales|N\.Ire)$/i.test(s);
	const products = (c360.products||[]).map(p=>`<li>${safeText(p.name)} <span class="meta">(${safeText(p.sinceMonths)}m)</span></li>`).join('') || '<li>—</li>';
	const upsell = (c360.upsellPotential||[]).map(u=>`<li>${safeText(u.offer)}: <span class="meta">${safeText(u.reason)}</span></li>`).join('') || '<li>—</li>';
	const risk = (c360.riskSignals||[]).map(r=>`<span class="badge risk">${r}</span>`).join(' ');
	const k = c360.kpis || {};
	const b = c360.billing || {};
	let demoHtml = '';
	if (demo && demo.firstName) {
		const initials = (demo.firstName[0]||'') + (demo.lastName? demo.lastName[0]:'');
		demoHtml = `<div class="demo-card">
			<div class="avatar-circle" aria-label="avatar">${initials}</div>
			<div class="demo-meta">
				<div class="demo-name">${demo.firstName} ${demo.lastName}</div>
				<div class="demo-sub">${demo.gender||'—'}</div>
				<div class="demo-addr">${demo.address?.city||''}${demo.address?.region?', '+demo.address.region:''}</div>
			</div>
		</div>`;
	}
	    let geo = (c360.cards && c360.cards.geoServiceContext) || {};
	    geo = normalizeUKGeo(geo);
    const tickets = (c360.cards && c360.cards.ticketsCases) || {};
	// Build pills row (segment, tenure, id)
	const pills = [];
	if (c360.segment) {
		const segClass = /risk/i.test(c360.segment) ? 'danger' : /vip|premium/i.test(c360.segment) ? 'good' : 'neutral';
		pills.push(`<span class="chip ${segClass}">${safeText(c360.segment)}</span>`);
	}
	if (c360.tenureMonths!=null) pills.push(`<span class="chip">${safeText(c360.tenureMonths)}m tenure</span>`);
	if (c360.id) pills.push(`<span class="chip mono">${safeText(c360.id)}</span>`);
	const pillsHtml = pills.length ? `<div class="c360-pills">${pills.join('')}</div>` : '';
	// Optional rows: only render when values exist
	// (Hidden as requested) Last Message / Summary / Sentiment+Risk rows
	// const lastMsgVal = c360.lastMessage || obj.lastMessage || '';
	// const summaryVal = c360.summary || obj.summary || '';
	// const sentimentVal = mini.sentiment || '';
	// const riskVal = mini.risk || '';
	const lastMsgRow = '';
	const summaryRow = '';
	const sentimentRow = '';

	// Cleaned up card subtitles
	const cityLabel = isValidCity(geo.city) ? geo.city : '';
	const regionLabel = geo.region || '';
	const place = [cityLabel, regionLabel].filter(Boolean).join(', ');
	const geoSubParts = [ geo.serviceType, place || null, geo.postalCode || null ].filter(Boolean);
	const geoSub = geo.shortDescription || (geoSubParts.length ? geoSubParts.join(' • ') : '—');
	const openCount = (typeof tickets.openCount === 'number') ? tickets.openCount : (tickets.openCount ? Number(tickets.openCount) : null);
	const oldest = nonNegDays(tickets.oldestDays);
	const ticketsSubParts = [ (openCount!=null? `${openCount} open` : null), (isFinite(oldest) && oldest>0 ? `oldest ${oldest}d` : null), tickets.sla || null, tickets.priority || null ].filter(Boolean);
	const ticketsSub = tickets.shortDescription || (ticketsSubParts.length ? ticketsSubParts.join(' • ') : '—');

	const html = `
		${demoHtml}
		${pillsHtml}
		<div class="c360-grid">
			<div class="c360-col">
				<h4>Products</h4>
				<ul>${products}</ul>
				<h4>Upsell Potential</h4>
				<ul>${upsell}</ul>
			</div>
			<div class="c360-col">
				<h4>KPIs</h4>
				<div class="kpi"><label>CSAT 90d</label><span>${k.csatLast90 ?? '—'}%</span></div>
				<div class="kpi"><label>NPS</label><span>${k.nps ?? '—'}</span></div>
				<div class="kpi"><label>AHT</label><span>${k.avgHandleTimeSec ?? '—'}s</span></div>
				<div class="kpi"><label>On-Time Billing</label><span>${(k.billingOnTimeRate!=null)? Math.round(k.billingOnTimeRate*100)+'%':'—'}</span></div>
			</div>
			<div class="c360-col">
				<h4>Billing</h4>
				<div class="kpi"><label>Last Bill</label><span>${fmtAmount(b.lastBillAmount)}</span></div>
				<div class="kpi"><label>Avg Bill</label><span>${fmtAmount(b.avgBillAmount)}</span></div>
				<div class="kpi"><label>Method</label><span>${b.lastPaymentMethod || '—'}</span></div>
				<div class="kpi"><label>Open Disputes</label><span>${b.openDisputes ?? '—'}</span></div>
			</div>
			<div class="c360-col">
				<h4>Geo & Service Context</h4>
				<div class="card-sub">${geoSub}</div>
				<div class="kpi"><label>Region</label><span>${safeText(geo.region)}</span></div>
				<div class="kpi"><label>City</label><span>${cityLabel || '—'}</span></div>
				<div class="kpi"><label>Postal</label><span>${safeText(geo.postalCode)}</span></div>
				<div class="kpi"><label>Service</label><span>${safeText(geo.serviceType)}</span></div>
				<div class="kpi"><label>Cabinet</label><span>${geo.cabinetId||'—'}</span></div>
				<div class="kpi"><label>Exchange</label><span>${geo.exchangeId||'—'}</span></div>
				<!-- meta summary hidden intentionally -->
			</div>
			<div class="c360-col">
				<h4>Tickets & Cases</h4>
				<div class="card-sub">${ticketsSub}</div>
				<div class="kpi"><label>Open</label><span>${openCount!=null? openCount:'—'}</span></div>
				<div class="kpi"><label>Oldest (d)</label><span>${isFinite(oldest)? oldest : '—'}</span></div>
				<div class="kpi"><label>Priority</label><span>${safeText(tickets.priority)}</span></div>
				<div class="kpi"><label>SLA</label><span>${safeText(tickets.sla)}</span></div>
				<div class="kpi"><label>Owner</label><span>${tickets.owner ? tickets.owner : '—'}</span></div>
				<div class="kpi"><label>Last Action</label><span>${tickets.lastAction || '—'}</span></div>
				<!-- meta summary hidden intentionally -->
			</div>
		</div>
		${lastMsgRow}
		${summaryRow}
		${sentimentRow}
		<!-- risk badges row intentionally hidden -->
	`;
	// Preserve header if already rendered for incremental updates
	if (!customerProfileWidget.querySelector('.customer-360')) {
		customerProfileWidget.innerHTML = `<h3 class="widget-title">Customer 360</h3><div class="customer-360 rich">${html}</div>`;
	} else {
		customerProfileWidget.querySelector('.customer-360').innerHTML = html;
	}
}


function init() { /* future listeners */ }

export { init, updateHealthScore, updateCustomer360, renderWordcloud };
