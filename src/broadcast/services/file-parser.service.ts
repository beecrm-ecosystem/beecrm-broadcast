import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ParsedContact {
  name: string;
  phone: string;
  email?: string;
  variables: Record<string, any>;
  metadata: Record<string, any>;
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  /**
   * Processa arquivo CSV ou XLSX e retorna contatos
   */
  async parseContactsFile(file: Express.Multer.File): Promise<ParsedContact[]> {
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

    this.logger.log(`Processando arquivo: ${file.originalname} (${fileExtension})`);

    let rows: any[] = [];

    try {
      if (fileExtension === 'csv') {
        rows = await this.parseCSV(file);
      } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        rows = this.parseXLSX(file);
      } else {
        throw new BadRequestException('Formato de arquivo não suportado. Use CSV ou XLSX');
      }

      // Converte rows para contatos
      const contacts = this.mapRowsToContacts(rows);

      this.logger.log(`${contacts.length} contatos processados com sucesso`);

      return contacts;
    } catch (error) {
      this.logger.error(`Erro ao processar arquivo: ${error.message}`);
      throw new BadRequestException(`Erro ao processar arquivo: ${error.message}`);
    }
  }

  /**
   * Parse arquivo CSV
   */
  private async parseCSV(file: Express.Multer.File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const fileContent = file.buffer.toString('utf-8');

      Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Parse arquivo XLSX
   */
  private parseXLSX(file: Express.Multer.File): any[] {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);
    return rows;
  }

  /**
   * Mapeia linhas do arquivo para objetos de contato
   */
  private mapRowsToContacts(rows: any[]): ParsedContact[] {
    const contacts: ParsedContact[] = [];

    for (const row of rows) {
      // Pula linhas vazias
      if (!row.NAME && !row.PHONE) {
        continue;
      }

      // Extrai campos principais
      const name = row.NAME?.trim();
      const phone = this.normalizePhone(row.PHONE);
      const email = row.EMAIL?.trim() || undefined;

      // Valida campos obrigatórios
      if (!name || !phone) {
        this.logger.warn(`Linha ignorada - campos obrigatórios faltando: ${JSON.stringify(row)}`);
        continue;
      }

      // Separa variáveis (colunas que começam com CF_)
      const variables: Record<string, any> = {};
      const metadata: Record<string, any> = {};

      for (const [key, value] of Object.entries(row)) {
        const rawKey = String(key).trim();
        const upperKey = rawKey.toUpperCase();

        if (upperKey.startsWith('CF_')) {
          // Mantém chaves com e sem prefixo CF_ para compatibilidade
          const strippedKey = rawKey.replace(/^CF_/i, '').trim();
          const strippedLower = strippedKey.toLowerCase();
          const strippedUpper = strippedKey.toUpperCase();
          const cfUpper = `CF_${strippedUpper}`;
          const cfLower = `CF_${strippedLower}`;

          if (rawKey) {
            variables[rawKey] = value;
          }
          if (strippedLower) {
            variables[strippedLower] = value;
          }
          if (strippedUpper) {
            variables[strippedUpper] = value;
          }
          if (cfUpper) {
            variables[cfUpper] = value;
          }
          if (cfLower) {
            variables[cfLower] = value;
          }
        } else if (!['NAME', 'PHONE', 'EMAIL', 'SUBSCRIBED'].includes(upperKey)) {
          // Outros campos vão para metadata
          metadata[rawKey.toLowerCase()] = value;
        }
      }

      // Adiciona SUBSCRIBED ao metadata se existir
      if (row.SUBSCRIBED) {
        metadata.subscribed = row.SUBSCRIBED.toLowerCase() === 'sim';
      }

      contacts.push({
        name,
        phone,
        email,
        variables,
        metadata,
      });
    }

    return contacts;
  }

  /**
   * Normaliza número de telefone para formato internacional
   */
  private normalizePhone(phone: string | number): string {
    if (!phone) return '';

    // Converte para string e remove tudo que não é número
    const normalized = String(phone).replace(/\D/g, '');

    // Se começar com 55 (Brasil), mantém
    if (normalized.startsWith('55')) {
      return `+${normalized}`;
    }

    // Se tiver 11 dígitos (DDD + número), adiciona 55
    if (normalized.length === 11) {
      return `+55${normalized}`;
    }

    // Se tiver 10 dígitos (DDD + número sem 9), adiciona 55
    if (normalized.length === 10) {
      return `+55${normalized}`;
    }

    // Se já tiver código de país diferente, mantém
    if (normalized.length > 11) {
      return `+${normalized}`;
    }

    // Caso contrário, retorna com +55
    return `+55${normalized}`;
  }
}
