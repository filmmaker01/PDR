import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import { AppConfigService } from '@/config/config.service';

/**
 * Плеер-заглушка вместо видеоплатформы.
 *
 * Повторяет поведение настоящего плеера ровно в том, что важно для продукта:
 * спрашивает у нашего сервера разрешение на воспроизведение по токену сессии,
 * рисует поверх видео движущийся водяной знак и шлёт наверх события времени.
 * Благодаря этому вся цепочка — сессия, отзыв, прогресс, метка — проверяется
 * без доступа к аккаунту провайдера.
 *
 * Отдаётся только при VIDEO_PROVIDER=mock, который запрещён в production.
 */
@ApiExcludeController()
@Controller('mock-player')
export class MockPlayerController {
  constructor(private readonly config: AppConfigService) {}

  @Get(':providerVideoId')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page(@Param('providerVideoId') providerVideoId: string): string {
    void providerVideoId;
    const apiBase = this.config.env.PUBLIC_API_URL;
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Демо-плеер</title>
<style>
  html,body{height:100%;margin:0;background:#111418;color:#e8eaed;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  #stage{position:relative;height:100%;display:flex;align-items:center;justify-content:center}
  #play{width:72px;height:72px;border-radius:50%;border:2px solid #4a5560;background:transparent;
    color:#cfd6dd;font-size:26px;cursor:pointer}
  #mark{position:absolute;pointer-events:none;color:rgba(255,255,255,.55);font-size:13px;
    letter-spacing:.04em;transition:left .6s ease,top .6s ease;white-space:nowrap}
  #bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:#2a3038}
  #fill{height:100%;width:0;background:#2f80ed}
  #msg{position:absolute;padding:0 24px;text-align:center;color:#8b97a3;display:none}
  #time{position:absolute;left:10px;bottom:12px;font-size:11px;color:#8b97a3;font-variant-numeric:tabular-nums}
</style></head>
<body><div id="stage">
  <button id="play" aria-label="Воспроизвести">&#9654;</button>
  <div id="mark"></div>
  <div id="msg"></div>
  <div id="time"></div>
  <div id="bar"><div id="fill"></div></div>
</div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var token = q.get('drmauthtoken') || '';
  var watermark = q.get('watermark') || '';
  var duration = Number(q.get('duration') || 600);
  var startAt = Number(q.get('t') || 0);

  var stage = document.getElementById('stage');
  var play = document.getElementById('play');
  var mark = document.getElementById('mark');
  var msg = document.getElementById('msg');
  var fill = document.getElementById('fill');
  var timeEl = document.getElementById('time');

  function post(type, data) {
    parent.postMessage({ source: 'pdr-mock-player', type: type, data: data || {} }, '*');
  }

  // Метка ходит по экрану: неподвижную легко закрыть и легко вырезать.
  function moveMark() {
    if (!watermark) return;
    mark.textContent = watermark;
    mark.style.left = (5 + Math.random() * 70) + '%';
    mark.style.top = (8 + Math.random() * 78) + '%';
  }
  moveMark();
  setInterval(moveMark, 4000);

  function fail(reason) {
    play.style.display = 'none';
    mark.style.display = 'none';
    msg.style.display = 'block';
    msg.textContent = reason === 'revoked' || reason === 'access_lost'
      ? 'Доступ к просмотру отозван. Откройте урок заново.'
      : 'Просмотр недоступен: ' + reason;
    post('error', { reason: reason });
  }

  var current = startAt;
  var timer = null;

  function tick() {
    current = Math.min(duration, current + 1);
    fill.style.width = (current / duration * 100) + '%';
    timeEl.textContent = Math.floor(current / 60) + ':' + String(Math.floor(current % 60)).padStart(2, '0');
    post('timeupdate', { currentTime: current, percent: Math.round(current / duration * 100) });
    if (current >= duration) {
      clearInterval(timer);
      timer = null;
      post('ended', {});
    }
  }

  // Разрешение спрашивается у сервера так же, как это делает настоящий
  // провайдер перед выдачей лицензии.
  function authorize() {
    return fetch('${apiBase}/v1/video/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        return { ok: r.ok, reason: b && b.reason };
      });
    }).catch(function () { return { ok: false, reason: 'network' }; });
  }

  play.addEventListener('click', function () {
    authorize().then(function (res) {
      if (!res.ok) { fail(res.reason || 'forbidden'); return; }
      play.style.display = 'none';
      post('play', {});
      post('loaded', { duration: duration, currentTime: current });
      timer = setInterval(tick, 1000);
      // Периодическая перепроверка: отзыв доступа должен гасить и уже
      // идущий просмотр, а не только следующий запуск.
      setInterval(function () {
        if (!timer) return;
        authorize().then(function (again) {
          if (!again.ok) { clearInterval(timer); timer = null; fail(again.reason || 'forbidden'); }
        });
      }, 15000);
    });
  });

  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  post('ready', { duration: duration });
})();
</script>
</body></html>`;
  }
}
