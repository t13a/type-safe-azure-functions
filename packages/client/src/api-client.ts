import type {
  RouteDefinition,
  InferParams,
  InferBody,
  InferResponse,
} from "@my-app/shared";

type HasParams<R> =
  InferParams<R> extends Record<string, never> ? false : true;
type HasBody<R> =
  R extends RouteDefinition<infer M, any, any, any, any>
    ? M extends "POST" | "PUT" | "PATCH"
      ? true
      : false
    : false;

type RequestArgs<R> =
  HasParams<R> extends true
    ? HasBody<R> extends true
      ? [params: InferParams<R>, body: InferBody<R>]
      : [params: InferParams<R>]
    : HasBody<R> extends true
      ? [params: InferParams<R>, body: InferBody<R>]
      : [params?: InferParams<R>];

function buildUrl(
  baseUrl: string,
  route: string,
  params: Record<string, string>,
): string {
  let path = route;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return `${baseUrl}/api/${path}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

export function createApiClient(baseUrl: string) {
  async function request<R extends RouteDefinition<any, any, any, any, any>>(
    route: R,
    ...args: RequestArgs<R>
  ): Promise<InferResponse<R>> {
    const [params, body] = args as [Record<string, string>?, unknown?];
    const url = buildUrl(baseUrl, route.route, params ?? {});

    const res = await fetch(url, {
      method: route.method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err);
    }

    return (await res.json()) as InferResponse<R>;
  }

  return { request };
}
