function getBase() {
	// Same-origin by default; allow override for dev via window.__API_BASE__
	return window.__API_BASE__ || '';
}

export async function fetchInsightsFromServer(payload) {
	try {
		const res = await fetch(`${getBase()}/api/v1/get-insights`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} catch (err) {
		console.error('fetchInsightsFromServer error', err);
		return { error: true, message: err.message };
	}
}

export const ALL_WIDGETS = [
	'AI_SUMMARY',
	'ACCOUNT_HEALTH',
	'NEXT_BEST_ACTION',
	'RESOLUTION_PREDICTOR',
	'LIVE_PROMPTS',
	'KNOWLEDGE_GRAPH',
	'SERVICE_PEDIA_V2',
	'CUSTOMER_360',
	'CUSTOMER_360_DEMOGRAPHICS',
	'LIVE_RESPONSE'
,
	'AGENT_NETWORK_ACTIONS'
];
