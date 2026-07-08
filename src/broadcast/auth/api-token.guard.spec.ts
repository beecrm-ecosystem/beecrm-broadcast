import { ApiTokenGuard } from './api-token.guard';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

function ctx(headers: Record<string, unknown> = {}): any {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  };
}

function reflectorReturning(isPublic: boolean): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

describe('ApiTokenGuard', () => {
  const OLD = process.env.BROADCAST_SERVICE_TOKEN;
  afterEach(() => {
    process.env.BROADCAST_SERVICE_TOKEN = OLD;
  });

  it('permite rota @Public sem token', () => {
    const g = new ApiTokenGuard(reflectorReturning(true));
    expect(g.canActivate(ctx())).toBe(true);
  });

  it('fail-open quando BROADCAST_SERVICE_TOKEN nao esta setado', () => {
    delete process.env.BROADCAST_SERVICE_TOKEN;
    const g = new ApiTokenGuard(reflectorReturning(false));
    expect(g.canActivate(ctx())).toBe(true);
  });

  it('401 sem Authorization quando a env esta setada', () => {
    process.env.BROADCAST_SERVICE_TOKEN = 'segredo';
    const g = new ApiTokenGuard(reflectorReturning(false));
    expect(() => g.canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('401 com token errado', () => {
    process.env.BROADCAST_SERVICE_TOKEN = 'segredo';
    const g = new ApiTokenGuard(reflectorReturning(false));
    expect(() => g.canActivate(ctx({ authorization: 'Bearer errado' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('permite com Bearer correto', () => {
    process.env.BROADCAST_SERVICE_TOKEN = 'segredo';
    const g = new ApiTokenGuard(reflectorReturning(false));
    expect(g.canActivate(ctx({ authorization: 'Bearer segredo' }))).toBe(true);
  });
});
