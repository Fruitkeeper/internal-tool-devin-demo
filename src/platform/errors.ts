/** Errors with messages that are safe to show to the user. */
export class AppError extends Error {}

export class ForbiddenError extends AppError {
  constructor(message = "You are not allowed to perform this action") {
    super(message);
  }
}

export class ValidationError extends AppError {}

export class NotFoundError extends AppError {}
