const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/;

/**
 * The destination of a result link, or null if it isn't an external page.
 * Unwraps Google's /url?q= redirects, which would otherwise make every
 * result look like google.com.
 */
export function resultUrlFromHref(href: string): URL | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (GOOGLE_HOST.test(url.hostname)) {
		const target =
			url.pathname === "/url"
				? (url.searchParams.get("q") ?? url.searchParams.get("url"))
				: null;
		return target ? resultUrlFromHref(target) : null;
	}
	return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}
