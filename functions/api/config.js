import { cleanText, isProduction, jsonResponse, targetedOnlyMode } from "./_utils.js";

export function onRequestGet(context) {
  return jsonResponse({
    ok: true,
    production: isProduction(context.env),
    targeted_only: targetedOnlyMode(context.env),
    turnstile_site_key: cleanText(context.env.TURNSTILE_SITE_KEY),
    require_turnstile: cleanText(context.env.REQUIRE_TURNSTILE) === "1",
  });
}

export function onRequest(context) {
  if (context.request.method === "OPTIONS") return jsonResponse({ ok: true });
  return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
}
