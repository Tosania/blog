import type { APIRoute } from "astro";

export const prerender = false;

const COOKIE_NAME = "hidden_mode";

export const GET: APIRoute = async ({ cookies }) => {
	const enabled = cookies.get(COOKIE_NAME)?.value === "1";
	return new Response(JSON.stringify({ enabled }), {
		headers: { "content-type": "application/json" },
	});
};

export const POST: APIRoute = async ({ request, cookies }) => {
	try {
		const body = await request.json();
		const enabled = Boolean(body?.enabled);
		const isHttps = new URL(request.url).protocol === "https:";

		if (enabled) {
			cookies.set(COOKIE_NAME, "1", {
				path: "/",
				httpOnly: true,
				sameSite: "lax",
				secure: isHttps,
				maxAge: 60 * 60 * 24 * 30,
			});
		} else {
			cookies.delete(COOKIE_NAME, { path: "/" });
		}

		return new Response(JSON.stringify({ ok: true, enabled }), {
			headers: { "content-type": "application/json" },
		});
	} catch {
		return new Response(JSON.stringify({ ok: false, message: "Bad request" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}
};
