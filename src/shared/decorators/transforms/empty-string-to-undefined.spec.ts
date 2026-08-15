import { plainToInstance } from 'class-transformer';
import { IsEmail, IsOptional, validate } from 'class-validator';

import { EmptyStringToUndefined } from './empty-string-to-undefined';

class TestDto {
  @IsEmail()
  @IsOptional()
  @EmptyStringToUndefined()
  email?: string;
}

describe('@decorators/transforms/empty-string-to-undefined.ts', () => {
  it('should convert an empty string to undefined so @IsOptional skips it', async () => {
    const dto = plainToInstance(TestDto, { email: '' });

    expect(dto.email).toBeUndefined();

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should leave undefined untouched', async () => {
    const dto = plainToInstance(TestDto, {});

    expect(dto.email).toBeUndefined();

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should keep a valid email intact', async () => {
    const dto = plainToInstance(TestDto, { email: 'user@example.com' });

    expect(dto.email).toBe('user@example.com');

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should still fail validation for a non-empty invalid email', async () => {
    const dto = plainToInstance(TestDto, { email: 'not-an-email' });

    expect(dto.email).toBe('not-an-email');

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
