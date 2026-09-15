import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from '../errors/app.error';

/**
 * Валидация тела/параметров по zod-схеме.
 * Неизвестные поля отбрасываются схемой (`.strict()` там, где важно).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (e) {
      if (e instanceof ZodError) throw AppError.fromZod(e);
      throw e;
    }
  }
}

/** Фабрика для краткой записи: @Body(zodBody(schema)). */
export function zodBody(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
