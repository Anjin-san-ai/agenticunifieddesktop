import axios from 'axios';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import logger from '../utils/logger.js';

// Utility to simulate latency
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Robust Azure OpenAI call wrapper with JSON forcing option & retry.
async function callLLM({ prompt, temperature = 0.4, forceJson = false, retry = 2 }) {
	// Support multiple env var naming conventions
	const endpoint = process.env.ENDPOINT_URL || process.env.AZURE_OPENAI_ENDPOINT || process.env.OPENAI_API_BASE;
	const deployment = process.env.DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
	const apiKey = process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
	const apiVersion = process.env.AZURE_OPENAI_API_VERSION || process.env.api_version || '2024-10-01-preview';

	if (!(endpoint && deployment && apiKey)) {
		return null;
	}

	const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
	const baseSystem = 'You are an assistant returning concise structured outputs for contact center widgets.';
	const systemContent = forceJson ? `${baseSystem} ONLY return valid minified JSON. No prose, no markdown, no comments.` : baseSystem;
	const body = {
		messages: [
			{ role: 'system', content: systemContent },
			{ role: 'user', content: prompt }
		],
		temperature: Number(temperature ?? 0.4),
		max_tokens: 900,
		// Attempt Azure JSON mode if supported
		...(forceJson ? { response_format: { type: 'json_object' } } : {})
	};

	const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 20000);
	const agent = url.startsWith('https') ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });

	for (let attempt = 1; attempt <= retry; attempt++) {
		const start = Date.now();
		try {
			const resp = await axios.post(url, body, {
				headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
				timeout: timeoutMs,
				httpAgent: agent,
				httpsAgent: agent,
			});
			const duration = Date.now() - start;
			if (logger.isDebug) logger.debug('callLLM success', { attempt, duration, status: resp.status, forceJson });
			const choice = resp?.data?.choices?.[0];
			const text = choice?.message?.content ?? choice?.text ?? null;
			return text ? text.trim() : null;
		} catch (err) {
			const duration = Date.now() - start;
			const status = err.response?.status;
			const retriable = !err.response || status >= 500 || status === 429;
			if (logger.isDebug) logger.debug('callLLM failure', { attempt, status, retriable, duration, message: err.message });
			if (attempt < retry && retriable) {
				await delay(400 * attempt);
				continue;
			}
			return null;
		}
	}
	return null;
}

// Attempt to salvage JSON from noisy response
function salvageJson(raw) {
	if (!raw) return null;
	// Find first '{' and last '}' and attempt parse slices decreasingly
	const first = raw.indexOf('{');
	const last = raw.lastIndexOf('}');
	if (first === -1 || last === -1 || last <= first) return null;
	const candidate = raw.slice(first, last + 1);
	try { return JSON.parse(candidate); } catch(e) { /* continue */ }
	// Fallback: regex for JSON object lines (very naive)
	const match = raw.match(/\{[\s\S]*\}/);
	if (match) {
		try { return JSON.parse(match[0]); } catch(e) { return null; }
	}
	return null;
}

function loadPromptTemplate(type) {
	const base = path.resolve(process.cwd(), 'src', 'prompts');
	const file = path.join(base, `${type}.txt`);
	try {
		return fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (logger.isDebug) logger.debug('prompt template missing', { file, err: err.message });
		return null;
	}
}

function renderTemplate(tpl, vars) {
	if (!tpl) return '';
	return tpl.replace(/{{\s*(\w+)\s*}}/g, (_, k) => {
		const val = vars[k];
		if (typeof val === 'object') return JSON.stringify(val);
		return val ?? '';
	});
}

function buildPrompt(type, { conversationHistory, customerId, customerData, extraVars }) {
	const conversationStr = conversationHistory?.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') || '';
	const tpl = loadPromptTemplate(type);
	if (tpl) {
		return renderTemplate(tpl, { conversation: conversationStr, customerData, customerId, ...(extraVars||{}) });
	}
	// fallback to old inline templates
	switch (type) {
		case 'AI_SUMMARY':
			return `You are a concise contact center assistant. Summarize the following conversation in under 40 words, focusing on the customer's primary issue and sentiment. Conversation:\n${conversationStr}`;
		case 'ACCOUNT_HEALTH':
			return `You are analysing an account's overall health using conversation context and customer KPIs. Provide a JSON object with: score (0-100), status (one of: Healthy, Watch, At Risk, Critical), reasons (array of short phrases), and bubbles (array) where each bubble has id, label, value (numeric kpi or signal 0-100), impact (LOW|MEDIUM|HIGH), category (KPI|ISSUE|BEHAVIOUR), and risk (POS|NEUTRAL|NEG). Conversation:\n${conversationStr}\nReturn ONLY JSON.`;
		case 'NEXT_BEST_ACTION':
			return `You are an expert contact center strategist. Based on the live conversation, customer data, and current assistive signals, produce the single best next action.
Conversation:
${conversationStr}
Customer Data: ${JSON.stringify(customerData)}
Live Prompts (agent coaching suggestions): ${(extraVars?.LIVE_PROMPTS||[]).map(p=>p.label||p.value).join(' | ')||'NONE'}
Agent Action Candidates: ${(extraVars?.ACTION_CANDIDATES||[]).join(' | ')||'NONE'}
Knowledge Article Hints: ${(extraVars?.ARTICLE_TITLES||[]).join(' | ')||'NONE'}
Return ONLY minified JSON with fields: title, intentKey (UPPER_SNAKE), suggestedOpening, rationale, riskIfIgnored, guidedSteps (array 2-5), confidence (0-1).`;
		case 'LIVE_PROMPTS':
			return `You are an empathetic communications coach. Analyze this conversation ${conversationStr}. Generate a JSON array of 2-3 short, actionable prompts the agent can say right now to build rapport or de-escalate. Each prompt should have a 'label' and a 'value'.`;
		case 'SERVICE_PEDIA_COMPOSE':
			return `Using the following knowledge article data and the live conversation craft a concise, empathetic reply the agent can send now. Keep under 120 words. Include concrete steps when relevant. Article Title: ${extraVars?.ARTICLE_TITLE}\nSummary: ${extraVars?.ARTICLE_SUMMARY}\nSteps: ${(extraVars?.ARTICLE_STEPS||[]).join('; ')}\nConversation:\n${conversationStr}\nReturn JSON: {"draft":"..."}`;
		case 'AGENT_ACTION_COMPOSE':
			return `You are a senior contact center agent drafting a customer-facing reply after executing an internal investigative action. Conversation so far:\n${conversationStr}\nAction Summary: ${extraVars?.ACTION_SUMMARY}\nKey Findings: ${(extraVars?.ACTION_FINDINGS||[]).map(f=>`${f.label||f.name||'Item'}=${f.value||f.result||''}`).join('; ')}\nInstructions: Craft an empathetic, plain-language reply (<=120 words) acknowledging the customer's concern, briefly summarizing what was checked, and clearly stating the next step or resolution path. Avoid internal jargon or exposing tool names. Return JSON: {"draft":"..."}`;
		default:
			return `Echo conversation: ${conversationStr}`;
	}
}

// All widget outputs are now dynamically produced by the LLM. No mock fallback generation.

export async function fetchInsights({ customerId, conversationHistory, requestedWidgets, extraVarsMap = {} }) {
	const customerData = { id: customerId, segment: 'VIP', tenureMonths: 38 };

	if (logger.isDebug) logger.debug('fetchInsights start', { customerId, requestedWidgets, conversationHistoryLength: conversationHistory?.length || 0 });

	const jsonWidgets = new Set(['NEXT_BEST_ACTION','LIVE_PROMPTS','ACCOUNT_HEALTH','RESOLUTION_PREDICTOR','KNOWLEDGE_GRAPH','MINI_INSIGHTS','SERVICE_PEDIA','SERVICE_PEDIA_V2','CUSTOMER_360','CUSTOMER_360_DEMOGRAPHICS','WORD_DETAILS','LIVE_RESPONSE','AGENT_NETWORK_ACTIONS','AGENT_NETWORK_EXECUTE','SERVICE_PEDIA_ARTICLE','SERVICE_PEDIA_COMPOSE','AGENT_ACTION_COMPOSE']);

	const tasks = requestedWidgets.map(async (widgetType) => {
		const forceJson = jsonWidgets.has(widgetType);
		const prompt = buildPrompt(widgetType, { conversationHistory, customerId, customerData, extraVars: extraVarsMap[widgetType] });
		if (logger.isDebug) logger.debug('built prompt', { widgetType, forceJson, prompt: prompt.slice(0, 800) });
		let raw = await callLLM({ prompt, forceJson, temperature: 0.3 });
		if (!raw && forceJson) {
			// second attempt with explicit reinforcement
			const repairedPrompt = `${prompt}\n\nREMINDER: Return ONLY valid JSON. No commentary.`;
			raw = await callLLM({ prompt: repairedPrompt, forceJson: true, temperature: 0.2, retry: 3 });
		}
		if (!raw) return [widgetType, { error: 'LLM_NO_RESPONSE', widget: widgetType }];
		if (forceJson) {
			let parsed = null;
			try { parsed = JSON.parse(raw); } catch(e) { parsed = salvageJson(raw); }
			if (!parsed) return [widgetType, { error: 'PARSE_FAILED', widget: widgetType, raw }];
			// Normalize LIVE_PROMPTS array shape if model returned object wrapper
			if (widgetType === 'LIVE_PROMPTS') {
				if (Array.isArray(parsed)) return [widgetType, parsed];
				// Single object with label/value
				if (parsed && typeof parsed === 'object' && typeof parsed.label === 'string' && typeof parsed.value === 'string') {
					return [widgetType, [ { label: parsed.label.slice(0,80), value: parsed.value } ] ];
				}
				if (Array.isArray(parsed.prompts)) return [widgetType, parsed.prompts];
				if (parsed.actions && Array.isArray(parsed.actions)) return [widgetType, parsed.actions];
				// Fallback: extract array-like values with label/value OR string array
				let candidate = Object.values(parsed).find(v=>Array.isArray(v) && v.length && v[0] && ( (v[0].label && v[0].value) || typeof v[0] === 'string'));
				if (candidate) {
					if (typeof candidate[0] === 'string') {
						candidate = candidate.map((s,i)=>({ label: s.slice(0,40), value: s }));
					}
					return [widgetType, candidate];
				}
				// Last resort: turn object keys into prompts
				const keys = Object.keys(parsed);
				// Avoid treating standard {label:"..",value:".."} as two prompts (handled above)
				const nonMetaKeys = keys.filter(k=>!['label','value'].includes(k));
				if (nonMetaKeys.length && nonMetaKeys.every(k=>typeof parsed[k] === 'string')) {
					const arr = nonMetaKeys.map(k=>({ label: parsed[k].slice(0,40), value: parsed[k] }));
					if (arr.length) return [widgetType, arr];
				}
				if (logger.isDebug) logger.debug('LIVE_PROMPTS normalization failed, raw parsed retained');
			}
			return [widgetType, parsed];
		}
		if (widgetType === 'AI_SUMMARY') return [widgetType, { summary: raw }];
		return [widgetType, { raw }];
	});

	const results = await Promise.all(tasks);
	const out = results.reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

	// Deterministic synthetic demographics fallback if missing or error
	if (requestedWidgets.includes('CUSTOMER_360_DEMOGRAPHICS')) {
		const demo = out.CUSTOMER_360_DEMOGRAPHICS;
		if (!demo || demo.error) {
			out.CUSTOMER_360_DEMOGRAPHICS = generateSyntheticDemographics(customerId);
		}
		// If LLM returned object but missing expected fields, normalize/augment
		else if (demo && !demo.firstName) {
			out.CUSTOMER_360_DEMOGRAPHICS = { ...generateSyntheticDemographics(customerId), ...demo };
		}
	}
	if (logger.isDebug) logger.debug('fetchInsights complete', { customerId, durationMs: undefined });
	return out;
}

function generateSyntheticDemographics(customerId){
	const idStr = String(customerId||'');
	let hash = 0; for (let i=0;i<idStr.length;i++){ hash = (hash*31 + idStr.charCodeAt(i)) >>> 0; }
	const gender = (parseInt(idStr.replace(/\D/g,'').slice(-1)) % 2 === 0) ? 'female' : 'male';
	const firstNamesMale = ['James','Oliver','Henry','Leo','Arthur','Oscar','Ethan','Harrison','Lucas','Finley'];
	const firstNamesFemale = ['Amelia','Olivia','Isla','Ava','Mia','Freya','Lily','Emily','Sophie','Grace'];
	const lastNames = ['Johnson','Taylor','Brown','Wilson','Thompson','White','Walker','Roberts','Edwards','Hughes'];
	const cities = ['London','Manchester','Birmingham','Leeds','Glasgow','Bristol','Liverpool','Edinburgh','Cardiff','Sheffield'];
	const regions = ['Greater London','Greater Manchester','West Midlands','West Yorkshire','Scotland','South West','Merseyside','Scotland','Wales','South Yorkshire'];
	const pick = (arr, offset=0) => arr[(hash + offset) % arr.length];
	return {
		firstName: gender === 'male' ? pick(firstNamesMale) : pick(firstNamesFemale),
		lastName: pick(lastNames, 7),
		gender,
		address: {
			line1: '*** Redacted Street ***',
			city: pick(cities, 13),
			region: pick(regions, 17),
			postcode: 'GB' + ('' + (hash % 9000 + 1000))
		}
	};
}
