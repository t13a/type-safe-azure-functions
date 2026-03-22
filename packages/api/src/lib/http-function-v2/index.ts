export { http, registerAll } from "./core.js";
export type {
  HttpFunctionDefinition,
  HttpHandlerWithParser,
} from "./core.js";

export {
  withMiddleware,
  withCatchError,
  combineMiddleware,
  catchError,
  createVars,
  createVariableKey,
} from "./middleware.js";
export type {
  VariableKey,
  Variables,
  HttpMiddleware,
  HttpMiddlewareContext,
  HttpMiddlewareNext,
  ParsedHttpHandler,
  HttpHandlerContext,
} from "./middleware.js";
