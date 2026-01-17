import { Router } from 'express';
import { fetchInsights } from '../services/llmOrchestrator.js';
import { deriveServiceContext } from '../config/serviceClassification.js';
import logger from '../utils/logger.js';

const router = Router();

// In-memory rolling conversation history per customer (simple demo storage)
const conversationStore = new Map(); // customerId -> [{role, content, ts}]
const MAX_HISTORY = 50; // cap messages per customer

// Executed agent network actions per customer
const executedActionsStore = new Map(); // customerId -> [{id, query, ts}]

function recordExecutedAction(customerId, id, query){
	if (!customerId || !query) return;
	if (!executedActionsStore.has(customerId)) executedActionsStore.set(customerId, []);
	const arr = executedActionsStore.get(customerId);
	arr.push({ id: id || `exec-${arr.length+1}`, query, ts: Date.now() });
	if (arr.length > 20) arr.splice(0, arr.length - 20);
}

function getExecutedActions(customerId){
	return executedActionsStore.get(customerId) || [];
}

function appendConversation(customerId, role, content){
	if (!conversationStore.has(customerId)) conversationStore.set(customerId, []);
	const arr = conversationStore.get(customerId);
	arr.push({ role, content, ts: Date.now() });
	if (arr.length > MAX_HISTORY) arr.splice(0, arr.length - MAX_HISTORY);
}

function getConversationHistory(customerId){
	return (conversationStore.get(customerId) || []).map(m => ({ role: m.role, content: m.content }));
}

router.post('/v1/get-insights', async (req, res) => {
	const start = Date.now();
	if (logger.isDebug) logger.debug('POST /api/v1/get-insights', { requestedWidgets: req.body?.requestedWidgets, hasExtra: !!req.body?.extraVarsMap, providerMap: req.body?.providerMap });
	try {
		const { customerId, conversationHistory = [], requestedWidgets = [], extraVarsMap = {}, providerMap = {} } = req.body || {};
		if (!customerId) {
			logger.warn('get-insights validation failed: missing customerId');
			return res.status(400).json({ error: 'customerId required' });
		}
		if (!Array.isArray(requestedWidgets) || requestedWidgets.length === 0) {
			logger.warn('get-insights validation failed: requestedWidgets invalid');
			return res.status(400).json({ error: 'requestedWidgets must be non-empty array' });
		}
		// If execution requested, record before planning refresh
		if (requestedWidgets.includes('AGENT_NETWORK_EXECUTE')) {
			const execVars = extraVarsMap?.AGENT_NETWORK_EXECUTE;
			if (execVars?.ACTION_QUERY) recordExecutedAction(customerId, execVars.ACTION_ID, execVars.ACTION_QUERY);
			if (logger.isDebug) logger.debug('recordExecutedAction', { customerId, actionId: execVars?.ACTION_ID, queryPreview: (execVars?.ACTION_QUERY||'').slice(0,120) });
		}
		// Inject previously executed actions context for planner
		if (requestedWidgets.includes('AGENT_NETWORK_ACTIONS')) {
			const prev = getExecutedActions(customerId);
			extraVarsMap.AGENT_NETWORK_ACTIONS = { ...(extraVarsMap.AGENT_NETWORK_ACTIONS||{}), PREVIOUS_ACTIONS: prev.length ? prev.map(p=>`${p.id}: ${p.query}`).slice(-10).join('\n') : 'NONE' };
		}
		// Derive customer context (region, postalCode, serviceType) from last known Customer 360 snapshot
		function deriveCustomerContext(id){
			const snap = lastCustomer360.get(id);
			if (!snap) return {};
			const ctx = {};
			const demo = snap.insights?.CUSTOMER_360_DEMOGRAPHICS || snap.customer360?.demographics || null;
			const geoCard = snap.customer360?.cards?.geoServiceContext || {};
			const addr = demo?.address || {};
			if (geoCard.region || addr.region) ctx.region = geoCard.region || addr.region;
			if (geoCard.postalCode || addr.postcode) ctx.postalCode = geoCard.postalCode || addr.postcode;
			if (geoCard.city || addr.city) ctx.city = geoCard.city || addr.city;
			const products = snap.customer360?.products || [];
			if (products.length){
				const names = products.map(p=>String(p.name||''));
				const { detailedType } = deriveServiceContext(names);
				if (detailedType) ctx.serviceType = geoCard.serviceType || detailedType;
			}
			return ctx;
		}

		const customerContext = deriveCustomerContext(customerId);
		// Also attach context into execute extra vars for transparency (optional use by prompts)
		if (requestedWidgets.includes('AGENT_NETWORK_EXECUTE')){
			extraVarsMap.AGENT_NETWORK_EXECUTE = { ...(extraVarsMap.AGENT_NETWORK_EXECUTE||{}), CUSTOMER_CONTEXT: customerContext };
		}

		const data = await fetchInsights({ customerId, conversationHistory, requestedWidgets, extraVarsMap, providerMap, customerContext });
		// Augment agent network actions with executed list for UI badges
		if (requestedWidgets.includes('AGENT_NETWORK_ACTIONS')) {
			try {
				if (!data.AGENT_NETWORK_ACTIONS) data.AGENT_NETWORK_ACTIONS = { actions: [] };
				data.AGENT_NETWORK_ACTIONS.executedActions = getExecutedActions(customerId);
			} catch(e){ /* non-fatal */ }
		}
	if (logger.isDebug) logger.debug('get-insights result', { customerId, requestedWidgets, durationMs: Date.now() - start, keys: Object.keys(data||{}) });
		res.json(data);
	} catch (err) {
		logger.error('get-insights error', err);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// In-memory store for latest customer360 per customer
const lastCustomer360 = new Map();
const sseClients = new Map(); // customerId -> Set(res)

function authorizeReset(req){
	const token = process.env.RESET_TOKEN;
	if (!token) return true; // no token configured => allow (demo/default)
	const provided = req.get('x-reset-token');
	return Boolean(provided) && provided === token;
}

function resetCustomerState(customerId){
	conversationStore.delete(customerId);
	executedActionsStore.delete(customerId);
	lastCustomer360.delete(customerId);

	const set = sseClients.get(customerId);
	if (set) {
		const traceId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
		for (const clientRes of set) {
			try { sendSse(clientRes, { type: 'reset', customerId, traceId, ts: Date.now() }); } catch(e) { /* ignore */ }
			try { clientRes.end(); } catch(e) { /* ignore */ }
		}
	}
	sseClients.delete(customerId);
}

function sendSse(res, data){
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/v1/stream/customer-360/:id', (req, res) => {
	const { id } = req.params;
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive',
		'Access-Control-Allow-Origin': '*'
	});
	if (!sseClients.has(id)) sseClients.set(id, new Set());
	sseClients.get(id).add(res);
	// Send last snapshot immediately if present
	const existing = lastCustomer360.get(id);
	if (existing) sendSse(res, existing);
	req.on('close', ()=> { sseClients.get(id)?.delete(res); });
});

// Reset server-side demo state for a single customer (conversation history, executed actions, last snapshot, SSE clients)
// Optional protection: if RESET_TOKEN is set, require header x-reset-token to match.
router.post('/v1/reset-customer', (req, res) => {
	try {
		if (!authorizeReset(req)) return res.status(401).json({ error: 'unauthorized' });
		const { customerId } = req.body || {};
		if (!customerId) return res.status(400).json({ error: 'customerId required' });
		resetCustomerState(String(customerId));
		return res.json({ ok: true, customerId });
	} catch (err) {
		logger.error('reset-customer error', err);
		return res.status(500).json({ error: 'Internal' });
	}
});

// External chat webhook: receive a new message from the customer chat app
// and return updated customer 360 + updated widgets (wordcloud for account help)
router.post('/v1/external-chat', async (req, res) => {
	const start = Date.now();
	try {
		const { customerId, message, source = 'external' } = req.body || {};
		if (!customerId || !message) return res.status(400).json({ error: 'customerId and message required' });
		logger.info('Inbound customer message', { customerId, len: message.length, preview: message.slice(0,120) });

		// Append new customer message to rolling history
		appendConversation(customerId, 'customer', message);
		const conversationHistory = getConversationHistory(customerId);

		// Request core + enriched widgets (include V2 knowledge + live response & 360 for freshness)
		const requestedWidgets = [
			'MINI_INSIGHTS',
			'SERVICE_PEDIA', // legacy fallback
			'SERVICE_PEDIA_V2',
			'KNOWLEDGE_GRAPH',
			'ACCOUNT_HEALTH',
			'AI_SUMMARY',
			'RESOLUTION_PREDICTOR',
			'NEXT_BEST_ACTION',
			'LIVE_PROMPTS',
			'CUSTOMER_360',
			'CUSTOMER_360_DEMOGRAPHICS',
			'LIVE_RESPONSE',
			'AGENT_NETWORK_ACTIONS'
		];
		const insights = await fetchInsights({ customerId, conversationHistory, requestedWidgets });

		// Build customer 360 object (prefer full CUSTOMER_360 payload if present)
		const baseC360 = insights.CUSTOMER_360 || {};
		const customer360 = {
			id: baseC360.id || customerId,
			lastMessage: message,
			segment: baseC360.segment,
			tenureMonths: baseC360.tenureMonths,
			products: baseC360.products || [],
			kpis: baseC360.kpis || {},
			billing: baseC360.billing || {},
			upsellPotential: baseC360.upsellPotential || [],
			riskSignals: baseC360.riskSignals || [],
			miniInsights: insights.MINI_INSIGHTS || {},
			knowledgeGraph: insights.KNOWLEDGE_GRAPH || {},
			accountHealth: insights.ACCOUNT_HEALTH || {},
			summary: insights.AI_SUMMARY?.summary || null,
			resolutionPrediction: insights.RESOLUTION_PREDICTOR || null
		};

		// Enrich with Geo & Service Context card (derive from demographics/products) with plausible fallbacks
		try {
			const demo = insights.CUSTOMER_360_DEMOGRAPHICS || baseC360.demographics || {};
			const addr = demo?.address || {};
			const products = customer360.products || [];
			// Infer service type with sensible default
			const names = products.map(p=>String(p.name||'').toLowerCase());
			let { detailedType: serviceType } = deriveServiceContext(names);
			// Seeded hash for deterministic, plausible IDs
			const idStr = String(customerId||'');
			let h = 0; for (let i=0;i<idStr.length;i++){ h = (h*31 + idStr.charCodeAt(i)) >>> 0; }
			const city = addr.city || (addr.region ? addr.region.split(/\s+/)[0] : 'UK');
			const cityCode = String(city).toUpperCase().replace(/[^A-Z]/g,'').slice(0,3) || 'UK';
			const cabNumA = (h % 60) + 1; const cabNumB = (Math.floor(h/7) % 12) + 1;
			const exNum = (Math.floor(h/13) % 80) + 10;
			const cabinetId = `CAB-${cityCode}-${cabNumA}/${cabNumB}`;
			const exchangeId = `${cityCode}-EX${exNum}`;
			const geoCard = {
				region: addr.region || 'Greater London',
				postalCode: addr.postcode || `GB${(h%9000+1000)}`,
				city: addr.city || city,
				serviceType: serviceType || undefined,
				cabinetId,
				exchangeId,
				shortDescription: `${serviceType || 'Service'} in ${addr?.region || addr?.city || 'region unknown'}`.slice(0,80),
				summary: `Context for outages/maintenance: ${addr?.region||'—'} ${addr?.postcode? '('+addr.postcode+')':''}; service=${serviceType||'—'}`.slice(0,200)
			};
			customer360.cards = customer360.cards || {};
			customer360.cards.geoServiceContext = geoCard;
		} catch(e){ /* non-fatal */ }

		// Add Tickets & Cases card (deterministic, plausible demo values)
		try {
			const idStr = String(customerId||'');
			let h = 0; for (let i=0;i<idStr.length;i++){ h = (h*31 + idStr.charCodeAt(i)) >>> 0; }
			const openCount = (h % 3) + 1; // 1-3
			const oldestDays = 1 + ((h >> 3) % 18); // 1-18 days
			const priority = ['Low','Medium','High'][(h >> 5) % 3];
			const sla = oldestDays > 10 ? 'At Risk' : oldestDays > 5 ? 'Watch' : 'Within SLA';
			const owner = ['Tier 1','Tier 2','Back Office','Field Ops'][(h >> 7) % 4];
			const lastAction = ['Awaiting customer response','Pending vendor','Diagnostics run','Engineer scheduled','Monitoring stability','Parts on order'][(h >> 9) % 6];
			const ticketsCard = {
				openCount,
				oldestDays,
				priority,
				sla,
				lastAction,
				owner,
				shortDescription: `${openCount} open ticket${openCount>1?'s':''} • ${priority} • ${sla}`.slice(0,80),
				summary: `Tickets: ${openCount} open; oldest ${oldestDays}d; priority ${priority}; SLA ${sla}; last: ${lastAction} (owner ${owner})`.slice(0,200)
			};
			customer360.cards = customer360.cards || {};
			customer360.cards.ticketsCases = ticketsCard;
		} catch(e){ /* non-fatal */ }

		// For account help wordcloud: derive from accountHealth reasons or knowledge graph titles
		const wordCandidates = [];
		if (customer360.accountHealth?.reasons) wordCandidates.push(...customer360.accountHealth.reasons);
		if (customer360.knowledgeGraph?.primary?.title) wordCandidates.push(customer360.knowledgeGraph.primary.title);
		const wordcloud = Array.from(new Set(wordCandidates.join(' ').split(/\W+/).filter(Boolean))).slice(0, 40);

		// Generate word details via LLM (WORD_DETAILS prompt uses words context)
		if (wordcloud.length) {
			const wordDetailsRaw = await fetchInsights({ customerId, conversationHistory, requestedWidgets: ['WORD_DETAILS'] });
			if (wordDetailsRaw.WORD_DETAILS) insights.wordDetails = wordDetailsRaw.WORD_DETAILS;
		}
		// Derive a lightweight bot reply preference order
		let botReply = '';
		if (insights.NEXT_BEST_ACTION?.suggestedOpening) botReply = insights.NEXT_BEST_ACTION.suggestedOpening;
		else if (insights.AI_SUMMARY?.summary) botReply = insights.AI_SUMMARY.summary;
		else if (insights.NEXT_BEST_ACTION?.title) botReply = insights.NEXT_BEST_ACTION.title;
		else if (customer360.summary) botReply = customer360.summary;
		if (!botReply) botReply = 'I\'ve received your message and I\'m analysing your account now.';
		// Optional suppression of auto bot replies via env flag
		const SUPPRESS_AUTO = /^(1|true|yes)$/i.test(process.env.SUPPRESS_AUTO_BOT_REPLY || '');
		if (SUPPRESS_AUTO) {
			// Remove bot reply if suppression is enabled
			botReply = undefined;
			if (logger.isDebug) logger.debug('Auto bot reply suppressed by SUPPRESS_AUTO_BOT_REPLY');
		}
		const traceId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
		const payload = SUPPRESS_AUTO
			? { customer360, wordcloud, insights, traceId }
			: { customer360, wordcloud, insights, botReply, traceId };
		// persist latest state in memory so front-end can poll
		lastCustomer360.set(customerId, payload);
		if (logger.isDebug) logger.debug('/v1/external-chat result', { customerId, durationMs: Date.now() - start });
		// Broadcast via SSE if subscribers
		const set = sseClients.get(customerId);
		if (set) {
			for (const clientRes of set) {
				try { sendSse(clientRes, payload); } catch(e) { /* ignore */ }
			}
		}
		res.json(payload);
	} catch (err) {
		logger.error('external-chat error', err);
		res.status(500).json({ error: 'Internal' });
	}
});

// Agent (human) sends a reply from Athena desktop UI to customer chat
router.post('/v1/agent-reply', (req, res) => {
	try {
		const { customerId, message } = req.body || {};
		if (!customerId || !message) return res.status(400).json({ error: 'customerId and message required' });
		logger.info('Agent reply sent', { customerId, len: message.length, preview: message.slice(0,120) });
		// Persist agent message in rolling history
		appendConversation(customerId, 'agent', message);
		const traceId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
		const payload = { type: 'agentReply', customerId, message, traceId, ts: Date.now() };
		const set = sseClients.get(customerId);
		if (set) {
			for (const clientRes of set) {
				try { sendSse(clientRes, payload); } catch(_){}
			}
		}
		return res.json({ ok: true, traceId });
	} catch (err) {
		logger.error('agent-reply error', err);
		res.status(500).json({ error: 'Internal' });
	}
});

// GET latest customer360
router.get('/v1/customer-360/:id', (req, res) => {
	const id = req.params.id;
	if (!id) return res.status(400).json({ error: 'id required' });
	const payload = lastCustomer360.get(id);
	if (!payload) return res.status(404).json({ error: 'not found' });
	res.json(payload);
});

export default router;
