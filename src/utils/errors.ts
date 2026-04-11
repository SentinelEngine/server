import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message: string): AppError {
    return new AppError(message, 400, 'BAD_REQUEST');
  }

  static unauthorized(message: string): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(message: string): AppError {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static tooLarge(message: string): AppError {
    return new AppError(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors
  if (error.cause instanceof ZodError) {
    reply.status(422).send({
      error:  'Validation Error',
      issues: error.cause.errors,
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(422).send({ error: 'Validation Error', issues: error.errors });
    return;
  }

  // App-level errors
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ error: error.message, code: error.code });
    return;
  }

  // Fastify errors (e.g. rate limit)
  if ((error as any).statusCode) {
    reply.status((error as any).statusCode).send({ error: error.message });
    return;
  }

  request.log.error(error, 'Unhandled error');
  reply.status(500).send({ error: 'Internal Server Error' });
}
