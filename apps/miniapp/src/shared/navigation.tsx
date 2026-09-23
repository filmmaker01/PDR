import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useNavigate, type Params } from 'react-router-dom';
import { getWebApp, isInsideTelegram } from './telegram';

/**
 * Куда вернуться с внутреннего экрана, если назад идти некуда: экран открыли
 * ссылкой или из уведомления, и истории внутри приложения ещё нет.
 */
export interface BackHandle {
  back: (params: Params<string>) => string;
}

export function isBackHandle(handle: unknown): handle is BackHandle {
  return typeof (handle as BackHandle | undefined)?.back === 'function';
}

/** Есть ли куда вернуться внутри приложения. react-router хранит номер записи. */
function hasInternalHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * Кнопка «← Назад» на внутренних экранах CRM.
 *
 * Возвращает на предыдущий экран приложения, а не закрывает его. Внутри
 * Telegram вместе с ней включается системная кнопка «Назад» в шапке — иначе
 * там стоит «Закрыть», и мастер, нажав её, выходит из Mini App целиком.
 */
export function BackBar({ fallback }: { fallback: string }) {
  const navigate = useNavigate();

  // Обработчик один на всё время жизни кнопки: иначе при каждом переходе
  // кнопка Telegram пряталась бы и показывалась заново, и шапка моргала.
  const latest = useRef({ navigate, fallback });
  latest.current = { navigate, fallback };
  const goBack = useCallback(() => {
    const { navigate: go, fallback: home } = latest.current;
    if (hasInternalHistory()) go(-1);
    else go(home, { replace: true });
  }, []);

  useEffect(() => {
    const button = isInsideTelegram() ? getWebApp()?.BackButton : null;
    if (!button) return;
    button.onClick(goBack);
    button.show();
    return () => {
      button.offClick(goBack);
      button.hide();
    };
  }, [goBack]);

  return (
    <div className="pdr-backbar">
      <button type="button" className="pdr-backbar__button" onClick={goBack}>
        ← Назад
      </button>
    </div>
  );
}

/**
 * Состояние экрана, которое переживает уход с него: фильтр списка,
 * выбранная вкладка заказа. Хранится до закрытия Mini App — вернувшись
 * «Назад», мастер видит список таким, каким его оставил.
 */
export function useStickyState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `pdr.screen.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved !== null) return JSON.parse(saved) as T;
    } catch {
      // Хранилище недоступно — начинаем с исходного значения.
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Не запомнилось — не беда, экран просто откроется как обычно.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
