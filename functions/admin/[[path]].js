import {
  cleanText,
  errorResponse,
  isProduction,
  requireCloudflareAccess,
} from "../api/_utils.js";

function accessIsConfigured(env) {
  return Boolean(
    cleanText(env.CF_ACCESS_AUD || env.POLICY_AUD)
      && cleanText(env.CF_ACCESS_TEAM_DOMAIN),
  );
}

export async function onRequest(context) {
  try {
    if (isProduction(context.env) && !accessIsConfigured(context.env)) {
      return errorResponse("Admin access is not configured.", 403);
    }
    await requireCloudflareAccess(context.request, context.env);
    return context.next();
  } catch (error) {
    return errorResponse(error.message || "Admin authorization failed.", error.status || 500);
  }
}
