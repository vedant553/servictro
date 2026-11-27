import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { IdentityService } from './identity.service';
import { InviteDto, UpdateMembershipDto } from './dto/identity.dto';

class InvitationIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('team')
@ApiBearerAuth()
@Controller()
@RequirePermissions('team:read')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get('team/members')
  @ApiOperation({ summary: 'List organization members' })
  async members(@CurrentTenant() ctx: TenantContext) {
    return this.identity.listMembers(ctx);
  }

  @Get('team/invitations')
  @ApiOperation({ summary: 'List invitations' })
  async invitations(@CurrentTenant() ctx: TenantContext) {
    return this.identity.listInvitations(ctx);
  }

  @Post('team/invitations')
  @RequirePermissions('team:manage')
  @ApiOperation({ summary: 'Invite a user (returns a one-time acceptance link)' })
  async invite(@CurrentTenant() ctx: TenantContext, @Body() dto: InviteDto) {
    return this.identity.invite(ctx, dto);
  }

  @Post('team/invitations/:id/resend')
  @RequirePermissions('team:manage')
  @ApiOperation({ summary: 'Regenerate an invitation link' })
  async resend(@CurrentTenant() ctx: TenantContext, @Param() params: InvitationIdDto) {
    return this.identity.resend(ctx, params.id);
  }

  @Delete('team/invitations/:id')
  @RequirePermissions('team:manage')
  @ApiOperation({ summary: 'Revoke an invitation' })
  async revoke(@CurrentTenant() ctx: TenantContext, @Param() params: InvitationIdDto) {
    return this.identity.revoke(ctx, params.id);
  }

  @Patch('team/members/:userId')
  @RequirePermissions('team:manage')
  @ApiOperation({ summary: 'Update role / status / skills of a member' })
  async updateMembership(
    @CurrentTenant() ctx: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.identity.updateMembership(ctx, userId, dto);
  }
}
