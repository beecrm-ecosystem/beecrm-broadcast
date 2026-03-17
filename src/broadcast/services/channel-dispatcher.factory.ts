import { Injectable, Logger } from '@nestjs/common';
import { ChannelDispatcher } from './channel-dispatcher.interface';
import { WhatsAppDispatcher } from './dispatchers/whatsapp.dispatcher';
import { RcsDispatcher } from './dispatchers/rcs.dispatcher';

@Injectable()
export class ChannelDispatcherFactory {
  private readonly logger = new Logger(ChannelDispatcherFactory.name);
  private readonly dispatchers: Map<string, ChannelDispatcher>;

  constructor(
    private readonly whatsappDispatcher: WhatsAppDispatcher,
    private readonly rcsDispatcher: RcsDispatcher,
  ) {
    this.dispatchers = new Map<string, ChannelDispatcher>();
    this.dispatchers.set(this.whatsappDispatcher.channel, this.whatsappDispatcher);
    this.dispatchers.set(this.rcsDispatcher.channel, this.rcsDispatcher);
  }

  getDispatcher(channel: string): ChannelDispatcher {
    // Normalize: o campo channel pode conter o ID da instancia WhatsApp
    // (ex: "instance-abc123"). Se nao for 'rcs', assume whatsapp.
    const normalizedChannel = this.normalizeChannel(channel);

    const dispatcher = this.dispatchers.get(normalizedChannel);
    if (!dispatcher) {
      throw new Error(`Canal nao suportado: ${channel} (normalizado: ${normalizedChannel})`);
    }

    this.logger.debug(`Dispatcher selecionado: ${normalizedChannel} para canal "${channel}"`);
    return dispatcher;
  }

  private normalizeChannel(channel: string): string {
    if (!channel) {
      return 'whatsapp';
    }

    const lower = channel.toLowerCase();

    if (lower === 'rcs') {
      return 'rcs';
    }

    // Qualquer outro valor e tratado como whatsapp (instancia ID, "whatsapp", etc.)
    return 'whatsapp';
  }
}
