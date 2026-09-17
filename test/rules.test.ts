import { parseStoredRules, ruleFor, siteDomainOf } from "../src/rules";
import { resultUrlFromHref } from "../src/serp/links";
import { domain } from "./helpers";

describe("siteDomainOf", () => {
	it("normalizes case and strips www", () => {
		expect(siteDomainOf("https://WWW.Example.com/path")).toBe("example.com");
	});

	it("rejects things that aren't site URLs", () => {
		expect(siteDomainOf("not a url")).toBeNull();
		expect(siteDomainOf("http://localhost:3000/")).toBeNull();
	});
});

describe("ruleFor", () => {
	const rules = {
		[domain("example.com")]: "hide",
		[domain("blog.example.com")]: "boost",
	} as const;

	it("matches subdomains, most specific first", () => {
		expect(ruleFor(rules, domain("example.com"))).toBe("hide");
		expect(ruleFor(rules, domain("shop.example.com"))).toBe("hide");
		expect(ruleFor(rules, domain("blog.example.com"))).toBe("boost");
		expect(ruleFor(rules, domain("a.blog.example.com"))).toBe("boost");
	});

	it("doesn't match lookalike domains", () => {
		expect(ruleFor(rules, domain("notexample.com"))).toBeNull();
		expect(ruleFor(rules, domain("example.com.evil.net"))).toBeNull();
	});
});

describe("parseStoredRules", () => {
	it("keeps valid rules and drops only the bad ones", () => {
		expect(
			parseStoredRules({
				"reddit.com": "boost",
				"www.bad.com": "hide",
				"ok.org": "explode",
			}),
		).toEqual({ "reddit.com": "boost" });
		expect(parseStoredRules("nope")).toEqual({});
	});
});

describe("resultUrlFromHref", () => {
	it("unwraps Google redirect links", () => {
		const href =
			"https://www.google.com/url?sa=t&q=https%3A%2F%2Fwww.reddit.com%2Fr%2Fx&ved=1";
		expect(resultUrlFromHref(href)?.href).toBe("https://www.reddit.com/r/x");
	});

	it("rejects Google-internal and non-web links", () => {
		expect(
			resultUrlFromHref("https://www.google.com/search?tbm=isch"),
		).toBeNull();
		expect(
			resultUrlFromHref(
				"https://www.google.com/url?q=https://maps.google.com/x",
			),
		).toBeNull();
		expect(resultUrlFromHref("javascript:alert(1)")).toBeNull();
	});
});
