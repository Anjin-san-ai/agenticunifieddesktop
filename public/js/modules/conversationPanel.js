import { fetchInsightsFromServer } from '../api.js';

const chatLog = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const graderWidget = document.getElementById('response-grader-widget');
const gradeTone = document.getElementById('grade-tone');
const gradeClarity = document.getElementById('grade-clarity');
const gradeEmpathy = document.getElementById('grade-empathy');

let conversationHistory = [];

function formatRichText(raw){
	// Escape basic HTML then apply lightweight markdown-ish transforms
	let txt = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	// Headings (lines starting with #)
	txt = txt.replace(/^#{1,3}\s*(.+)$/gm, (m,p)=>`<strong style="display:block;margin:6px 0 2px;font-size:.75rem;letter-spacing:.5px;text-transform:uppercase;color:var(--bt-purple);">${p}</strong>`);
	// Bullet lists (- or * )
	// Convert groups of bullet lines into <ul>
	txt = txt.replace(/(?:^(?:-|\*) .+(?:\n|$)){1,}/gm, block => {
		const items = block.trim().split(/\n/).map(line=> line.replace(/^(?:-|\*)\s+/, '')).filter(Boolean);
		return `<ul class="msg-list">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
	});
	// Numbered lists 1. 2. etc
	txt = txt.replace(/(?:^(?:\d+)\. .+(?:\n|$)){1,}/gm, block => {
		const items = block.trim().split(/\n/).map(line=> line.replace(/^\d+\.\s+/, '')).filter(Boolean);
		return `<ol class="msg-list num">${items.map(i=>`<li>${i}</li>`).join('')}</ol>`;
	});
	// Simple tables (lines with |)
	if (/^\s*\|.*\|/m.test(txt)){
		txt = txt.replace(/((?:^\|.*\|.*\n?)+)/gm, tbl => {
			const rows = tbl.trim().split(/\n/).map(r=> r.split('|').slice(1,-1).map(c=>c.trim()));
			if (!rows.length) return tbl;
			const header = rows[0];
			const body = rows.slice(1);
			return `<table class="msg-table"><thead><tr>${header.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
		});
	}
	// Paragraph breaks (double newline)
	txt = txt.replace(/\n{2,}/g, '</p><p>');
	// Single newlines -> <br>
	txt = txt.replace(/\n/g, '<br/>');
	return `<p>${txt}</p>`;
}

function addMessage(role, content) {
	conversationHistory.push({ role, content });
	const div = document.createElement('div');
	div.className = `message ${role === 'agent' ? 'agent' : 'customer'}`;
	div.innerHTML = formatRichText(content);
	chatLog.appendChild(div);
	// ensure animation triggers even for rapid consecutive inserts
	// the CSS already applies bubbleIn on .message, but reflow helps when appending many quickly
	void div.offsetWidth; // reflow
	chatLog.scrollTop = chatLog.scrollHeight;
	// Emit event so dependent widgets (e.g., Agent Network) can update contextually
	window.dispatchEvent(new CustomEvent('conversationChanged', { detail: { conversationHistory } }));
}

// Add a customer message coming from external system (SSE) while preventing duplicates
function addExternalMessage(content) {
 	const last = conversationHistory[conversationHistory.length - 1];
 	if (last && last.role === 'customer' && last.content === content) return; // dedupe
 	addMessage('customer', content);
}

function gradeResponse(text) {
	if (!text.trim()) { graderWidget.classList.add('hidden'); return; }
	graderWidget.classList.remove('hidden');
	let empathyScore = (text.match(/sorry|understand|frustrating|apologize|clarify|patience|sorted/gi) || []).length * 40;
	const set = (el, score) => {
		el.style.width = Math.min(100, score) + '%';
		let color = 'var(--accent-positive)';
		if (score < 70) color = 'var(--accent-warning)';
		if (score < 40) color = 'var(--accent-negative)';
		el.style.background = color;
	};
	set(gradeEmpathy, empathyScore);
	set(gradeClarity, Math.max(20, 100 - Math.abs(100 - text.length) / 2));
	set(gradeTone, 80);
}

async function sendAgentMessage() {
	const text = chatInput.value.trim();
	if (!text) return;
	addMessage('agent', text);
	chatInput.value = '';
	gradeResponse('');
	// Broadcast agent reply to external customer via server endpoint (SSE push)
	try {
		await fetch('/api/v1/agent-reply', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ customerId: window.getActiveCustomerId ? window.getActiveCustomerId() : 'GB26669607', message: text })
		});
	} catch (e) {
		console.warn('Failed to broadcast agent reply', e);
	}
	// Request incremental AI updates based on new conversation turn
	try {
		const partial = await fetchInsightsFromServer({
			customerId: window.getActiveCustomerId ? window.getActiveCustomerId() : 'GB26669607',
			conversationHistory,
			requestedWidgets: ['NEXT_BEST_ACTION', 'LIVE_PROMPTS', 'AI_SUMMARY', 'RESOLUTION_PREDICTOR']
		});
		const evt = new CustomEvent('insightsPartialUpdate', { detail: partial });
		window.dispatchEvent(evt);
	} catch (e) {
		console.warn('Partial insights update failed', e);
	}
}

function init() {
	sendBtn.addEventListener('click', sendAgentMessage);
	chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }});
	chatInput.addEventListener('input', () => { gradeResponse(chatInput.value); });
	// Make input more comfortable initial height & allow vertical resize
	chatInput.style.minHeight = '120px';
	chatInput.style.resize = 'vertical';
	// expose conversation history globally for other modules needing prompt context (e.g. ServicePedia article expansion)
	window.conversationHistory = conversationHistory;
	window.addEventListener('insertPromptToChat', (e) => {
		chatInput.value += (chatInput.value ? ' ' : '') + e.detail.value;
		chatInput.focus();
		gradeResponse(chatInput.value);
	});
	window.addEventListener('insertComposerText', (e) => {
		chatInput.value = e.detail.value;
		chatInput.focus();
		gradeResponse(chatInput.value);
	});
	// no seed; waits for external chat or agent input
}

export { init, conversationHistory, addExternalMessage };
