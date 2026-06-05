import { Transform } from 'class-transformer';
import {
  DEFAULT_MAX_SCRAPE_PROXY_LENGTH,
  InvalidScrapeProxyError,
  InvalidScrapeUrlError,
  MAX_SCRAPE_URL_LENGTH,
  normalizeAndValidateScrapeProxy,
  normalizeAndValidateScrapeUrl,
} from '@org/domain';
import {
  IsOptional,
  IsNotEmpty,
  MaxLength,
  ValidateBy,
  type ValidationOptions,
  buildMessage,
} from 'class-validator';

function IsScrapeUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isScrapeUrl',
      validator: {
        validate: (value: unknown): boolean => {
          try {
            normalizeAndValidateScrapeUrl(value);
            return true;
          } catch (error: unknown) {
            if (error instanceof InvalidScrapeUrlError) {
              return false;
            }

            throw error;
          }
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid http or https URL without embedded credentials and no longer than ${MAX_SCRAPE_URL_LENGTH} characters`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

function IsScrapeProxy(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isScrapeProxy',
      validator: {
        validate: (value: unknown): boolean => {
          try {
            normalizeAndValidateScrapeProxy(value);
            return true;
          } catch (error: unknown) {
            if (error instanceof InvalidScrapeProxyError) {
              return false;
            }

            throw error;
          }
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid http or https proxy URL and no longer than ${DEFAULT_MAX_SCRAPE_PROXY_LENGTH} characters`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

export class SubmitScrapeRequestDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(MAX_SCRAPE_URL_LENGTH)
  @IsScrapeUrl()
  url!: string;

  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : undefined;
  })
  @IsOptional()
  @MaxLength(DEFAULT_MAX_SCRAPE_PROXY_LENGTH)
  @IsScrapeProxy()
  proxy?: string;
}