/**
 * DTO para callbacks de status RCS da Pontaltech.
 *
 * A Pontaltech envia um POST para o webhook configurado sempre que o status
 * de uma mensagem RCS muda (ex.: DELIVERED, READ, FAILED, etc.).
 */
export interface RcsWebhookDto {
  /** ID da mensagem na Pontaltech */
  messageId?: string;

  /** Status reportado: DELIVERED, READ, FAILED, EXPIRED, DISPLAYED, etc. */
  status?: string;

  /** Telefone do destinatario (formato E.164 ou numerico) */
  phone?: string;

  /** Timestamp do evento (ISO-8601 ou epoch) */
  timestamp?: string;

  /** Codigo de erro (quando status = FAILED) */
  errorCode?: string;

  /** Mensagem descritiva do erro */
  errorMessage?: string;

  /** Identificador do provedor (normalmente "pontaltech") */
  provider?: string;

  /** ID do agente/canal RCS */
  agentId?: string;

  /** Tipo do evento (ex.: "status_update", "delivery_receipt") */
  eventType?: string;

  /** Payload extra enviado pela Pontaltech */
  [key: string]: any;
}
