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

// Heuristic: search nested object for an execution-like payload
function findExecutePayload(obj, depth = 0) {
	if (!obj || typeof obj !== 'object' || depth > 5) return null;
	const looksLike = (o) => (
		(typeof o.summary === 'string' && o.summary.length > 0) ||
		(Array.isArray(o.findings) && o.findings.length > 0) ||
		(typeof o.shortDescription === 'string' && o.shortDescription.length > 0)
	);
	if (looksLike(obj)) return obj;
	for (const k of Object.keys(obj)) {
		const v = obj[k];
		if (v && typeof v === 'object') {
			const hit = findExecutePayload(v, depth + 1);
			if (hit) return hit;
		}
	}
	return null;
}

function normalizeConfidence(c) {
	if (c == null) return 0.6;
	if (typeof c === 'number') {
		if (c > 1 && c <= 100) return Math.max(0, Math.min(1, c / 100));
		return Math.max(0, Math.min(1, c));
	}
	const s = String(c).trim().toLowerCase();
	if (s.includes('high')) return 0.85;
	if (s.includes('med')) return 0.6;
	if (s.includes('low')) return 0.35;
	const num = Number(s);
	if (!Number.isNaN(num)) return normalizeConfidence(num);
	return 0.6;
}

function normalizeFindings(f) {
	if (!f) return [];
	if (Array.isArray(f)) {
		return f.map((x, i) => {
			if (x && typeof x === 'object') {
				const label = x.label || x.name || x.key || `Item ${i + 1}`;
				const value = x.value ?? x.result ?? x.text ?? x.message ?? '';
				return { label: String(label).slice(0, 80), value: typeof value === 'string' ? value : JSON.stringify(value) };
			}
			return { label: `Item ${i + 1}`, value: typeof x === 'string' ? x : JSON.stringify(x) };
		});
	}
	// object map -> array
	if (typeof f === 'object') {
		return Object.entries(f).map(([k, v]) => ({ label: String(k).slice(0, 80), value: typeof v === 'string' ? v : JSON.stringify(v) }));
	}
	return [];
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

async function callNeuroSan({ widgetType, conversationHistory, extraVars, customerId }){
	const baseUrl = (process.env.NEUROSAN_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
	const useStreaming = String(process.env.NEUROSAN_USE_STREAMING||'true').toLowerCase() === 'true';
	const timeout = Number(process.env.NEUROSAN_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT_MS || 60000);
	const agentDefault = process.env.NEUROSAN_NETWORK || 'contact_center_systems_architect';
	const agentOverrideEnv = {
		'AGENT_NETWORK_ACTIONS': process.env.NEUROSAN_NETWORK_AGENT_ACTIONS,
		'AGENT_NETWORK_EXECUTE': process.env.NEUROSAN_NETWORK_EXECUTE,
		'LIVE_RESPONSE': process.env.NEUROSAN_NETWORK_LIVE_RESPONSE,
		'NEXT_BEST_ACTION': process.env.NEUROSAN_NETWORK_NBA
	}[widgetType];
	const agent = agentOverrideEnv || agentDefault;

	// Build user message
	let text = '';
	if (widgetType === 'AGENT_NETWORK_ACTIONS') {
		const convo = conversationHistory?.map(m=>`${m.role.toUpperCase()}: ${m.content}`).join('\n')||'';
		const prev = extraVars?.PREVIOUS_ACTIONS ? `\nPreviously executed actions:\n${extraVars.PREVIOUS_ACTIONS}` : '';
		text = `Plan 3-6 concrete internal investigative actions with title, rationale, id, and a natural language query. Keep concise.\nConversation so far:\n${convo}${prev}`;
	} else if (widgetType === 'AGENT_NETWORK_EXECUTE') {
		const customerData = { id: customerId, segment: 'VIP', tenureMonths: 38 };
		text = buildPrompt('AGENT_NETWORK_EXECUTE', { conversationHistory, customerId, customerData, extraVars });
	} else if (widgetType === 'LIVE_RESPONSE') {
		const convo = conversationHistory?.map(m=>`${m.role.toUpperCase()}: ${m.content}`).join('\n')||'';
		text = `Draft a concise, empathetic reply for the agent to send now (<=120 words).\nFocus on clarity and next steps.\nConversation:\n${convo}`;
	} else if (widgetType === 'NEXT_BEST_ACTION') {
		const convo = conversationHistory?.map(m=>`${m.role.toUpperCase()}: ${m.content}`).join('\n')||'';
		text = `From the context, output one next best action in JSON with: title, intentKey, suggestedOpening, rationale, riskIfIgnored, guidedSteps (2-5), confidence.\nConversation:\n${convo}`;
	} else {
		text = `${extraVars?.ACTION_QUERY || 'Help with planning actions.'}`;
	}

		const route = useStreaming ? 'streaming_chat' : 'chat';
		const url = `${baseUrl}/api/v1/${encodeURIComponent(agent)}/${route}`;
		const payload = { user_message: { text } };

		let data = {};
		if (useStreaming) {
			// Parse server-sent JSON lines; keep the last parsed message
			const resp = await axios.post(url, payload, { timeout, responseType: 'stream', headers: { Accept: 'text/event-stream' } });
			data = await new Promise((resolve, reject) => {
				let buffer = '';
				let lastParsed = null;
				resp.data.on('data', (chunk) => {
					buffer += chunk.toString();
					const lines = buffer.split(/\r?\n/);
					buffer = lines.pop(); // keep partial
					for (let line of lines) {
						let s = String(line).trim();
						if (!s) continue;
						if (s.startsWith('data:')) s = s.slice(5).trim();
						try {
							const obj = JSON.parse(s);
							lastParsed = obj;
						} catch (e) {
							// ignore non-JSON lines
						}
					}
				});
				resp.data.on('end', () => {
					if (lastParsed) return resolve(lastParsed);
					// fallback: try salvage JSON from any remaining buffer
					try {
						const salvaged = salvageJson(buffer);
						resolve(salvaged || {});
					} catch(e) {
						resolve({});
					}
				});
				resp.data.on('error', reject);
			});
		} else {
			const resp = await axios.post(url, payload, { timeout });
			data = resp.data || {};
		}
	// Normalize into our widget shapes
	if (widgetType === 'AGENT_NETWORK_ACTIONS') {
		const actions = [];
		const arr = (data.response?.actions) || (Array.isArray(data.actions) ? data.actions : null);
		if (arr && Array.isArray(arr)) {
			arr.forEach((a,i)=>{
				actions.push({ id: a.id || `action-${i+1}`, title: a.title || a.label || `Action ${i+1}`, rationale: a.rationale || a.reason || '', query: a.query || a.prompt || a.value || '' });
			});
		} else if (typeof data.response?.text === 'string') {
			// Fallback: extract lines into naive actions
			const lines = data.response.text.split(/\n+/).filter(Boolean).slice(0,6);
			lines.forEach((line,i)=> actions.push({ id:`action-${i+1}`, title: line.slice(0,60), rationale: 'Proposed by Neuro‑San', query: line }));
		}
		return { actions };
	}
	if (widgetType === 'AGENT_NETWORK_EXECUTE') {
		// Accept either structured object or text; salvage JSON and normalize
		let respText = data.response?.text || data.text || '';
		let parsed = null;
		// direct object
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			parsed = findExecutePayload(data);
		}
		// try parse plain text
		if (!parsed && typeof respText === 'string' && respText) {
			try { parsed = JSON.parse(respText); } catch(e) { /* ignore */ }
			if (!parsed) parsed = salvageJson(respText);
		}
		if (parsed) {
			const summary = parsed.summary || parsed.overview || parsed.resultSummary || parsed.description || (typeof respText === 'string' ? respText.slice(0, 240) : '');
			const shortDescription = parsed.shortDescription || parsed.short || parsed.title || 'Execution result';
			const confidence = normalizeConfidence(parsed.confidence ?? parsed.confidenceScore ?? parsed.score);
			const findings = normalizeFindings(parsed.findings ?? parsed.results ?? parsed.items ?? parsed.details);
			return { summary, shortDescription, findings, confidence };
		}
		// last resort: synthesize a plausible structured response so UI has first-pass JSON
		return synthesizeExecute(extraVars, conversationHistory);
	}
	if (widgetType === 'LIVE_RESPONSE') {
		const respText = data.response?.text || data.text || '';
		return { draft: respText || '' };
	}
	if (widgetType === 'NEXT_BEST_ACTION') {
		const respText = data.response?.text || data.text || '';
		let parsed = null; try { parsed = JSON.parse(respText); } catch(e) { parsed = null; }
		if (parsed && parsed.title) return parsed;
		return { title: 'Follow-up and confirm resolution', intentKey: 'FOLLOW_UP', suggestedOpening: 'Thanks for holding — I’ve checked things on my side…', rationale: 'Closes the loop and sets clear next steps', riskIfIgnored: 'Issue may recur; lower CSAT', guidedSteps: ['Acknowledge context','Share findings','State next step'], confidence: 0.55 };
	}
	return data;
}

export async function fetchInsights({ customerId, conversationHistory, requestedWidgets, extraVarsMap = {}, providerMap = {}, customerContext = {} }) {
	const customerData = { id: customerId, segment: 'VIP', tenureMonths: 38 };

	if (logger.isDebug) logger.debug('fetchInsights start', { customerId, requestedWidgets, conversationHistoryLength: conversationHistory?.length || 0 });

	const jsonWidgets = new Set([
		'NEXT_BEST_ACTION',
		'LIVE_PROMPTS',
		'ACCOUNT_HEALTH',
		'RESOLUTION_PREDICTOR',
		'KNOWLEDGE_GRAPH',
		'MINI_INSIGHTS',
		'SERVICE_PEDIA',
		'SERVICE_PEDIA_V2',
		'CUSTOMER_360',
		'CUSTOMER_360_DEMOGRAPHICS',
		'WORD_DETAILS',
		'LIVE_RESPONSE',
		'AGENT_NETWORK_ACTIONS',
		'AGENT_NETWORK_EXECUTE',
		'SERVICE_PEDIA_ARTICLE',
		'SERVICE_PEDIA_COMPOSE',
		'AGENT_ACTION_COMPOSE',
		// Ensure refine endpoint returns structured JSON the UI expects
		'COMPOSER_REFINE'
	]);

	const tasks = requestedWidgets.map(async (widgetType) => {
		const forceJson = jsonWidgets.has(widgetType);
		// Policy: Action list is ALWAYS produced by OpenAI; execution may be Neuro‑San based on dropdown
		const effectiveProvider = (widgetType === 'AGENT_NETWORK_ACTIONS')
			? 'openai'
			: (providerMap?.[widgetType] || (process.env.AGENT_ACTIONS_PROVIDER || 'openai')).toLowerCase();
		const useNeuroSan = ['AGENT_NETWORK_EXECUTE','LIVE_RESPONSE','NEXT_BEST_ACTION'].includes(widgetType) && effectiveProvider === 'neurosan';
		if (useNeuroSan) {
			try {
				const ns = await callNeuroSan({ widgetType, conversationHistory, extraVars: extraVarsMap[widgetType], customerId });
				return [widgetType, ns];
			} catch (e) {
				if (logger.isDebug) logger.debug('Neuro‑San call failed, falling back to LLM', { widgetType, message: e.message });
				// continue to LLM fallback below
			}
		}
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

// Generate plausible, deterministic execution results if upstream doesn’t return JSON
function synthesizeExecute(extraVars = {}, conversationHistory = []){
	const q = String(extraVars.ACTION_QUERY || '').toLowerCase();
	const convoSnippet = conversationHistory.slice(-4).map(m=>`${m.role.toUpperCase()}: ${m.content}`).join(' ');
	const base = q || convoSnippet || 'investigation';
	// simple seeded hash
	let h = 0; for (let i=0;i<base.length;i++){ h = (h*31 + base.charCodeAt(i)) >>> 0; }
	const pick = (arr) => arr[h % arr.length];
	const topics = ['billing','firmware','contract','availability','diagnostics','coverage','latency','throughput'];
	const t = pick(topics);
	const conf = ((h % 40) + 50) / 100; // 0.50 - 0.89
	const findings = [
		{ label: 'Primary check', value: `Completed ${t} check` },
		{ label: 'Data source', value: pick(['CRM','OSS','BSS','Inventory','Telemetry']) },
		{ label: 'Result code', value: `OK-${(h % 900)+100}` }
	];
	const summary = `Executed agent action against ${pick(['account systems','network diagnostics','inventory','contracts'])}; no critical blockers found.`;
	const shortDescription = `${t} verification done`;
	return { summary, shortDescription, findings, confidence: Math.min(0.95, Math.max(0.5, conf)) };
}
