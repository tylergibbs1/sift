export type KeyValueStore = {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	entries(): Promise<[string, unknown][]>;
	remove(keys: string[]): Promise<void>;
};

export type Cache<T> = {
	get(key: readonly string[]): Promise<T | null>;
	set(key: readonly string[], value: T): Promise<void>;
	pruneExpired(): Promise<void>;
};

export type CacheOptions<T> = {
	/** Storage key prefix; keeps caches apart and lets pruning find its own entries. */
	readonly namespace: string;
	/** Stored values are re-validated on read, so a corrupt entry is just a miss. */
	readonly schema: {
		safeParse(value: unknown): { success: true; data: T } | { success: false };
	};
	/**
	 * Whatever produced the values, e.g. the question set. It's hashed into every
	 * key, so changing a prompt invalidates old entries automatically.
	 */
	readonly fingerprint: unknown;
	readonly now?: () => number;
	readonly ttlMs?: number;
};

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createCache<T>(
	store: KeyValueStore,
	options: CacheOptions<T>,
): Cache<T> {
	const prefix = `${options.namespace}:`;
	const fingerprint = JSON.stringify(options.fingerprint);
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

	const read = (raw: unknown): { at: number; value: T } | null => {
		if (typeof raw !== "object" || raw === null) return null;
		const { at, value } = raw as Record<string, unknown>;
		const parsed = options.schema.safeParse(value);
		if (typeof at !== "number" || !parsed.success) return null;
		return now() - at < ttlMs ? { at, value: parsed.data } : null;
	};
	const keyFor = async (key: readonly string[]) =>
		prefix + (await sha256(JSON.stringify([fingerprint, ...key])));

	return {
		async get(key) {
			return read(await store.get(await keyFor(key)))?.value ?? null;
		},
		async set(key, value) {
			await store.set(await keyFor(key), { at: now(), value });
		},
		async pruneExpired() {
			const stale = (await store.entries())
				.filter(([key, raw]) => key.startsWith(prefix) && !read(raw))
				.map(([key]) => key);
			if (stale.length > 0) await store.remove(stale);
		},
	};
}

async function sha256(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export function chromeLocalStore(): KeyValueStore {
	const area = chrome.storage.local;
	return {
		async get(key) {
			return (await area.get(key))[key];
		},
		set: (key, value) => area.set({ [key]: value }),
		async entries() {
			return Object.entries(await area.get(null));
		},
		remove: (keys) => area.remove(keys),
	};
}
