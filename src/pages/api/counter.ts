// src/pages/api/counter.ts
import type { APIRoute } from 'astro';

const BASE = import.meta.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = import.meta.env.UPSTASH_REDIS_REST_TOKEN!;

/** 拼 key：全站访客 or 某篇文章阅读数 */
function makeKey(type: string, path?: string) {
  if (type === 'site') return 'fuwari:site:visitors';
  if (type === 'post' && path) return `fuwari:post:${path}`;
  throw new Error('bad key');
}

/** Upstash REST 小工具 */
async function redisIncr(key: string) {
  const resp = await fetch(`${BASE}/incr/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  // Upstash REST incr 返回 JSON 数字或包含 result 的对象（不同地区版本略有差异）
  const data = await resp.json();
  return Number(data?.result ?? data);
}

async function redisGet(key: string) {
  const resp = await fetch(`${BASE}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await resp.json();
  return Number(data?.result ?? data ?? 0);
}

/** POST = 自增（首次访问/首次阅读才调用）*/
export const POST: APIRoute = async ({ request }) => {
  try {
    const { type, path } = await request.json();
    const key = makeKey(type, path);
    const count = await redisIncr(key);
    return new Response(JSON.stringify({ count }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400 });
  }
};

/** GET = 读取当前计数 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const type = url.searchParams.get('type') || 'site';
    const path = url.searchParams.get('path') || undefined;
    const key = makeKey(type, path);
    const count = await redisGet(key);
    return new Response(JSON.stringify({ count }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400 });
  }
};
