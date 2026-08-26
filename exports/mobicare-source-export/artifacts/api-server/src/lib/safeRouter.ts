import { Router, type RequestHandler, type Router as ExpressRouter } from "express";

type RouteMethod = "all" | "delete" | "get" | "head" | "options" | "patch" | "post" | "put" | "use";

/**
 * Creates a router that forwards rejected async handlers to Express error
 * middleware. Express 5 does this natively, but keeping it at the router
 * boundary makes the error-handling contract explicit and protects routes if
 * the framework behavior changes.
 */
export function safeRouter(): ExpressRouter {
  const router = Router();
  const methods: RouteMethod[] = ["all", "delete", "get", "head", "options", "patch", "post", "put", "use"];

  for (const method of methods) {
    const original = router[method].bind(router) as (...args: unknown[]) => ExpressRouter;

    (router as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
      original(...args.map(wrapAsyncHandler));
  }

  return router;
}

function wrapAsyncHandler(argument: unknown): unknown {
  if (Array.isArray(argument)) return argument.map(wrapAsyncHandler);
  if (typeof argument !== "function" || argument.constructor.name !== "AsyncFunction") {
    return argument;
  }

  const handler = argument as RequestHandler;
  return (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}