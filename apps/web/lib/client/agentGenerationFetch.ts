export const AGENT_FUNDING_EVENT = "solcameo:agent-needs-funding";
export type AgentFundingRequest = { mintAddress: string; required?: number };

/** Preserve the response body for the caller; signal only a confirmed funding denial. */
export async function agentGenerationFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  await notifyAgentFunding(response, input, init);
  return response;
}

export async function notifyAgentFunding(response: Response, input: RequestInfo | URL, init?: RequestInit) {
  if (response.status === 402 || String(input).includes("/api/economy/clip-precheck")) {
    const data = await response.clone().json().catch(() => null);
    const reason = data?.code ?? data?.reason ?? data?.error;
    if (["needs_funding", "insufficient_funds", "no_account"].includes(reason)) {
      let body: Record<string, unknown> = {};
      try { if (typeof init?.body === "string") body = JSON.parse(init.body); } catch { /* not JSON */ }
      const mint = data.mintAddress ?? body.mintAddress ?? body.username;
      if (typeof mint === "string" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<AgentFundingRequest>(AGENT_FUNDING_EVENT, {
          cancelable: true,
          detail: { mintAddress: mint, required: typeof data.required === "number" ? data.required : data.estCostUsdc },
        }));
      }
    }
  }
}
