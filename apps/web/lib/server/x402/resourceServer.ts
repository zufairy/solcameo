import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { REPORT_PRICE_MICROS, x402Config } from "./config";

let cached: { key: string; promise: Promise<x402ResourceServer> } | undefined;
export async function getResourceServer() {
  const config = x402Config();
  const key = JSON.stringify(config);
  if (!cached || cached.key !== key) {
    const promise = (async () => {
      const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl, timeoutMs: 10_000,
        ...(process.env.X402_FACILITATOR_BEARER_TOKEN ? { createAuthHeaders: async () => {
          const headers = { Authorization: `Bearer ${process.env.X402_FACILITATOR_BEARER_TOKEN}` };
          return { verify: headers, settle: headers, supported: headers };
        } } : {}) }))
        .register(config.network, new ExactSvmScheme());
      // /supported must advertise this exact chain and scheme. Fail closed otherwise.
      await server.initialize();
      if (!server.getSupportedKind(2, config.network, "exact")) throw new Error("Facilitator does not support configured Solana network");
      return server;
    })();
    cached = { key, promise };
    promise.catch(() => { if (cached?.promise === promise) cached = undefined; });
  }
  const server = await cached.promise;
  const requirements = await server.buildPaymentRequirements({ scheme: "exact", network: config.network,
    payTo: config.payTo, price: { asset: config.asset, amount: String(REPORT_PRICE_MICROS) }, maxTimeoutSeconds: 60 });
  return { server, requirements, config };
}
