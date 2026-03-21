import {
  combineMiddleware,
  createContextKey,
  defaultMiddleware,
  defineHttp,
  HttpMiddleware,
} from "../lib/http-function.js";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", {
  name: "John Doe",
});

const unauthorizedResponse = {
  status: 401,
  jsonBody: { message: "Unauthorized" },
} as const;

export const userKey = createContextKey<User>("user");

const requireAuth = (async (request, _context, next, locals) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse;
  }
  const user = usersByToken.get(authHeader.replace("Bearer ", ""));
  if (!user) {
    return unauthorizedResponse;
  }
  locals.set(userKey, user);
  await next(request, _context);
}) satisfies HttpMiddleware;

export const authMe = defineHttp({
  middleware: combineMiddleware([requireAuth, defaultMiddleware]),
  handler: async (_request, _context, _parsed, locals) => {
    const user = locals.get(userKey);
    return { status: 200, jsonBody: user } as const;
  },
});
