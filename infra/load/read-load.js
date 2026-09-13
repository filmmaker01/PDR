/**
 * Нагрузочная проверка чтения: списки заказов, календарь и «Сегодня».
 * Запуск на staging (не на production):
 *
 *   BASE_URL=https://api.staging.example TOKEN=<access> WORKSPACE_ID=<uuid> \
 *     k6 run infra/load/read-load.js
 *
 * Цель из чеклиста: 200 запросов в секунду на чтение без деградации.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN;
const WORKSPACE_ID = __ENV.WORKSPACE_ID;

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: 50, duration: '30s' },
        { target: 200, duration: '1m' },
        { target: 200, duration: '2m' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    // Порог из чеклиста: чтение списков остаётся быстрым под нагрузкой.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<400', 'p(99)<800'],
  },
};

const headers = { Authorization: `Bearer ${TOKEN}` };

function day(offset) {
  const date = new Date(Date.now() + offset * 86400000);
  return date.toISOString();
}

export default function () {
  const base = `${BASE_URL}/v1/workspaces/${WORKSPACE_ID}`;

  const responses = http.batch([
    ['GET', `${base}/today`, null, { headers }],
    ['GET', `${base}/orders?limit=50`, null, { headers }],
    ['GET', `${base}/clients?limit=50`, null, { headers }],
    [
      'GET',
      `${base}/appointments?from=${encodeURIComponent(day(-1))}&to=${encodeURIComponent(day(7))}`,
      null,
      { headers },
    ],
  ]);

  for (const response of responses) {
    check(response, {
      'статус 200': (r) => r.status === 200,
      'ответ меньше секунды': (r) => r.timings.duration < 1000,
    });
  }

  sleep(1);
}
