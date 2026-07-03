/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionUser } from "./session.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/**
 * Populates `req.user` from the session cookie, if present and valid.
 * Never rejects the request — mount globally so every route can read
 * `req.user`, and pair with `requireAuth` on routes that must reject
 * unauthenticated requests.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
  req.user = verifySessionToken(token) ?? undefined;
  next();
}

/** Rejects with 401 unless `attachUser` has already populated `req.user`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}
