import { Body, Controller, Param, Post } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { AddContactsDto } from './schemas/broadcast.dto';

@Controller('api/broadcast')
export class LegacyBroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  /**
   * POST /api/broadcast/:id/contacts
   * Legacy endpoint that mirrors the BFF format for adding contacts to a campaign
   */
  @Post(':id/contacts')
  async addContacts(@Param('id') id: string, @Body() addContactsDto: AddContactsDto) {
    return this.broadcastService.addContacts(id, addContactsDto);
  }
}
