import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		lang: z.string().optional().default(""),
		comments: z.boolean().optional().default(true),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});
const poems = defineCollection({
	type: "content",
	schema: z.object({
		title: z.string(),
		author: z.string().default("佚名"),
		dynasty: z.string().optional(),
		lang: z.string().default("zh"),
		tags: z.array(z.string()).default([]),
		description: z.string().optional(),
		image: z.string().optional(),
		category: z.string().optional(),
		creationText: z.string().optional(),
		// ✅ 关键：用 coerce.date 接受字符串或 Date，统一成 Date
		published: z.coerce.date(), // 发表日期
		updated: z.coerce.date().optional(),
		draft: z.boolean().default(false),
		comments: z.boolean().optional(),
	}),
});

export const collections = {
	poems: poems,
	posts: postsCollection,
	spec: specCollection,
};
