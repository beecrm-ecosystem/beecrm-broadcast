import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';
import { join } from 'path';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get(['', 'index.html', 'panel', 'painel'])
  renderPanel(@Res() res: Response) {
    return res.sendFile(join(process.cwd(), 'static', 'index.html'));
  }
}
