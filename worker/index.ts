import handler from "vinext/server/fetch-handler";

import { setV5Env } from "../src/lib/billing-v5/repository";
import {
  refreshNbcExchangeRate,
  type ExchangeRateWorkerEnv,
} from "../src/lib/exchange-rate-server";

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerEnv = ExchangeRateWorkerEnv & Record<string, unknown>;

const isV5 = (env: WorkerEnv) => env.CIJD_V5_MODE === "1";

/** Only the V5 app lives on the V5 Worker; old entry points lead to it. */
function v5Redirect(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/" || path === "/office-v3" || path.startsWith("/office-v3/") || path === "/signin") {
    return Response.redirect(new URL("/office-v5", url), 302);
  }
  return null;
}

const worker = {
  fetch(request: Request, env: WorkerEnv, ctx: WorkerContext) {
    if (isV5(env)) {
      setV5Env(env);
      const redirect = v5Redirect(request);
      if (redirect) return redirect;
    }
    return handler.fetch(request, env, ctx);
  },

  scheduled(_controller: unknown, env: WorkerEnv, ctx: WorkerContext) {
    // V5 reads its NBC rate on demand from Accounting; the V3 refresh writes
    // to Supabase and must never run from the V5 Worker.
    if (isV5(env)) return;
    ctx.waitUntil(
      refreshNbcExchangeRate(env, { force: true }).catch((error) => {
        console.error("[exchange-rate] scheduled refresh failed", error);
      }),
    );
  },
};

export default worker;
