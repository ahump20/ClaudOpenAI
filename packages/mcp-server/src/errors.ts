/**
 * Typed error classes for the universal-skills-mcp server.
 * Every error carries an HTTP-style status code for transport-layer mapping.
 */

export abstract class UniversalSkillsError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ValidationError extends UniversalSkillsError {
  readonly code = "validation_error";
  readonly statusCode = 400;
}

export class SkillNotFoundError extends UniversalSkillsError {
  readonly code = "skill_not_found";
  readonly statusCode = 404;
}

export class VersionNotFoundError extends UniversalSkillsError {
  readonly code = "version_not_found";
  readonly statusCode = 404;
}

export class RegistryUnavailableError extends UniversalSkillsError {
  readonly code = "registry_unavailable";
  readonly statusCode = 503;
}

export class GitHubRateLimitError extends UniversalSkillsError {
  readonly code = "rate_limited";
  readonly statusCode = 429;

  constructor(public readonly retryAfterSeconds: number, details?: Record<string, unknown>) {
    super(`GitHub rate limit exceeded; retry after ${retryAfterSeconds}s`, { ...details, retry_after_seconds: retryAfterSeconds });
  }
}

export class UpstreamFetchError extends UniversalSkillsError {
  readonly code = "upstream_fetch_failed";
  readonly statusCode = 502;
}

export class ContentIntegrityError extends UniversalSkillsError {
  readonly code = "content_integrity_failed";
  readonly statusCode = 500;
}

export class AmbiguousTargetError extends UniversalSkillsError {
  readonly code = "ambiguous_target";
  readonly statusCode = 400;
}

export class WriteProtectedError extends UniversalSkillsError {
  readonly code = "write_protected";
  readonly statusCode = 403;
}

export class PathEscapeAttempt extends UniversalSkillsError {
  readonly code = "path_escape_attempt";
  readonly statusCode = 400;
}

export class InvalidFrontmatterError extends UniversalSkillsError {
  readonly code = "invalid_frontmatter";
  readonly statusCode = 400;
}

export class YAMLParseError extends UniversalSkillsError {
  readonly code = "yaml_parse_error";
  readonly statusCode = 400;
}
