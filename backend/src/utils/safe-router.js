import { Router } from "express";

const HTTP_METHODS = ["all", "delete", "get", "head", "options", "patch", "post", "put"];

/**
 * Express 4 does not forward a rejected async route promise to the error
 * middleware. Wrapping every handler at router registration keeps database
 * outages and other async failures inside the normal API error path instead
 * of becoming unhandled promise rejections.
 */
export function asyncHandler(handler) {
  if (typeof handler !== "function" || handler.length === 4) return handler;
  return function safeAsyncHandler(req, res, next) {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

export function createSafeRouter() {
  const router = Router();
  for (const method of HTTP_METHODS) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(path, ...handlers.map(asyncHandler));
  }
  return router;
}
