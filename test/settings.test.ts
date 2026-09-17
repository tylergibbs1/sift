import { DEFAULT_SETTINGS, parseStoredSettings } from "../src/settings";

describe("parseStoredSettings", () => {
	it("returns defaults when nothing is stored", () => {
		expect(parseStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("fills in fields added after the settings were saved", () => {
		const s = parseStoredSettings({
			hideSeoFiller: false,
			weights: { depth: 0.9 },
		});
		expect(s.hideSeoFiller).toBe(false);
		expect(s.weights).toEqual({ ...DEFAULT_SETTINGS.weights, depth: 0.9 });
		expect(s.flagThreshold).toBe(0.85);
	});

	it("falls back to defaults for invalid values", () => {
		expect(parseStoredSettings({ flagThreshold: 3 })).toEqual(DEFAULT_SETTINGS);
	});
});
