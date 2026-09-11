import handler from "vinext/server/fetch-handler";

import {
  refreshNbcExchangeRate,
  type ExchangeRateWorkerEnv,
} from "../src/lib/exchange-rate-server";

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerEnv = ExchangeRateWorkerEnv & Record<string, unknown>;

const worker = {
  fetch(request: Request, env: WorkerEnv, ctx: WorkerContext) {
    return handler.fetch(request, env, ctx);
  },

  scheduled(_controller: unknown, env: WorkerEnv, ctx: WorkerContext) {
    ctx.waitUntil(
      refreshNbcExchangeRate(env, { force: true }).catch((error) => {
        console.error("[exchange-rate] scheduled refresh failed", error);
      }),
    );
  },
};

export default worker;
