import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { env } from "../config/env.js";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,80}$/;

function equalSecret(expected: string | undefined, candidate: string | undefined): boolean {
  if (!expected || !candidate) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const candidateHash = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedHash, candidateHash);
}

function rateLimitHandler(_request: Request, response: Response): void {
  response.status(429).json({
    error: "Limite temporal de solicitudes excedido",
    code: "rate_limit_exceeded",
    requestId: response.locals.requestId
  });
}

export const aiRateLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  limit: env.apiAiRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitHandler
});

export const computeRateLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  limit: env.apiComputeRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitHandler
});

export function installSecurityMiddleware(app: Express): void {
  if (env.apiTrustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      // Cesium and local audio assets are delivered by the separate Vite origin in development.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use((_request, response, next) => {
    const incoming = _request.header("x-request-id");
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    next();
  });
  app.use((request, response, next) => {
    const origin = request.header("origin");
    if (origin && origin !== env.frontendOrigin) {
      response.status(403).json({
        error: "Origen web no autorizado",
        code: "origin_not_allowed",
        requestId: response.locals.requestId
      });
      return;
    }
    next();
  });
}

export function requireOperatorToken(request: Request, response: Response, next: NextFunction): void {
  if (!env.apiOperatorToken) {
    response.status(503).json({
      error: "La operacion requiere configurar API_OPERATOR_TOKEN",
      code: "operator_auth_not_configured",
      requestId: response.locals.requestId
    });
    return;
  }
  if (!equalSecret(env.apiOperatorToken, request.header("x-sismica-operator-token"))) {
    response.status(401).json({
      error: "Credencial de operador invalida",
      code: "operator_auth_failed",
      requestId: response.locals.requestId
    });
    return;
  }
  next();
}
