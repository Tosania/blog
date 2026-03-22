import type { CollectionEntry } from "astro:content";

export type PostSection = "research" | "tech" | "life" | "hidden";

export const PUBLIC_POST_SECTIONS: PostSection[] = ["research", "tech", "life"];

function containsAny(text: string, keywords: string[]) {
	const normalized = text.toLowerCase();
	return keywords.some((k) => normalized.includes(k.toLowerCase()));
}

export function inferPostSection(entry: CollectionEntry<"posts">): PostSection {
	if (entry.data.section) return entry.data.section;

	const haystack = [
		entry.data.title,
		entry.data.description || "",
		entry.data.category || "",
		...(entry.data.tags || []),
		entry.slug,
	]
		.join(" ")
		.toLowerCase();

	const researchKeywords = [
		"科研",
		"research",
		"simulation",
		"robot",
		"robotics",
		"reinforcement",
		"technical report",
		"viewpoint",
		"agi",
		"仿真",
		"强化学习",
	];

	const techKeywords = [
		"技术",
		"tech",
		"guide",
		"教程",
		"代码",
		"开发",
		"fuwari",
		"astro",
		"pybullet",
	];

	if (containsAny(haystack, researchKeywords)) return "research";
	if (containsAny(haystack, techKeywords)) return "tech";
	return "life";
}

export function isHiddenPost(entry: CollectionEntry<"posts">) {
	return inferPostSection(entry) === "hidden";
}
