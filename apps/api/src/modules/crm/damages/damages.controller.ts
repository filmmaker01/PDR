import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BODY_PANELS, DAMAGE_TYPES, SIZE_CLASSES } from '@pdr/shared';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { DamagesService } from './damages.service';
import { serializeDamage } from '../serializers';
import { createDamageSchema, updateDamageSchema } from '../dto/leads.dto';

/**
 * Повреждения на схеме автомобиля.
 *
 * Маршруты симметричны для обращения и заказа: интерфейс схемы один и тот же,
 * меняется только владелец карточки.
 */
@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class DamagesController {
  constructor(private readonly damages: DamagesService) {}

  @Get('body-scheme')
  @Can('workspace.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Справочник элементов кузова для интерактивной схемы' })
  bodyScheme() {
    return {
      panels: BODY_PANELS.map((panel) => ({
        code: panel.code,
        label: panel.label,
        group: panel.group,
        oftenAluminum: panel.oftenAluminum ?? false,
      })),
      damageTypes: DAMAGE_TYPES,
      sizeClasses: SIZE_CLASSES,
    };
  }

  @Get('orders/:orderId/damages')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Повреждения заказа' })
  async listForOrder(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const items = await this.damages.listFor(ws, { orderId });
    return { items: items.map(serializeDamage) };
  }

  @Post('orders/:orderId/damages')
  @Can('orders.write_own')
  @Idempotent()
  @Audited({ entityType: 'damage', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Отметить повреждённую деталь в заказе' })
  async createForOrder(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(createDamageSchema)) body: Record<string, never>,
  ) {
    const damage = await this.damages.create(ws, { orderId }, body as never);
    return serializeDamage(damage);
  }

  @Post('leads/:leadId/damages')
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'damage', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Отметить повреждённую деталь в обращении' })
  async createForLead(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(createDamageSchema)) body: Record<string, never>,
  ) {
    const damage = await this.damages.create(ws, { leadId }, body as never);
    return serializeDamage(damage);
  }

  // Повреждение принадлежит либо обращению, либо заказу, и по адресу это
  // неизвестно. Право на маршруте — минимальное, настоящую проверку делает
  // сервис: он знает владельца и спрашивает ровно его права.
  @Patch('damages/:damageId')
  @Can('workspace.read')
  @Audited({ entityType: 'damage', idFrom: { param: 'damageId' } })
  @ApiOperation({ summary: 'Изменение повреждения: тип, размеры, стоимость' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('damageId') damageId: string,
    @Body(zodBody(updateDamageSchema)) body: Record<string, never>,
  ) {
    const damage = await this.damages.update(ws, damageId, body as never);
    return serializeDamage(damage);
  }

  @Delete('damages/:damageId')
  @Can('workspace.read')
  @Audited({ entityType: 'damage', action: 'delete', idFrom: { param: 'damageId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снять отметку повреждения' })
  async remove(@Ws() ws: WorkspaceContext, @Param('damageId') damageId: string): Promise<void> {
    await this.damages.remove(ws, damageId);
  }
}
