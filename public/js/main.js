import { fetchInsightsFromServer, ALL_WIDGETS } from './api.js';
import * as aiPanel from './modules/aiPanel.js';
import * as customerPanel from './modules/customerPanel.js';
import * as conversationPanel from './modules/conversationPanel.js';
// Simple in-memory queue state (demo). In production fetched from backend.
// Predefined demo customer IDs for easy simulation & consistency across apps
const DEMO_CUSTOMER_IDS = ['GB26669607', 'GB13820473', 'GB22446688', 'GB77553311', 'GB99001234'];
const queueState = new Map(); // customerId -> { lastMessage, updatedAt }
function generateDemoCustomerId(){
	const n = Math.floor(Math.random()*90000000) + 10000000; // 8 digits
	return `GB${n}`;
}
function getQueryParam(name){
	const url = new URL(window.location.href);
	return url.searchParams.get(name);
}
function pickInitialCustomerId(){
	const fromQuery = getQueryParam('cust');
	if (fromQuery) {
		if (/^rand(om)?$/i.test(fromQuery)) {
			// Prefer random from predefined demo IDs for predictable demos
			const idx = Math.floor(Math.random() * DEMO_CUSTOMER_IDS.length);
			return DEMO_CUSTOMER_IDS[idx];
		}
		return fromQuery;
	}
	const saved = localStorage.getItem('activeCustomerId');
	if (saved) return saved;
	// Default aligns with first known demo ID unless overridden
	return DEMO_CUSTOMER_IDS[0];
}
let activeCustomerId = pickInitialCustomerId();
// Expose globally so modules can use the current customer
window.activeCustomerId = activeCustomerId;
window.getActiveCustomerId = () => window.activeCustomerId;
// Expose demo IDs globally for debugging or future UI selectors
window.DEMO_CUSTOMER_IDS = DEMO_CUSTOMER_IDS;
function updateCustomerBadge() {
	const badge = document.getElementById('cust-badge');
	if (badge) badge.textContent = `Customer: ${window.activeCustomerId}`;
}

function renderQueue(){
	const el = document.getElementById('queue-items');
	if (!el) return;
	el.innerHTML = '';
	const entries = Array.from(queueState.entries()).sort((a,b)=> b[1].updatedAt - a[1].updatedAt);
	entries.forEach(([cid, info]) => {
		const div = document.createElement('div');
		div.className = 'queue-item';
		if (cid === activeCustomerId) div.classList.add('active');
		div.innerHTML = `<div class="qid">${cid}</div><div class="qmsg">${(info.lastMessage||'').slice(0,60)}</div>`;
		div.addEventListener('click', () => {
			activeCustomerId = cid;
			window.activeCustomerId = activeCustomerId;
			try { localStorage.setItem('activeCustomerId', activeCustomerId); } catch(_) {}
			updateCustomerBadge();
			document.querySelectorAll('.queue-item.active').forEach(n=>n.classList.remove('active'));
			div.classList.add('active');
			// (Re)connect SSE for new customer
			startCustomerStream();
		});
		el.appendChild(div);
	});
}

function upsertQueue(customerId, lastMessage){
	queueState.set(customerId, { lastMessage, updatedAt: Date.now() });
	renderQueue();
}

function applyData(data) {
	if (!data || data.error) return;
	if (data.AI_SUMMARY) aiPanel.updateSummary(data.AI_SUMMARY);
	if (data.NEXT_BEST_ACTION) aiPanel.updateNba(data.NEXT_BEST_ACTION);
	if (data.LIVE_PROMPTS) aiPanel.updateLivePrompts(data.LIVE_PROMPTS);
	if (data.RESOLUTION_PREDICTOR) aiPanel.updateResolutionPredictor(data.RESOLUTION_PREDICTOR);
	if (data.KNOWLEDGE_GRAPH) aiPanel.updateKnowledgeGraph(data.KNOWLEDGE_GRAPH);
	if (data.SERVICE_PEDIA) aiPanel.updateServicePedia(data.SERVICE_PEDIA);
	if (data.SERVICE_PEDIA_V2) aiPanel.updateServicePedia(data.SERVICE_PEDIA_V2);
	if (data.LIVE_RESPONSE) aiPanel.updateLiveResponse(data.LIVE_RESPONSE);
	if (data.MINI_INSIGHTS) aiPanel.updateMiniInsights(data.MINI_INSIGHTS);
	if (data.ACCOUNT_HEALTH) customerPanel.updateHealthScore(data.ACCOUNT_HEALTH);
	if (data.CUSTOMER_360 || data.CUSTOMER_360_DEMOGRAPHICS) {
		const merged = { ...(data.CUSTOMER_360||{}), demographics: data.CUSTOMER_360_DEMOGRAPHICS };
		customerPanel.updateCustomer360(merged);
	}
	if (data.AGENT_NETWORK_ACTIONS) aiPanel.updateAgentNetworkActions(data.AGENT_NETWORK_ACTIONS);
}

function shouldPrefetch(){
	const url = new URL(window.location.href);
	return url.searchParams.get('prefetch') === '1';
}
async function initialLoad() {
	if (!shouldPrefetch()) return; // Skip prefetch; rely on CX client messages via SSE
	const data = await fetchInsightsFromServer({
		customerId: window.activeCustomerId,
		conversationHistory: conversationPanel.conversationHistory,
		requestedWidgets: ALL_WIDGETS.concat(['SERVICE_PEDIA_V2','CUSTOMER_360','MINI_INSIGHTS','AGENT_NETWORK_ACTIONS'])
	});
	applyData(data);
}

function initEventBridges() {
	window.addEventListener('insightsPartialUpdate', (e) => applyData(e.detail));
}

document.addEventListener('DOMContentLoaded', () => {
	console.debug('[Main] DOMContentLoaded - booting modules');
	customerPanel.init();
	aiPanel.init();
	conversationPanel.init();
	initEventBridges();
	updateCustomerBadge();
	initialLoad();

	// SSE stream for real-time customer360
	function startCustomerStream(){
		if (window.__custEvtSrc) { try { window.__custEvtSrc.close(); } catch(_){} }
		initSSE(activeCustomerId);
	}
	(function initSSEBootstrap(){
		let attempt = 0;
		const maxDelay = 30000;
		function initSSE(customer){
			function connect(){
			attempt++;
			const evtSrc = new EventSource(`/api/v1/stream/customer-360/${customer}`);
			window.__custEvtSrc = evtSrc;
			console.debug('[SSE] connecting attempt', attempt);
			evtSrc.onopen = () => { console.debug('[SSE] open'); attempt = 0; };
			evtSrc.onmessage = (e) => {
				try {
					const data = JSON.parse(e.data);
					if (data?.customer360) {
						const { customer360, insights } = data;
						customerPanel.updateCustomer360(customer360);
						// reflect external last message into conversation if new
						if (customer360.lastMessage) {
							conversationPanel.addExternalMessage(customer360.lastMessage);
							upsertQueue(customer360.id, customer360.lastMessage);
						}
						// Apply individual widget updates when available
						if (insights) {
							if (insights.AI_SUMMARY) aiPanel.updateSummary(insights.AI_SUMMARY);
							if (insights.NEXT_BEST_ACTION) aiPanel.updateNba(insights.NEXT_BEST_ACTION);
							if (insights.LIVE_PROMPTS) aiPanel.updateLivePrompts(insights.LIVE_PROMPTS);
							if (insights.RESOLUTION_PREDICTOR) aiPanel.updateResolutionPredictor(insights.RESOLUTION_PREDICTOR);
							if (insights.KNOWLEDGE_GRAPH) aiPanel.updateKnowledgeGraph(insights.KNOWLEDGE_GRAPH);
							if (insights.SERVICE_PEDIA) aiPanel.updateServicePedia(insights.SERVICE_PEDIA);
							if (insights.SERVICE_PEDIA_V2) aiPanel.updateServicePedia(insights.SERVICE_PEDIA_V2);
							if (insights.LIVE_RESPONSE) aiPanel.updateLiveResponse(insights.LIVE_RESPONSE);
							if (insights.MINI_INSIGHTS) aiPanel.updateMiniInsights(insights.MINI_INSIGHTS);
							if (insights.ACCOUNT_HEALTH) customerPanel.updateHealthScore(insights.ACCOUNT_HEALTH);
							if (insights.CUSTOMER_360 || insights.CUSTOMER_360_DEMOGRAPHICS) {
								const merged = { ...(insights.CUSTOMER_360||{}), demographics: insights.CUSTOMER_360_DEMOGRAPHICS };
								customerPanel.updateCustomer360(merged);
							}
						}
					}
				} catch(err){ console.warn('[SSE] parse error', err); }
			};
			evtSrc.onerror = () => {
				console.warn('[SSE] error, will retry');
				try { evtSrc.close(); } catch(_){}
				const delay = Math.min(1000 * 2 ** (attempt-1), maxDelay);
				setTimeout(connect, delay + Math.random()*500);
			};
			}
			connect();
		}
		// initial stream
		initSSE(activeCustomerId);
	})();
});
