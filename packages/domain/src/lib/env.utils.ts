const TRUTHY_BOOLEAN_ENV_VALUES = ['1', 'true', 'yes', 'on'];

export function parseOptionalBooleanEnv(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return TRUTHY_BOOLEAN_ENV_VALUES.includes(String(value).toLowerCase());
}

export function readBooleanEnv(
  value: string | undefined,
  fallback: boolean,
): boolean {
  return parseOptionalBooleanEnv(value) ?? fallback;
}

export function readNumberEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  return Number(value);
}