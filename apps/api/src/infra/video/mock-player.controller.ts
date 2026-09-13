import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/auth.decorators';

/**
 * Страница-заглушка вместо плеера.
 *
 * Демо-окружение работает без видеоплатформы, а урок всё равно должен
 * выглядеть законченным экраном: пустая рамка читается как поломка,
 * поэтому вместо неё показывается объяснение.
 * Отдаётся только при VIDEO_PROVIDER=mock, который запрещён в production.
 */
@ApiExcludeController()
@Controller('mock-player')
export class MockPlayerController {
  @Get(':providerVideoId')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page(@Param('providerVideoId') providerVideoId: string): string {
    void providerVideoId;
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Демо-видео</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#111418;color:#e8eaed;
       font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
  .box{padding:24px;max-width:420px}
  .mark{width:56px;height:56px;border-radius:50%;border:2px solid #4a5560;margin:0 auto 14px;
        display:flex;align-items:center;justify-content:center;font-size:22px;color:#8b97a3}
  .hint{color:#8b97a3;font-size:13px;margin-top:8px}
</style></head>
<body><div class="box">
  <div class="mark">▶</div>
  <div>Демонстрационное окружение: видеоплатформа не подключена</div>
  <div class="hint">Здесь будет урок после подключения Kinescope. Остальные части урока —
  описание, материалы, задания и отметка о прохождении — работают как в рабочем приложении.</div>
</div></body></html>`;
  }
}
