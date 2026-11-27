import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { CurrentTenant } from '../../common/tenant/tenant-context';
import { Errors } from '../../common/errors/domain.error';
import { AuthService, type AuthResult } from './auth.service';
import { AcceptInvitationDto, LoginDto, RegisterDto, SwitchTenantDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefreshCookie(res: Response, result: AuthResult): void {
    if (result.refreshToken) {
      res.cookie(this.auth.refreshCookieName, result.refreshToken, this.auth.cookieOptions());
    }
  }

  /** Never leak the refresh token into the JSON body — cookie only. */
  private sanitized(result: AuthResult) {
    const { refreshToken: _r, refreshTokenExpiresAt: _e, ...rest } = result;
    return rest;
  }

  @Post('register')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Create an account + organization (or accept an invitation)' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto, (req as Request & { requestId: string }).requestId);
    this.setRefreshCookie(res, result);
    return this.sanitized(result);
  }

  @Post('login')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Sign in with email + password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, (req as Request & { requestId: string }).requestId);
    this.setRefreshCookie(res, result);
    return this.sanitized(result);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Rotate refresh cookie → new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[this.auth.refreshCookieName];
    if (!raw) {
      res.clearCookie(this.auth.refreshCookieName, { path: '/api/v1/auth' });
      return { accessToken: null };
    }
    try {
      const result = await this.auth.refresh(raw, (req as Request & { requestId: string }).requestId);
      this.setRefreshCookie(res, result);
      return this.sanitized(result);
    } catch {
      res.clearCookie(this.auth.refreshCookieName, { path: '/api/v1/auth' });
      throw Errors.tokenExpired();
    }
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Revoke the refresh session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[this.auth.refreshCookieName];
    await this.auth.logout(raw, (req as Request & { requestId: string }).requestId);
    res.clearCookie(this.auth.refreshCookieName, { path: '/api/v1/auth' });
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile + memberships + permissions' })
  async me(@CurrentTenant() ctx: { user: { id: string } }) {
    return this.auth.me(ctx.user.id);
  }

  @Post('switch-tenant')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Switch the active organization (multi-org users)' })
  async switchTenant(
    @CurrentTenant() ctx: { user: { id: string } },
    @Body() dto: SwitchTenantDto,
    @Req() req: Request,
  ) {
    return this.sanitized(
      await this.auth.switchTenant(ctx.user.id, dto.tenantId, (req as Request & { requestId: string }).requestId),
    );
  }

  @Post('invitations/accept')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Authenticated user accepts a pending invitation' })
  async acceptInvitation(
    @CurrentTenant() ctx: { user: { id: string } },
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.acceptInvitation(
      ctx.user.id,
      dto.invitationToken,
      (req as Request & { requestId: string }).requestId,
    );
    this.setRefreshCookie(res, result);
    return this.sanitized(result);
  }
}
