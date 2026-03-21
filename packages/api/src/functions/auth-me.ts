import {
  combineMiddleware,
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

const requireAuth = (async (request, _context, next) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse;
  }
  const user = usersByToken.get(authHeader.replace("Bearer ", ""));
  if (!user) {
    return unauthorizedResponse;
  }
  await next(request, _context);
}) satisfies HttpMiddleware;

export const authMe = defineHttp({
  middleware: combineMiddleware([requireAuth, defaultMiddleware]),
  handler: async (request) => {
    const token = request.headers.get("authorization")!.replace("Bearer ", "");
    const user = usersByToken.get(token)!;
    return { status: 200, jsonBody: user } as const;
  },
});
