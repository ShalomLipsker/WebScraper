import { Transform } from 'class-transformer';
import {
  InvalidScrapeUrlError,
  MAX_SCRAPE_URL_LENGTH,
  normalizeAndValidateScrapeUrl,
} from '@org/domain';
import {
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

export class SubmitScrapeRequestDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(MAX_SCRAPE_URL_LENGTH)
  @IsScrapeUrl()
  url!: string;
}