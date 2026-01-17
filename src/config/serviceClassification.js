/**
 * Service Classification Module
 * Derives service context from product names
 */

/**
 * Derives service type from an array of product names
 * @param {string[]} productNames - Array of product name strings
 * @returns {{detailedType: string|null}} - Object with detailedType property
 */
export function deriveServiceContext(productNames) {
	if (!Array.isArray(productNames) || productNames.length === 0) {
		return { detailedType: null };
	}

	// Convert to lowercase for case-insensitive matching
	const names = productNames.map(name => String(name || '').toLowerCase());

	// Match against service type patterns (in priority order)
	const svc = names.find(n => /broadband|fiber|fibre|internet|wifi/.test(n))
		|| names.find(n => /mobile|cell|sim|handset/.test(n))
		|| names.find(n => /tv|television|set[-\s]?top/.test(n))
		|| names[0]; // Fallback to first product name

	return {
		detailedType: svc || null
	};
}
