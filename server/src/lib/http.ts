import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(entity: string): never {
  throw new HttpError(404, `${entity} não encontrado`);
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, parsed.error.issues.map((i) => i.message).join("; ")));
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
}
