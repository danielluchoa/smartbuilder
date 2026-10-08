/* Browser-side entry of the local @hatch/space-sdk stand-in.
 *
 * Replaces the Muse shell's action client with a plain fetch RPC client:
 * every `api.<action>(args)` call POSTs `{ action, args }` to `./actions`
 * on the same origin and resolves with the action's result — the exact
 * contract the SmartBuilder client was written against.
 */
import { QueryClient } from "@tanstack/react-query";
import type { z } from "zod";

/** Shared react-query client (the Muse shell provided this as
 *  `spaceQueryClient`). Refetch on focus keeps a second phone (e.g. a
 *  spouse testing on her own device) reasonably fresh. */
export const spaceQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

type ActionDefLike = { request: z.ZodType; response: z.ZodType };

export type ApiRequest<C, K extends keyof C> = C[K] extends (args: infer A) => unknown ? A : never;
export type ApiResponse<C, K extends keyof C> = C[K] extends (args: never) => infer R ? Awaited<R> : never;

export function createActionClient<T extends Record<string, ActionDefLike>>(): {
  [K in keyof T]: (args: z.input<T[K]["request"]>) => Promise<z.output<T[K]["response"]>>;
} {
  const call = async (action: string, args: unknown): Promise<unknown> => {
    const res = await fetch("./actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, args: args ?? {} }),
    });
    let data: { result?: unknown; error?: string } | null = null;
    try {
      data = (await res.json()) as { result?: unknown; error?: string };
    } catch {
      /* non-JSON error response (proxy/gateway page) */
    }
    if (!res.ok) {
      throw new Error(data?.error ?? `Request failed (${res.status})`);
    }
    return data?.result;
  };

  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        // `then` guard: never look like a thenable if something awaits us.
        if (typeof prop !== "string" || prop === "then") return undefined;
        return (args: unknown) => call(prop, args);
      },
    },
  );
  return proxy as {
    [K in keyof T]: (args: z.input<T[K]["request"]>) => Promise<z.output<T[K]["response"]>>;
  };
}
