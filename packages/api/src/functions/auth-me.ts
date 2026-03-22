import {
  http,
  withMiddleware,
  createVariableKey,
  catchError,
  type HttpMiddleware,
} from "../lib/http-function-v2/index.js";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", {
  name: "John Doe",
});

const unauthorizedResponse = {
  status: 401,
  jsonBody: { message: "Unauthorized" },
} as const;

export const userKey = createVariableKey<User>("user");

const requireAuth = (async (c) => {
  const authHeader = c.request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse;
  }
  const user = usersByToken.get(authHeader.replace("Bearer ", ""));
  if (!user) {
    return unauthorizedResponse;
  }
  c.vars.set(userKey, user);
  await c.next();
}) satisfies HttpMiddleware;

export const authMe = http({
  handler: withMiddleware([requireAuth, catchError], async (c) => {
    const user = c.vars.get(userKey)!;
    return { status: 200, jsonBody: user } as const;
  }),
});
